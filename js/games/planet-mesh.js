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
import { LAYERS, CORE_L, SEA_L, MATERIALS, radius, AO_MIN,
  WATER_SHALLOW, WATER_DEEP, WATER_MAX_DEPTH, WATER_WAVE,
  SHAPE_FULL, SHAPE_MASK, SHAPE_SLAB_LO, SHAPE_SLAB_HI, SHAPE_FENCE, SHAPE_PANE, SHAPE_STAIRS, ROT_SHIFT, TH } from '../../data/planet.js';
import { buildTextureAtlas, tileIndex } from './texture-atlas.js';

// numeric material ids: 0 = air, 1..N = MATERIALS[i-1]
export const AIR = 0;
const NUM = {};               // material string id -> numeric id
MATERIALS.forEach((m, i) => { NUM[m.id] = i + 1; });
const COLORS = [null, ...MATERIALS.map((m) => new THREE.Color(m.color))];   // index by numeric id

export const cellIndex = (colId, L) => colId * LAYERS + L;

// terrainFill side-channel: the most recent FULL-RES generation records its longest river here so the
// caller (worker / main fallback) can hand it to earth.js as a named landmark (P1c). { colId, length } | null.
export const terrainMeta = { river: null };

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
  // mountains (E4): tall ridged ranges in belts on already-high land. MF = low-freq belt mask,
  // RF = high-freq ridge detail, MTN_AMP = peak height in layers (tuned so the rare tallest peak nears
  // LAYERS−1 ≈ 127), MTN_E = land-elevation threshold below which no mountains grow (plains stay flat).
  const MF = 0.55, RF = 3.1, MTN_AMP = 170, MTN_E = 0.35;
  const GF = 0.42, RUF = 1.05, ROUGH_AMP = 7;    // geology / ruggedness freqs + crag amplitude
  // a region's bedrock from a low-freq geology sample → neighbouring ranges are visibly different rock
  const bedrockOf = (g) => g < 0.34 ? NUM.stone : g < 0.52 ? NUM.granite : g < 0.68 ? NUM.slate : g < 0.84 ? NUM.basalt : NUM.sandstone;

  // ---- pass 1: heightmap + 3D-noise crags + climate biome + varied rock surfacing + banded strata ----
  for (const col of columns) {
    const c = col.center;
    // continents: the same low-freq mask as before, but DOMAIN-WARPED so coastlines bend organically
    // instead of following the noise grid. The warp only RELOCATES samples (same value distribution), so
    // land fraction, mountain range and gradual slopes are preserved — verified A/B vs the un-warped terrain.
    const wf = 0.55, wA = 0.4;
    const wx = c.x + (fbm(c.x * wf + 30.0, c.y * wf + 10.0, c.z * wf - 20.0) - 0.5) * wA;
    const wy = c.y + (fbm(c.x * wf - 15.0, c.y * wf + 25.0, c.z * wf + 5.0) - 0.5) * wA;
    const wz = c.z + (fbm(c.x * wf + 8.0, c.y * wf - 12.0, c.z * wf + 40.0) - 0.5) * wA;
    const cont = fbm(wx * CF + 2.7, wy * CF - 4.1, wz * CF + 8.3);
    const detail = fbm(c.x * NF + 11.3, c.y * NF + 5.7, c.z * NF + 1.9);
    const lat = Math.abs(c.y);                              // 0 equator … 1 pole
    let e = (cont - 0.37) * 3.0 + (detail - 0.5) * 1.1;    // ~55% land + coastline ruggedness
    e -= Math.pow(lat, 3) * 0.30;                           // poles trend lower, but gentler
    // continental shelf: broad gentle shallows near shore that still deepen to dark basins offshore.
    // The max(0.13,…) floor keeps every below-sea column at least ~1 layer deep so the coastline (ocean
    // extent) is unchanged; the pow shape spends most of the shelf shallow but reaches full depth by e≈−0.5.
    if (e < 0) e = -Math.max(0.13, Math.pow(-e, 1.55) * 2.5);
    let s = Math.round(SEA_L + e * AMP);
    if (e > MTN_E) {                                        // mountain belts: tall ridged ranges only on high land (plains untouched)
      const mf = fbm(c.x * MF - 5.2, c.y * MF + 13.7, c.z * MF - 2.4);
      const mt = Math.max(0, Math.min(1, (mf - 0.46) / 0.18)); const mask = 0.4 + 0.6 * mt * mt * (3 - 2 * mt);   // 0.4..1
      const ridge = 1 - Math.abs(2 * fbm(c.x * RF + 4.6, c.y * RF - 8.1, c.z * RF + 17.2) - 1);       // sharp ridgelines
      const land = Math.max(0, Math.min(1, (e - MTN_E) / 0.55));
      s += Math.round(mask * ridge * land * MTN_AMP);
    }
    // 3D-noise ruggedness: crags/cliffs that grow with elevation (plains stay smooth)
    const rough = (fbm(c.x * RUF + 21.0, c.y * RUF - 7.5, c.z * RUF + 3.3) - 0.5) * 2;   // −1..1
    s += Math.round(rough * Math.min(1, Math.max(0, s - SEA_L) / 30) * ROUGH_AMP);
    s = Math.max(CORE_L + 1, Math.min(LAYERS - 1, s));
    surf[col.id] = s;
    const base = col.id * LAYERS;

    // climate model → surface biome (jittered to dither hard biome borders)
    const elevAbove = Math.max(0, s - SEA_L);
    const jit = (fbm(c.x * 9.0 - 1.3, c.y * 9.0 + 4.4, c.z * 9.0 - 8.8) - 0.5) * 0.12;
    const temp = Math.max(0, Math.min(1, (1 - lat * 1.15) - elevAbove * 0.045 + jit));
    const hum = Math.max(0, Math.min(1, fbm(c.x * HF - 7.1, c.y * HF + 19.3, c.z * HF - 3.7) + jit));
    const geo = fbm(c.x * GF + 40.0, c.y * GF - 15.0, c.z * GF + 9.0);   // region geology → bedrock type
    const bedrock = bedrockOf(geo);

    let topMat;
    if (s <= SEA_L + 1) topMat = NUM.sand;                 // shoreline / shallow seabed
    else if (elevAbove > 22) {                             // exposed mountain: scree → varied bedrock → snow → ice
      const snowLine = 48 + temp * 46;                     // snow line rises with warmth (cold poles snow low)
      if (elevAbove > snowLine + 16) topMat = NUM.ice;     // extreme high → glacier ice
      else if (elevAbove > snowLine) topMat = NUM.snow;    // cold high → snow
      else topMat = elevAbove < 34 ? NUM.scree : bedrock;  // lower slope scree → exposed region bedrock higher
    }
    else if (temp < 0.18) topMat = NUM.snow;               // frigid lowland
    else if (temp < 0.34) topMat = hum > 0.5 ? NUM.taiga : NUM.tundra;   // cold: wet boreal vs dry tundra
    else if (temp > 0.72 && hum < 0.26) topMat = NUM.sand;     // very hot + dry → desert
    else if (temp > 0.58 && hum < 0.42 && elevAbove > 3) topMat = NUM.redrock;  // hot dry uplands → mesa / badlands
    else if (temp > 0.62 && hum > 0.60) topMat = NUM.jungle;   // hot + wet → jungle (before forest)
    else if (temp > 0.5 && hum < 0.5) topMat = NUM.savanna;    // warm + semi-dry
    else if (hum > 0.58) topMat = NUM.forest;            // wet → forest
    else topMat = NUM.grass;                              // temperate

    // strata: biome top, dirt subsoil, then near-horizontal BANDED bedrock, core. Bands cycle
    // bedrock → stone → contrast every ~1.6 layers, phase-shifted per region (cheap: no per-cell noise).
    const band2 = bedrock === NUM.stone ? NUM.granite : NUM.stone;
    const strataPhase = (geo + detail) * 6.0;
    for (let L = 0; L <= s; L++) {
      if (L === s) cells[base + L] = topMat;
      else if (L >= s - 2) cells[base + L] = NUM.dirt;
      else if (L <= CORE_L) cells[base + L] = NUM.core;
      else {
        const bi = ((Math.floor(L * 0.62 + strataPhase) % 3) + 3) % 3;
        cells[base + L] = bi === 0 ? bedrock : bi === 1 ? NUM.stone : band2;
      }
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

  // ---- pass 3: structures — taller, shaped trees typed by biome (deterministic per seed) ----
  // Each tree = a tall `wood` trunk + a MULTI-LAYER canopy whose per-layer radius gives a real
  // silhouette: rounded broadleaf, conical pine, high-canopy jungle giant, flat-topped acacia. Canopies
  // spill into neighbour columns' AIR via a small k-ring BFS (radius ≤2); terrain clips them naturally
  // (air-only writes). Trunks stay solid (walk obstacle + mineable); canopies sit above head height.
  const WOOD = NUM.wood, LEAF = NUM.leaves, PINE = NUM.pineleaf;
  const thash = (i) => { let h = Math.imul((seed ^ i) >>> 0, 2246822519); h ^= h >>> 13; h = Math.imul(h, 3266489917); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  // columns within ring radius R of `col` → Map(colId → ring distance 0..R) (BFS over neighbours)
  function ringDist(col, R) {
    const seen = new Map([[col.id, 0]]); let frontier = [col];
    for (let d = 1; d <= R; d++) {
      const next = [];
      for (const cc of frontier) for (const nb of cc.neighbors) if (nb >= 0 && !seen.has(nb)) { seen.set(nb, d); next.push(columns[nb]); }
      frontier = next;
    }
    return seen;
  }
  // fill one leaf layer at absolute L over columns within ring radius r (air-only)
  function leafLayer(rings, L, r, mat) {
    if (L < 0 || L >= LAYERS) return;
    for (const [cid, d] of rings) if (d <= r) { const i = cid * LAYERS + L; if (cells[i] === AIR) cells[i] = mat; }
  }
  for (const col of columns) {
    const s = surf[col.id];
    if (s <= SEA_L) continue;                              // land above sea only
    const base = col.id * LAYERS, topM = cells[base + s];
    let type, density;
    if (topM === NUM.forest) { type = 'broadleaf'; density = 0.10; }       // spaced so you can walk through
    else if (topM === NUM.grass) { type = 'broadleaf'; density = 0.05; }   // scattered
    else if (topM === NUM.jungle) { type = 'jungle'; density = 0.13; }
    else if (topM === NUM.taiga) { type = 'pine'; density = 0.15; }
    else if (topM === NUM.savanna) { type = 'acacia'; density = 0.04; }    // sparse
    else continue;                                         // none on sand/snow/tundra/mesa/rock/peaks
    if (thash(col.id) > density) continue;
    const rnd = thash(col.id + 7919);
    let trunkH;
    if (type === 'pine') trunkH = 9 + ((rnd * 6) | 0);        // 9..14 tall conifer
    else if (type === 'jungle') trunkH = 12 + ((rnd * 7) | 0); // 12..18 giant
    else if (type === 'acacia') trunkH = 8 + ((rnd * 5) | 0);  // 8..12 bare-trunk umbrella
    else trunkH = 6 + ((rnd * 5) | 0);                         // 6..10 broadleaf
    const top = s + trunkH;
    for (let L = s + 1; L <= top && L < LAYERS; L++) if (cells[base + L] === AIR) cells[base + L] = WOOD;
    const rings = ringDist(col, 2);
    if (type === 'pine') {                                   // conical: wide-low → point-top, leaves start low
      for (let L = s + 4; L <= top + 1; L++) {
        const t = (L - (s + 4)) / Math.max(1, (top + 1) - (s + 4));    // 0 bottom → 1 top
        leafLayer(rings, L, Math.round(2 * (1 - t)), PINE);           // radius 2 → 0
      }
    } else if (type === 'jungle') {                         // tall bare trunk, broad crown only at the top
      for (let L = top - 3; L <= top + 1; L++) leafLayer(rings, L, L >= top ? 1 : 2, LEAF);
    } else if (type === 'acacia') {                         // flat umbrella on a bare trunk
      leafLayer(rings, top, 2, LEAF); leafLayer(rings, top + 1, 1, LEAF);
    } else {                                                // broadleaf: rounded blob
      leafLayer(rings, top - 2, 1, LEAF); leafLayer(rings, top - 1, 2, LEAF);
      leafLayer(rings, top, 2, LEAF); leafLayer(rings, top + 1, 1, LEAF); leafLayer(rings, top + 2, 1, LEAF);
    }
  }

  // (rivers removed — the user found them annoying; `terrainMeta.river` stays null so the landmark/compass
  // plumbing simply never registers a "Long River". The drainage-hydrology pass lives in git history if wanted.)
  terrainMeta.river = null;
  return cells;
}

/* ---- geometry assembly (face-culled, vertex-colored) ---- */
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _nrm = new THREE.Vector3(), _out = new THREE.Vector3();
const _ref = new THREE.Vector3(), _capRef = new THREE.Vector3();
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
// per-vertex tile id for the texture atlas, routed via module state so the push helpers' signatures don't
// change: meshChunkArrays sets _solidCol/_solidTile to the SOLID buffers, emitColumn sets _curTile per cell.
let _solidCol = null, _solidTile = null, _curTile = 0;
function pushVert(p, col, positions, colors) {
  const s = vertShade(p);
  positions.push(p.x, p.y, p.z);
  colors.push(col.r * s, col.g * s, col.b * s);
  if (colors === _solidCol && _solidTile) _solidTile.push(_curTile);   // only solid faces carry a tile
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

// ---- mesh-block geometry (Phase 2): custom shapes baked straight into the chunk buffer (no extra
// draw calls) — fences, and later stairs/torches. Build in WORLD space: radial = "up", tangential = sideways.
const _mAx = new THREE.Vector3(), _mUp = new THREE.Vector3(), _mSide = new THREE.Vector3(), _mCtr = new THREE.Vector3();
const _hw = new THREE.Vector3(), _hu = new THREE.Vector3();
const _fA = new THREE.Vector3(), _fB = new THREE.Vector3(), _fUp = new THREE.Vector3();   // fence-branch temps (kept clear of emitBar's)
// a solid box (a "bar") between end-centres a→b, cross-section 2·halfW (horizontal) × 2·halfUp (along `up`)
function emitBar(a, b, up, halfW, halfUp, col, positions, colors) {
  _mAx.subVectors(b, a); const len = _mAx.length(); if (len < 1e-6) return; _mAx.multiplyScalar(1 / len);
  _mUp.copy(up).normalize(); _mSide.crossVectors(_mAx, _mUp); if (_mSide.lengthSq() < 1e-9) return; _mSide.normalize();
  _hw.copy(_mSide).multiplyScalar(halfW); _hu.copy(_mUp).multiplyScalar(halfUp);
  const c = [a.clone().sub(_hw).sub(_hu), a.clone().add(_hw).sub(_hu), a.clone().add(_hw).add(_hu), a.clone().sub(_hw).add(_hu),
    b.clone().sub(_hw).sub(_hu), b.clone().add(_hw).sub(_hu), b.clone().add(_hw).add(_hu), b.clone().sub(_hw).add(_hu)];
  _mCtr.copy(a).add(b).multiplyScalar(0.5);
  const q = (i, j, k, l) => { pushTriC(c[i], c[j], c[k], col, col, col, _mCtr, positions, colors); pushTriC(c[i], c[k], c[l], col, col, col, _mCtr, positions, colors); };
  q(0, 1, 2, 3); q(4, 5, 6, 7); q(0, 1, 5, 4); q(1, 2, 6, 5); q(2, 3, 7, 6); q(3, 0, 4, 7);
}
// a full hexagonal band [rLo,rHi] at the column: top cap (at rHi) + all side walls. No culling — used for
// discrete mesh blocks (e.g. a stair's bottom slab). `B` are the cell's unit boundary verts about centre C.
function emitHexBand(C, B, n, rLo, rHi, colTop, colSide, positions, colors) {
  const ctrTop = C.clone().multiplyScalar(rHi), ref = C.clone().multiplyScalar((rLo + rHi) / 2);
  for (let k = 0; k < n; k++) { const k2 = (k + 1) % n;
    pushTriC(ctrTop, B[k].clone().multiplyScalar(rHi), B[k2].clone().multiplyScalar(rHi), colTop, colTop, colTop, ref, positions, colors);
    const aHi = B[k].clone().multiplyScalar(rHi), bHi = B[k2].clone().multiplyScalar(rHi), aLo = B[k].clone().multiplyScalar(rLo), bLo = B[k2].clone().multiplyScalar(rLo);
    pushTriC(aHi, bHi, bLo, colSide, colSide, colSide, ref, positions, colors);
    pushTriC(aHi, bLo, aLo, colSide, colSide, colSide, ref, positions, colors);
  }
}
// a tapered hexagonal post at the column centre: footprint = the cell hexagon shrunk toward C (scale sLo
// at the base, sHi at the top → a slight cap flare), spanning radii [rLo,rHi]. Top cap + side walls.
function emitPost(C, B, n, rLo, rHi, sLo, sHi, colTop, colSide, positions, colors) {
  const ring = (r, s) => { const a = new Array(n); for (let k = 0; k < n; k++) a[k] = B[k].clone().sub(C).multiplyScalar(s).add(C).multiplyScalar(r); return a; };
  const lo = ring(rLo, sLo), hi = ring(rHi, sHi);
  const ctrTop = C.clone().multiplyScalar(rHi), refMid = C.clone().multiplyScalar((rLo + rHi) / 2);
  for (let k = 0; k < n; k++) pushTriC(ctrTop, hi[k], hi[(k + 1) % n], colTop, colTop, colTop, refMid, positions, colors);   // top cap
  for (let k = 0; k < n; k++) { const k2 = (k + 1) % n;                                                                     // side walls
    pushTriC(lo[k], lo[k2], hi[k2], colSide, colSide, colSide, refMid, positions, colors);
    pushTriC(lo[k], hi[k2], hi[k], colSide, colSide, colSide, refMid, positions, colors);
  }
}

// emit one column's exposed faces; water faces go to the separate (transparent) buffer.
// Reads material via the VoxelStore (`s`); neighbour lookups span chunks (the store is the whole planet).
// Bounded by the column's top (air above it emits nothing) so meshing visits ~tens of layers, not 128.
function emitColumn(col, s, sPos, sCol, wPos, wCol) {
  const id = col.id, bnd = col.boundary, neigh = col.neighbors, n = bnd.length;
  const top = s.getTop(id);
  if (top < 0) return;
  // depth-graded water tint for this column (shallow shelf → deep basin), computed once
  let waterTop = -1, seabed = -1;
  for (let L = top; L >= 0; L--) {
    const m = s.getMat(id, L);
    if (m === AIR) continue;
    if (waterTop < 0 && m === WATER_NUM) waterTop = L;       // topmost water cell
    if (m !== WATER_NUM) { seabed = L; break; }              // topmost solid below the water
  }
  if (waterTop >= 0) _wcol.copy(WATER_SHALLOW_C).lerp(WATER_DEEP_C, Math.min(1, Math.max(0, waterTop - seabed) / WATER_MAX_DEPTH));
  const hasStates = s.state && s.state.size > 0;                  // skip per-cell state lookups on un-edited worlds
  // does the block at (cid,cl) OPAQUELY cover the TOP of the cell directly below it? full blocks and bottom
  // slabs do; air, WATER (transparent), top slabs and mesh blocks (fences) don't — so the surface shows
  // beneath them. Water being non-covering is what lets the SEABED render through clear water (no see-through).
  const coversBelow = (cid, cl) => { const m = s.getMat(cid, cl); if (m === AIR || m === WATER_NUM) return false; const sh = hasStates ? (s.getState(cid, cl) & SHAPE_MASK) : 0; return sh === SHAPE_FULL || sh === SHAPE_SLAB_LO; };
  for (let L = 0; L <= top; L++) {
    const matn = s.getMat(id, L);
    if (matn === AIR) continue;
    const positions = matn === WATER_NUM ? wPos : sPos;            // route water to its own mesh
    const colors = matn === WATER_NUM ? wCol : sCol;
    _curTile = tileIndex(matn);                                    // texture-atlas tile for this cell's solid faces
    // block shape (Phase 2): full hexel, half-height slab, or a custom mesh block. Water is never shaped.
    const st = (hasStates && matn !== WATER_NUM) ? s.getState(id, L) : 0;
    const shape = st & SHAPE_MASK;

    // PANE (oriented mesh block): a thin full-height wall across the cell along the rotation's diameter.
    if (shape === SHAPE_PANE) {
      const rot = (st >> ROT_SHIFT) & 7, rIn = radius(L), rOut = radius(L + 1), rMid = (rIn + rOut) / 2, o = (rot + (n >> 1)) % n;
      _fUp.copy(bnd[rot % n]).add(bnd[(rot + 1) % n]).normalize(); _fA.copy(_fUp).multiplyScalar(rMid);       // one end (edge `rot`)
      _fUp.copy(bnd[o]).add(bnd[(o + 1) % n]).normalize(); _fB.copy(_fUp).multiplyScalar(rMid);               // other end (opposite edge)
      _sideC.copy(matn === GRASS_NUM ? DIRT_COL : COLORS[matn]);
      emitBar(_fA, _fB, col.center, 0.018, (rOut - rIn) / 2, _sideC, positions, colors);
      continue;
    }

    // STAIRS (oriented mesh block): a full bottom slab + the 3 back sectors raised to a top step + riser.
    if (shape === SHAPE_STAIRS) {
      const rot = (st >> ROT_SHIFT) & 7, rIn = radius(L), rOut = radius(L + 1), rMid = (rIn + rOut) / 2, C = col.center;
      _top.copy(COLORS[matn]); _sideC.copy(matn === GRASS_NUM ? DIRT_COL : COLORS[matn]).multiplyScalar(0.82);
      emitHexBand(C, bnd, n, rIn, rMid, _top, _sideC, positions, colors);                  // bottom slab (full)
      const refUp = C.clone().multiplyScalar((rMid + rOut) / 2);
      _fUp.copy(bnd[rot % n]).add(bnd[(rot + 1) % n]).normalize();                          // facing direction
      _capRef.copy(C).addScaledVector(_fUp, 0.5).multiplyScalar((rMid + rOut) / 2);          // a point inside the raised half (riser ref)
      for (const k of [(rot + n - 1) % n, rot % n, (rot + 1) % n]) {                        // the 3 back sectors → top step
        const k2 = (k + 1) % n;
        pushTriC(C.clone().multiplyScalar(rOut), bnd[k].clone().multiplyScalar(rOut), bnd[k2].clone().multiplyScalar(rOut), _top, _top, _top, refUp, positions, colors);   // top cap
        const aHi = bnd[k].clone().multiplyScalar(rOut), bHi = bnd[k2].clone().multiplyScalar(rOut), aLo = bnd[k].clone().multiplyScalar(rMid), bLo = bnd[k2].clone().multiplyScalar(rMid);
        pushTriC(aHi, bHi, bLo, _sideC, _sideC, _sideC, refUp, positions, colors);          // outer side wall
        pushTriC(aHi, bLo, aLo, _sideC, _sideC, _sideC, refUp, positions, colors);
      }
      for (const seam of [(rot + n - 1) % n, (rot + 2) % n]) {                              // 2 radial riser faces (front of the step)
        const oHi = bnd[seam].clone().multiplyScalar(rOut), cHi = C.clone().multiplyScalar(rOut), oLo = bnd[seam].clone().multiplyScalar(rMid), cLo = C.clone().multiplyScalar(rMid);
        pushTriC(cHi, oHi, oLo, _sideC, _sideC, _sideC, _capRef, positions, colors);
        pushTriC(cHi, oLo, cLo, _sideC, _sideC, _sideC, _capRef, positions, colors);
      }
      continue;
    }

    // FENCE (mesh block): a centre post + rails auto-connecting to each adjacent solid/fence cell.
    if (shape === SHAPE_FENCE) {
      const C = col.center, rBase = radius(L), POSTH = 1.5 * TH;
      _top.copy(COLORS[matn]);                                       // cap colour
      _sideC.copy(matn === GRASS_NUM ? DIRT_COL : COLORS[matn]).multiplyScalar(0.82);   // post/rail colour
      emitPost(C, bnd, n, rBase, rBase + POSTH, 0.18, 0.26, _top, _sideC, positions, colors);
      const rTopRail = rBase + POSTH * 0.84, rMidRail = rBase + POSTH * 0.44;
      for (let k = 0; k < n; k++) {
        const nb = neigh[k]; if (nb < 0) continue;
        const nm = s.getMat(nb, L); if (nm === AIR || nm === WATER_NUM) continue;       // connect to solid / fence neighbours
        _fUp.copy(bnd[k]).add(bnd[(k + 1) % n]).normalize();                            // edge-midpoint direction (toward nb)
        for (const rr of [rTopRail, rMidRail]) {
          _fA.copy(C).multiplyScalar(rr); _fB.copy(_fUp).multiplyScalar(rr);            // post centre → edge midpoint, at this height
          emitBar(_fA, _fB, C, 0.012, 0.02, _sideC, positions, colors);
        }
      }
      continue;                                                      // a fence cell emits only its mesh, no prism
    }

    const rOutF = radius(L + 1), rInF = radius(L), rMid = (rInF + rOutF) / 2;
    const rHi = shape === SHAPE_SLAB_LO ? rMid : rOutF;            // the band this cell's solid actually fills
    const rLo = shape === SHAPE_SLAB_HI ? rMid : rInF;
    _ref.copy(col.center).multiplyScalar((rLo + rHi) / 2);         // ref at the band mid → side-wall winding

    // TOP cap (faces up): a full / top-slab cell shows it when the cell above is open; a bottom slab's cap
    // at rMid is always exposed. A WATER cell only emits its top at the SURFACE (air above) — never between
    // submerged layers; a SOLID cell shows its top unless OPAQUELY covered (so the seabed shows under water).
    const aboveOpen = matn === WATER_NUM
      ? (L + 1 >= LAYERS || s.getMat(id, L + 1) === AIR)
      : (L + 1 >= LAYERS || !coversBelow(id, L + 1));
    if (shape === SHAPE_SLAB_LO || aboveOpen) {
      let walled = 0;   // AO: count neighbours that rise above this cell (water doesn't wall — keeps seabeds bright)
      if (shape === 0) for (let k = 0; k < n; k++) { const nb = neigh[k]; if (nb >= 0 && L + 1 < LAYERS) { const mn = s.getMat(nb, L + 1); if (mn !== AIR && mn !== WATER_NUM) walled++; } }
      const aoTop = 1 - (1 - AO_MIN) * (walled / n);
      if (matn === WATER_NUM) _top.copy(_wcol);                         // pure depth tint → shader recovers depth for its alpha
      else _top.copy(COLORS[matn]).multiplyScalar(aoTop);
      const ctr = col.center.clone().multiplyScalar(rHi);
      for (let k = 0; k < n; k++)
        pushTri(ctr, bnd[k].clone().multiplyScalar(rHi), bnd[(k + 1) % n].clone().multiplyScalar(rHi), _top, _ref, positions, colors);
    }
    // BOTTOM cap (faces down): a top slab floats over the cell's lower-half gap, so show its underside.
    if (shape === SHAPE_SLAB_HI) {
      _top.copy(COLORS[matn]).multiplyScalar(WALL_BASE_AO);
      const ctr = col.center.clone().multiplyScalar(rLo);
      _capRef.copy(col.center).multiplyScalar(rHi);                     // ref ABOVE the cap → normal points down
      for (let k = 0; k < n; k++)
        pushTri(ctr, bnd[k].clone().multiplyScalar(rLo), bnd[(k + 1) % n].clone().multiplyScalar(rLo), _top, _capRef, positions, colors);
    }
    // SIDE walls over the occupied band. grass shows brown (dirt) sides; water stays PURE depth tint
    // (no AO/gradient) so the shader can recover depth for its alpha.
    if (matn === WATER_NUM) { _sideC.copy(_wcol); _sideBot.copy(_wcol); }
    else {
      _sideC.copy(matn === GRASS_NUM ? DIRT_COL : COLORS[matn]).multiplyScalar(0.82);
      _sideBot.copy(_sideC).multiplyScalar(WALL_BASE_AO);
    }
    for (let k = 0; k < n; k++) {
      const nb = neigh[k];
      if (!(nb < 0 || s.getMat(nb, L) === AIR)) continue;
      const aOut = bnd[k].clone().multiplyScalar(rHi), bOut = bnd[(k + 1) % n].clone().multiplyScalar(rHi);
      const aIn = bnd[k].clone().multiplyScalar(rLo), bIn = bnd[(k + 1) % n].clone().multiplyScalar(rLo);
      pushTriC(aOut, bOut, bIn, _sideC, _sideC, _sideBot, _ref, positions, colors);   // top verts bright, bottom dark
      pushTriC(aOut, bIn, aIn, _sideC, _sideBot, _sideBot, _ref, positions, colors);
    }
  }
}

/* Pure meshing for ONE chunk's columns → transferable Float32Arrays (no THREE.BufferGeometry, no DOM).
   Runs on the MAIN thread for on-demand fine-chunk (re)meshing (streaming activation + per-edit rebuild).
   Neighbour lookups span the whole planet via the VoxelStore `store`, so `chunkColumns` is just the
   columns to EMIT; `store` is the full grid. */
export function meshChunkArrays(chunkColumns, store) {
  const sP = [], sC = [], wP = [], wC = [], sT = [];
  _solidCol = sC; _solidTile = sT;                                 // route per-vertex tile ids onto solid faces
  for (const col of chunkColumns) emitColumn(col, store, sP, sC, wP, wC);
  _solidCol = _solidTile = null;
  return {
    sPos: new Float32Array(sP), sCol: new Float32Array(sC), sTile: new Float32Array(sT),
    wPos: new Float32Array(wP), wCol: new Float32Array(wC),
  };
}

/* Coarse LOD globe (E3): a low-resolution SURFACE SKIN of the whole planet — just each column's top
   face (no walls / subsurface), colored by the top material. Built from a low-FREQ planet so it's a
   few k tris and constant cost regardless of world size. Used for the orbit/space view and as the
   distant backdrop on the surface, with full hexel chunks streamed only near the camera. */
export function meshSurfaceSkin(columns, cells) {
  const pos = [], col = [], _c = new THREE.Color();
  for (const c0 of columns) {
    const base = c0.id * LAYERS;
    let top = -1;
    for (let L = LAYERS - 1; L >= 0; L--) { if (cells[base + L] !== AIR) { top = L; break; } }
    if (top < 0) continue;
    const matn = cells[base + top], rOut = radius(top + 1);
    if (matn === WATER_NUM) _c.copy(WATER_DEEP_C).lerp(WATER_SHALLOW_C, 0.35); else _c.copy(COLORS[matn]);
    const bnd = c0.boundary, n = bnd.length, ctr = c0.center.clone().multiplyScalar(rOut);
    for (let k = 0; k < n; k++)
      pushTri(ctr, bnd[k].clone().multiplyScalar(rOut), bnd[(k + 1) % n].clone().multiplyScalar(rOut), _c, c0.center, pos, col);
  }
  return { pos: new Float32Array(pos), col: new Float32Array(col) };
}

const _EMPTY = new Float32Array(0);
const EMPTY_ARRAYS = { sPos: _EMPTY, sCol: _EMPTY, wPos: _EMPTY, wCol: _EMPTY };   // for unloading a chunk

/* Build the planet as `chunkCount` meshes (grouped by column.chunk). All meshes are created EMPTY
   up front (add them to the scene immediately) and filled INCREMENTALLY by buildNext() so a 100k-tile
   planet doesn't freeze the tab — the caller drives buildNext() across frames behind a progress
   overlay. Returns a manager that also rebuilds individual chunks cheaply when an edit changes only a
   few columns. (Some chunk buckets fall outside their icosa face and stay empty — handled.) */
export function buildPlanetChunks(columns, store, chunkCount, sunDir) {
  const groups = Array.from({ length: chunkCount }, () => []);
  for (const col of columns) groups[col.chunk].push(col);
  // Lambert (cheap, diffuse-only) instead of Standard PBR — the non-indexed geometry already
  // has per-face-constant normals, so it still reads as crisp flat-shaded facets but costs far
  // less per fragment (big win full-screen on integrated GPUs).
  // Solid terrain: MeshLambert (keeps the built-in sun lighting + shadow receiving) with the vertex colour
  // as the AO/biome tint, PATCHED via onBeforeCompile to multiply in a TRIPLANAR sample of the grey texture
  // atlas (per-vertex `tile`). Triplanar (world-space projection) textures hexagonal faces without UVs.
  const atlas = buildTextureAtlas();
  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  solidMat.onBeforeCompile = (shader) => {
    shader.uniforms.uAtlas = { value: atlas.texture };
    shader.uniforms.uGrid = { value: new THREE.Vector2(atlas.cols, atlas.rows) };
    shader.uniforms.uTexScale = { value: 4.0 };                  // texture repeats per world unit (tune)
    shader.vertexShader = 'attribute float tile; varying float vTile; varying vec3 vWPos; varying vec3 vWNrm;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n vTile = tile; vWPos = (modelMatrix * vec4(position,1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * normal);');
    shader.fragmentShader = 'uniform sampler2D uAtlas; uniform vec2 uGrid; uniform float uTexScale; varying float vTile; varying vec3 vWPos; varying vec3 vWNrm;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
      `#include <color_fragment>
       { vec3 an = abs(normalize(vWNrm)); vec3 bw = an / max(an.x + an.y + an.z, 1e-4);
         vec2 org = vec2(mod(vTile, uGrid.x), floor(vTile / uGrid.x));
         vec2 ix = clamp(fract(vWPos.zy * uTexScale), 0.03, 0.97);
         vec2 iy = clamp(fract(vWPos.xz * uTexScale), 0.03, 0.97);
         vec2 iz = clamp(fract(vWPos.xy * uTexScale), 0.03, 0.97);
         float d = (texture2D(uAtlas, (org + ix) / uGrid).r * bw.x
                  + texture2D(uAtlas, (org + iy) / uGrid).r * bw.y
                  + texture2D(uAtlas, (org + iz) / uGrid).r * bw.z) * 1.28;   // rescale: neutral 200/255 → ~1
         diffuseColor.rgb *= d; }`);
  };

  // Water is a second, translucent pass with its OWN shader: per-vertex depth tint (vColor) +
  // a gentle radial wave bob + fresnel sheen + a sun-specular glint that tracks the day/night sun.
  // Uniforms share earth.js's live `sunDir`; the caller bumps uTime each frame. (ShaderMaterial
  // auto-provides position/normal/matrices/cameraPosition; we declare the color attribute ourselves.)
  const waterUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: sunDir || new THREE.Vector3(1, 0, 0) },
    uWave: { value: WATER_WAVE },
    uShallow: { value: WATER_SHALLOW_C }, uDeep: { value: WATER_DEEP_C },   // the depth-tint endpoints → recover depth in-shader
    uShoalA: { value: 0.30 }, uDeepA: { value: 0.88 },                       // alpha: see-through shallows → opaque deeps
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
      uniform vec3 uSunDir, uShallow, uDeep; uniform float uShoalA, uDeepA;
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
        // recover this column's depth (0 shore → 1 basin) by projecting its tint onto the shallow→deep line,
        // so shallow water is see-through (sandy bottom shows) and deep water reads opaque — like a real sea.
        vec3 sd = uDeep - uShallow;
        float dN = clamp(dot(vColor - uShallow, sd) / max(dot(sd, sd), 1e-5), 0.0, 1.0);
        float alpha = mix(uShoalA, uDeepA, dN) + fres * 0.25;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
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
    if (a.sTile) sg.setAttribute('tile', new THREE.BufferAttribute(a.sTile, 1));   // texture-atlas tile per vertex
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
        applyToEntry(e, meshChunkArrays(e.group, store));
        if (performance.now() - t0 >= timeBudgetMs) break;
      }
      return { done: next >= chunkCount, built: next, total: chunkCount };
    },
    // mesh / rebuild the given chunk ids (a Set or array) LOCALLY from the store — the on-demand
    // streaming-activation path and the per-edit path.
    rebuild(chunkIds) {
      for (const id of chunkIds) applyToEntry(entries[id], meshChunkArrays(entries[id].group, store));
    },
    // unload chunks far from the camera: swap to empty geometry + free GPU memory (E3 streaming)
    unload(chunkIds) {
      for (const id of chunkIds) applyToEntry(entries[id], EMPTY_ARRAYS);
    },
    dispose() {
      for (const e of entries) { e.solidMesh.geometry.dispose(); e.waterMesh.geometry.dispose(); }
      solidMat.dispose(); waterMat.dispose();
    },
  };
}

export { NUM as MATERIAL_NUM };
