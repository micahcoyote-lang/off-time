/* hexsphere.js — Goldberg-polyhedron topology for the Earth ("hexel planet") game.

   Pure geometry/math, no game logic, no voxels. Builds the dual of a geodesic icosphere:
   start from a 20-face icosahedron, subdivide each triangular face into an n×n lattice
   (frequency `freq`) projected onto the unit sphere, then take the DUAL — every geodesic
   vertex becomes one tile ("column"). Vertices of valence 6 → hexagons; the 12 original
   icosahedron vertices have valence 5 → pentagons (the 12 pentagons are unavoidable).

   buildHexSphere(freq) → { columns, pentagonCount, vertCount, triCount }
     column = { id, center:Vector3(unit), boundary:Vector3[](ordered units, len 5|6),
                neighbors:number[](column ids, aligned 1:1 with boundary edges),
                isPentagon:boolean }
   Tile count = 10·freq² + 2, of which exactly 12 are pentagons. */

import * as THREE from '../../assets/vendor/three.module.js';

const PHI = (1 + Math.sqrt(5)) / 2;

// 12 icosahedron vertices: cyclic permutations of (0, ±1, ±PHI), normalized.
function icoVertices() {
  const t = PHI;
  const raw = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  return raw.map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());
}

// The 20 triangular faces of the icosahedron (standard winding).
const ICO_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

// Great-circle interpolation between two unit vectors (keeps points evenly spaced on the
// sphere, unlike lerp-then-normalize which bunches them toward the triangle corners).
function slerp(a, b, f) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const omega = Math.acos(dot);
  if (omega < 1e-6) return a.clone();
  const s = Math.sin(omega);
  return a.clone().multiplyScalar(Math.sin((1 - f) * omega) / s)
    .addScaledVector(b, Math.sin(f * omega) / s);
}

export function buildHexSphere(freq) {
  const ico = icoVertices();

  // ---- 1. subdivide every face, deduping shared edge/corner vertices by position hash ----
  const geodVerts = [];               // Vector3[]
  const vmap = new Map();             // "x,y,z" -> vertex id
  const keyOf = (v) => `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
  function addVert(v) {
    const k = keyOf(v);
    let id = vmap.get(k);
    if (id === undefined) { id = geodVerts.length; geodVerts.push(v.clone()); vmap.set(k, id); }
    return id;
  }

  const tris = [];                    // [idA, idB, idC]
  for (const [ia, ib, ic] of ICO_FACES) {
    const A = ico[ia], B = ico[ib], C = ico[ic];
    const grid = [];                  // grid[i][j], row i has i+1 points
    for (let i = 0; i <= freq; i++) {
      grid[i] = [];
      const left = slerp(A, B, i / freq);
      const right = slerp(A, C, i / freq);
      for (let j = 0; j <= i; j++) {
        const v = i === 0 ? A.clone() : slerp(left, right, j / i);
        grid[i][j] = addVert(v);
      }
    }
    for (let i = 1; i <= freq; i++) {
      for (let j = 0; j < i; j++) {
        tris.push([grid[i - 1][j], grid[i][j], grid[i][j + 1]]);          // up-triangle
        if (j < i - 1) tris.push([grid[i - 1][j], grid[i][j + 1], grid[i - 1][j + 1]]); // down
      }
    }
  }

  // ---- 2. dual: each geodesic vertex → one column (tile) ----
  const triCentroid = tris.map(([a, b, c]) =>
    geodVerts[a].clone().add(geodVerts[b]).add(geodVerts[c]).multiplyScalar(1 / 3).normalize());
  const incident = Array.from({ length: geodVerts.length }, () => []);
  tris.forEach((t, ti) => { incident[t[0]].push(ti); incident[t[1]].push(ti); incident[t[2]].push(ti); });

  const columns = [];
  let pentagonCount = 0;
  const up = new THREE.Vector3(), east = new THREE.Vector3(), north = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);

  for (let id = 0; id < geodVerts.length; id++) {
    const center = geodVerts[id];
    up.copy(center);
    // tangent basis at this vertex; pick an axis not parallel to `up`
    east.crossVectors(up, Math.abs(up.y) < 0.99 ? Y : X).normalize();
    north.crossVectors(up, east).normalize();

    // order incident triangles by the angle of their centroid in the tangent plane (CCW)
    const ranked = incident[id].map((ti) => {
      const c = triCentroid[ti];
      return { ti, ang: Math.atan2(c.dot(north), c.dot(east)) };
    }).sort((p, q) => p.ang - q.ang);

    const boundary = ranked.map((r) => triCentroid[r.ti].clone());
    // neighbor across boundary edge k (between boundary[k] and boundary[k+1]) = the vertex
    // (other than id) shared by ordered triangles k and k+1.
    const neighbors = [];
    const n = ranked.length;
    for (let k = 0; k < n; k++) {
      const tA = tris[ranked[k].ti];
      const tB = tris[ranked[(k + 1) % n].ti];
      const shared = tA.find((v) => v !== id && tB.includes(v));
      neighbors.push(shared === undefined ? -1 : shared);
    }

    const isPentagon = boundary.length === 5;
    if (isPentagon) pentagonCount++;
    columns.push({ id, center: center.clone(), boundary, neighbors, isPentagon, chunk: 0 });
  }

  // ---- chunk assignment: each column → nearest icosahedron-face center (20 chunks) ----
  // Used for partial geometry rebuilds (edit one chunk, not the whole planet) + frustum culling.
  const faceCenters = ICO_FACES.map(([a, b, c]) =>
    ico[a].clone().add(ico[b]).add(ico[c]).normalize());
  for (const col of columns) {
    let best = 0, bestDot = -2;
    for (let f = 0; f < faceCenters.length; f++) {
      const d = col.center.dot(faceCenters[f]);
      if (d > bestDot) { bestDot = d; best = f; }
    }
    col.chunk = best;
  }

  return { columns, pentagonCount, chunkCount: ICO_FACES.length, vertCount: geodVerts.length, triCount: tris.length };
}
