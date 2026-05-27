/* =============================================
   CityRoute — Sketsa Peta Spasial Kota Virtual
   app.js

   Fitur:
   - Prosedural map generation (spanning tree + diagonal)
   - Kurva Bezier kuadratik pada setiap ruas jalan
   - Viewport transform (scroll + zoom vektor)
   - Pathfinding BFS (jalur terpendek)
   - Animasi objek: Mobil, Motor, Sepeda, Pejalan Kaki
   - Interpolasi posisi & orientasi dari turunan Bezier
   - Tata kota: bangunan, taman, perairan di antara ruas jalan
   - Acak Peta, Acak Posisi, Start/Pause
   ============================================= */

'use strict';

// ===================== CANVAS SETUP =====================
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const app    = document.getElementById('app');

let W = window.innerWidth;
let H = window.innerHeight;
canvas.width  = W;
canvas.height = H;

// ===================== CONSTANTS =====================

// Ukuran peta jauh melebihi viewport agar scroll terasa
// Viewport biasanya ~1280x720, peta ini 6x lebih lebar & 5x lebih tinggi
const MAP_W = 6000;
const MAP_H = 5000;

// Kecepatan animasi per tipe objek (unit titik/frame) — sengaja diperlambat
const SPEEDS = {
  car:  0.55,
  moto: 0.70,
  bike: 0.35,
  ped:  0.18,
};

// ===================== STATE =====================
let camX = MAP_W / 2;
let camY = MAP_H / 2;
let zoom = 0.18; // zoom awal kecil agar seluruh peta tampak perlu di-scroll

let dragging      = false;
let lastMX        = 0;
let lastMY        = 0;
let lastTouchDist = 0;

let nodes       = [];  // { id, x, y, adj[], isRoundabout }
let roundabouts = new Set(); // indeks node yang merupakan bundaran
let edges     = [];  // { a, b }
let startNode = 0;
let endNode   = 1;
let path      = [];  // urutan indeks node (BFS result)
let pathPts   = [];  // titik interpolasi kurva Bezier sepanjang jalur

// Blok tata kota: bangunan, taman, perairan
// Di-generate sekali saat generateMap() dipanggil
let cityBlocks = [];

let movingObj   = null; // { type, x, y, angle }
let animT       = 0;
let animRunning = false;
let animPaused  = false;
let selectedType = 'car';

// ===================== 3D STATE =====================
let is3D = false;
let cam3D = {
  theta: -Math.PI / 4,
  phi:    Math.PI / 3,
  r:      3200,
  tx:     0,
  tz:     0,
  fov:    55,
};
let drag3D = false, drag3DPan = false;
let last3DMX = 0, last3DMY = 0;

// ===================== COLOR THEME =====================
function isDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches;
}

function getColors() {
  const d = isDark();
  return {
    bg:               d ? '#161410' : '#eae6de',
    grid:             d ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.06)',
    road:             d ? '#252320' : '#b8b4ac',
    roadSurf:         d ? '#343230' : '#f5f3ef',
    roadMark:         d ? '#484440' : '#dedad2',
    nodeDot:          d ? '#252320' : '#b8b4ac',
    sidewalk:         d ? '#2a2826' : '#e2ddd6',
    building:         d ? '#252d3a' : '#d8dde8',
    buildingTop:      d ? '#303848' : '#c8cedc',
    buildingWin:      d ? '#4878c0' : '#90acd8',
    buildingShadow:   'rgba(0,0,0,0.12)',
    park:             d ? '#182818' : '#cce4c0',
    parkTree:         d ? '#204020' : '#7ab860',
    parkGround:       d ? '#182818' : '#b8d8a8',
    water:            d ? '#14222e' : '#b8d8f0',
    waterRipple:      d ? '#1a2c3c' : '#90c0e4',
    waterShine:       d ? '#203040' : '#d0eaf8',
    roundaboutRing:   d ? '#252320' : '#b8b4ac',
    roundaboutIsland: d ? '#182818' : '#cce4c0',
    roundaboutTree:   d ? '#204020' : '#7ab860',
    grassEdge:    d ? '#1a2e14' : '#b8d4a0',
    grassEdge2:   d ? '#152510' : '#a8c890',
    flagG:        '#16a34a',
    flagR:        '#dc2626',
    pathLine:     '#2563eb',
    objCar:       '#2563eb',
    objCar2:      '#dc2626',
    objCar3:      '#d97706',
    objCar4:      '#16a34a',
    objMoto:      '#d97706',
    objBike:      '#16a34a',
    objPed:       '#7c3aed',
  };
}


// ===================== 3D ENGINE: MATRIX & PROJECTION =====================
/**
 * Pipeline transformasi 3D:
 *   P_screen = project( ViewMatrix * P_world )
 *
 * ViewMatrix dibentuk dengan lookAt():
 *   forward = normalize(eye - target)
 *   right   = normalize(cross(up, forward))
 *   up_real = cross(forward, right)
 *
 * Projection Matrix (perspektif):
 *   f = 1 / tan(fov/2)
 *   menghasilkan efek perspektif — objek jauh terlihat kecil
 *
 * Orbit Camera:
 *   eye.x = tx + r * sin(phi) * cos(theta)
 *   eye.y = r  * cos(phi)
 *   eye.z = tz + r * sin(phi) * sin(theta)
 */

// Normalisasi vektor 3D
// ═══════════════════════════════════════════════════════════════════
// KONTRIBUSI RAIHAN DARMA Putra — Transformasi 3D (MVP Matrix & Orbit Camera)
//
// Bagian ini mengimplementasikan seluruh pipeline transformasi 3D:
//   World Space → View Space → Clip Space → NDC → Screen Space
//
// Fungsi-fungsi yang diimplementasikan:
//   vec3norm()        — normalisasi vektor 3D
//   vec3cross()       — cross product (perkalian silang) vektor 3D
//   vec3dot()         — dot product (perkalian titik) vektor 3D
//   mat4lookAt()      — membangun View Matrix dari posisi kamera
//   mat4perspective() — membangun Projection Matrix perspektif
//   project3D()       — proyeksikan titik 3D ke koordinat layar 2D
//   updateCamera3D()  — update View & Projection matrix per frame
//
// Referensi teori: Computer Graphics: Principles and Practice (Foley et al.)
// ═══════════════════════════════════════════════════════════════════

// Normalisasi vektor 3D: mengubah vektor menjadi unit vector (panjang = 1)
// Digunakan di mat4lookAt() untuk membangun basis ortonormal kamera
function vec3norm(v) {
  const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
  return len > 0 ? [v[0]/len, v[1]/len, v[2]/len] : [0,0,0];
}

// Cross product (perkalian silang) vektor 3D
// Menghasilkan vektor yang tegak lurus terhadap kedua vektor input.
// Digunakan di mat4lookAt() untuk membangun basis koordinat kamera:
//   right  = normalize(cross(up, forward))
//   newUp  = cross(forward, right)
// Rumus: a × b = [a₁b₂−a₂b₁, a₂b₀−a₀b₂, a₀b₁−a₁b₀]
function vec3cross(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}

// Dot product vektor 3D
function vec3dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

/**
 * mat4lookAt(eye, target, up)
 * RAIHAN — Membangun View Matrix dari parameter orbit camera.
 *
 * View Matrix adalah matriks 4×4 yang mentransformasi titik dari
 * World Space ke Camera/View Space — yaitu sistem koordinat
 * yang berpusat pada kamera.
 *
 * Langkah pembangunan basis ortonormal kamera:
 *   forward (f) = normalize(eye − target)   → arah kamera memandang
 *   right   (r) = normalize(cross(up, f))   → arah kanan kamera
 *   newUp   (u) = cross(f, r)               → arah atas kamera (recalc)
 *
 * Matriks View = [r | u | f | -eye] (transpos rotasi + translasi)
 * Rumus translasi: -dot(basis, eye) agar eye menjadi origin View Space
 *
 * @param {number[]} eye    — posisi kamera di world space [x, y, z]
 * @param {number[]} target — titik yang dilihat kamera [x, y, z]
 * @param {number[]} up     — vektor "atas" dunia, biasanya [0, 1, 0]
 * @returns {number[]}      — array 16 elemen (row-major 4×4 matrix)
 */
function mat4lookAt(eye, target, up) {
  const f = vec3norm([eye[0]-target[0], eye[1]-target[1], eye[2]-target[2]]);
  const r = vec3norm(vec3cross(up, f));
  const u = vec3cross(f, r);
  return [
     r[0],  r[1],  r[2], -vec3dot(r, eye),
     u[0],  u[1],  u[2], -vec3dot(u, eye),
     f[0],  f[1],  f[2], -vec3dot(f, eye),
     0,     0,     0,     1,
  ];
}

/**
 * mat4perspective(fovDeg, aspect, near, far)
 * RAIHAN — Membangun Projection Matrix perspektif.
 *
 * Projection Matrix mentransformasi titik dari View Space ke Clip Space
 * menggunakan proyeksi perspektif — objek jauh tampak lebih kecil.
 *
 * Derivasi:
 *   f = 1 / tan(fovY/2)        → faktor skala field-of-view vertikal
 *   Elemen [0,0] = f/aspect    → skala horizontal (sesuai rasio layar)
 *   Elemen [1,1] = f           → skala vertikal
 *   Elemen [2,2] & [2,3]       → mapping kedalaman ke NDC [-1, 1]
 *   Elemen [3,2] = -1          → proyeksi perspektif (w = -z)
 *
 * @param {number} fovDeg — field of view vertikal dalam derajat
 * @param {number} aspect — rasio lebar/tinggi layar (W/H)
 * @param {number} near   — jarak clipping plane dekat
 * @param {number} far    — jarak clipping plane jauh
 * @returns {number[]}    — array 16 elemen (row-major 4×4 matrix)
 */
function mat4perspective(fovDeg, aspect, near, far) {
  const f = 1 / Math.tan(fovDeg * Math.PI / 360);
  return [
    f/aspect, 0,  0,                     0,
    0,        f,  0,                     0,
    0,        0,  (far+near)/(near-far), (2*far*near)/(near-far),
    0,        0, -1,                     0,
  ];
}

/**
 * project3D(px, py, pz)
 * RAIHAN — Proyeksikan titik World 3D ke koordinat layar (Screen Space).
 *
 * Mengimplementasikan seluruh pipeline rendering 3D secara manual:
 *
 * 1. VIEW TRANSFORM (World → Camera Space)
 *    Kalikan titik dengan currentViewMatrix (hasil mat4lookAt)
 *    cx = V[0]*px + V[1]*py + V[2]*pz + V[3]  (baris pertama View)
 *    cy = V[4]*px + V[5]*py + V[6]*pz + V[7]  (baris kedua View)
 *    cz = V[8]*px + V[9]*py + V[10]*pz + V[11] (baris ketiga View)
 *
 * 2. PROJECTION (Camera → Clip Space)
 *    Kalikan dengan currentProjMatrix (hasil mat4perspective)
 *    clipW = -cz  →  komponen w dalam proyeksi perspektif
 *
 * 3. PERSPECTIVE DIVIDE (Clip → NDC)
 *    ndcX = clipX / clipW  →  range [-1, 1]
 *    ndcY = clipY / clipW  →  range [-1, 1]
 *
 * 4. VIEWPORT TRANSFORM (NDC → Screen)
 *    screenX = (ndcX + 1) * 0.5 * W
 *    screenY = (ndcY + 1) * 0.5 * H
 *
 * @param {number} px, py, pz — koordinat titik di World Space
 * @returns {{ x, y, w, visible }} — koordinat layar + depth (w) untuk
 *          Painter's Algorithm, visible = apakah dalam frustum
 */
function project3D(px, py, pz) {
  const V = currentViewMatrix;
  const P = currentProjMatrix;
  // View transform
  const cx = V[0]*px + V[1]*py + V[2]*pz  + V[3];
  const cy = V[4]*px + V[5]*py + V[6]*pz  + V[7];
  const cz = V[8]*px + V[9]*py + V[10]*pz + V[11];
  // Projection
  const clipX = P[0]*cx + P[2]*cz;
  const clipY = P[5]*cy + P[6]*cz;
  const clipW = P[10]*cz + P[11];
  const clipWW= -cz;
  if (clipWW <= 0.01) return { x:0, y:0, w:0, visible:false };
  // NDC -> Screen
  const ndcX =  clipX / clipWW;
  const ndcY = -clipY / clipWW;
  return {
    x: (ndcX + 1) * 0.5 * W,
    y: (ndcY + 1) * 0.5 * H,
    w: clipWW,
    visible: ndcX > -1.8 && ndcX < 1.8 && ndcY > -1.8 && ndcY < 1.8,
  };
}

// Cache matrix per frame
let currentViewMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
let currentProjMatrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

/**
 * updateCamera3D()
 * RAIHAN — Menghitung posisi kamera orbit dan memperbarui matrix per frame.
 *
 * Implementasi Orbit Camera menggunakan koordinat sferis (spherical coords):
 *   theta (θ) = sudut azimuth — rotasi horizontal di bidang XZ
 *   phi   (φ) = sudut elevasi — ketinggian kamera dari equator
 *   r         = jarak kamera dari titik target (zoom)
 *
 * Konversi spherical → Cartesian:
 *   eye.x = tx + r × sin(φ) × cos(θ)
 *   eye.y = r × cos(φ)              ← ketinggian kamera
 *   eye.z = tz + r × sin(φ) × sin(θ)
 *
 * Properti orbit camera:
 *   • phi dibatasi [0.15, π×0.48] agar kamera tidak bisa masuk ke bawah peta
 *   • r dibatasi [300, 8000] untuk zoom in/out yang wajar
 *   • tx, tz adalah target pan (geser kamera tanpa rotate)
 *
 * Dipanggil setiap frame di awal drawMap3D() sebelum rendering apapun.
 */
function updateCamera3D() {
  const { theta, phi, r, tx, tz, fov } = cam3D;
  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
  const sinThe = Math.sin(theta), cosThe = Math.cos(theta);
  const eye    = [tx + r*sinPhi*cosThe, r*cosPhi, tz + r*sinPhi*sinThe];
  const target = [tx, 0, tz];
  currentViewMatrix = mat4lookAt(eye, target, [0,1,0]);
  currentProjMatrix = mat4perspective(fov, W/H, 10, 20000);
}

// World 2D (wx,wy) -> World 3D, pusatkan di origin
function w3(wx, wy) { return [wx - MAP_W/2, 0, wy - MAP_H/2]; }

// Proyeksikan titik peta 2D ke layar di ketinggian h
function projH(wx, wy, h) {
  const p = w3(wx, wy);
  return project3D(p[0], -h, p[2]);
}
function proj2D(wx, wy) { return projH(wx, wy, 0); }

// Gambar kurva Bezier kuadratik 3D pada ketinggian h
function bezier3D(ax, ay, cpx, cpy, bx, by, h, color, lw) {
  ctx.beginPath();
  let first = true;
  for (let t = 0; t <= 1; t += 0.04) {
    const u = 1 - t;
    const sx = u*u*ax + 2*u*t*cpx + t*t*bx;
    const sy = u*u*ay + 2*u*t*cpy + t*t*by;
    const p  = projH(sx, sy, h);
    if (!p.visible) { first = true; continue; }
    if (first) { ctx.moveTo(p.x, p.y); first = false; }
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth   = lw;
  ctx.lineCap     = 'round';
  ctx.stroke();
}

// Gambar polygon 3D (array {x,y} world) pada ketinggian h
function poly3D(pts, h, fill, stroke, lw) {
  const prj = pts.map(p => projH(p.x, p.y, h));
  if (!prj.some(p => p.visible)) return;
  ctx.beginPath();
  ctx.moveTo(prj[0].x, prj[0].y);
  for (let i = 1; i < prj.length; i++) ctx.lineTo(prj[i].x, prj[i].y);
  ctx.closePath();
  if (fill)   { ctx.fillStyle   = fill;   ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw||1; ctx.stroke(); }
}

// Utility: gelapkan/terangkan warna hex
function shadeColor(hex, amt) {
  const n = parseInt(hex.replace('#',''), 16);
  const r = Math.min(255, Math.max(0, (n>>16)       + amt));
  const g = Math.min(255, Math.max(0, ((n>>8)&0xff) + amt));
  const b = Math.min(255, Math.max(0, (n&0xff)      + amt));
  return `rgb(${r},${g},${b})`;
}

/**
 * extrudeBuilding3D(b, col)
 * Ekstrusi bangunan 2D ke 3D menggunakan Painter's Algorithm.
 * Menggambar 3 face: right face (gelap), front face (sedang), top face (terang)
 * Tinggi = floors * 35 world unit
 */
function extrudeBuilding3D(b, col) {
  const pad = 6;
  const bx = b.x+pad, by = b.y+pad, bw = b.w-pad*2, bh = b.h-pad*2;
  if (bw < 8 || bh < 8) return;
  const height = (b.floors || 1) * 35;

  const C = [
    {x:bx,    y:by   }, {x:bx+bw, y:by   },
    {x:bx+bw, y:by+bh}, {x:bx,    y:by+bh},
  ];
  const pals = [
    ['#9aa8c0','#8090a8','#6a7888'],
    ['#b09080','#a08070','#887060'],
    ['#90a080','#809070','#687858'],
    ['#b0a870','#a09860','#888050'],
  ];
  const [topC, frontC, rightC] = pals[Math.abs(Math.round(bx*0.01+by*0.013))%4];

  // Gambar 4 sisi bangunan dengan back-face culling
  // Back-face culling: cross product Z dari winding order di screen space
  // Jika cross product < 0 = face menghadap kamera (counter-clockwise = visible)
  const sidesDef = [
    { i0:0, i1:1, color: frontC },
    { i0:1, i1:2, color: rightC },
    { i0:2, i1:3, color: frontC },
    { i0:3, i1:0, color: rightC },
  ];

  for (const sd of sidesDef) {
    const p0 = proj2D(C[sd.i0].x, C[sd.i0].y);
    const p1 = proj2D(C[sd.i1].x, C[sd.i1].y);
    const p0t = projH(C[sd.i0].x, C[sd.i0].y, height);
    const p1t = projH(C[sd.i1].x, C[sd.i1].y, height);
    if (!p0.visible && !p1.visible && !p0t.visible && !p1t.visible) continue;

    // Winding check: cross product (p1-p0) x (p0t-p0)
    const ex = p1.x - p0.x, ey = p1.y - p0.y;
    const fx = p0t.x - p0.x, fy = p0t.y - p0.y;
    if (ex * fy - ey * fx > 0) continue; // back face, skip

    ctx.beginPath();
    ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y);
    ctx.lineTo(p1t.x,p1t.y); ctx.lineTo(p0t.x,p0t.y);
    ctx.closePath();
    ctx.fillStyle = sd.color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.5; ctx.stroke();

    // Jendela di sisi yang visible
    const winW = Math.abs(p1t.x - p0t.x);
    const winH = Math.abs(p0.y - p0t.y);
    if (winW > 10 && winH > 10) {
      const wCols = Math.max(1, Math.round(winW / 14));
      const wRows = Math.min(b.floors||1, 5);
      for (let wr = 0; wr < wRows; wr++) {
        for (let wc = 0; wc < wCols; wc++) {
          const wx = p0t.x + (wc + 0.5) * (p1t.x - p0t.x) / wCols;
          const wy = p0t.y + (0.15 + wr * 0.75 / wRows) * (p0.y - p0t.y);
          const ws = Math.max(2, winW / wCols * 0.4);
          ctx.fillStyle = ((wr*7+wc*13)%5!==0) ? 'rgba(180,220,255,0.85)' : 'rgba(0,0,0,0.3)';
          ctx.fillRect(wx - ws/2, wy - ws*0.7, ws, ws*1.4);
        }
      }
    }
  }

  // dummy vars agar tidak error referensi lama
  const ff = []; const ffh = [];

  // Top face (atap)
  const top = C.map(c => projH(c.x, c.y, height));
  if (top.some(p=>p.visible)) {
    ctx.beginPath();
    ctx.moveTo(top[0].x,top[0].y);
    top.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
    ctx.closePath(); ctx.fillStyle=topC; ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.15)'; ctx.lineWidth=0.5; ctx.stroke();
  }
}

// Gambar bendera 3D
function drawFlag3D(wx, wy, color) {
  const base = proj2D(wx, wy);
  const top  = projH(wx, wy, 120);
  if (!base.visible || !top.visible) return;

  // Tiang
  ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y);
  ctx.strokeStyle = '#888'; ctx.lineWidth = 2; ctx.stroke();

  // Arah bendera: proyeksikan titik di world +X dari tiang
  // Ambil arah kanan relatif kamera dari theta orbit
  const rightX = projH(wx + 80, wy, 90);
  const botPt  = projH(wx + 80, wy, 60);
  if (!rightX.visible) return;

  ctx.beginPath();
  ctx.moveTo(top.x,    top.y);
  ctx.lineTo(rightX.x, rightX.y);
  ctx.lineTo(botPt.x,  botPt.y);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
}

// Gambar kendaraan 3D (ekstrusi kotak)
function drawMovingObj3D(obj, col) {
  const base = proj2D(obj.x, obj.y);
  if (!base.visible) return;
  // Ukuran kendaraan lebih besar agar terlihat di mode 3D
  const bodyH = obj.type==='car' ? 50 : obj.type==='moto' ? 40 : obj.type==='bike' ? 30 : 60;
  const hl    = obj.type==='ped' ? 18 : obj.type==='bike' ? 22 : 35;
  const hw    = obj.type==='ped' ? 18 : obj.type==='bike' ? 14 : 22;
  const cc    = [col.objCar,col.objCar2,col.objCar3,col.objCar4][(obj.colorIdx||0)%4];
  const dx = Math.cos(obj.angle), dz = Math.sin(obj.angle);
  const rx = -dz, rz = dx;
  const C3 = [
    [obj.x+dx*hl+rx*hw, obj.y+dz*hl+rz*hw],
    [obj.x+dx*hl-rx*hw, obj.y+dz*hl-rz*hw],
    [obj.x-dx*hl-rx*hw, obj.y-dz*hl-rz*hw],
    [obj.x-dx*hl+rx*hw, obj.y-dz*hl+rz*hw],
  ];
  const bot = C3.map(c=>proj2D(c[0],c[1]));
  const top = C3.map(c=>projH(c[0],c[1],bodyH));
  if (!top.some(p=>p.visible)) return;
  const vehSides = [
    { i0:0, i1:1, shade:  0 },
    { i0:1, i1:2, shade: -30 },
    { i0:2, i1:3, shade: -15 },
    { i0:3, i1:0, shade: -20 },
  ];
  for (const vs of vehSides) {
    const p0=bot[vs.i0], p1=bot[vs.i1], p0t=top[vs.i0], p1t=top[vs.i1];
    const ex=p1.x-p0.x, ey=p1.y-p0.y, fx=p0t.x-p0.x, fy=p0t.y-p0.y;
    if (ex*fy - ey*fx > 0) continue;
    ctx.beginPath();
    ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y);
    ctx.lineTo(p1t.x,p1t.y); ctx.lineTo(p0t.x,p0t.y);
    ctx.closePath();
    ctx.fillStyle = vs.shade===0 ? cc : shadeColor(cc, vs.shade); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.15)'; ctx.lineWidth=0.5; ctx.stroke();
  }
  ctx.beginPath();
  top.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
  ctx.closePath(); ctx.fillStyle=shadeColor(cc,20); ctx.fill();
  if (obj.type==='car') {
    const ex0=bot[1].x-bot[0].x, ey0=bot[1].y-bot[0].y;
    const fx0=top[0].x-bot[0].x, fy0=top[0].y-bot[0].y;
    if (ex0*fy0 - ey0*fx0 <= 0) {
      const wf=C3.map(c=>projH(c[0],c[1],bodyH*0.5));
      ctx.beginPath();
      ctx.moveTo(wf[0].x,wf[0].y); ctx.lineTo(wf[1].x,wf[1].y);
      ctx.lineTo(top[1].x,top[1].y); ctx.lineTo(top[0].x,top[0].y);
      ctx.closePath(); ctx.fillStyle='rgba(180,225,255,0.75)'; ctx.fill();
    }
  }
}

/**
 * drawMap3D() — render seluruh peta dalam mode 3D
 * Menggunakan Painter's Algorithm: sort by Z, gambar terjauh dulu
 */
function drawMap3D() {
  const col = getColors();
  updateCamera3D();
  const d = isDark();

  // Sky gradient — atas biru langit, bawah cakrawala
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.65);
  if (d) {
    skyGrad.addColorStop(0,    '#0a0f1e');
    skyGrad.addColorStop(0.6,  '#111827');
    skyGrad.addColorStop(1,    '#1c2333');
  } else {
    skyGrad.addColorStop(0,    '#c9dff5');
    skyGrad.addColorStop(0.55, '#deeaf8');
    skyGrad.addColorStop(1,    '#eef4fb');
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Ground plane gradient — horizon ke bawah
  const groundGrad = ctx.createLinearGradient(0, H * 0.55, 0, H);
  if (d) {
    groundGrad.addColorStop(0, '#1c2030');
    groundGrad.addColorStop(1, '#141820');
  } else {
    groundGrad.addColorStop(0, '#d8d4cc');
    groundGrad.addColorStop(1, '#c8c4bc');
  }
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);

  // Horizon glow subtle
  if (!d) {
    const horizGlow = ctx.createLinearGradient(0, H*0.5, 0, H*0.65);
    horizGlow.addColorStop(0, 'rgba(200,220,240,0.6)');
    horizGlow.addColorStop(1, 'rgba(200,220,240,0)');
    ctx.fillStyle = horizGlow;
    ctx.fillRect(0, H*0.5, W, H*0.15);
  }

  // Bintang di mode gelap
  if (d) {
    const starRng = makeRng(77);
    for (let i = 0; i < 80; i++) {
      const sx = starRng() * W;
      const sy = starRng() * H * 0.5;
      const sr = starRng() * 1.2;
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,255,255,${0.3 + starRng()*0.5})`;
      ctx.fill();
    }
  }

  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // 1. Trotoar
  for (const e of edges) {
    const A=nodes[e.a], B=nodes[e.b], cp=getEdgeCP(e);
    bezier3D(A.x,A.y,cp.x,cp.y,B.x,B.y, 0, col.sidewalk, 28);
  }

  // 2. Border jalan
  for (const e of edges) {
    const A=nodes[e.a], B=nodes[e.b], cp=getEdgeCP(e);
    bezier3D(A.x,A.y,cp.x,cp.y,B.x,B.y, 1, col.road, 22);
  }

  // 3. Permukaan aspal
  for (const e of edges) {
    const A=nodes[e.a], B=nodes[e.b], cp=getEdgeCP(e);
    bezier3D(A.x,A.y,cp.x,cp.y,B.x,B.y, 2, col.roadSurf, 16);
  }

  // 4. Marka jalan (dashed manual)
  for (const e of edges) {
    const A=nodes[e.a], B=nodes[e.b], cp=getEdgeCP(e);
    const pts=[];
    for (let t=0;t<=1;t+=0.02) {
      const u=1-t;
      pts.push({x:u*u*A.x+2*u*t*cp.x+t*t*B.x, y:u*u*A.y+2*u*t*cp.y+t*t*B.y});
    }
    let draw=true, acc=0;
    const dashLen = e.curved ? 8 : 12;
    for (let i=1;i<pts.length;i++) {
      const p1=projH(pts[i-1].x,pts[i-1].y,3);
      const p2=projH(pts[i].x,pts[i].y,3);
      if (!p1.visible||!p2.visible) continue;
      acc+=Math.hypot(p2.x-p1.x,p2.y-p1.y);
      if (draw) {
        ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y);
        ctx.strokeStyle=col.roadMark; ctx.lineWidth=2; ctx.stroke();
      }
      if (acc>dashLen) { draw=!draw; acc=0; }
    }
  }

  // 5. Taman & Air (flat ground)
  for (const b of cityBlocks) {
    const C=[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}];
    if (b.type==='park') {
      poly3D(C, 1, col.park, col.parkTree, 0.5);
      // Pohon 3D sederhana
      const rng = makeRng(b.treeSeed||42);
      for (let k=0;k<Math.min(b.treeCount||3,5);k++) {
        const tx=b.x+rng()*b.w, ty=b.y+rng()*b.h;
        const tBase=proj2D(tx,ty), tTop=projH(tx,ty,70);
        if (tBase.visible) {
          // Batang
          ctx.beginPath(); ctx.moveTo(tBase.x,tBase.y); ctx.lineTo(tTop.x,tTop.y);
          ctx.strokeStyle='#8a7a60'; ctx.lineWidth=2; ctx.stroke();
          // Mahkota ukuran proporsional depth
          const cr = Math.max(4, Math.min(20, tTop.w * 0.008));
          midpointCircleCtx(Math.round(tTop.x), Math.round(tTop.y),
            Math.max(1,Math.round(cr)), col.parkTree, null);
          midpointCircleCtx(Math.round(tTop.x-cr*0.25), Math.round(tTop.y-cr*0.25),
            Math.max(1,Math.round(cr*0.55)), col.parkGround, null);
        }
      }
    } else if (b.type==='water') {
      poly3D(C, 1, col.water, col.waterRipple, 0.5);
      // Riak air
      const wc = proj2D(b.x+b.w/2, b.y+b.h/2);
      if (wc.visible) {
        midpointCircleCtx(Math.round(wc.x), Math.round(wc.y), 8,
          null, col.waterRipple);
      }
    }
  }

  // 6. Bangunan (ekstrusi 3D, Painter's Algorithm)
  const buildings = cityBlocks.filter(b=>b.type==='building');
  buildings.sort((a,b) => {
    const da = proj2D(a.x+a.w/2, a.y+a.h/2).w;
    const db = proj2D(b.x+b.w/2, b.y+b.h/2).w;
    return db - da; // .w besar=dekat, gambar terjauh (w kecil) dulu
  });
  for (const b of buildings) extrudeBuilding3D(b, col);

  // 7. Bundaran
  for (const n of nodes) {
    if (!n.isRoundabout) continue;
    const r=n.roundaboutRadius, ri=r*0.50;
    const SEGS=20;
    const outer=[], inner=[];
    for (let k=0;k<SEGS;k++) {
      const a=(k/SEGS)*Math.PI*2;
      outer.push({x:n.x+Math.cos(a)*r, y:n.y+Math.sin(a)*r});
      inner.push({x:n.x+Math.cos(a)*ri,y:n.y+Math.sin(a)*ri});
    }
    poly3D(outer, 2, col.road, col.road, 0.5);
    poly3D(outer, 2, col.roadSurf, null, 0);
    poly3D(inner, 5, col.park, col.parkTree, 0.5);

    if (n.isMainRoundabout) {
      // Air mancur bundaran utama
      const fr = Math.max(5, Math.round(ri*0.30));
      const fC  = [];
      for (let k=0;k<16;k++) {
        const a=(k/16)*Math.PI*2;
        fC.push({x:n.x+Math.cos(a)*fr, y:n.y+Math.sin(a)*fr});
      }
      poly3D(fC, 6, col.water, col.waterRipple, 0.5);
      // Semburan air
      const fTop = projH(n.x, n.y, fr*4);
      const fBot = projH(n.x, n.y, 5);
      if (fBot.visible) {
        ctx.beginPath(); ctx.moveTo(fBot.x,fBot.y); ctx.lineTo(fTop.x,fTop.y);
        ctx.strokeStyle=col.waterShine; ctx.lineWidth=2; ctx.stroke();
        midpointCircleCtx(Math.round(fTop.x), Math.round(fTop.y), 4,
          col.waterShine, null);
      }
    }
  }

  // 8. Persimpangan biasa
  for (const n of nodes) {
    if (n.isRoundabout) continue;
    const SEGS=12, pts=[], pts2=[];
    for (let k=0;k<SEGS;k++) {
      const a=(k/SEGS)*Math.PI*2;
      pts.push({x:n.x+Math.cos(a)*12, y:n.y+Math.sin(a)*12});
      pts2.push({x:n.x+Math.cos(a)*10,y:n.y+Math.sin(a)*10});
    }
    poly3D(pts,  2, col.road, null, 0);
    poly3D(pts2, 2, col.roadSurf, null, 0);
  }

  // 9. Jalur A*
  if (pathPts.length>1) {
    for (let i=1;i<pathPts.length;i++) {
      const p1=projH(pathPts[i-1].x,pathPts[i-1].y,5);
      const p2=projH(pathPts[i].x,  pathPts[i].y,  5);
      if (!p1.visible||!p2.visible) continue;
      ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y);
      ctx.strokeStyle=col.pathLine; ctx.lineWidth=2.5;
      ctx.globalAlpha=0.9; ctx.stroke(); ctx.globalAlpha=1;
    }
  }

  // 10. Bendera & kendaraan
  if (nodes[startNode]) drawFlag3D(nodes[startNode].x, nodes[startNode].y, col.flagG);
  if (nodes[endNode])   drawFlag3D(nodes[endNode].x,   nodes[endNode].y,   col.flagR);
  if (movingObj) drawMovingObj3D(movingObj, col);

  // 11. HUD kamera
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeStyle = '#e4e0da';
  ctx.lineWidth = 1;
  const hw = 200, hh = 28, hx = W/2 - hw/2, hy = H - 48;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(hx, hy, hw, hh, 6);
  else ctx.rect(hx, hy, hw, hh);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#888';
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    `theta ${(cam3D.theta*180/Math.PI).toFixed(0)}\u00b0  |  phi ${(cam3D.phi*180/Math.PI).toFixed(0)}\u00b0  |  zoom ${cam3D.r.toFixed(0)}`,
    W/2, hy + 18
  );
  ctx.textAlign = 'left';
}


// ===================== UTILITIES =====================
function rnd(a, b)    { return a + Math.random() * (b - a); }
function rndInt(a, b) { return Math.floor(rnd(a, b + 1)); }

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function edgeExists(a, b) {
  return edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

// ===================== BRESENHAM LINE DRAWING =====================
/**
 * bresenhamLine(x1, y1, x2, y2, color, lineWidth)
 *
 * Menggambar garis lurus dari (x1,y1) ke (x2,y2) menggunakan
 * Algoritma Bresenham (1962) — murni operasi integer tanpa
 * perkalian float atau fungsi trigonometri.
 *
 * Prinsip:
 *  - Hitung Δx = |x2-x1|, Δy = |y2-y1|
 *  - Tentukan arah langkah sx, sy (+1 atau -1)
 *  - Jika Δy > Δx, tukar peran x dan y (swap) agar selalu
 *    melangkah di sumbu dominan
 *  - Decision parameter awal: p = 2*Δy - Δx
 *  - Setiap langkah:
 *      jika p >= 0 → geser sumbu minor, p -= 2*Δx
 *      selalu      → geser sumbu mayor, p += 2*Δy
 *
 * Setiap "piksel" digambar sebagai fillRect kecil di canvas,
 * sehingga murni implementasi manual tanpa ctx.lineTo.
 *
 * @param {number} x1        - Koordinat x titik awal (world space)
 * @param {number} y1        - Koordinat y titik awal (world space)
 * @param {number} x2        - Koordinat x titik akhir (world space)
 * @param {number} y2        - Koordinat y titik akhir (world space)
 * @param {string} color     - Warna garis (CSS color string)
 * @param {number} lineWidth - Ketebalan "piksel" garis (default 1)
 */
// ═══════════════════════════════════════════════════════════════════
// KONTRIBUSI ALMAN — Bresenham Line, Midpoint Circle, Minimap
// Fungsi: bresenhamLine(), midpointCircle(), midpointCircleCtx(),
//         drawMinimap(), worldToMinimap()
// ═══════════════════════════════════════════════════════════════════

function bresenhamLine(x1, y1, x2, y2, color, lineWidth = 1) {
  // Bulatkan ke integer — Bresenham bekerja di ruang piksel diskret
  let x = Math.round(x1);
  let y = Math.round(y1);
  const ex = Math.round(x2);
  const ey = Math.round(y2);

  // Δx dan Δy selalu positif
  let dx = Math.abs(ex - x);
  let dy = Math.abs(ey - y);

  // Arah langkah: +1 atau -1
  const sx = ex >= x ? 1 : -1;
  const sy = ey >= y ? 1 : -1;

  // Jika Δy > Δx, kita "tukar" peran sumbu
  // agar selalu bergerak pada sumbu yang lebih dominan
  let swapped = false;
  if (dy > dx) {
    [dx, dy] = [dy, dx]; // tukar nilai
    swapped = true;
  }

  // Decision parameter awal
  let p = 2 * dy - dx;

  ctx.fillStyle = color;

  // Loop sebanyak Δx langkah (sumbu dominan)
  for (let i = 0; i <= dx; i++) {
    // Gambar "piksel" pada posisi (x, y) saat ini
    // fillRect menggambar kotak kecil sebesar lineWidth
    ctx.fillRect(x - lineWidth / 2, y - lineWidth / 2, lineWidth, lineWidth);

    if (p >= 0) {
      // Geser sumbu minor
      if (swapped) x += sx;
      else         y += sy;
      p -= 2 * dx;
    }

    // Selalu geser sumbu mayor
    if (swapped) y += sy;
    else         x += sx;
    p += 2 * dy;
  }
}

function addEdge(a, b) {
  if (a === b) return;
  if (edgeExists(a, b)) return;
  edges.push({ a, b });
  nodes[a].adj.push(b);
  nodes[b].adj.push(a);
}

// Seeded PRNG sederhana (LCG) — agar dekorasi konsisten per generate
function makeRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

// ===================== MAP GENERATION =====================
/**
 * generateMap()
 * 1. Tempatkan simpul pada grid dengan jitter acak
 * 2. Spanning tree (horizontal + vertikal) → konektivitas penuh
 * 3. Edge diagonal → mayoritas jalan tidak lurus (>90%)
 * 4. Generate blok tata kota di antara ruas jalan
 */
function generateMap() {
  nodes       = [];
  edges       = [];
  cityBlocks  = [];
  roundabouts = new Set();

  // Pusat peta = lokasi bundaran utama
  const CX = MAP_W / 2;
  const CY = MAP_H / 2;

  // ── GRID NODE 7x5 dengan jitter sedang ──
  // Grid rapi tapi sedikit organik (jitter 10%)
  const cols = 7;
  const rows = 5;
  const gw   = MAP_W / (cols + 1);  // ~667
  const gh   = MAP_H / (rows + 1);  // ~714

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Node tengah (baris 2, col 3) = pusat kota
      // Jitter lebih kecil di dekat pusat
      const distToCenter = Math.hypot(
        (c + 1) - (cols + 1) / 2,
        (r + 1) - (rows + 1) / 2
      );
      const jit = 0.06 + distToCenter * 0.025;
      nodes.push({
        id:  r * cols + c,
        x:   gw * (c + 1) + rnd(-gw * jit, gw * jit),
        y:   gh * (r + 1) + rnd(-gh * jit, gh * jit),
        adj: [],
        isRoundabout: false,
      });
    }
  }

  // ── EDGE: Horizontal + Vertikal ──
  // ~35% edge melengkung (sedang)
  const curveRng = makeRng(Math.floor(Math.random() * 99999));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c < cols - 1) {
        const j = r * cols + c + 1;
        edges.push({ a: i, b: j, curved: curveRng() < 0.90 });
        nodes[i].adj.push(j);
        nodes[j].adj.push(i);
      }
      if (r < rows - 1) {
        const j = (r + 1) * cols + c;
        edges.push({ a: i, b: j, curved: curveRng() < 0.90 });
        nodes[i].adj.push(j);
        nodes[j].adj.push(i);
      }
    }
  }

  // ── BUNDARAN UTAMA: node tengah grid ──
  // Paksa node tengah menjadi bundaran utama dengan radius besar
  const centerIdx = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
  const centerNode = nodes[centerIdx];
  // Radius bundaran utama = 18% dari jarak ke tetangga
  let minDistCenter = Infinity;
  for (const adjIdx of centerNode.adj) {
    minDistCenter = Math.min(minDistCenter,
      Math.hypot(nodes[adjIdx].x - centerNode.x, nodes[adjIdx].y - centerNode.y));
  }
  centerNode.isRoundabout    = true;
  centerNode.roundaboutRadius = Math.min(55, minDistCenter * 0.22);
  centerNode.isMainRoundabout = true;  // tandai sebagai bundaran utama
  roundabouts.add(centerNode.id);

  // Bundaran kecil di perempatan lain (max 4, adj==4)
  detectRoundaboutsSecondary(centerIdx);

  generateCityBlocks(cols, rows, gw, gh);
  addDiagonalEdges(cols, rows, 0.30);
  randomPositions();
}

// ===================== CITY BLOCKS GENERATION =====================
// ===================== ROUNDABOUT DETECTION =====================
/**
 * detectRoundabouts()
 * Mendeteksi node perempatan (adj.length >= 4) dan menandainya
 * sebagai bundaran. Radius bundaran dihitung dari rata-rata
 * jarak ke tetangga terdekat dibagi 4, agar proporsional
 * dengan kepadatan jalan di sekitarnya.
 *
 * Node yang terlalu berdekatan satu sama lain tidak dijadikan
 * bundaran (jarak antar bundaran minimal 2x radius) agar
 * tidak tumpang tindih secara visual.
 */
// detectRoundabouts() tidak dipakai langsung
// Bundaran utama ditentukan di generateMap()
// Bundaran sekunder ditentukan di sini
function detectRoundabouts() {}

function detectRoundaboutsSecondary(skipIdx) {
  // Pilih max 4 bundaran kecil dari node adj==4
  // Kecuali node tengah (sudah jadi bundaran utama)
  const MAX   = 4;
  const MDIST = 800;
  const seed  = makeRng(Math.floor(Math.random() * 99999));
  const cands = nodes
    .filter(n => n.adj.length === 4 && n.id !== skipIdx)
    .sort(() => seed() - 0.5);

  const placed = [nodes[skipIdx]]; // hindari terlalu dekat bundaran utama
  for (const n of cands) {
    if (placed.length - 1 >= MAX) break;
    const tooClose = placed.some(
      p => Math.hypot(p.x - n.x, p.y - n.y) < MDIST
    );
    if (tooClose) continue;
    let minD = Infinity;
    for (const ai of n.adj)
      minD = Math.min(minD, Math.hypot(nodes[ai].x-n.x, nodes[ai].y-n.y));
    n.roundaboutRadius = Math.min(16, minD * 0.18);
    n.isRoundabout     = true;
    roundabouts.add(n.id);
    placed.push(n);
  }
}

function drawRoundabout(node, col) {
  const cx = node.x, cy = node.y;
  const r  = node.roundaboutRadius;
  const ri = r * 0.50;

  if (node.isMainRoundabout) {
    // ══ BUNDARAN UTAMA: lebih besar, ada air mancur ══
    // Permukaan jalan bundaran
    midpointCircle(cx, cy, r, col.road, true);
    midpointCircle(cx, cy, r - 2, col.roadSurf, true);

    // Border luar
    midpointCircle(cx, cy, r,     col.road, false);
    midpointCircle(cx, cy, r + 1, col.road, false);
    midpointCircle(cx, cy, r + 2, col.sidewalk, false);

    // Pulau taman hijau
    midpointCircle(cx, cy, ri, col.park, true);
    midpointCircle(cx, cy, ri, col.road, false);

    // Pohon mengelilingi tepi pulau
    const treeR = Math.max(5, Math.round(ri * 0.22));
    const NTREE = 8;
    for (let k = 0; k < NTREE; k++) {
      const ang = (k / NTREE) * Math.PI * 2;
      const tx  = Math.round(cx + Math.cos(ang) * ri * 0.65);
      const ty  = Math.round(cy + Math.sin(ang) * ri * 0.65);
      midpointCircle(tx, ty, treeR, col.parkTree, true);
      midpointCircle(tx, ty, Math.max(2, Math.round(treeR * 0.5)),
                     col.parkGround, true);
    }

    // Air mancur di tengah
    const fr = Math.max(6, Math.round(ri * 0.30));
    midpointCircle(cx, cy, fr, col.water, true);
    midpointCircle(cx, cy, Math.max(3, Math.round(fr * 0.55)),
                   col.waterShine, true);
    midpointCircle(cx, cy, Math.max(2, Math.round(fr * 0.25)),
                   '#ffffff', true);

    // Ring highlight air mancur
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.arc(cx - fr*0.2, cy - fr*0.2, fr*0.7, Math.PI*1.1, Math.PI*1.7);
    ctx.stroke();

    // Marka putus-putus di bundaran
    midpointCircle(cx, cy, Math.round(r * 0.80), 'rgba(255,255,255,0.3)', false);

  } else {
    // ══ BUNDARAN KECIL biasa ══
    midpointCircle(cx, cy, r, col.road, true);
    midpointCircle(cx, cy, r - 1, col.roadSurf, true);
    midpointCircle(cx, cy, r,     col.road, false);
    midpointCircle(cx, cy, r + 1, col.sidewalk, false);
    midpointCircle(cx, cy, ri, col.park, true);
    midpointCircle(cx, cy, ri, col.road, false);
    const treeR = Math.max(3, Math.round(ri * 0.42));
    midpointCircle(cx, cy, treeR, col.parkTree, true);
    midpointCircle(cx, cy, Math.max(2, Math.round(treeR * 0.45)),
                   col.parkGround, true);
  }
}

function generateCityBlocks(cols, rows, gw, gh) {
  const rngType = makeRng(Math.floor(Math.random() * 9999));
  const rngSize = makeRng(Math.floor(Math.random() * 9999));
  const rngTree = makeRng(Math.floor(Math.random() * 9999));

  // Node tengah = bundaran utama, blok di sekelilingnya lebih kecil
  const centerR = Math.floor(rows / 2);
  const centerC = Math.floor(cols / 2);

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      // Pusat sel dari 4 node sudut
      const n00 = nodes[r * cols + c];
      const n01 = nodes[r * cols + c + 1];
      const n10 = nodes[(r + 1) * cols + c];
      const n11 = nodes[(r + 1) * cols + c + 1];

      const cellCX = (n00.x + n01.x + n10.x + n11.x) / 4;
      const cellCY = (n00.y + n01.y + n10.y + n11.y) / 4;
      const cellW  = Math.abs(n01.x - n00.x);
      const cellH  = Math.abs(n10.y - n00.y);

      // Margin lebih besar di dekat bundaran utama
      const isNearCenter =
        (r === centerR - 1 || r === centerR) &&
        (c === centerC - 1 || c === centerC);
      const margin = isNearCenter ? 0.54 : 0.46;
      const maxW   = cellW * (1 - margin * 2);
      const maxH   = cellH * (1 - margin * 2);

      if (maxW < 24 || maxH < 24) continue;

      // Pojok peta = taman luas
      const isCorner =
        (r === 0 || r === rows - 2) &&
        (c === 0 || c === cols - 2);

      let type;
      if (isCorner) {
        type = 'park'; // pojok selalu taman
      } else {
        const t = rngType();
        type = t < 0.55 ? 'building' : t < 0.80 ? 'park' : 'water';
      }

      const bw = maxW * (0.55 + rngSize() * 0.30);
      const bh = maxH * (0.55 + rngSize() * 0.30);

      cityBlocks.push({
        type,
        x: cellCX - bw / 2,
        y: cellCY - bh / 2,
        w: bw, h: bh,
        floors:    1 + Math.floor(rngSize() * 5),
        treeCount: 2 + Math.floor(rngTree() * 4),
        treeSeed:  Math.floor(rngTree() * 99999),
      });
    }
  }
}

function generateBuildingCluster(cx, cy, maxW, maxH, count, rngSize, rngOff) {
  if (count === 1) {
    const bw = maxW * (0.35 + rngSize() * 0.30);  // max 65% maxW
    const bh = maxH * (0.35 + rngSize() * 0.30);
    const floors = rndInt(1, 6);
    cityBlocks.push({
      type: 'building',
      x: cx - bw / 2,
      y: cy - bh / 2,
      w: bw, h: bh,
      floors,
    });
  } else if (count === 2) {
    // Dua bangunan bersebelahan horizontal atau vertikal
    const horiz  = rngSize() > 0.5;
    const gap    = 8;
    const bw     = (maxW - gap) / (horiz ? 2 : 1) * (0.6 + rngSize() * 0.3);
    const bh     = (maxH - gap) / (horiz ? 1 : 2) * (0.6 + rngSize() * 0.3);
    const offsets = horiz
      ? [[-bw / 2 - gap / 2, -bh / 2], [gap / 2, -bh / 2]]
      : [[-bw / 2, -bh / 2 - gap / 2], [-bw / 2, gap / 2]];
    for (const [ox, oy] of offsets) {
      cityBlocks.push({
        type: 'building',
        x: cx + ox, y: cy + oy,
        w: bw, h: bh,
        floors: rndInt(1, 5),
      });
    }
  } else {
    // Empat bangunan membentuk blok kota (2x2)
    const gap = 10;
    const bw  = (maxW - gap) / 2 * (0.65 + rngSize() * 0.2);
    const bh  = (maxH - gap) / 2 * (0.65 + rngSize() * 0.2);
    for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      cityBlocks.push({
        type: 'building',
        x: cx + ox * (bw / 2 + gap / 2) - bw / 2,
        y: cy + oy * (bh / 2 + gap / 2) - bh / 2,
        w: bw, h: bh,
        floors: rndInt(1, 8),
      });
    }
  }
}

// ===================== POSITIONS =====================
function randomPositions() {
  const idxs = shuffle(nodes.map((_, i) => i));
  startNode = idxs[0];
  endNode   = idxs[1];
  computePath();
  animT       = 0;
  animRunning = false;
  animPaused  = false;
  resetButtons();
  selectedType = document.getElementById('obj-select').value;
  movingObj = {
    type:     selectedType,
    x:        nodes[startNode].x,
    y:        nodes[startNode].y,
    angle:    0,
    colorIdx: Math.floor(Math.random() * 4),  // warna tetap selama perjalanan
  };
}

// ===================== PATHFINDING (A*) =====================
/**
 * heuristic(a, b)
 * Fungsi heuristik untuk A* — menggunakan jarak Euclidean
 * antara node a dan node b sebagai estimasi biaya tersisa.
 *
 * h(n) = √((xn - xtujuan)² + (yn - ytujuan)²)
 *
 * Heuristik ini bersifat admissible (tidak pernah melebih-lebihkan
 * jarak sebenarnya) sehingga A* selalu menemukan jalur optimal.
 *
 * @param {object} a - Node asal { x, y }
 * @param {object} b - Node tujuan { x, y }
 * @returns {number} Jarak Euclidean antara a dan b
 */
// ═══════════════════════════════════════════════════════════════════
// KONTRIBUSI RAIHAN DARMA — A* Pathfinding Algorithm
//
// Implementasi algoritma A* (A-Star) untuk pencarian jalur terpendek
// pada graf jalan peta kota. A* dipilih karena lebih efisien dari
// Dijkstra dengan panduan heuristik, dan lebih optimal dari Greedy BFS
// karena mempertimbangkan biaya nyata g(n).
//
// Fungsi evaluasi: f(n) = g(n) + h(n)
//   g(n) = biaya nyata dari startNode ke node n (jarak Euclidean akumulatif)
//   h(n) = heuristik: estimasi jarak lurus dari n ke endNode (admissible)
//   f(n) = total estimasi biaya jalur optimal melewati n
//
// Fungsi-fungsi yang diimplementasikan:
//   heuristic()   — fungsi heuristik Euclidean distance
//   computePath() — A* lengkap dengan rekonstruksi jalur
//
// Output: array global `path[]` berisi urutan node startNode → endNode
//         diteruskan ke buildPathPts() (Neza) untuk animasi kendaraan
// ═══════════════════════════════════════════════════════════════════

/**
 * heuristic(a, b)
 * RAIHAN — Fungsi heuristik untuk algoritma A*.
 *
 * Menggunakan Euclidean Distance (jarak lurus) antara dua node.
 * Heuristik ini bersifat ADMISSIBLE — tidak pernah melebih-lebihkan
 * biaya sebenarnya, karena jarak lurus selalu ≤ jarak jalur nyata.
 * Admissibility menjamin A* menemukan jalur OPTIMAL.
 *
 * Rumus: h = √((ax−bx)² + (ay−by)²)
 *
 * @param {{ x, y }} a — node pertama
 * @param {{ x, y }} b — node kedua
 * @returns {number}   — jarak Euclidean antara a dan b
 */
function heuristic(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * computePath()
 * RAIHAN — Implementasi algoritma A* (A-Star) lengkap.
 *
 * Algoritma A* adalah algoritma pencarian jalur terpendek yang
 * menggabungkan keunggulan Dijkstra (optimal) dan Greedy BFS (cepat).
 *
 * Fungsi evaluasi: f(n) = g(n) + h(n)
 *   g(n) = biaya nyata dari startNode ke node n (akumulasi jarak Euclidean)
 *   h(n) = heuristik: estimasi jarak lurus dari n ke endNode
 *   f(n) = total estimasi biaya — node dengan f terkecil diproses duluan
 *
 * Struktur data yang digunakan:
 *   g[]      — array biaya nyata, diinisialisasi Infinity
 *   f[]      — array total estimasi, diinisialisasi Infinity
 *   prev[]   — array rekonstruksi jalur (node sebelumnya)
 *   closed[] — boolean array, true jika node sudah selesai dieksplorasi
 *   openSet  — array [f_value, nodeIndex], diurutkan ascending (min-heap manual)
 *
 * Alur kerja A*:
 *   1. Inisialisasi: g[start]=0, f[start]=h(start,end), push ke openSet
 *   2. Ambil node current dengan f terkecil dari openSet
 *   3. Jika current == endNode → jalur ditemukan, hentikan
 *   4. Tandai current sebagai selesai (closed)
 *   5. Untuk setiap neighbor current:
 *      - Hitung g_baru = g[current] + jarak(current, neighbor)
 *      - Jika g_baru < g[neighbor] → update g, f, prev; tambah ke openSet
 *   6. Ulangi dari langkah 2
 *   7. Rekonstruksi jalur: telusuri prev[] dari endNode ke startNode
 *
 * Kompleksitas waktu: O(V²) — menggunakan array sorted manual
 * Dapat ditingkatkan ke O(E log V) dengan binary min-heap
 *
 * @modifies {number[]} path    — array node urutan jalur optimal
 * @modifies {object[]} pathPts — titik-titik animasi (via buildPathPts)
 */
function computePath() {
  const N = nodes.length;

  // g[i] = biaya nyata dari start ke node i
  // Diinisialisasi Infinity (belum ditemukan)
  const g = new Array(N).fill(Infinity);

  // f[i] = g[i] + h(i, end) — total estimasi biaya
  const f = new Array(N).fill(Infinity);

  // prev[i] = node sebelumnya dalam jalur terpendek (untuk rekonstruksi)
  const prev = new Array(N).fill(-1);

  // closedSet: node yang sudah selesai dieksplorasi
  const closed = new Array(N).fill(false);

  // Inisialisasi node awal
  g[startNode] = 0;
  f[startNode] = heuristic(nodes[startNode], nodes[endNode]);

  // openSet: array pasangan [f_value, nodeIndex]
  // Diimplementasikan sebagai array yang selalu diurutkan
  const openSet = [[f[startNode], startNode]];

  while (openSet.length > 0) {
    // Ambil node dengan f terkecil (front of sorted array)
    // → sort ascending berdasarkan f[0]
    openSet.sort((a, b) => a[0] - b[0]);
    const [, current] = openSet.shift();

    // Jika sudah sampai tujuan, hentikan pencarian
    if (current === endNode) break;

    // Tandai current sebagai selesai dieksplorasi
    closed[current] = true;

    // Eksplorasi semua tetangga (neighbor) dari current
    for (const neighbor of nodes[current].adj) {
      if (closed[neighbor]) continue; // skip node yang sudah selesai

      // Hitung g_baru = g[current] + jarak Euclidean ke neighbor
      const g_baru = g[current] + heuristic(nodes[current], nodes[neighbor]);

      if (g_baru < g[neighbor]) {
        // Jalur baru ini lebih baik → update
        prev[neighbor]  = current;
        g[neighbor]     = g_baru;
        f[neighbor]     = g_baru + heuristic(nodes[neighbor], nodes[endNode]);

        // Tambahkan ke openSet jika belum ada
        const alreadyIn = openSet.some(([, idx]) => idx === neighbor);
        if (!alreadyIn) {
          openSet.push([f[neighbor], neighbor]);
        }
      }
    }
  }

  // Rekonstruksi jalur dari prev[]
  // Telusuri balik dari endNode ke startNode
  path = [];
  let cur = endNode;
  while (cur !== -1) {
    path.unshift(cur);
    cur = prev[cur];
  }

  // Jika path[0] bukan startNode berarti tidak ada jalur
  if (path[0] !== startNode) path = [startNode, endNode];

  buildPathPts();
}

// ═══════════════════════════════════════════════════════════════════
// KONTRIBUSI NEZA — Bezier Curve, dashedCurve, buildPathPts, getEdgeCP
// Fungsi: getEdgeCP(), getEdgeControlPoint(), buildPathPts(),
//         dashedCurve(), bezier3D()
// ═══════════════════════════════════════════════════════════════════

// ===================== BEZIER =====================
// getEdgeControlPoint: cari edge yang menghubungkan A-B
// lalu gunakan getEdgeCP agar kurva jalur A* identik dengan jalan
function getEdgeControlPoint(A, B) {
  // Cari edge yang menghubungkan A dan B
  const e = edges.find(
    ed => (ed.a === A.id && ed.b === B.id) ||
          (ed.a === B.id && ed.b === A.id)
  );
  if (e) return getEdgeCP(e);
  // Fallback: midpoint (tidak melengkung)
  return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
}

function buildPathPts() {
  pathPts = [];

  for (let i = 0; i < path.length - 1; i++) {
    const A = nodes[path[i]];
    const B = nodes[path[i + 1]];

    if (B.isRoundabout && i + 2 < path.length) {
      const C  = nodes[path[i + 2]];
      const cx = B.x, cy = B.y;
      const r  = B.roundaboutRadius;

      // Sudut arah datang (A ke B) dan arah pergi (B ke C)
      const dirIn  = Math.atan2(B.y - A.y, B.x - A.x);  // arah masuk
      const dirOut = Math.atan2(C.y - B.y, C.x - B.x);  // arah keluar

      // Sudut relatif: berapa derajat harus belok
      // Positif = searah jarum jam (kanan), Negatif = berlawanan (kiri)
      let relAngle = dirOut - dirIn;
      // Normalkan ke range (-PI, PI]
      while (relAngle >  Math.PI) relAngle -= Math.PI * 2;
      while (relAngle < -Math.PI) relAngle += Math.PI * 2;

      // LOGIKA GMAPS:
      // Belok KIRI (relAngle < -0.35 rad / ~20 derajat kiri)
      //   → kendaraan langsung belok tanpa memutar bundaran
      // Belok LURUS atau KANAN (relAngle >= -0.35)
      //   → kendaraan memutar bundaran searah jarum jam
      const turnLeft = relAngle < -0.35;

      if (turnLeft) {
        // ── BELOK KIRI: Bezier langsung A → B → C ──
        // Tidak melewati bundaran, langsung potong pojok
        const cp1 = getEdgeControlPoint(A, B, i);
        for (let t = 0; t <= 1; t += 0.02) {
          const u = 1 - t;
          pathPts.push({
            x: u*u*A.x + 2*u*t*cp1.x + t*t*B.x,
            y: u*u*A.y + 2*u*t*cp1.y + t*t*B.y,
          });
        }
        const cp2 = getEdgeControlPoint(B, C, i + 1);
        for (let t = 0; t <= 1; t += 0.02) {
          const u = 1 - t;
          pathPts.push({
            x: u*u*B.x + 2*u*t*cp2.x + t*t*C.x,
            y: u*u*B.y + 2*u*t*cp2.y + t*t*C.y,
          });
        }

      } else {
        // ── BELOK KANAN / LURUS: Putar bundaran searah jarum jam ──
        // Sudut dari pusat bundaran ke titik masuk dan keluar
        const angleIn  = Math.atan2(A.y - cy, A.x - cx);
        const angleOut = Math.atan2(C.y - cy, C.x - cx);

        // Titik masuk & keluar di tepi bundaran
        const entryX = cx + Math.cos(angleIn)  * r;
        const entryY = cy + Math.sin(angleIn)  * r;
        const exitX  = cx + Math.cos(angleOut) * r;
        const exitY  = cy + Math.sin(angleOut) * r;

        // Bezier A → entry bundaran
        // Gunakan edge A→B asli sebagai referensi kurva
        // agar jalur mengikuti lengkungan jalan yang sebenarnya
        const cpAB = getEdgeControlPoint(A, B);
        for (let t = 0; t <= 1; t += 0.025) {
          const u = 1 - t;
          pathPts.push({
            x: u*u*A.x + 2*u*t*cpAB.x + t*t*entryX,
            y: u*u*A.y + 2*u*t*cpAB.y + t*t*entryY,
          });
        }

        // Arc bundaran searah jarum jam dari angleIn ke angleOut
        let sweep = angleOut - angleIn;
        if (sweep <= 0) sweep += Math.PI * 2;  // pastikan searah jarum jam
        sweep = Math.min(sweep, Math.PI * 1.5); // max 270 derajat
        if (sweep < 0.3) sweep = 0.3;           // min arc agar terlihat

        const steps = Math.max(10, Math.round(sweep * 12));
        for (let k = 0; k <= steps; k++) {
          const theta = angleIn + sweep * (k / steps);
          pathPts.push({
            x: cx + Math.cos(theta) * r,
            y: cy + Math.sin(theta) * r,
          });
        }

        // Bezier exit bundaran → C
        // Gunakan edge B→C asli sebagai referensi kurva keluar
        const cpBC = getEdgeControlPoint(B, C);
        for (let t = 0; t <= 1; t += 0.025) {
          const u = 1 - t;
          pathPts.push({
            x: u*u*exitX + 2*u*t*cpBC.x + t*t*C.x,
            y: u*u*exitY + 2*u*t*cpBC.y + t*t*C.y,
          });
        }
      }

      i += 1;  // skip node C karena sudah dihandle

    } else {
      // Segmen biasa: kurva Bezier kuadratik A → B
      const cp = getEdgeControlPoint(A, B, i);
      for (let t = 0; t <= 1; t += 0.02) {
        const u = 1 - t;
        pathPts.push({
          x: u*u*A.x + 2*u*t*cp.x + t*t*B.x,
          y: u*u*A.y + 2*u*t*cp.y + t*t*B.y,
        });
      }
    }
  }
}

// ===================== DASHED LINE MANUAL =====================
/**
 * dashedCurve(pts, dashLen, gapLen, color, lineWidth)
 * Menggambar garis putus-putus sepanjang kurva tanpa ctx.setLineDash().
 *
 * Prinsip:
 *   1. Terima array titik kurva yang sudah disampling (pts[])
 *   2. Hitung jarak kumulatif antar titik (arc length parameterization)
 *   3. Gambar segmen garis hanya pada interval [dashLen] piksel,
 *      lalu skip interval [gapLen] piksel — bergantian
 *
 * Keunggulan vs setLineDash():
 *   - Kontrol penuh atas distribusi dash di sepanjang kurva
 *   - Dash selalu mulai dari titik awal kurva secara konsisten
 *   - Dapat dikombinasikan dengan teknik rendering lain
 *
 * @param {Array}  pts       - Array titik { x, y } sepanjang kurva
 * @param {number} dashLen   - Panjang setiap segmen garis (world unit)
 * @param {number} gapLen    - Panjang setiap celah (world unit)
 * @param {string} color     - Warna garis
 * @param {number} lineWidth - Ketebalan garis
 */
function dashedCurve(pts, dashLen, gapLen, color, lineWidth) {
  if (pts.length < 2) return;

  ctx.strokeStyle = color;
  ctx.lineWidth   = lineWidth;
  ctx.lineCap     = 'round';

  let drawing    = true;   // true = sedang gambar dash, false = gap
  let remaining  = dashLen; // sisa panjang fase saat ini

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  let penDown = true; // apakah pena sedang menggambar

  for (let i = 1; i < pts.length; i++) {
    const dx   = pts[i].x - pts[i - 1].x;
    const dy   = pts[i].y - pts[i - 1].y;
    let   segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen === 0) continue;

    // Arah vektor satuan segmen ini
    const ux = dx / segLen;
    const uy = dy / segLen;

    let traveled = 0; // jarak yang sudah ditempuh dalam segmen ini

    while (traveled < segLen) {
      const step = Math.min(remaining, segLen - traveled);
      const nx   = pts[i - 1].x + ux * (traveled + step);
      const ny   = pts[i - 1].y + uy * (traveled + step);

      if (drawing) {
        if (!penDown) { ctx.moveTo(pts[i - 1].x + ux * traveled, pts[i - 1].y + uy * traveled); penDown = true; }
        ctx.lineTo(nx, ny);
      } else {
        ctx.moveTo(nx, ny);
        penDown = false;
      }

      traveled  += step;
      remaining -= step;

      if (remaining <= 0) {
        // Ganti fase: dash ↔ gap
        drawing   = !drawing;
        remaining = drawing ? dashLen : gapLen;
      }
    }
  }
  ctx.stroke();
}

function getEdgeCP(e) {
  const A  = nodes[e.a];
  const B  = nodes[e.b];
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;

  if (!e.curved) {
    // Jalan lurus: control point di midpoint, Bezier tidak melengkung
    return { x: mx, y: my };
  }

  // Jalan melengkung: geser control point ke samping (tegak lurus)
  // Offset = 25% jarak edge, arah ditentukan dari seed deterministic
  // sehingga konsisten setiap render tanpa simpan state
  const perp   = Math.atan2(B.y - A.y, B.x - A.x) + Math.PI / 2;
  const dist   = Math.hypot(B.x - A.x, B.y - A.y);
  const factor = (((e.a * 31 + e.b * 17) % 100) / 100 - 0.5) * 0.5;
  const offset = dist * factor;
  return {
    x: mx + Math.cos(perp) * offset,
    y: my + Math.sin(perp) * offset,
  };
}

// ===================== DRAWING: CITY BLOCKS =====================
function drawCityBlocks() {
  const col = getColors();
  for (const b of cityBlocks) {
    if (b.type === 'building') {
      drawBuilding(b, col);
    } else if (b.type === 'park') {
      drawPark(b, col);
    } else if (b.type === 'water') {
      drawWater(b, col);
    }
  }
}

/**
 * drawBuilding()
 * Render bangunan dengan:
 * - Badan bangunan (persegi panjang)
 * - Efek tingkat (semakin banyak lantai semakin gelap/tinggi kesan 3D-nya)
 * - Jendela-jendela kecil
 * - Atap (garis tipis di atas)
 */
function drawBuilding(b, col) {
  const pad = 10;
  const x = b.x + pad, y = b.y + pad;
  const w = b.w - pad * 2, h = b.h - pad * 2;
  if (w < 8 || h < 8) return;
  const { floors } = b;
  const d = isDark();

  // Palet warna bangunan — lebih realistis, variasi kota nyata
  const palettes = [
    { body:'#c8cdd8', roof:'#b8bdc8', accent:'#a0a8b8' }, // concrete modern
    { body:'#d4c4a8', roof:'#c4b498', accent:'#b0a088' }, // batu pasir
    { body:'#c0c8c0', roof:'#b0b8b0', accent:'#98a898' }, // industrial
    { body:'#d8cfc0', roof:'#c8bfb0', accent:'#b8afa0' }, // krem klasik
    { body:'#b8c4d0', roof:'#a8b4c0', accent:'#90a0b0' }, // biru modern
  ];
  const pal = d
    ? { body:'#2a3244', roof:'#323c50', accent:'#3c4860' }
    : palettes[Math.abs(Math.round(b.x * 0.1 + b.y * 0.07)) % palettes.length];

  // Bayangan lembut
  ctx.fillStyle = d ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.10)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x+4, y+4, w, h, 2);
  else ctx.rect(x+4, y+4, w, h);
  ctx.fill();

  // Badan bangunan
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, 2);
  else ctx.rect(x, y, w, h);
  ctx.fill();

  // Side shading — sisi kanan lebih gelap (simulasi cahaya dari kiri)
  const grad = ctx.createLinearGradient(x, y, x+w, y);
  grad.addColorStop(0,   'rgba(255,255,255,0.08)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0)');
  grad.addColorStop(1,   'rgba(0,0,0,0.12)');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  // Atap — strip dengan aksen warna
  ctx.fillStyle = pal.roof;
  ctx.fillRect(x, y, w, Math.max(6, h * 0.12));

  // Garis atap
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, w, Math.max(6, h * 0.12));

  // Border bangunan
  ctx.strokeStyle = d ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, 2);
  else ctx.strokeRect(x, y, w, h);
  ctx.stroke();

  // Jendela — lebih rapi dengan rounded corners
  const winCols = Math.max(1, Math.floor(w / 13));
  const winRows = Math.max(1, Math.min(floors, Math.floor((h - 14) / 12)));
  const winW    = Math.max(3, (w - 10) / winCols - 3);
  const winH    = Math.max(3, (h - 18) / winRows - 3);
  const startX  = x + 5;
  const startY  = y + Math.max(9, h * 0.14);
  const colW    = (w - 8) / winCols;
  const rowH    = (h - 18) / winRows;

  for (let wr = 0; wr < winRows; wr++) {
    for (let wc = 0; wc < winCols; wc++) {
      const wx  = startX + wc * colW;
      const wy  = startY + wr * rowH;
      // Deterministic "lampu menyala"
      const lit = ((b.x * 3 + wr * 7 + wc * 13) % 7) > 1;
      if (d) {
        ctx.fillStyle = lit ? `rgba(255,240,180,0.85)` : 'rgba(30,40,60,0.9)';
      } else {
        ctx.fillStyle = lit ? col.buildingWin : 'rgba(160,170,190,0.5)';
      }
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(wx, wy, winW, winH, 0.5);
      else ctx.fillRect(wx, wy, winW, winH);
      ctx.fill();
    }
  }

  // Ornamen atap kecil (antenna/tank air) pada bangunan tinggi
  if (floors >= 4 && w > 30 && h > 30) {
    ctx.fillStyle = d ? '#404858' : pal.accent;
    ctx.fillRect(x + w*0.4, y - 4, w*0.2, 5);
    ctx.fillRect(x + w*0.47, y - 8, w*0.06, 5);
  }
}

function drawPark(b, col) {
  const round = Math.round;
  const { x, y, w, h, treeCount, treeSeed } = b;

  const d = isDark();
  // Area taman dengan gradient hijau
  const parkGrad = ctx.createLinearGradient(x, y, x+w, y+h);
  parkGrad.addColorStop(0,   d ? '#1e3a1e' : '#d4edcc');
  parkGrad.addColorStop(0.5, d ? '#183018' : '#c8e4be');
  parkGrad.addColorStop(1,   d ? '#1a341a' : '#cce8c0');
  ctx.fillStyle = parkGrad;
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6);
  else ctx.rect(x, y, w, h);
  ctx.fill();

  // Border taman
  ctx.strokeStyle = d ? 'rgba(80,160,80,0.2)' : 'rgba(80,140,80,0.25)';
  ctx.lineWidth   = 1;
  ctx.stroke();

  // Tekstur rumput: titik-titik kecil acak
  const rngTex = makeRng(Math.round(x+y) % 9999);
  ctx.fillStyle = d ? 'rgba(60,100,60,0.3)' : 'rgba(100,160,80,0.2)';
  for (let i = 0; i < 8; i++) {
    const gx = x + rngTex() * w, gy = y + rngTex() * h;
    ctx.beginPath(); ctx.arc(gx, gy, 2+rngTex()*3, 0, Math.PI*2); ctx.fill();
  }

  // Jalur taman
  ctx.strokeStyle = d ? 'rgba(180,150,100,0.15)' : 'rgba(180,150,100,0.25)';
  ctx.lineWidth   = 2.5;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x + w*0.5, y); ctx.lineTo(x + w*0.5, y+h); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y+h*0.5); ctx.lineTo(x+w, y+h*0.5); ctx.stroke();

  // Pohon-pohon
  const rng = makeRng(treeSeed);
  for (let i = 0; i < treeCount; i++) {
    const tx = x + rng() * w * 0.8 + w * 0.1;
    const ty = y + rng() * h * 0.8 + h * 0.1;
    const tr = Math.max(5, rng() * 12 + 6);

    // Daun pohon (digambar dulu agar batang terlihat di depan)
    midpointCircle(round(tx), round(ty), round(tr), col.parkTree, true);
    midpointCircle(round(tx - tr*0.2), round(ty - tr*0.2), Math.max(1,round(tr*0.4)),
      isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.2)', true);

    // Batang pohon
    ctx.fillStyle = isDark() ? '#3a2a1a' : '#6a4a2a';
    ctx.fillRect(round(tx) - 1.5, round(ty), 3, tr * 0.8);
  }
}

/**
 * drawWater()
 * Render perairan dengan:
 * - Area biru
 * - Riak air (garis melengkung tipis)
 */
function drawWater(b, col) {
  const { x, y, w, h } = b;

  const dw = isDark();
  // Gradient air — lebih realistis
  const waterGrad = ctx.createLinearGradient(x, y, x+w*0.3, y+h);
  waterGrad.addColorStop(0,   dw ? '#1a3a50' : '#c0dff5');
  waterGrad.addColorStop(0.4, dw ? '#14283a' : '#a8d0ee');
  waterGrad.addColorStop(1,   dw ? '#102030' : '#90c4e8');
  ctx.fillStyle = waterGrad;
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10);
  else ctx.rect(x, y, w, h);
  ctx.fill();

  // Kilap air di pojok kiri atas
  const shineGrad = ctx.createRadialGradient(x+w*0.25, y+h*0.25, 0, x+w*0.25, y+h*0.25, Math.min(w,h)*0.5);
  shineGrad.addColorStop(0,   dw ? 'rgba(100,180,255,0.12)' : 'rgba(255,255,255,0.25)');
  shineGrad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = shineGrad;
  ctx.fill();

  // Border air
  ctx.strokeStyle = dw ? 'rgba(80,160,220,0.2)' : 'rgba(100,160,220,0.35)';
  ctx.lineWidth   = 1.5;
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10);
  else ctx.rect(x, y, w, h);
  ctx.stroke();

  // Riak air — lebih natural
  ctx.lineWidth = 1;
  ctx.lineCap   = 'round';
  const rippleCount = Math.max(2, Math.floor(h / 16));
  for (let i = 0; i < rippleCount; i++) {
    const ry   = y + (i+0.8) * (h / rippleCount);
    const rLen = w * (0.15 + (i % 4) * 0.08);
    const rx   = x + (w - rLen) * (0.2 + (i%3)*0.2);
    const alpha = 0.25 + (i % 2) * 0.1;
    ctx.strokeStyle = dw ? `rgba(100,180,255,${alpha})` : `rgba(80,140,200,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.quadraticCurveTo(rx + rLen*0.5, ry - 3, rx + rLen, ry);
    ctx.stroke();
  }
}

// ===================== MIDPOINT CIRCLE ALGORITHM =====================
/**
 * midpointCircle(cx, cy, r, color, fill)
 * Menggambar lingkaran menggunakan Algoritma Midpoint Circle
 * (Bresenham's Circle Algorithm) — murni operasi integer
 * tanpa fungsi trigonometri (sin/cos) atau ctx.arc().
 *
 * Prinsip:
 *   Mulai dari titik (0, r) — puncak lingkaran.
 *   Decision parameter awal: p = 1 - r
 *
 *   Setiap langkah x bertambah 1:
 *     jika p < 0  → p_baru = p + 2x + 3         (y tetap)
 *     jika p >= 0 → p_baru = p + 2x - 2y + 5    (y turun 1)
 *
 *   Manfaatkan simetri 8 oktan: setiap titik (x,y) yang dihitung
 *   langsung menghasilkan 8 titik simetris pada lingkaran.
 *
 *   Untuk mengisi (fill), gambar garis horizontal antara
 *   titik-titik simetris kiri dan kanan di setiap baris y.
 *
 * @param {number} cx    - Koordinat x pusat lingkaran
 * @param {number} cy    - Koordinat y pusat lingkaran
 * @param {number} r     - Radius lingkaran (integer)
 * @param {string} color - Warna lingkaran
 * @param {boolean} fill - true = isi penuh, false = hanya tepi
 */
function midpointCircle(cx, cy, r, color, fill = true) {
  cx = Math.round(cx);
  cy = Math.round(cy);
  r  = Math.round(r);

  let x = 0;
  let y = r;
  let p = 1 - r; // decision parameter awal

  ctx.fillStyle   = color;
  ctx.strokeStyle = color;

  // Fungsi bantu: gambar 8 titik simetris dari satu titik (x, y)
  // atau 4 garis horizontal untuk mode fill
  function plot8(x, y) {
    if (fill) {
      // Isi lingkaran: gambar garis horizontal antara titik simetris
      // Setiap pasang titik simetris membentuk segmen horizontal
      ctx.fillRect(cx - x, cy + y, 2 * x, 1); // bawah
      ctx.fillRect(cx - x, cy - y, 2 * x, 1); // atas
      ctx.fillRect(cx - y, cy + x, 2 * y, 1); // kiri-kanan tengah bawah
      ctx.fillRect(cx - y, cy - x, 2 * y, 1); // kiri-kanan tengah atas
    } else {
      // Hanya tepi: gambar 8 titik simetris
      ctx.fillRect(cx + x, cy + y, 1, 1);
      ctx.fillRect(cx - x, cy + y, 1, 1);
      ctx.fillRect(cx + x, cy - y, 1, 1);
      ctx.fillRect(cx - x, cy - y, 1, 1);
      ctx.fillRect(cx + y, cy + x, 1, 1);
      ctx.fillRect(cx - y, cy + x, 1, 1);
      ctx.fillRect(cx + y, cy - x, 1, 1);
      ctx.fillRect(cx - y, cy - x, 1, 1);
    }
  }

  // Loop dari x=0 sampai x=y (oktan pertama, sisanya via simetri)
  while (x <= y) {
    plot8(x, y);

    if (p < 0) {
      // Titik midpoint di dalam lingkaran → y tetap
      p += 2 * x + 3;
    } else {
      // Titik midpoint di luar lingkaran → y turun 1
      y--;
      p += 2 * x - 2 * y + 5;
    }
    x++;
  }
}

/**
 * midpointCircleCtx(cx, cy, r, fill, stroke)
 * Versi midpointCircle yang bekerja di koordinat ctx saat ini
 * (termasuk dalam ctx.save/rotate transform).
 * Menggunakan algoritma Midpoint Circle yang sama persis,
 * namun output via ctx.beginPath/arc diganti fillRect per piksel.
 * Dipakai untuk kendaraan dan elemen yang digambar dalam rotated context.
 *
 * Prinsip identik dengan midpointCircle():
 *   p = 1 - r,  setiap langkah x++:
 *   jika p < 0: p += 2x + 3  (y tetap)
 *   jika p >= 0: y--, p += 2x - 2y + 5
 *   Simetri 8 oktan untuk fill horizontal.
 */
function midpointCircleCtx(cx, cy, r, fillColor, strokeColor) {
  r = Math.round(Math.abs(r));
  if (r < 1) return;
  let x = 0, y = r, p = 1 - r;
  if (fillColor) {
    ctx.fillStyle = fillColor;
    while (x <= y) {
      ctx.fillRect(cx - x, cy - y, 2*x, 1);
      ctx.fillRect(cx - x, cy + y, 2*x, 1);
      ctx.fillRect(cx - y, cy - x, 2*y, 1);
      ctx.fillRect(cx - y, cy + x, 2*y, 1);
      if (p < 0) { p += 2*x + 3; }
      else       { y--; p += 2*x - 2*y + 5; }
      x++;
    }
  }
  if (strokeColor) {
    x = 0; y = r; p = 1 - r;
    ctx.fillStyle = strokeColor;
    while (x <= y) {
      for (const [px,py] of [[cx+x,cy+y],[cx-x,cy+y],[cx+x,cy-y],[cx-x,cy-y],
                             [cx+y,cy+x],[cx-y,cy+x],[cx+y,cy-x],[cx-y,cy-x]]) {
        ctx.fillRect(px, py, 1, 1);
      }
      if (p < 0) { p += 2*x + 3; }
      else       { y--; p += 2*x - 2*y + 5; }
      x++;
    }
  }
}

// ===================== DRAWING: SIDEWALK =====================
/**
 * drawSidewalks()
 * Gambar trotoar tipis di sepanjang setiap ruas jalan
 * sebagai tanda tata kota yang lebih lengkap.
 */
function drawSidewalks() {
  const col = getColors();
  for (const e of edges) {
    const A  = nodes[e.a];
    const B  = nodes[e.b];
    const cp = getEdgeCP(e);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.quadraticCurveTo(cp.x, cp.y, B.x, B.y);
    ctx.strokeStyle = col.sidewalk;
    ctx.lineWidth   = 22;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
  }
}

// ===================== DRAWING: FLAG =====================
function drawFlag(x, y, color) {
  const s = 1 / zoom;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2.5 * s;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - 8  * s);
  ctx.lineTo(x, y - 38 * s);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x,           y - 38 * s);
  ctx.lineTo(x + 18 * s, y - 29 * s);
  ctx.lineTo(x,           y - 20 * s);
  ctx.closePath();
  ctx.fill();
  midpointCircleCtx(Math.round(x), Math.round(y - 8*s), Math.max(1, Math.round(5*s)), ctx.fillStyle, null);
}

// ===================== DRAWING: MOVING OBJECT =====================
// KONVENSI ORIENTASI:
//   obj.angle = atan2(dy, dx) = sudut arah gerak di canvas
//   Semua kendaraan digambar dengan hidung menghadap +X (kanan)
//   ctx.rotate(obj.angle) otomatis memutar ke arah gerak
//   Ukuran kendaraan: panjang ~22s, lebar ~12s
//   Jalan lebar 30 unit -> kendaraan muat di dalam lajur
function drawMovingObj(obj) {
  const col = getColors();
  ctx.save();
  ctx.translate(obj.x, obj.y);
  ctx.rotate(obj.angle);
  const s = 1 / zoom;

  if (obj.type === 'car') {
    // Mobil top-down, hidung ke +X
    // Panjang (sumbu X): 22s, Lebar (sumbu Y): 12s
    const carColors = [col.objCar, col.objCar2, col.objCar3, col.objCar4];
    const cc = carColors[(obj.colorIdx || 0) % 4];  // colorIdx tetap sejak spawn
    const hl = 11*s, hw = 6*s;  // half-length, half-width

    // Bayangan (offset kanan-bawah)
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-hl+s, -hw+s, hl*2, hw*2, 3*s);
    else ctx.rect(-hl+s, -hw+s, hl*2, hw*2);
    ctx.fill();

    // Bodi
    ctx.fillStyle = cc;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-hl, -hw, hl*2, hw*2, 3*s);
    else ctx.rect(-hl, -hw, hl*2, hw*2);
    ctx.fill();

    // Atap gelap (tengah bodi)
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-hl*0.25, -hw+1.5*s, hl*1.0, hw*2-3*s, 2*s);
    else ctx.rect(-hl*0.25, -hw+1.5*s, hl*1.0, hw*2-3*s);
    ctx.fill();

    // Kaca depan (+X)
    ctx.fillStyle = 'rgba(180,225,255,0.9)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(hl*0.2, -hw+2*s, hl*0.55, hw*2-4*s, 2*s);
    else ctx.rect(hl*0.2, -hw+2*s, hl*0.55, hw*2-4*s);
    ctx.fill();

    // Kaca belakang (-X)
    ctx.fillStyle = 'rgba(180,225,255,0.55)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-hl*0.75, -hw+2*s, hl*0.35, hw*2-4*s, 1.5*s);
    else ctx.rect(-hl*0.75, -hw+2*s, hl*0.35, hw*2-4*s);
    ctx.fill();

    // 4 roda (sudut bodi)
    const rL = 4*s, rW = 2.5*s;
    for (const [rx,ry] of [
      [ hl*0.55, -hw-rW/2],   // kanan depan atas
      [ hl*0.55,  hw-rL+rW/2],// kanan depan bawah
      [-hl*0.7,  -hw-rW/2],   // kiri belakang atas
      [-hl*0.7,   hw-rL+rW/2],// kiri belakang bawah
    ]) {
      ctx.fillStyle = '#111'; ctx.fillRect(rx, ry, rL, rW);
      ctx.fillStyle = '#444'; ctx.fillRect(rx+0.8*s, ry+0.5*s, rL-1.6*s, rW-1*s);
    }

    // Lampu depan kuning (+X)
    ctx.fillStyle = '#FFE055';
    ctx.fillRect(hl-1*s, -hw+0.5*s, 2*s, 2*s);
    ctx.fillRect(hl-1*s,  hw-2.5*s, 2*s, 2*s);

    // Lampu belakang merah (-X)
    ctx.fillStyle = '#FF2020';
    ctx.fillRect(-hl-1*s, -hw+0.5*s, 2*s, 2*s);
    ctx.fillRect(-hl-1*s,  hw-2.5*s, 2*s, 2*s);

  } else if (obj.type === 'moto') {
    // Motor, hidung ke +X, panjang 18s lebar 7s
    ctx.fillStyle = col.objMoto;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-9*s, -3.5*s, 18*s, 7*s, 2.5*s);
    else ctx.rect(-9*s, -3.5*s, 18*s, 7*s);
    ctx.fill();
    // Roda depan dan belakang
    ctx.fillStyle = '#111';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(6*s, -3*s, 5*s, 6*s, 1.5*s);
    else ctx.rect(6*s, -3*s, 5*s, 6*s);
    ctx.fill();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-11*s, -3*s, 5*s, 6*s, 1.5*s);
    else ctx.rect(-11*s, -3*s, 5*s, 6*s);
    ctx.fill();
    // Helm pengendara
    midpointCircleCtx(0, 0, Math.max(1, Math.round(3.5*s)), '#eecc44', null);

  } else if (obj.type === 'bike') {
    // Sepeda, hidung ke +X
    ctx.strokeStyle = col.objBike;
    ctx.lineWidth   = 1.8*s;
    ctx.lineCap     = 'round';
    // Rangka
    ctx.beginPath(); ctx.moveTo(-8*s,0); ctx.lineTo(8*s,0); ctx.stroke();
    // Roda depan & belakang
    midpointCircleCtx(Math.round(7*s), 0, Math.max(1, Math.round(4.5*s)), null, col.objBike);
    midpointCircleCtx(Math.round(-7*s), 0, Math.max(1, Math.round(4.5*s)), null, col.objBike);
    // Setang depan
    ctx.beginPath(); ctx.moveTo(7*s,-3.5*s); ctx.lineTo(7*s,3.5*s); ctx.stroke();
    // Pengendara
    midpointCircleCtx(0, 0, Math.max(1, Math.round(3*s)), col.objBike, null);

  } else {
    // Pejalan kaki, hidung ke +X
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(1.5*s, 0, 4.5*s, 3*s, 0, 0, Math.PI*2); ctx.fill();
    // Tubuh
    midpointCircleCtx(0, 0, Math.max(1, Math.round(4*s)), col.objPed, null);
    // Kepala (sisi +X)
    midpointCircleCtx(Math.round(2.5*s), 0, Math.max(1, Math.round(2.5*s)), '#f5c8a0', null);
    // Kaki (animasi atas-bawah)
    const step = Math.sin(animT * 0.3) * 3*s;
    ctx.fillStyle = col.objPed;
    ctx.beginPath(); ctx.ellipse(-2*s, -step, 1.5*s, 2.8*s, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-2*s,  step, 1.5*s, 2.8*s, 0, 0, Math.PI*2); ctx.fill();
  }

  ctx.restore();
}

// ===================== DRAWING: FULL MAP =====================
function _drawMap2D() {
  const col = getColors();
  ctx.save();
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = col.bg;
  ctx.fillRect(0, 0, W, H);

  // Grid halus — digambar menggunakan Algoritma Bresenham
  // Grid berada di screen space (sebelum ctx.translate world),
  // sehingga bresenhamLine dipanggil langsung di koordinat layar.
  // Setiap garis grid adalah garis lurus horisontal/vertikal
  // yang ideal untuk mendemonstrasikan Bresenham pada sumbu tunggal.
  const gs = 100 * zoom;
  const ox = ((-camX * zoom) + W / 2) % gs;
  const oy = ((-camY * zoom) + H / 2) % gs;
  const gridColor = col.grid;
  // Bresenham bekerja di ruang piksel integer — bulatkan koordinat awal
  for (let x = ox; x < W; x += gs) {
    bresenhamLine(Math.round(x), 0, Math.round(x), H, gridColor, 1);
  }
  for (let y = oy; y < H; y += gs) {
    bresenhamLine(0, Math.round(y), W, Math.round(y), gridColor, 1);
  }

  // Masuk koordinat dunia
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

  // 1. Trotoar lebar di kiri-kanan jalan (digambar paling bawah)
  // 1b. Blok tata kota — digambar SEBELUM jalan agar tidak tertimpa aspal
  drawCityBlocks();

  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  for (const e of edges) {
    const A  = nodes[e.a];
    const B  = nodes[e.b];
    const cp = getEdgeCP(e);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.quadraticCurveTo(cp.x, cp.y, B.x, B.y);
    ctx.strokeStyle = col.sidewalk;
    ctx.lineWidth   = 28;
    ctx.stroke();
  }

  // 3. Border aspal gelap (tepi jalan)
  for (const e of edges) {
    const A  = nodes[e.a];
    const B  = nodes[e.b];
    const cp = getEdgeCP(e);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.quadraticCurveTo(cp.x, cp.y, B.x, B.y);
    ctx.strokeStyle = col.road;
    ctx.lineWidth   = 22;
    ctx.stroke();
  }

  // 4. Permukaan aspal (lebih terang)
  for (const e of edges) {
    const A  = nodes[e.a];
    const B  = nodes[e.b];
    const cp = getEdgeCP(e);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.quadraticCurveTo(cp.x, cp.y, B.x, B.y);
    ctx.strokeStyle = col.roadSurf;
    ctx.lineWidth   = 16;
    ctx.stroke();
  }

  // 5. Marka garis tengah jalan (putus-putus) — dashedCurve() manual
  // Sampling t += 0.02 (50 titik) agar mengikuti kurva dengan mulus
  for (const e of edges) {
    const A   = nodes[e.a];
    const B   = nodes[e.b];
    const cp  = getEdgeCP(e);
    const pts = [];
    for (let t = 0; t <= 1; t += 0.02) {
      const u = 1 - t;
      pts.push({
        x: u * u * A.x + 2 * u * t * cp.x + t * t * B.x,
        y: u * u * A.y + 2 * u * t * cp.y + t * t * B.y,
      });
    }
    // Ukuran dash proporsional: jalan lurus dash lebih panjang
    const dashLen = e.curved ? 8 : 12;
    const gapLen  = e.curved ? 8 : 12;
    dashedCurve(pts, dashLen, gapLen, col.roadMark, 2);
  }

    // 6. Highlight jalur A* — menggunakan dashedCurve() manual
  if (pathPts.length > 1) {
    ctx.globalAlpha = 0.8;
    dashedCurve(pathPts, 16, 10, col.pathLine, 6);
    ctx.globalAlpha = 1;
  }

  // 7a. Bundaran
  for (const n of nodes) {
    if (n.isRoundabout) drawRoundabout(n, col);
  }

  // 7b. Persimpangan biasa — Midpoint Circle
  for (const n of nodes) {
    if (n.isRoundabout) continue;
    midpointCircle(n.x, n.y, 12, col.road, true);
    midpointCircle(n.x, n.y, 10, col.roadSurf, true);
  }

  // 8. Bendera awal & tujuan
  if (nodes[startNode]) drawFlag(nodes[startNode].x, nodes[startNode].y, col.flagG);
  if (nodes[endNode])   drawFlag(nodes[endNode].x,   nodes[endNode].y,   col.flagR);

  // 9. Objek bergerak
  if (movingObj) drawMovingObj(movingObj);

  ctx.restore();
  ctx.restore();
}

// ===================== ANIMATION =====================
function stepAnim() {
  if (!animRunning || animPaused || pathPts.length < 2) return;
  const speed = SPEEDS[movingObj.type] || 0.4;
  animT += speed;
  const idx = Math.floor(animT);
  if (idx >= pathPts.length - 1) {
    movingObj.x = pathPts[pathPts.length - 1].x;
    movingObj.y = pathPts[pathPts.length - 1].y;
    animRunning = false;
    resetButtons();
    return;
  }
  const cur = pathPts[idx];
  const nxt = pathPts[Math.min(idx + 1, pathPts.length - 1)];
  movingObj.x     = cur.x;
  movingObj.y     = cur.y;
  movingObj.angle = Math.atan2(nxt.y - cur.y, nxt.x - cur.x);
}

// ===================== CAMERA =====================
function clampCam() {
  const hw = W / (2 * zoom);
  const hh = H / (2 * zoom);
  camX = Math.max(hw,         Math.min(MAP_W - hw, camX));
  camY = Math.max(hh,         Math.min(MAP_H - hh, camY));
}

function setZoom(z) {
  zoom = Math.max(0.12, Math.min(4, z));
  clampCam();
  document.getElementById('zoom-label').textContent = Math.round(zoom * 100) + '%';
}

// ===================== UI HELPERS =====================
function resetButtons() {
  document.getElementById('btn-start').style.display = '';
  document.getElementById('btn-pause').style.display = 'none';
  document.getElementById('btn-pause').textContent   = '⏸ Pause';
  const stEl = document.getElementById('status-text');
  const sdEl = document.querySelector('.status-dot');
  if (stEl) stEl.textContent = 'Siap';
  if (sdEl) sdEl.style.background = '#16a34a';
}

// ===================== EVENT LISTENERS =====================
canvas.addEventListener('mousedown', e => {
  if (is3D) {
    drag3D = true;
    drag3DPan = e.button === 2 || e.altKey;
    last3DMX = e.clientX; last3DMY = e.clientY;
  } else {
    dragging = true; lastMX = e.clientX; lastMY = e.clientY;
  }
  canvas.classList.add('grabbing');
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousemove', e => {
  if (is3D && drag3D) {
    const dx = e.clientX - last3DMX;
    const dy = e.clientY - last3DMY;
    if (drag3DPan) {
      // Pan: geser target kamera
      const speed = cam3D.r * 0.001;
      cam3D.tx -= Math.cos(cam3D.theta) * dx * speed;
      cam3D.tz -= Math.sin(cam3D.theta) * dx * speed;
      cam3D.tx += Math.sin(cam3D.theta) * dy * speed * 0.5;
      cam3D.tz -= Math.cos(cam3D.theta) * dy * speed * 0.5;
    } else {
      // Orbit: putar kamera
      cam3D.theta -= dx * 0.006;
      cam3D.phi    = Math.max(0.15, Math.min(Math.PI*0.48, cam3D.phi - dy * 0.006));
    }
    last3DMX = e.clientX; last3DMY = e.clientY;
    return;
  }
  if (!dragging) return;
  camX -= (e.clientX - lastMX) / zoom;
  camY -= (e.clientY - lastMY) / zoom;
  clampCam(); lastMX = e.clientX; lastMY = e.clientY;
});
canvas.addEventListener('mouseup',    () => { dragging = false; drag3D = false; canvas.classList.remove('grabbing'); });
canvas.addEventListener('mouseleave', () => { dragging = false; drag3D = false; canvas.classList.remove('grabbing'); });

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (is3D) {
    // 3D zoom: ubah jarak kamera (r)
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    cam3D.r = Math.max(300, Math.min(8000, cam3D.r * factor));
    return;
  }
  const delta = e.deltaY > 0 ? -0.08 : 0.08;
  const rect  = canvas.getBoundingClientRect();
  const mx    = e.clientX - rect.left;
  const my    = e.clientY - rect.top;
  const wx    = (mx - W / 2) / zoom + camX;
  const wy    = (my - H / 2) / zoom + camY;
  setZoom(zoom + delta);
  camX = wx - (mx - W / 2) / zoom;
  camY = wy - (my - H / 2) / zoom;
  clampCam();
}, { passive: false });

canvas.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    dragging = true; lastMX = e.touches[0].clientX; lastMY = e.touches[0].clientY;
  }
  if (e.touches.length === 2) {
    lastTouchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }
});
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length === 1 && dragging) {
    camX -= (e.touches[0].clientX - lastMX) / zoom;
    camY -= (e.touches[0].clientY - lastMY) / zoom;
    clampCam(); lastMX = e.touches[0].clientX; lastMY = e.touches[0].clientY;
  }
  if (e.touches.length === 2) {
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    setZoom(zoom * (d / lastTouchDist)); lastTouchDist = d;
  }
}, { passive: false });
canvas.addEventListener('touchend', () => { dragging = false; });

document.getElementById('btn-rand').addEventListener('click', () => {
  animRunning = false; animPaused = false; resetButtons();
  generateMap();
  camX = MAP_W / 2; camY = MAP_H / 2;
  setZoom(0.18);
});
document.getElementById('btn-pos').addEventListener('click', () => {
  animRunning = false; animPaused = false; resetButtons();
  randomPositions();
});
document.getElementById('btn-zi').addEventListener('click', () => setZoom(zoom + 0.08));
document.getElementById('btn-zo').addEventListener('click', () => setZoom(zoom - 0.08));

document.getElementById('btn-start').addEventListener('click', () => {
  selectedType = document.getElementById('obj-select').value;
  animT        = 0;
  animRunning  = true;
  animPaused   = false;
  movingObj = {
    type:     selectedType,
    x:        pathPts[0] ? pathPts[0].x : nodes[startNode].x,
    y:        pathPts[0] ? pathPts[0].y : nodes[startNode].y,
    angle:    0,
    colorIdx: Math.floor(Math.random() * 4),  // warna tetap selama perjalanan
  };
  document.getElementById('btn-start').style.display = 'none';
  document.getElementById('btn-pause').style.display = '';
  // Update status pill
  const stEl = document.getElementById('status-text');
  const sdEl = document.querySelector('.status-dot');
  const vType = {car:'🚗 Mobil', moto:'🏍 Motor', bike:'🚲 Sepeda', ped:'🚶 Pejalan Kaki'};
  if (stEl) stEl.textContent = 'Berjalan · ' + (vType[selectedType] || selectedType);
  if (sdEl) sdEl.style.background = '#2563eb';
});

document.getElementById('btn-pause').addEventListener('click', () => {
  animPaused = !animPaused;
  document.getElementById('btn-pause').textContent = animPaused ? '▶ Resume' : '⏸ Pause';
  const sp2 = document.getElementById('status-text');
  if (sp2) sp2.textContent = animPaused ? 'Dijeda' : 'Animasi berjalan';
  const sd2 = document.querySelector('.status-dot');
  if (sd2) sd2.style.background = animPaused ? '#d97706' : '#2563eb';
});

// Toggle 2D/3D
document.getElementById('btn-3d').addEventListener('click', () => {
  is3D = !is3D;
  const btn = document.getElementById('btn-3d');
  const info2d = document.getElementById('info');
  const info3d = document.getElementById('info3d');
  if (is3D) {
    btn.classList.add('active');
    btn.textContent = '🧊 Mode 2D';
    info2d.style.display = 'none';
    info3d.style.display = '';
    // Reset orbit camera ke posisi awal
    cam3D.theta = -Math.PI / 4;
    cam3D.phi   = Math.PI / 3;
    cam3D.r     = 3200;
    cam3D.tx    = 0;
    cam3D.tz    = 0;
  } else {
    btn.classList.remove('active');
    btn.textContent = '🧊 Mode 3D';
    info2d.style.display = '';
    info3d.style.display = 'none';
  }
});

window.addEventListener('resize', () => {
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W; canvas.height = H;
});

// ── KEYBOARD SHORTCUTS ──────────────────────────────────────
window.addEventListener('keydown', e => {
  // Jangan trigger jika focus di input/select
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  switch(e.key.toLowerCase()) {
    case 'r':
      // Shortcut R: Acak Peta
      document.getElementById('btn-rand').click();
      break;
    case ' ':
      // Shortcut Space: Start/Pause
      e.preventDefault();
      if (!animRunning) {
        document.getElementById('btn-start').click();
      } else {
        document.getElementById('btn-pause').click();
      }
      break;
    case 'p':
      // Shortcut P: Acak Posisi
      document.getElementById('btn-pos').click();
      break;
    case '+': case '=':
      setZoom(zoom + 0.08); break;
    case '-':
      setZoom(zoom - 0.08); break;
  }
});




// =====================================================================
// RUMPUT PINGGIRAN PETA
// Strip rumput hijau di tepi MAP_W x MAP_H — digambar di layer paling bawah
// sebelum grid, menggunakan warna grassEdge dari getColors()
// =====================================================================

function drawMapBorder() {
  if (is3D) return;
  const col = getColors();
  const pad = 60; // lebar strip rumput dalam world unit

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

  // Outer fill — area di luar peta
  ctx.fillStyle = col.grassEdge;

  // Kiri
  ctx.fillRect(-pad * 4, -pad * 4, pad * 4, MAP_H + pad * 8);
  // Kanan
  ctx.fillRect(MAP_W, -pad * 4, pad * 4, MAP_H + pad * 8);
  // Atas
  ctx.fillRect(-pad * 4, -pad * 4, MAP_W + pad * 8, pad * 4);
  // Bawah
  ctx.fillRect(-pad * 4, MAP_H, MAP_W + pad * 8, pad * 4);

  // Strip rumput dalam (lebih terang, langsung di tepi peta)
  ctx.fillStyle = col.grassEdge2;
  ctx.fillRect(0, 0, MAP_W, pad * 0.6);           // atas
  ctx.fillRect(0, MAP_H - pad * 0.6, MAP_W, pad * 0.6); // bawah
  ctx.fillRect(0, 0, pad * 0.6, MAP_H);           // kiri
  ctx.fillRect(MAP_W - pad * 0.6, 0, pad * 0.6, MAP_H); // kanan

  // Blade-blade rumput kecil acak di strip pinggir
  const rng = makeRng(123);
  const bladeColor = col.grassEdge;

  // Atas & Bawah
  for (let x = 10; x < MAP_W; x += 18 + rng() * 20) {
    for (const baseY of [rng() * pad * 0.5, MAP_H - rng() * pad * 0.5]) {
      if (rng() < 0.4) continue;
      const h = 6 + rng() * 10;
      const lean = (rng() - 0.5) * 8;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(x + lean * 0.5, baseY - h * 0.6, x + lean, baseY - h);
      ctx.strokeStyle = bladeColor;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  // Kiri & Kanan
  for (let y = 10; y < MAP_H; y += 18 + rng() * 20) {
    for (const baseX of [rng() * pad * 0.5, MAP_W - rng() * pad * 0.5]) {
      if (rng() < 0.4) continue;
      const h = 6 + rng() * 10;
      const lean = (rng() - 0.5) * 8;
      ctx.beginPath();
      ctx.moveTo(baseX, y);
      ctx.quadraticCurveTo(baseX - h * 0.6, y + lean * 0.5, baseX - h, y + lean);
      ctx.strokeStyle = bladeColor;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  ctx.restore();
}

// =====================================================================
// FITUR ALMAN: MINIMAP — Scaling Transform 2D
// screenX = minimapX + (worldX / MAP_W) * minimapW
// =====================================================================

const MINIMAP_W   = 160;
const MINIMAP_H   = 120;
const MINIMAP_PAD = 14;

function worldToMinimap(wx, wy) {
  const mx = canvas.width - MINIMAP_W - MINIMAP_PAD;
  const my = canvas.height - MINIMAP_H - 260;
  return {
    x: mx + (wx / MAP_W) * MINIMAP_W,
    y: my + (wy / MAP_H) * MINIMAP_H,
  };
}

function drawMinimap() {
  if (is3D) return;
  const col = getColors();
  const mx  = canvas.width - MINIMAP_W - MINIMAP_PAD;
  const my  = canvas.height - MINIMAP_H - 260;

  ctx.save();
  ctx.fillStyle   = col.bg;
  ctx.strokeStyle = '#c4c0b8';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(mx, my, MINIMAP_W, MINIMAP_H, 6);
  else ctx.rect(mx, my, MINIMAP_W, MINIMAP_H);
  ctx.fill(); ctx.stroke();

  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(mx, my, MINIMAP_W, MINIMAP_H, 6);
  else ctx.rect(mx, my, MINIMAP_W, MINIMAP_H);
  ctx.clip();

  ctx.strokeStyle = col.road;
  ctx.lineWidth   = 1.5;
  ctx.lineCap     = 'round';
  for (const e of edges) {
    const A  = nodes[e.a], B = nodes[e.b];
    const pA = worldToMinimap(A.x, A.y);
    const pB = worldToMinimap(B.x, B.y);
    const cp = getEdgeCP(e);
    const pC = worldToMinimap(cp.x, cp.y);
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.quadraticCurveTo(pC.x, pC.y, pB.x, pB.y);
    ctx.stroke();
  }

  if (pathPts.length > 1) {
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    const p0 = worldToMinimap(pathPts[0].x, pathPts[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < pathPts.length; i += 3) {
      const p = worldToMinimap(pathPts[i].x, pathPts[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  const vLeft   = camX - (canvas.width  / 2) / zoom;
  const vTop    = camY - (canvas.height / 2) / zoom;
  const vRight  = camX + (canvas.width  / 2) / zoom;
  const vBottom = camY + (canvas.height / 2) / zoom;
  const vpTL    = worldToMinimap(vLeft,  vTop);
  const vpBR    = worldToMinimap(vRight, vBottom);
  ctx.strokeStyle = 'rgba(37,99,235,0.7)';
  ctx.fillStyle   = 'rgba(37,99,235,0.08)';
  ctx.lineWidth   = 1.5;
  ctx.fillRect(vpTL.x, vpTL.y, vpBR.x - vpTL.x, vpBR.y - vpTL.y);
  ctx.strokeRect(vpTL.x, vpTL.y, vpBR.x - vpTL.x, vpBR.y - vpTL.y);

  if (nodes[startNode]) {
    const ps = worldToMinimap(nodes[startNode].x, nodes[startNode].y);
    ctx.fillStyle = '#16a34a';
    ctx.beginPath(); ctx.arc(ps.x, ps.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  if (nodes[endNode]) {
    const pe = worldToMinimap(nodes[endNode].x, nodes[endNode].y);
    ctx.fillStyle = '#dc2626';
    ctx.beginPath(); ctx.arc(pe.x, pe.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  if (movingObj) {
    const pm = worldToMinimap(movingObj.x, movingObj.y);
    ctx.fillStyle = '#2563eb';
    ctx.beginPath(); ctx.arc(pm.x, pm.y, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle    = '#aaa';
  ctx.font         = '9px -apple-system, sans-serif';
  ctx.textAlign    = 'right';
  ctx.fillText('MINIMAP', canvas.width - MINIMAP_PAD, my - 4);
  ctx.textAlign    = 'left';
}


// =====================================================================
// FITUR NEZA: SPEED CONTROL + SMOOTH EASING
// smoothstep(t) = t²(3 - 2t)
// =====================================================================

let speedMultiplier = 1.0;

function smoothstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

function lerpPoint(a, b, t) {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function stepAnimSmooth() {
  if (!animRunning || animPaused || pathPts.length < 2) return;
  const baseSpeed = SPEEDS[movingObj ? movingObj.type : 'car'] || 0.4;
  animT += baseSpeed * speedMultiplier;

  const idxRaw = animT;
  const idx    = Math.floor(idxRaw);
  if (idx >= pathPts.length - 1) {
    movingObj.x = pathPts[pathPts.length - 1].x;
    movingObj.y = pathPts[pathPts.length - 1].y;
    animRunning = false;
    resetButtons();
    return;
  }
  const frac  = idxRaw - idx;
  const eased = smoothstep(frac);
  const cur   = pathPts[idx];
  const nxt   = pathPts[Math.min(idx + 1, pathPts.length - 1)];
  const pos   = lerpPoint(cur, nxt, eased);
  movingObj.x     = pos.x;
  movingObj.y     = pos.y;
  movingObj.angle = Math.atan2(nxt.y - cur.y, nxt.x - cur.x);
}


// ═══════════════════════════════════════════════════════════════════
// KONTRIBUSI ELSA — Map Generation, PRNG LCG, generateCityBlocks,
//                   addDiagonalEdges, detectRoundaboutsSecondary
// Fungsi: generateMap(), makeRng(), generateCityBlocks(),
//         generateBuildingCluster(), addDiagonalEdges()
// ═══════════════════════════════════════════════════════════════════

// =====================================================================
// FITUR ELSA: DIAGONAL EDGE SEJATI
// Edge NW→SE dan NE→SW ditambahkan secara struktural ke graf
// =====================================================================

function addDiagonalEdges(cols, rows, probability = 0.35) {
  const diagRng = makeRng(Math.floor(Math.random() * 99999));
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const TL = r * cols + c;
      const TR = r * cols + c + 1;
      const BL = (r + 1) * cols + c;
      const BR = (r + 1) * cols + c + 1;
      if (diagRng() < probability && !edgeExists(TL, BR)) {
        edges.push({ a: TL, b: BR, curved: true });
        nodes[TL].adj.push(BR);
        nodes[BR].adj.push(TL);
      }
      if (diagRng() < probability * 0.6 && !edgeExists(TR, BL)) {
        edges.push({ a: TR, b: BL, curved: true });
        nodes[TR].adj.push(BL);
        nodes[BL].adj.push(TR);
      }
    }
  }
}


// ═══════════════════════════════════════════════════════════════════
// KONTRIBUSI AMAA — Animasi Kendaraan, Viewport Transform,
//                   Ekstrusi 3D, Painter's Algorithm, Heatmap
// Fungsi: drawMovingObj(), stepAnimSmooth(), clampCam(), setZoom(),
//         extrudeBuilding3D(), drawTrafficHeatmap(), lerpColor()
// ═══════════════════════════════════════════════════════════════════

// =====================================================================
// FITUR AMAA: TRAFFIC DENSITY HEATMAP
// HSL color mapping: hue = lerp(120°, 0°, t)
// =====================================================================

let showHeatmap = false;

function lerpColor(hue1, hue2, t) {
  const hue = hue1 + t * (hue2 - hue1);
  return `hsl(${hue.toFixed(1)}, 80%, 50%)`;
}

function drawTrafficHeatmap() {
  if (!showHeatmap || is3D) return;
  const degrees = nodes.map(n => n.adj.length);
  const minDeg  = Math.min(...degrees);
  const maxDeg  = Math.max(...degrees);
  const range   = maxDeg - minDeg || 1;

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

  for (const n of nodes) {
    const t     = (n.adj.length - minDeg) / range;
    const color = lerpColor(120, 0, t);
    const r     = 18 + t * 14;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color.replace('hsl', 'hsla').replace(')', ', 0.45)');
    ctx.fill();
    ctx.fillStyle    = '#fff';
    ctx.font         = `bold ${Math.round(9 / zoom * 2)}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.adj.length, n.x, n.y);
  }
  ctx.restore();
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}


// =====================================================================
// UI: SPEED SLIDER (Neza) + TOMBOL HEATMAP (Amaa)
// =====================================================================

window.addEventListener('load', () => {
  const wrap = document.createElement('div');
  wrap.id = 'speed-wrap';
  wrap.style.cssText = `
    position:absolute; bottom:14px; left:50%; transform:translateX(-50%);
    z-index:20; display:flex; align-items:center; gap:8px;
    background:#fff; border:1px solid #e4e0da; border-radius:8px;
    padding:6px 14px; font-size:11px; color:#666;
    box-shadow:0 1px 3px rgba(0,0,0,0.05);
  `;
  wrap.innerHTML = `
    <span>🐢</span>
    <input type="range" id="speed-slider" min="0.2" max="4" step="0.1" value="1"
      style="width:90px;accent-color:#2563eb;cursor:pointer;">
    <span>🐇</span>
    <span id="speed-label" style="font-weight:600;min-width:28px;text-align:center;">1×</span>
  `;
  document.getElementById('app').appendChild(wrap);
  const slider = document.getElementById('speed-slider');
  const updateSlider = () => {
    speedMultiplier = parseFloat(slider.value);
    document.getElementById('speed-label').textContent = speedMultiplier.toFixed(1) + '×';
    // Update gradient track
    const min = parseFloat(slider.min), max = parseFloat(slider.max);
    const pct = ((speedMultiplier - min) / (max - min) * 100).toFixed(1);
    slider.style.setProperty('--val', pct + '%');
    slider.style.background = `linear-gradient(90deg, #2563eb ${pct}%, #e5e7eb ${pct}%)`;
  };
  slider.addEventListener('input', updateSlider);
  updateSlider(); // init

  const toolbar = document.getElementById('toolbar');
  const sep     = document.createElement('div');
  sep.className = 'tb-sep';
  toolbar.appendChild(sep);
  const btn = document.createElement('button');
  btn.className   = 'btn btn-flat';
  btn.id          = 'btn-heat';
  btn.textContent = '🌡 Heatmap';
  btn.addEventListener('click', () => {
    showHeatmap           = !showHeatmap;
    btn.style.background  = showHeatmap ? '#fef3c7' : '';
    btn.style.borderColor = showHeatmap ? '#fbbf24' : '';
  });
  toolbar.appendChild(btn);
});


// =====================================================================
// FITUR RAIHAN (FINAL): PATCH drawMap + MAIN LOOP + INIT
// =====================================================================

function drawMap() {
  _drawMap2D();
  drawTrafficHeatmap();
  drawMinimap();
}

function loop() {
  stepAnimSmooth();
  if (is3D) drawMap3D();
  else drawMap();
  requestAnimationFrame(loop);
}

// ===================== INIT =====================
generateMap();
camX = MAP_W / 2;
camY = MAP_H / 2;
setZoom(0.18);
loop();