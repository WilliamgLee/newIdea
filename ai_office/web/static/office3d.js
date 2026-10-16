// Kiki Classroom - kantor 3D voxel (gaya balok, Three.js). Kembaran office.js: layout ruangan,
// data agent, dan teks log diambil dari sana supaya 2D & 3D selalu sama. Semua tekstur dibuat
// sendiri lewat kode (pixel 16x16 per balok 0,5 unit) - tidak ada aset/tekstur pihak lain.
// Tahap 1: gedung, ruangan & perabot statis, kamera bebas (putar/geser/zoom), klik ruangan.
"use strict";

import * as THREE from "/static/vendor/three.module.min.js";
import { AGENTS, ROOMS, RUGS, drawText, planJobEvent, skyKey } from "/static/office.js";
import { sfx } from "/static/sfx.js";

// ------------------------------------------------------------------ dunia
// 1 unit = 1 ubin grid office.js (x = gx, z = gy), y ke atas. Lantai atas di y = 0.
const B = 0.5; // ukuran satu balok voxel (satu tekstur 16x16)
const WALL_H = 2.5;
const LOW_H = 0.5;
const GF = 3; // tinggi lantai dasar; jalan ada di y = -GF
const DOOR_Z0 = 8.7; // pintu samping (dinding kiri, ruang pengirim) untuk tangga luar
const DOOR_Z1 = 9.7;
const FOV = 30;
const ISO = { theta: Math.PI / 4, phi: 0.98, radius: 31, target: [9, -0.7, 5.4] };
const LIMIT = { phiMin: 0.12, phiMax: 1.48, rMin: 5, rMax: 70 };

// mode jelajah (orang pertama). Ukuran pemain setara karakter agent (~0,95 unit).
const PLAYER = { r: 0.16, h: 0.9, eye: 0.8, walk: 2.1, run: 3.6, fly: 4.5, jump: 4.4, gravity: 16, step: 0.27 };
const SPAWN = { x: 1.0, y: 0.03, z: 5.0, yaw: -Math.PI / 2 };

const EXPLORE_HELP = [
  "WASD / PANAH: JALAN",
  "MOUSE: LIHAT SEKITAR",
  "SPASI: LOMPAT  SHIFT: LARI",
  "F: TERBANG (SPASI NAIK, C TURUN)",
  "R: KEMBALI KE LORONG",
  "KLIK: SAPA AGENT  ESC: LEPAS MOUSE",
].join("\n");

const STATE_COLOR = { working: "#f2d47a", just_done: "#7fc28a", idle: "#82a0bd", offline: "#6b7280" };
// suasana langit per waktu (kunci sama dengan skyKey() di office.js: jam asli atau ?sky=)
const SKY3D = {
  day: { bg: "#bfe2ef", hemiSky: "#eaf6ff", hemiGround: "#a89478", hemi: 1.5, sun: "#fff4e0", sunI: 1.6,
    sunPos: [19, 18, 19], body: "#fff3b0", lamps: 0, stars: false, skyGlass: "#ffffff", shop: 0 },
  dusk: { bg: "#f2b98a", hemiSky: "#ffd9b8", hemiGround: "#7a5a50", hemi: 1.1, sun: "#ffb070", sunI: 1.3,
    sunPos: [28, 7, 10], body: "#ffcf7a", lamps: 0.5, stars: false, skyGlass: "#f6c9a8", shop: 0.35 },
  night: { bg: "#141a33", hemiSky: "#5a6aa8", hemiGround: "#2a2630", hemi: 0.5, sun: "#a9bcff", sunI: 0.4,
    sunPos: [-8, 20, 14], body: "#e8ecff", lamps: 1, stars: true, skyGlass: "#3a4a7a", shop: 1 },
};
const SHOP_GLASS = "glass:#c8e6f0"; // kaca fasad toko: berpendar hangat di malam hari
const BANNER_COLOR = { blue: "#82a0bd", green: "#7fc28a", red: "#d9776b" };
const GLYPH = { voice: "@", animator: "*", writer: ".", safety: "?" };

const ITEM_COLOR = {
  script: "#f1f0ec", checked: "#7fc28a", revise: "#d9776b", cassette: "#f2d47a", reel: "#b39ddb",
  tape: "#3f6f9f", box: "#d8a46e", stamped: "#e5566c", envelope: "#fffaf0",
};

// ------------------------------------------------------------------ util warna & acak
function tint(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  return `#${((1 << 24) | (f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1)}`;
}

// PRNG berbiji (mulberry32) supaya tekstur selalu sama di tiap muat ulang
function rng(seed) {
  let a = 2166136261;
  for (const ch of seed) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ tekstur pixel 16x16
function px(g, x, y, c, w = 1, h = 1) {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}

function noise(g, r, base, amt = 0.06, x0 = 0, y0 = 0, w = 16, h = 16) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) px(g, x, y, tint(base, (r() - 0.5) * 2 * amt));
  }
}

function planks(g, r, base, vertical = false) {
  for (let row = 0; row < 4; row++) {
    const a = row * 4;
    const joint = [3, 11, 7, 14][row];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 16; j++) {
        const c = tint(base, (r() - 0.5) * 0.08 + (i === 3 ? -0.2 : 0) + (i === 0 ? 0.05 : 0));
        if (vertical) px(g, a + i, j, c);
        else px(g, j, a + i, c);
      }
    }
    const dark = tint(base, -0.24);
    if (vertical) px(g, a, joint, dark, 3, 1);
    else px(g, joint, a, dark, 1, 3);
    const gx = Math.floor(r() * 12);
    if (vertical) px(g, a + 1, gx, tint(base, -0.1), 1, 3);
    else px(g, gx, a + 1, tint(base, -0.1), 3, 1);
  }
}

function books(g, r, colors, rim) {
  planks(g, r, rim);
  for (const y0 of [2, 9]) {
    let x = 1;
    while (x < 15) {
      const w = Math.min(15 - x, 1 + Math.floor(r() * 2));
      const top = y0 + Math.floor(r() * 2);
      const c = colors[Math.floor(r() * colors.length)];
      px(g, x, y0, tint(rim, -0.35), w, 5);
      px(g, x, top, c, w, y0 + 5 - top);
      px(g, x, top, tint(c, 0.2), 1, y0 + 5 - top);
      x += w;
    }
  }
}

const TEX = {
  flat: (g, r, c = "#ff00ff") => noise(g, r, c, 0.03),
  planks: (g, r, c = "#d7a06e") => planks(g, r, c),
  vplanks: (g, r, c = "#9a6240") => planks(g, r, c, true),
  // parket anyaman (basketweave) untuk lorong
  weave: (g, r, c = "#e3c79c") => {
    for (let q = 0; q < 4; q++) {
      const ox = (q % 2) * 8;
      const oy = Math.floor(q / 2) * 8;
      const horiz = q === 0 || q === 3;
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          const band = Math.floor((horiz ? i : j) / 2);
          const edge = (horiz ? i : j) % 2 === 1 && band % 2 === 1;
          px(g, ox + j, oy + i, tint(c, (band % 2 ? -0.05 : 0.04) + (edge ? -0.1 : 0) + (r() - 0.5) * 0.05));
        }
      }
    }
  },
  wp: (g, r, which) => {
    const W = {
      pink: ["#f5d9c9", "#eec8b6", "#e6b4a0"],
      mint: ["#dcefe0", "#cbe3d0", "#b6d6bd"],
      sage: ["#e4e8d2", "#d5dcbe", null],
      cream: ["#f8ecd2", null, "#e9d3a6"],
    }[which] || ["#f8ecd2", null, null];
    noise(g, r, W[0], 0.015);
    if (W[1]) for (const x of [0, 8]) px(g, x, 0, W[1], 3, 16);
    if (W[2]) for (const [x, y] of [[5, 3], [5, 11], [13, 7], [13, 15]]) px(g, x, y, W[2]);
  },
  plaster: (g, r) => {
    noise(g, r, "#f2d68f", 0.04);
    for (let i = 0; i < 5; i++) px(g, Math.floor(r() * 15), Math.floor(r() * 16), "#e6c77c", 2, 1);
  },
  cream: (g, r) => noise(g, r, "#fff6ea", 0.025),
  // bata krem untuk sekat rendah
  brick: (g, r) => {
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 16; j++) {
          const joint = (j + (row % 2) * 4) % 8 === 0;
          px(g, j, row * 4 + i, i === 3 || joint ? "#dbbca7" : tint("#f3dfcf", (r() - 0.5) * 0.06));
        }
      }
    }
  },
  // batu bulat (jalan): sel Voronoi dengan tepi gelap
  cobble: (g, r) => {
    const seeds = [];
    for (let i = 0; i < 7; i++) seeds.push([r() * 16, r() * 16, ["#b4aca0", "#c8c0b3", "#a39a8d", "#d2cabd"][i % 4]]);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let d1 = 1e9;
        let d2 = 1e9;
        let col = "#999";
        for (const [sx, sy, c] of seeds) {
          for (const [ox, oy] of [[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]]) {
            const d = Math.hypot(x + 0.5 - sx - ox, y + 0.5 - sy - oy);
            if (d < d1) { d2 = d1; d1 = d; col = c; } else if (d < d2) d2 = d;
          }
        }
        px(g, x, y, d2 - d1 < 1.1 ? "#7d7468" : tint(col, (r() - 0.5) * 0.08));
      }
    }
  },
  pave: (g, r) => {
    noise(g, r, "#e4ddcf", 0.03);
    px(g, 0, 0, "#cfc6b6", 16, 1);
    px(g, 0, 8, "#cfc6b6", 16, 1);
    px(g, 0, 0, "#cfc6b6", 1, 16);
    px(g, 8, 0, "#cfc6b6", 1, 16);
  },
  stone: (g, r, c = "#bcae9c") => {
    noise(g, r, c, 0.07);
    px(g, 0, 15, tint(c, -0.2), 16, 1);
    px(g, 0, 7, tint(c, -0.12), 16, 1);
    px(g, 5, 0, tint(c, -0.12), 1, 7);
    px(g, 12, 8, tint(c, -0.12), 1, 7);
  },
  leaves: (g, r) => {
    const cs = ["#4f8746", "#5f9a52", "#5f9a52", "#6fae5f", "#86c46f"];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) px(g, x, y, r() < 0.08 ? "#3f6d3a" : cs[Math.floor(r() * cs.length)]);
    }
  },
  log: (g, r) => {
    for (let x = 0; x < 16; x++) {
      const c = ["#7a5236", "#6a4630", "#8a5f3f"][Math.floor(r() * 3)];
      for (let y = 0; y < 16; y++) px(g, x, y, tint(c, (r() - 0.5) * 0.08));
    }
  },
  logtop: (g, r) => {
    noise(g, r, "#b88a5c", 0.04);
    for (const [s, c] of [[0, "#7a5236"], [3, "#a37850"], [6, "#c49a6c"]]) {
      g.strokeStyle = c;
      g.lineWidth = 1;
      g.strokeRect(s + 0.5, s + 0.5, 15 - 2 * s, 15 - 2 * s);
    }
  },
  glass: (g, r, c = "#bfe2ef") => {
    for (let y = 0; y < 16; y++) px(g, 0, y, tint(c, (8 - y) * 0.01), 16, 1);
    for (const [x, y] of [[3, 4], [4, 3], [5, 2], [9, 9], [10, 8], [9, 10]]) px(g, x, y, "#ffffff");
    px(g, 0, 0, "#f4fbfd", 16, 1);
    px(g, 0, 15, "#f4fbfd", 16, 1);
    px(g, 0, 0, "#f4fbfd", 1, 16);
    px(g, 15, 0, "#f4fbfd", 1, 16);
  },
  wool: (g, r, c = "#e8a0bf") => {
    noise(g, r, c, 0.05);
    for (let i = 0; i < 10; i++) px(g, Math.floor(r() * 15), Math.floor(r() * 15), tint(c, -0.08), 2, 1);
  },
  foam: (g) => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const base = (x + y) % 2 ? "#4a4f63" : "#5a6078";
        px(g, x * 4, y * 4, base, 4, 4);
        px(g, x * 4 + 1, y * 4 + 1, tint(base, 0.18), 2, 1);
      }
    }
  },
  metal: (g, r, c = "#a9b4bf") => {
    noise(g, r, c, 0.03);
    px(g, 0, 15, tint(c, -0.2), 16, 1);
    px(g, 15, 0, tint(c, -0.2), 1, 16);
    px(g, 0, 0, tint(c, 0.15), 16, 1);
  },
  cabinet: (g, r) => {
    noise(g, r, "#a9b4bf", 0.03);
    px(g, 1, 1, "#c8d1da", 14, 13);
    px(g, 1, 14, "#76818d", 14, 1);
    px(g, 6, 4, "#5a6270", 4, 1);
  },
  speaker: (g, r) => {
    noise(g, r, "#3d4253", 0.04);
    px(g, 4, 4, "#9aa3ad", 8, 8);
    px(g, 5, 5, "#5a6270", 6, 6);
    px(g, 7, 7, "#3d2a26", 2, 2);
  },
  rail: (g, r) => {
    noise(g, r, "#6f9d7e", 0.04);
    for (const x of [1, 6, 11]) { px(g, x, 0, "#b6dab8", 3, 16); px(g, x, 0, "#cfe9cf", 1, 16); }
  },
  band: (g, r) => {
    noise(g, r, "#8fc29b", 0.03);
    px(g, 0, 0, "#c6e6c6", 16, 3);
    px(g, 0, 15, "#5d8a6c", 16, 1);
  },
  awning: (g) => {
    for (let x = 0; x < 16; x += 8) { px(g, x, 0, "#e98f85", 4, 16); px(g, x + 4, 0, "#fff4e4", 4, 16); }
  },
  books: (g, r) => books(g, r, ["#e5566c", "#82a0bd", "#f2d47a", "#7fc28a", "#b39ddb", "#e8a0bf"], "#a46f45"),
  tapes: (g, r) => books(g, r, ["#22252a", "#3f6f9f", "#e5566c", "#22252a"], "#a46f45"),
  cardboard: (g, r) => {
    noise(g, r, "#e1ac74", 0.04);
    px(g, 7, 0, "#f2d47a", 2, 16);
    px(g, 0, 0, "#c99560", 16, 1);
  },
  pot: (g, r) => {
    noise(g, r, "#d98a6a", 0.04);
    px(g, 0, 0, "#f0a888", 16, 3);
    px(g, 0, 15, "#b56e52", 16, 1);
  },
  cork: (g, r) => {
    noise(g, r, "#d8b07a", 0.08);
    for (const [x, y, c] of [[2, 2, "#fffaf0"], [9, 4, "#f2d47a"], [4, 9, "#bfe3c7"], [10, 11, "#f5d9c9"]]) {
      px(g, x, y, c, 4, 4);
      px(g, x + 1, y, "#e5566c");
    }
  },
  chalk: (g, r) => {
    noise(g, r, "#3f7a57", 0.03);
    for (const [x, y] of [[4, 8], [5, 9], [6, 10], [7, 9], [8, 8], [9, 7], [10, 6], [11, 5]]) px(g, x, y, "#e8f4ea");
  },
  keys: (g) => {
    px(g, 0, 0, "#cfc7b8", 16, 16);
    for (let y = 1; y < 16; y += 4) for (let x = 1; x < 16; x += 3) px(g, x, y, "#efe9dd", 2, 3);
  },
  cooler: (g, r) => {
    noise(g, r, "#eef1f4", 0.02);
    px(g, 4, 6, "#e5566c", 2, 2);
    px(g, 10, 6, "#82a0bd", 2, 2);
  },
  water: (g, r) => {
    noise(g, r, "#9cc7e6", 0.03);
    px(g, 2, 0, "#c9e2f5", 2, 16);
  },
  painting: (g) => {
    px(g, 0, 0, "#fffaf0", 16, 16);
    px(g, 0, 10, "#9cc7a4", 16, 6);
    px(g, 10, 2, "#f2d47a", 4, 4);
    px(g, 3, 6, "#e5566c", 5, 4);
    px(g, 0, 0, "#3d2a26", 16, 1);
    px(g, 0, 15, "#3d2a26", 16, 1);
  },
  lamp: (g, r, c = "#fff3d0") => {
    noise(g, r, c, 0.02);
    px(g, 0, 0, "#ffffff", 16, 2);
  },
};

function pixelTexture(canvas, repeat = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    t.anisotropy = 4;
  } else {
    t.generateMipmaps = false;
    t.minFilter = THREE.NearestFilter;
  }
  return t;
}

// nama tekstur "jenis:argumen", mis. "planks:#c8915f", "wool:#e8a0bf", "wp:pink"
function makeTexture(name) {
  const i = name.indexOf(":");
  const kind = i < 0 ? name : name.slice(0, i);
  const arg = i < 0 ? undefined : name.slice(i + 1);
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  (TEX[kind] || TEX.flat)(c.getContext("2d"), rng(name), arg);
  return pixelTexture(c);
}

// Papan nama: teks font pixel 3x5 (dari office.js) di kanvas kecil, dipasang di sebuah bidang.
function textPlate(text, w, h, { ink, bg, border }) {
  const H = 7;
  const pix = h / H;
  const tw = Math.max(0, String(text).length * 4 - 1);
  const W = Math.max(tw + 4, Math.round(w / pix));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  px(g, 0, 0, border || bg, W, H);
  if (border) px(g, 1, 1, bg, W - 2, H - 2);
  drawText(g, text, Math.floor((W - tw) / 2), 1, ink);
  const mat = new THREE.MeshLambertMaterial({ map: pixelTexture(c, false) });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

// ------------------------------------------------------------------ penyusun balok
// Tiap sisi balok diberi UV sesuai koordinat dunia (bukan 0..1), jadi tekstur 16x16 selalu
// tampil sebagai balok 0,5 unit yang tersambung rapi antar balok - seperti dunia voxel.
const FACES = {
  px: { n: [1, 0, 0], c: (b) => [[b[3], b[1], b[5]], [b[3], b[1], b[2]], [b[3], b[4], b[2]], [b[3], b[4], b[5]]], uv: (p) => [-p[2], p[1]] },
  nx: { n: [-1, 0, 0], c: (b) => [[b[0], b[1], b[2]], [b[0], b[1], b[5]], [b[0], b[4], b[5]], [b[0], b[4], b[2]]], uv: (p) => [p[2], p[1]] },
  py: { n: [0, 1, 0], c: (b) => [[b[0], b[4], b[5]], [b[3], b[4], b[5]], [b[3], b[4], b[2]], [b[0], b[4], b[2]]], uv: (p) => [p[0], -p[2]] },
  ny: { n: [0, -1, 0], c: (b) => [[b[0], b[1], b[2]], [b[3], b[1], b[2]], [b[3], b[1], b[5]], [b[0], b[1], b[5]]], uv: (p) => [p[0], p[2]] },
  pz: { n: [0, 0, 1], c: (b) => [[b[0], b[1], b[5]], [b[3], b[1], b[5]], [b[3], b[4], b[5]], [b[0], b[4], b[5]]], uv: (p) => [p[0], p[1]] },
  nz: { n: [0, 0, -1], c: (b) => [[b[3], b[1], b[2]], [b[0], b[1], b[2]], [b[0], b[4], b[2]], [b[3], b[4], b[2]]], uv: (p) => [-p[0], p[1]] },
};
const FIT_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

class Builder {
  constructor() {
    this.groups = new Map();
    this.layer = "main";
    this.solids = []; // kotak tabrakan [x0,y0,z0,x1,y1,z1] untuk mode jelajah
  }

  // mat: nama tekstur, atau { top, bottom, side, px, nx, py, ny, pz, nz }
  box(x0, y0, z0, x1, y1, z1, mat, opts = {}) {
    const b = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
    if (opts.solid !== false) this.solids.push(b);
    for (const [key, f] of Object.entries(FACES)) {
      if (opts.skip && opts.skip.includes(key)) continue;
      const name = typeof mat === "string" ? mat
        : mat[key] || (key === "py" ? mat.top : key === "ny" ? mat.bottom : null) || mat.side || mat.top;
      const gk = `${opts.layer || this.layer}|${name}`;
      if (!this.groups.has(gk)) this.groups.set(gk, { pos: [], nor: [], uv: [], idx: [] });
      const g = this.groups.get(gk);
      const base = g.pos.length / 3;
      f.c(b).forEach((p, i) => {
        g.pos.push(p[0], p[1], p[2]);
        g.nor.push(...f.n);
        const uv = opts.fit ? FIT_UV[i] : f.uv(p).map((v) => v / B);
        g.uv.push(uv[0], uv[1]);
      });
      g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  build(matFor) {
    const layers = {};
    for (const [gk, g] of this.groups) {
      const [layer, name] = gk.split("|");
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(g.nor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setIndex(g.idx);
      const mesh = new THREE.Mesh(geo, matFor(name));
      mesh.castShadow = !name.startsWith("glow:");
      mesh.receiveShadow = true;
      if (!layers[layer]) layers[layer] = new THREE.Group();
      layers[layer].add(mesh);
    }
    return layers;
  }
}

// ------------------------------------------------------------------ karakter balok
// Kepala bertekstur pixel (wajah, rambut, kacamata) + badan/lengan/kaki balok berwarna agent.
// Lengan, kaki, dan kepala punya titik putar sendiri supaya bisa duduk, mengetik, dan bersorak.
function faceMaterial(draw) {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  draw(c.getContext("2d"));
  return new THREE.MeshLambertMaterial({ map: pixelTexture(c, false) });
}

function headMaterials(def) {
  const skin = def.skin || "#f2c9a5";
  const hair = def.hair;
  const ink = "#3d2a26";
  const front = faceMaterial((g) => {
    px(g, 0, 0, skin, 16, 16);
    px(g, 0, 0, hair, 16, 4);
    px(g, 0, 4, hair, 2, 3);
    px(g, 14, 4, hair, 2, 3);
    px(g, 5, 3, tint(hair, 0.15), 3, 1);
    if (def.acc === "glasses") {
      for (const x of [3, 9]) {
        px(g, x, 7, def.accColor || "#22252a", 4, 4);
        px(g, x + 1, 8, "#dfeef5", 2, 2);
        px(g, x + 1, 9, ink);
      }
      px(g, 7, 8, def.accColor || "#22252a", 2, 1);
    } else {
      px(g, 4, 8, ink, 2, 2);
      px(g, 10, 8, ink, 2, 2);
      px(g, 4, 8, "#fffaf0");
      px(g, 10, 8, "#fffaf0");
    }
    px(g, 2, 11, "#f2a5a0", 2, 1);
    px(g, 12, 11, "#f2a5a0", 2, 1);
    px(g, 7, 12, "#d9776b", 2, 1);
  });
  // sisi +x: kiri tekstur = depan wajah; sisi -x: kanan tekstur = depan
  const side = (backLeft) => faceMaterial((g) => {
    px(g, 0, 0, skin, 16, 16);
    px(g, 0, 0, hair, 16, 6);
    px(g, backLeft ? 0 : 8, 6, hair, 8, 6);
    px(g, backLeft ? 9 : 5, 8, tint(skin, -0.12), 2, 3);
  });
  const back = faceMaterial((g) => {
    px(g, 0, 0, hair, 16, 13);
    px(g, 0, 13, skin, 16, 3);
    px(g, 3, 4, tint(hair, 0.12), 4, 1);
  });
  const top = faceMaterial((g) => {
    px(g, 0, 0, hair, 16, 16);
    px(g, 4, 5, tint(hair, 0.12), 6, 2);
  });
  const bottom = faceMaterial((g) => px(g, 0, 0, skin, 16, 16));
  return [side(false), side(true), top, bottom, front, back]; // urutan BoxGeometry: px nx py ny pz nz
}

function makeCharacter(def, mat) {
  const part = (w, h, d, color, x, y, z, parent) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === "string" ? mat(color) : color);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const pivot = (x, y, z, parent) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const skin = def.skin || "#f2c9a5";
  const pants = def.pants || "#4b4f5c";
  const root = new THREE.Group();
  const legs = [-0.07, 0.07].map((x) => {
    const hip = pivot(x, 0.32, 0, root);
    part(0.12, 0.28, 0.14, pants, 0, -0.14, 0, hip);
    part(0.13, 0.05, 0.17, "#3d2a26", 0, -0.3, 0.015, hip);
    return hip;
  });
  part(0.3, 0.3, 0.18, def.shirt, 0, 0.49, 0, root);
  part(0.31, 0.05, 0.19, tint(def.shirt, -0.22), 0, 0.345, 0, root);
  if (def.acc === "tie") part(0.06, 0.2, 0.02, def.accColor, 0, 0.53, 0.095, root);
  const arms = [-0.2, 0.2].map((x) => {
    const sh = pivot(x, 0.62, 0, root);
    part(0.1, 0.22, 0.12, def.shirt, 0, -0.1, 0, sh);
    part(0.09, 0.09, 0.11, skin, 0, -0.255, 0, sh);
    return sh;
  });
  const head = pivot(0, 0.64, 0, root);
  part(0.3, 0.3, 0.3, headMaterials(def), 0, 0.15, 0, head);
  const a = def.accColor || "#3d2a26";
  if (def.acc === "hardhat") {
    part(0.34, 0.1, 0.34, a, 0, 0.33, 0, head);
    part(0.4, 0.03, 0.42, a, 0, 0.29, 0.01, head);
  } else if (def.acc === "headphones") {
    part(0.36, 0.04, 0.07, a, 0, 0.32, 0, head);
    for (const x of [-0.17, 0.17]) part(0.06, 0.13, 0.11, a, x, 0.15, 0, head);
  } else if (def.acc === "beret") {
    const b = part(0.33, 0.07, 0.31, a, -0.02, 0.33, 0, head);
    b.rotation.z = 0.18;
  } else if (def.acc === "cap") {
    part(0.32, 0.08, 0.32, a, 0, 0.33, 0, head);
    part(0.3, 0.025, 0.14, a, 0, 0.3, 0.21, head);
  }
  return { root, legs, arms, head };
}

// ------------------------------------------------------------------ kantor 3D
export class Office3D {
  constructor(canvas, { onSelect, onExplore } = {}) {
    this.canvas = canvas;
    this.onSelect = onSelect || (() => {});
    this.onExplore = onExplore || (() => {});
    this.explore = false;
    this.keys = {};
    this.inbox = []; // barang yang menumpuk di meja admin: { item, mesh }
    this.flyers = [];
    this.confetti = [];
    this.failed = {};
    this.pickTimer = 0;
    this.states = {};
    this.time = 0;
    this.raf = null;
    this.hover = null;
    this.selected = null;
    this.pointer = null;
    this.pickDirty = false;
    this.mats = {};

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#bfe2ef");
    this.scene.fog = new THREE.Fog("#bfe2ef", 55, 110);
    this.camera = new THREE.PerspectiveCamera(FOV, 1.5, 0.5, 200);
    this.view = this._isoView();
    this.goal = this._isoView();

    this._buildLights();
    this.screens = {};
    this.lampSpots = [];
    this.fx = [];
    this.screenT = 0;
    this.skyT = 0;
    this._buildWorld();
    this._buildSky();
    this._buildAgents();
    this._buildCat();
    this._buildHighlights();
    this._buildOverlay();
    this.raycaster = new THREE.Raycaster();
    this._bindControls();
    this._bindKeys();
    this._applyCamera(1);
    this.resizeObs = new ResizeObserver(() => this.raf && this._resize());
    this.resizeObs.observe(canvas.parentElement);
  }

  // ---------------------------------------------------------------- API publik (sama dgn Office)
  setStates(agents) {
    for (const a of agents) {
      this.states[a.agent] = a;
      if (this.screens[a.agent]) this._paintScreen(a.agent);
    }
  }

  start() {
    if (this.raf) return;
    this._resize();
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.time += dt;
      this._update(dt);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.setExplore(false);
    if (this.bannerEl) this.bannerEl.hidden = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  select(id) {
    if (!ROOMS[id]) return;
    this.selected = id;
    if (this.agents[id]) this.agents[id].jumpUntil = this.time + 0.4;
    sfx.play("select");
    this.onSelect(id);
  }

  // Event job -> animasi 3D. Alur & teks log sama persis dengan 2D (planJobEvent di office.js).
  jobEvent(type, job) {
    const plan = planJobEvent(type, job);
    if (!plan) return null;
    const act = plan.action;
    if (act.banner) this._showBanner(...act.banner);
    if (act.kind === "new") {
      sfx.play("coin");
      const to = this._deskTop("writer");
      this._fly("envelope", to.clone().setY(7), to, 0.9, 0, () => {
        sfx.play("paper");
        this.agents.writer.jumpUntil = this.time + 0.4;
        this._say(this.agents.writer, "!", 1.8, "#f2d47a");
      });
    } else if (act.kind === "done") {
      this._celebrate();
    } else if (act.kind === "fail") {
      sfx.play("fail");
      this.failed[act.who] = this.time + 10;
      this.agents[act.who].sadUntil = this.time + 4;
      this._smoke(act.who);
      this._say(this.agents[act.who], "!", 3, "#d9776b");
    } else if (act.kind === "reject") {
      this._adminTask(() => this._reject());
    } else if (act.kind === "deliver") {
      // admin baru berangkat setelah kiriman untuknya benar-benar tiba di meja (sama dgn 2D)
      const opts = act.opts.fromInbox ? { ...act.opts, ready: this._inboxReady() } : act.opts;
      this._deliver(act.from, act.to, act.item, opts);
    }
    return plan.entry;
  }

  // kembali ke sudut isometrik awal (lewat jalur terpendek, tidak berputar-putar)
  resetView() {
    if (this.explore) this.setExplore(false);
    const iso = this._isoView();
    const turn = Math.PI * 2;
    iso.theta += Math.round((this.view.theta - iso.theta) / turn) * turn;
    this.goal = iso;
  }

  // Mode jelajah ala game balok: jalan di dalam kantor dengan WASD + mouse (pointer lock).
  setExplore(on) {
    on = !!on;
    if (on === this.explore) return;
    this.explore = on;
    this.keys = {};
    if (on) {
      this.player = { pos: new THREE.Vector3(SPAWN.x, SPAWN.y, SPAWN.z), vy: 0, yaw: SPAWN.yaw, pitch: -0.1,
        onGround: false, fly: false, stepT: 0 };
      this.camera.fov = 70;
      this.camera.near = 0.04;
      for (const layer of Object.values(this.layers)) layer.visible = true;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    } else {
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      this.camera.fov = FOV;
      this.camera.near = 0.5;
      this.hover = null;
    }
    this.camera.updateProjectionMatrix();
    this._updateOverlay();
    this.canvas.style.cursor = on ? "crosshair" : "grab";
    this.onExplore(on);
  }

  // ---------------------------------------------------------------- kamera
  _isoView() {
    return { theta: ISO.theta, phi: ISO.phi, radius: ISO.radius, target: new THREE.Vector3(...ISO.target) };
  }

  _applyCamera(dt) {
    const k = 1 - Math.exp(-dt * 12);
    const v = this.view;
    const g = this.goal;
    v.theta += (g.theta - v.theta) * k;
    v.phi += (g.phi - v.phi) * k;
    v.radius += (g.radius - v.radius) * k;
    v.target.lerp(g.target, k);
    const s = Math.sin(v.phi);
    this.camera.position.set(
      v.target.x + v.radius * s * Math.sin(v.theta),
      v.target.y + v.radius * Math.cos(v.phi),
      v.target.z + v.radius * s * Math.cos(v.theta),
    );
    this.camera.lookAt(v.target);
    // potongan diorama: dinding yang membelakangi kamera disembunyikan supaya isi tetap terlihat
    const p = this.camera.position;
    if (this.layers.wallBack) this.layers.wallBack.visible = p.z > -0.2;
    if (this.layers.wallLeft) this.layers.wallLeft.visible = p.x > -0.2;
  }

  _zoom(f) {
    this.goal.radius = clamp(this.goal.radius * f, LIMIT.rMin, LIMIT.rMax);
  }

  _pan(dx, dy) {
    const g = this.goal;
    const k = (2 * g.radius * Math.tan((FOV * Math.PI) / 360)) / Math.max(1, this.canvas.clientHeight);
    const right = new THREE.Vector3(Math.cos(g.theta), 0, -Math.sin(g.theta));
    const fwd = new THREE.Vector3(-Math.sin(g.theta), 0, -Math.cos(g.theta));
    g.target.addScaledVector(right, -dx * k).addScaledVector(fwd, (dy * k) / Math.max(0.35, Math.cos(g.phi)));
    g.target.x = clamp(g.target.x, -6, 24);
    g.target.z = clamp(g.target.z, -6, 16);
  }

  _bindControls() {
    const el = this.canvas;
    const pts = new Map();
    let drag = null;
    const pinch = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      if (this.explore) {
        if (document.pointerLockElement === el) {
          if (e.button === 0) this._interact();
          return;
        }
        if (e.pointerType === "mouse" && el.requestPointerLock) {
          const req = el.requestPointerLock();
          if (req && req.catch) req.catch(() => {});
          return;
        }
      }
      try {
        el.setPointerCapture(e.pointerId); // seret tetap jalan walau kursor keluar kanvas
      } catch { /* pointer sintetis/tidak aktif: tanpa capture pun tetap berfungsi */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        drag = { mode: e.button === 2 || e.button === 1 || e.shiftKey ? "pan" : "rotate", moved: 0 };
      } else if (pts.size === 2) {
        drag = { mode: "pinch", dist: pinch(), moved: 99 };
      }
      if (!this.explore) el.style.cursor = "grabbing";
    });
    el.addEventListener("pointermove", (e) => {
      const rect = el.getBoundingClientRect();
      this.pointer = { x: ((e.clientX - rect.left) / rect.width) * 2 - 1, y: -((e.clientY - rect.top) / rect.height) * 2 + 1 };
      this.pickDirty = true;
      if (!drag || !pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (drag.mode === "pinch") {
        if (pts.size < 2) return;
        const d = pinch();
        if (drag.dist > 0 && d > 0) this._zoom(drag.dist / d);
        drag.dist = d;
        return;
      }
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.explore) { // layar sentuh: seret untuk melihat sekeliling
        this._look(dx * 2.2, dy * 2.2);
      } else if (drag.mode === "rotate") {
        this.goal.theta -= dx * 0.008;
        this.goal.phi = clamp(this.goal.phi - dy * 0.006, LIMIT.phiMin, LIMIT.phiMax);
      } else {
        this._pan(dx, dy);
      }
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size === 0) {
        if (drag && drag.moved < 6 && e.type === "pointerup") {
          if (this.explore) this._interact();
          else this._click();
        }
        drag = null;
        el.style.cursor = this.explore ? "crosshair" : this.hover ? "pointer" : "grab";
      } else if (pts.size === 1) {
        drag = { mode: "rotate", moved: 99 }; // sisa satu jari setelah cubit: lanjut putar, bukan klik
      }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", () => {
      if (pts.size) return;
      this.pointer = null;
      this.pickDirty = true;
    });
    el.addEventListener("wheel", (e) => {
      if (this.explore) return;
      e.preventDefault();
      this._zoom(Math.exp(clamp(e.deltaY, -200, 200) * 0.0012));
    }, { passive: false });
    el.style.cursor = "grab";
    document.addEventListener("mousemove", (e) => {
      if (this.explore && document.pointerLockElement === el) this._look(e.movementX, e.movementY);
    });
    document.addEventListener("pointerlockchange", () => this._updateOverlay());
  }

  _click() {
    this._pick();
    if (this.hover === "cat") this._meow();
    else if (this.hover) this.select(this.hover);
  }

  // ruangan di bawah kursor: tembak sinar ke gedung, lalu cocokkan titik kena dengan ROOMS
  _pick() {
    this.pickDirty = false;
    let room = null;
    const pointer = this.explore ? { x: 0, y: 0 } : this.pointer;
    if (pointer) {
      this.raycaster.setFromCamera(pointer, this.camera);
      this.raycaster.far = this.explore ? 4 : Infinity;
      const hit = this.raycaster.intersectObjects(this.pickables, false).find((h) => isVisible(h.object));
      if (hit && hit.object.userData.cat) room = "cat";
      else if (hit && hit.object.userData.agent) room = hit.object.userData.agent;
      else if (hit && hit.point.y > -0.05 && hit.point.y < WALL_H + 0.1) room = roomAt(hit.point.x, hit.point.z);
    }
    if (room !== this.hover) {
      this.hover = room;
      if (this.explore) this._updateOverlay();
      else this.canvas.style.cursor = room ? "pointer" : "grab";
    }
  }

  _resize() {
    const wrap = this.canvas.parentElement;
    const w = Math.max(200, wrap ? wrap.clientWidth : 640);
    const h = Math.round(clamp(w * 0.62, 280, 640));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- update
  _update(dt) {
    if (this.explore) {
      this._updatePlayer(dt);
      this.pickTimer -= dt;
      if (this.pickTimer <= 0) {
        this.pickTimer = 0.12;
        this._pick();
      }
    } else {
      this._applyCamera(dt);
      if (this.pickDirty) this._pick();
    }
    this._updateHighlights();
    this._updateAgents(dt);
    this._updateCat(dt);
    this._updateFlyers(dt);
    this._ambientFx(dt);
    this._updateFx(dt);
    // layar monitor ~10 fps sudah cukup (gaya pixel), suasana langit dicek tiap 10 detik
    this.screenT -= dt;
    if (this.screenT <= 0) {
      this.screenT = 0.1;
      for (const id of Object.keys(this.screens)) this._paintScreen(id);
    }
    this.skyT -= dt;
    if (this.skyT <= 0) {
      this.skyT = 10;
      this._applySky(skyKey());
    }
    if (this.bannerUntil && this.time > this.bannerUntil) {
      this.bannerUntil = 0;
      this.bannerEl.hidden = true;
    }
  }

  _buildHighlights() {
    const fill = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: "#fffaf0", transparent: true, opacity: 0.22, depthWrite: false }));
    fill.visible = false;
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: "#f2d47a", transparent: true }));
    lines.visible = false;
    this.scene.add(fill, lines);
    this.hl = { fill, lines };
  }

  _updateHighlights() {
    const place = (obj, id, h, y) => {
      const r = ROOMS[id];
      obj.visible = !!r;
      if (!r) return;
      obj.scale.set(r.w - 0.1, h, r.d - 0.1);
      obj.position.set(r.x + r.w / 2, y, r.y + r.d / 2);
    };
    place(this.hl.fill, this.explore ? null : this.hover, 0.04, 0.12);
    place(this.hl.lines, this.selected, LOW_H + 0.3, (LOW_H + 0.3) / 2 + 0.02);
    this.hl.lines.material.opacity = 0.65 + Math.sin(this.time * 5) * 0.35;
  }

  // ---------------------------------------------------------------- agent
  _buildAgents() {
    this.agents = {};
    this.toAdmin = 0; // kurir yang sedang/akan berjalan ke meja admin
    for (const [id, def] of Object.entries(AGENTS)) {
      const c = makeCharacter(def, (hex) => this._mat(`flat:${hex}`));
      const s = seatOf(id);
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09),
        new THREE.MeshBasicMaterial({ color: STATE_COLOR.offline }));
      light.position.set(0, 1.15, 0);
      c.root.add(light);
      c.root.traverse((m) => {
        if (!m.isMesh) return;
        m.userData.agent = id;
        this.pickables.push(m);
      });
      this.scene.add(c.root);
      this.agents[id] = {
        ...c, id, light, phase: id.length * 1.7, jumpUntil: 0, sadUntil: 0, cheerUntil: 0,
        gx: s.gx, gy: s.gy, yaw: Math.PI, mode: "seat", path: [], speed: 2.6, walkDist: 0, stepT: 0,
        carry: null, carryMesh: null, tasks: [], busy: false, waitUntil: 0, after: null, onArrive: null,
        roaming: false, nextRoam: 4 + Math.random() * 8, bubble: null,
      };
    }
    // titik jalan-jalan santai dari ROOMS, dibuang yang menabrak perabot versi 3D
    this.roam = {};
    for (const [id, r] of Object.entries(ROOMS)) this.roam[id] = r.roam.filter((p) => !this._blockedAt(p.gx, p.gy));
  }

  // ada perabot (bukan karpet) di titik lantai ini?
  _blockedAt(x, z, r = 0.2) {
    return this.solids.some((b) => b[0] < x + r && b[3] > x - r && b[2] < z + r && b[5] > z - r
      && b[4] > 0.1 && b[1] < 0.9);
  }

  // rute keluar/masuk ruangan: berdiri di belakang kursi dulu, lalu titik "inner" seperti versi 2D
  _exitPath(id) {
    const s = seatOf(id);
    return [{ gx: s.gx, gy: s.gy + 0.5 }, ...ROOMS[id].inner.slice().reverse()];
  }

  _enterPath(id) {
    const s = seatOf(id);
    return [...ROOMS[id].inner, { gx: s.gx, gy: s.gy + 0.5 }, s];
  }

  // ---- antrean tugas tiap agent (logika sama dengan office.js)
  _deliver(fromId, destId, item, opts = {}) {
    const a = this.agents[fromId];
    const toAdmin = destId === "admin";
    if (toAdmin) this.toAdmin += 1;
    this._enqueue(a, { toAdmin, ready: opts.ready, run: () => this._runDelivery(a, destId, item, opts) });
  }

  // tugas admin tanpa berjalan (mis. menolak), tetap menunggu kiriman tiba dulu
  _adminTask(fn) {
    const a = this.agents.admin;
    this._enqueue(a, { ready: this._inboxReady(), run: () => { fn(); a.busy = false; } });
  }

  _inboxReady() {
    const since = this.time;
    // batas 20 detik supaya antrean tidak macet bila ada event yang terlewat
    return () => this.inbox.length > 0 || this.toAdmin === 0 || this.time - since > 20;
  }

  _enqueue(a, task) {
    if (a.tasks.length > 3) {
      const dropped = a.tasks.shift(); // event terlalu cepat: buang antrean lama
      if (dropped.toAdmin) this.toAdmin = Math.max(0, this.toAdmin - 1);
    }
    a.tasks.push(task);
    if (a.roaming && a.waitUntil > this.time) a.waitUntil = this.time; // percepat pulang
    this._kick(a);
  }

  _kick(a) {
    if (a.busy || !a.tasks.length) return;
    const task = a.tasks[0];
    if (task.ready && !task.ready()) return; // dicoba lagi tiap frame
    a.tasks.shift();
    a.busy = true;
    task.run();
  }

  // berdiri, angkat barang, jalan lewat pintu & lorong ke ruangan tujuan, serahkan, lalu pulang
  _runDelivery(a, destId, item, opts) {
    if (opts.fromInbox && this.inbox.length) {
      const top = this.inbox.shift();
      item = top.item;
      this.scene.remove(top.mesh);
      this._layoutInbox();
    }
    const home = ROOMS[a.id];
    const dest = ROOMS[destId];
    this._setCarry(a, item);
    a.mode = "walk";
    this._say(a, opts.say || "!", 0.9, opts.say === "REVISI" ? "#d9776b" : "#fffaf0");
    sfx.play("pickup");
    a.path = [...this._exitPath(a.id), home.door, home.hall, dest.hall, dest.door, dest.spot];
    a.onArrive = () => {
      const target = destId === "admin" ? this._inboxPos(0) : this._deskTop(destId);
      a.yaw = Math.atan2(target.x - a.gx, target.z - a.gy);
      a.mode = "stand";
      sfx.play(opts.sfx || "handoff");
      this._receive(destId, a.carry, opts, a);
      this._setCarry(a, null);
      a.waitUntil = this.time + 0.8;
      a.after = () => {
        a.mode = "walk";
        a.path = [dest.door, dest.hall, home.hall, home.door, ...this._enterPath(a.id)];
        a.onArrive = () => this._sitDown(a);
      };
    };
  }

  _sitDown(a) {
    const s = seatOf(a.id);
    a.gx = s.gx;
    a.gy = s.gy;
    a.mode = "seat";
    a.busy = false;
    a.roaming = false;
    a.nextRoam = this.time + 6 + Math.random() * 10;
    this._kick(a);
  }

  // barang melambung dari tangan kurir ke meja penerima (atau ke tumpukan inbox admin)
  _receive(destId, item, opts, courier) {
    const from = new THREE.Vector3(courier.gx, 1.08, courier.gy);
    if (destId === "admin") {
      const m = this._fly(item, from, this._inboxPos(this.inbox.length), 0.5, 0.35, () => {
        this.toAdmin = Math.max(0, this.toAdmin - 1);
        this.inbox.push({ item, mesh: m });
        this._layoutInbox();
        this._say(this.agents.admin, "?", 2.5, "#f2d47a");
      }, null, true);
      return;
    }
    this._fly(item, from, this._deskTop(destId), 0.5, 0.35, () => {
      const r = this.agents[destId];
      if (opts.recvSay) this._say(r, opts.recvSay, 1.4);
      if (r.mode === "seat") r.jumpUntil = this.time + 0.4;
    });
  }

  _reject() {
    sfx.play("reject");
    this._say(this.agents.admin, "X", 2, "#d9776b");
    const top = this.inbox.shift();
    if (!top) return;
    this._layoutInbox();
    const p = top.mesh.position.clone();
    this._fly(top.item, p, p.clone().setY(3.5), 0.8, 0, null, top.mesh);
  }

  _setCarry(a, item) {
    if (a.carryMesh) a.root.remove(a.carryMesh);
    a.carry = item;
    a.carryMesh = null;
    if (!item) return;
    if (!this.itemGeo) this.itemGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    a.carryMesh = new THREE.Mesh(this.itemGeo, this._mat(`flat:${ITEM_COLOR[item] || "#fffaf0"}`));
    a.carryMesh.position.set(0, 1.04, 0.03); // diangkat di atas kepala
    a.carryMesh.castShadow = true;
    a.root.add(a.carryMesh);
  }

  // balon kata di atas kepala (selalu terlihat, juga menembus dinding seperti di versi 2D)
  _say(a, text, dur, color = "#fffaf0") {
    if (a.bubble) a.root.remove(a.bubble.sprite);
    const key = `${text}|${color}`;
    if (!this.bubbleTex) this.bubbleTex = {};
    if (!this.bubbleTex[key]) {
      const tw = Math.max(0, String(text).length * 4 - 1);
      const c = document.createElement("canvas");
      c.width = tw + 6;
      c.height = 9;
      const g = c.getContext("2d");
      px(g, 1, 0, "#fffaf0", c.width - 2, 9);
      px(g, 0, 1, "#fffaf0", c.width, 7);
      px(g, 1, 1, "#1b1d20", c.width - 2, 7);
      drawText(g, text, 3, 2, color);
      this.bubbleTex[key] = pixelTexture(c, false);
    }
    const tex = this.bubbleTex[key];
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    const k = 0.032;
    sprite.scale.set(tex.image.width * k, tex.image.height * k, 1);
    sprite.position.set(0, a.bubbleY || 1.42, 0);
    sprite.renderOrder = 10;
    a.root.add(sprite);
    a.bubble = { sprite, until: this.time + dur };
  }

  // ---- gerak (port dari office.js)
  _updateActor(a, dt) {
    if (a.bubble && this.time > a.bubble.until) {
      a.root.remove(a.bubble.sprite);
      a.bubble.sprite.material.dispose();
      a.bubble = null;
    }
    if (!a.busy && a.tasks.length) this._kick(a);
    if (a.waitUntil > this.time) return;
    if (a.after) {
      const fn = a.after;
      a.after = null;
      fn();
    }
    if (a.path.length) {
      this._stepAlong(a, dt, a.speed);
      if (a.carry || !a.roaming) {
        a.stepT += dt;
        if (a.stepT > 0.32) {
          a.stepT = 0;
          sfx.play("step");
          this._particle("dust", new THREE.Vector3(a.gx, 0.05, a.gy), { life: 0.4,
            vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.25, (Math.random() - 0.5) * 0.3) });
        }
      }
      if (!a.path.length && a.onArrive) {
        const fn = a.onArrive;
        a.onArrive = null;
        fn();
      }
      return;
    }
    // jalan-jalan santai di dalam ruangan saat idle
    const st = this.states[a.id]?.state || "idle";
    const canRoam = a.id === "admin" ? this.inbox.length === 0 : st === "idle";
    const spots = this.roam[a.id];
    if (!a.busy && !a.tasks.length && a.mode === "seat" && canRoam && spots.length && this.time > a.nextRoam) {
      const target = spots[Math.floor(Math.random() * spots.length)];
      a.busy = true;
      a.roaming = true;
      a.mode = "walk";
      a.path = [...this._exitPath(a.id), target];
      a.onArrive = () => {
        a.mode = "stand";
        a.yaw = 0; // menghadap kamera/depan
        if (Math.random() < 0.5) this._say(a, ["@", "...", "*"][Math.floor(Math.random() * 3)], 1.5);
        a.waitUntil = this.time + 1.5 + Math.random() * 2;
        a.after = () => {
          a.mode = "walk";
          a.path = this._enterPath(a.id);
          a.onArrive = () => this._sitDown(a);
        };
      };
    }
  }

  _stepAlong(a, dt, speed) {
    let remaining = speed * dt;
    while (remaining > 0 && a.path.length) {
      const t = a.path[0];
      const dx = t.gx - a.gx;
      const dz = t.gy - a.gy;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-3) {
        a.path.shift();
        continue;
      }
      a.yaw = Math.atan2(dx, dz);
      const stepLen = Math.min(dist, remaining);
      a.gx += (dx / dist) * stepLen;
      a.gy += (dz / dist) * stepLen;
      a.walkDist += stepLen;
      remaining -= stepLen;
      if (stepLen >= dist) a.path.shift();
    }
  }

  // pose: duduk mengikuti status (mengetik/santai/tidur/sorak), atau berjalan/berdiri/membawa barang
  _updateAgents(dt) {
    const k = 1 - Math.exp(-dt * 12);
    for (const [id, a] of Object.entries(this.agents)) {
      this._updateActor(a, dt);
      const st = this.states[id]?.state || (id === "admin" ? "idle" : "offline");
      const t = this.time + a.phase;
      const seated = a.mode === "seat";
      let arm = [-0.42 + Math.sin(t * 1.6) * 0.04, -0.42 - Math.sin(t * 1.6) * 0.04];
      let leg = [-Math.PI / 2, -Math.PI / 2];
      let headX = 0;
      let headY = 0;
      let lift = 0;
      if (a.mode === "walk") {
        const sw = Math.sin(a.walkDist * 9) * 0.6;
        leg = [sw, -sw];
        arm = a.carry ? [-2.9, -2.9] : [-sw * 0.8, sw * 0.8];
        lift = Math.abs(Math.cos(a.walkDist * 9)) * 0.025;
      } else if (a.sadUntil > this.time) {
        arm = [-0.15, -0.15];
        headX = 0.55;
      } else if (a.cheerUntil > this.time || (seated && st === "just_done")) {
        const w = Math.sin(t * 12) * 0.25;
        arm = [-2.9 + w, -2.9 - w];
        lift = Math.abs(Math.sin(t * 7)) * 0.05;
      } else if (!seated) {
        arm = a.carry ? [-2.9, -2.9] : [-0.12, -0.12];
        headY = Math.sin(t * 0.8) * 0.3;
      } else if (id === "admin" && this.inbox.length) {
        arm = [-1.1, -1.1]; // membaca berkas di meja
        headX = 0.35 + Math.sin(t * 2) * 0.05;
      } else if (st === "working") {
        const w = Math.sin(t * 20) * 0.14;
        arm = [-1.3 + w, -1.3 - w];
        headX = 0.12 + Math.sin(t * 2.3) * 0.04;
      } else if (st === "offline") {
        arm = [-1.05, -1.05];
        headX = 0.8; // tidur di meja
      } else {
        headY = Math.sin(t * 0.45) * 0.45;
      }
      if (!seated && a.mode !== "walk") leg = [0, 0];
      const rem = a.jumpUntil - this.time;
      if (rem > 0 && rem <= 0.4) lift += Math.sin((rem / 0.4) * Math.PI) * 0.2;
      const kl = a.mode === "walk" ? 1 : k; // ayunan kaki saat jalan langsung, transisi duduk halus
      a.legs[0].rotation.x += (leg[0] - a.legs[0].rotation.x) * kl;
      a.legs[1].rotation.x += (leg[1] - a.legs[1].rotation.x) * kl;
      a.arms[0].rotation.x += (arm[0] - a.arms[0].rotation.x) * kl;
      a.arms[1].rotation.x += (arm[1] - a.arms[1].rotation.x) * kl;
      a.head.rotation.x += (headX - a.head.rotation.x) * k;
      a.head.rotation.y += (headY - a.head.rotation.y) * k;
      a.root.position.set(a.gx, (seated ? 0.04 : 0) + lift, a.gy);
      const yaw = seated ? Math.PI : a.yaw;
      const turn = Math.atan2(Math.sin(yaw - a.root.rotation.y), Math.cos(yaw - a.root.rotation.y));
      a.root.rotation.y += turn * (1 - Math.exp(-dt * 14));
      const failed = this.failed[id] > this.time;
      a.light.material.color.set(failed ? (Math.floor(this.time * 4) % 2 ? "#d9776b" : "#7a2e2a")
        : STATE_COLOR[st] || STATE_COLOR.offline);
      a.light.position.y = (a.carry ? 1.3 : 1.15) + Math.sin(t * 2.5) * 0.04;
      a.light.rotation.y = t;
    }
  }

  // ---------------------------------------------------------------- kucing kantor
  // Kucing oranye balok (warna sama dengan versi 2D) yang jalan-jalan di lorong; klik = meong.
  _buildCat() {
    const mat = (hex) => this._mat(`flat:${hex}`);
    const root = new THREE.Group();
    const body = new THREE.Group(); // dimiringkan saat duduk
    body.position.set(0, 0.13, 0);
    root.add(body);
    const part = (w, h, d, color, x, y, z, parent = body) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
      m.position.set(x, y, z);
      m.castShadow = true;
      m.userData.cat = true;
      parent.add(m);
      this.pickables.push(m);
      return m;
    };
    const fur = "#f2c14e";
    const dark = "#d99a2b";
    part(0.18, 0.15, 0.36, fur, 0, 0.08, 0);
    for (const z of [-0.08, 0.04]) part(0.185, 0.03, 0.05, dark, 0, 0.145, z); // belang
    const head = new THREE.Group();
    head.position.set(0, 0.2, 0.2);
    body.add(head);
    part(0.2, 0.17, 0.16, fur, 0, 0, 0, head);
    for (const x of [-0.06, 0.06]) {
      part(0.05, 0.06, 0.04, fur, x, 0.11, -0.02, head); // telinga
      part(0.035, 0.035, 0.01, "#3d2a26", x * 0.9, 0.02, 0.083, head); // mata
    }
    part(0.03, 0.02, 0.01, "#e8a0bf", 0, -0.03, 0.083, head); // hidung
    const tail = new THREE.Group();
    tail.position.set(0, 0.13, -0.17);
    body.add(tail);
    part(0.04, 0.04, 0.22, fur, 0, 0, -0.1, tail);
    part(0.045, 0.045, 0.06, dark, 0, 0, -0.2, tail);
    const legs = [[-0.06, 0.12], [0.06, 0.12], [-0.06, -0.12], [0.06, -0.12]].map(([x, z]) => {
      const hip = new THREE.Group();
      hip.position.set(x, 0.13, z);
      root.add(hip);
      part(0.05, 0.13, 0.05, fur, 0, -0.065, 0, hip);
      return hip;
    });
    this.scene.add(root);
    this.cat = { root, body, head, tail, legs, gx: 7, gy: 5, yaw: 0.6, path: [], mode: "sit", walkDist: 0,
      next: 3, jumpUntil: 0, bubble: null, bubbleY: 0.7 };
  }

  _updateCat(dt) {
    const c = this.cat;
    if (c.bubble && this.time > c.bubble.until) {
      c.root.remove(c.bubble.sprite);
      c.bubble.sprite.material.dispose();
      c.bubble = null;
    }
    if (c.path.length) {
      this._stepAlong(c, dt, 1.4);
      c.mode = c.path.length ? "walk" : "sit";
      if (!c.path.length) c.next = this.time + 4 + Math.random() * 8;
    } else if (this.time > c.next) {
      // titik acak di lorong (sama dgn 2D), dijauhkan dari bangku & dispenser di sisi z = 4
      c.path = [{ gx: 0.8 + Math.random() * 13.4, gy: 4.8 + Math.random() * 0.8 }];
    }
    const t = this.time;
    const k = 1 - Math.exp(-dt * 10);
    const walking = c.mode === "walk";
    const sw = walking ? Math.sin(c.walkDist * 14) * 0.7 : 0;
    c.legs.forEach((leg, i) => {
      const target = walking ? (i === 0 || i === 3 ? sw : -sw) : i < 2 ? 0 : -1.2; // duduk: kaki belakang terlipat
      leg.rotation.x += (target - leg.rotation.x) * (walking ? 1 : k);
    });
    c.body.rotation.x += ((walking ? 0 : -0.45) - c.body.rotation.x) * k;
    c.body.position.y += ((walking ? 0.13 : 0.1) - c.body.position.y) * k;
    c.head.rotation.x += ((walking ? 0 : 0.45) - c.head.rotation.x) * k; // kepala tetap tegak saat duduk
    c.head.rotation.y = walking ? 0 : Math.sin(t * 0.7) * 0.5;
    c.tail.rotation.x = walking ? -0.5 : -0.2;
    c.tail.rotation.y = Math.sin(t * (walking ? 6 : 2)) * 0.5;
    const rem = c.jumpUntil - t;
    const lift = rem > 0 && rem <= 0.35 ? Math.sin((rem / 0.35) * Math.PI) * 0.25 : 0;
    c.root.position.set(c.gx, 0.03 + lift, c.gy);
    const turn = Math.atan2(Math.sin(c.yaw - c.root.rotation.y), Math.cos(c.yaw - c.root.rotation.y));
    c.root.rotation.y += turn * (1 - Math.exp(-dt * 10));
  }

  _meow() {
    const c = this.cat;
    sfx.play("meow");
    this._say(c, "MEOW", 1.4);
    c.jumpUntil = this.time + 0.35;
    this._sparkle(new THREE.Vector3(c.gx, 0.45, c.gy), "#e8a0bf", 5);
  }

  // ---------------------------------------------------------------- barang & efek
  _deskTop(id) {
    const dk = ROOMS[id].desk;
    return new THREE.Vector3(dk.x + 1.6, 0.6, dk.y + 0.55);
  }

  _inboxPos(i) {
    const dk = ROOMS.admin.desk;
    return new THREE.Vector3(dk.x + 1.65, 0.58 + i * 0.17, dk.y + 0.3);
  }

  _layoutInbox() {
    this.inbox.forEach((b, i) => b.mesh.position.copy(this._inboxPos(i)));
  }

  // balok barang melambung dari `from` ke `to`; keep = tetap ada setelah mendarat
  _fly(item, from, to, dur, arc, onDone, mesh = null, keep = false) {
    if (!mesh) {
      if (!this.itemGeo) this.itemGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
      mesh = new THREE.Mesh(this.itemGeo, this._mat(`flat:${ITEM_COLOR[item] || "#fffaf0"}`));
      mesh.castShadow = true;
      this.scene.add(mesh);
    }
    this.flyers.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur, arc, onDone, keep });
    return mesh;
  }

  _celebrate() {
    sfx.play("done");
    this.agents.delivery.cheerUntil = this.time + 2.6;
    this._sparkle(new THREE.Vector3(this.agents.delivery.gx, 1.2, this.agents.delivery.gy), "#f2d47a", 14);
    Object.values(this.agents).forEach((a, i) => (a.jumpUntil = this.time + 0.4 + i * 0.12));
    if (!this.confGeo) this.confGeo = new THREE.BoxGeometry(0.08, 0.08, 0.02);
    const colors = ["#f2d47a", "#7fc28a", "#d9776b", "#82a0bd", "#b39ddb", "#e8a0bf"];
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(this.confGeo, this._mat(`glow:flat:${colors[i % colors.length]}`));
      m.position.set(Math.random() * 18, 3.5 + Math.random() * 3, Math.random() * 10);
      this.scene.add(m);
      this.confetti.push({ m, vy: -(0.7 + Math.random()), spin: (Math.random() - 0.5) * 12,
        life: 4 + Math.random() * 2, t: 0, sway: Math.random() * 6 });
    }
  }

  _updateFlyers(dt) {
    for (const f of this.flyers) {
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      f.mesh.position.lerpVectors(f.from, f.to, u);
      f.mesh.position.y += Math.sin(u * Math.PI) * f.arc;
      f.mesh.rotation.y = u * Math.PI * 2;
      if (u < 1) continue;
      f.done = true;
      f.mesh.rotation.set(0, 0, 0);
      if (!f.keep) this.scene.remove(f.mesh);
      if (f.onDone) f.onDone();
    }
    this.flyers = this.flyers.filter((f) => !f.done);
    for (const c of this.confetti) {
      c.t += dt;
      c.m.position.y += c.vy * dt;
      c.m.position.x += Math.sin(c.t * 4 + c.sway) * 0.4 * dt;
      c.m.rotation.x += c.spin * dt;
      c.m.rotation.z += c.spin * 0.6 * dt;
      if (c.t > c.life || c.m.position.y < 0.05) {
        c.dead = true;
        this.scene.remove(c.m);
      }
    }
    this.confetti = this.confetti.filter((c) => !c.dead);
  }

  // ---------------------------------------------------------------- mode jelajah
  _buildOverlay() {
    const make = (cls, text) => {
      const d = document.createElement("div");
      d.className = cls;
      if (text) d.textContent = text;
      return d;
    };
    const box = make("o3d-overlay");
    box.hidden = true;
    this.ov = {
      box, cross: make("o3d-cross"), start: make("o3d-start"), label: make("o3d-label"),
      mode: make("o3d-mode"), help: make("o3d-help", EXPLORE_HELP),
    };
    box.append(this.ov.cross, this.ov.start, this.ov.label, this.ov.mode, this.ov.help);
    this.bannerEl = make("o3d-banner");
    this.bannerEl.hidden = true;
    this.canvas.parentElement.append(box, this.bannerEl);
  }

  _updateOverlay() {
    const o = this.ov;
    if (!o) return;
    o.box.hidden = !this.explore;
    if (!this.explore) return;
    const locked = document.pointerLockElement === this.canvas;
    const touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    o.start.textContent = locked ? "" : touch ? "SERET UNTUK MELIHAT SEKITAR" : "KLIK UNTUK MULAI JELAJAH";
    o.label.textContent = this.hover === "cat" ? "KUCING KANTOR - KLIK UNTUK ELUS"
      : this.hover ? `${AGENTS[this.hover].name.toUpperCase()} - KLIK UNTUK SAPA` : "";
    o.mode.textContent = this.player?.fly ? "MODE TERBANG" : "";
  }

  _bindKeys() {
    const blocked = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    window.addEventListener("keydown", (e) => {
      if (!this.explore || !this.raf) return;
      if (blocked.includes(e.code)) e.preventDefault(); // jangan menggulir halaman
      if (!e.repeat && e.code === "KeyF") {
        this.player.fly = !this.player.fly;
        this.player.vy = 0;
        sfx.play("toggle");
        this._updateOverlay();
      }
      if (!e.repeat && e.code === "KeyR") this._respawn();
      this.keys[e.code] = true;
    });
    window.addEventListener("keyup", (e) => {
      if (blocked.includes(e.code) && this.explore) e.preventDefault();
      delete this.keys[e.code];
    });
    window.addEventListener("blur", () => (this.keys = {}));
  }

  _respawn() {
    const p = this.player;
    p.pos.set(SPAWN.x, SPAWN.y, SPAWN.z);
    p.vy = 0;
    p.yaw = SPAWN.yaw;
    p.pitch = -0.1;
  }

  _look(dx, dy) {
    const p = this.player;
    if (!p) return;
    p.yaw -= dx * 0.0024;
    p.pitch = clamp(p.pitch - dy * 0.0024, -1.5, 1.5);
  }

  _interact() {
    this._pick();
    if (this.hover === "cat") this._meow();
    else if (this.hover) this.select(this.hover);
  }

  // tabrakan kotak (AABB) pemain vs semua balok padat dunia
  _collides(pos) {
    const r = PLAYER.r;
    const x0 = pos.x - r;
    const x1 = pos.x + r;
    const y0 = pos.y + 0.001;
    const y1 = pos.y + PLAYER.h;
    const z0 = pos.z - r;
    const z1 = pos.z + r;
    for (const b of this.solids) {
      if (b[0] < x1 && b[3] > x0 && b[1] < y1 && b[4] > y0 && b[2] < z1 && b[5] > z0) return true;
    }
    return false;
  }

  // gerak satu sumbu; bila terhalang balok rendah (karpet, anak tangga) naik otomatis
  _moveAxis(axis, d, canStep) {
    const pos = this.player.pos;
    pos[axis] += d;
    if (!this._collides(pos)) return;
    if (canStep) {
      const y = pos.y;
      pos.y += PLAYER.step;
      if (!this._collides(pos)) {
        let lo = y; // turunkan lagi sampai tepat menapak di atas penghalang
        let hi = pos.y;
        for (let i = 0; i < 7; i++) {
          pos.y = (lo + hi) / 2;
          if (this._collides(pos)) lo = pos.y;
          else hi = pos.y;
        }
        pos.y = hi;
        return;
      }
      pos.y = y;
    }
    pos[axis] -= d;
  }

  _updatePlayer(dt) {
    const p = this.player;
    const k = this.keys;
    const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const side = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const run = k.ShiftLeft || k.ShiftRight;
    const speed = p.fly ? PLAYER.fly * (run ? 1.8 : 1) : run ? PLAYER.run : PLAYER.walk;
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    let vx = -sin * fwd + cos * side;
    let vz = -cos * fwd - sin * side;
    const len = Math.hypot(vx, vz);
    if (len > 1) {
      vx /= len;
      vz /= len;
    }
    vx *= speed;
    vz *= speed;
    if (p.fly) {
      p.vy = ((k.Space ? 1 : 0) - (k.KeyC ? 1 : 0)) * speed;
    } else {
      if (k.Space && p.onGround) {
        p.vy = PLAYER.jump;
        sfx.play("jump");
      }
      p.vy = Math.max(-20, p.vy - PLAYER.gravity * dt);
    }
    // dipecah jadi langkah kecil supaya tidak menembus sekat tipis saat FPS rendah
    const n = Math.max(1, Math.ceil((Math.max(Math.abs(vx), Math.abs(vz), Math.abs(p.vy)) * dt) / 0.08));
    const h = dt / n;
    const canStep = p.onGround || p.fly;
    p.onGround = false;
    for (let i = 0; i < n; i++) {
      this._moveAxis("x", vx * h, canStep);
      this._moveAxis("z", vz * h, canStep);
      p.pos.y += p.vy * h;
      if (this._collides(p.pos)) {
        p.pos.y -= p.vy * h;
        if (p.vy < 0) p.onGround = true;
        p.vy = 0;
      }
    }
    p.pos.x = clamp(p.pos.x, -15, 33);
    p.pos.z = clamp(p.pos.z, -13, 23);
    if (p.pos.y < -12) this._respawn();
    if (p.onGround && len > 0) {
      p.stepT += dt * (run ? 1.6 : 1);
      if (p.stepT > 0.38) {
        p.stepT = 0;
        sfx.play("step");
      }
    }
    const bob = p.onGround && len > 0 ? Math.sin(this.time * (run ? 16 : 11)) * 0.015 : 0;
    this.camera.position.set(p.pos.x, p.pos.y + PLAYER.eye + bob, p.pos.z);
    this.camera.rotation.set(p.pitch, p.yaw, 0, "YXZ");
  }

  // ---------------------------------------------------------------- siang / malam
  // Langit, matahari/bulan kotak, bintang, lampu (point light + pendar) & kaca jendela.
  _buildSky() {
    // pendar lampu: lingkaran berundak gaya pixel, dijumlahkan (additive) di atas gambar
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 16;
    const g = c.getContext("2d");
    for (const [r, a] of [[8, 0.12], [6, 0.2], [4, 0.32], [2, 0.5]]) {
      g.fillStyle = `rgba(255,214,140,${a})`;
      g.beginPath();
      g.arc(8, 8, r, 0, Math.PI * 2);
      g.fill();
    }
    const haloMat = new THREE.SpriteMaterial({ map: pixelTexture(c, false), blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, fog: false });
    this.lamps = this.lampSpots.map((s) => {
      const light = new THREE.PointLight("#ffd58a", 0, s.range, 1.2);
      light.position.set(...s.pos);
      const halo = new THREE.Sprite(haloMat);
      halo.position.set(...s.pos);
      halo.scale.setScalar(s.halo);
      halo.visible = false;
      this.scene.add(light, halo);
      return { light, halo, power: s.power };
    });
    // bintang di kubah langit
    const pts = [];
    const r = rng("bintang");
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2;
      const e = 0.15 + r() * 1.2;
      pts.push(9 + Math.cos(a) * Math.cos(e) * 90, Math.sin(e) * 90, 5 + Math.sin(a) * Math.cos(e) * 90);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: "#fffaf0", size: 2, sizeAttenuation: false, fog: false }));
    // matahari / bulan berbentuk kotak, jauh di arah cahaya
    this.skyBody = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), new THREE.MeshBasicMaterial({ color: "#fff3b0", fog: false }));
    this.scene.add(this.stars, this.skyBody);
    this.sky = null;
    this._applySky(skyKey());
  }

  _applySky(key) {
    if (key === this.sky) return;
    this.sky = key;
    const k = SKY3D[key] || SKY3D.day;
    this.scene.background.set(k.bg);
    this.scene.fog.color.set(k.bg);
    this.hemi.color.set(k.hemiSky);
    this.hemi.groundColor.set(k.hemiGround);
    this.hemi.intensity = k.hemi;
    this.sun.color.set(k.sun);
    this.sun.intensity = k.sunI;
    this.sun.position.set(...k.sunPos);
    const dir = new THREE.Vector3(...k.sunPos).sub(this.sun.target.position).normalize();
    this.skyBody.position.copy(this.sun.target.position).addScaledVector(dir, 85);
    this.skyBody.lookAt(this.sun.target.position);
    this.skyBody.material.color.set(k.body);
    this.stars.visible = k.stars;
    for (const l of this.lamps) {
      l.light.intensity = l.power * k.lamps;
      l.halo.visible = k.lamps > 0;
    }
    // lampu redup di siang hari, menyala penuh saat gelap
    for (const [name, m] of Object.entries(this.mats)) {
      if (name.startsWith("glow:lamp")) m.color.set(k.lamps ? "#ffffff" : "#d6cfc2");
    }
    this._mat("glass").color.set(k.skyGlass);
    const shop = this._mat(SHOP_GLASS);
    shop.emissive.set("#ffcf7a");
    shop.emissiveMap = shop.map;
    shop.emissiveIntensity = k.shop;
    shop.needsUpdate = true;
  }

  // ---------------------------------------------------------------- efek
  // partikel balok kecil yang mengecil sampai hilang (gaya game balok, tanpa transparansi)
  _particle(kind, pos, opts = {}) {
    if (!this.fxGeo) this.fxGeo = new THREE.BoxGeometry(1, 1, 1);
    let obj;
    if (kind === "glyph") {
      obj = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._textTex(opts.text, opts.color), depthWrite: false }));
      const img = obj.material.map.image;
      obj.userData.base = new THREE.Vector3(img.width * 0.03, img.height * 0.03, 1);
    } else {
      const mat = { spark: `glow:flat:${opts.color || "#f2d47a"}`, smoke: "flat:#9aa0a8", dust: "flat:#d8c4a0" }[kind];
      obj = new THREE.Mesh(this.fxGeo, this._mat(mat));
      const size = opts.size || { spark: 0.06, smoke: 0.12, dust: 0.05 }[kind];
      obj.userData.base = new THREE.Vector3(size, size, size);
    }
    obj.position.copy(pos);
    obj.scale.copy(obj.userData.base);
    obj.visible = !(opts.delay > 0);
    this.scene.add(obj);
    this.fx.push({ obj, kind, vel: opts.vel || new THREE.Vector3(), t: -(opts.delay || 0),
      life: opts.life || 1, spin: (Math.random() - 0.5) * 8 });
  }

  _updateFx(dt) {
    for (const f of this.fx) {
      f.t += dt;
      if (f.t < 0) continue;
      f.obj.visible = true;
      if (f.kind === "spark") f.vel.y -= 3 * dt;
      f.obj.position.addScaledVector(f.vel, dt);
      if (f.kind !== "glyph") f.obj.rotation.y += f.spin * dt;
      const u = f.t / f.life;
      // asap membesar dulu lalu mengecil; lainnya mengecil di akhir umur
      const s = f.kind === "smoke" ? Math.sin(Math.min(1, u) * Math.PI) * 2 : Math.min(1, (1 - u) * 3);
      f.obj.scale.copy(f.obj.userData.base).multiplyScalar(Math.max(0.001, s));
      if (u >= 1) {
        f.dead = true;
        this.scene.remove(f.obj);
        if (f.kind === "glyph") f.obj.material.dispose();
      }
    }
    this.fx = this.fx.filter((f) => !f.dead);
  }

  // efek ambient per status, sama seperti versi 2D: simbol kerja melayang & kilau saat selesai
  _ambientFx(dt) {
    for (const id of Object.keys(ROOMS)) {
      const a = this.agents[id];
      if (a.mode !== "seat") continue;
      const st = this.states[id]?.state;
      const top = this._deskTop(id);
      if (st === "just_done" && Math.random() < dt * 4) this._sparkle(top.clone().setY(0.9), "#7fc28a", 1);
      if (st === "working" && GLYPH[id] && Math.random() < dt * 0.7) {
        this._particle("glyph", top.clone().setY(1.0), { text: GLYPH[id], color: AGENTS[id].shirt,
          vel: new THREE.Vector3(0, 0.35, 0), life: 1.4 });
      }
    }
  }

  _sparkle(pos, color, n = 6) {
    for (let i = 0; i < n; i++) {
      this._particle("spark", pos, { color, life: 0.6 + Math.random() * 0.4,
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 1 + Math.random() * 1.2, (Math.random() - 0.5) * 1.2) });
    }
  }

  _smoke(id) {
    const top = this._deskTop(id);
    for (let i = 0; i < 10; i++) {
      const p = top.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.2, (Math.random() - 0.5) * 0.3));
      this._particle("smoke", p, { delay: i * 0.12, life: 1.6 + Math.random(),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.35 + Math.random() * 0.25, (Math.random() - 0.5) * 0.15) });
    }
  }

  _textTex(text, color) {
    const key = `t|${text}|${color}`;
    if (!this.bubbleTex) this.bubbleTex = {};
    if (!this.bubbleTex[key]) {
      const c = document.createElement("canvas");
      c.width = Math.max(1, String(text).length * 4 + 1);
      c.height = 7;
      const g = c.getContext("2d");
      // garis tepi gelap 1px supaya terbaca di latar terang
      for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) drawText(g, text, dx, dy, "#3d2a26");
      drawText(g, text, 1, 1, color);
      this.bubbleTex[key] = pixelTexture(c, false);
    }
    return this.bubbleTex[key];
  }

  _showBanner(text, colorKey) {
    const b = this.bannerEl;
    b.textContent = text;
    b.style.setProperty("--banner", BANNER_COLOR[colorKey] || BANNER_COLOR.blue);
    b.hidden = false;
    b.classList.remove("o3d-banner-in");
    void b.offsetWidth; // ulang animasi masuk
    b.classList.add("o3d-banner-in");
    this.bannerUntil = this.time + 3.2;
  }

  // ---------------------------------------------------------------- layar monitor
  // Animasi layar per peran, port langsung dari Office._drawScreen (kanvas 12x8 yang sama).
  _paintScreen(id) {
    const s = this.screens[id];
    const g = s.g;
    const w = 12;
    const h = 8;
    const t = this.time;
    const st = this.states[id]?.state || (id === "admin" ? "idle" : "offline");
    const fill = (c) => px(g, 0, 0, c, w, h);
    const dot = (c, a, b, ww = 1, hh = 1) => px(g, a, b, c, ww, hh);
    if (this.failed[id] > t) {
      fill(Math.floor(t * 4) % 2 ? "#7a2e2a" : "#a63c35");
      for (const [a, b] of [[3, 1], [4, 2], [5, 3], [6, 4], [7, 5], [8, 6], [8, 1], [7, 2], [5, 4], [4, 5], [3, 6]]) dot("#fffaf0", a, b);
    } else if (id === "admin") {
      if (this.inbox.length) {
        fill(Math.floor(t * 3) % 2 ? "#a63c35" : "#3b2a2a");
        dot("#fffaf0", 5, 1, 2, 4);
        dot("#fffaf0", 5, 6, 2, 1);
      } else {
        fill("#2b3a52");
        dot("#82a0bd", 1, 1, 4, 3);
        dot("#9fb4cc", 6, 1, 5, 1);
        dot("#9fb4cc", 6, 3, 4, 1);
        dot("#9fb4cc", 1, 5, 10, 1);
      }
    } else if (st === "offline") {
      fill("#22262c");
    } else if (st === "idle") {
      fill("#2b3a52");
      const k = Math.floor(t * 1.5);
      dot("#4f6a8f", k % w, (k * 3) % h);
    } else if (st === "just_done") {
      fill("#2f5a3a");
      for (const [a, b] of [[3, 4], [4, 5], [5, 4], [6, 3], [7, 2], [8, 1]]) dot("#7fc28a", a, b);
    } else if (id === "writer") {
      fill("#f6f1e6");
      const n = Math.floor(t * 6) % 30;
      for (let row = 0; row < 3; row++) dot("#8a7f74", 1, 1 + row * 2, Math.max(0, Math.min(10, n - row * 10)), 1);
      if (Math.floor(t * 3) % 2) dot("#3d2a26", 1 + Math.min(10, n % 11), 1 + Math.min(2, Math.floor(n / 10)) * 2);
    } else if (id === "safety") {
      fill("#24402f");
      const k = Math.floor(t * 2) % 4;
      for (let i = 0; i < 3; i++) {
        dot("#4f7f5c", 1, 1 + i * 2);
        dot("#4f7f5c", 3, 1 + i * 2, 8, 1);
        if (i < k) dot("#7fc28a", 1, 1 + i * 2);
      }
    } else if (id === "voice") {
      fill("#2a2440");
      for (let i = 0; i < w; i++) {
        const v = Math.round((Math.sin(t * 9 + i * 1.3) * 0.5 + 0.5) * (h - 2)) + 1;
        dot("#f2d47a", i, h - v, 1, v);
      }
    } else if (id === "animator") {
      fill("#2d2a3a");
      const bx = Math.floor((Math.sin(t * 2.2) * 0.5 + 0.5) * (w - 2));
      const by = Math.floor(Math.abs(Math.sin(t * 5)) * (h - 3));
      dot("#b39ddb", bx, h - 3 - by, 2, 2);
      dot("#5a5470", 0, h - 1, w, 1);
    } else if (id === "editor") {
      fill("#1f2a38");
      const off = Math.floor(t * 6);
      const cols = ["#82a0bd", "#f2d47a", "#b39ddb", "#7fc28a"];
      for (let i = 0; i < w; i++) {
        dot(cols[Math.floor((i + off) / 3) % 4], i, 2);
        dot(cols[Math.floor((i + off + 2) / 2) % 4], i, 5);
      }
      dot("#e5566c", 5, 0, 1, h);
    } else if (id === "delivery") {
      fill("#2d2a24");
      dot("#5a5040", 1, 3, w - 2, 2);
      dot("#e8a46a", 1, 3, Math.floor((t * 3) % (w - 2)) + 1, 2);
    }
    s.tex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- dunia
  _mat(name) {
    if (!this.mats[name]) {
      const glow = name.startsWith("glow:");
      const map = makeTexture(glow ? name.slice(5) : name);
      this.mats[name] = glow ? new THREE.MeshBasicMaterial({ map }) : new THREE.MeshLambertMaterial({ map });
    }
    return this.mats[name];
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight("#eaf6ff", "#a89478", 1.5);
    this.sun = new THREE.DirectionalLight("#fff4e0", 1.6);
    this.sun.position.set(19, 18, 19);
    this.sun.target.position.set(9, -1, 5);
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    Object.assign(cam, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 80 });
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);
  }

  _buildWorld() {
    const b = new Builder();
    const box = (...a) => b.box(...a);
    const onBack = (a, c, y0, y1, depth, mat) => b.box(a, y0, 0, c, y1, depth, mat, { layer: "wallBack" });
    const onLeft = (a, c, y0, y1, depth, mat) => b.box(0, y0, a, depth, y1, c, mat, { layer: "wallLeft" });
    const plates = [];

    // ---- jalan, trotoar, pepohonan
    box(-16, -GF - 0.5, -14, 34, -GF, 24, "cobble");
    box(-1.5, -GF, -1.5, 19.5, -GF + 0.25, 11.5, { top: "pave", side: "stone:#8f8578" });
    const tree = (x, z, big) => {
      const h = big ? 2 : 1.5;
      box(x - 0.25, -GF, z - 0.25, x + 0.25, -GF + h, z + 0.25, { side: "log", top: "logtop" });
      const s = big ? 1.5 : 1;
      const y = -GF + h - 0.5;
      box(x - s, y, z - s, x + s, y + 1, z + s, "leaves");
      box(x - s + 0.5, y + 1, z - s + 0.5, x + s - 0.5, y + 1.5, z + s - 0.5, "leaves");
    };
    tree(-5, -3, true);
    tree(-2, -6.5, false);
    tree(10, -5, true);
    tree(17, -6.5, false);
    tree(23.5, 1.5, true);
    tree(-4.5, 13.5, false);
    box(4, -GF + 0.25, -3.2, 9, -GF + 0.75, -2.2, "leaves"); // pagar tanaman
    const lampPost = (x, z) => {
      box(x - 0.08, -GF, z - 0.08, x + 0.08, -0.75, z + 0.08, "flat:#2f3a3a");
      box(x - 0.2, -0.75, z - 0.2, x + 0.2, -0.35, z + 0.2, "glow:lamp");
      this.lampSpots.push({ pos: [x, -0.55, z], range: 7, power: 2.6, halo: 1.6 });
      box(x - 0.26, -0.35, z - 0.26, x + 0.26, -0.27, z + 0.26, "flat:#2f3a3a");
    };
    lampPost(-0.9, 12.4);
    lampPost(20.6, 4.0);
    lampPost(10.0, 12.6);
    box(13.6, -GF, 12.2, 15.8, -GF + 0.28, 12.7, "planks:#c8915f"); // bangku
    box(13.6, -GF, 12.6, 15.8, -GF + 0.65, 12.72, "planks:#c8915f");

    // ---- lantai dasar (fasad toko)
    const g0 = -GF + 0.25;
    box(0, g0, 0, 18, -0.5, 10, "plaster");
    box(-0.04, g0, -0.04, 18.04, g0 + 0.35, 10.04, "stone");
    box(0, -0.5, 0, 18, 0, 10, { top: "planks:#d7a06e", side: "band" });
    const shopWindow = (a, c) => {
      box(a, g0 + 0.45, 10, c, -1.1, 10.05, "cream");
      box(a + 0.1, g0 + 0.55, 10, c - 0.1, -1.2, 10.07, SHOP_GLASS);
      box(a - 0.1, g0 + 0.35, 10, c + 0.1, g0 + 0.45, 10.2, "band");
    };
    shopWindow(0.8, 3.4);
    shopWindow(4.0, 6.6);
    shopWindow(11.6, 14.2);
    shopWindow(14.8, 17.4);
    box(7.3, g0, 10, 10.3, -1.0, 10.05, "cream"); // kusen pintu
    box(7.55, g0, 10, 8.75, -1.15, 10.1, "vplanks:#9a6240");
    box(8.85, g0, 10, 10.05, -1.15, 10.1, "vplanks:#9a6240");
    box(7.85, -1.95, 10.1, 8.45, -1.45, 10.12, SHOP_GLASS);
    box(9.15, -1.95, 10.1, 9.75, -1.45, 10.12, SHOP_GLASS);
    box(8.6, -2.15, 10.1, 9.0, -2.05, 10.16, "flat:#f2d47a");
    box(7.0, -1.1, 10, 10.6, -0.95, 10.6, "awning"); // kanopi bertingkat
    box(7.0, -1.25, 10.6, 10.6, -1.1, 11.2, "awning");
    const planter = (a, c) => {
      box(a, g0, 10.2, c, g0 + 0.35, 10.7, "planks:#5f8f6c");
      box(a + 0.05, g0 + 0.35, 10.25, c - 0.05, g0 + 0.5, 10.65, "leaves");
      for (let x = a + 0.2, i = 0; x < c - 0.1; x += 0.45, i++) {
        const col = ["#e5566c", "#fffaf0", "#f2d47a", "#82a0bd"][i % 4];
        box(x, g0 + 0.5, 10.38, x + 0.12, g0 + 0.62, 10.5, `flat:${col}`);
      }
    };
    planter(1.0, 3.2);
    planter(4.2, 6.4);
    planter(11.8, 14.0);
    planter(15.0, 17.2);
    for (const [a, c] of [[0.6, 2.0], [3.0, 6.4], [7.4, 9.4]]) {
      box(18, g0 + 0.45, a, 18.05, -1.1, c, "cream");
      box(18, g0 + 0.55, a + 0.1, 18.07, -1.2, c - 0.1, SHOP_GLASS);
    }
    // papan nama gedung
    box(4.6, -1.0, 10, 13.8, -0.05, 10.08, "flat:#2f5d4a");
    plates.push([textPlate("KIKI CLASSROOM", 9.0, 0.85, { ink: "#fff4dc", bg: "#2f5d4a" }), 9.2, -0.525, 10.085, 0]);

    // ---- lantai atas: lorong, karpet, keset
    box(0, 0, 4, 15, 0.03, 6, "weave");
    for (const [id, [x, z, w, d]] of Object.entries(RUGS)) {
      const c = AGENTS[id].rug;
      box(x, 0, z, x + w, 0.04, z + d, `wool:${c[1]}`);
      box(x + 0.12, 0, z + 0.12, x + w - 0.12, 0.05, z + d - 0.12, `wool:${c[0]}`);
      box(x + 0.35, 0, z + 0.35, x + w - 0.35, 0.06, z + d - 0.35, `wool:${c[2]}`);
      box(x + 0.55, 0, z + 0.55, x + w - 0.55, 0.07, z + d - 0.55, `wool:${c[0]}`);
    }
    for (const [x, z] of [[2, 4], [7, 4], [12, 4]]) box(x + 0.1, 0, z + 0.1, x + 0.9, 0.06, z + 0.9, "wool:#c97b6b");
    for (const [x, z] of [[3, 5], [8, 5], [13, 5]]) box(x + 0.1, 0, z + 0.1, x + 0.9, 0.06, z + 0.9, "wool:#7fae8a");

    // ---- dinding belakang (z = 0) & kiri (x = 0), bisa disembunyikan saat kamera di baliknya
    b.layer = "wallBack";
    for (const [a, c, wp] of [[0, 5, "pink"], [5, 10, "mint"], [10, 15, "cream"], [15, 18, "sage"]]) {
      box(a, 0, -0.5, c, WALL_H, 0, { pz: `wp:${wp}`, top: "cream", side: "plaster" });
    }
    box(-0.5, -0.5, -0.5, 0, WALL_H, 0, { top: "cream", side: "plaster" });
    box(0, 0, 0, 18, 0.2, 0.06, "planks:#c79b80");
    box(0, WALL_H - 0.2, 0, 18, WALL_H, 0.08, "cream");
    for (const x of [5, 10, 15]) box(x - 0.08, 0, 0, x + 0.08, WALL_H, 0.1, "flat:#e2c3ad");
    b.layer = "wallLeft";
    // pintu samping (z DOOR_Z0..DOOR_Z1) di ruang pengirim: jalan masuk dari tangga luar
    for (const [a, c, wp] of [[0, 4, "pink"], [4, 6, "cream"], [6, DOOR_Z0, "pink"], [DOOR_Z1, 10, "pink"]]) {
      box(-0.5, 0, a, 0, WALL_H, c, { px: `wp:${wp}`, top: "cream", side: "plaster" });
    }
    box(-0.5, 1.4, DOOR_Z0, 0, WALL_H, DOOR_Z1, { px: "wp:pink", top: "cream", side: "plaster" });
    box(0, 0, 0, 0.06, 0.2, DOOR_Z0, "planks:#b98b70");
    box(0, 0, DOOR_Z1, 0.06, 0.2, 10, "planks:#b98b70");
    box(0, 1.3, DOOR_Z0 - 0.1, 0.06, 1.4, DOOR_Z1 + 0.1, "cream");
    box(0, 0, DOOR_Z0 - 0.1, 0.06, 1.4, DOOR_Z0, "cream");
    box(0, 0, DOOR_Z1, 0.06, 1.4, DOOR_Z1 + 0.1, "cream");
    box(0, WALL_H - 0.2, 0, 0.08, WALL_H, 10, "cream");
    b.layer = "main";
    box(-0.5, -0.5, DOOR_Z0, 0, 0, DOOR_Z1, { top: "planks:#c8915f", side: "plaster" }); // ambang pintu

    // tangga luar di sisi kiri gedung: trotoar -> bordes setinggi lantai atas -> pintu samping
    const stairX0 = -1.6;
    const stairX1 = -0.5;
    box(stairX0, g0, DOOR_Z0 - 0.2, stairX1, 0, 10, { top: "planks:#c8915f", side: "stone" });
    for (let i = 1; i <= 10; i++) {
      const z1 = DOOR_Z0 - 0.2 - (10 - i) * 0.5;
      box(stairX0, g0, z1 - 0.5, stairX1, g0 + i * 0.25, z1, { top: "planks:#c8915f", side: "stone" });
    }
    box(stairX0 - 0.1, 0, DOOR_Z0 - 0.2, stairX0, 0.6, 10, { side: "rail", top: "flat:#d2ebd0" });
    box(stairX0, 0, 9.9, stairX1, 0.6, 10, { side: "rail", top: "flat:#d2ebd0" });

    // jendela bertirai, pigura, papan
    const windowBack = (a, c, curtain) => {
      onBack(a - 0.15, c + 0.15, 0.75, 1.65, 0.05, "cream");
      onBack(a, c, 0.85, 1.55, 0.07, "glass");
      onBack(a - 0.5, c + 0.5, 1.72, 1.78, 0.14, "planks:#8b5a3c");
      onBack(a - 0.45, a + 0.2, 0.6, 1.75, 0.12, `wool:${curtain}`);
      onBack(c - 0.2, c + 0.45, 0.6, 1.75, 0.12, `wool:${curtain}`);
      onBack(a - 0.2, c + 0.2, 0.68, 0.75, 0.1, "cream");
    };
    windowBack(0.8, 2.2, "#e48f9e");
    windowBack(5.7, 7.1, "#7fb98d");
    windowBack(13.0, 14.4, "#d8b25c");
    windowBack(15.4, 16.8, "#c07a64");
    const picture = (on, a, c, y0, y1, inner, accent) => {
      on(a, c, y0, y1, 0.05, "planks:#b98a52");
      on(a + 0.07, c - 0.07, y0 + 0.07, y1 - 0.07, 0.06, `flat:${inner}`);
      if (accent) on(a + (c - a) * 0.3, c - (c - a) * 0.3, y0 + 0.14, y0 + (y1 - y0) * 0.55, 0.07, `flat:${accent}`);
    };
    picture(onBack, 3.0, 3.5, 1.0, 1.43, "#fbe2e8", "#e5566c");
    picture(onBack, 3.7, 4.5, 0.86, 1.5, "#e0edf8", "#f2d47a");
    onBack(7.7, 9.3, 0.7, 1.57, 0.06, "chalk");
    onBack(10.4, 12.6, 0.7, 1.64, 0.08, "foam");
    picture(onLeft, 1.0, 1.7, 1.07, 1.64, "#fbf0cf", "#7fc28a");
    picture(onLeft, 2.0, 2.5, 1.29, 1.71, "#e4f4e7", "#82a0bd");
    onLeft(4.3, 5.7, 0.86, 1.71, 0.06, "cork");
    onLeft(6.6, 8.2, 0.93, 1.86, 0.05, "cream");
    onLeft(6.75, 8.05, 1.03, 1.76, 0.07, "glass");
    // bendera segitiga warna-warni di dinding penulis
    for (let i = 0; i < 7; i++) {
      const z = 0.3 + i * 0.5;
      const col = ["#e5566c", "#f2d47a", "#82a0bd", "#7fc28a"][i % 4];
      onLeft(z, z + 0.4, 1.95, 2.07, 0.04, `flat:${col}`);
      onLeft(z + 0.1, z + 0.3, 1.87, 1.95, 0.04, `flat:${col}`);
    }

    // ---- sekat rendah antar ruangan (sama dengan _buildStatics di office.js)
    const lowMat = { top: "cream", side: "brick" };
    const wallX = (z, a, c) => box(a, 0, z - 0.12, c, LOW_H, z + 0.12, lowMat);
    const wallZ = (x, a, c) => box(x - 0.12, 0, a, x + 0.12, LOW_H, c, lowMat);
    wallX(4, 0, 2); wallX(4, 3, 7); wallX(4, 8, 12); wallX(4, 13, 15);
    wallX(6, 0, 3); wallX(6, 4, 8); wallX(6, 9, 13); wallX(6, 14, 15);
    wallZ(5, 0, 4); wallZ(10, 0, 4); wallZ(5, 6, 10); wallZ(10, 6, 10);
    wallZ(15, 0, 4); wallZ(15, 6, 10);

    // ---- balkon depan & kanan
    box(0, 0, 9.82, 17.82, 0.64, 10, { side: "rail", top: "flat:#d2ebd0" });
    box(17.82, 0, 0, 18, 0.64, 10, { side: "rail", top: "flat:#d2ebd0" });
    for (const x of [0, 3, 6, 9, 12, 15]) box(x - 0.12, 0, 9.72, x + 0.18, 0.8, 10.04, "cream");
    for (const z of [3, 6, 9]) box(17.72, 0, z - 0.12, 18.04, 0.8, z + 0.18, "cream");
    const globe = (x, z) => {
      box(x - 0.18, 0, z - 0.18, x + 0.18, 0.86, z + 0.18, "cream");
      box(x - 0.14, 0.86, z - 0.14, x + 0.14, 1.14, z + 0.14, "glow:lamp");
      this.lampSpots.push({ pos: [x, 1.0, z], range: 4, power: 1.4, halo: 1.0 });
      box(x - 0.17, 1.14, z - 0.17, x + 0.17, 1.2, z + 0.17, "flat:#3d2a26");
    };
    globe(0.03, 9.87);
    globe(17.88, 9.88);
    globe(17.87, 0.13);

    // ---- meja kerja + monitor + kursi tiap agent
    for (const [id, r] of Object.entries(ROOMS)) this._buildDesk(b, id, r);

    // ---- perabot lain (posisi sama dengan versi 2D)
    const plant = (x, z, big) => {
      box(x - 0.17, 0, z - 0.17, x + 0.17, 0.34, z + 0.17, { side: "pot", top: "flat:#6b4a32" });
      const s = big ? 0.3 : 0.22;
      box(x - s, 0.34, z - s, x + s, 0.34 + s * 2, z + s, "leaves");
      if (big) box(x - 0.15, 0.94, z - 0.15, x + 0.15, 1.18, z + 0.15, "leaves");
    };
    [[4.5, 0.5, true], [5.6, 0.5, false], [14.6, 3.5, false], [17.5, 9.4, true], [0.5, 5.6, true],
      [14.4, 4.4, false], [4.5, 9.5, false], [9.5, 9.5, true], [14.5, 9.5, false]].forEach((p) => plant(...p));
    // penulis: rak buku + lampu lantai
    box(0.1, 0, 0.6, 0.65, 1.5, 2.4, { px: "books", side: "planks:#a46f45", top: "planks:#a46f45" });
    box(0.62, 0, 3.32, 0.78, 0.05, 3.48, "flat:#3d2a26");
    box(0.67, 0, 3.37, 0.73, 1.55, 3.43, "flat:#5a3d30");
    box(0.5, 1.5, 3.2, 0.9, 1.85, 3.6, "glow:lamp:#f6c9a4");
    this.lampSpots.push({ pos: [0.7, 1.6, 3.4], range: 4, power: 1.6, halo: 1.1 });
    // keamanan: lemari arsip
    box(9.2, 0, 0.25, 9.85, 1.15, 0.85, { pz: "cabinet", side: "metal" });
    // suara: stand mic + speaker
    box(10.75, 0, 1.25, 11.05, 0.04, 1.55, "flat:#3d2a26");
    box(10.88, 0, 1.38, 10.92, 1.3, 1.42, "flat:#3d2a26");
    box(10.83, 1.3, 1.33, 10.97, 1.55, 1.47, "metal:#9aa3ad");
    box(14.25, 0, 0.3, 14.8, 0.95, 0.8, { pz: "speaker", side: "flat:#3d4253" });
    // admin: rak, sofa, meja kopi, kursi kuning
    box(15.4, 0, 0.15, 16.9, 1.5, 0.65, { pz: "books", side: "planks:#a46f45", top: "planks:#a46f45" });
    const sofa = "wool:#e48f9e";
    box(16.1, 0, 8.0, 17.8, 0.34, 8.75, sofa);
    box(16.1, 0, 8.55, 17.8, 0.8, 8.75, sofa);
    box(16.1, 0, 8.0, 16.35, 0.55, 8.75, sofa);
    box(17.55, 0, 8.0, 17.8, 0.55, 8.75, sofa);
    box(16.1, 0, 6.4, 17.1, 0.34, 7.0, "planks:#c8915f");
    box(16.3, 0.34, 6.55, 16.55, 0.36, 6.8, "flat:#fffaf0");
    box(16.75, 0.34, 6.55, 16.85, 0.5, 6.75, "flat:#e5566c");
    // kursi kuning digeser dari ambang pintu (di 3D akan menghalangi jalur kurir)
    box(17.0, 0, 4.7, 17.78, 0.34, 5.4, "wool:#f2d47a");
    box(17.58, 0, 4.7, 17.78, 0.7, 5.4, "wool:#f2d47a");
    // lorong: dispenser air + bangku
    box(9.42, 0, 4.14, 9.78, 0.85, 4.5, "cooler");
    box(9.47, 0.85, 4.19, 9.73, 1.35, 4.45, "water");
    box(3.4, 0, 4.15, 4.8, 0.3, 4.55, "planks:#c8915f");
    // pengirim: tumpukan paket
    box(4.0, 0, 6.3, 4.8, 0.42, 7.1, "cardboard");
    box(4.12, 0.42, 6.42, 4.68, 0.78, 6.98, "cardboard");
    box(4.2, 0.78, 6.5, 4.6, 1.06, 6.9, "cardboard");
    box(3.4, 0, 8.8, 4.2, 0.3, 9.4, "cardboard");
    // editor: rak pita + beanbag
    box(9.0, 0, 6.25, 9.8, 1.0, 6.95, { pz: "tapes", side: "planks:#a46f45", top: "planks:#a46f45" });
    box(8.5, 0, 8.7, 9.4, 0.28, 9.5, "wool:#82a0bd");
    box(8.6, 0.28, 8.8, 9.3, 0.42, 9.4, "wool:#9ab7d2");
    // animasi: easel + kaleng cat
    for (const [x, z] of [[14.05, 6.85], [14.75, 6.85], [14.4, 7.15]]) box(x - 0.03, 0, z - 0.03, x + 0.03, 1.3, z + 0.03, "flat:#7a5236");
    box(13.95, 0.6, 6.88, 14.85, 1.25, 6.94, { pz: "painting", side: "flat:#fffaf0" }, { fit: true });
    [["#e5566c", 0], ["#82a0bd", 0.45], ["#f2d47a", 0.9]].forEach(([c, o]) => {
      box(12.7 + o, 0, 9.1, 13.05 + o, 0.28, 9.45, { side: `flat:${c}`, top: `flat:${tint(c, 0.15)}` });
    });

    this.layers = b.build((name) => this._mat(name));
    this.solids = b.solids;
    this.pickables = [];
    for (const group of Object.values(this.layers)) {
      this.scene.add(group);
      group.children.forEach((m) => this.pickables.push(m));
    }

    // papan nama ruangan (dinding belakang / pagar balkon) + papan gedung
    for (const [id, r] of Object.entries(ROOMS)) {
      const { a, b: bb, on } = r.plaque;
      const opts = { ink: AGENTS[id].plaqueInk, bg: "#fff6ea", border: "#3d2a26" };
      if (on === "wall") plates.push([textPlate(AGENTS[id].label, bb - a, 0.48, opts), (a + bb) / 2, 2.03, 0.07, 0, "wallBack"]);
      else plates.push([textPlate(AGENTS[id].label, bb - a, 0.44, opts), (a + bb) / 2, 0.34, 10.05, 0]);
    }
    for (const [mesh, x, y, z, rot, layer] of plates) {
      mesh.position.set(x, y, z);
      mesh.rotation.y = rot;
      mesh.receiveShadow = true;
      (layer ? this.layers[layer] : this.scene).add(mesh);
    }
  }

  // meja (sama ukurannya dengan versi 2D), monitor menghadap kursi, kursi berwarna agent
  _buildDesk(b, id, r) {
    const box = (...a) => b.box(...a);
    const dk = r.desk;
    const top = 0.5;
    const [x0, z0, x1, z1] = [dk.x, dk.y, dk.x + dk.w, dk.y + dk.d];
    box(x0, top - 0.08, z0, x1, top, z1, "planks:#c8915f");
    for (const [x, z] of [[x0 + 0.05, z0 + 0.05], [x1 - 0.13, z0 + 0.05], [x0 + 0.05, z1 - 0.13]]) {
      box(x, 0, z, x + 0.08, top - 0.08, z + 0.08, "planks:#8c5c38");
    }
    box(x0 + 1.25, 0, z0 + 0.1, x1 - 0.05, top - 0.08, z1 - 0.05, "planks:#b77f52"); // laci
    box(x0 + 1.55, 0.22, z1 - 0.05, x0 + 1.7, 0.27, z1 - 0.02, "flat:#f2d47a");

    // satu kanvas layar per agent, dipakai bersama bila monitornya dua (editor)
    const c = document.createElement("canvas");
    c.width = 12;
    c.height = 8;
    const tex = pixelTexture(c, false);
    this.screens[id] = { g: c.getContext("2d"), tex };
    this._paintScreen(id);
    const screenMat = new THREE.MeshBasicMaterial({ map: tex });
    const monitors = id === "editor" ? [x0 + 0.6, x0 + 1.4] : [x0 + 1];
    const mz = z0 + 0.35;
    for (const mx of monitors) {
      box(mx - 0.15, top, mz - 0.1, mx + 0.15, top + 0.03, mz + 0.1, "flat:#3d2a26");
      box(mx - 0.04, top, mz - 0.04, mx + 0.04, top + 0.14, mz + 0.04, "flat:#3d2a26");
      box(mx - 0.34, top + 0.12, mz - 0.07, mx + 0.34, top + 0.56, mz + 0.03, "flat:#3d2a26");
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.38), screenMat);
      scr.position.set(mx, top + 0.34, mz + 0.032);
      this.scene.add(scr);
    }
    box(x0 + 0.75, top, z0 + 0.62, x0 + 1.3, top + 0.03, z0 + 0.82, "keys");
    box(x0 + 1.7, top, z0 + 0.5, x0 + 1.82, top + 0.12, z0 + 0.62, `flat:${AGENTS[id].shirt}`);
    box(x0 + 0.2, top, z0 + 0.2, x0 + 0.3, top + 0.4, z0 + 0.3, "flat:#3d2a26");
    box(x0 + 0.1, top + 0.4, z0 + 0.1, x0 + 0.4, top + 0.55, z0 + 0.4, "glow:lamp:#f2d47a");
    this.lampSpots.push({ pos: [x0 + 0.25, top + 0.45, z0 + 0.35], range: 2.6, power: 0.9, halo: 0.6 });

    // kursi di depan monitor, sandaran menghadap kamera
    const s = seatOf(id);
    const col = `wool:${AGENTS[id].chair}`;
    box(s.gx - 0.04, 0, s.gy - 0.04, s.gx + 0.04, 0.26, s.gy + 0.04, "flat:#3d2a26");
    box(s.gx - 0.2, 0, s.gy - 0.04, s.gx + 0.2, 0.04, s.gy + 0.04, "flat:#3d2a26");
    box(s.gx - 0.04, 0, s.gy - 0.2, s.gx + 0.04, 0.04, s.gy + 0.2, "flat:#3d2a26");
    box(s.gx - 0.23, 0.26, s.gy - 0.23, s.gx + 0.23, 0.34, s.gy + 0.23, col);
    box(s.gx - 0.23, 0.34, s.gy + 0.15, s.gx + 0.23, 0.78, s.gy + 0.23, col);
  }
}

// ------------------------------------------------------------------ bantuan posisi
// Di 2D kursi digeser diagonal agar pas di layar isometrik; di 3D kursi tepat di depan monitor.
export function seatOf(id) {
  const dk = ROOMS[id].desk;
  return { gx: dk.x + 1, gy: dk.y + dk.d + 0.38 };
}

function isVisible(obj) {
  for (let o = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function roomAt(x, z) {
  for (const [id, r] of Object.entries(ROOMS)) {
    if (x >= r.x && x < r.x + r.w && z >= r.y && z < r.y + r.d) return id;
  }
  return null;
}
