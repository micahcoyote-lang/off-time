/* earth.js — "Earth" Play task: a hexel planet (PlanetSmith-style creative mode).

   The world is a Goldberg polyhedron — a sphere tiled with hexagons plus exactly 12 pentagons
   (see hexsphere.js). Each hexel column is a radial stack of voxel cells (planet-mesh.js) you
   build up and mine down with infinite blocks. WIDE-SCREEN, keyboard game.

   Scale-up build: FREQ=48 (~23k tiles), near-cubic hexels. To stay smooth at this size:
   - targeting is ANALYTIC (ray→sphere→nearest column→topmost solid cell), not a per-frame
     full-mesh raycast;
   - geometry is CHUNKED (20 meshes by icosa face); an edit rebuilds only the affected chunks;
   - camera limits derive from MAX_R so near-cubic terrain never clips;
   - generation runs behind a brief loading overlay so the UI paints first.

   Controls — spawn walking; click to look · W/A/S/D move · Space jump · X walk⇄hover (Q/E altitude) ·
   1 block / 2 pickaxe / 3 shovel / 4 axe (gated mine) · click/F/R use held · B materials · C/V cycle ·
   M map · H help. */

import * as THREE from '../../assets/vendor/three.module.js';
import { el, topbar, go } from '../ui.js';
import { state, markTaskDone } from '../state.js';
import { buildHexSphere } from './hexsphere.js';
import { terrainFill, buildPlanetChunks, cellIndex, AIR, MATERIAL_NUM, meshSurfaceSkin } from './planet-mesh.js';
import { compactToStore } from './voxel-store.js';
import { FREQ, LAYERS, TERRAIN_VERSION, SEA_L, MATERIALS, R, MAX_R, TH, radius, DAY_SECONDS, ATM_COLOR,
  WADE_MAX, BODY_SUBMERGE, SWIM_FACTOR, FREQ_COARSE, STREAM_MARGIN, MAX_ACTIVE_CHUNKS } from '../../data/planet.js';

const WATER = MATERIAL_NUM.water;   // numeric id of the water material (liquid: not mineable, you swim in it)

const PHI_MIN = 0.15, PHI_MAX = Math.PI - 0.15;
const FLY_ALT_MIN = 0.8, FLY_ALT_MAX = R * 1.6;      // altitude ABOVE the local surface (not the core)
// ---- walk mode (first-person on the surface, radial gravity) ----
const EYE = 0.45;             // eye height above the ground (world units)
const WALK_SPEED = 1.8 / R;   // ~1.8 world-units/s along the surface (angular = linear/R, so a bigger planet takes proportionally longer to cross)
const GRAV = 9, JUMP_V = 2.4; // radial gravity / jump (world units/s)
const STEP_UP = TH * 1.4;     // auto-step up to ~1 hexel; taller = wall (blocks)
const STEP_LAYERS = Math.max(1, Math.round(STEP_UP / TH));   // step-up ceiling in layers, for the floor scan
const BODY_LAYERS = Math.max(2, Math.ceil(EYE / TH));        // air layers needed above the floor to fit (head clearance)
const MOUSE_SENS = 0.0024;    // pointer-lock look sensitivity

export function mountEarth(task) {
  document.body.classList.add('earth-wide');           // lift the 480px #app cap (theme-game.css)

  const screen = el('section.screen.game.earth');
  screen.append(topbar(task.title, { onBack: () => go('/play') }));
  const stage = el('div.earth-stage');
  const view = el('div.earth-view');
  const hud = el('div.game-hud.earth-hud');
  const reticle = el('div.earth-reticle', { text: '+' });
  const belt = el('div.tool-belt.earth-belt');
  const legend = el('div.earth-legend');
  legend.innerHTML =
    '<b>Controls</b><br>Click — look around<br>W A S D — walk · Space — jump<br>' +
    'X — hover (fly) · Q / E — up / down<br>Click / F / R — use held item<br>' +
    '1 block · 2 ⛏️ · 3 🪏 · 4 🪓<br>B — materials · C / V — cycle<br>M — world map · H — hide this';
  const overlay = el('div.earth-loading', { text: 'Generating planet…' });
  const mapEl = el('div.earth-map.hidden', {
    html: '<div class="earth-map-frame"><div class="earth-map-title">World Map · drag to spin · M / Esc to close</div></div>',
  });
  const mapFrame = mapEl.querySelector('.earth-map-frame');
  const matPanel = el('div.earth-matpanel.hidden');                // material picker (built in refreshBelt)
  const hint = el('div.earth-hint.hidden');                        // transient "need a pickaxe" toast
  const compass = el('div.earth-compass.hidden');                  // scrolling heading + landmark bearings (P1b)
  stage.append(view, hud, reticle, belt, legend, overlay, mapEl, matPanel, hint, compass);
  screen.append(stage);

  // Deferred build: paint the overlay first, then do the heavy generation one tick later.
  let cancelled = false, startTimer = 0, raf = 0;
  const listeners = [];
  const disposers = [];
  const on = (t, ty, fn, opts) => { t.addEventListener(ty, fn, opts); listeners.push([t, ty, fn, opts]); };

  startTimer = setTimeout(() => { if (!cancelled) start(); }, 30);   // start() removes the overlay when meshing finishes

  function start() {
    // ---- WebGL guard (same pattern as job-site.js) ----
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      view.innerHTML = '<p class="ot-msg" style="padding:24px">This game needs WebGL, which isn’t available in this browser.</p>';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));   // cap fragment load on retina/integrated GPUs
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;        // re-render the shadow map only a few times/sec (sun moves slowly)
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
    view.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);          // deep space slate
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, MAX_R * 8);

    scene.add(new THREE.HemisphereLight(0xcfe7ff, 0x202b3a, 0.8));
    scene.add(new THREE.AmbientLight(0xffffff, 0.22));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
    sun.position.set(MAX_R * 3, MAX_R * 2, MAX_R * 1.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.08;
    { const c = sun.shadow.camera;                 // orthographic frustum sized to the planet
      c.left = -MAX_R * 1.3; c.right = MAX_R * 1.3; c.top = MAX_R * 1.3; c.bottom = -MAX_R * 1.3;
      c.near = MAX_R * 2; c.far = MAX_R * 6; c.updateProjectionMatrix(); }
    scene.add(sun); scene.add(sun.target);

    // ---- dynamic sun: day/night rotation ----
    const sunDir = new THREE.Vector3(1, 0, 0);
    const sunBase = new THREE.Vector3(1, 0, 0);
    const sunAxis = new THREE.Vector3(0.15, 1, 0.1).normalize();   // slightly tilted "ecliptic"
    let dayT = DAY_SECONDS * 0.18, timeScale = 1;                  // start mid-morning
    function updateSun(dt) {
      dayT += dt * timeScale;
      sunDir.copy(sunBase).applyAxisAngle(sunAxis, (dayT / DAY_SECONDS) * Math.PI * 2);
      sun.position.copy(sunDir).multiplyScalar(MAX_R * 4);
    }

    // ---- atmosphere: rim glow (from space) + sky dome (from the ground) ----
    const atmU = {
      uSunDir: { value: sunDir },                  // shared ref, rotated by updateSun
      uCamPos: { value: new THREE.Vector3() },
      uAtmColor: { value: new THREE.Color(ATM_COLOR) },
      uSky: { value: 0 },                          // ground-sky strength: 1 in walk/fly, 0 in orbit (space)
    };
    const SKY_VERT = 'varying vec3 vPosW; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vPosW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }';
    const rimMat = new THREE.ShaderMaterial({
      uniforms: { ...atmU, uPower: { value: 3.0 }, uIntensity: { value: 1.5 } },
      vertexShader: SKY_VERT,
      fragmentShader: `
        uniform vec3 uSunDir, uCamPos, uAtmColor; uniform float uPower, uIntensity; varying vec3 vPosW;
        void main(){
          vec3 n = normalize(vPosW);
          vec3 v = normalize(uCamPos - vPosW);
          // peak at the limb (v ⟂ n), fade to 0 toward BOTH the planet centre and deep space —
          // abs() prevents the whole far hemisphere from glowing and flooding the background.
          float rim = pow(1.0 - abs(dot(v, n)), uPower);
          float lit = clamp(dot(n, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
          float glow = rim * uIntensity * (0.2 + 0.8 * lit);
          gl_FragColor = vec4(uAtmColor * glow, glow);
        }`,
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const rim = new THREE.Mesh(new THREE.SphereGeometry(MAX_R * 1.28, 48, 32), rimMat);
    rim.frustumCulled = false; scene.add(rim);

    const skyMat = new THREE.ShaderMaterial({
      uniforms: { ...atmU },
      vertexShader: SKY_VERT,
      fragmentShader: `
        uniform vec3 uSunDir, uCamPos, uAtmColor; uniform float uSky; varying vec3 vPosW;
        void main(){
          vec3 up = normalize(uCamPos);
          vec3 dir = normalize(vPosW - uCamPos);
          float h = clamp(dot(dir, up) * 0.5 + 0.5, 0.0, 1.0);          // 0 below .. 1 zenith
          float sunEl = dot(up, normalize(uSunDir));                    // sun elevation at camera
          float day = clamp(sunEl * 1.4 + 0.25, 0.0, 1.0);
          float altFade = 1.0 - smoothstep(${(R * 1.4).toFixed(2)}, ${(R * 2.4).toFixed(2)}, length(uCamPos));
          vec3 sky = mix(uAtmColor * 1.25, uAtmColor * 0.55, h);        // horizon brighter than zenith
          float sunset = clamp(1.0 - abs(sunEl) * 3.0, 0.0, 1.0) * (1.0 - h);
          sky = mix(sky, vec3(1.0, 0.55, 0.3), sunset * 0.6);           // warm band near the terminator
          gl_FragColor = vec4(sky * day, altFade * uSky);
        }`,
      side: THREE.BackSide, transparent: true, depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(MAX_R * 1.22, 48, 32), skyMat);
    sky.frustumCulled = false; scene.add(sky);

    // ---- world data (streamed from the worker's `topology` message; see the worker block below) ----
    // Declared up-front so input / camera / targeting / render close over them. They stay null/0 until
    // generation streams in, and every reader is null-safe until then (chunkCount 0 → nearestColumn=-1).
    let columns = null, store = null, planet = null;
    let coarseMeshes = null, coarseMat = null;           // per-chunk LOD globe (hidden where fine streams in)
    let N = 0, pentagonCount = 0, chunkCount = 0;
    let cx, cy, cz, chunkCols, chCx, chCy, chCz, chEmpty, chunkScanArr;
    let peakCol = 0, peakL = 0, peakAbove = 0;
    const activeSet = new Set();                          // fine chunk ids currently meshed (E3 streaming)

    // ---- landmarks (P1b): named peaks/water bodies you discover; in-world signposts + compass ----
    let landmarks = [], beacons = [];                    // registry + their in-world signpost meshes
    const discoveredLandmarks = new Set();               // landmark ids the player has visited (persisted)

    // ---- world map (P1a): a rotatable biome mini-globe + discovery fog ----
    let mapMesh = null, mapBaseCol = null, mapCol = null, mapChunkVtx = null, mapDirty = false;  // merged coarse globe
    let mapScene = null, mapCam = null, mapMarkPlayer = null, mapMarks = [];
    let mapOpen = false, mapTheta = 0.6, mapPhi = 1.05, fogInited = false;
    const discovered = new Set();                         // chunk ids the player has visited
    let discoNew = 0;                                     // new regions since last persist (save throttle)
    const FOG_COLOR = new THREE.Color(0x223047), FOG_MIX = 0.86, MAP_PANEL_FRAC = 0.62, DISCO_SAVE_EVERY = 8;

    // bucketed nearest-column query: ~180 chunk-centroid dots → scan that chunk + its neighbours
    // (~1-2k cols) instead of all N. Returns -1 before the world has loaded (chunkCount 0).
    function nearestColumn(hx, hy, hz) {
      let bestChunk = -1, bd = -2;
      for (let ci = 0; ci < chunkCount; ci++) { if (chEmpty[ci]) continue; const d = chCx[ci] * hx + chCy[ci] * hy + chCz[ci] * hz; if (d > bd) { bd = d; bestChunk = ci; } }
      if (bestChunk < 0) return -1;
      let best = -1, bbd = -2;
      const scan = chunkScanArr[bestChunk];
      for (let s = 0; s < scan.length; s++) {
        const list = chunkCols[scan[s]];
        for (let j = 0; j < list.length; j++) { const id = list[j], d = cx[id] * hx + cy[id] * hy + cz[id] * hz; if (d > bbd) { bbd = d; best = id; } }
      }
      return best;
    }

    // ---- saved seed + edits (size-guarded). The worker regenerates from `seed` and applies `edits`. ----
    const saved = state.get('builds.earth', null);
    const compatible = saved && saved.freq === FREQ && saved.layers === LAYERS && saved.tv === TERRAIN_VERSION;
    let seed = saved && saved.seed != null ? saved.seed : (Math.random() * 0x7fffffff) | 0;
    const edits = new Map();                               // cellIndex -> material num (0 = mined to air)
    if (compatible && Array.isArray(saved.edits)) {
      for (const ed of saved.edits) if (ed && ed.c >= 0) edits.set(ed.c, ed.m);
    }
    if (compatible && Array.isArray(saved.discovered)) for (const ci of saved.discovered) discovered.add(ci);
    if (compatible && Array.isArray(saved.discoveredLandmarks)) for (const id of saved.discoveredLandmarks) discoveredLandmarks.add(id);
    function persist() {
      state.set('builds.earth', { v: 2, tv: TERRAIN_VERSION, freq: FREQ, layers: LAYERS, seed, edits: [...edits].map(([c, m]) => ({ c, m })), discovered: [...discovered], discoveredLandmarks: [...discoveredLandmarks] });
    }
    persist();                                            // lock seed/size (and migrate stale saves)

    // Build the picking index + planet meshes + peak beacon from ready column objects (+ cells).
    // Shared by the worker path (reconstruct columns from flat arrays first) and the no-Worker fallback.
    function setupWorld(cols, cellsArr, pentCount, chCount) {
      columns = cols; pentagonCount = pentCount; chunkCount = chCount; N = cols.length;
      // compact the transient flat grid into the per-chunk palette store (the resident representation);
      // the flat `cellsArr` is dropped after this — the worker keeps its own copy only until transfer.
      store = compactToStore(cols, cellsArr, chCount);
      cx = new Float32Array(N); cy = new Float32Array(N); cz = new Float32Array(N);
      for (let i = 0; i < N; i++) { const c = columns[i].center; cx[i] = c.x; cy[i] = c.y; cz[i] = c.z; }
      // bucketed index: per-chunk column lists + centroids + neighbour scan sets
      chunkCols = Array.from({ length: chunkCount }, () => []);
      for (let i = 0; i < N; i++) chunkCols[columns[i].chunk].push(i);
      chCx = new Float32Array(chunkCount); chCy = new Float32Array(chunkCount); chCz = new Float32Array(chunkCount);
      chEmpty = new Uint8Array(chunkCount);
      for (let ci = 0; ci < chunkCount; ci++) {
        const list = chunkCols[ci];
        if (!list.length) { chEmpty[ci] = 1; continue; }       // some buckets fall outside their face → empty
        let sx = 0, sy = 0, sz = 0;
        for (const id of list) { sx += cx[id]; sy += cy[id]; sz += cz[id]; }
        const inv = 1 / (Math.hypot(sx, sy, sz) || 1);
        chCx[ci] = sx * inv; chCy[ci] = sy * inv; chCz[ci] = sz * inv;
      }
      const scanSets = Array.from({ length: chunkCount }, (_, ci) => new Set([ci]));
      for (let i = 0; i < N; i++) {
        const ci = columns[i].chunk;
        for (const nb of columns[i].neighbors) if (nb >= 0) { const cj = columns[nb].chunk; if (cj !== ci) scanSets[ci].add(cj); }
      }
      chunkScanArr = scanSets.map((s) => [...s]);

      // map: discover the starting region (under the initial anchor (0,0,1)) + its ring; saved regions
      // were already unioned into `discovered` at load. maybeInitFog() paints once the coarse mesh exists.
      const startCi = columns[nearestColumn(0, 0, 1)]?.chunk;
      if (startCi >= 0) { discovered.add(startCi); for (const nb of chunkScanArr[startCi]) discovered.add(nb); }
      maybeInitFog();

      // fine chunk meshes (created empty; meshed on demand near the camera by updateStreaming)
      planet = buildPlanetChunks(columns, store, chunkCount, sunDir);
      planet.meshes.forEach((m) => scene.add(m));

      // tallest peak (feeds the landmark registry + the HUD)
      let peakR = -1;
      for (let i = 0; i < N; i++) {
        const top = store.getTop(i);
        if (top >= 0) { const r = radius(top + 1); if (r > peakR) { peakR = r; peakCol = i; peakL = top; } }
      }
      peakAbove = peakL + 1 - SEA_L;
      scanLandmarks();                                   // registry + in-world signposts
      drawHud();
    }

    // ---- landmark registry: the top spatially-separated PEAKS + the biggest inland LAKE (deterministic) ----
    const isLandCol = (id) => { const t = store.getTop(id); return t > SEA_L && store.getMat(id, t) !== WATER; };
    const latBand = (y) => y > 0.33 ? 'Northern' : y < -0.33 ? 'Southern' : 'Equatorial';
    function scanLandmarks() {
      const mk = (kind, name, colId) => ({ id: landmarks.length, kind, name, colId, center: columns[colId].center, radius: surfaceRadiusAt(columns[colId].center), chunk: columns[colId].chunk, aboveSea: store.getTop(colId) + 1 - SEA_L });
      landmarks = [];
      // PEAKS: greedily take the highest land columns that are ≥ MINSEP apart → distinct mountains world-wide
      const cand = [];
      for (let i = 0; i < N; i++) { if (isLandCol(i) && store.getTop(i) - SEA_L > 14) cand.push(i); }
      cand.sort((a, b) => store.getTop(b) - store.getTop(a));
      const MINSEP = Math.cos(0.5), picks = [], used = {};
      for (const id of cand) {
        if (picks.length >= 5) break;
        const c = columns[id].center; let ok = true;
        for (const p of picks) if (columns[p].center.dot(c) > MINSEP) { ok = false; break; }
        if (!ok) continue; picks.push(id);
        let nm = picks.length === 1 ? 'Tallest Peak' : `${latBand(c.y)} Peak`;
        const key = nm; if (used[key]) nm += ` ${used[key] + 1}`; used[key] = (used[key] || 0) + 1;
        landmarks.push(mk('peak', nm, id));
      }
      // LAKE: flood-fill water bodies; the largest is the ocean (skip), the next sizable one is a lake
      const seen = new Uint8Array(N), waters = [];
      for (let s = 0; s < N; s++) {
        if (seen[s] || isLandCol(s)) { seen[s] = 1; continue; }
        seen[s] = 1; let size = 0; const stack = [s]; let any = s;
        while (stack.length) { const id = stack.pop(); size++; any = id; for (const nb of columns[id].neighbors) if (nb >= 0 && !seen[nb] && !isLandCol(nb)) { seen[nb] = 1; stack.push(nb); } }
        waters.push({ size, col: any });
      }
      waters.sort((a, b) => b.size - a.size);
      if (waters[1] && waters[1].size > 30) landmarks.push(mk('water', 'Great Lake', waters[1].col));
      // in-world signposts (a modest post + sign board, not a glowing tower)
      for (const lm of landmarks) { const sp = makeSignpost(lm.kind); sp.position.copy(lm.center).multiplyScalar(lm.radius); sp.quaternion.setFromUnitVectors(UP_Y, lm.center); sp.frustumCulled = false; scene.add(sp); beacons.push(sp); }
    }
    const UP_Y = new THREE.Vector3(0, 1, 0);
    function spBox(w, h, d, hex, y) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: hex })); m.position.y = y; m.castShadow = true; return m; }
    function makeSignpost(kind) {
      const g = new THREE.Group();
      g.add(spBox(0.07, 1.4, 0.07, 0x6b4a2e, 0.7));        // post rises along local +Y from the surface
      g.add(spBox(0.62, 0.34, 0.05, kind === 'water' ? 0x3f9fc4 : 0xd8a93a, 1.18));   // sign board near the top
      return g;
    }
    // worker `topology` message → reconstruct lightweight column objects, then set up the world.
    // `d.cells` already has the saved edits applied (the worker did it).
    function onTopology(d) {
      const n = d.boundaryLen.length, cols = new Array(n);
      for (let i = 0; i < n; i++) {
        const bl = d.boundaryLen[i], boundary = new Array(bl), neigh = new Array(bl);
        for (let k = 0; k < bl; k++) {
          const o = (i * 6 + k) * 3;
          boundary[k] = new THREE.Vector3(d.boundary[o], d.boundary[o + 1], d.boundary[o + 2]);
          neigh[k] = d.neighbors[i * 6 + k];
        }
        cols[i] = { id: i, center: new THREE.Vector3(d.centers[i * 3], d.centers[i * 3 + 1], d.centers[i * 3 + 2]), boundary, neighbors: neigh, chunk: d.chunk[i], isPentagon: bl === 5 };
      }
      setupWorld(cols, d.cells, d.pentagonCount, d.chunkCount);
    }

    // worker `coarse` message → the LOD globe as one low-res mesh PER CHUNK (same regions as the fine
    // chunks). Each is shown unless its fine chunk is streamed in (updateStreaming toggles .visible), so
    // fine detail replaces coarse exactly — no overlap, no poke-through.
    function onCoarse(d) {
      coarseMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });   // DoubleSide so a deep hole doesn't see sky under the globe's edge
      coarseMeshes = new Array(d.chunkCount);
      for (let i = 0; i < d.chunkCount; i++) {
        const geo = new THREE.BufferGeometry(), p = d.pos[i], c = d.col[i];
        geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
        if (p.length) { geo.computeVertexNormals(); geo.computeBoundingSphere(); }
        const m = new THREE.Mesh(geo, coarseMat);
        m.frustumCulled = p.length > 0;                  // small regional patches → frustum-cull off-screen
        m.visible = !activeSet.has(i);                   // hidden if this region is already fine
        coarseMeshes[i] = m; scene.add(m);
      }
      // build the merged single-mesh globe for the world map (separate from the live coarse meshes,
      // which keep their per-chunk .visible for streaming). Record each chunk's vertex range for fog.
      let total = 0; for (let i = 0; i < d.chunkCount; i++) total += d.pos[i].length;
      const mPos = new Float32Array(total), mCol = new Float32Array(total);
      mapChunkVtx = new Int32Array(d.chunkCount * 2);
      for (let i = 0, off = 0; i < d.chunkCount; i++) {
        const p = d.pos[i], c = d.col[i];
        mapChunkVtx[i * 2] = off / 3; mapChunkVtx[i * 2 + 1] = p.length / 3;
        mPos.set(p, off); mCol.set(c, off); off += p.length;
      }
      mapBaseCol = mCol.slice();                          // pristine biome colors (never mutated)
      mapCol = mCol;                                      // live attribute (greyed where undiscovered)
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
      mg.setAttribute('color', new THREE.BufferAttribute(mapCol, 3));
      if (total) { mg.computeVertexNormals(); mg.computeBoundingSphere(); }
      mapMesh = new THREE.Mesh(mg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      mapMesh.frustumCulled = false;                     // lives in mapScene, not the live scene
      maybeInitFog();
    }

    // ---- world map helpers (P1a) ----
    // recolor one chunk's vertex slice: biome color if discovered, else lerped toward fog grey
    function tintChunk(ci) {
      if (!mapChunkVtx) return;
      const start = mapChunkVtx[ci * 2] * 3, cnt = mapChunkVtx[ci * 2 + 1] * 3, seen = discovered.has(ci);
      for (let o = start; o < start + cnt; o += 3) {
        if (seen) { mapCol[o] = mapBaseCol[o]; mapCol[o + 1] = mapBaseCol[o + 1]; mapCol[o + 2] = mapBaseCol[o + 2]; }
        else {
          mapCol[o] = mapBaseCol[o] * (1 - FOG_MIX) + FOG_COLOR.r * FOG_MIX;
          mapCol[o + 1] = mapBaseCol[o + 1] * (1 - FOG_MIX) + FOG_COLOR.g * FOG_MIX;
          mapCol[o + 2] = mapBaseCol[o + 2] * (1 - FOG_MIX) + FOG_COLOR.b * FOG_MIX;
        }
      }
      mapDirty = true;
    }
    function reveal(ci) { if (ci == null || ci < 0 || discovered.has(ci)) return; discovered.add(ci); discoNew++; tintChunk(ci); drawHud(); }
    // one-time fog paint once BOTH the merged mesh and the chunk index exist (worker streams them apart)
    function maybeInitFog() {
      if (fogInited || !mapBaseCol || !chunkCount) return;
      fogInited = true;
      for (let ci = 0; ci < chunkCount; ci++) tintChunk(ci);   // discovered set already seeded (save + start region)
      drawHud();
    }
    function discoveryPct() {
      if (!chunkCount) return 0;
      let total = 0; for (let i = 0; i < chunkCount; i++) if (!chEmpty[i]) total++;
      let seen = 0; for (const ci of discovered) if (ci >= 0 && !chEmpty[ci]) seen++;
      return total ? Math.round(seen / total * 100) : 0;
    }
    function ensureMapScene() {
      if (mapScene || !mapMesh) return;
      mapScene = new THREE.Scene();
      mapScene.add(new THREE.HemisphereLight(0xcfe7ff, 0x202b3a, 1.0));
      const dl = new THREE.DirectionalLight(0xffffff, 0.7); dl.position.set(2, 3, 2); mapScene.add(dl);
      mapScene.add(mapMesh);
      mapCam = new THREE.PerspectiveCamera(40, 1, R * 0.05, R * 8);
      const mk = (h) => { const m = new THREE.Mesh(new THREE.ConeGeometry(R * 0.03, R * 0.13, 8), new THREE.MeshBasicMaterial({ color: h })); m.frustumCulled = false; return m; };
      mapMarkPlayer = mk(0x4ade80); mapScene.add(mapMarkPlayer);
      mapMarks = landmarks.map((lm) => { const m = mk(lm.kind === 'water' ? 0x3f9fc4 : 0xffd34d); mapScene.add(m); return m; });
    }
    const _msph = new THREE.Spherical(), _mup = new THREE.Vector3(0, 1, 0);
    function placeMapCamera() {
      _msph.set(R * 2.6, Math.max(0.12, Math.min(Math.PI - 0.12, mapPhi)), mapTheta);
      mapCam.position.setFromSpherical(_msph); mapCam.up.copy(_mup); mapCam.lookAt(0, 0, 0);
    }
    function placeRadialMarker(mesh, dir, seen) {
      mesh.visible = seen; if (!seen || !dir) return;
      mesh.position.copy(dir).multiplyScalar(surfaceRadiusAt(dir) + R * 0.06);
      mesh.quaternion.setFromUnitVectors(_mup, dir);
    }
    const _mpd = new THREE.Vector3();
    function updateMapMarkers() {
      if (!columns) return;
      const pdir = camMode === 'orbit' ? _mpd.copy(camera.position).normalize() : anchor;
      placeRadialMarker(mapMarkPlayer, pdir, true);
      for (let i = 0; i < landmarks.length; i++) if (mapMarks[i]) placeRadialMarker(mapMarks[i], landmarks[i].center, discoveredLandmarks.has(landmarks[i].id));
    }

    // ---- compass + landmark discovery (P1b) ----
    const _nT = new THREE.Vector3(), _eT = new THREE.Vector3(), _dT = new THREE.Vector3();
    // angle of a world direction in the player's tangent plane: 0 = N (toward +Y pole), +90° = E. radians.
    function bearingOf(dir) {
      _nT.set(0, 1, 0).addScaledVector(anchor, -anchor.y); if (_nT.lengthSq() < 1e-6) return 0; _nT.normalize();
      _eT.crossVectors(anchor, _nT);
      _dT.copy(dir).addScaledVector(anchor, -dir.dot(anchor));     // project dir onto the tangent plane
      return Math.atan2(_dT.dot(_eT), _dT.dot(_nT));
    }
    const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); return (a < 0 ? a + 2 * Math.PI : a) - Math.PI; };
    const CARDS = [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]];
    const HALF_FOV = 1.22;                                          // ~70° each side of the heading
    function updateCompass() {
      if (mapOpen || camMode === 'orbit' || !landmarks.length) { compass.classList.add('hidden'); return; }
      compass.classList.remove('hidden');
      const heading = bearingOf(fwd);
      const tick = (rel, label, cls) => `<span class="cmp-tick ${cls}" style="left:${(50 + (rel / HALF_FOV) * 50).toFixed(1)}%">${label}</span>`;
      let html = '<div class="cmp-center"></div>';
      for (const [lab, b] of CARDS) { const rel = wrapPi(b - heading); if (Math.abs(rel) < HALF_FOV) html += tick(rel, lab, 'cmp-card'); }
      for (const lm of landmarks) {
        if (!discoveredLandmarks.has(lm.id)) continue;
        const rel = wrapPi(bearingOf(lm.center) - heading); if (Math.abs(rel) >= HALF_FOV) continue;
        const dist = Math.round(Math.acos(Math.max(-1, Math.min(1, anchor.dot(lm.center)))) * R);
        html += tick(rel, `${lm.kind === 'water' ? '💧' : '🏔️'} ${dist}m`, 'cmp-lm');
      }
      compass.innerHTML = html;
    }
    function discoverLandmarks() {
      if (!landmarks.length) return;
      const pc = nearestColumn(anchor.x, anchor.y, anchor.z); if (pc < 0) return;
      const pchunk = columns[pc].chunk;
      for (const lm of landmarks) {
        if (discoveredLandmarks.has(lm.id)) continue;
        if (pchunk === lm.chunk || chunkScanArr[lm.chunk].includes(pchunk)) {
          discoveredLandmarks.add(lm.id); showHint(`🏁 Discovered: ${lm.name}`); persist(); drawHud();
        }
      }
    }
    function toggleMap(force) {
      const next = force == null ? !mapOpen : force;
      if (next === mapOpen) return;
      mapOpen = next;
      if (mapOpen) {
        ensureMapScene(); keys.clear();                  // freeze movement (drop held keys)
        if (document.pointerLockElement) document.exitPointerLock?.();
        const side = Math.round(Math.min(lastW, lastH) * MAP_PANEL_FRAC);
        mapFrame.style.width = mapFrame.style.height = side + 'px';
        mapEl.classList.remove('hidden');
      } else { mapEl.classList.add('hidden'); persist(); discoNew = 0; }
      drawHud();
    }

    // E3 streaming: choose which fine chunks stay meshed — the patch around the surface point under the
    // camera in fly/walk; none in orbit (the coarse globe covers the whole planet there).
    function computeWantActive() {
      const want = new Set();
      if (!planet || camMode === 'orbit') return want;
      const px = anchor.x, py = anchor.y, pz = anchor.z;
      const alt = Math.max(0.1, camera.position.length() - camSurfR);
      const horizon = Math.acos(Math.min(1, camSurfR / (camSurfR + alt)));   // angular distance to the horizon
      const cosT = Math.cos(Math.min(Math.PI, horizon + STREAM_MARGIN));
      const cand = [];
      for (let ci = 0; ci < chunkCount; ci++) {
        if (chEmpty[ci]) continue;
        if (chCx[ci] * px + chCy[ci] * py + chCz[ci] * pz > cosT) cand.push(ci);
      }
      if (cand.length > MAX_ACTIVE_CHUNKS) {           // keep the nearest cap-many
        cand.sort((a, b) => (chCx[b] * px + chCy[b] * py + chCz[b] * pz) - (chCx[a] * px + chCy[a] * py + chCz[a] * pz));
        cand.length = MAX_ACTIVE_CHUNKS;
      }
      for (const ci of cand) want.add(ci);
      return want;
    }
    // unload chunks that left the patch (cheap) + mesh newly-entered ones incrementally (budgeted).
    function updateStreaming(budgetMs) {
      if (!planet) return;
      const want = computeWantActive();
      // chunks that left the patch: unload fine, show coarse again
      for (const id of [...activeSet]) if (!want.has(id)) {
        planet.unload([id]); activeSet.delete(id);
        if (coarseMeshes) coarseMeshes[id].visible = true;
      }
      // chunks that entered the patch: mesh fine incrementally, then hide their coarse
      const t0 = performance.now();
      for (const id of want) {
        if (activeSet.has(id)) continue;
        planet.rebuild([id]); activeSet.add(id);
        if (coarseMeshes) coarseMeshes[id].visible = false;
        if (performance.now() - t0 >= budgetMs) break;   // finish the rest next frame
      }
      if (window.__earthDebug) { window.__earthDebug.activeChunks = activeSet.size; window.__earthDebug.fineTris = planet.triCount; }
    }

    // ---- highlight outline (always on target) + place ghost (Place tool only) ----
    const hiMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false });
    const hiGeo = new THREE.BufferGeometry();
    hiGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6 * 3), 3));
    const highlight = new THREE.LineLoop(hiGeo, hiMat);
    highlight.renderOrder = 2; highlight.visible = false; highlight.frustumCulled = false;
    scene.add(highlight);

    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    const ghostGeo = new THREE.BufferGeometry();
    const ghost = new THREE.Mesh(ghostGeo, ghostMat);
    ghost.visible = false; ghost.frustumCulled = false;
    scene.add(ghost);

    // ---- creative state: you HOLD a block (place) or a tool (pickaxe/shovel/axe, gated mine) ----
    let held = 'block';                                   // 'block' | 'pickaxe' | 'shovel' | 'axe'
    let matIdx = MATERIALS.findIndex((m) => m.id === 'grass'); if (matIdx < 0) matIdx = 0;
    const matNum = () => matIdx + 1;                       // numeric id (0 = air)
    // which materials each tool can mine (water is never mineable). Names → numeric ids via MATERIAL_NUM.
    const _ids = (...names) => new Set(names.map((n) => MATERIAL_NUM[n]).filter(Boolean));
    const TOOLSET = {
      pickaxe: _ids('stone', 'rock', 'granite', 'basalt', 'slate', 'sandstone', 'redrock', 'core', 'ice', 'brick', 'glass', 'gold'),
      shovel: _ids('dirt', 'sand', 'snow', 'grass', 'savanna', 'tundra', 'forest', 'jungle', 'taiga', 'scree'),
      axe: _ids('wood', 'leaves', 'pineleaf'),
    };
    const TOOL_META = { pickaxe: { emoji: '⛏️', title: 'Pickaxe' }, shovel: { emoji: '🪏', title: 'Shovel' }, axe: { emoji: '🪓', title: 'Axe' } };
    const toolForMat = (m) => { for (const t in TOOLSET) if (TOOLSET[t].has(m)) return t; return 'pickaxe'; };
    let target = null;                                    // { colId, L, placeColId, placeL } from raycastVoxel
    let needsTarget = true;                               // recompute target this frame (set on edit)
    let shadowDirty = true, shadowAcc = 0;                // refresh shadow map on edits + a few times/sec

    // chunks whose geometry an edit at `colId` can change (its own + cross-chunk neighbors)
    function affectedChunks(colId) {
      const s = new Set([columns[colId].chunk]);
      for (const nb of columns[colId].neighbors) if (nb >= 0) s.add(columns[nb].chunk);
      return s;
    }
    function applyEdit(colId, L, m) {
      const ci = cellIndex(colId, L);
      store.setMat(colId, L, m); edits.set(ci, m);
      // re-mesh only affected chunks that are currently streamed-in; others have the store updated and
      // will mesh correctly when next activated.
      const affected = [...affectedChunks(colId)].filter((id) => activeSet.has(id));
      if (affected.length) planet.rebuild(affected);
      needsTarget = true; shadowDirty = true;             // surface height changed under the crosshair
      persist(); markTaskDone('earth'); drawHud();
    }
    // left-click / F / R "use" the held item: a block places, a tool mines (if it matches the material)
    function doUse() { if (held === 'block') doPlace(); else doMine(); }
    function doPlace() {
      if (!target || target.placeColId < 0) return;        // the air cell the ray last passed through
      if (store.getMat(target.placeColId, target.placeL) !== AIR) return;
      applyEdit(target.placeColId, target.placeL, matNum());
    }
    function doMine() {
      if (!target) return;
      const m = store.getMat(target.colId, target.L);
      if (m === AIR || m === WATER) return;                // water is a liquid — not mineable
      if (held === 'block' || !TOOLSET[held].has(m)) {     // wrong tool → hint, no dig
        const need = TOOL_META[toolForMat(m)]; showHint(`Need a ${need.emoji} ${need.title}`); return;
      }
      applyEdit(target.colId, target.L, AIR);
    }
    let hintTimer = 0;
    function showHint(text) { hint.textContent = text; hint.classList.remove('hidden'); clearTimeout(hintTimer); hintTimer = setTimeout(() => hint.classList.add('hidden'), 1200); }

    // ---- first-person held-item viewmodel: a small mesh in the lower-right, like an FPS hand ----
    const heldGroup = new THREE.Group();
    heldGroup.position.set(0.16, -0.13, -0.40);            // camera-space: lower-right, just in front (clears the belt)
    scene.add(camera); camera.add(heldGroup);              // camera must be in the scene graph for its children to render
    const _vmHead = 0x6b7079, _vmWood = 0x8a5a37;
    const vmBox = (w, h, d, hex, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial({ color: hex, emissive: new THREE.Color(hex).multiplyScalar(0.35), depthTest: false }));
      m.position.set(x, y, z); m.renderOrder = 999; m.frustumCulled = false; return m;
    };
    function updateHeldModel() {
      while (heldGroup.children.length) { const c = heldGroup.children.pop(); c.geometry.dispose(); c.material.dispose(); }
      if (held === 'block') {
        heldGroup.rotation.set(0.5, 0.6, 0);
        heldGroup.add(vmBox(0.12, 0.12, 0.12, MATERIALS[matIdx].color, 0, 0, 0));
      } else {
        heldGroup.rotation.set(0.35, -0.4, 0.35);          // a "held" tilt; handle runs along local Y
        heldGroup.add(vmBox(0.022, 0.30, 0.022, _vmWood, 0, -0.02, 0));   // handle
        if (held === 'pickaxe') heldGroup.add(vmBox(0.24, 0.03, 0.03, _vmHead, 0, 0.14, 0));        // wide cross-head
        else if (held === 'shovel') heldGroup.add(vmBox(0.10, 0.13, 0.02, _vmHead, 0, 0.20, 0));    // flat blade on top
        else if (held === 'axe') heldGroup.add(vmBox(0.12, 0.10, 0.028, _vmHead, 0.07, 0.12, 0));   // blade offset near top
      }
    }
    function selectHeld(h) { held = h; updateHeldModel(); refreshBelt(); drawHud(); }

    // ---- HUD + tool belt ----
    const heldLabel = () => held === 'block' ? `${MATERIALS[matIdx].emoji} ${MATERIALS[matIdx].title}` : `${TOOL_META[held].emoji} ${TOOL_META[held].title}`;
    function drawHud() {
      const mode = camMode === 'fly' ? '🚁 Hover' : camMode === 'walk' ? '🚶 Walk' : '🛰️ Orbit';
      hud.innerHTML =
        `<span class="chip">🌍 ${columns ? columns.length : 0}</span>` +
        `<span class="chip">✋ ${heldLabel()}</span>` +
        `<span class="chip">✏️ ${edits.size}</span>` +
        `<span class="chip">🧭 ${discoveredLandmarks.size}/${landmarks.length}</span>` +
        `<span class="chip">🗺️ ${discoveryPct()}%</span>` +
        `<span class="chip">${mode}</span>`;
    }
    // belt = the 4 held items (block + pickaxe/shovel/axe) + a "Materials" button to choose the block.
    function refreshBelt() {
      belt.innerHTML = '';
      const mm = MATERIALS[matIdx];
      belt.append(
        el('button.tool-btn' + (held === 'block' ? '.active' : ''), { text: `1 ${mm.emoji}`, title: `Place ${mm.title}`, onclick: () => selectHeld('block') }),
        el('button.tool-btn' + (held === 'pickaxe' ? '.active' : ''), { text: '2 ⛏️', title: 'Pickaxe — rock/stone/ore', onclick: () => selectHeld('pickaxe') }),
        el('button.tool-btn' + (held === 'shovel' ? '.active' : ''), { text: '3 🪏', title: 'Shovel — dirt/sand/snow', onclick: () => selectHeld('shovel') }),
        el('button.tool-btn' + (held === 'axe' ? '.active' : ''), { text: '4 🪓', title: 'Axe — wood/leaves', onclick: () => selectHeld('axe') }),
        el('button.mat-toggle' + (matPanelOpen ? '.active' : ''), {
          html: `<span class="sw" style="--sw:#${mm.color.toString(16).padStart(6, '0')}"></span> ${mm.emoji} ${mm.title} ▾`,
          title: 'Materials (B)', onclick: () => toggleMatPanel(),
        }),
      );
    }
    let matPanelOpen = false;
    function toggleMatPanel(force) {
      matPanelOpen = force == null ? !matPanelOpen : force;
      if (matPanelOpen) {
        matPanel.innerHTML = '';
        for (const kind of ['terrain', 'block']) {
          const group = el('div.matpanel-group');
          group.append(el('div.matpanel-label', { text: kind === 'terrain' ? 'Terrain' : 'Blocks' }));
          MATERIALS.forEach((mm, i) => {
            if (mm.kind !== kind) return;
            group.append(el('button.mat-btn' + (i === matIdx ? '.active' : ''), {
              text: mm.emoji, title: mm.title,
              style: `--sw:#${mm.color.toString(16).padStart(6, '0')}`,
              onclick: () => { matIdx = i; held = 'block'; updateHeldModel(); toggleMatPanel(false); refreshBelt(); drawHud(); },
            }));
          });
          matPanel.append(group);
        }
        matPanel.classList.remove('hidden');
      } else matPanel.classList.add('hidden');
      refreshBelt();
    }
    function cycleMat(d) { matIdx = (matIdx + d + MATERIALS.length) % MATERIALS.length; held = 'block'; updateHeldModel(); if (matPanelOpen) toggleMatPanel(true); refreshBelt(); drawHud(); }

    // ---- camera: orbit (from space) → fly (over the surface) → walk (on the ground) ----
    let camMode = 'orbit';
    let camTheta = 0.6, camPhi = 1.15, camDist = MAX_R * 2, velTheta = 0, velPhi = 0;
    let camDistSaved = camDist;                          // restored when leaving fly/walk
    const DIST_MIN = MAX_R * 1.12, DIST_MAX = MAX_R * 5;
    const clampPhi = () => { camPhi = Math.max(PHI_MIN, Math.min(PHI_MAX, camPhi)); };
    const sph = new THREE.Spherical();

    const anchor = new THREE.Vector3(0, 0, 1), fwd = new THREE.Vector3(0, 1, 0);
    let alt = 3, lookAhead = 0.32;                       // fly state
    let wpitch = 0, feetR = 0, velR = 0, grounded = true, pointerLocked = false;   // walk state
    let camSurfR = R;                                    // sphere radius the crosshair targets (per mode)
    const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), right = new THREE.Vector3();
    const _sa = new THREE.Vector3(), _sf = new THREE.Vector3();

    function reorthoFly() {
      anchor.normalize();
      fwd.addScaledVector(anchor, -fwd.dot(anchor)).normalize();
    }
    // move the foot point along a great circle in a tangent direction (parallel transport)
    function moveOnSphere(dir, dθ) {
      tmpA.copy(anchor).multiplyScalar(Math.cos(dθ)).addScaledVector(dir, Math.sin(dθ));
      anchor.copy(tmpA); reorthoFly();
    }
    function jump() { if (grounded) { velR = JUMP_V; grounded = false; } }
    // X toggles between WALK (feet on the ground) and HOVER (free-fly at altitude). Orbit is retired —
    // it survives only as the transient "watch it generate from space" load view (set in onDone → walk).
    function toggleHover() {
      if (camMode === 'walk') {
        camMode = 'fly';                                 // → hover (keep the current heading `fwd`)
        if (document.pointerLockElement) document.exitPointerLock?.();
        lookAhead = 0.2; alt = Math.max(FLY_ALT_MIN, 3.0);
      } else {
        camMode = 'walk';                                // → land
        feetR = surfaceRadiusAt(anchor); velR = 0; grounded = true; wpitch = -0.2;
        renderer.domElement.requestPointerLock?.()?.catch?.(() => {});   // mouse-look; ignore reject (embedded preview)
      }
      drawHud();
    }
    // surface radius (top of the tallest solid cell) under a unit direction — lets fly mode hug
    // the actual terrain instead of a fixed high shell, so you can get low and "forward" reads right
    function surfaceRadiusAt(v) {
      const best = nearestColumn(v.x, v.y, v.z);
      if (best < 0) return radius(0);
      const top = store.getTop(best);
      return top >= 0 ? radius(top + 1) : radius(0);
    }
    // The floor under the player at direction `v`, given their current feet radius `fromR`. Finds the
    // highest solid (non-water) cell AT OR JUST BELOW the step-up ceiling — so you can stand INSIDE a
    // pit / tunnel / cave (a floor below the surface) instead of being snapped up to the topmost
    // surface. Also reports the water surface (for wade/swim) and whether the body fits above the floor
    // (head clearance) so you can't walk into a too-short gap.
    function groundInfo(v, fromR) {
      const best = nearestColumn(v.x, v.y, v.z);
      if (best < 0) return { solidR: radius(0), waterTopR: 0, headroom: true };
      const Lf = Math.max(0, Math.floor((fromR - radius(0)) / TH));
      const ceilL = Math.min(LAYERS - 1, Lf + STEP_LAYERS);
      let floorL = -1, waterTopR = 0;
      for (let L = ceilL; L >= 0; L--) {
        const m = store.getMat(best, L);
        if (m === AIR) continue;
        if (m === WATER) { if (waterTopR === 0) waterTopR = radius(L + 1); continue; }
        floorL = L; break;                                    // highest solid at/below the step-up ceiling
      }
      const solidR = floorL < 0 ? radius(0) : radius(floorL + 1);
      let headroom = true;                                    // body cells above the floor must be air/water
      for (let L = floorL + 1; L <= floorL + BODY_LAYERS && L < LAYERS; L++) {
        const m = store.getMat(best, L);
        if (m !== AIR && m !== WATER) { headroom = false; break; }
      }
      return { solidR, waterTopR, headroom };
    }
    function placeOrbitCamera() { camSurfR = R; sph.set(camDist, camPhi, camTheta); camera.position.setFromSpherical(sph); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0); }
    function placeFlyCamera() {
      const surfR = surfaceRadiusAt(anchor);
      camSurfR = surfR;
      camera.up.copy(anchor);
      camera.position.copy(anchor).multiplyScalar(surfR + alt);
      tmpA.copy(anchor).multiplyScalar(Math.cos(lookAhead)).addScaledVector(fwd, Math.sin(lookAhead));
      camera.lookAt(tmpA.multiplyScalar(surfR));
    }
    function placeWalkCamera() {
      camSurfR = feetR;
      if (window.__earthDebug) window.__earthDebug.feetR = +feetR.toFixed(3);
      camera.up.copy(anchor);
      camera.position.copy(anchor).multiplyScalar(feetR + EYE);
      // look = heading (fwd) tilted up/down by wpitch toward local up (anchor)
      tmpA.copy(fwd).multiplyScalar(Math.cos(wpitch)).addScaledVector(anchor, Math.sin(wpitch));
      camera.lookAt(tmpA.add(camera.position));
    }

    // ---- input ----
    const keys = new Set();
    on(window, 'keydown', (e) => {
      const k = e.key.toLowerCase();
      if (e.repeat && 'fr'.includes(k)) return;
      if (k === 'm') { toggleMap(); return; }
      if (mapOpen) { if (k === 'escape') toggleMap(false); return; }   // map open → freeze all other keys
      if (k === 'h') { legend.classList.toggle('hidden'); return; }
      if (k === 'x') { toggleHover(); return; }              // walk ⇄ hover
      if (k === 'b') { toggleMatPanel(); return; }           // materials picker
      if (k === 'f' || k === 'r') { doUse(); return; }      // use the held item (place block / mine with tool)
      if (k === 'c') { cycleMat(1); return; }
      if (k === 'v') { cycleMat(-1); return; }
      if (k === 't') { timeScale = timeScale === 1 ? 30 : 1; return; }   // fast-forward day/night
      if (k === '1') { selectHeld('block'); return; }
      if (k === '2') { selectHeld('pickaxe'); return; }
      if (k === '3') { selectHeld('shovel'); return; }
      if (k === '4') { selectHeld('axe'); return; }
      if (k === ' ') { e.preventDefault(); if (camMode === 'walk') { keys.add(' '); jump(); } else doUse(); return; }
      if ('wasdqe'.includes(k)) { keys.add(k); e.preventDefault(); }
    });
    on(window, 'keyup', (e) => keys.delete(e.key.toLowerCase()));

    let dragging = false, moved = 0, lastX = 0, lastY = 0;
    on(renderer.domElement, 'pointerdown', (e) => {
      if (mapOpen) return;
      dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
      velTheta = velPhi = 0; renderer.domElement.style.cursor = 'grabbing';
    });
    on(window, 'pointerup', () => { dragging = false; renderer.domElement.style.cursor = 'grab'; });
    // map: drag the panel to spin the mini-globe (handlers on the frame, which captures pointer events)
    let mapDrag = false, mapLX = 0, mapLY = 0;
    on(mapFrame, 'pointerdown', (e) => { mapDrag = true; mapLX = e.clientX; mapLY = e.clientY; mapFrame.setPointerCapture?.(e.pointerId); });
    on(mapFrame, 'pointermove', (e) => {
      if (!mapDrag) return;
      mapTheta -= (e.clientX - mapLX) * 0.006;
      mapPhi = Math.max(0.12, Math.min(Math.PI - 0.12, mapPhi - (e.clientY - mapLY) * 0.006));
      mapLX = e.clientX; mapLY = e.clientY;
    });
    on(mapFrame, 'pointerup', () => { mapDrag = false; });
    on(renderer.domElement, 'pointermove', (e) => {
      if (mapOpen || camMode === 'walk' || !dragging) return;   // walk uses pointer-lock mouse-look instead
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (camMode === 'orbit') {
        camTheta -= dx * 0.005; camPhi -= dy * 0.005; clampPhi();
        velTheta = -dx * 0.005; velPhi = -dy * 0.005;
      } else {
        right.crossVectors(fwd, anchor).normalize();
        fwd.addScaledVector(right, -dx * 0.004); reorthoFly();
        lookAhead = Math.max(0.06, Math.min(1.2, lookAhead + dy * 0.003));
      }
      lastX = e.clientX; lastY = e.clientY;
    });
    // walk: pointer-lock mouse-look (yaw rotates heading around local up; pitch tilts the view)
    on(document, 'pointerlockchange', () => { pointerLocked = document.pointerLockElement === renderer.domElement; });
    on(document, 'mousemove', (e) => {
      if (camMode !== 'walk' || !pointerLocked) return;
      fwd.applyAxisAngle(anchor, -e.movementX * MOUSE_SENS); reorthoFly();
      wpitch = Math.max(-1.4, Math.min(1.4, wpitch - e.movementY * MOUSE_SENS));
    });
    on(renderer.domElement, 'click', () => {
      if (mapOpen) return;
      if (camMode === 'walk') {
        if (!pointerLocked) { renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); return; }
        doUse();
        return;
      }
      if (moved <= 6) doUse();
    });
    on(renderer.domElement, 'wheel', (e) => {
      if (mapOpen) return;
      e.preventDefault();
      const f = 1 + Math.sign(e.deltaY) * 0.1;
      if (camMode === 'orbit') camDist = Math.max(DIST_MIN, Math.min(DIST_MAX, camDist * f));
      else alt = Math.max(FLY_ALT_MIN, Math.min(FLY_ALT_MAX, alt * f));
    }, { passive: false });

    // ---- voxel raycast targeting ("laser"): march the crosshair ray through the voxel cells ----
    const raycaster = new THREE.Raycaster();
    const CENTER = new THREE.Vector2(0, 0);
    const _ro = new THREE.Vector3(), _rd = new THREE.Vector3(), _p = new THREE.Vector3();
    // skip the per-frame targeting scan when the camera hasn't moved
    let cpx = NaN, cpy = 0, cpz = 0, cqx = 0, cqy = 0, cqz = 0, cqw = 0;
    function cameraMoved() {
      const p = camera.position, q = camera.quaternion;
      if (p.x === cpx && p.y === cpy && p.z === cpz && q.x === cqx && q.y === cqy && q.z === cqz && q.w === cqw) return false;
      cpx = p.x; cpy = p.y; cpz = p.z; cqx = q.x; cqy = q.y; cqz = q.z; cqw = q.w; return true;
    }
    // March the crosshair ray through the radial voxel grid and return the FIRST solid cell (mine
    // target) + the last air cell before it (place target). Works in every mode and follows the look
    // direction, so you dig exactly where you point. To skip empty space, the march starts at the
    // MAX_R shell entry (when the camera is outside) rather than at the far camera.
    const _base0 = radius(0), _STEP = TH * 0.5;
    function raycastVoxel() {
      raycaster.setFromCamera(CENTER, camera);
      _ro.copy(raycaster.ray.origin); _rd.copy(raycaster.ray.direction);
      const r0 = _ro.length();
      let t0 = 0;
      if (r0 > MAX_R) {                                     // outside the shell → jump to the near entry
        const b = 2 * _ro.dot(_rd), cc = r0 * r0 - MAX_R * MAX_R, disc = b * b - 4 * cc;
        if (disc < 0) return null;
        t0 = (-b - Math.sqrt(disc)) / 2;
        if (t0 < 0) return null;                            // shell is behind the camera
      }
      const tEnd = t0 + MAX_R * 2;                          // generous reach; the march breaks earlier
      let prevCol = -1, prevL = -1;                         // last air cell = placement target
      for (let t = t0 + 1e-4; t <= tEnd; t += _STEP) {
        _p.copy(_rd).multiplyScalar(t).add(_ro);
        const r = _p.length();
        if (r > MAX_R) { if (t > t0 + _STEP) break; else continue; }   // exited the shell
        if (r < _base0) break;                              // reached the solid core
        const inv = 1 / r, col = nearestColumn(_p.x * inv, _p.y * inv, _p.z * inv);
        if (col < 0) continue;
        let L = Math.floor((r - _base0) / TH);
        if (L < 0) L = 0; else if (L >= LAYERS) L = LAYERS - 1;
        if (store.getMat(col, L) !== AIR) return { colId: col, L, placeColId: prevCol, placeL: prevL };
        prevCol = col; prevL = L;
      }
      return null;
    }

    let lastTargetKey = '', lastGhostKey = '';
    function updateTargeting() {
      target = raycastVoxel();
      debugTarget();
      // highlight outlines the hit (mine) cell
      const tkey = target ? `${target.colId},${target.L}` : '';
      if (tkey !== lastTargetKey) {
        lastTargetKey = tkey;
        if (!target) highlight.visible = false;
        else {
          const col = columns[target.colId], r = radius(target.L + 1) + 0.02;
          const arr = hiGeo.attributes.position.array, n = col.boundary.length;
          for (let k = 0; k < 6; k++) {
            const v = col.boundary[k % n];                  // pentagons reuse a vert to fill the 6-slot buffer
            arr[k * 3] = v.x * r; arr[k * 3 + 1] = v.y * r; arr[k * 3 + 2] = v.z * r;
          }
          hiGeo.setDrawRange(0, n);
          hiGeo.attributes.position.needsUpdate = true;
          highlight.visible = true;
        }
      }
      if (target) hiMat.color.setHex(held !== 'block' ? 0xfca5a5 : 0xffffff);

      // ghost previews the place cell (the air cell the ray last passed through) — only when holding a block
      if (held !== 'block' || !target || target.placeColId < 0) { ghost.visible = false; lastGhostKey = ''; return; }
      const valid = store.getMat(target.placeColId, target.placeL) === AIR;
      ghostMat.color.setHex(valid ? 0x4ade80 : 0xf87171);
      const gkey = `${target.placeColId},${target.placeL}`;
      if (gkey !== lastGhostKey) {
        lastGhostKey = gkey;
        ghostGeo.setAttribute('position', new THREE.Float32BufferAttribute(cellPrism(columns[target.placeColId], target.placeL), 3));
      }
      ghost.visible = true;
    }
    const debugTarget = () => (window.__earthDebug ? (window.__earthDebug.target = target && { c: target.colId, L: target.L, pc: target.placeColId, pL: target.placeL }) : 0);

    // ---- render loop ----
    let lastT = 0, lastW = 0, lastH = 0;
    const KROT = 1.4, KZOOM = 1.6, FLY_MOVE = 3.46 / R, FLY_TURN = 1.3;   // FLY_MOVE ~3.46 units/s (linear/R) — scales with world size
    function advanceFly(dθ) {
      const c = Math.cos(dθ), s = Math.sin(dθ);
      tmpA.copy(anchor).multiplyScalar(c).addScaledVector(fwd, s);
      tmpB.copy(fwd).multiplyScalar(c).addScaledVector(anchor, -s);
      anchor.copy(tmpA); fwd.copy(tmpB); reorthoFly();
    }
    // walk a step in tangent direction `dir`; revert if it would climb a wall taller than STEP_UP
    function tryWalk(dir, dθ) {
      _sa.copy(anchor); _sf.copy(fwd);
      moveOnSphere(dir, dθ);
      if (grounded) {
        const g = groundInfo(anchor, feetR);               // floor below the feet (not the topmost surface)
        if (!g.headroom || g.solidR - feetR > STEP_UP) { anchor.copy(_sa); fwd.copy(_sf); }   // wall or no head clearance
      }
    }
    function frame(t) {
      raf = requestAnimationFrame(frame);
      const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0.016; lastT = t;
      const w = view.clientWidth, h = view.clientHeight;
      if (w && h && (w !== lastW || h !== lastH)) {
        renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
        lastW = w; lastH = h;
      }
      if (camMode === 'orbit') {
        if (keys.has('a')) camTheta -= KROT * dt;
        if (keys.has('d')) camTheta += KROT * dt;
        if (keys.has('w')) { camPhi -= KROT * dt; clampPhi(); }
        if (keys.has('s')) { camPhi += KROT * dt; clampPhi(); }
        if (keys.has('q')) camDist = Math.min(DIST_MAX, camDist * (1 + KZOOM * dt));
        if (keys.has('e')) camDist = Math.max(DIST_MIN, camDist * (1 - KZOOM * dt));
        if (!dragging && (Math.abs(velTheta) > 1e-4 || Math.abs(velPhi) > 1e-4)) {
          camTheta += velTheta; camPhi += velPhi; clampPhi();
          const damp = Math.pow(0.9, dt * 60); velTheta *= damp; velPhi *= damp;
        }
        placeOrbitCamera();
      } else if (camMode === 'fly') {
        const mv = FLY_MOVE * dt;
        if (keys.has('w')) advanceFly(mv);
        if (keys.has('s')) advanceFly(-mv);
        if (keys.has('a')) { right.crossVectors(fwd, anchor).normalize(); fwd.addScaledVector(right, -FLY_TURN * dt); reorthoFly(); }
        if (keys.has('d')) { right.crossVectors(fwd, anchor).normalize(); fwd.addScaledVector(right, FLY_TURN * dt); reorthoFly(); }
        if (keys.has('q')) alt = Math.min(FLY_ALT_MAX, alt + KZOOM * 4 * dt);
        if (keys.has('e')) alt = Math.max(FLY_ALT_MIN, alt - KZOOM * 4 * dt);
        placeFlyCamera();
      } else {                                            // walk: FP on the ground, radial gravity, swim in water
        const info = groundInfo(anchor, feetR);
        const inWater = info.waterTopR > 0;
        const swimming = inWater && info.waterTopR - info.solidR > WADE_MAX;   // too deep to stand → float
        const dθ = WALK_SPEED * (inWater ? SWIM_FACTOR : 1) * dt;              // slower in water
        if (keys.has('w')) tryWalk(fwd, dθ);
        if (keys.has('s')) tryWalk(fwd, -dθ);
        right.crossVectors(fwd, anchor).normalize();
        if (keys.has('d')) tryWalk(right, dθ);
        if (keys.has('a')) tryWalk(right, -dθ);
        if (swimming) {                                   // buoyancy: float with the head out; Space swims up
          const floatR = info.waterTopR - BODY_SUBMERGE;
          if (keys.has(' ')) feetR += 1.6 * dt;            // swim up (toward the surface / out onto a ledge)
          else feetR += (floatR - feetR) * Math.min(1, dt * 3);   // ease toward the float line
          velR = 0; grounded = false;
        } else {                                          // wade / walk on the solid seabed or land
          const ground = info.solidR;
          if (grounded && ground > feetR && ground - feetR <= STEP_UP) feetR = ground;
          velR -= GRAV * dt; feetR += velR * dt;
          if (feetR <= ground) { feetR = ground; velR = 0; grounded = true; } else grounded = false;
        }
        placeWalkCamera();
      }
      camera.updateMatrixWorld();                          // refresh before raycast — lookAt() alone doesn't
      updateSun(dt);                                       // day/night rotation
      atmU.uCamPos.value.copy(camera.position);            // atmosphere/sky need the eye position
      atmU.uSky.value = camMode === 'orbit' ? 0 : 1;       // sky only near the surface; pure space in orbit
      planet.waterUniforms.uTime.value += dt;              // animate the water surface (uSunDir is shared/live)
      shadowAcc += dt;                                     // refresh shadows on edits + ~3×/sec (not every frame)
      if (shadowDirty || shadowAcc >= 0.35) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; shadowAcc = 0; }
      if (cameraMoved() || needsTarget) { updateTargeting(); needsTarget = false; }
      updateStreaming(6);                                  // E3: load/unload fine chunks around the camera

      // map discovery + landmark discovery + compass: as you roam (fly/walk only)
      if (planet && !mapOpen && (camMode === 'fly' || camMode === 'walk')) {
        const ci = columns[nearestColumn(anchor.x, anchor.y, anchor.z)]?.chunk;
        if (ci != null && ci >= 0 && !discovered.has(ci)) {
          reveal(ci); for (const nb of chunkScanArr[ci]) reveal(nb);
          if (discoNew >= DISCO_SAVE_EVERY) { persist(); discoNew = 0; }
        }
        discoverLandmarks();
      }
      if (planet) updateCompass();

      renderer.render(scene, camera);                      // pass 1 — the live world

      // pass 2 — the world-map mini-globe, drawn into a centered square scissor inset while open
      if (mapOpen && mapMesh) {
        ensureMapScene();
        if (mapDirty) { mapMesh.geometry.attributes.color.needsUpdate = true; mapDirty = false; }
        updateMapMarkers(); placeMapCamera();
        const dpr = renderer.getPixelRatio();
        const side = Math.round(Math.min(lastW, lastH) * MAP_PANEL_FRAC);
        const px = Math.round((lastW - side) / 2), py = Math.round((lastH - side) / 2);
        const sx = Math.round(px * dpr), sw = Math.round(side * dpr), sh = Math.round(side * dpr);
        const sy = Math.round((lastH - py - side) * dpr);   // GL viewport is bottom-origin
        const prevTest = renderer.getScissorTest();
        renderer.setScissorTest(true);
        renderer.setScissor(sx, sy, sw, sh); renderer.setViewport(sx, sy, sw, sh);
        renderer.autoClear = false;
        renderer.setClearColor(0x0b1220, 1); renderer.clear(true, true, false);
        renderer.render(mapScene, mapCam);
        renderer.setViewport(0, 0, lastW, lastH); renderer.setScissor(0, 0, lastW, lastH);
        renderer.setScissorTest(prevTest); renderer.autoClear = true;
      }
    }

    refreshBelt();
    updateHeldModel();                                      // build the first-person held viewmodel
    drawHud();
    placeOrbitCamera();                                    // position the camera so the streaming planet renders
    atmU.uCamPos.value.copy(camera.position);

    // ---- generation: a Web Worker builds the world OFF-THREAD and STREAMS it in (no main-thread
    // freeze). Edits stay on main (local planet.rebuild). Falls back to in-main generation if Workers
    // are unavailable, so the offline PWA still works on any engine. ----
    let worker = null;
    // drop the player onto solid LAND in walk mode (the orbit view was only for the load). If the start
    // direction (0,0,1) is ocean, BFS outward over neighbours to the nearest land column.
    function spawnOnLand() {
      // a clean spawn = solid GROUND on top (a 'terrain' material), not water and not a tree block
      // (wood/leaves are kind 'block', so spawning never lands you on a canopy)
      const isLand = (id) => { const t = store.getTop(id); if (t <= SEA_L) return false; const mk = MATERIALS[store.getMat(id, t) - 1]; return mk && mk.kind === 'terrain' && mk.id !== 'water'; };
      let spawn = Math.max(0, nearestColumn(0, 0, 1));
      if (!isLand(spawn)) {
        const seen = new Set([spawn]); let frontier = [spawn];
        search: for (let d = 0; d < 80 && frontier.length; d++) {
          const next = [];
          for (const id of frontier) for (const nb of columns[id].neighbors) {
            if (nb < 0 || seen.has(nb)) continue;
            seen.add(nb);
            if (isLand(nb)) { spawn = nb; break search; }
            next.push(nb);
          }
          frontier = next;
        }
      }
      anchor.copy(columns[spawn].center);
      fwd.set(anchor.z, 0, -anchor.x); if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0); fwd.normalize(); reorthoFly();
      feetR = surfaceRadiusAt(anchor); velR = 0; grounded = true; wpitch = -0.1;
      camMode = 'walk'; camSurfR = feetR; placeWalkCamera();
      const ci = columns[spawn].chunk;                     // discover the spawn region
      if (ci >= 0) { reveal(ci); for (const nb of chunkScanArr[ci]) reveal(nb); }
    }
    function onDone() {
      let coarseTris = 0;
      if (coarseMeshes) for (const m of coarseMeshes) coarseTris += (m.geometry.attributes.position?.count || 0) / 3;
      if (columns) spawnOnLand();                          // land the player before handing off to the loop
      window.__earthDebug = { columns: N, pentagons: pentagonCount, chunks: chunkCount, coarseTris, fineTris: 0, activeChunks: 0, seed,
        get mapOpen() { return mapOpen; }, get discovered() { return discovered.size; }, get discoveryPct() { return discoveryPct(); },
        get camMode() { return camMode; },
        get anchor() { return { x: +anchor.x.toFixed(4), y: +anchor.y.toFixed(4), z: +anchor.z.toFixed(4) }; },
        get spawnTopMat() { const id = nearestColumn(anchor.x, anchor.y, anchor.z); return id < 0 ? -1 : store.getMat(id, store.getTop(id)); },
        get landmarks() { return landmarks.map((l) => ({ kind: l.kind, name: l.name, colId: l.colId, aboveSea: l.aboveSea, chunk: l.chunk })); },
        get discoveredLandmarks() { return discoveredLandmarks.size; }, get heading() { return +(bearingOf(fwd) * 180 / Math.PI).toFixed(1); } };
      console.log('[earth] hex planet:', window.__earthDebug);
      overlay.remove();
      if (worker) { worker.terminate(); worker = null; }   // its job is finished; fine chunks mesh on demand
      raf = requestAnimationFrame(frame);                  // hand off to the normal render loop
    }
    function runFallback() {                               // no Worker: generate on the main thread (E1 path)
      const topo = buildHexSphere(FREQ);
      const localCells = terrainFill(topo.columns, seed);
      for (const [c, m] of edits) if (c >= 0 && c < localCells.length) localCells[c] = m;
      setupWorld(topo.columns, localCells, topo.pentagonCount, topo.chunkCount);
      const cg = buildHexSphere(FREQ_COARSE), ccells = terrainFill(cg.columns, seed);   // coarse LOD globe (per chunk)
      const cgroups = Array.from({ length: cg.chunkCount }, () => []);
      for (const col of cg.columns) cgroups[col.chunk].push(col);
      const cpos = cgroups.map((g) => meshSurfaceSkin(g, ccells));
      onCoarse({ chunkCount: cg.chunkCount, pos: cpos.map((s) => s.pos), col: cpos.map((s) => s.col) });
      onDone();
    }
    try {
      if (typeof Worker === 'undefined') throw new Error('Worker unsupported');
      worker = new Worker(new URL('./planet-worker.js', import.meta.url), { type: 'module' });
      worker.onerror = () => { if (worker) { worker.terminate(); worker = null; } if (!planet) runFallback(); };
      worker.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'topology') onTopology(d);
        else if (d.type === 'coarse') { onCoarse(d); renderer.render(scene, camera); }   // orbit shows the globe immediately
        else if (d.type === 'done') onDone();
      };
      worker.postMessage({ type: 'init', freq: FREQ, seed, edits: [...edits].map(([c, m]) => ({ c, m })) });
    } catch (err) {
      console.warn('[earth] worker unavailable, building on the main thread:', err);
      runFallback();
    }

    disposers.push(() => {
      if (worker) { worker.terminate(); worker = null; }
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock?.();
      if (planet) { planet.meshes.forEach((m) => scene.remove(m)); planet.dispose(); }
      scene.remove(highlight); hiGeo.dispose(); hiMat.dispose();
      scene.remove(ghost); ghostGeo.dispose(); ghostMat.dispose();
      scene.remove(rim); rim.geometry.dispose(); rimMat.dispose();
      scene.remove(sky); sky.geometry.dispose(); skyMat.dispose();
      for (const b of beacons) { scene.remove(b); b.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); }
      if (coarseMeshes) { for (const m of coarseMeshes) { scene.remove(m); m.geometry.dispose(); } coarseMat.dispose(); }
      if (planet) persist();                               // flush discovered regions before teardown
      if (mapMesh) { mapMesh.geometry.dispose(); mapMesh.material.dispose(); }
      if (mapMarkPlayer) { mapMarkPlayer.geometry.dispose(); mapMarkPlayer.material.dispose(); }
      for (const m of mapMarks) { m.geometry.dispose(); m.material.dispose(); }
      for (const c of heldGroup.children) { c.geometry.dispose(); c.material.dispose(); }
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    });
  }

  return {
    el: screen,
    destroy() {
      cancelled = true;
      clearTimeout(startTimer);
      cancelAnimationFrame(raf);
      listeners.splice(0).forEach(([tg, ty, fn, op]) => tg.removeEventListener(ty, fn, op));
      disposers.splice(0).forEach((f) => f());
      document.body.classList.remove('earth-wide');
      delete window.__earthDebug;
    },
  };
}

/* positions for a single hexel prism (top fan + side walls), used by the place ghost */
function cellPrism(col, L) {
  const rOut = radius(L + 1), rIn = radius(L), b = col.boundary, n = b.length, pos = [];
  const ctr = col.center.clone().multiplyScalar(rOut);
  for (let k = 0; k < n; k++) {
    const o0 = b[k].clone().multiplyScalar(rOut), o1 = b[(k + 1) % n].clone().multiplyScalar(rOut);
    pos.push(ctr.x, ctr.y, ctr.z, o0.x, o0.y, o0.z, o1.x, o1.y, o1.z);   // top
    const i0 = b[k].clone().multiplyScalar(rIn), i1 = b[(k + 1) % n].clone().multiplyScalar(rIn);
    pos.push(o0.x, o0.y, o0.z, o1.x, o1.y, o1.z, i1.x, i1.y, i1.z);       // side
    pos.push(o0.x, o0.y, o0.z, i1.x, i1.y, i1.z, i0.x, i0.y, i0.z);
  }
  return pos;
}
