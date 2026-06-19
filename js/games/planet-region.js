/* planet-region.js — ON-DEMAND per-region world generation (Phase C / 4-B, stage C2).

   The resident path (planet-mesh.js `terrainFill`) builds the WHOLE planet at once, indexed by global
   column id. To stream a PlanetSmith-scale planet that doesn't fit in RAM, we instead generate ONE region
   at a time (icosphere-address.js's 62-region scheme) on demand and evict it when far away.

   A region's terrain is reproduced from the SAME math as `terrainFill` (height/biome/strata are pure
   functions of a column's unit centre + seed). The two cross-column dependencies are handled with a
   2-ring HALO of columns just outside the region:
     • caves need each column's neighbours' surface heights — recomputed from their centres (position-pure);
     • trees root in a column and spill their canopy up to 2 rings into neighbours — so every tree rooted
       within 2 rings of the region (the halo) is evaluated, and only the leaf/trunk cells that land on the
       region's OWN columns are written.
   Result: a region generated in isolation is byte-identical (for the solid/water column 0..surface — the
   tree-independent part) to what the whole-planet `terrainFill` would produce for those columns, and trees
   are border-consistent. Verified by a deterministic probe against `terrainFill`.

   NOTE: the per-column height/biome/strata formulas below are a deliberate DUPLICATE of `terrainFill`'s
   pass-1 math and MUST stay in sync until C3 retires the resident path. Tree placement keys off the
   STRUCTURED column id (icosphere-address `encodeId`), not the old global id, so on-demand worlds are a new
   TERRAIN_VERSION (saves reset — accepted). Pure math; no DOM; worker-safe. */

import { LAYERS, CORE_L, SEA_L, MATERIALS, radius } from '../../data/planet.js';
import { makeNoise } from './planet-mesh.js';
import { regionColumns, regionSize, centerOf, neighborsOf, encodeId, decodeId, columnGeometry, REGION_EDGE } from './icosphere-address.js';

const AIR = 0;
// numeric material ids (rebuilt here to avoid coupling to planet-mesh internals; same order as terrainFill)
const NUM = {}; MATERIALS.forEach((m, i) => { NUM[m.id] = i + 1; });

// terrain constants — MUST match planet-mesh.js terrainFill
const CF = 0.85, NF = 1.7, AMP = 8, HF = 2.3, CAVEF = 0.55;
const MF = 0.55, RF = 3.1, MTN_AMP = 170, MTN_E = 0.35;
const GF = 0.42, RUF = 1.05, ROUGH_AMP = 7;
const bedrockOf = (g) => g < 0.34 ? NUM.stone : g < 0.52 ? NUM.granite : g < 0.68 ? NUM.slate : g < 0.84 ? NUM.basalt : NUM.sandstone;

// ---- pure per-column generation (height + biome) — duplicate of terrainFill pass-1 ----
// returns { s, topMat, geo, detail } from a column's unit centre `c`. fbm = makeNoise(seed).
export function columnGen(fbm, c) {
  const wf = 0.55, wA = 0.4;
  const wx = c.x + (fbm(c.x * wf + 30.0, c.y * wf + 10.0, c.z * wf - 20.0) - 0.5) * wA;
  const wy = c.y + (fbm(c.x * wf - 15.0, c.y * wf + 25.0, c.z * wf + 5.0) - 0.5) * wA;
  const wz = c.z + (fbm(c.x * wf + 8.0, c.y * wf - 12.0, c.z * wf + 40.0) - 0.5) * wA;
  const cont = fbm(wx * CF + 2.7, wy * CF - 4.1, wz * CF + 8.3);
  const detail = fbm(c.x * NF + 11.3, c.y * NF + 5.7, c.z * NF + 1.9);
  const lat = Math.abs(c.y);
  let e = (cont - 0.37) * 3.0 + (detail - 0.5) * 1.1;
  e -= Math.pow(lat, 3) * 0.30;
  if (e < 0) e = -Math.max(0.13, Math.pow(-e, 1.55) * 2.5);
  let s = Math.round(SEA_L + e * AMP);
  if (e > MTN_E) {
    const mf = fbm(c.x * MF - 5.2, c.y * MF + 13.7, c.z * MF - 2.4);
    const mt = Math.max(0, Math.min(1, (mf - 0.46) / 0.18)); const mask = 0.4 + 0.6 * mt * mt * (3 - 2 * mt);
    const ridge = 1 - Math.abs(2 * fbm(c.x * RF + 4.6, c.y * RF - 8.1, c.z * RF + 17.2) - 1);
    const land = Math.max(0, Math.min(1, (e - MTN_E) / 0.55));
    s += Math.round(mask * ridge * land * MTN_AMP);
  }
  const rough = (fbm(c.x * RUF + 21.0, c.y * RUF - 7.5, c.z * RUF + 3.3) - 0.5) * 2;
  s += Math.round(rough * Math.min(1, Math.max(0, s - SEA_L) / 30) * ROUGH_AMP);
  s = Math.max(CORE_L + 1, Math.min(LAYERS - 1, s));

  const elevAbove = Math.max(0, s - SEA_L);
  const jit = (fbm(c.x * 9.0 - 1.3, c.y * 9.0 + 4.4, c.z * 9.0 - 8.8) - 0.5) * 0.12;
  const temp = Math.max(0, Math.min(1, (1 - lat * 1.15) - elevAbove * 0.045 + jit));
  const hum = Math.max(0, Math.min(1, fbm(c.x * HF - 7.1, c.y * HF + 19.3, c.z * HF - 3.7) + jit));
  const geo = fbm(c.x * GF + 40.0, c.y * GF - 15.0, c.z * GF + 9.0);
  const bedrock = bedrockOf(geo);
  let topMat;
  if (s <= SEA_L + 1) topMat = NUM.sand;
  else if (elevAbove > 22) {
    const snowLine = 48 + temp * 46;
    if (elevAbove > snowLine + 16) topMat = NUM.ice;
    else if (elevAbove > snowLine) topMat = NUM.snow;
    else topMat = elevAbove < 34 ? NUM.scree : bedrock;
  }
  else if (temp < 0.18) topMat = NUM.snow;
  else if (temp < 0.34) topMat = hum > 0.5 ? NUM.taiga : NUM.tundra;
  else if (temp > 0.72 && hum < 0.26) topMat = NUM.sand;
  else if (temp > 0.58 && hum < 0.42 && elevAbove > 3) topMat = NUM.redrock;
  else if (temp > 0.62 && hum > 0.60) topMat = NUM.jungle;
  else if (temp > 0.5 && hum < 0.5) topMat = NUM.savanna;
  else if (hum > 0.58) topMat = NUM.forest;
  else topMat = NUM.grass;
  return { s, topMat, geo, detail };
}
// write one column's strata + water flood into `cells` at `base` (pure; no fbm). Matches terrainFill.
export function fillColumn(cells, base, s, topMat, geo, detail) {
  const bedrock = bedrockOf(geo), band2 = bedrock === NUM.stone ? NUM.granite : NUM.stone;
  const strataPhase = (geo + detail) * 6.0;
  for (let L = 0; L <= s; L++) {
    if (L === s) cells[base + L] = topMat;
    else if (L >= s - 2) cells[base + L] = NUM.dirt;
    else if (L <= CORE_L) cells[base + L] = NUM.core;
    else { const bi = ((Math.floor(L * 0.62 + strataPhase) % 3) + 3) % 3; cells[base + L] = bi === 0 ? bedrock : bi === 1 ? NUM.stone : band2; }
  }
  if (s < SEA_L) for (let L = s + 1; L <= SEA_L; L++) cells[base + L] = NUM.water;
}

// structured-id tree hash (same shape as terrainFill's thash, keyed by the STRUCTURED id + seed)
function thash(seed, i) { let h = Math.imul((seed ^ i) >>> 0, 2246822519); h ^= h >>> 13; h = Math.imul(h, 3266489917); h ^= h >>> 16; return (h >>> 0) / 4294967296; }

/* Generate one region's columns + voxel cells on demand.
   Returns { region, f, size, columns:[{local,id,center,s,topMat}], neighborIds:Int32Array(size*6),
             neighborLens:Uint8Array(size), cells:Uint8Array(size*LAYERS) }.
   `cells` is indexed by local*LAYERS+L (local = the column's index within the region). */
export function genRegion(region, f, seed) {
  const fbm = makeNoise(seed);
  const own = regionColumns(region, f);              // [{region, local}]
  const size = own.length;
  // ---- halo: own columns + 2 rings out (Map id -> node) ----
  const halo = new Map();                             // id -> { addr, center, s, topMat, geo, detail, own, base, nbr:[ids] }
  const idOf = (a) => encodeId(a.region, a.local, f);
  function ensure(addr, isOwn, base) {
    const id = idOf(addr); let node = halo.get(id);
    if (node) { if (isOwn && !node.own) { node.own = true; node.base = base; } return node; }
    const center = centerOf(addr, f); const g = columnGen(fbm, center);
    node = { addr, id, center, s: g.s, topMat: g.topMat, geo: g.geo, detail: g.detail, own: isOwn, base, nbr: null };
    halo.set(id, node); return node;
  }
  const columns = new Array(size);
  for (let lc = 0; lc < size; lc++) { const node = ensure(own[lc], true, lc * LAYERS); columns[lc] = node; }
  // expand 2 rings (own = ring 0)
  let frontier = columns.slice();
  for (let ring = 0; ring < 2; ring++) {
    const next = [];
    for (const node of frontier) {
      const nbrAddrs = neighborsOf(node.addr, f); node.nbr = nbrAddrs.map(idOf);
      for (const na of nbrAddrs) { const id = idOf(na); if (!halo.has(id)) { const nn = ensure(na, false, -1); next.push(nn); } }
    }
    frontier = next;
  }
  // fill neighbour lists for any frontier nodes not yet expanded (needed for tree BFS distances)
  for (const node of halo.values()) if (!node.nbr) node.nbr = neighborsOf(node.addr, f).map(idOf);

  // ---- cells: strata + flood for OWN columns ----
  const cells = new Uint8Array(size * LAYERS);
  for (const node of columns) fillColumn(cells, node.base, node.s, node.topMat, node.geo, node.detail);

  // ---- caves: carve enclosed pockets in OWN columns (uses halo neighbour surfaces) ----
  for (const node of columns) {
    const c = node.center, base = node.base, s = node.s, nbr = node.nbr;
    for (let L = CORE_L + 1; L <= s - 2; L++) {
      let enclosed = true;
      for (const nid of nbr) { const nn = halo.get(nid); if (!nn || nn.s <= L) { enclosed = false; break; } }
      if (!enclosed) continue;
      const r = (radius(L) + radius(L + 1)) / 2;
      if (fbm(c.x * r * CAVEF + 30.0, c.y * r * CAVEF - 12.0, c.z * r * CAVEF + 5.0) > 0.7) cells[base + L] = AIR;
    }
  }

  // ---- trees: every root within 2 rings (the halo) drops its canopy; only OWN cells are written ----
  const WOOD = NUM.wood, LEAF = NUM.leaves, PINE = NUM.pineleaf;
  // ring distance over the halo subgraph from a root id → Map(id -> dist 0..R)
  function ringDist(rootId, R) {
    const seen = new Map([[rootId, 0]]); let fr = [rootId];
    for (let d = 1; d <= R; d++) { const nx = [];
      for (const id of fr) { const node = halo.get(id); if (!node) continue; for (const nid of node.nbr) if (halo.has(nid) && !seen.has(nid)) { seen.set(nid, d); nx.push(nid); } }
      fr = nx; }
    return seen;
  }
  function leafLayer(rings, L, r, mat) {
    if (L < 0 || L >= LAYERS) return;
    for (const [id, d] of rings) if (d <= r) { const nn = halo.get(id); if (nn && nn.own) { const i = nn.base + L; if (cells[i] === AIR) cells[i] = mat; } }
  }
  for (const node of halo.values()) {
    const s = node.s; if (s <= SEA_L) continue;
    const topM = node.topMat; let type, density;
    if (topM === NUM.forest) { type = 'broadleaf'; density = 0.10; }
    else if (topM === NUM.grass) { type = 'broadleaf'; density = 0.05; }
    else if (topM === NUM.jungle) { type = 'jungle'; density = 0.13; }
    else if (topM === NUM.taiga) { type = 'pine'; density = 0.15; }
    else if (topM === NUM.savanna) { type = 'acacia'; density = 0.04; }
    else continue;
    if (thash(seed, node.id) > density) continue;
    const rnd = thash(seed, node.id + 7919);
    let trunkH;
    if (type === 'pine') trunkH = 9 + ((rnd * 6) | 0);
    else if (type === 'jungle') trunkH = 12 + ((rnd * 7) | 0);
    else if (type === 'acacia') trunkH = 8 + ((rnd * 5) | 0);
    else trunkH = 6 + ((rnd * 5) | 0);
    const top = s + trunkH;
    if (node.own) for (let L = s + 1; L <= top && L < LAYERS; L++) if (cells[node.base + L] === AIR) cells[node.base + L] = WOOD;   // trunk only in its own region
    const rings = ringDist(node.id, 2);
    if (type === 'pine') { for (let L = s + 4; L <= top + 1; L++) { const t = (L - (s + 4)) / Math.max(1, (top + 1) - (s + 4)); leafLayer(rings, L, Math.round(2 * (1 - t)), PINE); } }
    else if (type === 'jungle') { for (let L = top - 3; L <= top + 1; L++) leafLayer(rings, L, L >= top ? 1 : 2, LEAF); }
    else if (type === 'acacia') { leafLayer(rings, top, 2, LEAF); leafLayer(rings, top + 1, 1, LEAF); }
    else { leafLayer(rings, top - 2, 1, LEAF); leafLayer(rings, top - 1, 2, LEAF); leafLayer(rings, top, 2, LEAF); leafLayer(rings, top + 1, 1, LEAF); leafLayer(rings, top + 2, 1, LEAF); }
  }

  const neighborIds = new Int32Array(size * 6).fill(-1), neighborLens = new Uint8Array(size);
  for (let lc = 0; lc < size; lc++) { const nbr = columns[lc].nbr; neighborLens[lc] = nbr.length; for (let k = 0; k < nbr.length; k++) neighborIds[lc * 6 + k] = nbr[k]; }
  return { region, f, size, columns: columns.map((n) => ({ local: (n.base / LAYERS) | 0, id: n.id, center: n.center, s: n.s, topMat: n.topMat })), neighborIds, neighborLens, cells };
}

/* LRU region cache: holds at most `maxRegions` generated regions; evicts least-recently-used. */
export class RegionCache {
  constructor(f, seed, maxRegions = 96) { this.f = f; this.seed = seed; this.max = maxRegions; this.map = new Map(); this.tick = 0; }
  get(region) {
    let e = this.map.get(region);
    if (e) { e.used = ++this.tick; return e.data; }
    const data = genRegion(region, this.f, this.seed);
    this.map.set(region, { data, used: ++this.tick });
    if (this.map.size > this.max) this._evict();
    return data;
  }
  has(region) { return this.map.has(region); }
  _evict() {
    let oldest = null, oldKey = -1;
    for (const [k, e] of this.map) if (oldest === null || e.used < oldest) { oldest = e.used; oldKey = k; }
    if (oldKey >= 0) this.map.delete(oldKey);
  }
}

/* Store-API adapter over a RegionCache, keyed by STRUCTURED column id (encodeId). Exposes exactly the
   getMat/getTop/getState/setState surface the existing fine-chunk mesher (planet-mesh.js emitColumn /
   meshChunkArrays) expects, so the mesher is reused UNCHANGED — a neighbour lookup `getMat(nbId, L)` for a
   column in another region transparently generates that region on demand (cross-region seam culling).
   Edits mutate the cached region's cells in place; persistence (re-applying on regen/evict) is C4. */
export class RegionWorld {
  constructor(cache) { this.cache = cache; this.f = cache.f; this.state = new Map(); }
  _at(id) { const { region, local } = decodeId(id, this.f); return { cells: this.cache.get(region).cells, base: local * LAYERS }; }
  getMat(id, L) { const a = this._at(id); return a.cells[a.base + L]; }
  setMat(id, L, m) { const a = this._at(id); a.cells[a.base + L] = m; }
  getTop(id) { const a = this._at(id); for (let L = LAYERS - 1; L >= 0; L--) if (a.cells[a.base + L] !== AIR) return L; return -1; }
  getState(id, L) { return this.state.get(id * LAYERS + L) || 0; }
  setState(id, L, v) { const ci = id * LAYERS + L; if (v) this.state.set(ci, v); else this.state.delete(ci); }
}

/* Build the mesher-ready column objects for a region: {id, center, boundary, neighbors:[structured ids],
   isPentagon} — geometry reconstructed from the address (no global build). Feed these + a RegionWorld to
   planet-mesh.js meshChunkArrays to mesh the region (with cross-region neighbour culling). */
export function regionColumnObjects(region, f) {
  return regionColumns(region, f).map((addr) => {
    const g = columnGeometry(addr, f);
    return { id: encodeId(addr.region, addr.local, f), center: g.center, boundary: g.boundary,
      neighbors: g.neighborAddrs.map((a) => encodeId(a.region, a.local, f)), isPentagon: g.isPentagon };
  });
}
