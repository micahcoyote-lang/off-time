/* planet-worker.js — Earth world-generation worker (Engine E2).

   Runs the heavy, formerly-blocking generation OFF the main thread: topology (buildHexSphere) +
   terrain (terrainFill, + any saved edits) + per-chunk meshing, then STREAMS the result to earth.js
   as TRANSFERABLE buffers (zero-copy). The main thread stays responsive the whole time — it renders
   the progress overlay and can even orbit while the world streams in.

   Protocol:
     main → worker : { type:'init', freq, seed, edits:[{c,m}] }
     worker → main : { type:'topology', centers, boundary, boundaryLen, neighbors, chunk, cells,
                       chunkCount, pentagonCount }                     (one message, transferables)
                     { type:'chunk', chunkId, sPos, sCol, wPos, wCol, built, total }  (one per chunk)
                     { type:'done' }

   This is a MODULE worker (`{type:'module'}`), so it can `import` the same ES modules the page uses. */

import { buildHexSphere } from './hexsphere.js';
import { terrainFill, meshChunkArrays } from './planet-mesh.js';

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'init') return;
  const { freq, seed, edits } = msg;

  // 1. topology + terrain (+ saved edits) — the work that used to freeze the page, now off-thread
  const { columns, pentagonCount, chunkCount } = buildHexSphere(freq);
  const cells = terrainFill(columns, seed);
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
  // copy cells for the transfer (we still need our own `cells` to mesh from below)
  const cellsForMain = cells.slice();
  self.postMessage(
    { type: 'topology', centers, boundary, boundaryLen, neighbors, chunk, cells: cellsForMain, chunkCount, pentagonCount },
    [centers.buffer, boundary.buffer, boundaryLen.buffer, neighbors.buffer, chunk.buffer, cellsForMain.buffer],
  );

  // 3. mesh each chunk and stream it (transferring the geometry buffers). The worker posts after each
  //    chunk, so the main thread renders them progressively while later chunks are still meshing.
  const groups = Array.from({ length: chunkCount }, () => []);
  for (const col of columns) groups[col.chunk].push(col);
  for (let id = 0; id < chunkCount; id++) {
    const a = meshChunkArrays(groups[id], cells);
    self.postMessage(
      { type: 'chunk', chunkId: id, sPos: a.sPos, sCol: a.sCol, wPos: a.wPos, wCol: a.wCol, built: id + 1, total: chunkCount },
      [a.sPos.buffer, a.sCol.buffer, a.wPos.buffer, a.wCol.buffer],
    );
  }
  self.postMessage({ type: 'done' });
};
