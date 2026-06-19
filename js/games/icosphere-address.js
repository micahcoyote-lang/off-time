/* icosphere-address.js — STRUCTURED addressing for the Goldberg hexsphere (Phase C / 4-B keystone).

   The original `hexsphere.js` builds the WHOLE planet by subdividing all 20 icosa faces and deduping
   shared vertices into a global array — a column's id is its dedup-order array index, and its neighbours
   are global ids. That can only exist if the entire planet is resident. To generate / stream / store
   the planet REGION-BY-REGION on demand (PlanetSmith scale: 16×+ wider than fits in RAM), we need an
   addressing scheme where a column's POSITION and its NEIGHBOURS are computed arithmetically per region,
   without ever building the global array.

   This module is that scheme. Every column (geodesic vertex of the frequency-`f` icosphere) gets a
   structured address = a region + a local index, packed into one float64-safe integer id:

     REGIONS (PlanetSmith's "62-region" partition, by icosa element):
       0 .. 11   : the 12 icosa VERTICES   → pentagons (1 column each)
       12 .. 41  : the 30 icosa EDGES       → (f-1) columns each (a 1-D strip)
       42 .. 61  : the 20 icosa FACES       → (f-1)(f-2)/2 columns each (a 2-D interior)
     Total = 12 + 30(f-1) + 20(f-1)(f-2)/2 = 10f²+2 columns — same as hexsphere.js.

   A column is identified canonically by which icosa element it lives on:
     pentagon : ico-vertex v
     edge     : canonical edge (u<v) + step m∈[1,f-1] from u toward v
     face     : face F + lattice (i,j) of the SUBDIVISION grid, 0<j<i<f (strict interior)

   Geometry is reproduced from hexsphere.js's exact construction (slerp lattice), so `centerOf` matches
   the old per-column `center` within float epsilon. `neighborsOf` returns the 5/6 neighbour addresses by
   arithmetic + a tiny precomputed face/edge adjacency table (the "handedness parity" is just the per-face
   orientation of each shared edge, derived from ICO_FACES — no per-seam special cases).

   Pure math; no DOM; safe in the worker. Verified to reproduce buildHexSphere(f) exactly (centers +
   neighbour sets + 12 pentagons) up to f=290 by a deterministic probe. */

import * as THREE from '../../assets/vendor/three.module.js';

const PHI = (1 + Math.sqrt(5)) / 2;

// 12 icosahedron vertices (must match hexsphere.js EXACTLY so centers line up).
function icoVertices() {
  const t = PHI;
  const raw = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  return raw.map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());
}
// The 20 triangular faces (same winding as hexsphere.js).
const ICO_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];
// Great-circle interpolation (identical to hexsphere.js).
function slerp(a, b, f) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const omega = Math.acos(dot);
  if (omega < 1e-6) return a.clone();
  const s = Math.sin(omega);
  return a.clone().multiplyScalar(Math.sin((1 - f) * omega) / s).addScaledVector(b, Math.sin(f * omega) / s);
}

const ICO = icoVertices();

// ---- precomputed (f-independent) icosa element tables ----
// canonical edges: unique unordered ico-vertex pairs (u<v), sorted → stable index 0..29.
const EDGES = [];                 // [ {u, v}, ... ] index = edge region offset
const EDGE_IDX = new Map();       // "u,v" (u<v) -> edge index
const ekey = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
for (const [a, b, c] of ICO_FACES) {
  for (const [p, q] of [[a, b], [b, c], [c, a]]) {
    const k = ekey(p, q);
    if (!EDGE_IDX.has(k)) { EDGE_IDX.set(k, EDGES.length); const u = Math.min(p, q), v = Math.max(p, q); EDGES.push({ u, v }); }
  }
}
// for each face: the 3 ico-corner indices [A,B,C] and, per local edge, the canonical (u,v).
// localEdge 0 = A-B, 1 = B-C, 2 = C-A. We store which two LOCAL corners (0/1/2) each spans.
const LOCAL_EDGES = [[0, 1], [1, 2], [2, 0]];   // local corner pairs
// faces incident to each ico vertex (for pentagon neighbours) and to each canonical edge (for seam crossing).
const VERT_FACES = Array.from({ length: 12 }, () => []);   // v -> [faceIdx,...]
const EDGE_FACES = Array.from({ length: EDGES.length }, () => []);  // edgeIdx -> [{F, le}, ...] (le = local edge 0/1/2)
ICO_FACES.forEach((corners, F) => {
  for (const v of corners) VERT_FACES[v].push(F);
  LOCAL_EDGES.forEach((pair, le) => {
    const ei = EDGE_IDX.get(ekey(corners[pair[0]], corners[pair[1]]));
    EDGE_FACES[ei].push({ F, le });
  });
});

const FACE_CENTERS = ICO_FACES.map(([a, b, c]) => ICO[a].clone().add(ICO[b]).add(ICO[c]).normalize());

// ---- region taxonomy ----
export const REGION_PENT = 0, REGION_EDGE = 12, REGION_FACE = 42, REGION_COUNT = 62;
export const regionType = (r) => (r < REGION_EDGE ? 'pent' : r < REGION_FACE ? 'edge' : 'face');

// columns per region at frequency f
export function regionSize(r, f) {
  if (r < REGION_EDGE) return 1;                                  // pentagon
  if (r < REGION_FACE) return Math.max(0, f - 1);                 // edge strip
  return Math.max(0, ((f - 1) * (f - 2)) / 2);                    // face interior
}
// total columns = 10f²+2
export function columnCount(f) { return 10 * f * f + 2; }

// ---- packed float64-safe id  <->  (region, local) ----
// cumulative base offset of each region for a given f (cached per f).
const _baseCache = new Map();
function bases(f) {
  let b = _baseCache.get(f);
  if (b) return b;
  b = new Float64Array(REGION_COUNT + 1);
  for (let r = 0; r < REGION_COUNT; r++) b[r + 1] = b[r] + regionSize(r, f);
  _baseCache.set(f, b);
  return b;
}
export function encodeId(region, local, f) { return bases(f)[region] + local; }
export function decodeId(id, f) {
  const b = bases(f);
  // binary search for the region whose base ≤ id
  let lo = 0, hi = REGION_COUNT - 1, r = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (b[mid] <= id) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return { region: r, local: id - b[r] };
}

// ---- canonical-address helpers (region, local) <-> icosa-element coordinates ----
// pentagon: {region:v, local:0}                          (ico vertex v)
// edge:     {region:12+edgeIdx, local:m-1}               (step m∈[1,f-1] from EDGES[edgeIdx].u)
// face:     {region:42+F, local: triIndex(i,j)}          (lattice 0<j<i<f)
const pentAddr = (v) => ({ region: REGION_PENT + v, local: 0 });
const edgeAddr = (edgeIdx, m) => ({ region: REGION_EDGE + edgeIdx, local: m - 1 });
const faceAddr = (F, i, j) => ({ region: REGION_FACE + F, local: ((i - 2) * (i - 1)) / 2 + (j - 1) });
function faceLatticeOfLocal(local) {            // inverse of triIndex: local -> {i,j}
  const i = Math.floor((3 + Math.sqrt(1 + 8 * local)) / 2);
  const j = local - ((i - 2) * (i - 1)) / 2 + 1;
  return { i, j };
}

// classify a face-lattice point (F, i, j) [0≤j≤i≤f] into its canonical address (handles the case where the
// point actually lives on one of F's edges or corners → an edge/pentagon region shared with other faces).
function classify(F, i, j, f) {
  const corners = ICO_FACES[F];                 // [A,B,C] ico indices; A=(0,0) B=(f,0) C=(f,f)
  const a = f - i, b = i - j, c = j;            // barycentric lattice (a=on A, b=on B, c=on C)
  // corners → pentagons
  if (b === 0 && c === 0) return pentAddr(corners[0]);   // A
  if (a === 0 && c === 0) return pentAddr(corners[1]);   // B
  if (a === 0 && b === 0) return pentAddr(corners[2]);   // C
  // edges (one bary coord 0) → canonical edge region
  if (c === 0) return edgePoint(corners[0], corners[1], i, f);          // A-B edge, param i from A
  if (a === 0) return edgePoint(corners[1], corners[2], j, f);          // B-C edge, param j from B
  if (b === 0) return edgePoint(corners[0], corners[2], i, f);          // A-C edge, param i from A (i==j here)
  // strict interior → face region
  return faceAddr(F, i, j);
}
// an edge point: ico endpoints (p,q) with param t∈[0,f] measured from p (t=0 → p, t=f → q).
function edgePoint(p, q, t, f) {
  if (t === 0) return pentAddr(p);
  if (t === f) return pentAddr(q);
  const ei = EDGE_IDX.get(ekey(p, q)), e = EDGES[ei];
  const m = (p === e.u) ? t : (f - t);          // canonical step from u
  return edgeAddr(ei, m);
}

// ---- centre position of an address ----
export function centerOf(addr, f) {
  const r = addr.region;
  if (r < REGION_EDGE) return ICO[r].clone();                 // pentagon = ico vertex
  if (r < REGION_FACE) {                                      // edge: slerp(u,v, m/f)
    const e = EDGES[r - REGION_EDGE], m = addr.local + 1;
    return slerp(ICO[e.u], ICO[e.v], m / f);
  }
  const F = r - REGION_FACE, { i, j } = faceLatticeOfLocal(addr.local);
  return faceLatticePos(F, i, j, f);
}
// position of face-lattice (F,i,j) — IDENTICAL formula to hexsphere.js's grid[i][j].
function faceLatticePos(F, i, j, f) {
  const [ia, ib, ic] = ICO_FACES[F], A = ICO[ia], B = ICO[ib], C = ICO[ic];
  if (i === 0) return A.clone();
  const left = slerp(A, B, i / f), right = slerp(A, C, i / f);
  return slerp(left, right, j / i);
}
// map a canonical edge point (edgeIdx, step m from u) to face F's lattice (i,j). F must share this edge.
function edgePointToFaceLattice(edgeIdx, m, F, f) {
  const e = EDGES[edgeIdx], corners = ICO_FACES[F];
  // find the local edge of F that is {e.u,e.v}; determine param t from local-corner-A-side
  for (let le = 0; le < 3; le++) {
    const lc = LOCAL_EDGES[le], p = corners[lc[0]], q = corners[lc[1]];
    if (ekey(p, q) !== ekey(e.u, e.v)) continue;
    // canonical step m is from e.u; convert to t measured from local corner p
    const t = (p === e.u) ? m : (f - m);
    // local edge le: 0=A-B (i=t,j=0) ; 1=B-C (i=f,j=t) ; 2=C-A i.e. A-C reversed (i=f-t,j=f-t)
    if (le === 0) return { i: t, j: 0 };
    if (le === 1) return { i: f, j: t };
    // le === 2 spans corners C(2)->A(0); param t from C. A-C edge is grid[i][i] with i from A. from C → i=f-t.
    return { i: f - t, j: f - t };
  }
  return null;   // shouldn't happen
}

// ---- neighbours of an address: the 5 (pentagon) or 6 (else) adjacent column addresses ----
export function neighborsOf(addr, f) {
  const r = addr.region;
  if (r < REGION_EDGE) return pentNeighbors(r, f);
  if (r < REGION_FACE) return edgeNeighbors(r - REGION_EDGE, addr.local + 1, f);
  return faceNeighbors(r - REGION_FACE, faceLatticeOfLocal(addr.local), f);
}
// pentagon v: the first step (m=1 from v) along each of the 5 incident edges.
function pentNeighbors(v, f) {
  const out = [];
  for (let ei = 0; ei < EDGES.length; ei++) {
    const e = EDGES[ei];
    if (e.u !== v && e.v !== v) continue;
    const m = (e.u === v) ? 1 : (f - 1);        // step 1 away from v toward the other end
    out.push(f === 1 ? pentAddr(e.u === v ? e.v : e.u) : edgeAddr(ei, m));
  }
  return out;
}
// face-interior (F,i,j): the 6 bary-neighbours on F, each classified (may land on F's edges).
function faceNeighbors(F, ij, f) {
  const { i, j } = ij;
  const cand = [[i, j - 1], [i, j + 1], [i - 1, j - 1], [i - 1, j], [i + 1, j], [i + 1, j + 1]];
  return cand.map(([ni, nj]) => classify(F, ni, nj, f));
}
// edge point (edgeIdx, step m from u): 2 along-edge + 2 inward on each of the 2 incident faces.
function edgeNeighbors(edgeIdx, m, f) {
  const e = EDGES[edgeIdx], out = [];
  // along the edge
  out.push(m - 1 === 0 ? pentAddr(e.u) : edgeAddr(edgeIdx, m - 1));
  out.push(m + 1 === f ? pentAddr(e.v) : edgeAddr(edgeIdx, m + 1));
  // inward into each incident face
  for (const { F } of EDGE_FACES[edgeIdx]) {
    const { i, j } = edgePointToFaceLattice(edgeIdx, m, F, f);
    // inward neighbours = the two interior bary-neighbours (opposite-corner coord +1). Identify by which
    // of F's edges this point is on, then step inward.
    for (const [ni, nj] of inwardFromEdgeLattice(i, j, f)) out.push(classify(F, ni, nj, f));
  }
  return out;
}
// given an edge-lattice point (i,j) on a face (it lies on one of the face's 3 edges), the 2 inward lattice
// points (the two bary-neighbours that raise the zero coord into the interior). classify() handles the rest.
function inwardFromEdgeLattice(i, j, f) {
  if (j === 0) return [[i, 1], [i + 1, 1]];               // on A-B edge (c=0) → step toward C
  if (i === f) return [[f - 1, j - 1], [f - 1, j]];       // on B-C edge (a=0) → step toward A (row f-1)
  return [[i, j - 1], [i + 1, j]];                        // on A-C edge (i===j, b=0) → step toward B
}

// ---- full per-column geometry (centre + ordered boundary + edge-aligned neighbours) ----
// Reconstructs what hexsphere.js produced per column WITHOUT a global build: the 5/6 boundary vertices
// (dual = centroids of the geodesic triangles fanning the column) in CCW order, and the neighbour across
// each boundary edge. `boundary[k]` → `boundary[k+1]` is the edge crossed by `neighborAddrs[k]` — exactly
// the alignment emitColumn() expects. Verified to match buildHexSphere's boundary/neighbour adjacency.
const _Y = new THREE.Vector3(0, 1, 0), _X = new THREE.Vector3(1, 0, 0);
export function columnGeometry(addr, f) {
  const center = centerOf(addr, f);
  const nAddrs = neighborsOf(addr, f);
  const nCent = nAddrs.map((a) => centerOf(a, f));
  // angular order of neighbours in the tangent plane (same basis convention as hexsphere.js)
  const up = center.clone();
  const east = new THREE.Vector3().crossVectors(up, Math.abs(up.y) < 0.99 ? _Y : _X).normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const ord = nCent.map((p, k) => ({ k, ang: Math.atan2(p.dot(north), p.dot(east)) })).sort((a, b) => a.ang - b.ang);
  const oC = ord.map((o) => nCent[o.k]), oA = ord.map((o) => nAddrs[o.k]), m = oC.length;
  const boundary = [], neighborAddrs = [];
  for (let k = 0; k < m; k++) boundary.push(oC[k].clone().add(oC[(k + 1) % m]).add(center).normalize());   // dual vertex between consecutive neighbours
  for (let k = 0; k < m; k++) neighborAddrs.push(oA[(k + 1) % m]);   // neighbour across edge boundary[k]→boundary[k+1]
  return { center, boundary, neighborAddrs, isPentagon: m === 5 };
}

// ---- position → nearest column address (picking / physics in region mode; inverse of centerOf) ----
// Robust to the slerp lattice's curvature: estimate the lattice cell from linear barycentric, then pick the
// nearest actual grid centre in a small neighbourhood and canonicalise it. Round-trips centerOf exactly.
const _bv0 = new THREE.Vector3(), _bv1 = new THREE.Vector3(), _bv2 = new THREE.Vector3();
export function addressOf(p, f) {
  let bestF = 0, bd = -2;
  for (let F = 0; F < 20; F++) { const d = p.dot(FACE_CENTERS[F]); if (d > bd) { bd = d; bestF = F; } }
  const [ia, ib, ic] = ICO_FACES[bestF], A = ICO[ia], B = ICO[ib], C = ICO[ic];
  _bv0.subVectors(B, A); _bv1.subVectors(C, A); _bv2.subVectors(p, A);
  const d00 = _bv0.dot(_bv0), d01 = _bv0.dot(_bv1), d11 = _bv1.dot(_bv1), d20 = _bv2.dot(_bv0), d21 = _bv2.dot(_bv1);
  const denom = (d00 * d11 - d01 * d01) || 1;
  const wB = (d11 * d20 - d01 * d21) / denom, wC = (d00 * d21 - d01 * d20) / denom;
  // start from the linear-barycentric estimate, then hill-climb on the lattice to the nearest grid centre
  // (the linear estimate can be several cells off near face edges because the slerp lattice curves).
  let i = Math.max(0, Math.min(f, Math.round((wB + wC) * f))), j = Math.max(0, Math.min(i, Math.round(wC * f)));
  let cur = faceLatticePos(bestF, i, j, f).distanceToSquared(p);
  const MOVES = [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, 0], [1, 1]];   // the 6 triangular-lattice neighbours
  for (let iter = 0; iter < 4 * f + 16; iter++) {
    let ni = i, nj = j, nd = cur;
    for (const [di, dj] of MOVES) {
      const ti = i + di, tj = j + dj;
      if (ti < 0 || ti > f || tj < 0 || tj > ti) continue;
      const dd = faceLatticePos(bestF, ti, tj, f).distanceToSquared(p);
      if (dd < nd) { nd = dd; ni = ti; nj = tj; }
    }
    if (ni === i && nj === j) break;
    i = ni; j = nj; cur = nd;
  }
  return classify(bestF, i, j, f);
}

// ---- enumerate every column of a region (for on-demand generation in C2) ----
export function regionColumns(r, f) {
  const out = [];
  if (r < REGION_EDGE) { out.push({ region: r, local: 0 }); return out; }
  if (r < REGION_FACE) { for (let m = 1; m <= f - 1; m++) out.push(edgeAddr(r - REGION_EDGE, m)); return out; }
  const F = r - REGION_FACE;
  for (let i = 2; i <= f - 1; i++) for (let j = 1; j <= i - 1; j++) out.push(faceAddr(F, i, j));
  return out;
}
