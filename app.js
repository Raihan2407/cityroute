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

let nodes     = [];  // { id, x, y, adj[] }
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

// ===================== COLOR THEME =====================
function isDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches;
}

function getColors() {
  const d = isDark();
  return {
    bg:          d ? '#1a1a18' : '#ddd8ce',
    road:        d ? '#3a3a36' : '#b0ab9f',
    roadSurf:    d ? '#4e4e48' : '#ccc8bc',
    roadMark:    d ? '#6a6a60' : '#9a9488',
    nodeDot:     d ? '#5a5a54' : '#b8b3a8',
    grid:        d ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)',
    // tata kota
    building:    d ? '#2e2e2c' : '#a09888',
    buildingTop: d ? '#3a3a36' : '#b8ae9e',
    buildingWin: d ? '#4a6080' : '#7aa0c0',
    park:        d ? '#1e2e1a' : '#b8d4a8',
    parkTree:    d ? '#2a4020' : '#88b878',
    water:       d ? '#0e1e2e' : '#a8c4d4',
    waterRipple: d ? '#142030' : '#90b0c4',
    sidewalk:    d ? '#302e2a' : '#c8c0b0',
    // markers & objects
    flagG:       '#1D9E75',
    flagR:       '#D85A30',
    pathLine:    '#BA7517',
    objCar:      '#378ADD',
    objMoto:     '#D85A30',
    objBike:     '#1D9E75',
    objPed:      '#7F77DD',
  };
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
  nodes      = [];
  edges      = [];
  cityBlocks = [];

  const cols = 14;
  const rows = 11;
  const gw   = MAP_W / (cols + 1);
  const gh   = MAP_H / (rows + 1);

  // Tempatkan simpul dengan jitter koordinat
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push({
        id:  r * cols + c,
        x:   gw * (c + 1) + rnd(-gw * 0.3, gw * 0.3),
        y:   gh * (r + 1) + rnd(-gh * 0.3, gh * 0.3),
        adj: [],
      });
    }
  }

  // Spanning tree: horizontal + vertikal
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c < cols - 1) addEdge(i, r * cols + c + 1);
      if (r < rows - 1) addEdge(i, (r + 1) * cols + c);
    }
  }

  // Edge diagonal (~50% dari jumlah node) → jalan mayoritas tidak lurus
  const diagCount = Math.floor(nodes.length * 0.5);
  for (let k = 0; k < diagCount; k++) {
    const r = rndInt(0, rows - 2);
    const c = rndInt(0, cols - 2);
    const i = r * cols + c;
    addEdge(i, (r + 1) * cols + c + 1);
    if (Math.random() < 0.5) {
      addEdge(r * cols + c + 1, (r + 1) * cols + c);
    }
  }

  // Generate blok tata kota
  generateCityBlocks(cols, rows, gw, gh);

  randomPositions();
}

// ===================== CITY BLOCKS GENERATION =====================
/**
 * generateCityBlocks()
 * Mengisi ruang antara ruas jalan dengan tiga jenis blok:
 * - Bangunan (gedung bertingkat, ruko, rumah)
 * - Taman kota
 * - Perairan (danau, kolam)
 *
 * Blok ditempatkan di tengah-tengah sel grid (antara 4 node),
 * sehingga tidak menimpa jalan dan terlihat logis.
 */
function generateCityBlocks(cols, rows, gw, gh) {
  const rngType = makeRng(Math.floor(Math.random() * 9999));
  const rngSize = makeRng(Math.floor(Math.random() * 9999));
  const rngOff  = makeRng(Math.floor(Math.random() * 9999));

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      // Pusat sel (antara 4 node sudut sel ini)
      const n00 = nodes[r * cols + c];
      const n10 = nodes[r * cols + c + 1];
      const n01 = nodes[(r + 1) * cols + c];
      const n11 = nodes[(r + 1) * cols + c + 1];

      const cx = (n00.x + n10.x + n01.x + n11.x) / 4;
      const cy = (n00.y + n10.y + n01.y + n11.y) / 4;

      // Lebar & tinggi sel (jarak antar node)
      const cellW = Math.min(Math.abs(n10.x - n00.x), Math.abs(n11.x - n01.x));
      const cellH = Math.min(Math.abs(n01.y - n00.y), Math.abs(n11.y - n10.y));

      // Sisakan margin dari jalan (~30% tiap sisi)
      const margin  = 0.28;
      const maxBW   = cellW * (1 - margin * 2);
      const maxBH   = cellH * (1 - margin * 2);
      if (maxBW < 30 || maxBH < 30) continue;

      const t = rngType();

      if (t < 0.55) {
        // === BANGUNAN ===
        // Satu blok bisa berisi 1-4 bangunan yang tersusun
        const count = t < 0.25 ? 4 : t < 0.40 ? 2 : 1;
        generateBuildingCluster(cx, cy, maxBW, maxBH, count, rngSize, rngOff);

      } else if (t < 0.78) {
        // === TAMAN ===
        const pw = maxBW * (0.5 + rngSize() * 0.4);
        const ph = maxBH * (0.5 + rngSize() * 0.4);
        const ox = (rngOff() - 0.5) * maxBW * 0.2;
        const oy = (rngOff() - 0.5) * maxBH * 0.2;
        cityBlocks.push({
          type: 'park',
          x: cx - pw / 2 + ox,
          y: cy - ph / 2 + oy,
          w: pw, h: ph,
          treeCount: rndInt(3, 8),
          treeSeed: Math.floor(rngSize() * 9999),
        });

      } else {
        // === PERAIRAN ===
        const ww = maxBW * (0.4 + rngSize() * 0.35);
        const wh = maxBH * (0.4 + rngSize() * 0.35);
        const ox = (rngOff() - 0.5) * maxBW * 0.15;
        const oy = (rngOff() - 0.5) * maxBH * 0.15;
        cityBlocks.push({
          type: 'water',
          x: cx - ww / 2 + ox,
          y: cy - wh / 2 + oy,
          w: ww, h: wh,
        });
      }
    }
  }
}

function generateBuildingCluster(cx, cy, maxW, maxH, count, rngSize, rngOff) {
  if (count === 1) {
    const bw = maxW * (0.45 + rngSize() * 0.35);
    const bh = maxH * (0.45 + rngSize() * 0.35);
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
    type:  selectedType,
    x:     nodes[startNode].x,
    y:     nodes[startNode].y,
    angle: 0,
  };
}

// ===================== PATHFINDING (BFS) =====================
function computePath() {
  const prev = new Array(nodes.length).fill(-1);
  const vis  = new Array(nodes.length).fill(false);
  const q    = [startNode];
  vis[startNode] = true;
  while (q.length) {
    const cur = q.shift();
    if (cur === endNode) break;
    for (const nb of nodes[cur].adj) {
      if (!vis[nb]) { vis[nb] = true; prev[nb] = cur; q.push(nb); }
    }
  }
  path = [];
  let cur = endNode;
  while (cur !== -1) { path.unshift(cur); cur = prev[cur]; }
  buildPathPts();
}

// ===================== BEZIER =====================
function getEdgeControlPoint(A, B, seedIdx) {
  const mx   = (A.x + B.x) / 2;
  const my   = (A.y + B.y) / 2;
  const perp = Math.atan2(B.y - A.y, B.x - A.x) + Math.PI / 2;
  const seed = ((seedIdx * 7919) % 100 - 50) * 0.7;
  return { x: mx + Math.cos(perp) * seed, y: my + Math.sin(perp) * seed };
}

function buildPathPts() {
  pathPts = [];
  for (let i = 0; i < path.length - 1; i++) {
    const A  = nodes[path[i]];
    const B  = nodes[path[i + 1]];
    const cp = getEdgeControlPoint(A, B, i);
    for (let t = 0; t <= 1; t += 0.02) {
      const u = 1 - t;
      pathPts.push({
        x: u * u * A.x + 2 * u * t * cp.x + t * t * B.x,
        y: u * u * A.y + 2 * u * t * cp.y + t * t * B.y,
      });
    }
  }
}

function getEdgeCP(e) {
  const A    = nodes[e.a];
  const B    = nodes[e.b];
  const mx   = (A.x + B.x) / 2;
  const my   = (A.y + B.y) / 2;
  const perp = Math.atan2(B.y - A.y, B.x - A.x) + Math.PI / 2;
  const seed = (((e.a * 31 + e.b * 17) % 100) - 50) * 0.6;
  return { x: mx + Math.cos(perp) * seed, y: my + Math.sin(perp) * seed };
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
  const { x, y, w, h, floors } = b;

  // Bayangan bangunan (kesan kedalaman)
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(x + 4, y + 4, w, h);

  // Badan bangunan
  ctx.fillStyle = col.building;
  ctx.fillRect(x, y, w, h);

  // Variasi warna badan berdasarkan jumlah lantai
  const shade = Math.min(floors / 8, 1);
  ctx.fillStyle = `rgba(0,0,0,${shade * 0.25})`;
  ctx.fillRect(x, y, w, h);

  // Garis tepi bangunan
  ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.18)';
  ctx.lineWidth   = 1;
  ctx.strokeRect(x, y, w, h);

  // Atap (garis tipis di atas)
  ctx.fillStyle = col.buildingTop;
  ctx.fillRect(x, y, w, Math.max(4, h * 0.08));

  // Jendela — grid kecil di badan bangunan
  const winCols = Math.max(1, Math.floor(w / 14));
  const winRows = Math.max(1, Math.min(floors, Math.floor(h / 12)));
  const winW    = Math.max(4, (w - 6) / winCols - 3);
  const winH    = Math.max(3, (h - 14) / winRows - 3);
  const startX  = x + 4;
  const startY  = y + Math.max(6, h * 0.1);

  for (let wr = 0; wr < winRows; wr++) {
    for (let wc = 0; wc < winCols; wc++) {
      const wx = startX + wc * ((w - 4) / winCols);
      const wy = startY + wr * ((h - startY + y) / winRows);
      // Beberapa jendela menyala (acak tapi deterministik via posisi)
      const lit = ((wr * 7 + wc * 13) % 5) !== 0;
      ctx.fillStyle = lit ? col.buildingWin : 'rgba(0,0,0,0.3)';
      ctx.fillRect(wx, wy, winW, winH);
    }
  }
}

/**
 * drawPark()
 * Render taman dengan:
 * - Area hijau
 * - Pohon-pohon (lingkaran hijau dengan batang)
 * - Jalur taman (garis tipis)
 */
function drawPark(b, col) {
  const { x, y, w, h, treeCount, treeSeed } = b;

  // Area taman
  ctx.fillStyle = col.park;
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, 8);
  else ctx.rect(x, y, w, h);
  ctx.fill();

  // Border taman
  ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.10)';
  ctx.lineWidth   = 1;
  ctx.stroke();

  // Jalur taman (diagonal tipis)
  ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.2, y);
  ctx.lineTo(x,           y + h * 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + w * 0.8, y + h);
  ctx.lineTo(x + w,       y + h * 0.8);
  ctx.stroke();

  // Pohon-pohon
  const rng = makeRng(treeSeed);
  for (let i = 0; i < treeCount; i++) {
    const tx = x + rng() * w * 0.8 + w * 0.1;
    const ty = y + rng() * h * 0.8 + h * 0.1;
    const tr = Math.max(5, rng() * 12 + 6);

    // Batang pohon
    ctx.fillStyle = isDark() ? '#3a2a1a' : '#6a4a2a';
    ctx.fillRect(tx - 1.5, ty, 3, tr * 0.6);

    // Daun pohon (lingkaran)
    ctx.fillStyle = col.parkTree;
    ctx.beginPath();
    ctx.arc(tx, ty, tr, 0, Math.PI * 2);
    ctx.fill();

    // Highlight pohon (sisi terang)
    ctx.fillStyle = isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.arc(tx - tr * 0.2, ty - tr * 0.2, tr * 0.4, 0, Math.PI * 2);
    ctx.fill();
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

  // Area air
  ctx.fillStyle = col.water;
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, 12);
  else ctx.rect(x, y, w, h);
  ctx.fill();

  // Border air
  ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.4)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // Riak air (garis melengkung pendek)
  ctx.strokeStyle = col.waterRipple;
  ctx.lineWidth   = 1;
  const rippleCount = Math.max(2, Math.floor(h / 18));
  for (let i = 0; i < rippleCount; i++) {
    const ry   = y + (i + 0.5) * (h / rippleCount);
    const rLen = w * (0.2 + (i % 3) * 0.1);
    const rx   = x + (w - rLen) / 2;
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.quadraticCurveTo(rx + rLen / 2, ry - 4, rx + rLen, ry);
    ctx.stroke();
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
  ctx.beginPath();
  ctx.arc(x, y - 8 * s, 5 * s, 0, Math.PI * 2);
  ctx.fill();
}

// ===================== DRAWING: MOVING OBJECT =====================
function drawMovingObj(obj) {
  const col = getColors();
  ctx.save();
  ctx.translate(obj.x, obj.y);
  ctx.rotate(obj.angle);
  const s = 1 / zoom;

  if (obj.type === 'car') {
    // Bodi mobil
    ctx.fillStyle = col.objCar;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-13 * s, -7 * s, 26 * s, 14 * s, 3 * s);
    else ctx.rect(-13 * s, -7 * s, 26 * s, 14 * s);
    ctx.fill();
    // Kaca depan
    ctx.fillStyle = 'rgba(200,230,255,0.85)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-4 * s, -6 * s, 11 * s, 5 * s, 1 * s);
    else ctx.rect(-4 * s, -6 * s, 11 * s, 5 * s);
    ctx.fill();
    // Roda
    ctx.fillStyle = '#1a1a1a';
    for (const [wx, wy] of [[-8, 7], [-8, -7], [8, 7], [8, -7]]) {
      ctx.beginPath(); ctx.arc(wx * s, wy * s, 3.5 * s, 0, Math.PI * 2); ctx.fill();
    }
    // Lampu depan
    ctx.fillStyle = '#FFD700';
    ctx.beginPath(); ctx.arc(13 * s, 0, 2 * s, 0, Math.PI * 2); ctx.fill();

  } else if (obj.type === 'moto') {
    ctx.fillStyle = col.objMoto;
    ctx.beginPath(); ctx.ellipse(0, 0, 10 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(-9 * s, 4 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc( 9 * s, 4 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col.objMoto;
    ctx.beginPath(); ctx.arc(0, -9 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#444';
    ctx.beginPath(); ctx.arc(0, -9 * s, 5 * s, Math.PI, Math.PI * 2); ctx.fill();

  } else if (obj.type === 'bike') {
    ctx.strokeStyle = col.objBike;
    ctx.lineWidth   = 2 * s;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.arc(-8 * s, 5 * s, 6 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc( 8 * s, 5 * s, 6 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-8 * s, 5 * s); ctx.lineTo(0, -5 * s); ctx.lineTo(8 * s, 5 * s);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -5 * s); ctx.lineTo(0, -12 * s); ctx.stroke();
    ctx.fillStyle = col.objBike;
    ctx.beginPath(); ctx.arc(0, -14 * s, 4 * s, 0, Math.PI * 2); ctx.fill();

  } else {
    // Pejalan kaki dengan animasi langkah
    ctx.fillStyle = col.objPed;
    ctx.beginPath(); ctx.arc(0, -14 * s, 4.5 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col.objPed;
    ctx.lineWidth   = 2.5 * s;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.moveTo(0, -9 * s); ctx.lineTo(0, 3 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-7 * s, -3 * s); ctx.lineTo(7 * s, -3 * s); ctx.stroke();
    const legSwing = Math.sin(animT * 0.3) * 8 * s;
    ctx.beginPath(); ctx.moveTo(0, 3 * s); ctx.lineTo(-legSwing, 13 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 3 * s); ctx.lineTo( legSwing, 13 * s); ctx.stroke();
  }

  ctx.restore();
}

// ===================== DRAWING: FULL MAP =====================
function drawMap() {
  const col = getColors();
  ctx.save();
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = col.bg;
  ctx.fillRect(0, 0, W, H);

  // Grid halus
  ctx.strokeStyle = col.grid;
  ctx.lineWidth   = 1;
  const gs = 100 * zoom;
  const ox = ((-camX * zoom) + W / 2) % gs;
  const oy = ((-camY * zoom) + H / 2) % gs;
  for (let x = ox; x < W; x += gs) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = oy; y < H; y += gs) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Masuk koordinat dunia
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

  // 1. Trotoar (paling bawah, di bawah bangunan)
  drawSidewalks();

  // 2. Blok tata kota (bangunan, taman, air)
  drawCityBlocks();

  // 3. Lapisan tepi jalan (gelap)
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  for (const e of edges) {
    const A  = nodes[e.a];
    const B  = nodes[e.b];
    const cp = getEdgeCP(e);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.quadraticCurveTo(cp.x, cp.y, B.x, B.y);
    ctx.strokeStyle = col.road;
    ctx.lineWidth   = 20;
    ctx.stroke();
  }

  // 4. Permukaan jalan (lebih terang)
  for (const e of edges) {
    const A  = nodes[e.a];
    const B  = nodes[e.b];
    const cp = getEdgeCP(e);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.quadraticCurveTo(cp.x, cp.y, B.x, B.y);
    ctx.strokeStyle = col.roadSurf;
    ctx.lineWidth   = 14;
    ctx.stroke();
  }

  // 5. Marka garis tengah jalan (putus-putus)
  ctx.setLineDash([14, 14]);
  for (const e of edges) {
    const A  = nodes[e.a];
    const B  = nodes[e.b];
    const cp = getEdgeCP(e);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.quadraticCurveTo(cp.x, cp.y, B.x, B.y);
    ctx.strokeStyle = col.roadMark;
    ctx.lineWidth   = 1.5;
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 6. Highlight jalur BFS
  if (pathPts.length > 1) {
    ctx.beginPath();
    ctx.moveTo(pathPts[0].x, pathPts[0].y);
    for (let i = 1; i < pathPts.length; i++) ctx.lineTo(pathPts[i].x, pathPts[i].y);
    ctx.strokeStyle = col.pathLine;
    ctx.lineWidth   = 6;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.setLineDash([16, 10]);
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  // 7. Persimpangan (node dots)
  for (const n of nodes) {
    ctx.beginPath();
    ctx.arc(n.x, n.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = col.roadSurf;
    ctx.fill();
    ctx.strokeStyle = col.road;
    ctx.lineWidth   = 1.5;
    ctx.stroke();
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
}

// ===================== EVENT LISTENERS =====================
canvas.addEventListener('mousedown', e => {
  dragging = true; lastMX = e.clientX; lastMY = e.clientY;
  canvas.classList.add('grabbing');
});
canvas.addEventListener('mousemove', e => {
  if (!dragging) return;
  camX -= (e.clientX - lastMX) / zoom;
  camY -= (e.clientY - lastMY) / zoom;
  clampCam(); lastMX = e.clientX; lastMY = e.clientY;
});
canvas.addEventListener('mouseup',    () => { dragging = false; canvas.classList.remove('grabbing'); });
canvas.addEventListener('mouseleave', () => { dragging = false; canvas.classList.remove('grabbing'); });

canvas.addEventListener('wheel', e => {
  e.preventDefault();
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
    type:  selectedType,
    x:     pathPts[0] ? pathPts[0].x : nodes[startNode].x,
    y:     pathPts[0] ? pathPts[0].y : nodes[startNode].y,
    angle: 0,
  };
  document.getElementById('btn-start').style.display = 'none';
  document.getElementById('btn-pause').style.display = '';
});

document.getElementById('btn-pause').addEventListener('click', () => {
  animPaused = !animPaused;
  document.getElementById('btn-pause').textContent = animPaused ? '▶ Resume' : '⏸ Pause';
});

window.addEventListener('resize', () => {
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W; canvas.height = H;
});

// ===================== MAIN LOOP =====================
function loop() {
  stepAnim();
  drawMap();
  requestAnimationFrame(loop);
}

// ===================== INIT =====================
generateMap();
camX = MAP_W / 2;
camY = MAP_H / 2;
setZoom(0.18);
loop();