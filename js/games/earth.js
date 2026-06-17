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

   Controls — W/A/S/D move · Q/E zoom (orbit) / altitude (fly) · G land/fly toggle ·
   F place · R mine · C/V material · 1/2 Place/Mine tool · H help. (Mouse: drag look, wheel
   zoom, click = active tool.) */

import * as THREE from '../../assets/vendor/three.module.js';
import { el, topbar, go } from '../ui.js';
import { state, markTaskDone } from '../state.js';
import { buildHexSphere } from './hexsphere.js';
import { terrainFill, buildPlanetChunks, cellIndex, AIR } from './planet-mesh.js';
import { FREQ, LAYERS, MATERIALS, R, MAX_R, TH, radius } from '../../data/planet.js';

const PHI_MIN = 0.15, PHI_MAX = Math.PI - 0.15;
const FLY_ALT_MIN = 0.8, FLY_ALT_MAX = R * 1.6;      // altitude ABOVE the local surface (not the core)
// ---- walk mode (first-person on the surface, radial gravity) ----
const EYE = 0.45;             // eye height above the ground (world units)
const WALK_SPEED = 0.18;      // rad/s along the surface
const GRAV = 9, JUMP_V = 2.4; // radial gravity / jump (world units/s)
const STEP_UP = TH * 1.4;     // auto-step up to ~1 hexel; taller = wall (blocks)
const MOUSE_SENS = 0.0024;    // pointer-lock look sensitivity
const WALK_REACH = 2.2 / FREQ; // angular reach ahead (~2 tiles) for the "block in front" target

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
    '<b>Controls</b><br>G — mode: Orbit / Fly / Walk<br>W A S D — move<br>' +
    'Q / E — zoom / altitude<br>Walk: mouse — look · Space — jump<br>' +
    'F — place · R — mine<br>C / V — material<br>1 / 2 — Place / Mine<br>H — hide this';
  const overlay = el('div.earth-loading', { text: 'Generating planet…' });
  stage.append(view, hud, reticle, belt, legend, overlay);
  screen.append(stage);

  // Deferred build: paint the overlay first, then do the heavy generation one tick later.
  let cancelled = false, startTimer = 0, raf = 0;
  const listeners = [];
  const disposers = [];
  const on = (t, ty, fn, opts) => { t.addEventListener(ty, fn, opts); listeners.push([t, ty, fn, opts]); };

  startTimer = setTimeout(() => { if (!cancelled) { start(); overlay.remove(); } }, 30);

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
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
    view.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);          // deep space slate
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, MAX_R * 8);

    scene.add(new THREE.HemisphereLight(0xcfe7ff, 0x202b3a, 1.0));
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.9);
    sun.position.set(MAX_R * 3, MAX_R * 2, MAX_R * 1.5);
    scene.add(sun);

    // ---- topology + seeded terrain + saved edits (with size guard) ----
    const { columns, pentagonCount, chunkCount } = buildHexSphere(FREQ);
    // flat column-center arrays for the hot nearest-column loop (avoids Vector3.dot overhead)
    const N = columns.length, cx = new Float32Array(N), cy = new Float32Array(N), cz = new Float32Array(N);
    for (let i = 0; i < N; i++) { const c = columns[i].center; cx[i] = c.x; cy[i] = c.y; cz[i] = c.z; }
    const saved = state.get('builds.earth', null);
    const compatible = saved && saved.freq === FREQ && saved.layers === LAYERS;
    let seed = saved && saved.seed != null ? saved.seed : (Math.random() * 0x7fffffff) | 0;
    const cells = terrainFill(columns, seed);
    const edits = new Map();                               // cellIndex -> material num (0 = mined to air)
    if (compatible && Array.isArray(saved.edits)) {
      for (const ed of saved.edits) {
        if (ed && ed.c >= 0 && ed.c < cells.length) { cells[ed.c] = ed.m; edits.set(ed.c, ed.m); }
      }
    }
    function persist() {
      state.set('builds.earth', { v: 2, freq: FREQ, layers: LAYERS, seed, edits: [...edits].map(([c, m]) => ({ c, m })) });
    }
    persist();                                            // lock seed/size (and migrate stale saves)

    // ---- chunked planet meshes (rebuilt selectively on edit) ----
    const planet = buildPlanetChunks(columns, cells, chunkCount);
    planet.meshes.forEach((m) => scene.add(m));

    window.__earthDebug = { columns: columns.length, pentagons: pentagonCount, chunks: chunkCount, tris: planet.triCount, seed };
    console.log('[earth] hex planet:', window.__earthDebug);

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

    // ---- creative state ----
    let tool = 'place';                                   // 'place' | 'mine'
    let matIdx = MATERIALS.findIndex((m) => m.id === 'grass'); if (matIdx < 0) matIdx = 0;
    const matNum = () => matIdx + 1;                       // numeric id (0 = air)
    let target = null;                                    // { colId, L } topmost solid cell under crosshair
    let needsTarget = true;                               // recompute target this frame (set on edit)

    // a Place stacks on top of the targeted column's surface cell
    function placementCell(tg) {
      if (!tg) return null;
      const L = tg.L + 1;
      return L < LAYERS ? { colId: tg.colId, L } : null;
    }
    // chunks whose geometry an edit at `colId` can change (its own + cross-chunk neighbors)
    function affectedChunks(colId) {
      const s = new Set([columns[colId].chunk]);
      for (const nb of columns[colId].neighbors) if (nb >= 0) s.add(columns[nb].chunk);
      return s;
    }
    function applyEdit(colId, L, m) {
      const ci = cellIndex(colId, L);
      cells[ci] = m; edits.set(ci, m);
      planet.rebuild(affectedChunks(colId));
      needsTarget = true;                                 // surface height changed under the crosshair
      persist(); markTaskDone('earth'); drawHud();
    }
    function doPlace() {
      tool = 'place';
      const pc = placementCell(target);
      if (!pc || cells[cellIndex(pc.colId, pc.L)] !== AIR) return;
      applyEdit(pc.colId, pc.L, matNum());
    }
    function doMine() {
      tool = 'mine';
      if (!target || cells[cellIndex(target.colId, target.L)] === AIR) return;
      applyEdit(target.colId, target.L, AIR);
    }

    // ---- HUD + tool belt ----
    function drawHud() {
      const m = MATERIALS[matIdx];
      const mode = camMode === 'fly' ? '🛩️ Fly' : camMode === 'walk' ? '🚶 Walk' : '🛰️ Orbit';
      hud.innerHTML =
        `<span class="chip">🌍 ${columns.length}</span>` +
        `<span class="chip">${tool === 'place' ? '🧱 Place' : '⛏️ Mine'}</span>` +
        `<span class="chip">${m.emoji} ${m.title}</span>` +
        `<span class="chip">✏️ ${edits.size}</span>` +
        `<span class="chip">${mode}</span>`;
    }
    function refreshBelt() {
      belt.innerHTML = '';
      belt.append(
        el('button.tool-btn' + (tool === 'place' ? '.active' : ''), { text: '🧱 Place', onclick: () => { tool = 'place'; refreshBelt(); drawHud(); } }),
        el('button.tool-btn' + (tool === 'mine' ? '.active' : ''), { text: '⛏️ Mine', onclick: () => { tool = 'mine'; refreshBelt(); drawHud(); } }),
      );
      MATERIALS.forEach((mm, i) => belt.append(
        el('button.mat-btn' + (i === matIdx ? '.active' : ''), {
          text: mm.emoji, title: mm.title,
          style: `--sw:#${mm.color.toString(16).padStart(6, '0')}`,
          onclick: () => { matIdx = i; refreshBelt(); drawHud(); },
        })));
    }
    function cycleMat(d) { matIdx = (matIdx + d + MATERIALS.length) % MATERIALS.length; refreshBelt(); drawHud(); }

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
    function cycleMode() {                                // Orbit → Fly → Walk → Orbit
      if (camMode === 'orbit') {
        camMode = 'fly';
        camDistSaved = camDist;
        anchor.copy(camera.position).normalize();
        fwd.set(0, 1, 0); reorthoFly();
        alt = 2.5;
      } else if (camMode === 'fly') {
        camMode = 'walk';
        feetR = surfaceRadiusAt(anchor); velR = 0; grounded = true; wpitch = -0.3;   // start looking slightly down at the ground
        renderer.domElement.requestPointerLock?.();      // mouse-look (keydown is a valid gesture)
      } else {
        camMode = 'orbit';
        if (document.pointerLockElement) document.exitPointerLock?.();
        camPhi = Math.acos(THREE.MathUtils.clamp(anchor.y, -1, 1));
        camTheta = Math.atan2(anchor.x, anchor.z); clampPhi();
        camDist = Math.max(DIST_MIN, Math.min(DIST_MAX, camDistSaved));
        velTheta = velPhi = 0;
      }
      drawHud();
    }
    // surface radius (top of the tallest solid cell) under a unit direction — lets fly mode hug
    // the actual terrain instead of a fixed high shell, so you can get low and "forward" reads right
    function surfaceRadiusAt(v) {
      const vx = v.x, vy = v.y, vz = v.z;
      let best = 0, bd = -2;
      for (let i = 0; i < N; i++) { const d = cx[i] * vx + cy[i] * vy + cz[i] * vz; if (d > bd) { bd = d; best = i; } }
      const base = best * LAYERS;
      for (let L = LAYERS - 1; L >= 0; L--) if (cells[base + L] !== AIR) return radius(L + 1);
      return radius(0);
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
      if (k === 'h') { legend.classList.toggle('hidden'); return; }
      if (k === 'g') { cycleMode(); return; }
      if (k === 'f') { doPlace(); return; }
      if (k === 'r') { doMine(); return; }
      if (k === 'c') { cycleMat(1); return; }
      if (k === 'v') { cycleMat(-1); return; }
      if (k === '1') { tool = 'place'; refreshBelt(); drawHud(); return; }
      if (k === '2') { tool = 'mine'; refreshBelt(); drawHud(); return; }
      if (k === ' ') { e.preventDefault(); if (camMode === 'walk') jump(); else tool === 'place' ? doPlace() : doMine(); return; }
      if ('wasdqe'.includes(k)) { keys.add(k); e.preventDefault(); }
    });
    on(window, 'keyup', (e) => keys.delete(e.key.toLowerCase()));

    let dragging = false, moved = 0, lastX = 0, lastY = 0;
    on(renderer.domElement, 'pointerdown', (e) => {
      dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
      velTheta = velPhi = 0; renderer.domElement.style.cursor = 'grabbing';
    });
    on(window, 'pointerup', () => { dragging = false; renderer.domElement.style.cursor = 'grab'; });
    on(renderer.domElement, 'pointermove', (e) => {
      if (camMode === 'walk' || !dragging) return;        // walk uses pointer-lock mouse-look instead
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
      if (camMode === 'walk') {
        if (!pointerLocked) { renderer.domElement.requestPointerLock?.(); return; }
        tool === 'place' ? doPlace() : doMine();
        return;
      }
      if (moved <= 6) tool === 'place' ? doPlace() : doMine();
    });
    on(renderer.domElement, 'wheel', (e) => {
      e.preventDefault();
      const f = 1 + Math.sign(e.deltaY) * 0.1;
      if (camMode === 'orbit') camDist = Math.max(DIST_MIN, Math.min(DIST_MAX, camDist * f));
      else alt = Math.max(FLY_ALT_MIN, Math.min(FLY_ALT_MAX, alt * f));
    }, { passive: false });

    // ---- analytic targeting (no per-frame mesh raycast) ----
    const raycaster = new THREE.Raycaster();
    const CENTER = new THREE.Vector2(0, 0);
    const _ro = new THREE.Vector3(), _rd = new THREE.Vector3(), _hit = new THREE.Vector3();
    // skip the per-frame targeting scan when the camera hasn't moved
    let cpx = NaN, cpy = 0, cpz = 0, cqx = 0, cqy = 0, cqz = 0, cqw = 0;
    function cameraMoved() {
      const p = camera.position, q = camera.quaternion;
      if (p.x === cpx && p.y === cpy && p.z === cpz && q.x === cqx && q.y === cqy && q.z === cqz && q.w === cqw) return false;
      cpx = p.x; cpy = p.y; cpz = p.z; cqx = q.x; cqy = q.y; cqz = q.z; cqw = q.w; return true;
    }
    function analyticTarget() {
      raycaster.setFromCamera(CENTER, camera);
      _ro.copy(raycaster.ray.origin); _rd.copy(raycaster.ray.direction);
      // Intersect the crosshair ray with a sphere at the locally-relevant surface radius
      // (camSurfR, set per camera mode). Use the SMALLEST POSITIVE root so it works whether the
      // camera is OUTSIDE the sphere (orbit → near/entry hit) or INSIDE it (fly/walk → forward
      // hit). The old code used MAX_R + the near root only, which returned null when the camera
      // sat inside the shell — so place/mine silently did nothing in fly and walk.
      const b = 2 * _ro.dot(_rd), cc = _ro.dot(_ro) - camSurfR * camSurfR, disc = b * b - 4 * cc;
      if (disc < 0) return null;
      const sq = Math.sqrt(disc);
      let t = (-b - sq) / 2;
      if (t < 0) t = (-b + sq) / 2;
      if (t < 0) return null;
      _hit.copy(_rd).multiplyScalar(t).add(_ro).normalize();   // surface direction under the crosshair
      const hx = _hit.x, hy = _hit.y, hz = _hit.z;
      let best = -1, bd = -2;
      for (let i = 0; i < N; i++) { const d = cx[i] * hx + cy[i] * hy + cz[i] * hz; if (d > bd) { bd = d; best = i; } }
      if (best < 0) return null;
      const base = best * LAYERS;
      for (let L = LAYERS - 1; L >= 0; L--) if (cells[base + L] !== AIR) return { colId: best, L };
      return null;
    }

    // walk targets the block directly AHEAD of the player (independent of look pitch),
    // Minecraft-style: a point ~WALK_REACH along the heading → that column's topmost solid cell.
    function walkTarget() {
      _hit.copy(anchor).multiplyScalar(Math.cos(WALK_REACH)).addScaledVector(fwd, Math.sin(WALK_REACH)).normalize();
      const hx = _hit.x, hy = _hit.y, hz = _hit.z;
      let best = -1, bd = -2;
      for (let i = 0; i < N; i++) { const d = cx[i] * hx + cy[i] * hy + cz[i] * hz; if (d > bd) { bd = d; best = i; } }
      if (best < 0) return null;
      const base = best * LAYERS;
      for (let L = LAYERS - 1; L >= 0; L--) if (cells[base + L] !== AIR) return { colId: best, L };
      return null;
    }

    let lastTargetKey = '', lastGhostKey = '';
    function updateTargeting() {
      target = camMode === 'walk' ? walkTarget() : analyticTarget();
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
      if (target) hiMat.color.setHex(tool === 'mine' ? 0xfca5a5 : 0xffffff);

      if (tool !== 'place' || !target) { ghost.visible = false; lastGhostKey = ''; return; }
      const pc = placementCell(target);
      const valid = pc && cells[cellIndex(pc.colId, pc.L)] === AIR;
      ghostMat.color.setHex(valid ? 0x4ade80 : 0xf87171);
      const cell = pc || target;
      const gkey = `${cell.colId},${cell.L}`;
      if (gkey !== lastGhostKey) {
        lastGhostKey = gkey;
        ghostGeo.setAttribute('position', new THREE.Float32BufferAttribute(cellPrism(columns[cell.colId], cell.L), 3));
      }
      ghost.visible = true;
    }

    // ---- render loop ----
    let lastT = 0, lastW = 0, lastH = 0;
    const KROT = 1.4, KZOOM = 1.6, FLY_MOVE = 0.35, FLY_TURN = 1.3;
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
        const g = surfaceRadiusAt(anchor);
        if (g - feetR > STEP_UP) { anchor.copy(_sa); fwd.copy(_sf); }
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
      } else {                                            // walk: FP on the ground, radial gravity
        const dθ = WALK_SPEED * dt;
        if (keys.has('w')) tryWalk(fwd, dθ);
        if (keys.has('s')) tryWalk(fwd, -dθ);
        right.crossVectors(fwd, anchor).normalize();
        if (keys.has('d')) tryWalk(right, dθ);
        if (keys.has('a')) tryWalk(right, -dθ);
        // vertical: step up small ledges, otherwise gravity / jump
        const ground = surfaceRadiusAt(anchor);
        if (grounded && ground > feetR && ground - feetR <= STEP_UP) feetR = ground;
        velR -= GRAV * dt; feetR += velR * dt;
        if (feetR <= ground) { feetR = ground; velR = 0; grounded = true; } else grounded = false;
        placeWalkCamera();
      }
      camera.updateMatrixWorld();                          // refresh before raycast — lookAt() alone doesn't
      if (cameraMoved() || needsTarget) { updateTargeting(); needsTarget = false; }
      renderer.render(scene, camera);
    }

    refreshBelt();
    drawHud();
    raf = requestAnimationFrame(frame);

    disposers.push(() => {
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock?.();
      planet.meshes.forEach((m) => scene.remove(m));
      planet.dispose();
      scene.remove(highlight); hiGeo.dispose(); hiMat.dispose();
      scene.remove(ghost); ghostGeo.dispose(); ghostMat.dispose();
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
