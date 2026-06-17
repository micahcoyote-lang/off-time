/* planet.js — Earth ("hexel planet") constants, material palette, and tools.
   Data only (no Three types), mirroring data/materials.js. Material id 0 is reserved for AIR
   in the voxel grid; palette materials map to ids 1..N in order. */

export const FREQ = 75;       // icosphere subdivision frequency → 10·FREQ²+2 = 56,252 columns
export const LAYERS = 32;     // radial voxel shells per column (build ceiling)
export const CORE_L = 4;      // solid core boundary layer (below this is always solid core)
export const SEA_L = 12;      // default sea level layer

// ---- world scale (single source of truth; imported by planet-mesh.js + earth.js) ----
export const R = 10;          // reference radius (sea level sits here)
export const TH = 0.16;       // radial shell thickness per layer (≈ tile width at FREQ=75 ⇒ near-cubic)
export const BASE_R = R - SEA_L * TH;            // radius at layer 0
export const radius = (L) => BASE_R + L * TH;    // outer radius of layer L's inner edge
export const MAX_R = radius(LAYERS);             // outermost possible surface (drives camera limits)

// ---- Tier 1 visuals (lighting / atmosphere / water) ----
export const DAY_SECONDS = 480;   // real seconds for one full day/night rotation of the sun (8 min)
export const ATM_COLOR = 0x6db3ff; // atmosphere / sky tint (earth blue; tweak for alien worlds)
export const AO_MIN = 0.55;       // darkest ambient-occlusion factor for tucked-in vertices
export const WATER_OPACITY = 0.62; // translucency of the water layer

// kind: 'terrain' (procedurally placed) | 'block' (creative building blocks).
export const MATERIALS = [
  { id: 'stone', title: 'Stone', emoji: '🪨', color: 0x6b6660, kind: 'terrain' },
  { id: 'dirt',  title: 'Dirt',  emoji: '🟫', color: 0x8a5a37, kind: 'terrain' },
  { id: 'grass', title: 'Grass', emoji: '🌱', color: 0x4f7a3a, kind: 'terrain' },
  { id: 'sand',  title: 'Sand',  emoji: '🏖️', color: 0xd9c48c, kind: 'terrain' },
  { id: 'rock',  title: 'Rock',  emoji: '⛰️', color: 0x595754, kind: 'terrain' },
  { id: 'snow',  title: 'Snow',  emoji: '❄️', color: 0xeef3f7, kind: 'terrain' },
  { id: 'water', title: 'Water', emoji: '🌊', color: 0x2f6f9e, kind: 'terrain' },
  { id: 'brick', title: 'Brick', emoji: '🧱', color: 0xb5532f, kind: 'block' },
  { id: 'wood',  title: 'Wood',  emoji: '🪵', color: 0xceaa72, kind: 'block' },
  { id: 'glass', title: 'Glass', emoji: '🟦', color: 0xbfe3ff, kind: 'block' },
  { id: 'gold',  title: 'Gold',  emoji: '🟨', color: 0xe8c14a, kind: 'block' },
];

export const PLANET_TOOLS = [
  { id: 'place', title: 'Place', emoji: '🧱' },
  { id: 'mine',  title: 'Mine',  emoji: '⛏️' },
];

export function getPlanetMaterial(id) {
  return MATERIALS.find((m) => m.id === id) || null;
}
export function matColor(id) {
  const m = getPlanetMaterial(id);
  return m ? m.color : 0x888888;
}
