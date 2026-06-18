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
import { LAYERS, CORE_L, SEA_L, MATERIALS, radius, AO_MIN, WATER_OPACITY,
  WATER_SHALLOW, WATER_DEEP, WATER_MAX_DEPTH, WATER_WAVE } from '../../data/planet.js';

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

/* Generate the starting planet: a Uint8Array of material ids for every cell.
   Two passes: (1) heightmap + biome + layered strata fill, recording each column's surface layer;
   (2) carve ENCLOSED caves using neighbour surface heights so a cavity never breaches a cliff face
   (the v11 see-through bug). */
export function terrainFill(columns, seed) {
  const fbm = makeNoise(seed);
  const cells = new Uint8Array(columns.length * LAYERS);   // 0 = air everywhere by default
  const surf = new Int16Array(columns.length);             // each column's surface layer (for the cave pass)
  const CF = 0.85, NF = 1.7, AMP = 8, HF = 2.3, CAVEF = 0.55;  // continent / detail / humidity / cave freqs

  // ---- pass 1: heightmap + climate biome + layered strata (grass/biome → dirt → rock → core) ----
  for (const col of columns) {
    const c = col.center;
    // continents: a broad low-frequency mask makes a few big landmasses, plus finer detail
    const cont = fbm(c.x * CF + 2.7, c.y * CF - 4.1, c.z * CF + 8.3);
    const detail = fbm(c.x * NF + 11.3, c.y * NF + 5.7, c.z * NF + 1.9);
    const lat = Math.abs(c.y);                              // 0 equator … 1 pole
    let e = (cont - 0.37) * 3.0 + (detail - 0.5) * 1.1;    // ~55% land (offset 0.52→0.37) + coastline ruggedness
    e -= Math.pow(lat, 3) * 0.30;                           // poles trend lower, but gentler (0.45→0.30)
    if (e < 0) e *= 1.8;                                    // steepen below sea level → real deep basins + shallow shelves
    let s = Math.round(SEA_L + e * AMP);
    s = Math.max(CORE_L + 1, Math.min(LAYERS - 1, s));
    surf[col.id] = s;
    const base = col.id * LAYERS;

    // climate model → surface biome (jittered to dither hard biome borders)
    const elevAbove = Math.max(0, s - SEA_L);
    const jit = (fbm(c.x * 9.0 - 1.3, c.y * 9.0 + 4.4, c.z * 9.0 - 8.8) - 0.5) * 0.12;
    const temp = Math.max(0, Math.min(1, (1 - lat * 1.15) - elevAbove * 0.045 + jit));
    const hum = Math.max(0, Math.min(1, fbm(c.x * HF - 7.1, c.y * HF + 19.3, c.z * HF - 3.7) + jit));
    let topMat;
    if (s <= SEA_L + 1) topMat = NUM.sand;                 // shoreline / shallow seabed
    else if (elevAbove > 6) topMat = temp < 0.35 ? NUM.snow : NUM.rock;  // peaks: snowcap if cold, else rock
    else if (temp < 0.20) topMat = NUM.snow;              // frigid
    else if (temp < 0.40) topMat = NUM.tundra;            // cold
    else if (temp > 0.70 && hum < 0.40) topMat = NUM.sand;    // hot + dry → desert
    else if (temp > 0.50 && hum < 0.50) topMat = NUM.savanna; // warm + semi-dry
    else if (hum > 0.62) topMat = NUM.forest;            // wet → forest
    else topMat = NUM.grass;                             // temperate

    // strata bands: surface biome on top, a dirt subsoil, the broad rock layer, then the solid core
    for (let L = 0; L <= s; L++) {
      cells[base + L] = L === s ? topMat
        : L >= s - 3 ? NUM.dirt
          : L <= CORE_L ? NUM.core
            : NUM.stone;
    }
    if (s < SEA_L) {                                       // flood low columns up to sea level
      for (let L = s + 1; L <= SEA_L; L++) cells[base + L] = NUM.water;
    }
  }

  // ---- pass 2: carve ENCLOSED caves (sparse 3D-noise pockets, no see-through) ----
  // Carve a subsurface cell to air only where EVERY neighbour column is taller than that layer, so
  // the cavity is walled on all sides — never exposed on a cliff face (the v11 see-through bug where
  // a carved cell met a lower neighbour). L ≤ s−2 keeps a ≥2-layer crust; L ≥ CORE_L+1 keeps the core
  // solid. Caves are discovered by digging; they never open a hole to space.
  for (const col of columns) {
    const c = col.center, base = col.id * LAYERS, s = surf[col.id], neigh = col.neighbors, nn = neigh.length;
    for (let L = CORE_L + 1; L <= s - 2; L++) {
      let enclosed = true;
      for (let k = 0; k < nn; k++) { const nb = neigh[k]; if (nb < 0 || surf[nb] <= L) { enclosed = false; break; } }
      if (!enclosed) continue;
      const r = (radius(L) + radius(L + 1)) / 2;
      if (fbm(c.x * r * CAVEF + 30.0, c.y * r * CAVEF - 12.0, c.z * r * CAVEF + 5.0) > 0.7) cells[base + L] = AIR;
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
const WATER_SHALLOW_C = new THREE.Color(WATER_SHALLOW), WATER_DEEP_C = new THREE.Color(WATER_DEEP);
const _wcol = new THREE.Color();                            // per-column depth-graded water tint

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
  // depth-graded water tint for this column (shallow shelf → deep basin), computed once
  let waterTop = -1, seabed = -1;
  for (let L = LAYERS - 1; L >= 0; L--) {
    const m = cells[base + L];
    if (m === AIR) continue;
    if (waterTop < 0 && m === WATER_NUM) waterTop = L;       // topmost water cell
    if (m !== WATER_NUM) { seabed = L; break; }              // topmost solid below the water
  }
  if (waterTop >= 0) _wcol.copy(WATER_SHALLOW_C).lerp(WATER_DEEP_C, Math.min(1, Math.max(0, waterTop - seabed) / WATER_MAX_DEPTH));
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
      _top.copy(matn === WATER_NUM ? _wcol : COLORS[matn]).multiplyScalar(aoTop);
      const ctr = col.center.clone().multiplyScalar(rOut);
      for (let k = 0; k < n; k++)
        pushTri(ctr, bnd[k].clone().multiplyScalar(rOut), bnd[(k + 1) % n].clone().multiplyScalar(rOut), _top, _ref, positions, colors);
    }
    // grass blocks show brown (dirt) on their sides; else darken the material; AO fades wall bottoms
    _sideC.copy(matn === WATER_NUM ? _wcol : (matn === GRASS_NUM ? DIRT_COL : COLORS[matn])).multiplyScalar(0.82);
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

/* Pure meshing for ONE chunk's columns → transferable Float32Arrays (no THREE.BufferGeometry, no DOM).
   Worker-safe: this is what the Web Worker (planet-worker.js) runs to mesh chunks off the main thread,
   and what the main thread reuses for local per-edit rebuilds. Neighbour lookups span the whole planet
   via `cells`, so `chunkColumns` is just the columns to EMIT; `cells` is the full grid. */
export function meshChunkArrays(chunkColumns, cells) {
  const sP = [], sC = [], wP = [], wC = [];
  for (const col of chunkColumns) emitColumn(col, cells, sP, sC, wP, wC);
  return {
    sPos: new Float32Array(sP), sCol: new Float32Array(sC),
    wPos: new Float32Array(wP), wCol: new Float32Array(wC),
  };
}

/* Build the planet as `chunkCount` meshes (grouped by column.chunk). All meshes are created EMPTY
   up front (add them to the scene immediately) and filled INCREMENTALLY by buildNext() so a 100k-tile
   planet doesn't freeze the tab — the caller drives buildNext() across frames behind a progress
   overlay. Returns a manager that also rebuilds individual chunks cheaply when an edit changes only a
   few columns. (Some chunk buckets fall outside their icosa face and stay empty — handled.) */
export function buildPlanetChunks(columns, cells, chunkCount, sunDir) {
  const groups = Array.from({ length: chunkCount }, () => []);
  for (const col of columns) groups[col.chunk].push(col);
  // Lambert (cheap, diffuse-only) instead of Standard PBR — the non-indexed geometry already
  // has per-face-constant normals, so it still reads as crisp flat-shaded facets but costs far
  // less per fragment (big win full-screen on integrated GPUs).
  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });

  // Water is a second, translucent pass with its OWN shader: per-vertex depth tint (vColor) +
  // a gentle radial wave bob + fresnel sheen + a sun-specular glint that tracks the day/night sun.
  // Uniforms share earth.js's live `sunDir`; the caller bumps uTime each frame. (ShaderMaterial
  // auto-provides position/normal/matrices/cameraPosition; we declare the color attribute ourselves.)
  const waterUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: sunDir || new THREE.Vector3(1, 0, 0) },
    uWave: { value: WATER_WAVE },
    uOpacity: { value: WATER_OPACITY },
  };
  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec3 color; uniform float uTime, uWave;
      varying vec3 vColor, vWorld, vNormalW;
      void main(){
        vColor = color;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 nrm = normalize(wp.xyz);
        float w = sin(wp.x * 1.5 + uTime) + sin((wp.z + wp.y) * 1.5 + uTime * 1.3);
        wp.xyz += nrm * (uWave * w * 0.5);
        vWorld = wp.xyz; vNormalW = nrm;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uSunDir; uniform float uOpacity;
      varying vec3 vColor, vWorld, vNormalW;
      void main(){
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 sun = normalize(uSunDir);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);          // grazing sheen
        float sunEl = clamp(dot(N, sun) * 1.2 + 0.15, 0.0, 1.0);   // day/night dimming
        vec3 R = reflect(-sun, N);
        float spec = pow(max(dot(R, V), 0.0), 60.0);               // sharp sun glint
        vec3 col = vColor * (0.5 + 0.5 * sunEl);
        col += vec3(0.6, 0.75, 0.9) * fres * 0.5;                  // cool fresnel
        col += vec3(1.0, 0.96, 0.85) * spec * sunEl;               // warm sparkle (daylight only)
        gl_FragColor = vec4(col, clamp(uOpacity + fres * 0.3, 0.0, 1.0));
      }`,
  });

  // disable frustum culling on empty geometry (no vertices → boundingSphere would be NaN and warn)
  const setCull = (mesh) => { mesh.frustumCulled = (mesh.geometry.getAttribute('position')?.count || 0) > 0; };

  const entries = [];
  for (let i = 0; i < chunkCount; i++) {
    const solidMesh = new THREE.Mesh(new THREE.BufferGeometry(), solidMat);
    solidMesh.castShadow = true; solidMesh.receiveShadow = true; solidMesh.frustumCulled = false;
    const waterMesh = new THREE.Mesh(new THREE.BufferGeometry(), waterMat);
    waterMesh.renderOrder = 1; waterMesh.frustumCulled = false;   // draw after opaque solids (transparent)
    entries.push({ group: groups[i], solidMesh, waterMesh, tris: 0 });
  }

  let next = 0, triCount = 0;
  // swap a chunk entry's geometry to freshly-meshed buffers (from the worker, or meshed locally)
  function applyToEntry(e, a) {
    const sg = new THREE.BufferGeometry(), wg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(a.sPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(a.sCol, 3));
    wg.setAttribute('position', new THREE.BufferAttribute(a.wPos, 3));
    wg.setAttribute('color', new THREE.BufferAttribute(a.wCol, 3));
    if (a.sPos.length) { sg.computeVertexNormals(); sg.computeBoundingSphere(); }
    if (a.wPos.length) { wg.computeVertexNormals(); wg.computeBoundingSphere(); }
    const oldS = e.solidMesh.geometry, oldW = e.waterMesh.geometry;
    e.solidMesh.geometry = sg; e.waterMesh.geometry = wg;
    setCull(e.solidMesh); setCull(e.waterMesh);
    oldS.dispose(); oldW.dispose();
    const t = (a.sPos.length + a.wPos.length) / 9;
    triCount += t - e.tris; e.tris = t;
  }

  return {
    meshes: entries.flatMap((e) => [e.solidMesh, e.waterMesh]),
    waterUniforms,                               // caller bumps uTime each frame (uSunDir is shared/live)
    get triCount() { return triCount; },
    // drop a worker-meshed chunk's buffers into its meshes (the streaming path)
    applyChunk(chunkId, arrays) { applyToEntry(entries[chunkId], arrays); },
    // local fallback (no Worker): mesh un-built chunks until ~timeBudgetMs elapsed; {done,built,total}
    buildNext(timeBudgetMs) {
      const t0 = performance.now();
      while (next < chunkCount) {
        const e = entries[next++];
        applyToEntry(e, meshChunkArrays(e.group, cells));
        if (performance.now() - t0 >= timeBudgetMs) break;
      }
      return { done: next >= chunkCount, built: next, total: chunkCount };
    },
    // rebuild only the given chunk ids (a Set or array), meshing LOCALLY — the per-edit path
    rebuild(chunkIds) {
      for (const id of chunkIds) applyToEntry(entries[id], meshChunkArrays(entries[id].group, cells));
    },
    dispose() {
      for (const e of entries) { e.solidMesh.geometry.dispose(); e.waterMesh.geometry.dispose(); }
      solidMat.dispose(); waterMat.dispose();
    },
  };
}

export { NUM as MATERIAL_NUM };
