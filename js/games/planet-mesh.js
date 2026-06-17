/* planet-mesh.js — the voxel layer for the Earth hexel planet.

   Holds the radial voxel grid (one Uint8Array, material id 0 = air, 1..N = data/planet.js
   MATERIALS in order), generates a seeded procedural planet, and builds the surface as
   CHUNKED, vertex-colored geometry using exposed-face culling (we draw the surface, not the
   whole volume). The planet is split into 20 chunks (one per icosahedron face) so an edit
   rebuilds only the affected chunk(s) instead of the whole world, and so off-screen chunks
   frustum-cull. Targeting is analytic (earth.js), so no per-triangle lookup is needed here.

   Radial layout: cell at column `c`, layer `L` occupies the shell from radius(L) to
   radius(L+1). cell(c, L) = c * LAYERS + L. */

import * as THREE from '../../assets/vendor/three.module.js';
import { LAYERS, CORE_L, SEA_L, MATERIALS, radius, AO_MIN, WATER_OPACITY } from '../../data/planet.js';

// numeric material ids: 0 = air, 1..N = MATERIALS[i-1]
export const AIR = 0;
const NUM = {};               // material string id -> numeric id
MATERIALS.forEach((m, i) => { NUM[m.id] = i + 1; });
const COLORS = [null, ...MATERIALS.map((m) => new THREE.Color(m.color))];   // index by numeric id

export const cellIndex = (colId, L) => colId * LAYERS + L;

/* ---- seeded value-noise fBm (no deps) ---- */
function makeNoise(seed) {
  const s = seed | 0;
  function hash(i, j, k) {
    let h = s | 0;
    h = Math.imul(h ^ (i | 0), 374761393);
    h = Math.imul(h ^ (j | 0), 668265263);
    h = Math.imul(h ^ (k | 0), 1274126177);
    h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi);
    const x00 = lerp(hash(xi, yi, zi), hash(xi + 1, yi, zi), u);
    const x10 = lerp(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u);
    const x01 = lerp(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u);
    const x11 = lerp(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  }
  return function fbm(x, y, z) {
    let e = 0, amp = 0.5, f = 1.0;
    for (let o = 0; o < 4; o++) { e += amp * noise3(x * f, y * f, z * f); amp *= 0.5; f *= 2; }
    return e;                 // ~[0,1)
  };
}

/* Generate the starting planet: a Uint8Array of material ids for every cell. */
export function terrainFill(columns, seed) {
  const fbm = makeNoise(seed);
  const cells = new Uint8Array(columns.length * LAYERS);   // 0 = air everywhere by default
  const NF = 1.7, AMP = 8, HF = 2.3;                       // elevation freq, height amplitude, humidity freq
  for (const col of columns) {
    const c = col.center;
    let e = fbm(c.x * NF + 11.3, c.y * NF + 5.7, c.z * NF + 1.9);
    e = (e - 0.5) * 2;                                      // center to ~[-1,1]
    const lat = Math.abs(c.y);                              // 0 equator … 1 pole
    e -= Math.pow(lat, 3) * 0.45;                           // poles trend lower (sea/ice)
    let surf = Math.round(SEA_L + e * AMP);
    surf = Math.max(CORE_L + 1, Math.min(LAYERS - 1, surf));
    const base = col.id * LAYERS;

    // ---- climate model → surface biome ----
    const elevAbove = Math.max(0, surf - SEA_L);
    const temp = Math.max(0, Math.min(1, (1 - lat * 1.15) - elevAbove * 0.045));  // hot equator, cold poles/peaks
    const hum = fbm(c.x * HF - 7.1, c.y * HF + 19.3, c.z * HF - 3.7);             // 0..1 humidity field
    let topMat;
    if (surf <= SEA_L + 1) topMat = NUM.sand;              // shoreline / shallow seabed
    else if (elevAbove > 6) topMat = temp < 0.35 ? NUM.snow : NUM.rock;  // peaks: snowcap if cold, else rock
    else if (temp < 0.20) topMat = NUM.snow;              // frigid
    else if (temp < 0.40) topMat = NUM.tundra;            // cold
    else if (temp > 0.70 && hum < 0.40) topMat = NUM.sand;    // hot + dry → desert
    else if (temp > 0.50 && hum < 0.50) topMat = NUM.savanna; // warm + semi-dry
    else if (hum > 0.62) topMat = NUM.forest;            // wet → forest
    else topMat = NUM.grass;                             // temperate

    for (let L = 0; L <= surf; L++)
      cells[base + L] = L < surf - 3 ? NUM.stone : (L < surf ? NUM.dirt : topMat);
    if (surf < SEA_L) {                                    // flood low columns up to sea level
      for (let L = surf + 1; L <= SEA_L; L++) cells[base + L] = NUM.water;
    }
  }
  return cells;
}

/* ---- geometry assembly (face-culled, vertex-colored) ---- */
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _nrm = new THREE.Vector3(), _out = new THREE.Vector3();
const _ref = new THREE.Vector3();
const _top = new THREE.Color(), _sideC = new THREE.Color(), _sideBot = new THREE.Color();
const GRASS_NUM = NUM.grass, WATER_NUM = NUM.water, DIRT_COL = COLORS[NUM.dirt];   // grass shows dirt on its sides
const WALL_BASE_AO = 0.7;                                   // wall bottoms this fraction as bright as tops

// Per-vertex brightness from a hash of the (quantized) vertex position → a stable, seam-free
// "texture" speckle on every hexel. Shared positions hash the same, so faces meet without seams.
function vertShade(v) {
  const xi = (v.x * 11) | 0, yi = (v.y * 11) | 0, zi = (v.z * 11) | 0;
  let h = Math.imul(xi, 374761393) ^ Math.imul(yi, 668265263) ^ Math.imul(zi + 1, 1274126177);
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 15;
  return 0.84 + ((h >>> 0) % 1000) / 1000 * 0.16;          // 0.84 … 1.00
}
function pushVert(p, col, positions, colors) {
  const s = vertShade(p);
  positions.push(p.x, p.y, p.z);
  colors.push(col.r * s, col.g * s, col.b * s);
}

// Orient winding so the face points away from `ref` (the cell's center). This is correct for
// BOTH top faces (ref below → normal points up/out) and side walls (ref on the column axis →
// normal points sideways toward the neighbour/air). A radial-from-origin test fails for side
// walls (their normal is ~tangential), which made them randomly back-face-cull (see-through).
// per-vertex colours (for AO gradients); orients winding away from `ref` (the cell centre)
function pushTriC(p0, p1, p2, c0, c1, c2, ref, positions, colors) {
  _e1.subVectors(p1, p0); _e2.subVectors(p2, p0); _nrm.crossVectors(_e1, _e2);
  _out.copy(p0).add(p1).add(p2).multiplyScalar(1 / 3).sub(ref);
  let a = p0, b = p1, c = p2, ca = c0, cb = c1, cc = c2;
  if (_nrm.dot(_out) < 0) { b = p2; c = p1; cb = c2; cc = c1; }     // flip face + its vertex colours together
  pushVert(a, ca, positions, colors); pushVert(b, cb, positions, colors); pushVert(c, cc, positions, colors);
}
function pushTri(p0, p1, p2, col, ref, positions, colors) {
  pushTriC(p0, p1, p2, col, col, col, ref, positions, colors);
}

// emit one column's exposed faces; water faces go to the separate (transparent) buffer.
// Neighbor lookups span chunks via the global `cells`.
function emitColumn(col, cells, sPos, sCol, wPos, wCol) {
  const base = col.id * LAYERS, bnd = col.boundary, neigh = col.neighbors, n = bnd.length;
  for (let L = 0; L < LAYERS; L++) {
    const matn = cells[base + L];
    if (matn === AIR) continue;
    const positions = matn === WATER_NUM ? wPos : sPos;            // route water to its own mesh
    const colors = matn === WATER_NUM ? wCol : sCol;
    const rOut = radius(L + 1), rIn = radius(L);
    _ref.copy(col.center).multiplyScalar((rIn + rOut) / 2);        // this cell's center

    const topAir = (L + 1 >= LAYERS) || cells[base + L + 1] === AIR;
    if (topAir) {
      // AO: darken a top face that's hemmed in by taller neighbours (pit floor / wall base)
      let walled = 0;
      for (let k = 0; k < n; k++) { const nb = neigh[k]; if (nb >= 0 && cells[nb * LAYERS + L + 1] !== AIR) walled++; }
      const aoTop = 1 - (1 - AO_MIN) * (walled / n);
      _top.copy(COLORS[matn]).multiplyScalar(aoTop);
      const ctr = col.center.clone().multiplyScalar(rOut);
      for (let k = 0; k < n; k++)
        pushTri(ctr, bnd[k].clone().multiplyScalar(rOut), bnd[(k + 1) % n].clone().multiplyScalar(rOut), _top, _ref, positions, colors);
    }
    // grass blocks show brown (dirt) on their sides; else darken the material; AO fades wall bottoms
    _sideC.copy(matn === GRASS_NUM ? DIRT_COL : COLORS[matn]).multiplyScalar(0.82);
    _sideBot.copy(_sideC).multiplyScalar(WALL_BASE_AO);
    for (let k = 0; k < n; k++) {
      const nb = neigh[k];
      if (!(nb < 0 || cells[nb * LAYERS + L] === AIR)) continue;
      const aOut = bnd[k].clone().multiplyScalar(rOut), bOut = bnd[(k + 1) % n].clone().multiplyScalar(rOut);
      const aIn = bnd[k].clone().multiplyScalar(rIn), bIn = bnd[(k + 1) % n].clone().multiplyScalar(rIn);
      pushTriC(aOut, bOut, bIn, _sideC, _sideC, _sideBot, _ref, positions, colors);   // top verts bright, bottom dark
      pushTriC(aOut, bIn, aIn, _sideC, _sideBot, _sideBot, _ref, positions, colors);
    }
  }
}

/* Build the planet as `chunkCount` meshes (grouped by column.chunk). Returns a manager that
   can rebuild individual chunks cheaply when an edit changes only a few columns. */
export function buildPlanetChunks(columns, cells, chunkCount) {
  const groups = Array.from({ length: chunkCount }, () => []);
  for (const col of columns) groups[col.chunk].push(col);
  // Lambert (cheap, diffuse-only) instead of Standard PBR — the non-indexed geometry already
  // has per-face-constant normals, so it still reads as crisp flat-shaded facets but costs far
  // less per fragment (big win full-screen on integrated GPUs). Water is a second, translucent
  // material rendered after the opaque solids.
  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const waterMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: WATER_OPACITY, depthWrite: false });

  function fillPair(solidGeo, waterGeo, group) {
    const sP = [], sC = [], wP = [], wC = [];
    for (const col of group) emitColumn(col, cells, sP, sC, wP, wC);
    solidGeo.setAttribute('position', new THREE.Float32BufferAttribute(sP, 3));
    solidGeo.setAttribute('color', new THREE.Float32BufferAttribute(sC, 3));
    solidGeo.computeVertexNormals(); solidGeo.computeBoundingSphere();
    waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(wP, 3));
    waterGeo.setAttribute('color', new THREE.Float32BufferAttribute(wC, 3));
    waterGeo.computeVertexNormals(); waterGeo.computeBoundingSphere();
    return (sP.length + wP.length) / 9;
  }

  const entries = [];
  let triCount = 0;
  for (let i = 0; i < chunkCount; i++) {
    const solidGeo = new THREE.BufferGeometry(), waterGeo = new THREE.BufferGeometry();
    triCount += fillPair(solidGeo, waterGeo, groups[i]);
    const solidMesh = new THREE.Mesh(solidGeo, solidMat);
    solidMesh.castShadow = true; solidMesh.receiveShadow = true;
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.renderOrder = 1;                 // draw after opaque solids (transparent)
    entries.push({ group: groups[i], solidMesh, waterMesh });
  }

  return {
    meshes: entries.flatMap((e) => [e.solidMesh, e.waterMesh]),
    triCount,
    // rebuild only the given chunk ids (a Set or array) — used after an edit
    rebuild(chunkIds) {
      for (const id of chunkIds) {
        const e = entries[id];
        const oldS = e.solidMesh.geometry, oldW = e.waterMesh.geometry;
        const solidGeo = new THREE.BufferGeometry(), waterGeo = new THREE.BufferGeometry();
        fillPair(solidGeo, waterGeo, e.group);
        e.solidMesh.geometry = solidGeo; e.waterMesh.geometry = waterGeo;
        oldS.dispose(); oldW.dispose();
      }
    },
    dispose() {
      for (const e of entries) { e.solidMesh.geometry.dispose(); e.waterMesh.geometry.dispose(); }
      solidMat.dispose(); waterMat.dispose();
    },
  };
}

export { NUM as MATERIAL_NUM };
