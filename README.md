# 🗺 CityRoute — Peta Spasial Perkotaan

> **Final Project — Grafika Komputer INF11114**  
> Universitas Maritim Raja Ali Haji · Semester 4 · 2026

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-02C39A?style=flat-square&logo=github)](https://raihan2407.github.io/cityroute)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![HTML5 Canvas](https://img.shields.io/badge/HTML5-Canvas%20API-E34F26?style=flat-square&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

---

## 📸 Preview

![CityRoute 2D](https://raw.githubusercontent.com/Raihan2407/cityroute/main/preview_2d.png)
> *Tampilan 2D — Peta spasial dengan jalur A\* dan animasi kendaraan*

![CityRoute 3D](https://raw.githubusercontent.com/Raihan2407/cityroute/main/preview_3d.png)
> *Tampilan 3D — Ekstrusi bangunan dengan Painter's Algorithm dan sky gradient*

---

## ✨ Fitur Utama

| Fitur | Deskripsi |
|-------|-----------|
| 🔀 **Acak Peta** | Generate peta kota baru secara acak — semua jalan selalu terhubung |
| 📍 **Acak Posisi** | Acak titik awal & tujuan tanpa mereset peta |
| 🔍 **Zoom & Scroll** | Zoom berbasis vektor tanpa kehilangan kualitas — peta 6000×5000 unit |
| ▶ **Start / Pause** | Animasi kendaraan dari titik A ke B mengikuti jalur A* |
| 🚗 **4 Kendaraan** | Mobil, Motor, Sepeda, Pejalan Kaki — kecepatan & rendering berbeda |
| 🧊 **Mode 3D** | Perspektif 3D lengkap dengan Orbit Camera & sky gradient |
| 🗺 **Minimap** | Peta mini dengan viewport indicator real-time |
| 🌡 **Heatmap** | Visualisasi kepadatan persimpangan dengan HSL color mapping |
| ⌨️ **Keyboard Shortcut** | `R` acak peta · `Space` start/pause · `P` acak posisi · `+/-` zoom |

---

## 🚀 Cara Menjalankan

### Online
Buka langsung di browser: **[https://raihan2407.github.io/cityroute](https://raihan2407.github.io/cityroute)**

### Lokal
```bash
# Clone repository
git clone https://github.com/Raihan2407/cityroute.git
cd cityroute

# Buka dengan Live Server (VS Code) atau server apapun
# Tidak ada dependencies — pure HTML/CSS/JS
open index.html
```

> ⚠️ Buka via server (Live Server / http-server), bukan double-click file HTML langsung, untuk menghindari CORS issue.

---

## 🎮 Cara Penggunaan

```
🔀 Acak Peta     — Generate peta baru
📍 Acak Posisi   — Pindah bendera start/end
🔍 - / +         — Zoom out / Zoom in
🚗 Dropdown      — Pilih tipe kendaraan
▶  Start         — Mulai animasi
⏸  Pause         — Jeda animasi
🧊 Mode 3D       — Toggle tampilan 3D
🌡 Heatmap       — Toggle traffic heatmap
🐢🐇 Slider      — Kontrol kecepatan 0.2× – 4×
```

**Keyboard Shortcuts:**
| Tombol | Aksi |
|--------|------|
| `R` | Acak peta |
| `Space` | Start / Pause |
| `P` | Acak posisi |
| `+` / `-` | Zoom in / out |

**Mouse / Touch:**
- **Drag** — Geser peta
- **Scroll** — Zoom
- **Mode 3D: Drag** — Orbit camera
- **Mode 3D: Alt+Drag** — Pan
- **Mode 3D: Scroll** — Zoom in/out

---

## 👥 Tim Pengembang

| Nama | NIM | Kontribusi |
|------|-----|------------|
| **Raihan Darma Putra** | 2401020138 | A* Pathfinding · MVP Matrix 3D · Orbit Camera · Integrasi Final |
| Alman | — | Bresenham Line · Midpoint Circle · Minimap |
| Neza | — | Bezier Curve · buildPathPts · Speed Control |
| Elsa | — | Map Generation · PRNG · Diagonal Edge |
| Amaa | — | Animasi Kendaraan · Ekstrusi 3D · Heatmap |

---

## 📚 Referensi

1. Hart, P. E., Nilsson, N. J., & Raphael, B. (1968). A Formal Basis for the Heuristic Determination of Minimum Cost Paths. *IEEE Transactions on Systems Science and Cybernetics*, 4(2), 100–107.
2. Foley, J. D., van Dam, A., Feiner, S. K., & Hughes, J. F. (1995). *Computer Graphics: Principles and Practice* (2nd ed.). Addison-Wesley.
3. Shirley, P., & Marschner, S. (2021). *Fundamentals of Computer Graphics* (5th ed.). CRC Press.
4. Patel, A. (2024). Introduction to A*. Red Blob Games. https://www.redblobgames.com/pathfinding/a-star/introduction.html
5. Stern, G. (2022). WebGL2 Fundamentals. https://webgl2fundamentals.org

---

## 📄 Lisensi

```
© Project Computer Graphics Course 2026
Universitas Maritim Raja Ali Haji
```

Project ini dibuat untuk keperluan akademis mata kuliah Grafika Komputer INF11114.

---

<div align="center">
  <sub>Built with ❤️ using pure HTML5 Canvas API · No external graphics libraries</sub>
</div>
