/* office-trash.js — the flagship Play task, now a real-3D first-person game (Three.js).
   You're a janitor: walk a procedurally generated office floor, step into rooms, take the
   trash, and haul a full bag (7) to the dumpster (♻). Finish when every office is emptied
   and the last bag is dumped.

   Controls: HOLD ↰/↱ to rotate, HOLD ▲ to walk, ↻ to spin 180°, drag the view to look
   around, 🗑️ Collect, 🗺️ Map. (Arrow keys held also work.)
   Logic (building, trash, bag, dumpster, win) is shared with the old version. */

import * as THREE from '../../assets/vendor/three.module.js';
import { el, topbar, go } from '../ui.js';
import { markTaskDone } from '../state.js';
import { requireVerse } from './continue-gate.js';

const BAG_CAP = 7;
const CELL = 4;          // world units per grid cell
const WALL_H = 3;        // wall height
const EYE = 1.6;         // camera eye height
const PLAYER_R = 0.7;    // collision radius

const FACING_ARROW = ['▲', '▶', '▼', '◀'];
const FACE_YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // N,E,S,W

/* ---- building generation (same layout as before) ---- */
function generateBuilding() {
  const officeRows = 2 + Math.floor(Math.random() * 2);
  const officeCols = 4 + Math.floor(Math.random() * 3);
  const rows = officeRows * 2 + 1;
  const cols = officeCols + 2;
  const grid = [];
  const offices = {};
  let id = 1;
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const isOffice = r % 2 === 1 && c >= 1 && c <= cols - 2;
      if (isOffice) { row.push('office'); offices[r + ',' + c] = { id: id++, r, c, needsTrash: false, collected: false }; }
      else row.push('corridor');
    }
    grid.push(row);
  }
  const dumpster = [rows - 1, cols - 1];
  grid[dumpster[0]][dumpster[1]] = 'dumpster';
  const keys = Object.keys(offices);
  const need = Math.min(keys.length, Math.max(8, Math.round(keys.length * 0.7)));
  keys.slice().sort(() => Math.random() - 0.5).slice(0, need).forEach((k) => (offices[k].needsTrash = true));
  const corridors = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (grid[r][c] === 'corridor') corridors.push([r, c]);
  const start = corridors[Math.floor(Math.random() * corridors.length)];
  return { grid, rows, cols, offices, dumpster, start, facing: Math.floor(Math.random() * 4), totalTrash: need };
}

export function mountOfficeTrash(task) {
  const screen = el('section.screen.game');
  screen.append(topbar(task.title, { onBack: () => go('/play') }));
  const stage = el('div.game-stage');
  const hud = el('div.game-hud');
  const view = el('div.ot-view');
  const msg = el('div.ot-msg');
  const banner = el('div.win-banner');
  banner.style.minHeight = '1.5rem';
  const controls = el('div.ot-controls');
  const mapOverlay = el('div.ot-map');
  mapOverlay.style.display = 'none';
  stage.append(hud, view, msg, banner, controls);
  screen.append(stage, mapOverlay);

  // ---- WebGL guard ----
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    view.innerHTML = '<p class="ot-msg" style="padding:24px">This game needs WebGL, which isn’t available in this browser.</p>';
    return { el: screen, destroy() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;border-radius:12px;touch-action:none;cursor:grab';
  view.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfe6fb);
  scene.fog = new THREE.Fog(0xcfe6fb, CELL * 2.5, CELL * 11);
  const camera = new THREE.PerspectiveCamera(72, 4 / 3, 0.1, 120);
  camera.rotation.order = 'YXZ';

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c6d6, 1.05));
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sun = new THREE.DirectionalLight(0xffffff, 0.7);
  sun.position.set(6, 16, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);

  // ---- materials (bright corporate daylight) ----
  const matWall = new THREE.MeshStandardMaterial({ color: 0xe9eef5, roughness: 0.95 });
  const matWall2 = new THREE.MeshStandardMaterial({ color: 0xdde6f0, roughness: 0.95 });
  const carpetTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#9aa7b6'; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 1400; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)'; g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); }
    g.strokeStyle = 'rgba(0,0,0,0.10)'; g.strokeRect(0.5, 0.5, 63, 63); // carpet-tile seam
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })();
  const matFloor = new THREE.MeshStandardMaterial({ color: 0xb2bcc8, roughness: 1, map: carpetTex });
  const matCeil = new THREE.MeshStandardMaterial({ color: 0xf4f8fc, roughness: 1 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0x14b8a6, roughness: 0.6 });
  const matGlass = new THREE.MeshStandardMaterial({ color: 0xbfe3ff, roughness: 0.3, emissive: 0x8ec9f0, emissiveIntensity: 0.5 });
  const matPanel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6cf, emissiveIntensity: 0.6 });
  const matWood = new THREE.MeshStandardMaterial({ color: 0xcda579, roughness: 0.8 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });
  const matGreen = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.7 });
  const matBinFull = new THREE.MeshStandardMaterial({ color: 0x6b7686, roughness: 0.6, metalness: 0.3 });
  const matLight = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3c4, emissiveIntensity: 0.95 });
  const matFixture = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 });
  const matFrame = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 });
  const matDump = new THREE.MeshStandardMaterial({ color: 0x2f7d4f, roughness: 0.55, metalness: 0.3 });
  const matDumpLid = new THREE.MeshStandardMaterial({ color: 0x276b43, roughness: 0.5, metalness: 0.35 });
  const matDoor = new THREE.MeshStandardMaterial({ color: 0xe7edf4, roughness: 0.6 });
  const ownedGeo = [];
  const ownedMat = [matWall, matWall2, matFloor, matCeil, matAccent, matGlass, matPanel, matWood, matDark, matGreen, matBinFull, matLight, matFixture, matFrame, matDump, matDumpLid, matDoor];

  let world = new THREE.Group();
  scene.add(world);
  let B, officeVis, doors;

  function kind(r, c) {
    if (r < 0 || c < 0 || r >= B.rows || c >= B.cols) return 'out';
    return B.grid[r][c];
  }
  const isCT = (k) => k === 'corridor' || k === 'dumpster';
  // An edge is passable if both corridor-ish, or it's an office's NORTH doorway.
  function edgeOpen(r1, c1, r2, c2) {
    const k1 = kind(r1, c1), k2 = kind(r2, c2);
    if (k1 === 'out' || k2 === 'out') return false;
    if (isCT(k1) && isCT(k2)) return true;
    if (k1 === 'office' && isCT(k2) && r2 === r1 - 1 && c1 === c2) return true;
    if (k2 === 'office' && isCT(k1) && r1 === r2 - 1 && c1 === c2) return true;
    return false;
  }

  function box(w, h, d, x, y, z, mat) {
    const g = new THREE.BoxGeometry(w, h, d);
    ownedGeo.push(g);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    world.add(m);
    return m;
  }
  // a box that casts a (contact) shadow — used for furniture / props
  function propBox(w, h, d, x, y, z, mat) { const m = box(w, h, d, x, y, z, mat); m.castShadow = true; return m; }
  function labelTexture(text, color) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    if (color) { g.fillStyle = color; g.beginPath(); g.roundRect(6, 30, 244, 68, 14); g.fill(); }
    g.fillStyle = '#fff'; g.font = 'bold 60px Nunito, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 66);
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 4;
    return t;
  }
  function emojiTexture(ch) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const g = cv.getContext('2d');
    g.font = '96px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, 64, 72);
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 4;
    return t;
  }
  function sprite(tex, w, h, x, y, z) {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const s = new THREE.Sprite(m);
    s.scale.set(w, h, 1); s.position.set(x, y, z);
    world.add(s);
    return s;
  }

  function addFixture(x, z) {
    box(1.7, 0.1, 1.7, x, WALL_H - 0.05, z, matFixture);              // recessed housing
    box(1.4, 0.06, 1.4, x, WALL_H - 0.11, z, matLight);              // glowing diffuser
    box(0.1, 0.05, 1.3, x - 0.32, WALL_H - 0.13, z, matFixture);     // tube dividers
    box(0.1, 0.05, 1.3, x + 0.32, WALL_H - 0.13, z, matFixture);
  }

  // A paned window (frame + cross muntins + glass). axis 'x' => wall faces ±z; 'z' => faces ±x.
  function makeWindow(x, y, z, axis, w, h) {
    const grp = new THREE.Group();
    // layer parts in depth (glass behind, frame/muntins in front) to avoid z-fighting
    const add = (gw, gh, gx, gy, mat, gz) => { const g = new THREE.BoxGeometry(gw, gh, 0.04); ownedGeo.push(g); const m = new THREE.Mesh(g, mat); m.position.set(gx, gy, gz); grp.add(m); };
    add(w, h, 0, 0, matGlass, -0.03);           // glass (set back)
    add(w + 0.12, 0.12, 0, h / 2, matFrame, 0.02);   // top
    add(w + 0.12, 0.12, 0, -h / 2, matFrame, 0.02);  // bottom
    add(0.12, h + 0.12, -w / 2, 0, matFrame, 0.02);  // left
    add(0.12, h + 0.12, w / 2, 0, matFrame, 0.02);   // right
    add(0.07, h, 0, 0, matFrame, 0.04);         // vertical muntin
    add(w, 0.07, 0, 0, matFrame, 0.04);         // horizontal muntin
    grp.position.set(x, y, z);
    if (axis === 'z') grp.rotation.y = Math.PI / 2;
    world.add(grp);
  }

  function buildDumpster(x, z) {
    propBox(2.4, 1.4, 1.9, x, 0.8, z, matDump);                      // body
    propBox(2.5, 0.14, 2.0, x, 1.5, z, matDark);                     // rim
    const lidL = propBox(1.25, 0.12, 2.0, x - 0.62, 1.6, z, matDumpLid); lidL.rotation.z = 0.13;
    const lidR = propBox(1.25, 0.12, 2.0, x + 0.62, 1.6, z, matDumpLid); lidR.rotation.z = -0.13;
    [-0.95, 0.95].forEach((wx) => [-0.75, 0.75].forEach((wz) => propBox(0.22, 0.45, 0.22, x + wx, 0.22, z + wz, matDark)));
    sprite(emojiTexture('♻️'), 1.0, 1.0, x, 0.95, z - 1.0);          // recycle mark on the front
  }

  function buildWorld() {
    officeVis = {};
    doors = [];
    const { rows, cols } = B;
    // aim the sun's shadow camera over the whole floor
    const midX = (cols - 1) / 2 * CELL, midZ = (rows - 1) / 2 * CELL;
    const span = Math.max(cols, rows) * CELL * 0.7 + CELL;
    const sc = sun.shadow.camera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = 70;
    sc.updateProjectionMatrix();
    sun.position.set(midX + 10, 24, midZ + 8);
    sun.target.position.set(midX, 0, midZ); sun.target.updateMatrixWorld();

    // floor + ceiling (one slab each)
    const fg = new THREE.PlaneGeometry(cols * CELL + CELL, rows * CELL + CELL); ownedGeo.push(fg);
    carpetTex.repeat.set(cols + 1, rows + 1);
    const floor = new THREE.Mesh(fg, matFloor); floor.rotation.x = -Math.PI / 2;
    floor.position.set((cols - 1) / 2 * CELL, 0, (rows - 1) / 2 * CELL); world.add(floor);
    const ceil = new THREE.Mesh(fg, matCeil); ceil.rotation.x = Math.PI / 2;
    ceil.position.set((cols - 1) / 2 * CELL, WALL_H, (rows - 1) / 2 * CELL); world.add(ceil);

    // walls: each cell's west + north edge (covers perimeter + interior once)
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        if (r < rows && !edgeOpen(r, c - 1, r, c)) {
          const m = box(0.2, WALL_H, CELL, c * CELL - CELL / 2, WALL_H / 2, r * CELL, (r + c) % 2 ? matWall : matWall2);
          maybeWindow(m, true, r, c);
        }
        if (c < cols && !edgeOpen(r - 1, c, r, c)) {
          const m = box(CELL, WALL_H, 0.2, c * CELL, WALL_H / 2, r * CELL - CELL / 2, (r + c) % 2 ? matWall : matWall2);
          maybeWindow(m, false, r, c);
        }
      }
    }

    // recessed ceiling light fixtures over every cell
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) addFixture(c * CELL, r * CELL);

    // offices: doorway frame + nameplate + furniture + bin
    Object.values(B.offices).forEach((o) => furnishOffice(o));

    // dumpster (tucked in the back corner)
    const [dr, dc] = B.dumpster;
    buildDumpster(dc * CELL + 0.4, dr * CELL + 0.3);

    // floor + walls receive the contact shadows cast by props
    world.traverse((o) => { if (o.isMesh && !o.castShadow) o.receiveShadow = true; });
  }

  function maybeWindow(wallMesh, isVertical, r, c) {
    const perimeter = r === 0 || c === 0 || r >= B.rows - 1 || c >= B.cols - 1;
    if (!perimeter || (r + c) % 2 !== 0) return;
    const W = CELL * 0.62, H = WALL_H * 0.5, y = WALL_H * 0.55;
    if (isVertical) makeWindow(wallMesh.position.x + (c === 0 ? 0.2 : -0.2), y, wallMesh.position.z, 'z', W, H);
    else makeWindow(wallMesh.position.x, y, wallMesh.position.z + (r === 0 ? 0.2 : -0.2), 'x', W, H);
  }

  function furnishOffice(o) {
    const cx = o.c * CELL, cz = o.r * CELL;
    const v = (n) => o.id % n;
    const zDoor = cz - CELL / 2;
    // doorway frame on the NORTH edge (open side)
    box(0.3, WALL_H, 0.3, cx - CELL / 2 + 0.3, WALL_H / 2, zDoor, matAccent);
    box(0.3, WALL_H, 0.3, cx + CELL / 2 - 0.3, WALL_H / 2, zDoor, matAccent);
    box(CELL, 0.4, 0.3, cx, WALL_H - 0.2, zDoor, matAccent);

    // swinging door leaf — hinged at the left post, opens into the room as you approach
    const dw = CELL - 0.95;
    const hinge = new THREE.Group();
    hinge.position.set(cx - CELL / 2 + 0.4, WALL_H / 2 - 0.15, zDoor);
    const lg = new THREE.BoxGeometry(dw, WALL_H - 0.6, 0.08); ownedGeo.push(lg);
    const leaf = new THREE.Mesh(lg, matDoor); leaf.position.x = dw / 2; leaf.castShadow = true; hinge.add(leaf);
    const hg = new THREE.BoxGeometry(0.1, 0.22, 0.1); ownedGeo.push(hg);
    const handle = new THREE.Mesh(hg, matAccent); handle.position.set(dw - 0.18, 0, 0.1); hinge.add(handle);
    world.add(hinge);
    doors.push({ grp: hinge, x: cx, z: zDoor, angle: 0 });

    // nameplate above door (faces north/corridor)
    const plate = sprite(labelTexture('#' + o.id, '#0f766e'), 1.6, 0.8, cx, WALL_H - 0.7, zDoor - 0.2);
    // accent stripe on back (south) wall
    box(CELL - 0.4, 0.25, 0.05, cx, WALL_H - 0.5, cz + CELL / 2 - 0.12, matAccent);
    // desk + monitor + chair against the back wall
    const deskMat = [matWood, matWall, matWall2][v(3)];
    propBox(2.2, 0.9, 0.9, cx, 0.45, cz + CELL / 2 - 0.9, deskMat);
    propBox(0.9, 0.6, 0.1, cx, 1.2, cz + CELL / 2 - 0.7, matDark);   // monitor
    propBox(0.8, 0.9, 0.8, cx, 0.45, cz + 0.2, matDark);            // chair
    // decor (varies by id)
    const d = v(5);
    if (d === 0) { propBox(0.5, 0.5, 0.5, cx + CELL / 2 - 0.6, 0.25, cz + CELL / 2 - 0.6, matWood); propBox(0.05, 0.7, 0.05, cx + CELL / 2 - 0.6, 0.8, cz + CELL / 2 - 0.6, matGreen); sprite(emojiTexture('🪴'), 0.9, 0.9, cx + CELL / 2 - 0.6, 0.9, cz + CELL / 2 - 0.6); }
    else if (d === 1) { propBox(0.5, 2.0, 1.1, cx - CELL / 2 + 0.4, 1.0, cz + CELL / 2 - 0.8, matWood); }    // bookshelf
    else if (d === 2) { propBox(0.8, 1.3, 0.7, cx + CELL / 2 - 0.6, 0.65, cz + CELL / 2 - 0.6, matWall2); }  // cabinet
    else if (d === 3) { box(1.6, 1.0, 0.06, cx, 1.6, cz + CELL / 2 - 0.1, matCeil); }                        // whiteboard
    // paned window on the back wall (skip when there's a whiteboard)
    if (d !== 3 && o.id % 2 === 0) makeWindow(cx, 1.55, cz + CELL / 2 - 0.2, 'x', CELL * 0.5, WALL_H * 0.42);

    // wastebasket (collect target) — a metal bin with an overflowing trash bag when full
    const bx = cx - CELL / 2 + 0.7, bz = cz - CELL / 2 + 1.0;
    propBox(0.5, 0.6, 0.5, bx, 0.3, bz, matBinFull);                 // bin body (always present)
    let pile = null, mark = null;
    if (o.needsTrash && !o.collected) {
      pile = propBox(0.46, 0.4, 0.46, bx, 0.72, bz, matGreen);       // overflowing trash bag
      mark = sprite(emojiTexture('🗑️'), 0.8, 0.8, bx, 1.15, bz);
      plate.userData.trash = sprite(emojiTexture('🗑️'), 0.7, 0.7, cx + 1.0, WALL_H - 0.7, zDoor - 0.2);
    }
    officeVis[o.r + ',' + o.c] = { pile, mark, plate };
  }

  function collectOffice(o) {
    const vis = officeVis[o.r + ',' + o.c];
    if (!vis) return;
    if (vis.pile) { world.remove(vis.pile); vis.pile = null; }          // bag is gone → bin empties
    if (vis.mark) { world.remove(vis.mark); vis.mark.material.map.dispose(); vis.mark.material.dispose(); vis.mark = null; }
    if (vis.plate && vis.plate.userData.trash) { const s = vis.plate.userData.trash; world.remove(s); s.material.map.dispose(); s.material.dispose(); vis.plate.userData.trash = null; }
  }

  /* ---- camera + movement state ---- */
  const pos = new THREE.Vector3();
  let yaw = 0, pitch = 0;
  let turnVel = 0, moveVel = 0, spinLeft = 0, spinSign = 1;
  let bag = 0, collected = 0, won = false;
  let canCollect = null;       // office obj when standing in a trash office
  let atDumpster = false;      // standing on the dumpster cell

  function placeStart() {
    pos.set(B.start[1] * CELL, EYE, B.start[0] * CELL);
    const [sr, sc] = B.start;
    const dirs = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    let face = B.facing;
    for (let i = 0; i < 4; i++) {                 // face down an open corridor, not a wall
      const f = (B.facing + i) % 4;
      const nr = sr + dirs[f][0], nc = sc + dirs[f][1];
      if (edgeOpen(sr, sc, nr, nc) && isCT(kind(nr, nc))) { face = f; break; }
    }
    yaw = FACE_YAW[face]; pitch = 0;
  }

  function tryMove(dx, dz) {
    const cr = Math.round(pos.z / CELL);
    let cc = Math.round(pos.x / CELL);
    const hw = CELL / 2;
    let nx = pos.x + dx;
    if (dx > 0 && !edgeOpen(cr, cc, cr, cc + 1)) nx = Math.min(nx, cc * CELL + hw - PLAYER_R);
    if (dx < 0 && !edgeOpen(cr, cc, cr, cc - 1)) nx = Math.max(nx, cc * CELL - hw + PLAYER_R);
    pos.x = nx;
    cc = Math.round(pos.x / CELL);
    let nz = pos.z + dz;
    if (dz > 0 && !edgeOpen(cr, cc, cr + 1, cc)) nz = Math.min(nz, cr * CELL + hw - PLAYER_R);
    if (dz < 0 && !edgeOpen(cr, cc, cr - 1, cc)) nz = Math.max(nz, cr * CELL - hw + PLAYER_R);
    pos.z = nz;
  }

  function currentCell() { return [Math.round(pos.z / CELL), Math.round(pos.x / CELL)]; }

  function updateProximity() {
    const [r, c] = currentCell();
    const k = r + ',' + c;
    atDumpster = !!(B.grid[r] && B.grid[r][c] === 'dumpster');
    const o = B.offices[k];
    canCollect = (o && o.needsTrash && !o.collected && bag < BAG_CAP) ? o : null;
    refreshActions(o);
  }

  /* ---- HUD / messages / controls ---- */
  function drawHud() {
    const left = B.totalTrash - collected;
    hud.innerHTML = `<span class="chip">🗑️ Bag ${bag}/${BAG_CAP}</span><span class="chip">Offices left: ${left}</span>`;
  }
  function say(t) { msg.textContent = t || ''; }
  let collectBtn, dumpBtn;
  function refreshActions() {
    if (collectBtn) collectBtn.classList.toggle('dim', !canCollect);
    if (dumpBtn) dumpBtn.classList.toggle('dim', !(atDumpster && bag > 0));
    if (canCollect) say('🗑️ Trash here — tap Collect!');
    else if (atDumpster && bag > 0) say('At the dumpster — tap Dump Trash! 🚮');
  }

  function dump() {
    if (won) return;
    if (!atDumpster) { say('Walk to the dumpster (♻️) at the back to dump your bag.'); return; }
    if (bag === 0) { say('Your bag is already empty.'); return; }
    bag = 0; say('🚮 Dumped the bag — empty again!');
    drawHud(); refreshActions(); checkWin();
  }

  function collect() {
    if (won || !canCollect || bag >= BAG_CAP) {
      if (bag >= BAG_CAP) say('🛍️ Bag full! Head to the dumpster (♻️).');
      else if (!canCollect) say('Walk into an office with trash (🗑️) first.');
      return;
    }
    const o = canCollect;
    o.collected = true; bag += 1; collected += 1;
    collectOffice(o);
    canCollect = null;
    say(bag >= BAG_CAP ? 'Bag full — head to the dumpster! ♻️' : `✅ Trash from #${o.id} collected.`);
    drawHud(); refreshActions(); checkWin();
  }

  function checkWin() {
    if (collected >= B.totalTrash && bag === 0 && !won) win();
    else if (collected >= B.totalTrash && bag > 0) say('All trash collected! Dump the last bag at ♻️ to clock out.');
  }
  function win() {
    won = true; markTaskDone(task.id); toggleMap(false);
    banner.textContent = '🎉 Shift complete — building’s spotless!';
    controls.innerHTML = ''; controls.classList.add('done');
    controls.append(
      el('button.btn', { text: '▶ New shift', onclick: async () => { const ok = await requireVerse({ reason: 'Memorize a verse to clock in for another shift.' }); if (ok) newRound(); } }),
      el('button.btn.secondary', { text: 'Back to Play', onclick: () => go('/play') }),
    );
  }

  /* ---- map ---- */
  function drawMap() {
    const [pr, pc] = currentCell();
    const faceIdx = (((Math.round(-yaw / (Math.PI / 2)) % 4) + 4) % 4); // 0..3 -> N,E,S,W
    const g = el('div.ot-map-grid'); g.style.gridTemplateColumns = `repeat(${B.cols}, 1fr)`;
    for (let r = 0; r < B.rows; r++) for (let c = 0; c < B.cols; c++) {
      const t = B.grid[r][c]; let cls = 'ot-cell ' + t; let label = '';
      if (t === 'office') { const o = B.offices[r + ',' + c]; if (o.collected) { cls += ' done'; label = '✓'; } else if (o.needsTrash) { cls += ' trash'; label = '🗑️'; } else label = o.id; }
      else if (t === 'dumpster') label = '♻️';
      if (r === pr && c === pc) { cls += ' player'; label = FACING_ARROW[faceIdx]; }
      g.append(el('div.' + cls.split(' ').join('.'), { text: String(label) }));
    }
    mapOverlay.innerHTML = '';
    mapOverlay.append(el('h3', { text: '🗺️ Building map' }), el('p.muted', { html: '🗑️ needs trash · ✓ done · ♻️ dumpster' }), g, el('button.btn', { text: 'Close map', onclick: () => toggleMap(false) }));
  }
  function toggleMap(show) {
    const on = show === undefined ? mapOverlay.style.display === 'none' : show;
    if (on) drawMap();
    mapOverlay.style.display = on ? 'flex' : 'none';
  }

  /* ---- controls (hold) ---- */
  const listeners = [];
  function on(target, type, fn, opts) { target.addEventListener(type, fn, opts); listeners.push([target, type, fn, opts]); }
  function holdBtn(label, start, stop, cls) {
    const b = el('button.ot-btn' + (cls || ''), { text: label });
    on(b, 'pointerdown', (e) => { e.preventDefault(); start(); });
    on(b, 'pointerup', stop); on(b, 'pointerleave', stop); on(b, 'pointercancel', stop);
    return b;
  }
  function buildControls() {
    controls.classList.remove('done'); controls.innerHTML = '';
    const nav = el('div.ot-nav');
    nav.append(
      holdBtn('↰', () => (turnVel = 1), () => (turnVel = 0)),
      holdBtn('▲', () => (moveVel = 1), () => (moveVel = 0), '.fwd'),
      holdBtn('↱', () => (turnVel = -1), () => (turnVel = 0)),
      el('button.ot-btn', { text: '↻', onclick: () => { if (!spinLeft) { spinLeft = Math.PI; spinSign = 1; } } }),
    );
    const actions = el('div.ot-actions');
    collectBtn = el('button.ot-btn.collect', { text: '🗑️ Collect', onclick: collect });
    dumpBtn = el('button.ot-btn.dump', { text: '🚮 Dump', onclick: dump });
    actions.append(
      el('button.ot-btn', { text: '🗺️ Map', onclick: () => toggleMap() }),
      collectBtn, dumpBtn,
    );
    controls.append(nav, actions);
  }

  // drag-to-look on the canvas
  let dragging = false, lastX = 0, lastY = 0;
  on(renderer.domElement, 'pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; renderer.domElement.style.cursor = 'grabbing'; });
  on(window, 'pointerup', () => { dragging = false; renderer.domElement.style.cursor = 'grab'; });
  on(renderer.domElement, 'pointermove', (e) => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.005;
    pitch -= (e.clientY - lastY) * 0.005;
    pitch = Math.max(-0.6, Math.min(0.6, pitch));
    lastX = e.clientX; lastY = e.clientY;
  });

  // keyboard (hold)
  const keys = {};
  on(window, 'keydown', (e) => {
    if (e.key === 'ArrowLeft') turnVel = 1; else if (e.key === 'ArrowRight') turnVel = -1;
    else if (e.key === 'ArrowUp') moveVel = 1; else if (e.key === 'ArrowDown') { if (!spinLeft) { spinLeft = Math.PI; spinSign = 1; } }
    else if (e.key === ' ' || e.key === 'Enter') collect(); else if (e.key === 'm' || e.key === 'M') toggleMap();
  });
  on(window, 'keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') turnVel = 0;
    if (e.key === 'ArrowUp') moveVel = 0;
  });

  /* ---- render loop ---- */
  let raf = 0, last = 0, lastW = 0, lastH = 0, bob = 0, bobI = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 0.016; last = t;

    // resize if needed
    const w = view.clientWidth, h = view.clientHeight;
    if (w && h && (w !== lastW || h !== lastH)) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); lastW = w; lastH = h; }

    let walking = false;
    if (!won) {
      if (spinLeft > 0) { const d = Math.min(3.2 * dt, spinLeft); yaw += spinSign * d; spinLeft -= d; }
      else if (turnVel) yaw += turnVel * 2.2 * dt;
      if (moveVel) { const fx = -Math.sin(yaw), fz = -Math.cos(yaw); tryMove(fx * 4.2 * dt, fz * 4.2 * dt); updateProximity(); walking = true; }
    }

    // head-bob while walking (eases in/out)
    bobI += ((walking ? 1 : 0) - bobI) * Math.min(1, dt * 8);
    if (walking) bob += dt * 10;
    const bobY = Math.sin(bob) * 0.06 * bobI;

    // doors swing open as you get close, ease shut when you leave
    for (const d of doors) {
      const near = Math.hypot(pos.x - d.x, pos.z - d.z) < CELL * 1.25;
      d.angle += ((near ? -1.7 : 0) - d.angle) * Math.min(1, dt * 6);
      d.grp.rotation.y = d.angle;
    }

    camera.position.set(pos.x, EYE + bobY, pos.z);
    camera.rotation.set(pitch, yaw, 0);
    renderer.render(scene, camera);
  }

  function disposeWorld() {
    scene.remove(world);
    world.traverse((o) => { if (o.isSprite && o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    ownedGeo.splice(0).forEach((g) => g.dispose());
    world = new THREE.Group(); scene.add(world);
  }

  function newRound() {
    disposeWorld();
    B = generateBuilding();
    buildWorld();
    placeStart();
    bag = 0; collected = 0; won = false; atDumpster = false; canCollect = null;
    banner.textContent = '';
    buildControls();
    drawHud();
    say('Find offices with trash (🗑️). Walk in, Collect, then dump a full bag at ♻️. Drag to look around.');
    updateProximity();
  }

  newRound();
  raf = requestAnimationFrame(frame);

  return {
    el: screen,
    destroy() {
      cancelAnimationFrame(raf);
      listeners.splice(0).forEach(([tg, ty, fn, op]) => tg.removeEventListener(ty, fn, op));
      disposeWorld();
      ownedMat.forEach((m) => m.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },
  };
}
