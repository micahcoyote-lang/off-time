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
import { meshChunkArrays } from './planet-mesh.js';
import { ChunkCache, ChunkWorld, chunkColumnObjects } from './planet-region.js';
import { addressOf, chunkOf, chunksWithin } from './icosphere-address.js';

export class ChunkStreamer {
  constructor({ scene, f, seed, S = 24, solidMat, waterMat, radiusCols = 2.6 * 24, maxChunks = 700 }) {
    this.f = f; this.seed = seed; this.S = S;
    this.cache = new ChunkCache(f, seed, S, maxChunks);
    this.world = new ChunkWorld(this.cache);
    this.solidMat = solidMat; this.waterMat = waterMat;
    this.radiusCols = radiusCols;
    this.group = new THREE.Group(); scene.add(this.group);
    this.active = new Map();        // chunkKey -> { solid?:Mesh, water?:Mesh, empty?:bool }
    this.pending = [];              // chunkKeys queued to mesh
    this.lastChunk = null;
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
