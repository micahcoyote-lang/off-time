/* planet-worker.js — Earth ASYNC chunk gen+mesh service (Phase C "async world").

   The Phase-C cutover streams the planet as sub-region CHUNKS so the render thread never blocks on generation.
   This worker does the heavy work off-thread; the main thread keeps a small resident store of delivered chunks
   and reads it synchronously (physics/picking), so chunks "pop in" — the loop never freezes.

   STRATEGY (FREQ ~290, which fits in RAM): generate the WHOLE planet ONCE at init (one genColumns pass over
   every structured column — the same proven cost as the old resident terrainFill, just off-thread), hold it as
   a flat cell grid, then serve each requested chunk's MESH instantly (no per-request generation, no halo
   re-computation). This makes the world feel "preloaded": after a few-second initial gen, chunks mesh + stream
   in as fast as the main thread can build BufferGeometry. (For PlanetSmith scale — too big for RAM — swap the
   init for the on-demand per-chunk ChunkCache path in planet-region.js; the request/response protocol is the
   same either way.)

   Protocol:
     main → worker : { type:'init',    freq, seed, S, edits:[{ci,m,st}] }
                     { type:'request', chunkKeys:[..], priority?:bool }   (queue chunks to mesh)
                     { type:'release', chunkKeys:[..] }                   (drop queued/far chunks)
                     { type:'edit',    edits:[{ci,m,st}] }                (apply a player edit to the grid)
     worker → main : { type:'ready' }                                    (whole-planet gen finished)
                     { type:'chunk', chunkKey, empty?, error?, cells, sPos,sCol,sTile, wPos,wCol }  (transferables)

   Module worker (`{type:'module'}`); the mesher (meshChunkArrays) is worker-safe (geometry arrays + tile ids
   only — the texture atlas / materials stay on the main thread). */

import { LAYERS } from '../../data/planet.js';
import { meshChunkArrays } from './planet-mesh.js';
import { genColumns, chunkColumnObjects } from './planet-region.js';
import { regionColumns, chunkColumns, encodeId, REGION_COUNT } from './icosphere-address.js';

const AIR = 0;
let f = 0, S = 0;
let cells = null;             // flat whole-planet voxel grid (Uint8Array, indexed by globalIdToLocal*LAYERS+L)
let idToLocal = null;         // structured column id -> row in `cells`
const state = new Map();      // cellIndex (id*LAYERS+L) -> packed block state
const queue = [];             // chunkKeys waiting to be meshed (FIFO; priority unshifts)
const queued = new Set();     // membership of `queue` (dedupe)
let pumping = false;

// the store surface meshChunkArrays needs, reading the resident whole-planet grid (cross-chunk culling = free).
const store = {
  getMat(id, L) { const lc = idToLocal.get(id); return lc === undefined ? AIR : cells[lc * LAYERS + L]; },
  setMat(id, L, m) { const lc = idToLocal.get(id); if (lc !== undefined) cells[lc * LAYERS + L] = m; },
  getTop(id) { const lc = idToLocal.get(id); if (lc === undefined) return -1; const b = lc * LAYERS; for (let L = LAYERS - 1; L >= 0; L--) if (cells[b + L] !== AIR) return L; return -1; },
  getState(id, L) { return state.get(id * LAYERS + L) || 0; },
  setState(id, L, v) { const ci = id * LAYERS + L; if (v) state.set(ci, v); else state.delete(ci); },
};

self.onmessage = (e) => {
  const msg = e.data; if (!msg) return;
  switch (msg.type) {
    case 'init': {
      f = msg.freq; S = msg.S;
      // generate every structured column in one pass (halo is a no-op when the set is the whole planet).
      const all = [];
      for (let r = 0; r < REGION_COUNT; r++) { const rc = regionColumns(r, f); for (let i = 0; i < rc.length; i++) all.push(rc[i]); }
      const world = genColumns(all, f, msg.seed);
      cells = world.cells; idToLocal = world.idToLocal;
      if (Array.isArray(msg.edits)) for (const ed of msg.edits) applyEdit(ed.ci, ed.m, ed.st || 0);
      self.postMessage({ type: 'ready' });
      break;
    }
    case 'request': {
      const keys = msg.chunkKeys || [];
      if (msg.priority) { for (let i = keys.length - 1; i >= 0; i--) { const k = keys[i]; if (!queued.has(k)) { queued.add(k); queue.unshift(k); } } }
      else { for (const k of keys) if (!queued.has(k)) { queued.add(k); queue.push(k); } }
      if (!pumping) { pumping = true; pump(); }
      break;
    }
    case 'release': { for (const k of (msg.chunkKeys || [])) queued.delete(k); break; }   // pump() skips dequeued keys
    case 'edit': { if (Array.isArray(msg.edits)) for (const ed of msg.edits) applyEdit(ed.ci, ed.m, ed.st || 0); break; }
  }
};

function applyEdit(ci, m, st) {
  if (!cells) return;
  const id = Math.floor(ci / LAYERS), L = ci - id * LAYERS, lc = idToLocal.get(id);
  if (lc !== undefined) cells[lc * LAYERS + L] = m;
  store.setState(id, L, st);
}

// mesh ONE chunk per macrotask, yielding via setTimeout(0) so incoming messages (priority/release/edit)
// interleave. Meshing reads the resident grid — instant; there's no generation in the hot path.
function pump() {
  while (queue.length && !queued.has(queue[0])) queue.shift();
  if (!queue.length) { pumping = false; return; }
  const k = queue.shift(); queued.delete(k);
  try {
    const cols = chunkColumnObjects(k, f, S);
    if (!cols.length) { self.postMessage({ type: 'chunk', chunkKey: k, empty: true }); }
    else {
      const mesh = meshChunkArrays(cols, store);
      // assemble this chunk's own cells (in chunkColumns order) for the main thread's resident store.
      const ckCols = chunkColumns(k, f, S), n = ckCols.length, cc = new Uint8Array(n * LAYERS);
      for (let i = 0; i < n; i++) { const lc = idToLocal.get(encodeId(ckCols[i].region, ckCols[i].local, f)); if (lc !== undefined) cc.set(cells.subarray(lc * LAYERS, lc * LAYERS + LAYERS), i * LAYERS); }
      self.postMessage(
        { type: 'chunk', chunkKey: k, cells: cc, sPos: mesh.sPos, sCol: mesh.sCol, sTile: mesh.sTile, wPos: mesh.wPos, wCol: mesh.wCol },
        [cc.buffer, mesh.sPos.buffer, mesh.sCol.buffer, mesh.sTile.buffer, mesh.wPos.buffer, mesh.wCol.buffer],
      );
    }
  } catch (err) {
    const detail = String(err && err.stack || err);
    console.error('[planet-worker] chunk mesh failed', k, detail);
    self.postMessage({ type: 'chunk', chunkKey: k, error: detail });
  }
  setTimeout(pump, 0);
}
