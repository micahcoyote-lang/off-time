/* texture-atlas.js — procedural block textures for the hexel planet (Phase: textured surfaces).

   Draws one pixel-art tile per MATERIAL into a single canvas atlas at runtime (no binary assets, no art
   pipeline — and a real authored PNG atlas can be dropped in later via loadAtlasImage). The chunk mesher
   tags each vertex with a TILE index (= material num − 1); the terrain material samples this atlas
   triplanar-ly (see buildPlanetChunks' onBeforeCompile) so hexagonal faces texture cleanly without UVs.

   Layout: COLS tiles per row, TILE px each → atlas is (COLS·TILE) × (rows·TILE), kept power-of-two so
   mipmaps work for crisp-near / smooth-far filtering. tileUV(num) returns the tile's [u0,v0] origin. */

import * as THREE from '../../assets/vendor/three.module.js';
import { MATERIALS } from '../../data/planet.js';

export const TILE = 32;                 // tile resolution (px)
export const COLS = 8;                  // tiles per atlas row (power of two)
const ROWS = Math.max(1, 1 << Math.ceil(Math.log2(Math.ceil(MATERIALS.length / COLS))));   // po2 rows
export const ATLAS_W = COLS * TILE, ATLAS_H = ROWS * TILE;

// tile index for a material number (1..N); atlas col/row + the tile's UV origin (v measured from BOTTOM,
// since GL texture space is bottom-up while canvas is top-down — we flip when drawing).
export const tileIndex = (num) => num - 1;
export function tileUV(num) {
  const t = tileIndex(num), col = t % COLS, row = (t / COLS) | 0;
  return { u0: (col * TILE) / ATLAS_W, v0: 1 - ((row + 1) * TILE) / ATLAS_H, du: TILE / ATLAS_W, dv: TILE / ATLAS_H };
}

// deterministic per-pixel hash → [0,1)
function h01(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const clamp255 = (v) => v < 0 ? 0 : v > 255 ? 255 : v | 0;

// pick a pattern style from the material id
function styleOf(id) {
  if (id === 'wood' || id === 'pineleaf' || id === 'sandstone') return 'planks';
  if (id === 'brick') return 'brick';
  if (id === 'leaves' || id === 'grass' || id === 'forest' || id === 'jungle' || id === 'taiga' || id === 'savanna' || id === 'tundra') return 'clumpy';
  if (id === 'glass' || id === 'gold' || id === 'ice') return 'sheen';
  if (id === 'sand') return 'grains';
  return 'mottle';   // stone/rock/dirt/granite/basalt/slate/redrock/scree/core/snow/water/…
}

// draw one material's tile at canvas (px,py). Output is GREY DETAIL (luminance ~1.0 = no change) — the
// chunk shader MULTIPLIES it onto the already color/AO-tuned vertex color, so this is per-material texture
// detail (planks/brick/speckle), not base colour. NEUTRAL = 200/255 (shader rescales ×1.28 so f≈1 → ×1).
function drawTile(ctx, px, py, t, mat) {
  const style = styleOf(mat.id), img = ctx.createImageData(TILE, TILE), d = img.data;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let f = 0.88 + h01(t, x, y) * 0.24;          // base per-pixel speckle
      if (style === 'planks') {                     // horizontal boards + grain streaks
        if (y % 8 === 0) f *= 0.66;                  // dark gap between boards
        f *= 0.94 + h01(t, (x * 3) | 0, (y / 8) | 0) * 0.12;   // along-grain streaks (constant per board)
      } else if (style === 'brick') {               // offset courses with mortar lines
        const course = (y / 8) | 0, off = (course & 1) * 8;
        if (y % 8 === 0 || ((x + off) % 16) === 0) f *= 0.6;    // mortar
      } else if (style === 'clumpy') {              // organic clumps (coarse hash) + dark flecks
        f = 0.84 + h01(t, (x / 3) | 0, (y / 3) | 0) * 0.32;
        if (h01(t + 9, x, y) > 0.93) f *= 0.78;      // scattered dark flecks
      } else if (style === 'grains') {              // fine sand dots
        f = 0.9 + h01(t, x, y) * 0.2;
      } else if (style === 'sheen') {               // smooth + a soft diagonal highlight
        f = 0.97 + h01(t, x, y) * 0.06;
        f += Math.max(0, 1 - Math.abs(((x + y) % TILE) - TILE * 0.4) / 6) * 0.12;
      }
      const g = clamp255(f * 200), i = (y * TILE + x) * 4;       // 200 = neutral (shader rescales)
      d[i] = g; d[i + 1] = g; d[i + 2] = g; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, px, py);
}

let _atlas = null;
/* build (once) the CanvasTexture atlas for all MATERIALS. Nearest mag (crisp pixels) + mipmaps (smooth far). */
export function buildTextureAtlas() {
  if (_atlas) return _atlas;
  const cv = document.createElement('canvas'); cv.width = ATLAS_W; cv.height = ATLAS_H;
  const ctx = cv.getContext('2d');
  for (let i = 0; i < MATERIALS.length; i++) {
    const t = i, col = t % COLS, row = (t / COLS) | 0;
    drawTile(ctx, col * TILE, row * TILE, t, MATERIALS[i]);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true; tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4;   // detail multiplier, not colour
  tex.flipY = false;   // shader maps tile (col,row) directly to UV → canvas-top must be v=0 (no flip)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _atlas = { texture: tex, canvas: cv, cols: COLS, rows: ROWS, tile: TILE, width: ATLAS_W, height: ATLAS_H };
  return _atlas;
}
