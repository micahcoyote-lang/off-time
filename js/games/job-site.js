/* job-site.js — "Job Site" Play task. First-person 3D, like Office Trash, but a VOXEL
   construction game: you stand on a small fenced building lot and (eventually) build a house
   out of real materials — boards, concrete, brick — placed on a voxel grid, in layers.

   Milestone 1 (this file): the WORLD. A small, bounded construction lot you can walk around
   in first person, with a visible voxel grid on the dirt and a highlight on whatever cell you
   look at (the hook we'll hang material placement off next). Job-site props (lumber, bricks,
   cement, a mixer, cones) set the scene and prove the material theme.

   Controls: HOLD ↰/↱ to rotate, HOLD ▲ to walk, ↻ to spin 180°, drag the view to look around.
   (Arrow keys held also work.) The FP rig is the same approach as office-trash.js. */

import * as THREE from '../../assets/vendor/three.module.js';
import { el, topbar, go } from '../ui.js';
import { TOOLS, getTool, getMaterial, materialsForTool } from '../../data/materials.js';
import { state } from '../state.js';

const VOX = 1;            // world units per voxel cell
const LOT = 50;           // lot is LOT x LOT cells (room for intricate builds)
const SIZE = LOT * VOX;   // world span of the lot
const EYE = 1.6;          // camera eye height
const PLAYER_R = 0.34;    // collision radius
const FENCE_H = 1.9;
const PITCH_MIN = -0.95, PITCH_MAX = 0.85;  // look down / up clamp
const GRAVITY = 14, JUMP_V = 4;             // jump feel
const STEP = 0.35;        // ledges this low are stepped onto automatically
const CLIMB = 1.4;        // max height the U + forward "climb" can mount
const RISE_SPEED = 3.5;   // float-up speed (Rise / R)
const FLY_MAX = 18;       // how high Rise can take you

export function mountJobSite(task) {
  const screen = el('section.screen.game');
  screen.append(topbar(task.title, { onBack: () => go('/play') }));
  const stage = el('div.game-stage');
  const hud = el('div.game-hud');
  const view = el('div.ot-view');
  const msg = el('div.ot-msg');
  const banner = el('div.win-banner');
  banner.style.minHeight = '1.2rem';
  const controls = el('div.ot-controls');
  stage.append(hud, view, msg, banner, controls);
  screen.append(stage);

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
  scene.background = new THREE.Color(0x9ecbf0);          // clear sky
  scene.fog = new THREE.Fog(0x9ecbf0, SIZE * 1.4, SIZE * 4.5);
  const camera = new THREE.PerspectiveCamera(72, 4 / 3, 0.1, 200);
  camera.rotation.order = 'YXZ';

  // ---- outdoor daylight ----
  scene.add(new THREE.HemisphereLight(0xcfe7ff, 0x6b5a44, 1.0));
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const sun = new THREE.DirectionalLight(0xfff4e0, 0.85);
  sun.position.set(SIZE * 0.7, SIZE * 1.8, SIZE * 0.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  const sc = sun.shadow.camera;
  sc.left = -SIZE; sc.right = SIZE; sc.top = SIZE; sc.bottom = -SIZE; sc.near = 1; sc.far = SIZE * 5;
  sc.updateProjectionMatrix();
  sun.target.position.set(SIZE / 2, 0, SIZE / 2); sun.target.updateMatrixWorld();
  scene.add(sun, sun.target);

  // ---- textures ----
  // dirt cell: brown noise + a darker line on two edges so repeats form a full grid
  const dirtTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#9c7a4f'; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 1100; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.06)';
      g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
    }
    g.strokeStyle = 'rgba(40,26,12,0.45)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 1); g.lineTo(64, 1); g.moveTo(1, 0); g.lineTo(1, 64); g.stroke();
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(LOT, LOT); t.anisotropy = 4;
    return t;
  })();
  // concrete: mottled grey with fine aggregate speckle (used by poured slabs)
  const concreteTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#b9b2a3'; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 700; i++) { const v = Math.random(); g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.07)'; g.fillRect(Math.random() * 64, Math.random() * 64, 3, 3); }
    for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(80,76,70,0.5)'; g.fillRect(Math.random() * 64, Math.random() * 64, 1.5, 1.5); }   // aggregate flecks
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  })();
  // wood: pine board with vertical grain streaks (used by framing studs)
  const woodTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 32; cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#d6b483'; g.fillRect(0, 0, 32, 64);
    for (let i = 0; i < 22; i++) { g.strokeStyle = `rgba(${120 + Math.random() * 40 | 0},${85 + Math.random() * 30 | 0},${45 + Math.random() * 25 | 0},0.35)`; g.lineWidth = 0.5 + Math.random(); const x = Math.random() * 32; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 3, 20, x - 3, 44, x + 1, 64); g.stroke(); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  })();
  // chain-link: diagonal diamonds on transparent, tiled along each fence run
  const linkTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const g = cv.getContext('2d');
    g.strokeStyle = 'rgba(190,198,206,0.9)'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(32, 32); g.moveTo(32, 0); g.lineTo(0, 32);
    g.moveTo(-16, 16); g.lineTo(16, 48); g.moveTo(16, -16); g.lineTo(48, 16);
    g.stroke();
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();

  // ---- materials ----
  const matGrass = new THREE.MeshStandardMaterial({ color: 0x6c9a44, roughness: 1 });
  const matDirt = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 1, map: dirtTex });
  const matWood = new THREE.MeshStandardMaterial({ color: 0xceaa72, roughness: 0.85 });
  const matWoodDark = new THREE.MeshStandardMaterial({ color: 0x9c7a47, roughness: 0.85 });
  const matBrick = new THREE.MeshStandardMaterial({ color: 0xb5532f, roughness: 0.9 });
  const matConcrete = new THREE.MeshStandardMaterial({ color: 0xb9b2a3, roughness: 1 });
  const matCinder = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 1 });
  const matMetal = new THREE.MeshStandardMaterial({ color: 0x8a929c, roughness: 0.5, metalness: 0.5 });
  const matOrange = new THREE.MeshStandardMaterial({ color: 0xf4762a, roughness: 0.6 });
  const matWhite = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 });
  const matGlass = new THREE.MeshStandardMaterial({ color: 0xbfe3ff, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.5 });
  const matDoor = new THREE.MeshStandardMaterial({ color: 0x8a5a3b, roughness: 0.7 });
  const matLink = new THREE.MeshBasicMaterial({ map: linkTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, opacity: 0.9 });
  const matHi = new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.4, depthWrite: false });
  const ownedMat = [matGrass, matDirt, matWood, matWoodDark, matBrick, matConcrete, matCinder, matMetal, matOrange, matWhite, matGlass, matDoor, matLink, matHi];

  const world = new THREE.Group();
  scene.add(world);
  const ownedGeo = [];
  // Solid footprints you collide with and can stand on top of: {x0,x1,z0,z1,top}.
  // (Placed building voxels will register here too, so you can stand on your build.)
  const solids = [];
  function solid(cx, cz, w, d, top) { const s = { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, top }; solids.push(s); return s; }
  // tallest solid top directly under (x,z), else ground (0)
  function supportHeight(x, z) {
    let h = 0;
    for (const s of solids) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && s.top > h) h = s.top;
    return h;
  }

  function box(w, h, d, x, y, z, mat, cast = true) {
    const g = new THREE.BoxGeometry(w, h, d); ownedGeo.push(g);
    const m = new THREE.Mesh(g, mat); m.position.set(x, y, z);
    m.castShadow = cast; m.receiveShadow = true;
    world.add(m); return m;
  }
  function cyl(rt, rb, h, x, y, z, mat) {
    const g = new THREE.CylinderGeometry(rt, rb, h, 16); ownedGeo.push(g);
    const m = new THREE.Mesh(g, mat); m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    world.add(m); return m;
  }
  function cone(r, h, x, y, z, mat) {
    const g = new THREE.ConeGeometry(r, h, 18); ownedGeo.push(g);
    const m = new THREE.Mesh(g, mat); m.position.set(x, y, z);
    m.castShadow = true;
    world.add(m); return m;
  }

  function buildLot() {
    // grass apron well beyond the fence, then the dirt build pad on top
    const gg = new THREE.PlaneGeometry(SIZE * 5, SIZE * 5); ownedGeo.push(gg);
    const grass = new THREE.Mesh(gg, matGrass); grass.rotation.x = -Math.PI / 2;
    grass.position.set(SIZE / 2, -0.05, SIZE / 2); grass.receiveShadow = true; world.add(grass);

    const dg = new THREE.PlaneGeometry(SIZE, SIZE); ownedGeo.push(dg);
    const dirt = new THREE.Mesh(dg, matDirt); dirt.rotation.x = -Math.PI / 2;
    dirt.position.set(SIZE / 2, 0, SIZE / 2); dirt.receiveShadow = true; world.add(dirt);

    buildFence();
    buildProps();
  }

  // chain-link perimeter: posts + a tiled link panel per side
  function buildFence() {
    const runs = [
      { x: SIZE / 2, z: 0, w: SIZE, axis: 'x' },
      { x: SIZE / 2, z: SIZE, w: SIZE, axis: 'x' },
      { x: 0, z: SIZE / 2, w: SIZE, axis: 'z' },
      { x: SIZE, z: SIZE / 2, w: SIZE, axis: 'z' },
    ];
    runs.forEach((r) => {
      const lg = new THREE.PlaneGeometry(r.w, FENCE_H); ownedGeo.push(lg);
      const tex = matLink.map.clone(); tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(r.w * 1.4, FENCE_H * 1.4);
      const panel = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, opacity: 0.85 }));
      ownedMat.push(panel.material);
      panel.position.set(r.x, FENCE_H / 2, r.z);
      if (r.axis === 'z') panel.rotation.y = Math.PI / 2;
      world.add(panel);
    });
    // posts at every 2 cells along the perimeter (always include the far corner)
    for (let i = 0; i <= LOT; i += 2) {
      const t = Math.min(i, LOT) * VOX;
      cyl(0.05, 0.05, FENCE_H, t, FENCE_H / 2, 0, matMetal);
      cyl(0.05, 0.05, FENCE_H, t, FENCE_H / 2, SIZE, matMetal);
      cyl(0.05, 0.05, FENCE_H, 0, FENCE_H / 2, t, matMetal);
      cyl(0.05, 0.05, FENCE_H, SIZE, FENCE_H / 2, t, matMetal);
      if (i + 2 > LOT && i !== LOT) { // odd LOT: add the missing end post
        cyl(0.05, 0.05, FENCE_H, SIZE, FENCE_H / 2, 0, matMetal);
        cyl(0.05, 0.05, FENCE_H, SIZE, FENCE_H / 2, SIZE, matMetal);
        cyl(0.05, 0.05, FENCE_H, 0, FENCE_H / 2, SIZE, matMetal);
      }
    }
  }

  function buildProps() {
    // Props auto-ring the lot's corners/edges (positions scale with SIZE) so the
    // center stays clear for building. Each registers a solid you can stand/climb on.
    const IN = 3.5, M = SIZE / 2;            // corner inset, mid edge

    // stack of lumber boards (long thin boxes) — NW corner. top ~0.78
    for (let i = 0; i < 6; i++) {
      const y = 0.07 + i * 0.13;
      if (i % 2) box(0.5, 0.12, 3.2, IN, y, IN, i % 3 ? matWood : matWoodDark);
      else box(3.2, 0.12, 0.5, IN, y, IN, i % 3 ? matWoodDark : matWood);
    }
    solid(IN, IN, 3.2, 3.2, 0.84);

    // pallet of bricks — NE corner. top ~0.97
    box(1.5, 0.14, 1.1, SIZE - IN, 0.07, IN, matWoodDark);     // pallet
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++)
      box(0.62, 0.5, 0.42, SIZE - IN + (c - 0.5) * 0.66, 0.4 + r * 0.16, IN, matBrick);
    solid(SIZE - IN, IN, 1.5, 1.1, 0.97);

    // stacked cement / concrete bags — SW corner. top ~0.66
    for (let i = 0; i < 4; i++)
      box(1.0, 0.26, 0.6, IN + (i % 2) * 0.1, 0.13 + Math.floor(i / 2) * 0.27, SIZE - IN, matConcrete);
    solid(IN, SIZE - IN, 1.2, 0.7, 0.66);

    // cinder-block stack — SE corner. top ~0.72
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      box(0.4, 0.2, 0.5, SIZE - IN - 0.6 + c * 0.45, 0.1 + r * 0.21, SIZE - IN, matCinder);
    solid(SIZE - IN, SIZE - IN, 1.5, 0.6, 0.72);

    // cement mixer near the north edge: legs, drum, motor
    box(0.1, 0.9, 0.1, M - 0.4, 0.45, 2.6, matMetal); box(0.1, 0.9, 0.1, M + 0.4, 0.45, 2.6, matMetal);
    box(0.1, 0.9, 0.1, M, 0.45, 3.0, matMetal);
    const drum = cyl(0.55, 0.42, 0.7, M, 1.05, 2.65, matOrange); drum.rotation.z = 0.5;
    box(0.3, 0.3, 0.3, M, 1.0, 3.15, matMetal);              // motor housing
    solid(M, 2.7, 1.3, 1.0, 1.4);

    // traffic cones with a reflective band — along the side edges (non-solid, easy to brush past)
    [[IN + 1, M], [SIZE - IN - 1, M + 0.5]].forEach(([x, z]) => {
      cone(0.28, 0.7, x, 0.35, z, matOrange);
      box(0.34, 0.08, 0.34, x, 0.62, z, matWhite, false);
      box(0.5, 0.04, 0.5, x, 0.02, z, matOrange, false);     // base plate
    });
  }

  // ---- gaze → target cell (raycast the ground); the build ghost rides this ----
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ray = new THREE.Ray();
  const fwd = new THREE.Vector3();
  const hit = new THREE.Vector3();
  let targetCell = null, targetHit = null;
  function updateTarget() {
    camera.getWorldDirection(fwd);
    ray.set(camera.position, fwd);
    const p = ray.intersectPlane(groundPlane, hit);
    if (p && p.x >= 0 && p.x < SIZE && p.z >= 0 && p.z < SIZE) {
      const i = Math.floor(p.x / VOX), j = Math.floor(p.z / VOX);
      targetHit = { x: p.x, z: p.z };
      if (!targetCell || targetCell[0] !== i || targetCell[1] !== j) targetCell = [i, j];
    } else { targetCell = null; targetHit = null; }
  }

  /* ---- build system: tool belt, materials, ghost preview, foundation blueprint ---- */
  const HOUSE = 12;                                  // foundation footprint is HOUSE×HOUSE cells
  const FP0 = Math.floor((LOT - HOUSE) / 2);         // first footprint cell index (centered)
  const FP1 = FP0 + HOUSE - 1;                        // last
  const FP_TOTAL = HOUSE * HOUSE;
  const inFootprint = (i, j) => i >= FP0 && i <= FP1 && j >= FP0 && j <= FP1;
  const BASE = 0.25;                  // foundation top — framing sits on this
  const WALL_H = 2.5;                  // stud-wall height (matches material size.h)
  const TOPY = BASE + WALL_H;          // wall top — eaves / roof springing line
  const RIDGE = (FP0 + FP1 + 1) / 2;   // center z line of the footprint (roof peak)
  const ROOF_PER = 0.35;               // roof rise per cell from eave toward the ridge
  const roofH = (z) => TOPY + Math.max(0, HOUSE / 2 - Math.abs(z - RIDGE)) * ROOF_PER;

  const placed = new Map();           // pieceKey -> { meshes:[], solidRef, matId }
  const placeMats = {};               // shared MeshStandardMaterial per material id
  const TEX = { concrete: concreteTex, wood: woodTex };
  let poured = 0, wallsCount = 0, panelsCount = 0, roofCount = 0, done = false;
  let activeTool = TOOLS[0].id;
  let activeMaterial = materialsForTool(activeTool)[0] || null;
  const PALETTE = [
    { name: 'White', hex: 0xf3f1ea }, { name: 'Warm Gray', hex: 0x9aa0a6 },
    { name: 'Tan', hex: 0xc8a878 }, { name: 'Barn Red', hex: 0xa1392f },
    { name: 'Sage', hex: 0x8aa37b }, { name: 'Sky', hex: 0x7fb4d6 },
  ];
  let paintColor = 0;

  function say(t) { msg.textContent = t || ''; }
  function placeMat(m) {
    if (!placeMats[m.id]) {
      const mat = new THREE.MeshStandardMaterial({ color: m.color, roughness: 1, map: m.tex ? TEX[m.tex] : null });
      ownedMat.push(mat); placeMats[m.id] = mat;
    }
    return placeMats[m.id];
  }

  // Piece keys: floor 'F,i,j'; vertical wall 'V,xline,row'; horizontal wall 'H,col,zline'.
  // For edge pieces, which of the cell's 4 edges does the gaze fall nearest?
  function edgeAt(i, j, hx, hz) {
    const fx = hx - i, fz = hz - j;
    const mn = Math.min(fx, 1 - fx, fz, 1 - fz);
    if (mn === fx) return { kind: 'V', cx: i, cz: j + 0.5, key: `V,${i},${j}`, cells: [[i - 1, j], [i, j]] };
    if (mn === 1 - fx) return { kind: 'V', cx: i + 1, cz: j + 0.5, key: `V,${i + 1},${j}`, cells: [[i, j], [i + 1, j]] };
    if (mn === fz) return { kind: 'H', cx: i + 0.5, cz: j, key: `H,${i},${j}`, cells: [[i, j - 1], [i, j]] };
    return { kind: 'H', cx: i + 0.5, cz: j + 1, key: `H,${i},${j + 1}`, cells: [[i, j], [i, j + 1]] };
  }
  const hasFoundation = (edge) => edge.cells.some(([ci, cj]) => placed.has(`F,${ci},${cj}`));
  const hasFraming = (edge) => placed.has(edge.key);
  const hasWallAround = (i, j) => [`V,${i},${j}`, `V,${i + 1},${j}`, `H,${i},${j}`, `H,${i},${j + 1}`].some((k) => placed.has(k));
  function parseEdge(key) {
    const [kind, a, b] = key.split(',');
    return kind === 'V' ? { kind: 'V', cx: +a, cz: +b + 0.5 } : { kind: 'H', cx: +a + 0.5, cz: +b };
  }
  // a sheathing face = which side of the wall (toward the aimed cell). Key 'edgeKey|side'.
  const FACE_OFF = 0.12;
  function faceFor(i, j, edge) {
    const m = (activeMaterial && activeMaterial.anchor === 'face') ? activeMaterial : getMaterial('plywood');
    const H = m.size.h, T = m.size.t;
    if (edge.kind === 'V') { const side = i < edge.cx ? -1 : 1; return { key: `${edge.key}|${side}`, kind: 'V', cx: edge.cx + side * FACE_OFF, cz: edge.cz, H, T }; }
    const side = j < edge.cz ? -1 : 1;
    return { key: `${edge.key}|${side}`, kind: 'H', cx: edge.cx, cz: edge.cz + side * FACE_OFF, H, T };
  }
  function panelFromKey(edgeKey, side, m) {
    const e = parseEdge(edgeKey), H = m.size.h, T = m.size.t;
    if (e.kind === 'V') return { key: `${edgeKey}|${side}`, kind: 'V', cx: e.cx + side * FACE_OFF, cz: e.cz, H, T };
    return { key: `${edgeKey}|${side}`, kind: 'H', cx: e.cx, cz: e.cz + side * FACE_OFF, H, T };
  }

  // faint blueprint of the foundation footprint (fill + border) on the ground
  function drawBlueprint() {
    const bg = new THREE.PlaneGeometry(HOUSE, HOUSE); ownedGeo.push(bg);
    const fill = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.12, depthWrite: false }));
    ownedMat.push(fill.material);
    fill.rotation.x = -Math.PI / 2; fill.position.set(FP0 + HOUSE / 2, 0.02, FP0 + HOUSE / 2);
    world.add(fill);
    const a = FP0, b = FP1 + 1, y = 0.03;
    const pts = [[a, a], [b, a], [b, b], [a, b], [a, a]].map(([x, z]) => new THREE.Vector3(x, y, z));
    const lg = new THREE.BufferGeometry().setFromPoints(pts); ownedGeo.push(lg);
    const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x38bdf8 }));
    ownedMat.push(line.material); world.add(line);
  }

  // a single unit-box ghost, scaled/positioned per placement, recolored by validity (matHi shared)
  let ghostMesh = null;
  function buildGhost() {
    const g = new THREE.BoxGeometry(1, 1, 1); ownedGeo.push(g);
    ghostMesh = new THREE.Mesh(g, matHi); world.add(ghostMesh);
  }
  // What would Build act on right now? → a place/remove descriptor (or null).
  function currentPlacement() {
    if (!targetCell || !targetHit) return null;
    const [i, j] = targetCell;
    const edge = edgeAt(i, j, targetHit.x, targetHit.z);
    if (activeTool === 'prybar') {
      const face = faceFor(i, j, edge);
      if (placed.has(face.key)) return { mode: 'remove', key: face.key, face };
      if (placed.has(edge.key)) return { mode: 'remove', key: edge.key, edge };
      if (placed.has(`R,${i},${j}`)) return { mode: 'remove', key: `R,${i},${j}`, roof: [i, j] };
      if (placed.has(`F,${i},${j}`)) return { mode: 'remove', key: `F,${i},${j}`, floor: [i, j] };
      return { mode: 'remove', key: null, edge };
    }
    if (activeTool === 'roller') {
      const face = faceFor(i, j, edge);
      return { mode: 'paint', key: placed.has(face.key) ? face.key : null, face };
    }
    if (!activeMaterial) return null;
    if (activeMaterial.anchor === 'floor')
      return { mode: 'place', anchor: 'floor', i, j, ok: inFootprint(i, j) && !placed.has(`F,${i},${j}`) };
    if (activeMaterial.anchor === 'edge')
      return { mode: 'place', anchor: 'edge', edge, ok: !placed.has(edge.key) && hasFoundation(edge) };
    if (activeMaterial.anchor === 'roof')
      return { mode: 'place', anchor: 'roof', i, j, ok: !placed.has(`R,${i},${j}`) && hasWallAround(i, j) };
    const face = faceFor(i, j, edge);
    return { mode: 'place', anchor: 'face', edge, face, ok: hasFraming(edge) && !placed.has(face.key) };
  }
  function setGhostEdge(edge) {
    const wm = (activeMaterial && activeMaterial.anchor === 'edge') ? activeMaterial : getMaterial('stud-wall');
    const H = wm ? wm.size.h : 2.5, T = wm ? wm.size.t : 0.16;
    if (edge.kind === 'V') ghostMesh.scale.set(T, H, 1); else ghostMesh.scale.set(1, H, T);
    ghostMesh.position.set(edge.cx, BASE + H / 2, edge.cz);
  }
  function setGhostFace(face) {
    if (face.kind === 'V') ghostMesh.scale.set(face.T, face.H, 1); else ghostMesh.scale.set(1, face.H, face.T);
    ghostMesh.position.set(face.cx, BASE + face.H / 2, face.cz);
  }
  function setGhostRoof(i, j) {
    const hN = roofH(j), hS = roofH(j + 1), rise = hN - hS;
    ghostMesh.scale.set(1, 0.12, Math.hypot(1, rise));
    ghostMesh.position.set(i + 0.5, (hN + hS) / 2, j + 0.5);
    ghostMesh.rotation.x = Math.atan2(rise, 1);
  }
  function updateGhost() {
    if (!ghostMesh) return;
    const pl = currentPlacement();
    if (!pl) { ghostMesh.visible = false; return; }
    ghostMesh.visible = true;
    ghostMesh.rotation.x = 0;
    if (pl.mode === 'remove') {
      matHi.color.setHex(pl.key ? 0xf87171 : 0x64748b);
      if (pl.floor) { ghostMesh.scale.set(1, 0.25, 1); ghostMesh.position.set(pl.floor[0] + 0.5, 0.13, pl.floor[1] + 0.5); }
      else if (pl.roof) setGhostRoof(pl.roof[0], pl.roof[1]);
      else if (pl.face) setGhostFace(pl.face);
      else setGhostEdge(pl.edge);
      return;
    }
    if (pl.mode === 'paint') {
      matHi.color.setHex(pl.key ? PALETTE[paintColor].hex : 0x64748b);
      setGhostFace(pl.face);
      return;
    }
    matHi.color.setHex(pl.ok ? 0x4ade80 : 0xf87171);
    if (pl.anchor === 'floor') { const s = activeMaterial.size; ghostMesh.scale.set(s.w, s.h, s.d); ghostMesh.position.set(pl.i + 0.5, s.h / 2, pl.j + 0.5); }
    else if (pl.anchor === 'face') setGhostFace(pl.face);
    else if (pl.anchor === 'roof') setGhostRoof(pl.i, pl.j);
    else setGhostEdge(pl.edge);
  }

  function placeFloor(i, j, m) {
    const s = m.size;
    const mesh = box(s.w, s.h, s.d, i + 0.5, s.h / 2, j + 0.5, placeMat(m), false);
    const solidRef = solid(i + 0.5, j + 0.5, s.w, s.d, s.h);
    placed.set(`F,${i},${j}`, { meshes: [mesh], solidRef, matId: m.id });
    poured++;
  }
  // a framed stud wall (bottom + top plates + 4 studs) standing on an edge, wood-textured
  function buildStudWall(edge, m) {
    const mat = placeMat(m), meshes = [];
    const H = m.size.h, T = m.size.t, PLATE = 0.1, STUD = 0.1, vert = edge.kind === 'V';
    const plate = (y) => meshes.push(vert
      ? box(T, PLATE, 1, edge.cx, BASE + y, edge.cz, mat, false)
      : box(1, PLATE, T, edge.cx, BASE + y, edge.cz, mat, false));
    plate(PLATE / 2); plate(H - PLATE / 2);
    const n = 4;
    for (let k = 0; k < n; k++) {
      const off = -0.5 + (k + 0.5) / n;
      meshes.push(vert
        ? box(T, H - PLATE * 2, STUD, edge.cx, BASE + H / 2, edge.cz + off, mat, false)
        : box(STUD, H - PLATE * 2, T, edge.cx + off, BASE + H / 2, edge.cz, mat, false));
    }
    return meshes;
  }
  // window wall: jambs + sill + header framing a glass pane
  function buildWindowWall(edge, m) {
    const wood = placeMat(getMaterial('stud-wall')), meshes = [], H = m.size.h, T = m.size.t, P = 0.1, v = edge.kind === 'V', cx = edge.cx, cz = edge.cz;
    const bx = (w, hh, d, x, y, z, mt) => meshes.push(box(w, hh, d, x, y, z, mt, false));
    if (v) {
      bx(T, P, 1, cx, BASE + P / 2, cz, wood); bx(T, P, 1, cx, BASE + H - P / 2, cz, wood);     // plates
      bx(T, H, 0.12, cx, BASE + H / 2, cz - 0.45, wood); bx(T, H, 0.12, cx, BASE + H / 2, cz + 0.45, wood); // jambs
      bx(T, 0.1, 0.9, cx, BASE + 0.9, cz, wood); bx(T, 0.1, 0.9, cx, BASE + 1.95, cz, wood);   // sill, header
      bx(T * 0.5, 1.0, 0.85, cx, BASE + 1.42, cz, matGlass);                                    // glass
    } else {
      bx(1, P, T, cx, BASE + P / 2, cz, wood); bx(1, P, T, cx, BASE + H - P / 2, cz, wood);
      bx(0.12, H, T, cx - 0.45, BASE + H / 2, cz, wood); bx(0.12, H, T, cx + 0.45, BASE + H / 2, cz, wood);
      bx(0.9, 0.1, T, cx, BASE + 0.9, cz, wood); bx(0.9, 0.1, T, cx, BASE + 1.95, cz, wood);
      bx(0.85, 1.0, T * 0.5, cx, BASE + 1.42, cz, matGlass);
    }
    return meshes;
  }
  // door wall: header + jambs around an open doorway with a leaf (no bottom plate)
  function buildDoorWall(edge, m) {
    const wood = placeMat(getMaterial('stud-wall')), meshes = [], H = m.size.h, T = m.size.t, dH = 2.05, v = edge.kind === 'V', cx = edge.cx, cz = edge.cz;
    const bx = (w, hh, d, x, y, z, mt) => meshes.push(box(w, hh, d, x, y, z, mt, false));
    if (v) {
      bx(T, 0.1, 1, cx, BASE + H - 0.05, cz, wood);                                             // top plate
      bx(T, H, 0.12, cx, BASE + H / 2, cz - 0.45, wood); bx(T, H, 0.12, cx, BASE + H / 2, cz + 0.45, wood); // jambs
      bx(T, 0.14, 0.9, cx, BASE + dH, cz, wood);                                                // header
      bx(T * 0.6, dH - 0.06, 0.7, cx, BASE + (dH - 0.06) / 2, cz, matDoor);                      // leaf
    } else {
      bx(1, 0.1, T, cx, BASE + H - 0.05, cz, wood);
      bx(0.12, H, T, cx - 0.45, BASE + H / 2, cz, wood); bx(0.12, H, T, cx + 0.45, BASE + H / 2, cz, wood);
      bx(0.9, 0.14, T, cx, BASE + dH, cz, wood);
      bx(0.7, dH - 0.06, T * 0.6, cx, BASE + (dH - 0.06) / 2, cz, matDoor);
    }
    return meshes;
  }
  function buildWallPiece(edge, m) {
    if (m.id === 'window-wall') return buildWindowWall(edge, m);
    if (m.id === 'door-wall') return buildDoorWall(edge, m);
    return buildStudWall(edge, m);
  }
  function placeWall(edge, m) {
    const meshes = buildWallPiece(edge, m);
    const top = BASE + m.size.h;
    let solidRef = null;                       // doors are walk-through; everything else blocks
    if (m.id !== 'door-wall') solidRef = edge.kind === 'V' ? solid(edge.cx, edge.cz, 0.28, 1, top) : solid(edge.cx, edge.cz, 1, 0.28, top);
    placed.set(edge.key, { meshes, solidRef, matId: m.id });
    wallsCount++;
  }
  // a gable roof section over one cell: a sloped panel + a couple of rafters under it
  function buildRoof(i, j, m) {
    const shingle = placeMat(m), wood = placeMat(getMaterial('stud-wall')), meshes = [];
    const hN = roofH(j), hS = roofH(j + 1), cx = i + 0.5, cz = j + 0.5;
    const cy = (hN + hS) / 2, rise = hN - hS, len = Math.hypot(1, rise), tilt = Math.atan2(rise, 1);
    const panel = box(1.0, 0.07, len, cx, cy, cz, shingle, true); panel.rotation.x = tilt; meshes.push(panel);
    [-0.34, 0.34].forEach((ox) => { const rf = box(0.07, 0.12, len, cx + ox, cy - 0.08, cz, wood, false); rf.rotation.x = tilt; meshes.push(rf); });
    return meshes;
  }
  function placeRoofPiece(i, j, m) {
    const meshes = buildRoof(i, j, m);
    placed.set(`R,${i},${j}`, { meshes, solidRef: null, matId: m.id });
    roofCount++;
  }
  // a flat sheathing panel on one face of a wall (own material so it can be painted individually)
  function placePanel(face, m, colorHex) {
    const painted = colorHex != null, col = painted ? colorHex : m.color;
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.9, map: (!painted && m.tex) ? TEX[m.tex] : null });
    ownedMat.push(mat);
    const mesh = face.kind === 'V'
      ? box(m.size.t, m.size.h, 1, face.cx, BASE + m.size.h / 2, face.cz, mat, false)
      : box(1, m.size.h, m.size.t, face.cx, BASE + m.size.h / 2, face.cz, mat, false);
    placed.set(face.key, { meshes: [mesh], solidRef: null, matId: m.id, color: painted ? col : null });
    panelsCount++;
  }
  function paintPanel(key) {
    const rec = placed.get(key); if (!rec) return false;
    const hex = PALETTE[paintColor].hex, mat = rec.meshes[0].material;
    mat.color.setHex(hex); mat.map = null; mat.needsUpdate = true;
    rec.color = hex;
    return true;
  }

  // ---- save / restore (localStorage via state.js) ----
  const SAVE_PATH = 'builds.job-site';
  function persist() {
    const pieces = [];
    placed.forEach((rec, key) => pieces.push(rec.color != null ? { k: key, m: rec.matId, c: rec.color } : { k: key, m: rec.matId }));
    state.set(SAVE_PATH, { v: 2, pieces });
  }
  function restoreBuild() {
    const saved = state.get(SAVE_PATH, null);
    if (!saved || !Array.isArray(saved.pieces)) return;
    saved.pieces.forEach((p) => {
      const m = getMaterial(p.m); if (!m) return;
      if (p.k) {
        if (placed.has(p.k)) return;
        if (p.k.includes('|')) {
          const [ek, sd] = p.k.split('|');
          placePanel(panelFromKey(ek, +sd, m), m, p.c != null ? p.c : null);
        } else {
          const [kind, a, b] = p.k.split(',');
          if (kind === 'F') placeFloor(+a, +b, m);
          else if (kind === 'V') placeWall({ kind: 'V', cx: +a, cz: +b + 0.5, key: p.k }, m);
          else if (kind === 'H') placeWall({ kind: 'H', cx: +a + 0.5, cz: +b, key: p.k }, m);
          else if (kind === 'R') placeRoofPiece(+a, +b, m);
        }
      } else if (typeof p.i === 'number' && !placed.has(`F,${p.i},${p.j}`)) {
        placeFloor(p.i, p.j, m);              // legacy v1 save (floor only)
      }
    });
    if (poured >= FP_TOTAL) { done = true; banner.textContent = '🎉 Foundation complete!'; }
  }
  function removePiece(key) {
    const rec = placed.get(key);
    if (!rec) return false;
    const panel = key.includes('|');
    rec.meshes.forEach((mm) => { world.remove(mm); mm.geometry.dispose(); if (panel && mm.material) mm.material.dispose(); }); // panel mats are per-piece
    if (rec.solidRef) { const idx = solids.indexOf(rec.solidRef); if (idx >= 0) solids.splice(idx, 1); }
    placed.delete(key);
    if (key[0] === 'F') { poured = Math.max(0, poured - 1); done = false; if (banner.textContent.includes('Foundation')) banner.textContent = ''; }
    else if (key[0] === 'R') roofCount = Math.max(0, roofCount - 1);
    else if (panel) panelsCount = Math.max(0, panelsCount - 1);
    else wallsCount = Math.max(0, wallsCount - 1);
    return true;
  }
  function build() {
    const pl = currentPlacement();
    if (!pl) return;
    if (pl.mode === 'remove') {
      if (pl.key && removePiece(pl.key)) { say('Removed it.'); persist(); drawHud(); }
      else say('Nothing here to remove.');
      return;
    }
    if (pl.mode === 'paint') {
      if (pl.key && paintPanel(pl.key)) { say(`Painted ${PALETTE[paintColor].name}.`); persist(); }
      else say('Aim at a hung sheet to paint it.');
      return;
    }
    if (!pl.ok) {
      if (pl.anchor === 'floor') say(inFootprint(pl.i, pl.j) ? 'A slab is already poured here.' : 'Pour inside the blue footprint.');
      else if (pl.anchor === 'edge') say(placed.has(pl.edge.key) ? 'Something is already on this edge.' : 'Frame on the edge of a poured foundation.');
      else if (pl.anchor === 'roof') say(placed.has(`R,${pl.i},${pl.j}`) ? 'Roof is already on here.' : 'Roof needs walls — frame around this cell first.');
      else say(placed.has(pl.face.key) ? 'A sheet is already hung here.' : 'Sheathe a framed wall — frame the studs first.');
      return;
    }
    if (pl.anchor === 'floor') {
      placeFloor(pl.i, pl.j, activeMaterial);
      if (poured >= FP_TOTAL && !done) finishFoundation();
      else say(`Slab poured — foundation ${poured}/${FP_TOTAL}.`);
    } else if (pl.anchor === 'edge') {
      placeWall(pl.edge, activeMaterial);
      say(`${activeMaterial.title} framed — ${wallsCount} up.`);
    } else if (pl.anchor === 'roof') {
      placeRoofPiece(pl.i, pl.j, activeMaterial);
      say(`Roof section on — ${roofCount} up.`);
    } else {
      placePanel(pl.face, activeMaterial);
      say(`${activeMaterial.title} hung — ${panelsCount} sheets.`);
    }
    persist(); drawHud();
  }
  function finishFoundation() {
    done = true; banner.textContent = '🎉 Foundation complete!';
    say('Foundation complete — grab the 🔨 Hammer to frame walls on the edges.');
  }

  const belt = el('div.tool-belt');
  function refreshBelt() {
    belt.innerHTML = '';
    TOOLS.forEach((t) => belt.append(el('button.tool-btn' + (t.id === activeTool ? '.active' : ''),
      { text: `${t.emoji} ${t.title}`, onclick: () => selectTool(t.id) })));
  }
  function selectTool(id) {
    const mats = materialsForTool(id);
    if (id === activeTool && mats.length > 1) {            // re-tap the active tool → cycle its materials
      const idx = mats.findIndex((x) => activeMaterial && x.id === activeMaterial.id);
      activeMaterial = mats[(idx + 1) % mats.length];
    } else {
      activeTool = id;
      if (mats.length) activeMaterial = mats[0];
    }
    refreshBelt(); drawHud();
    if (id === 'prybar') say('Pry Bar — aim at a piece and Build to remove it.');
    else if (id === 'hammer') say(`Hammer — aim at a foundation edge and Build a ${activeMaterial ? activeMaterial.title : 'wall'} (tap Hammer again to cycle Wall / Window / Door).`);
    else if (id === 'drill') say(`Drill — aim at a framed wall and Build to hang ${activeMaterial ? activeMaterial.title : 'a sheet'} (tap Drill again to switch sheet).`);
    else if (id === 'roofer') say('Roof — aim at a walled cell and Build to drop a roof section (gable, peaks at center).');
    else if (id === 'roller') say(`Roller — aim at a sheet and Build to paint it ${PALETTE[paintColor].name}. Tap 🎨 to change color.`);
    else say('Trowel — aim inside the footprint and Build to pour concrete.');
  }
  function cycleMaterial() {
    const mats = materialsForTool(activeTool);
    if (mats.length > 1) { const idx = mats.findIndex((x) => activeMaterial && x.id === activeMaterial.id); activeMaterial = mats[(idx + 1) % mats.length]; drawHud(); say(`Switched to ${activeMaterial.title}.`); }
  }
  function cycleColor() { paintColor = (paintColor + 1) % PALETTE.length; drawHud(); say(`Paint: ${PALETTE[paintColor].name}.`); }

  /* ---- camera + movement state ---- */
  const pos = new THREE.Vector3(SIZE / 2, EYE, SIZE - 1.3);
  let yaw = 0, pitch = 0;                 // yaw 0 faces -z, toward the lot
  let turnVel = 0, moveVel = 0, spinLeft = 0, spinSign = 1, pitchVel = 0;
  let feetY = 0, velY = 0, grounded = true, riseVel = 0, hover = false;   // vertical position / physics
  let hoverBtn = null;
  function jump() { if (grounded) { velY = JUMP_V; grounded = false; } }
  function toggleHover() {
    hover = !hover;
    if (hoverBtn) hoverBtn.classList.toggle('on', hover);
    say(hover ? 'Holding altitude — press Hold (H) again to drop.' : 'Released — coming down.');
  }

  // A solid blocks horizontal movement only if its top is too high to step onto
  // from the player's current feet height. Walk over it once you're above it.
  function blockedAt(x, z) {
    for (const s of solids) {
      if (x > s.x0 - PLAYER_R && x < s.x1 + PLAYER_R && z > s.z0 - PLAYER_R && z < s.z1 + PLAYER_R
          && s.top > feetY + STEP) return s;
    }
    return null;
  }
  function tryMove(dx, dz) {
    let nx = Math.max(PLAYER_R, Math.min(SIZE - PLAYER_R, pos.x + dx));
    let s = blockedAt(nx, pos.z);
    if (s) nx = dx > 0 ? Math.min(nx, s.x0 - PLAYER_R) : Math.max(nx, s.x1 + PLAYER_R);
    pos.x = nx;
    let nz = Math.max(PLAYER_R, Math.min(SIZE - PLAYER_R, pos.z + dz));
    s = blockedAt(pos.x, nz);
    if (s) nz = dz > 0 ? Math.min(nz, s.z0 - PLAYER_R) : Math.max(nz, s.z1 + PLAYER_R);
    pos.z = nz;
  }

  /* ---- HUD / controls ---- */
  function drawHud() {
    const t = getTool(activeTool);
    const held = activeTool === 'prybar' ? 'Remove' : activeTool === 'roller' ? `Paint: ${PALETTE[paintColor].name}` : (activeMaterial ? activeMaterial.title : '—');
    hud.innerHTML = `<span class="chip">${t.emoji} ${held}</span><span class="chip">🧱 ${poured}/${FP_TOTAL}</span><span class="chip">🪵${wallsCount} 🟫${panelsCount} 🏠${roofCount}</span>`;
  }

  const listeners = [];
  function on(target, type, fn, opts) { target.addEventListener(type, fn, opts); listeners.push([target, type, fn, opts]); }
  function holdBtn(label, start, stop, cls) {
    const b = el('button.ot-btn' + (cls || ''), { text: label });
    on(b, 'pointerdown', (e) => { e.preventDefault(); start(); });
    on(b, 'pointerup', stop); on(b, 'pointerleave', stop); on(b, 'pointercancel', stop);
    return b;
  }
  function buildControls() {
    const nav = el('div.ot-nav');
    nav.append(
      holdBtn('↰', () => (turnVel = 1), () => (turnVel = 0)),
      holdBtn('▲', () => (moveVel = 1), () => (moveVel = 0), '.fwd'),
      holdBtn('↱', () => (turnVel = -1), () => (turnVel = 0)),
      el('button.ot-btn', { text: '↻', onclick: () => { if (!spinLeft) { spinLeft = Math.PI; spinSign = 1; } } }),
    );
    const actions = el('div.ot-actions', { style: 'grid-template-columns:repeat(5,1fr)' });
    hoverBtn = el('button.ot-btn' + (hover ? '.on' : ''), { text: 'Hold ⏸', onclick: toggleHover });
    actions.append(
      holdBtn('Look ↑', () => (pitchVel = 1), () => (pitchVel = 0)),
      el('button.ot-btn.fwd', { text: 'Jump ⤴', onclick: jump }),
      holdBtn('Rise ⤒', () => (riseVel = 1), () => (riseVel = 0)),
      hoverBtn,
      holdBtn('Look ↓', () => (pitchVel = -1), () => (pitchVel = 0)),
    );
    refreshBelt();
    const buildRow = el('div.build-row', {}, [
      el('button.ot-btn.build', { text: '🔨 Build', onclick: build }),
      el('button.ot-btn', { text: '🎨', onclick: cycleColor, style: 'flex:0 0 auto' }),
    ]);
    controls.append(belt, buildRow, nav, actions);
  }

  // drag-to-look
  let dragging = false, lastX = 0, lastY = 0;
  on(renderer.domElement, 'pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; renderer.domElement.style.cursor = 'grabbing'; });
  on(window, 'pointerup', () => { dragging = false; renderer.domElement.style.cursor = 'grab'; });
  on(renderer.domElement, 'pointermove', (e) => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.005;
    pitch -= (e.clientY - lastY) * 0.005;
    pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch));
    lastX = e.clientX; lastY = e.clientY;
  });
  // keyboard (hold)
  on(window, 'keydown', (e) => {
    if (e.key === 'ArrowLeft') turnVel = 1; else if (e.key === 'ArrowRight') turnVel = -1;
    else if (e.key === 'ArrowUp') moveVel = 1; else if (e.key === 'ArrowDown') { if (!spinLeft) { spinLeft = Math.PI; spinSign = 1; } }
    else if (e.key === 'u' || e.key === 'U') pitchVel = 1;
    else if (e.key === 'd' || e.key === 'D') pitchVel = -1;
    else if (e.key === 'r' || e.key === 'R') riseVel = 1;
    else if ((e.key === 'h' || e.key === 'H') && !e.repeat) toggleHover();
    else if (e.key === 'j' || e.key === 'J') jump();
    else if (e.key >= '1' && e.key <= '9') { const idx = +e.key - 1; if (TOOLS[idx]) selectTool(TOOLS[idx].id); }
    else if (e.key === 'm' || e.key === 'M') cycleMaterial();
    else if (e.key === 'c' || e.key === 'C') cycleColor();
    else if (e.key === 'b' || e.key === 'B' || e.key === 'Enter') build();
  });
  on(window, 'keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') turnVel = 0;
    if (e.key === 'ArrowUp') moveVel = 0;
    if (e.key === 'u' || e.key === 'U' || e.key === 'd' || e.key === 'D') pitchVel = 0;
    if (e.key === 'r' || e.key === 'R') riseVel = 0;
  });

  /* ---- render loop ---- */
  let raf = 0, last = 0, lastW = 0, lastH = 0, bob = 0, bobI = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 0.016; last = t;

    const w = view.clientWidth, h = view.clientHeight;
    if (w && h && (w !== lastW || h !== lastH)) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); lastW = w; lastH = h; }

    let walking = false;
    if (spinLeft > 0) { const d = Math.min(3.2 * dt, spinLeft); yaw += spinSign * d; spinLeft -= d; }
    else if (turnVel) yaw += turnVel * 2.2 * dt;
    if (pitchVel) pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch + pitchVel * 1.6 * dt));
    if (moveVel) {
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      // climb: looking up (U) + walking into a ledge just ahead → hop just high enough to mount it
      if (grounded && pitchVel > 0) {
        const aTop = supportHeight(pos.x + fx * 0.7, pos.z + fz * 0.7);
        if (aTop > feetY + STEP && aTop <= feetY + CLIMB) { velY = Math.sqrt(2 * GRAVITY * (aTop - feetY + 0.18)); grounded = false; }
      }
      tryMove(fx * 3.2 * dt, fz * 3.2 * dt);
      walking = true;
    }

    // vertical physics: Rise floats up (gravity suspended); else stand/step/fall as normal
    const support = supportHeight(pos.x, pos.z);
    if (riseVel) {
      feetY = Math.min(FLY_MAX, feetY + RISE_SPEED * dt); velY = 0; grounded = false;
    } else if (hover) {
      velY = 0; grounded = false;                 // lock current altitude
    } else {
      if (grounded && support > feetY && support - feetY <= STEP) { feetY = support; velY = 0; }
      velY -= GRAVITY * dt;
      feetY += velY * dt;
      if (feetY <= support) { feetY = support; velY = 0; grounded = true; } else grounded = false;
    }

    bobI += ((walking && grounded ? 1 : 0) - bobI) * Math.min(1, dt * 8);
    if (walking && grounded) bob += dt * 10;
    const bobY = Math.sin(bob) * 0.05 * bobI;

    camera.position.set(pos.x, feetY + EYE + bobY, pos.z);
    camera.rotation.set(pitch, yaw, 0);
    updateTarget();
    updateGhost();
    renderer.render(scene, camera);
  }

  buildLot();
  drawBlueprint();
  restoreBuild();
  buildGhost();
  buildControls();
  drawHud();
  say(poured
    ? `Welcome back — foundation ${poured}/${FP_TOTAL}. Keep pouring inside the footprint.`
    : 'Pick the 🧱 Trowel, aim inside the blue footprint, and 🔨 Build to pour concrete. (Pry Bar removes.)');
  raf = requestAnimationFrame(frame);

  return {
    el: screen,
    destroy() {
      cancelAnimationFrame(raf);
      listeners.splice(0).forEach(([tg, ty, fn, op]) => tg.removeEventListener(ty, fn, op));
      scene.remove(world);
      ownedGeo.splice(0).forEach((g) => g.dispose());
      ownedMat.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },
  };
}
