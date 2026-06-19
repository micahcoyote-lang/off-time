/* planet-worker.js — Earth world-generation worker (Engine E2).

   Runs the heavy, formerly-blocking generation OFF the main thread: topology (buildHexSphere) +
   terrain (terrainFill, + any saved edits) + per-chunk meshing, then STREAMS the result to earth.js
   as TRANSFERABLE buffers (zero-copy). The main thread stays responsive the whole time — it renders
   the progress overlay and can even orbit while the world streams in.

   Protocol:
     main → worker : { type:'init', freq, seed, edits:[{c,m}] }
     worker → main : { type:'topology', centers, boundary, boundaryLen, neighbors, chunk, cells,
                       chunkCount, pentagonCount, river }              (one message, transferables)
                     { type:'chunk', chunkId, sPos, sCol, wPos, wCol, built, total }  (one per chunk)
                     { type:'done' }

   This is a MODULE worker (`{type:'module'}`), so it can `import` the same ES modules the page uses. */

import { buildHexSphere } from './hexsphere.js';
import { terrainFill, meshSurfaceSkin, terrainMeta } from './planet-mesh.js';
import { FREQ_COARSE } from '../../data/planet.js';

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'init') return;
  const { freq, seed, edits } = msg;

  // 1. topology + terrain (+ saved edits) — the work that used to freeze the page, now off-thread
  const { columns, pentagonCount, chunkCount } = buildHexSphere(freq);
  const cells = terrainFill(columns, seed);
  const river = terrainMeta.river;                  // capture before the coarse globe's terrainFill clears it
  if (Array.isArray(edits)) {
    for (const ed of edits) if (ed && ed.c >= 0 && ed.c < cells.length) cells[ed.c] = ed.m;
  }

  // 2. flatten columns → typed arrays for the main thread's picking / highlight / ghost.
  //    boundary/neighbours padded to 6 per column (pentagons use 5; the 6th stays unused / -1).
  const N = columns.length;
  const centers = new Float32Array(N * 3);
  const boundary = new Float32Array(N * 6 * 3);
  const boundaryLen = new Uint8Array(N);
  const neighbors = new Int32Array(N * 6).fill(-1);
  const chunk = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    const col = columns[i], c = col.center;
    centers[i * 3] = c.x; centers[i * 3 + 1] = c.y; centers[i * 3 + 2] = c.z;
    chunk[i] = col.chunk;
    const bl = col.boundary.length;
    boundaryLen[i] = bl;
    for (let k = 0; k < bl; k++) {
      const b = col.boundary[k], o = (i * 6 + k) * 3;
      boundary[o] = b.x; boundary[o + 1] = b.y; boundary[o + 2] = b.z;
      neighbors[i * 6 + k] = col.neighbors[k];
    }
  }
  // transfer the full cells grid (the main thread keeps it resident for picking + on-demand meshing).
  // Safe to transfer the original: the coarse globe below uses its OWN low-FREQ cells, not this one.
  self.postMessage(
    { type: 'topology', centers, boundary, boundaryLen, neighbors, chunk, cells, chunkCount, pentagonCount, river },
    [centers.buffer, boundary.buffer, boundaryLen.buffer, neighbors.buffer, chunk.buffer, cells.buffer],
  );

  // 3. coarse LOD globe: a low-FREQ surface skin of the whole planet (same seed → continents/biomes
  //    line up), built PER CHUNK using the same chunk regions as the fine world (chunkCount is the same,
  //    independent of FREQ). The main thread hides a coarse chunk exactly when its fine chunk streams in
  //    (no overlap → no poke-through), and meshes fine hexel chunks on demand near the camera.
  const cg = buildHexSphere(FREQ_COARSE);
  const ccells = terrainFill(cg.columns, seed);
  const cgroups = Array.from({ length: cg.chunkCount }, () => []);
  for (const col of cg.columns) cgroups[col.chunk].push(col);
  const cpos = [], ccol = [], xfer = [];
  for (let i = 0; i < cg.chunkCount; i++) {
    const s = meshSurfaceSkin(cgroups[i], ccells);
    cpos.push(s.pos); ccol.push(s.col); xfer.push(s.pos.buffer, s.col.buffer);
  }
  self.postMessage({ type: 'coarse', chunkCount: cg.chunkCount, pos: cpos, col: ccol }, xfer);
  self.postMessage({ type: 'done' });
};
