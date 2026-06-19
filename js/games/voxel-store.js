/* voxel-store.js — the voxel grid for the Earth planet (data format v2: per-chunk palette + index).

   Replaces the flat `Uint8Array cells[colId*LAYERS+L]` (1 byte/cell) with a compact per-chunk store:
   each chunk keeps a small PALETTE of the distinct material ids its columns use (palette[0] = AIR) and
   a fixed-height INDEX of palette references (colCount·LAYERS entries), nibble-packed to ½ byte/cell
   when the chunk has ≤16 distinct materials (the common case) — roughly halving resident RAM. Fixed
   `LAYERS` height means edits are in-place (no reallocation); placing above the old surface just flips
   an already-existing air slot.

   All RANDOM-ACCESS readers (picking, physics, the peak scan) and the FINE-chunk mesher go through this
   API, so callers never see the packing. The COARSE globe skin (worker-side) still meshes from a small
   transient flat array — it doesn't use this store.

   Per-block STATE (rotation/color/shape/light, for the later building phase) lives in a SPARSE map keyed
   by cellIndex — it sits on only a handful of player-placed blocks, so a side map is far cheaper than a
   per-cell field and is independent of the material packing. Returns 0 everywhere today. */

import { LAYERS } from '../../data/planet.js';

export const AIR = 0;
export const cellIndex = (colId, L) => colId * LAYERS + L;

// nibble (4-bit) accessors into a packed index byte array: two cells per byte.
const nibGet = (arr, s) => (s & 1) ? (arr[s >> 1] >> 4) : (arr[s >> 1] & 0x0f);
function nibSet(arr, s, v) {
  const bi = s >> 1;
  arr[bi] = (s & 1) ? ((arr[bi] & 0x0f) | (v << 4)) : ((arr[bi] & 0xf0) | v);
}

// linear search of a chunk's live palette (≤256 entries, usually <16) for a material id
function palIndex(ch, mat) { const p = ch.palette, n = ch.count; for (let i = 0; i < n; i++) if (p[i] === mat) return i; return -1; }
// append a new material to a chunk's palette; unpack to 1 byte/cell if it pushes past 16 distinct
function growPalette(ch, mat) {
  if (ch.count >= ch.palette.length) { const np = new Uint8Array(ch.palette.length + 8); np.set(ch.palette); ch.palette = np; }
  const pi = ch.count++; ch.palette[pi] = mat;
  if (ch.packed && pi > 15) unpack(ch);
  return pi;
}
function unpack(ch) {
  const total = ch.colCount * LAYERS, src = ch.index, dst = new Uint8Array(total);
  for (let s = 0; s < total; s++) dst[s] = nibGet(src, s);
  ch.index = dst; ch.packed = false;
}

export class VoxelStore {
  constructor(chunks, colChunk, colLocal) {
    this.chunks = chunks;        // per-chunk { colCount, palette:Uint8Array, count, index:Uint8Array, packed }
    this.colChunk = colChunk;    // Uint16Array(N): colId -> chunk id
    this.colLocal = colLocal;    // Uint32Array(N): colId -> local column index within its chunk
    this.state = new Map();      // sparse cellIndex -> packed state (0 elsewhere)
  }

  getMat(colId, L) {
    const ch = this.chunks[this.colChunk[colId]];
    const slot = this.colLocal[colId] * LAYERS + L;
    return ch.palette[ch.packed ? nibGet(ch.index, slot) : ch.index[slot]];
  }
  setMat(colId, L, mat) {
    const ch = this.chunks[this.colChunk[colId]];
    let pi = palIndex(ch, mat);
    if (pi < 0) pi = growPalette(ch, mat);
    const slot = this.colLocal[colId] * LAYERS + L;
    if (ch.packed) nibSet(ch.index, slot, pi); else ch.index[slot] = pi;
  }
  // highest non-air layer in a column, or -1 (Earth columns always have a solid core, so ≥0)
  getTop(colId) {
    const ch = this.chunks[this.colChunk[colId]], sb = this.colLocal[colId] * LAYERS, idx = ch.index, pal = ch.palette;
    if (ch.packed) { for (let L = LAYERS - 1; L >= 0; L--) if (pal[nibGet(idx, sb + L)] !== AIR) return L; }
    else { for (let L = LAYERS - 1; L >= 0; L--) if (pal[idx[sb + L]] !== AIR) return L; }
    return -1;
  }

  getState(colId, L) { return this.state.get(colId * LAYERS + L) || 0; }
  setState(colId, L, v) { const ci = colId * LAYERS + L; if (v) this.state.set(ci, v); else this.state.delete(ci); }

  // resident byte size of the material store (for verification/measurement)
  byteLength() {
    let b = this.colChunk.byteLength + this.colLocal.byteLength;
    for (const ch of this.chunks) b += ch.index.byteLength + ch.palette.byteLength;
    return b;
  }
}

/* Build the per-chunk palette store from a transient flat `Uint8Array` (the worker's generated grid).
   The flat array can be freed afterwards — the store is the resident representation. */
export function compactToStore(columns, flat, chunkCount) {
  const N = columns.length;
  const colChunk = new Uint16Array(N), colLocal = new Uint32Array(N), counts = new Uint32Array(chunkCount);
  for (let i = 0; i < N; i++) { const ch = columns[i].chunk; colChunk[i] = ch; colLocal[i] = counts[ch]++; }
  // per-chunk column id lists, ordered by local index (so index layout matches colLocal)
  const chCols = Array.from({ length: chunkCount }, (_, c) => new Array(counts[c]));
  for (let i = 0; i < N; i++) chCols[colChunk[i]][colLocal[i]] = i;

  // per-column top (highest non-air layer) so the passes skip the air above the surface (~78% of cells)
  const tops = new Int16Array(N);
  for (let i = 0; i < N; i++) { const base = i * LAYERS; let t = -1; for (let L = LAYERS - 1; L >= 0; L--) if (flat[base + L] !== AIR) { t = L; break; } tops[i] = t; }

  const seen = new Int16Array(256);                 // material id → palette index (reused per chunk; -1 = unseen)
  const chunks = new Array(chunkCount);
  for (let c = 0; c < chunkCount; c++) {
    const cols = chCols[c], colCount = cols.length;
    if (!colCount) { chunks[c] = { colCount: 0, palette: new Uint8Array(1), count: 1, index: new Uint8Array(0), packed: true }; continue; }
    // pass A: distinct materials → palette (AIR = index 0). Flat int-array lookup, not a Map (hot path).
    seen.fill(-1); seen[0] = 0; const palette = [0];
    for (let lc = 0; lc < colCount; lc++) {
      const base = cols[lc] * LAYERS, top = tops[cols[lc]];
      for (let L = 0; L <= top; L++) { const m = flat[base + L]; if (seen[m] < 0) { seen[m] = palette.length; palette.push(m); } }
    }
    const count = palette.length, packed = count <= 16, total = colCount * LAYERS;
    const index = packed ? new Uint8Array((total + 1) >> 1) : new Uint8Array(total);   // zero-filled = AIR (palette[0])
    // pass B: write palette indices for non-air cells only (air slots already 0)
    for (let lc = 0; lc < colCount; lc++) {
      const id = cols[lc], base = id * LAYERS, top = tops[id], sb = lc * LAYERS;
      for (let L = 0; L <= top; L++) { const m = flat[base + L]; if (m === AIR) continue; const pi = seen[m]; if (packed) nibSet(index, sb + L, pi); else index[sb + L] = pi; }
    }
    chunks[c] = { colCount, palette: new Uint8Array(palette), count, index, packed };
  }
  return new VoxelStore(chunks, colChunk, colLocal);
}
