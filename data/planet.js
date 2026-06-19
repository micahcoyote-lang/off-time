/* planet.js — Earth ("hexel planet") constants, material palette, and tools.
   Data only (no Three types), mirroring data/materials.js. Material id 0 is reserved for AIR
   in the voxel grid; palette materials map to ids 1..N in order. */

export const FREQ = 290;      // icosphere subdivision frequency → 10·FREQ²+2 = 841,002 columns (E4: ~4× bigger)
export const LAYERS = 128;    // radial voxel shells per column (build ceiling) — E4: 4× deeper for very tall mountains + deep digging
export const TERRAIN_VERSION = 2;  // bump when terrainFill output changes → the save guard discards edits placed against the old world
export const CORE_L = 4;      // solid core boundary layer (below this is always solid core)
export const SEA_L = 12;      // default sea level layer

// ---- world scale (single source of truth; imported by planet-mesh.js + earth.js) ----
// "Bigger" world = more SAME-SIZE blocks → radius grows with frequency. R was raised with FREQ
// (75→100, R 10→13.3) so the hexels stay near-cubic at ~0.16 wide instead of shrinking (which would
// be finer detail, not a bigger planet). ~1.8× the surface area / tiles of the old R=10 world.
export const R = 38.6;        // reference radius (sea level sits here) — scaled with FREQ so TH≈tile width (near-cubic, same block size; bigger world). E4: 19.3→38.6 with FREQ 145→290.
export const TH = 0.16;       // radial shell thickness per layer (≈ tile width at FREQ=100 ⇒ near-cubic)
export const BASE_R = R - SEA_L * TH;            // radius at layer 0
export const radius = (L) => BASE_R + L * TH;    // outer radius of layer L's inner edge
export const MAX_R = radius(LAYERS);             // outermost possible surface (drives camera limits)

// ---- Tier 1 visuals (lighting / atmosphere / water) ----
export const DAY_SECONDS = 480;   // real seconds for one full day/night rotation of the sun (8 min)
export const ATM_COLOR = 0x6db3ff; // atmosphere / sky tint (earth blue; tweak for alien worlds)
export const AO_MIN = 0.55;       // darkest ambient-occlusion factor for tucked-in vertices
export const WATER_OPACITY = 0.62; // translucency of the water layer

// ---- water look + feel ----
export const WATER_SHALLOW = 0x4fb3c9; // coastal shelf tint (depth=0)
export const WATER_DEEP = 0x123a6b;    // deep-basin tint (max depth)
export const WATER_MAX_DEPTH = 8;      // water layers at which the deep tint is reached
export const WATER_WAVE = 0.05;        // radial wave amplitude on the surface (world units)
export const WADE_MAX = 0.45;          // water depth (world units) you can stand in before you must swim (~2-layer shelf)

// ---- E3: LOD globe + surface chunk streaming ----
export const FREQ_COARSE = 30;         // coarse LOD globe frequency (~9k cols → constant orbit cost, any world size)
export const STREAM_MARGIN = 0.2;      // radians of fine-chunk patch kept beyond the horizon around the camera
export const MAX_ACTIVE_CHUNKS = 48;   // cap on simultaneously-meshed fine chunks (memory/perf guard)
export const BODY_SUBMERGE = 0.35;     // how far the floating eye sits below the water surface when swimming
export const SWIM_FACTOR = 0.6;        // movement-speed multiplier while in water

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
  // biome surfaces (appended so existing ids stay stable; used by climate-driven generation)
  { id: 'forest',  title: 'Forest',  emoji: '🌲', color: 0x2f5a2c, kind: 'terrain' },
  { id: 'savanna', title: 'Savanna', emoji: '🌾', color: 0xb3a24f, kind: 'terrain' },
  { id: 'tundra',  title: 'Tundra',  emoji: '🧊', color: 0x9aa890, kind: 'terrain' },
  // innermost band: the dark/hot core you reach by mining all the way down (appended → id stays stable)
  { id: 'core',    title: 'Core',    emoji: '🌋', color: 0x5a2e22, kind: 'terrain' },
  { id: 'leaves',  title: 'Leaves',  emoji: '🍃', color: 0x4a9d3a, kind: 'block' },   // tree canopy (broadleaf)
  // rock/mineral variety so mountains + strata read as "made of lots of things" (vertex-colored, no textures)
  { id: 'granite',   title: 'Granite',   emoji: '🪨', color: 0x9a8f80, kind: 'terrain' },   // warm light grey
  { id: 'basalt',    title: 'Basalt',    emoji: '⬛', color: 0x35353c, kind: 'terrain' },   // near-black volcanic
  { id: 'slate',     title: 'Slate',     emoji: '🔘', color: 0x566270, kind: 'terrain' },   // blue-grey
  { id: 'sandstone', title: 'Sandstone', emoji: '🟧', color: 0xc89b66, kind: 'terrain' },   // tan sedimentary
  { id: 'redrock',   title: 'Red Rock',  emoji: '🟥', color: 0x9c4a32, kind: 'terrain' },   // rust mesa/badlands
  { id: 'scree',     title: 'Scree',     emoji: '🪙', color: 0x7d756a, kind: 'terrain' },   // grey-brown gravel slope
  { id: 'ice',       title: 'Ice',       emoji: '🧊', color: 0xcfeaf5, kind: 'terrain' },   // pale blue glacier
  // extra biome surfaces + foliage
  { id: 'jungle',    title: 'Jungle',    emoji: '🌴', color: 0x2f6b25, kind: 'terrain' },   // hot + very wet
  { id: 'taiga',     title: 'Taiga',     emoji: '🌲', color: 0x3f5d4a, kind: 'terrain' },   // cold boreal
  { id: 'pineleaf',  title: 'Pine',      emoji: '🌲', color: 0x2c5a3a, kind: 'block' },     // conifer canopy (darker)
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
