/* planet-stream.js — on-demand CHUNK streaming around a moving camera (Phase C / 4-B, stage C3).

   Maintains a live set of meshed chunks near an `anchor` (the unit surface direction under the camera):
   loads chunks that come into range (generate via ChunkCache → mesh via the reused meshChunkArrays with
   cross-chunk neighbour culling), unloads chunks that fall out of range (free GPU geometry + let the cache
   LRU-evict their voxels). This is what lets Earth render a planet far larger than fits in RAM — only the
   chunks near you are ever resident. The existing fine-chunk mesher and the full-colour terrain material are
   reused unchanged; this module is purely the load/unload bookkeeping.

   Decoupled from earth.js: the host passes a THREE scene, the materials, and calls update(anchor, budgetMs)
   each frame. Verified first in region-test.html before the earth.js cutover. */

import * as THREE from '../../assets/vendor/three.module.js';
import { LAYERS } from '../../data/planet.js';
import { meshChunkArrays } from './planet-mesh.js';
import { ChunkCache, chunkColumnObjects } from './planet-region.js';
import { addressOf, chunkOf, chunksWithin, chunksNear, chunkCentroids, chunkColumns,
  encodeId, decodeId, columnGeometry } from './icosphere-address.js';

const AIR = 0;

/* StreamWorld — the world facade the game (earth.js) talks to in region-streaming mode. It IS the voxel
   store (getMat/getTop/getState/setState API, keyed by structured column id), generates chunks on demand,
   and PERSISTS player edits across chunk eviction/regeneration (the one new requirement vs the resident
   store). It also provides columnOf(id) (geometry on demand, cached) and nearestColumn(x,y,z) so earth.js's
   picking/physics/landmark code maps over cleanly. Holds the LRU ChunkCache; the ChunkStreamer renders from
   the same instance so edits show immediately. */
export class StreamWorld {
  constructor(f, seed, S, edits = new Map(), editStates = new Map()) {
    this.f = f; this.S = S;
    this.editsByChunk = new Map();           // chunkKey -> Map(cellIndex -> matnum)  (player material edits)
    this.state = new Map();                  // cellIndex (id*LAYERS+L) -> packed block state; mirrors VoxelStore.state
    for (const [ci, m] of edits) this._indexEdit(ci, m);
    for (const [ci, v] of editStates) this.state.set(ci, v);
    this.cache = new ChunkCache(f, seed, S, 800);
    this.colCache = new Map();               // id -> column object {id, center, boundary, neighbors, chunk}
  }
  _indexEdit(ci, m) {
    const id = Math.floor(ci / LAYERS), ck = chunkOf(decodeId(id, this.f), this.f, this.S);
    let e = this.editsByChunk.get(ck); if (!e) { e = new Map(); this.editsByChunk.set(ck, e); }
    e.set(ci, m);
  }
  // chunk data with player edits re-stamped (each fresh generation reapplies them → survives LRU eviction)
  _chunk(ck) {
    const data = this.cache.get(ck);
    if (!data._editsApplied) {
      data._editsApplied = true;
      const e = this.editsByChunk.get(ck);
      if (e) for (const [ci, m] of e) {
        const id = Math.floor(ci / LAYERS), L = ci - id * LAYERS, lc = data.idToLocal.get(id);
        if (lc !== undefined) data.cells[lc * LAYERS + L] = m;
      }
    }
    return data;
  }
  _at(id) { const data = this._chunk(chunkOf(decodeId(id, this.f), this.f, this.S)); return { data, base: data.idToLocal.get(id) * LAYERS }; }
  getMat(id, L) { const a = this._at(id); return a.data.cells[a.base + L]; }
  setMat(id, L, m) { const a = this._at(id); a.data.cells[a.base + L] = m; }
  getTop(id) { const a = this._at(id); for (let L = LAYERS - 1; L >= 0; L--) if (a.data.cells[a.base + L] !== AIR) return L; return -1; }
  getState(id, L) { return this.state.get(id * LAYERS + L) || 0; }
  setState(id, L, v) { const ci = id * LAYERS + L; if (v) this.state.set(ci, v); else this.state.delete(ci); }
  // record + apply a player edit so it survives chunk eviction (the game calls this instead of setMat)
  edit(id, L, m, st = 0) { this._indexEdit(id * LAYERS + L, m); const a = this._at(id); a.data.cells[a.base + L] = m; this.setState(id, L, st); }
  // mesher-ready column object (cached): geometry reconstructed from the address
  columnOf(id) {
    let c = this.colCache.get(id); if (c) return c;
    const addr = decodeId(id, this.f), g = columnGeometry(addr, this.f);
    c = { id, center: g.center, boundary: g.boundary, neighbors: g.neighborAddrs.map((a) => encodeId(a.region, a.local, this.f)), isPentagon: g.isPentagon, chunk: chunkOf(addr, this.f, this.S) };
    this.colCache.set(id, c); return c;
  }
  nearestColumn(x, y, z) { const a = addressOf(new THREE.Vector3(x, y, z), this.f); return encodeId(a.region, a.local, this.f); }
}

export class ChunkStreamer {
  constructor({ scene, world, solidMat, waterMat, radiusCols }) {
    this.world = world; this.f = world.f; this.S = world.S; this.cache = world.cache;
    this.solidMat = solidMat; this.waterMat = waterMat;
    this.radiusCols = radiusCols != null ? radiusCols : 2.6 * world.S;
    this.group = new THREE.Group(); scene.add(this.group);
    this.active = new Map();        // chunkKey -> { solid?:Mesh, water?:Mesh, empty?:bool }
    this.pending = [];              // chunkKeys queued to mesh
    this.lastChunk = null;
  }

  // re-mesh the given active chunk keys after an edit (the chunk + its neighbours, since edits at a chunk
  // boundary change the other side's culling). Skips chunks not currently loaded.
  rebuild(chunkKeys) {
    for (const ck of chunkKeys) { const e = this.active.get(ck); if (e) { this._dispose(e); this.active.delete(ck); this._load(ck); } }
  }

  // call each frame with the unit surface direction under the camera; meshes up to ~budgetMs of new chunks.
  update(anchor, budgetMs = 6) {
    const cur = chunkOf(addressOf(anchor, this.f), this.f, this.S);
    if (cur !== this.lastChunk) {
      this.lastChunk = cur;
      const desired = chunksWithin(anchor, this.f, this.S, this.radiusCols);
      for (const [k, e] of this.active) if (!desired.has(k)) { this._dispose(e); this.active.delete(k); }
      this.pending = [...desired].filter((k) => !this.active.has(k));
    }
    const t0 = performance.now();
    while (this.pending.length && performance.now() - t0 < budgetMs) {
      const k = this.pending.shift();
      if (!this.active.has(k)) this._load(k);
    }
    return { active: this.active.size, pending: this.pending.length, cached: this.cache.map.size };
  }

  _load(k) {
    const cols = chunkColumnObjects(k, this.f, this.S);
    if (!cols.length) { this.active.set(k, { empty: true }); return; }
    const m = meshChunkArrays(cols, this.world);
    const entry = {};
    if (m.sPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.sPos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(m.sCol, 3));
      g.setAttribute('tile', new THREE.BufferAttribute(m.sTile, 1));
      g.computeVertexNormals(); g.computeBoundingSphere();
      entry.solid = new THREE.Mesh(g, this.solidMat); entry.solid.castShadow = entry.solid.receiveShadow = true;
      this.group.add(entry.solid);
    }
    if (m.wPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.wPos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(m.wCol, 3));
      g.computeBoundingSphere();
      entry.water = new THREE.Mesh(g, this.waterMat); entry.water.renderOrder = 1;
      this.group.add(entry.water);
    }
    this.active.set(k, entry);
  }

  _dispose(e) {
    if (e.solid) { this.group.remove(e.solid); e.solid.geometry.dispose(); }
    if (e.water) { this.group.remove(e.water); e.water.geometry.dispose(); }
  }

  dispose() {
    for (const e of this.active.values()) this._dispose(e);
    this.active.clear(); this.pending = [];
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

/* AsyncWorld — the "async world" model (Phase C cutover linchpin). It is BOTH the voxel store the game reads
   synchronously (getMat/getTop/getState, keyed by structured column id) AND the streaming manager that renders
   the planet around the player. The difference from the synchronous StreamWorld+ChunkStreamer it replaces:
   generation + meshing happen OFF the main thread in planet-worker.js, and reads only ever touch chunks the
   worker has already DELIVERED (the resident store). A chunk the worker hasn't shipped yet is "not loaded" —
   reads return AIR and `loaded(id)` is false, so the game can hold physics / suppress picking until it arrives
   (Minecraft-style pop-in) instead of freezing the render thread on multi-second generation.

   Resident store : Map(chunkKey -> { cells, idToLocal, solid:Mesh, water:Mesh, empty }). getMat/getTop read it.
   Streaming      : update(anchor) computes the desired chunk disc (chunksNear, fast), requests the missing ones
                    from the worker, unloads far ones. Incoming chunk messages build BufferGeometry + meshes.
   Edits          : edit() mutates resident cells in place + re-stamps for persistence + tells the worker to bake
                    the edit into future regen; the game then calls rebuild() to re-mesh the touched chunk on the
                    main thread (~30ms, instant) since its neighbours are resident. */
const _nv = new THREE.Vector3();
export class AsyncWorld {
  constructor({ scene, freq, seed, S, solidMat, waterMat, radiusCols, edits = new Map(), editStates = new Map() }) {
    this.f = freq; this.seed = seed; this.S = S;
    this.radiusCols = radiusCols != null ? radiusCols : 2.5 * S;
    this.solidMat = solidMat; this.waterMat = waterMat;
    this.chunks = new Map();          // chunkKey -> { cells, idToLocal, solid, water, empty }   (resident store)
    this.cache = { map: this.chunks };// compat shim: earth.js debug reads fw.cache.map.size
    this.state = new Map();           // cellIndex (id*LAYERS+L) -> packed block state (main-thread authoritative)
    this.editsByChunk = new Map();    // chunkKey -> Map(cellIndex -> matnum)   (re-stamped onto incoming chunks)
    this.colCache = new Map();        // id -> column object {id, center, boundary, neighbors, isPentagon, chunk}
    this.requested = new Set();       // chunkKeys in flight to the worker
    this.desired = new Set();         // chunkKeys that should be resident
    this.lastChunk = null;
    this.onChunk = null;              // optional callback(chunkKey) when a chunk arrives (spawn gating)
    for (const [ci, m] of edits) this._indexEdit(ci, m);
    for (const [ci, v] of editStates) this.state.set(ci, v);
    chunkCentroids(freq, S);          // pre-warm the centroid table (chunksNear uses it every chunk-change)
    this.group = new THREE.Group(); scene.add(this.group);
    // module worker: gen + mesh off-thread. Messages are processed in order, so requests queued right after
    // init are handled after the worker sets up its world — no need to await 'ready'.
    this.worker = new Worker(new URL('./planet-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this._onMessage(e.data);
    this.worker.postMessage({ type: 'init', freq, seed, S, edits: [...edits].map(([ci, m]) => ({ ci, m, st: editStates.get(ci) || 0 })) });
  }

  // ---- resident voxel store (synchronous reads against delivered chunks only) ----
  _entry(id) { return this.chunks.get(chunkOf(decodeId(id, this.f), this.f, this.S)); }
  loaded(id) { const e = this._entry(id); return e !== undefined; }
  getMat(id, L) { const e = this._entry(id); if (!e || e.empty) return AIR; const b = e.idToLocal.get(id); return b === undefined ? AIR : e.cells[b * LAYERS + L]; }
  getTop(id) { const e = this._entry(id); if (!e || e.empty) return -1; const b = e.idToLocal.get(id); if (b === undefined) return -1; const base = b * LAYERS; for (let L = LAYERS - 1; L >= 0; L--) if (e.cells[base + L] !== AIR) return L; return -1; }
  setMat(id, L, m) { const e = this._entry(id); if (e && !e.empty) { const b = e.idToLocal.get(id); if (b !== undefined) e.cells[b * LAYERS + L] = m; } }
  getState(id, L) { return this.state.get(id * LAYERS + L) || 0; }
  setState(id, L, v) { const ci = id * LAYERS + L; if (v) this.state.set(ci, v); else this.state.delete(ci); }

  _indexEdit(ci, m) {
    const id = Math.floor(ci / LAYERS), ck = chunkOf(decodeId(id, this.f), this.f, this.S);
    let e = this.editsByChunk.get(ck); if (!e) { e = new Map(); this.editsByChunk.set(ck, e); }
    e.set(ci, m);
  }
  // record + apply a player edit: mutate resident cells, persist (re-stamp), and tell the worker to bake it.
  edit(id, L, m, st = 0) {
    const ci = id * LAYERS + L;
    this._indexEdit(ci, m); this.setState(id, L, st); this.setMat(id, L, m);
    this.worker.postMessage({ type: 'edit', edits: [{ ci, m, st }] });
  }

  // mesher-ready column object (cached): geometry reconstructed from the structured address.
  columnOf(id) {
    let c = this.colCache.get(id); if (c) return c;
    const addr = decodeId(id, this.f), g = columnGeometry(addr, this.f);
    c = { id, center: g.center, boundary: g.boundary, neighbors: g.neighborAddrs.map((a) => encodeId(a.region, a.local, this.f)), isPentagon: g.isPentagon, chunk: chunkOf(addr, this.f, this.S) };
    this.colCache.set(id, c); return c;
  }
  nearestColumn(x, y, z) { const a = addressOf(_nv.set(x, y, z), this.f); return encodeId(a.region, a.local, this.f); }

  // ---- streaming: keep the chunk disc around `anchor` resident ----
  update(anchor) {
    const { chunks: desired, current } = chunksNear(anchor, this.f, this.S, this.radiusCols);
    if (current === this.lastChunk) return { active: this.chunks.size, pending: this.requested.size, cached: this.chunks.size };
    this.lastChunk = current; this.desired = desired;
    for (const ck of [...this.chunks.keys()]) if (!desired.has(ck)) this._unload(ck);    // unload far chunks
    const drop = [];
    for (const ck of this.requested) if (!desired.has(ck)) drop.push(ck);                 // cancel far in-flight
    for (const ck of drop) this.requested.delete(ck);
    const need = [];
    for (const ck of desired) if (!this.chunks.has(ck) && !this.requested.has(ck)) need.push(ck);
    if (drop.length) this.worker.postMessage({ type: 'release', chunkKeys: drop });
    if (need.length) {
      need.sort((a, b) => (a === current ? -1 : b === current ? 1 : 0));                  // player's own chunk first
      for (const ck of need) this.requested.add(ck);
      this.worker.postMessage({ type: 'request', chunkKeys: need });
    }
    return { active: this.chunks.size, pending: this.requested.size, cached: this.chunks.size };
  }
  get active() { return this.chunks; }     // compat: earth.js debug iterates fstream.active.values()

  // request a set of chunks immediately (used for spawn priming, before update() runs).
  request(chunkKeys, priority = false) {
    const need = chunkKeys.filter((ck) => !this.chunks.has(ck) && !this.requested.has(ck));
    if (!need.length) return;
    for (const ck of need) { this.requested.add(ck); this.desired.add(ck); }
    this.worker.postMessage({ type: 'request', chunkKeys: need, priority });
  }

  _onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'chunk') this._applyChunk(msg);
    // 'ready' is informational — message ordering guarantees init runs before queued requests.
  }
  _applyChunk(msg) {
    const ck = msg.chunkKey;
    this.requested.delete(ck);
    if (msg.error) { console.warn('[asyncworld] chunk gen failed; will retry', ck, msg.error); return; }   // don't cache → re-requested next disc cycle
    if (this.lastChunk !== null && this.desired.size && !this.desired.has(ck)) return;    // player moved away; drop stale
    if (this.chunks.has(ck)) this._unload(ck);    // a duplicate message (move-away-then-back race) → dispose the old meshes first
    if (msg.empty) { this.chunks.set(ck, { empty: true }); if (this.onChunk) this.onChunk(ck); return; }
    const cols = chunkColumns(ck, this.f, this.S), idToLocal = new Map();
    for (let i = 0; i < cols.length; i++) idToLocal.set(encodeId(cols[i].region, cols[i].local, this.f), i);
    const cells = msg.cells, ed = this.editsByChunk.get(ck);
    if (ed) for (const [ci, m] of ed) { const id = Math.floor(ci / LAYERS), L = ci - id * LAYERS, b = idToLocal.get(id); if (b !== undefined) cells[b * LAYERS + L] = m; }   // re-stamp edits
    const entry = { cells, idToLocal, solid: null, water: null, empty: false };
    this._buildMeshes(entry, msg);
    this.chunks.set(ck, entry);
    if (this.onChunk) this.onChunk(ck);
  }
  _buildMeshes(entry, m) {
    if (m.sPos && m.sPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.sPos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(m.sCol, 3));
      g.setAttribute('tile', new THREE.BufferAttribute(m.sTile, 1));
      g.computeVertexNormals(); g.computeBoundingSphere();
      entry.solid = new THREE.Mesh(g, this.solidMat); entry.solid.castShadow = entry.solid.receiveShadow = true;
      this.group.add(entry.solid);
    }
    if (m.wPos && m.wPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.wPos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(m.wCol, 3));
      g.computeBoundingSphere();
      entry.water = new THREE.Mesh(g, this.waterMat); entry.water.renderOrder = 1;
      this.group.add(entry.water);
    }
  }
  _unload(ck) {
    const e = this.chunks.get(ck); if (!e) return;
    if (e.solid) { this.group.remove(e.solid); e.solid.geometry.dispose(); }
    if (e.water) { this.group.remove(e.water); e.water.geometry.dispose(); }
    this.chunks.delete(ck);
  }

  // re-mesh resident chunks on the MAIN thread after an edit (the chunk + its neighbours, since a boundary edit
  // changes the other side's culling). Neighbours are resident (player is at the disc centre), so this is exact.
  rebuild(chunkKeys) {
    for (const ck of chunkKeys) {
      const e = this.chunks.get(ck); if (!e || e.empty) continue;
      if (e.solid) { this.group.remove(e.solid); e.solid.geometry.dispose(); e.solid = null; }
      if (e.water) { this.group.remove(e.water); e.water.geometry.dispose(); e.water = null; }
      const mesh = meshChunkArrays(chunkColumnObjects(ck, this.f, this.S), this);
      this._buildMeshes(e, mesh);
    }
  }

  dispose() {
    if (this.worker) this.worker.terminate();
    for (const ck of [...this.chunks.keys()]) this._unload(ck);
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
