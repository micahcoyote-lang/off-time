/* planet-worker.js — Earth ASYNC chunk gen+mesh service (Phase C "async world").

   The Phase-C cutover streams a PlanetSmith-scale planet by generating + meshing one sub-region CHUNK at a
   time. Doing that synchronously on the render thread froze the game (multi-second gen per chunk at FREQ 290).
   This worker moves GENERATION + MESHING off-thread: the main thread keeps a small resident store of already-
   delivered chunks and reads it synchronously (physics/picking), while this worker generates ahead-of-need and
   ships finished chunks back as TRANSFERABLE buffers (zero-copy). Chunks "pop in" — the loop never blocks.

   Protocol:
     main → worker : { type:'init',    freq, seed, S, edits:[{ci,m,st}] }
                     { type:'request', chunkKeys:[..], priority?:bool }   (queue chunks to gen+mesh)
                     { type:'release', chunkKeys:[..] }                   (drop queued/far chunks)
                     { type:'edit',    edits:[{ci,m,st}] }                (bake a player edit into future gen)
     worker → main : { type:'ready' }
                     { type:'chunk', chunkKey, empty?, cells, sPos,sCol,sTile, wPos,wCol }  (one per chunk, transferables)

   This is a MODULE worker (`{type:'module'}`) so it `import`s the same engine modules the page uses. The mesher
   (meshChunkArrays) is worker-safe: it emits geometry arrays + tile ids only — the texture atlas / materials
   stay on the main thread. */

import { LAYERS } from '../../data/planet.js';
import { meshChunkArrays } from './planet-mesh.js';
import { StreamWorld } from './planet-stream.js';
import { chunkColumnObjects } from './planet-region.js';
import { chunkOf, decodeId } from './icosphere-address.js';

let world = null;             // worker-side StreamWorld (ChunkCache + edit baking + getMat for meshing)
let f = 0, S = 0;
const queue = [];             // chunkKeys waiting to be generated + meshed (FIFO; priority unshifts)
const queued = new Set();     // membership of `queue` (dedupe)
let pumping = false;

self.onmessage = (e) => {
  const msg = e.data; if (!msg) return;
  switch (msg.type) {
    case 'init': {
      f = msg.freq; S = msg.S;
      const edits = new Map(), editStates = new Map();
      if (Array.isArray(msg.edits)) for (const ed of msg.edits) { edits.set(ed.ci, ed.m); if (ed.st) editStates.set(ed.ci, ed.st); }
      world = new StreamWorld(msg.freq, msg.seed, msg.S, edits, editStates);
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
    case 'release': {
      for (const k of (msg.chunkKeys || [])) queued.delete(k);   // pump() skips keys no longer queued
      break;
    }
    case 'edit': {
      if (Array.isArray(msg.edits)) for (const ed of msg.edits) applyEdit(ed.ci, ed.m, ed.st || 0);
      break;
    }
  }
};

// record a player edit so the worker bakes it into any (re)generation of that chunk, and patch the cached
// chunk in place if it's already resident (so a later re-ship of the same chunk is correct after eviction).
function applyEdit(ci, m, st) {
  if (!world) return;
  world._indexEdit(ci, m);
  const id = Math.floor(ci / LAYERS), L = ci - id * LAYERS;
  world.setState(id, L, st);
  const ck = chunkOf(decodeId(id, f), f, S), ce = world.cache.map.get(ck);
  if (ce) { const lc = ce.data.idToLocal.get(id); if (lc !== undefined) ce.data.cells[lc * LAYERS + L] = m; }
}

// process ONE chunk per macrotask, yielding via setTimeout(0) between chunks so incoming messages
// (priority requests, releases, edits) interleave — the worker never blocks its own message queue.
function pump() {
  // skip released keys
  while (queue.length && !queued.has(queue[0])) queue.shift();
  if (!queue.length) { pumping = false; return; }
  const k = queue.shift(); queued.delete(k);
  try {
    const cols = chunkColumnObjects(k, f, S);
    if (!cols.length) { self.postMessage({ type: 'chunk', chunkKey: k, empty: true }); }
    else {
      const mesh = meshChunkArrays(cols, world);                 // world bakes edits + generates neighbours for culling
      const data = world._chunk(k);                              // edit-baked cells of chunk k
      const cells = data.cells.slice();                          // copy so the worker's cache stays intact after transfer
      self.postMessage(
        { type: 'chunk', chunkKey: k, cells, sPos: mesh.sPos, sCol: mesh.sCol, sTile: mesh.sTile, wPos: mesh.wPos, wCol: mesh.wCol },
        [cells.buffer, mesh.sPos.buffer, mesh.sCol.buffer, mesh.sTile.buffer, mesh.wPos.buffer, mesh.wCol.buffer],
      );
    }
  } catch (err) {
    // report as an ERROR (not empty) so the main thread retries it rather than caching a permanent hole.
    const detail = String(err && err.stack || err);
    console.error('[planet-worker] chunk gen failed', k, detail);
    self.postMessage({ type: 'chunk', chunkKey: k, error: detail });
  }
  setTimeout(pump, 0);
}
