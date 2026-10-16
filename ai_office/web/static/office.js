// Kiki Classroom - kantor pixel art 2.5D (isometrik, cutaway seperti diorama). Tiap agent punya
// ruangan sendiri. Saat job pindah tahap, agent berdiri, mengangkat hasil kerjanya, lalu berjalan
// lewat lorong ke ruangan agent berikutnya untuk menyerahkannya. Semua digambar ke kanvas
// beresolusi rendah (W x H) lalu diperbesar tanpa smoothing. Murni Canvas 2D, tanpa aset gambar:
// latar (jalan, fasad, lantai, dinding) dan lapisan depan (balkon) digambar sekali lalu di-cache.
"use strict";

import { sfx } from "/static/sfx.js";

// ------------------------------------------------------------------ dunia & proyeksi
const W = 400;
const H = 264;
const OX = 160; // posisi layar sudut belakang lantai atas (grid 0,0)
const OY = 56;
const HW = 10; // setengah lebar ubin (ubin 20x10 pixel)
const HH = 5;
const WALL_H = 34; // tinggi dinding belakang
const LOW_H = 8; // tinggi sekat antar ruangan
const GH = 46; // tinggi lantai atas dari jalan (fasad lantai dasar)

// grid -> layar; h = ketinggian dalam pixel di atas lantai atas (negatif = di bawahnya)
function iso(gx, gy, h = 0) {
  return { x: OX + (gx - gy) * HW, y: OY + (gx + gy) * HH - h };
}

function toGrid(px, py) {
  const a = (px - OX) / HW;
  const b = (py - OY) / HH;
  return { gx: (a + b) / 2, gy: (b - a) / 2 };
}

const PAL = {
  outline: "#3d2a26",
  slabL: "#3a3f47",
  slabR: "#2a2e34",
  hallA: "#a9b2bc",
  hallB: "#a0a9b3",
  wood: "#c9a77c",
  woodB: "#bf9c70",
  wallL: "#b4bec9",
  wallR: "#cdd5dd",
  wallTop: "#f1f0ec",
  wallTrim: "#8b96a3",
  lowL: "#7f8b98",
  lowR: "#97a2ae",
  lowTop: "#dfe3e8",
  desk: "#b08960",
  deskL: "#8c6a4a",
  deskR: "#77583c",
  metal: "#5a6270",
  metalL: "#474e59",
  metalR: "#3b414b",
  screenOff: "#22262c",
  white: "#fffaf0",
  ink: "#3d2a26",
  green: "#7fc28a",
  yellow: "#f2d47a",
  red: "#d9776b",
  blue: "#82a0bd",
  tan: "#e3c58f",
  plant: "#6fa36f",
  plantDark: "#4f7f55",
  pot: "#c47a5a",
  potDark: "#9c5d44",
};

const STATE_COLOR = {
  working: PAL.yellow,
  just_done: PAL.green,
  idle: PAL.blue,
  offline: "#6b7280",
};

// ------------------------------------------------------------------ agent & ruangan
export const AGENTS = {
  writer: {
    rug: ["#f2b8c6", "#d9879e", "#fbe2e8"], chair: "#c97b8e", plaqueInk: "#b84f6c",
    label: "PENULIS", name: "Penulis Naskah", shirt: "#e8a0bf", hair: "#6b4a32",
    acc: "glasses", accColor: "#22252a", item: "script",
    role: "Menulis naskah video dari topik.",
  },
  safety: {
    rug: ["#bfe3c7", "#7fb98d", "#e4f4e7"], chair: "#7fb98d", plaqueInk: "#3f7a57",
    label: "KEAMANAN", name: "Penasihat Keamanan", shirt: "#7fc28a", hair: "#2b2b30",
    acc: "hardhat", accColor: "#f2d47a", item: "checked",
    role: "Memeriksa naskah supaya aman untuk anak.",
  },
  voice: {
    rug: ["#f6dfa0", "#d8b25c", "#fbf0cf"], chair: "#8a7a3a", plaqueInk: "#a07c22",
    label: "SUARA", name: "Pengisi Suara", shirt: "#f2d47a", hair: "#7b4f92",
    acc: "headphones", accColor: "#3b4048", item: "cassette",
    role: "Membacakan naskah jadi rekaman suara.",
  },
  animator: {
    rug: ["#d6c4ee", "#a18ccc", "#ece4f8"], chair: "#8f7fb8", plaqueInk: "#7a5fb0",
    label: "ANIMASI", name: "Pembuat Animasi", shirt: "#b39ddb", hair: "#d98aa8",
    acc: "beret", accColor: "#c75c5c", item: "reel",
    role: "Menggambar animasi untuk tiap scene.",
  },
  editor: {
    rug: ["#bcd6ee", "#7ea2c8", "#e0edf8"], chair: "#4f6f8f", plaqueInk: "#4f6f8f",
    label: "EDITOR", name: "Editor", shirt: "#82a0bd", hair: "#3a2a22",
    acc: "cap", accColor: "#3f6f9f", item: "tape",
    role: "Menggabungkan suara, animasi, subtitle, dan musik.",
  },
  delivery: {
    rug: ["#f6c9a4", "#d9946a", "#fde5cf"], chair: "#b77a4a", plaqueInk: "#c26a32",
    label: "PENGIRIM", name: "Pengirim", shirt: "#e8a46a", hair: "#a4532e",
    acc: "cap", accColor: "#7a4b2a", item: "box",
    role: "Mengirim video jadi ke folder tujuan.",
  },
  admin: {
    rug: ["#e8b4a0", "#c07a64", "#f6dacd"], chair: "#6b5a7a", plaqueInk: "#5a6270",
    label: "ADMIN", name: "Admin", shirt: "#5a6270", hair: "#9aa0a8",
    acc: "tie", accColor: "#d9776b", item: "stamped",
    role: "Menyetujui naskah dan video final.",
  },
};

export const ITEM_NAME = {
  script: "naskah",
  checked: "naskah yang lolos cek",
  revise: "catatan revisi",
  cassette: "rekaman suara",
  reel: "animasi",
  tape: "video",
  box: "paket video",
  stamped: "berkas yang disetujui",
  envelope: "job baru",
};

// Ruangan baris belakang: pintu di sisi depan (gy=4). Baris depan: pintu di sisi belakang (gy=6).
function backRoom(x) {
  return {
    x, y: 0, w: 5, d: 4, row: "back",
    desk: { x: x + 1.5, y: 0.6, w: 2, d: 1 },
    // kursi digeser diagonal dari tengah meja: di layar tepat di bawah monitor
    seat: { gx: x + 3.25, gy: 1.85 },
    spot: { gx: x + 4.2, gy: 2.6 },
    inner: [],
    door: { gx: x + 2.5, gy: 3.6 },
    hall: { gx: x + 2.5, gy: 5 },
    roam: [{ gx: x + 0.7, gy: 3.3 }, { gx: x + 4.4, gy: 1.2 }, { gx: x + 4.2, gy: 3.4 }],
    plaque: { on: "wall", a: [0.8, 5.6, 11.2][x / 5], b: [4.6, 9.8, 14.4][x / 5] },
  };
}

function frontRoom(x) {
  const y = 6;
  return {
    x, y, w: 5, d: 4, row: "front",
    desk: { x: x + 0.6, y: y + 1.0, w: 2, d: 1 },
    seat: { gx: x + 2.35, gy: y + 2.25 },
    spot: { gx: x + 3.0, gy: y + 2.9 },
    inner: [{ gx: x + 3.2, gy: y + 2.3 }],
    door: { gx: x + 3.5, gy: y + 0.4 },
    hall: { gx: x + 3.5, gy: 5 },
    roam: [{ gx: x + 4.3, gy: y + 2.3 }, { gx: x + 1.2, gy: y + 3.5 }, { gx: x + 4.3, gy: y + 1.4 }],
    plaque: { on: "rail", a: [0.6, 5.8, 10.9][x / 5], b: [4.6, 9.4, 14.8][x / 5] },
  };
}

export const ROOMS = {
  writer: backRoom(0),
  safety: backRoom(5),
  voice: backRoom(10),
  delivery: frontRoom(0),
  editor: frontRoom(5),
  animator: frontRoom(10),
  admin: {
    x: 15, y: 0, w: 3, d: 10,
    desk: { x: 15.8, y: 2.0, w: 2, d: 1 },
    seat: { gx: 17.55, gy: 3.25 },
    spot: { gx: 16.4, gy: 4.0 },
    inner: [],
    door: { gx: 15.6, gy: 5 },
    hall: { gx: 14.4, gy: 5 },
    roam: [{ gx: 17.2, gy: 6.4 }, { gx: 16.0, gy: 7.0 }, { gx: 17.3, gy: 4.9 }],
    plaque: { on: "wall", a: 15.2, b: 17.9 },
  },
};

const STREET_PEOPLE = {
  a: { hair: "#3b2b2b", shirt: "#e58fa6", pants: "#f5f0e6", acc: "bun" },
  b: { hair: "#c99a52", shirt: "#7fb6d9", pants: "#3f4b6b" },
  c: { hair: "#5a3a2a", shirt: "#f2d47a", pants: "#6d5b4a", skin: "#c9946c" },
  d: { hair: "#2b2b30", shirt: "#9cc7a4", pants: "#4b4f5c" },
  e: { hair: "#7a4a2a", shirt: "#d98a5c", pants: "#3b4048", skin: "#e0b088" },
};

// barang yang ditunggu admin di tiap gerbang persetujuan
export const GATE_ITEM = { awaiting_script_approval: "checked", awaiting_final_approval: "tape" };

// tahap job -> lokasi (ruangan) yang mengerjakannya
export const STAGE_ROOM = {
  writing: "writer",
  safety_review: "safety",
  awaiting_script_approval: "admin",
  voicing: "voice",
  animating: "animator",
  editing: "editor",
  awaiting_final_approval: "admin",
  delivering: "delivery",
  uploading: "delivery",
};

// Event job -> { entry: pesan log kantor, action: rencana animasi }. Fungsi murni tanpa gambar,
// dipakai bersama oleh Office (2D) dan Office3D supaya alur & teksnya selalu sama.
export function planJobEvent(type, job) {
  if (type === "job_created") {
    return { action: { kind: "new", banner: [`JOB BARU: ${job.id}`, "blue"] },
      entry: { tag: "BARU", kind: "info", text: `Job #${job.id} masuk: "${job.topic}"` } };
  }
  if (type !== "job_status") return null;
  const prev = job.previous;
  const next = job.status;
  if (!prev || prev === next) return null;
  const from = STAGE_ROOM[prev];
  const to = STAGE_ROOM[next];
  const title = job.title || job.topic;

  if (next === "done") {
    return { action: { kind: "done", banner: [`VIDEO ${job.id} SELESAI!`, "green"] },
      entry: { tag: "SELESAI", kind: "ok", text: `Video #${job.id} selesai: "${title}"` } };
  }
  if (next === "failed") {
    const who = from || "writer";
    return { action: { kind: "fail", who, banner: [`JOB ${job.id} GAGAL`, "red"] },
      entry: { tag: "GAGAL", kind: "bad", text: `Job #${job.id} gagal di ruang ${AGENTS[who].label}` } };
  }
  if (next === "rejected") {
    return { action: { kind: "reject" },
      entry: { tag: "DITOLAK", kind: "bad", text: `ADMIN menolak job #${job.id}` } };
  }
  if (!from || !to || from === to) return null;
  const deliver = (f, t, item, opts) => ({ kind: "deliver", from: f, to: t, item, opts });

  if (from === "admin") {
    const item = GATE_ITEM[prev] || "stamped";
    return { action: deliver("admin", to, item, { say: "OK!", recvSay: "SIAP!", fromInbox: true }),
      entry: { tag: "DISETUJUI", kind: "ok",
        text: `ADMIN menyetujui dan mengantar ${ITEM_NAME[item]} ke ${AGENTS[to].label}` } };
  }
  if (prev === "safety_review" && next === "writing") {
    return { action: deliver("safety", "writer", "revise", { say: "REVISI", recvSay: "OKE!", sfx: "revise" }),
      entry: { tag: "REVISI", kind: "warn", text: "KEAMANAN minta PENULIS merevisi naskah" } };
  }
  const item = AGENTS[from].item;
  if (to === "admin") {
    return { action: deliver(from, "admin", item, { say: "!", sfx: "bell" }),
      entry: { tag: "MENUNGGU", kind: "warn",
        text: `${AGENTS[from].label} mengirim ${ITEM_NAME[item]} ke ADMIN, menunggu persetujuan` } };
  }
  return { action: deliver(from, to, item, { say: "!", recvSay: "+1" }),
    entry: { tag: "ANTAR", kind: "info",
      text: `${AGENTS[from].label} menyerahkan ${ITEM_NAME[item]} ke ${AGENTS[to].label}` } };
}

// ------------------------------------------------------------------ pixel font 3x5
const GLYPHS = {
  A: [".#.", "#.#", "###", "#.#", "#.#"], B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"], D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"], F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"], H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"], J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"], L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"], N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."], P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"], R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."], T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"], V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"], X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."], Z: ["###", "..#", ".#.", "#..", "###"],
  0: ["###", "#.#", "#.#", "#.#", "###"], 1: [".#.", "##.", ".#.", ".#.", "###"],
  2: ["##.", "..#", ".#.", "#..", "###"], 3: ["##.", "..#", ".#.", "..#", "##."],
  4: ["#.#", "#.#", "###", "..#", "..#"], 5: ["###", "#..", "##.", "..#", "##."],
  6: [".##", "#..", "###", "#.#", "###"], 7: ["###", "..#", ".#.", ".#.", ".#."],
  8: ["###", "#.#", "###", "#.#", "###"], 9: ["###", "#.#", "###", "..#", "##."],
  " ": ["...", "...", "...", "...", "..."], "!": [".#.", ".#.", ".#.", "...", ".#."],
  "?": ["##.", "..#", ".#.", "...", ".#."], ".": ["...", "...", "...", "...", ".#."],
  ":": ["...", ".#.", "...", ".#.", "..."], "-": ["...", "...", "###", "...", "..."],
  "+": ["...", ".#.", "###", ".#.", "..."], "/": ["..#", "..#", ".#.", "#..", "#.."],
  "#": ["#.#", "###", "#.#", "###", "#.#"], "%": ["#.#", "..#", ".#.", "#..", "#.#"],
  "(": [".#.", "#..", "#..", "#..", ".#."], ")": [".#.", "..#", "..#", "..#", ".#."],
  "'": [".#.", ".#.", "...", "...", "..."], ",": ["...", "...", "...", ".#.", "#.."],
  "*": ["#.#", ".#.", "###", ".#.", "#.#"], "@": [".##", ".#.", ".#.", "##.", "##."],
  "^": ["...", ".#.", "###", "###", ".#."], "<": ["..#", ".#.", "#..", ".#.", "..#"],
  ">": ["#..", ".#.", "..#", ".#.", "#.."],
};

function textWidth(str) {
  return Math.max(0, String(str).length * 4 - 1);
}

export function drawText(g, str, x, y, color) {
  g.fillStyle = color;
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of String(str).toUpperCase()) {
    const glyph = GLYPHS[ch] || GLYPHS["?"];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) if (glyph[r][c] === "#") g.fillRect(cx + c, cy + r, 1, 1);
    }
    cx += 4;
  }
}

// ------------------------------------------------------------------ primitif pixel
// Isi poligon cembung baris per baris (tanpa antialias) supaya tepinya tetap pixel tajam.
function fillPoly(g, pts, color) {
  g.fillStyle = color;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const y0 = Math.ceil(minY - 0.5);
  const y1 = Math.floor(maxY - 0.5);
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    let xl = Infinity;
    let xr = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) {
        const x = a.x + ((cy - a.y) * (b.x - a.x)) / (b.y - a.y);
        xl = Math.min(xl, x);
        xr = Math.max(xr, x);
      }
    }
    const L = Math.round(xl);
    const R = Math.round(xr);
    if (R > L) g.fillRect(L, y, R - L, 1);
  }
}

function pxLine(g, x0, y0, x1, y1, color) {
  g.fillStyle = color;
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

const up = (p, h) => ({ x: p.x, y: p.y - h });

// Balok isometrik: alas (x,y) ukuran w x d ubin, tinggi h pixel, melayang z pixel.
// `line` = warna outline siluet (gaya pixel art); tepi depan atas diberi kilap tipis.
function box(g, x, y, w, d, h, z, top, left, right, line) {
  const T = iso(x, y, z + h);
  const R = iso(x + w, y, z + h);
  const B = iso(x + w, y + d, z + h);
  const L = iso(x, y + d, z + h);
  const R0 = iso(x + w, y, z);
  const B0 = iso(x + w, y + d, z);
  const L0 = iso(x, y + d, z);
  fillPoly(g, [L, B, B0, L0], left || shade(top, -0.14));
  fillPoly(g, [B, R, R0, B0], right || shade(top, -0.27));
  fillPoly(g, [T, R, B, L], top);
  if (!line) return;
  for (const [a, b] of [[T, R], [R, R0], [R0, B0], [B0, L0], [L0, L], [L, T]]) pxLine(g, a.x, a.y, b.x, b.y, line);
  if (typeof top === "string") {
    const hi = shade(top, 0.18);
    pxLine(g, L.x, L.y, B.x, B.y, hi);
    pxLine(g, B.x, B.y, R.x, R.y, hi);
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  const r = f(n >> 16);
  const gg = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1)}`;
}

// ------------------------------------------------------------------ sprite
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Sprite dari baris karakter + palet, otomatis diberi outline gelap 1px.
function buildSprite(rows, colors, outline = PAL.outline) {
  const h = rows.length;
  const w = rows[0].length;
  const c = makeCanvas(w + 2, h + 2);
  const g = c.getContext("2d");
  const filled = (x, y) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== ".";
  if (outline) {
    g.fillStyle = outline;
    for (let y = -1; y <= h; y++) {
      for (let x = -1; x <= w; x++) {
        if (filled(x, y)) continue;
        if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
          g.fillRect(x + 1, y + 1, 1, 1);
        }
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === ".") continue;
      g.fillStyle = colors[ch] || "#ff00ff";
      g.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  return c;
}

const BODY_FRONT = [
  "..hhhh..", ".hhhhhh.", ".hssssh.", ".sesses.", ".ssssss.", "..srrs..",
  ".cccccc.", "sccccccs", "sccccccs", ".dddddd.", ".pp..pp.", ".pp..pp.", ".kk..kk.",
];
const BODY_BACK = [
  "..hhhh..", ".hhhhhh.", ".hhhhhh.", ".hhhhhh.", ".shhhhs.", "..ssss..",
  ".cccccc.", "sccccccs", "sccccccs", ".dddddd.", ".pp..pp.", ".pp..pp.", ".kk..kk.",
];
const LEGS = {
  stand: [".pp..pp.", ".pp..pp.", ".kk..kk."],
  walkA: [".pp..pp.", ".pp...kk", ".kk....."],
  walkB: [".pp..pp.", "kk...pp.", ".....kk."],
};
const ACCESSORY = {
  glasses: { front: { 3: ".gwggwg." }, back: {} },
  hardhat: { front: { 0: "..aaaa..", 1: ".aaaaaa.", 2: "aaaaaaaa" },
    back: { 0: "..aaaa..", 1: ".aaaaaa.", 2: "aaaaaaaa" } },
  headphones: { front: { 0: "..aaaa..", 3: "asessesa", 4: "assssssa" },
    back: { 0: "..aaaa..", 3: "ahhhhhha", 4: "ashhhhsa" } },
  beret: { front: { 0: ".aaaaa..", 1: "aaaaaaa." }, back: { 0: "..aaaaa.", 1: ".aaaaaaa" } },
  cap: { front: { 0: "..aaaa..", 1: ".aaaaaa.", 2: "aaaaaa.." }, back: { 0: "..aaaa..", 1: ".aaaaaa." } },
  tie: { front: { 6: ".ccaacc.", 7: "sccaaccs", 8: "sccaaccs" }, back: {} },
  bun: { front: { 0: "..hhhh..", 1: "hhhhhhhh" }, back: { 0: "..hhhh..", 1: "hhhhhhhh" } },
};

function withRows(base, overrides) {
  const rows = base.slice();
  for (const [i, row] of Object.entries(overrides)) rows[Number(i)] = row;
  return rows;
}

function setPx(rows, x, y, ch) {
  rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
}

function armsUp(rows) {
  const r = rows.slice();
  for (let y = 1; y <= 5; y++) { setPx(r, 0, y, "c"); setPx(r, 7, y, "c"); }
  setPx(r, 0, 0, "s");
  setPx(r, 7, 0, "s");
  for (const y of [7, 8]) { setPx(r, 0, y, "."); setPx(r, 7, y, "."); }
  return r;
}

function buildCharacter(def) {
  const colors = {
    h: def.hair, s: def.skin || "#f2c9a5", e: "#3d2a26", r: "#d9776b", c: def.shirt,
    d: shade(def.shirt, -0.22), p: def.pants || "#4b4f5c", k: "#3d2a26", a: def.accColor || "#3d2a26",
    w: "#fffaf0", g: "#3d2a26",
  };
  const acc = ACCESSORY[def.acc] || { front: {}, back: {} };
  const front = withRows(BODY_FRONT, acc.front);
  const back = withRows(BODY_BACK, acc.back);
  const legs = (rows, kind) => withRows(rows, { 10: LEGS[kind][0], 11: LEGS[kind][1], 12: LEGS[kind][2] });
  const spr = (rows) => buildSprite(rows, colors);
  const frames = {};
  for (const [view, rows] of [["front", front], ["back", back]]) {
    for (const kind of ["stand", "walkA", "walkB"]) {
      frames[`${view}_${kind}`] = spr(legs(rows, kind));
      frames[`${view}_carry_${kind}`] = spr(legs(armsUp(rows), kind));
    }
  }
  // duduk (dilihat dari belakang): tanpa kaki, lengan bergantian = mengetik
  const sitA = back.slice(0, 10);
  const sitB = sitA.slice();
  sitB[7] = ".cccccc.";
  sitB[8] = "sccccccs";
  frames.sit_a = spr(sitA);
  frames.sit_b = spr(sitB);
  frames.sleep = spr(["........", "........", ...back.slice(0, 4), ...back.slice(6, 10)]);
  const cheer = armsUp(front);
  cheer[4] = ".sseess.";
  frames.cheer = spr(cheer);
  const sad = front.slice();
  sad[3] = def.acc === "glasses" ? ".gkggkg." : ".skssks.";
  sad[5] = "..skks..";
  frames.sad = spr(sad);
  return frames;
}

const ITEM_ROWS = {
  script: { rows: ["wwww", "wllw", "wwww", "wllw", "wwww"], colors: { w: "#f1f0ec", l: "#9aa0a8" } },
  checked: { rows: ["wwwww", "wwwgw", "gwgww", "wgwww", "wwwww"], colors: { w: "#f1f0ec", g: "#4f9f5a" } },
  revise: { rows: ["wwwww", "wrwrw", "wwrww", "wrwrw", "wwwww"], colors: { w: "#f1f0ec", r: "#c4544a" } },
  cassette: { rows: ["yyyyyy", "ywkkwy", "yyyyyy"], colors: { y: "#f2d47a", w: "#f1f0ec", k: "#3b4048" } },
  reel: { rows: [".ppp.", "pwpwp", "ppkpp", "pwpwp", ".ppp."], colors: { p: "#b39ddb", w: "#f1f0ec", k: "#3b4048" } },
  tape: { rows: ["kwkwk", "kkkkk", "bbbbb", "bwwwb", "bbbbb"], colors: { k: "#22252a", w: "#f1f0ec", b: "#3f6f9f" } },
  box: { rows: ["TTyTT", "ttytt", "ttytt", "ttttt"], colors: { T: "#d8a46e", t: "#c08a55", y: "#f2d47a" } },
  stamped: { rows: ["wwwww", "wwrrw", "wwrrw", "wwwww", "wllww"], colors: { w: "#f1f0ec", r: "#d9776b", l: "#9aa0a8" } },
  envelope: { rows: ["wwwwww", "wkwwkw", "wwkkww", "wwwwww"], colors: { w: "#f1f0ec", k: "#9aa0a8" } },
  trophy: { rows: ["y...y", "yyyyy", ".yyy.", "..y..", ".yyy."], colors: { y: "#f2d47a" } },
};

const CAT_ROWS = {
  walkA: [".....o.o", ".....ooo", "o....oeo", ".oooooo.", ".oooooo.", ".o.o.o.o"],
  walkB: [".....o.o", ".....ooo", "o....oeo", ".oooooo.", ".oooooo.", "..o.o.o."],
  sit: [".....o.o", ".....ooo", ".....oeo", "o...ooo.", ".o.oooo.", "..ooooo."],
};

// ------------------------------------------------------------------ kantor
export class Office {
  constructor(canvas, { onSelect } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onSelect = onSelect || (() => {});
    this.screen = makeCanvas(W, H); // kanvas resolusi rendah
    this.g = this.screen.getContext("2d");
    this.bg = null;
    this.fg = null;
    this.glows = [];
    this.bgKey = "";
    this.states = {};
    this.time = 0;
    this.particles = [];
    this.banner = null;
    this.hover = null;
    this.selected = null;
    this.inbox = [];
    this.toAdmin = 0; // kurir yang sedang/akan berjalan ke meja admin
    this.failed = {}; // agent -> waktu berakhirnya tanda gagal
    this.sprites = {};
    for (const [id, def] of Object.entries(AGENTS)) this.sprites[id] = buildCharacter(def);
    this.items = {};
    for (const [k, v] of Object.entries(ITEM_ROWS)) this.items[k] = buildSprite(v.rows, v.colors);
    const catColors = { o: "#f2c14e", e: "#3d2a26" };
    // pejalan kaki di jalan (hiasan statis)
    this.streetSprites = {};
    for (const [k, def] of Object.entries(STREET_PEOPLE)) this.streetSprites[k] = buildCharacter(def);
    this.catSprites = {};
    for (const [k, rows] of Object.entries(CAT_ROWS)) this.catSprites[k] = buildSprite(rows, catColors);

    this.actors = {};
    for (const id of Object.keys(AGENTS)) {
      const r = ROOMS[id];
      this.actors[id] = {
        id, home: id, gx: r.seat.gx, gy: r.seat.gy, mode: "seat", path: [], speed: 2.6,
        carry: null, face: "back", flip: false, walkDist: 0, tasks: [], busy: false,
        bubble: null, jumpUntil: 0, cheerUntil: 0, sadUntil: 0, waitUntil: 0, after: null,
        onArrive: null, nextRoam: 4 + Math.random() * 8, roaming: false, stepT: 0,
      };
    }
    this.cat = { gx: 7, gy: 5, path: [], mode: "sit", flip: false, walkDist: 0,
      next: 3, bubble: null, jumpUntil: 0 };

    this.statics = this._buildStatics();
    this._bindPointer();
    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  // ---------------------------------------------------------------- API publik
  setStates(agents) {
    for (const a of agents) {
      const prev = this.states[a.agent]?.state;
      this.states[a.agent] = a;
      if (prev && prev !== a.state && a.state === "working") delete this.failed[a.agent];
    }
  }

  start() {
    if (this.raf) return;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.time += dt;
      this._update(dt);
      this._draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // jeda loop gambar (dipakai saat dashboard pindah ke tampilan 3D)
  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  select(id) {
    if (!ROOMS[id]) return;
    this.selected = id;
    const a = this.actors[id];
    this._say(a, AGENTS[id].label, 1.6, PAL.white);
    a.jumpUntil = this.time + 0.35;
    sfx.play("select");
    this.onSelect(id);
  }

  // Terjemahkan event job dari server jadi animasi. Mengembalikan pesan untuk log kantor.
  jobEvent(type, job) {
    const plan = planJobEvent(type, job);
    if (!plan) return null;
    const act = plan.action;
    if (act.banner) this._showBanner(act.banner[0], PAL[act.banner[1]]);
    if (act.kind === "new") {
      this._dropEnvelope();
      sfx.play("coin");
    } else if (act.kind === "done") {
      this._celebrate();
    } else if (act.kind === "fail") {
      this._fail(act.who);
    } else if (act.kind === "reject") {
      this._adminTask(() => this._reject());
    } else if (act.kind === "deliver") {
      // admin baru berangkat setelah kiriman untuknya benar-benar tiba di meja
      const opts = act.opts.fromInbox ? { ...act.opts, ready: this._inboxReady() } : act.opts;
      this._deliver(act.from, act.to, act.item, opts);
    }
    return plan.entry;
  }

  // ---------------------------------------------------------------- aksi animasi
  _deliver(fromId, destId, item, opts = {}) {
    const a = this.actors[fromId];
    const toAdmin = destId === "admin";
    if (toAdmin) this.toAdmin += 1;
    this._enqueue(a, { toAdmin, ready: opts.ready, run: () => this._runDelivery(a, destId, item, opts) });
  }

  // tugas admin tanpa berjalan (mis. menolak), tetap menunggu kiriman tiba dulu
  _adminTask(fn) {
    const a = this.actors.admin;
    this._enqueue(a, { ready: this._inboxReady(), run: () => { fn(); a.busy = false; } });
  }

  _inboxReady() {
    const since = this.time;
    // batas 20 detik supaya antrean tidak macet bila ada event yang terlewat
    return () => this.inbox.length > 0 || this.toAdmin === 0 || this.time - since > 20;
  }

  _enqueue(a, task) {
    if (a.tasks.length > 3) {
      // event terlalu cepat: buang antrean lama
      const dropped = a.tasks.shift();
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

  _runDelivery(a, destId, item, opts) {
    if (opts.fromInbox) item = this.inbox.shift() || item;
    const home = ROOMS[a.home];
    const dest = ROOMS[destId];
    a.carry = item;
    a.mode = "walk";
    this._say(a, opts.say || "!", 0.9, opts.say === "REVISI" ? PAL.red : PAL.white);
    sfx.play("pickup");
    a.path = [...home.inner.slice().reverse(), home.door, home.hall, dest.hall, dest.door, dest.spot];
    a.onArrive = () => {
      a.carry = null;
      a.mode = "stand";
      a.face = "back";
      sfx.play(opts.sfx || "handoff");
      this._receive(destId, item, opts, a);
      a.waitUntil = this.time + 0.8;
      a.after = () => {
        a.mode = "walk";
        a.path = [dest.door, dest.hall, home.hall, home.door, ...home.inner, home.seat];
        a.onArrive = () => this._sitDown(a);
      };
    };
  }

  _sitDown(a) {
    a.mode = "seat";
    a.face = "back";
    a.busy = false;
    a.roaming = false;
    a.nextRoam = this.time + 6 + Math.random() * 10;
    this._kick(a);
  }

  _receive(destId, item, opts, courier) {
    const spot = iso(courier.gx, courier.gy);
    const deskTop = this._deskTop(destId);
    // barang melambung dari tangan kurir ke meja penerima
    this.particles.push({ kind: "item", sprite: this.items[item], x: spot.x, y: spot.y - 18,
      tx: deskTop.x, ty: deskTop.y - 4, t: 0, life: 0.55 });
    for (let i = 0; i < 6; i++) this._sparkle(deskTop.x, deskTop.y - 6, PAL.yellow);
    if (destId === "admin") {
      this.toAdmin = Math.max(0, this.toAdmin - 1);
      this.inbox.push(item);
      this._say(this.actors.admin, "?", 2.5, PAL.yellow);
      return;
    }
    const r = this.actors[destId];
    if (opts.recvSay) this._say(r, opts.recvSay, 1.4, PAL.white);
    if (r.mode === "seat") r.jumpUntil = this.time + 0.35;
    this._floatText(deskTop.x, deskTop.y - 14, opts.recvSay === "OKE!" ? "REVISI" : "+1 TUGAS",
      opts.recvSay === "OKE!" ? PAL.red : PAL.green);
  }

  _dropEnvelope() {
    const top = this._deskTop("writer");
    this.particles.push({ kind: "drop", sprite: this.items.envelope, x: top.x, y: -10,
      ty: top.y - 3, vy: 0, bounced: 0, life: 3.2, t: 0 });
    this._say(this.actors.writer, "!", 1.8, PAL.yellow);
  }

  _celebrate() {
    sfx.play("done");
    const d = this.actors.delivery;
    d.cheerUntil = this.time + 2.4;
    const p = iso(d.gx, d.gy);
    this.particles.push({ kind: "sprite", sprite: this.items.trophy, x: p.x, y: p.y - 22, vy: -6,
      life: 2.2, t: 0 });
    Object.values(this.actors).forEach((a, i) => {
      setTimeout(() => (a.jumpUntil = this.time + 0.4), i * 120);
    });
    const colors = [PAL.yellow, PAL.green, PAL.red, PAL.blue, "#b39ddb", "#e8a0bf"];
    for (let i = 0; i < 90; i++) {
      this.particles.push({ kind: "confetti", x: Math.random() * W, y: -Math.random() * 40,
        vx: (Math.random() - 0.5) * 20, vy: 10 + Math.random() * 25, color: colors[i % 6],
        life: 4 + Math.random() * 2, t: 0, w: Math.random() < 0.5 ? 1 : 2 });
    }
  }

  _fail(id) {
    sfx.play("fail");
    const a = this.actors[id];
    this.failed[id] = this.time + 10;
    a.sadUntil = this.time + 4;
    this._say(a, "!", 3, PAL.red);
    const top = this._deskTop(id);
    for (let i = 0; i < 10; i++) {
      this.particles.push({ kind: "smoke", x: top.x + (Math.random() - 0.5) * 6, y: top.y - 8,
        vx: (Math.random() - 0.5) * 4, vy: -6 - Math.random() * 6, life: 1.6 + Math.random(),
        t: -i * 0.12 });
    }
  }

  _reject() {
    sfx.play("reject");
    this.inbox.shift();
    this._say(this.actors.admin, "X", 2, PAL.red);
    const top = this._deskTop("admin");
    this._floatText(top.x, top.y - 14, "DITOLAK", PAL.red);
  }

  _say(a, text, dur, color = PAL.white) {
    a.bubble = { text, until: this.time + dur, color };
  }

  _floatText(x, y, text, color) {
    this.particles.push({ kind: "text", text, x, y, vy: -10, color, life: 1.4, t: 0 });
  }

  _sparkle(x, y, color) {
    this.particles.push({ kind: "star", x, y, vx: (Math.random() - 0.5) * 30,
      vy: -10 - Math.random() * 20, color, life: 0.6 + Math.random() * 0.4, t: 0 });
  }

  _showBanner(text, color) {
    this.banner = { text, color, start: this.time, until: this.time + 3.2 };
  }

  _deskTop(id) {
    const dk = ROOMS[id].desk;
    return up(iso(dk.x + dk.w / 2, dk.y + dk.d / 2), 8);
  }

  // ---------------------------------------------------------------- update
  _update(dt) {
    for (const a of Object.values(this.actors)) this._updateActor(a, dt);
    this._updateCat(dt);
    for (const p of this.particles) {
      p.t += dt;
      if (p.t < 0) continue;
      if (p.kind === "drop") {
        p.vy += 260 * dt;
        p.y += p.vy * dt;
        if (p.y >= p.ty && p.vy > 0) {
          p.y = p.ty;
          p.vy = p.bounced++ < 2 ? -p.vy * 0.35 : 0;
          if (p.bounced === 1) sfx.play("paper");
        }
      } else if (p.kind !== "item") {
        if (p.vx) p.x += p.vx * dt;
        if (p.vy) p.y += p.vy * dt;
        if (p.kind === "star") p.vy += 60 * dt;
        if (p.kind === "confetti") p.x += Math.sin(p.t * 6 + p.y) * 0.3;
      }
    }
    this.particles = this.particles.filter((p) => p.t < p.life);
    if (this.banner && this.time > this.banner.until) this.banner = null;

    // efek ambient per status
    for (const id of Object.keys(ROOMS)) {
      const st = this.states[id]?.state;
      const a = this.actors[id];
      if (a.mode !== "seat") continue;
      const top = this._deskTop(id);
      if (st === "just_done" && Math.random() < dt * 3) this._sparkle(top.x, top.y - 10, PAL.green);
      if (st === "working" && Math.random() < dt * 0.7) {
        const glyph = { voice: "@", animator: "*", writer: ".", safety: "?" }[id];
        if (glyph) {
          this.particles.push({ kind: "text", text: glyph, x: top.x + 4, y: top.y - 14, vy: -6,
            color: AGENTS[id].shirt, life: 1.2, t: 0 });
        }
      }
    }
  }

  _updateActor(a, dt) {
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
        if (a.stepT > 0.3) {
          a.stepT = 0;
          sfx.play("step");
          const p = iso(a.gx, a.gy);
          this.particles.push({ kind: "dust", x: p.x + (Math.random() - 0.5) * 3, y: p.y,
            vy: -2, life: 0.4, t: 0 });
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
    if (!a.busy && !a.tasks.length && a.mode === "seat" && canRoam && this.time > a.nextRoam) {
      const r = ROOMS[a.home];
      const target = r.roam[Math.floor(Math.random() * r.roam.length)];
      a.busy = true;
      a.roaming = true;
      a.mode = "walk";
      a.path = [...r.inner.slice().reverse(), target];
      a.onArrive = () => {
        a.mode = "stand";
        a.face = "front";
        if (Math.random() < 0.5) this._say(a, ["@", "...", "*"][Math.floor(Math.random() * 3)], 1.5);
        a.waitUntil = this.time + 1.5 + Math.random() * 2;
        a.after = () => {
          a.mode = "walk";
          a.path = [...r.inner, r.seat];
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
      const dy = t.gy - a.gy;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-3) {
        a.path.shift();
        continue;
      }
      // arah layar: turun = menghadap depan, naik = menghadap belakang
      const sx = dx - dy;
      const sy = dx + dy;
      a.face = sy > 0 ? "front" : "back";
      a.flip = sx < 0;
      const stepLen = Math.min(dist, remaining);
      a.gx += (dx / dist) * stepLen;
      a.gy += (dy / dist) * stepLen;
      a.walkDist += stepLen;
      remaining -= stepLen;
      if (stepLen >= dist) a.path.shift();
    }
  }

  _updateCat(dt) {
    const c = this.cat;
    if (c.path.length) {
      this._stepAlong(c, dt, 1.4);
      c.mode = c.path.length ? "walk" : "sit";
      if (!c.path.length) c.next = this.time + 4 + Math.random() * 8;
      return;
    }
    if (this.time > c.next) {
      c.path = [{ gx: 0.8 + Math.random() * 13, gy: 4.4 + Math.random() * 1.2 }];
    }
  }

  // ---------------------------------------------------------------- input
  _bindPointer() {
    const pick = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      return { px, py, ...toGrid(px, py) };
    };
    this.canvas.addEventListener("mousemove", (e) => {
      const p = pick(e);
      this.hover = this._roomAt(p.gx, p.gy);
      this.canvas.style.cursor = this.hover || this._catAt(p.px, p.py) ? "pointer" : "default";
    });
    this.canvas.addEventListener("mouseleave", () => (this.hover = null));
    this.canvas.addEventListener("click", (e) => {
      const p = pick(e);
      if (this._catAt(p.px, p.py)) {
        sfx.play("meow");
        this.cat.bubble = { text: "MEOW", until: this.time + 1.4, color: PAL.white };
        this.cat.jumpUntil = this.time + 0.35;
        return;
      }
      const id = this._roomAt(p.gx, p.gy);
      if (id) this.select(id);
    });
  }

  _roomAt(gx, gy) {
    for (const [id, r] of Object.entries(ROOMS)) {
      if (gx >= r.x && gx < r.x + r.w && gy >= r.y && gy < r.y + r.d) return id;
    }
    return null;
  }

  _catAt(px, py) {
    const p = iso(this.cat.gx, this.cat.gy);
    return px >= p.x - 6 && px <= p.x + 6 && py >= p.y - 9 && py <= p.y + 2;
  }

  _resize() {
    const wrap = this.canvas.parentElement;
    const avail = Math.max(160, wrap ? wrap.clientWidth : W);
    // skala bulat bila muat (piksel paling rapi), selain itu skala pecahan agar pas di layar kecil
    const scale = avail >= W * 2 ? Math.floor(avail / W) : avail / W;
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.style.width = `${Math.floor(W * scale)}px`;
    this.canvas.style.height = `${Math.floor(H * scale)}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  // ---------------------------------------------------------------- gambar
  _draw() {
    const g = this.g;
    const key = skyKey();
    if (!this.bg || this.bgKey !== key) {
      this.glows = [];
      this.bg = this._buildBackground(key);
      this.fg = this._buildForeground(key);
      this.bgKey = key;
    }
    g.clearRect(0, 0, W, H);
    g.drawImage(this.bg, 0, 0);
    if (this.hover || this.selected) this._drawRoomHighlight(g);

    const list = this.statics.slice();
    for (const a of Object.values(this.actors)) {
      list.push({ depth: a.gx + a.gy + 0.05, draw: () => this._drawActor(g, a) });
    }
    list.push({ depth: this.cat.gx + this.cat.gy, draw: () => this._drawCat(g) });
    list.sort((p, q) => p.depth - q.depth);
    for (const d of list) d.draw(g);
    g.drawImage(this.fg, 0, 0);

    if (SKY[key].night) this._drawNight(g);
    this._drawStatusLights(g);
    this._drawParticles(g);
    this._drawBubbles(g);
    this._drawBanner(g);

    this.ctx.clearRect(0, 0, W, H);
    this.ctx.drawImage(this.screen, 0, 0);
  }

  // Latar statis (digambar sekali per suasana waktu): jalan, fasad, lantai, dinding belakang.
  _buildBackground(key) {
    const c = makeCanvas(W, H);
    const g = c.getContext("2d");
    const pat = buildPatterns(g);
    const night = SKY[key].night;
    const glass = night ? "#ffd98a" : SKY[key].glass;

    // jalan berbatu + trotoar
    g.fillStyle = pat.cobble;
    g.fillRect(0, 0, W, H);
    fillPoly(g, [gnd(-1.4, -1.4), gnd(19.6, -1.4), gnd(19.6, 11.6), gnd(-1.4, 11.6)], pat.pave);
    fillPoly(g, [gnd(-1.4, 11.6), gnd(19.6, 11.6), gnd(19.6, 11.6, -2), gnd(-1.4, 11.6, -2)], "#8f8578");
    fillPoly(g, [gnd(19.6, 11.6), gnd(19.6, -1.4), gnd(19.6, -1.4, -2), gnd(19.6, 11.6, -2)], "#7f7568");

    // pohon, pagar tanaman, dan orang di jalan belakang (tertutup gedung sebagian)
    drawTree(g, gnd(-5, -3), true);
    drawTree(g, gnd(-2, -6), false);
    drawTree(g, gnd(10, -5), true);
    drawTree(g, gnd(17, -6), false);
    box(g, 4, -3.2, 5, 0.8, 7, -GH, "#79b866", "#5e9a50", "#4e8544", "#3f6d3a");
    this._streetPerson(g, gnd(-12, 2), "a", "front_stand");
    this._streetPerson(g, gnd(-11, 3.2), "b", "front_walkA", true);
    this._streetPerson(g, gnd(-10.2, 1.2), "c", "back_stand");

    // fasad lantai dasar
    const leftFace = [iso(0, 10), iso(18, 10), gnd(18, 10), gnd(0, 10)];
    const rightFace = [iso(18, 10), iso(18, 0), gnd(18, 0), gnd(18, 10)];
    fillPoly(g, leftFace, pat.plaster);
    fillPoly(g, rightFace, pat.plaster);
    fillPoly(g, rightFace, "rgba(120,70,20,0.16)");
    const faceL = (a, b, h0, h1, color) => fillPoly(g, [iso(a, 10, h1), iso(b, 10, h1), iso(b, 10, h0), iso(a, 10, h0)], color);
    const faceR = (a, b, h0, h1, color) => fillPoly(g, [iso(18, a, h1), iso(18, b, h1), iso(18, b, h0), iso(18, a, h0)], color);
    faceL(0, 18, -7, 0, "#8fc29b");
    faceL(0, 18, -1.5, 0, "#c6e6c6");
    faceR(10, 0, -7, 0, "#74a883");
    faceL(0, 18, -GH, -GH + 5, "#bcae9c");
    faceR(10, 0, -GH, -GH + 5, "#a3968a");
    edge(g, iso(0, 10, -7), iso(18, 10, -7), "#5d8a6c");
    edge(g, iso(18, 10, -7), iso(18, 0, -7), "#4f7a5d");
    edge(g, gnd(0, 10, 5), gnd(18, 10, 5), "#8f8578");
    edge(g, iso(18, 10), gnd(18, 10), "#a98f5c");
    const shopWindow = (a, b, items) => {
      faceL(a, b, -38, -13, "#fff3dc");
      faceL(a + 0.15, b - 0.15, -36.5, -14.5, glass);
      fillPoly(g, [iso(a + 0.5, 10, -15), iso(a + 0.9, 10, -15), iso(a + 0.5, 10, -36), iso(a + 0.1, 10, -36)], "rgba(255,255,255,0.35)");
      for (const it of items) faceL(it[0], it[0] + it[2], it[1] - it[3], it[1], it[4]);
      faceL(a - 0.1, b + 0.1, -40, -38, "#8fc29b");
      outlineL(g, a, b, -38, -13);
      if (night) this.glows.push(glowBox(iso((a + b) / 2, 10.6, -26), 26, 22));
    };
    shopWindow(0.8, 3.4, [[1.0, -30, 0.5, 6, "#e8a0bf"], [1.6, -30, 0.5, 9, "#82a0bd"], [2.2, -30, 0.5, 5, "#f2d47a"], [2.8, -30, 0.4, 7, "#7fc28a"]]);
    shopWindow(4.0, 6.6, [[4.4, -30, 1.6, 10, "#f6e7c8"], [4.7, -24, 0.4, 3, "#e5566c"], [5.3, -27, 0.5, 4, "#6f7fd0"]]);
    shopWindow(11.6, 14.2, [[12.0, -30, 0.6, 12, "#fbd34d"], [12.8, -30, 0.6, 8, "#e98f85"], [13.5, -30, 0.5, 10, "#9cc7a4"]]);
    shopWindow(14.8, 17.4, [[15.2, -30, 1.8, 3, "#b39ddb"], [15.6, -27, 1.0, 6, "#f5d9c9"]]);
    // pintu kayu + kanopi
    faceL(7.3, 10.3, -40, -6, "#fff3dc");
    faceL(7.6, 10.0, -38, -6, "#9a6240");
    faceL(7.8, 8.7, -35, -9, "#ad7350");
    faceL(8.9, 9.8, -35, -9, "#ad7350");
    faceL(8.1, 8.5, -33, -26, glass);
    faceL(9.2, 9.6, -33, -26, glass);
    faceL(8.6, 8.8, -23, -21, "#f2d47a");
    outlineL(g, 7.3, 10.3, -40, -6);
    fillPoly(g, [iso(7.0, 10, -40), iso(10.6, 10, -40), iso(10.6, 11.2, -35), iso(7.0, 11.2, -35)], pat.awning);
    fillPoly(g, [iso(7.0, 11.2, -35), iso(10.6, 11.2, -35), iso(10.6, 11.2, -33), iso(7.0, 11.2, -33)], "#e98f85");
    edge(g, iso(7.0, 11.2, -33), iso(10.6, 11.2, -33), "#b9645c");
    // jendela sisi kanan
    for (const w of [[2.0, 0.6], [6.4, 3.0], [9.4, 7.4]]) {
      faceR(w[0], w[1], -36, -14, "#fff3dc");
      faceR(w[0] - 0.15, w[1] + 0.15, -34.5, -15.5, glass);
      outlineR(g, w[0], w[1], -36, -14);
      if (night) this.glows.push(glowBox(iso(18.6, (w[0] + w[1]) / 2, -26), 22, 22));
    }
    fillPoly(g, [iso(18, 5.8, -16), iso(18, 5.3, -16), iso(18, 3.6, -34), iso(18, 4.1, -34)], "rgba(255,255,255,0.3)");
    // papan nama gedung
    faceL(4.6, 13.8, -7.8, -1.2, "#2f5d4a");
    outlineL(g, 4.6, 13.8, -7.8, -1.2);
    drawTextSkew(g, "KIKI CLASSROOM", iso(6.45, 10, -2.2), "#fff4dc", 0.5);

    // lantai atas: parket, lorong herringbone, karpet, keset
    fillPoly(g, [iso(0, 0), iso(18, 0), iso(18, 10), iso(0, 10)], pat.wood);
    fillPoly(g, [iso(0, 4), iso(15, 4), iso(15, 6), iso(0, 6)], pat.herring);
    for (const [id, r] of Object.entries(RUGS)) drawRug(g, r, AGENTS[id].rug);
    for (const m of [[2, 4], [7, 4], [12, 4]]) tileFill(g, m[0] + 0.1, m[1] + 0.1, 0.8, 0.8, "#c97b6b");
    for (const m of [[3, 5], [8, 5], [13, 5]]) tileFill(g, m[0] + 0.1, m[1] + 0.1, 0.8, 0.8, "#7fae8a");

    // dinding belakang ber-wallpaper
    const wpR = [[0, 5, pat.wpPink], [5, 10, pat.wpMint], [10, 15, pat.wpCream], [15, 18, pat.wpSage]];
    for (const s of wpR) wallR(g, s[0], s[1], 0, WALL_H, s[2]);
    const wpL = [[0, 4, pat.wpPink], [4, 6, pat.wpCream], [6, 10, pat.wpPink]];
    for (const s of wpL) wallL(g, s[0], s[1], 0, WALL_H, s[2]);
    wallL(g, 0, 10, 0, WALL_H, "rgba(90,45,25,0.12)");
    wallR(g, 0, 18, 0, 3, "#c79b80");
    wallL(g, 0, 10, 0, 3, "#b98b70");
    wallR(g, 0, 18, 30.5, WALL_H, "#fbebd8");
    wallL(g, 0, 10, 30.5, WALL_H, "#efdcc6");
    edge(g, iso(0, 0, 3), iso(18, 0, 3), "#a77f66");
    edge(g, iso(0, 0, 3), iso(0, 10, 3), "#9c7560");
    edge(g, iso(0, 0, 30.5), iso(18, 0, 30.5), "#dcc2aa");
    edge(g, iso(0, 0, 30.5), iso(0, 10, 30.5), "#d4b8a0");
    fillPoly(g, [iso(0, 0, WALL_H), iso(18, 0, WALL_H), iso(18, -0.4, WALL_H), iso(-0.4, -0.4, WALL_H), iso(-0.4, 10, WALL_H), iso(0, 10, WALL_H)], "#fff6ea");
    fillPoly(g, [iso(18, 0, WALL_H), iso(18, -0.4, WALL_H), iso(18, -0.4, 0), iso(18, 0, 0)], "#d8b9a3");
    fillPoly(g, [iso(0, 10, WALL_H), iso(-0.4, 10, WALL_H), iso(-0.4, 10, 0), iso(0, 10, 0)], "#e6cbb6");
    edge(g, iso(-0.4, -0.4, WALL_H), iso(18, -0.4, WALL_H), INK);
    edge(g, iso(-0.4, -0.4, WALL_H), iso(-0.4, 10, WALL_H), INK);
    edge(g, iso(18, -0.4, WALL_H), iso(18, -0.4, 0), INK);
    edge(g, iso(-0.4, 10, WALL_H), iso(-0.4, 10, 0), INK);
    for (const x of [5, 10, 15]) wallR(g, x - 0.08, x + 0.08, 0, WALL_H, "#e2c3ad");

    // jendela, pigura, poster
    const skyGlass = night ? "#2e3a62" : SKY[key].glass;
    const windowR = (a, b, h0, h1, curtain) => {
      wallR(g, a - 0.15, b + 0.15, h0 - 1.5, h1 + 1.5, "#fff6ea");
      wallR(g, a, b, h0, h1, skyGlass);
      wallR(g, a + 0.15, a + 0.6, h1 - 6, h1 - 3, night ? "#f5f0dc" : "#ffffff");
      wallR(g, (a + b) / 2 - 0.05, (a + b) / 2 + 0.05, h0, h1, "#fff6ea");
      wallR(g, a, b, (h0 + h1) / 2 - 0.5, (h0 + h1) / 2 + 0.5, "#fff6ea");
      wallR(g, a - 0.5, b + 0.5, h1 + 2, h1 + 3, "#8b5a3c");
      wallR(g, a - 0.45, a + 0.25, h0 - 3, h1 + 2, curtain);
      wallR(g, b - 0.25, b + 0.45, h0 - 3, h1 + 2, curtain);
      wallR(g, a - 0.15, a - 0.05, h0 - 3, h1 + 2, shade(curtain, -0.15));
      wallR(g, b + 0.05, b + 0.15, h0 - 3, h1 + 2, shade(curtain, -0.15));
      wallR(g, a - 0.2, b + 0.2, h0 - 2, h0 - 1, "#e8d2bd");
      outlineWR(g, a - 0.15, b + 0.15, h0 - 1.5, h1 + 1.5);
      if (night) this.glows.push(glowBox(iso((a + b) / 2, 0.8, (h0 + h1) / 2), 22, 18));
    };
    const frameR = (a, b, h0, h1, inner, accent) => {
      wallR(g, a, b, h0, h1, "#b98a52");
      wallR(g, a + 0.07, b - 0.07, h0 + 1, h1 - 1, inner);
      if (accent) wallR(g, a + (b - a) * 0.3, b - (b - a) * 0.3, h0 + 2, h0 + (h1 - h0) * 0.55, accent);
      outlineWR(g, a, b, h0, h1);
    };
    const frameL = (a, b, h0, h1, inner, accent) => {
      wallL(g, a, b, h0, h1, "#a7794a");
      wallL(g, a + 0.07, b - 0.07, h0 + 1, h1 - 1, inner);
      if (accent) wallL(g, a + (b - a) * 0.3, b - (b - a) * 0.3, h0 + 2, h0 + (h1 - h0) * 0.55, accent);
      outlineWL(g, a, b, h0, h1);
    };
    windowR(0.8, 2.2, 12, 21, "#e48f9e");
    frameR(3.0, 3.5, 14, 20, "#fbe2e8", "#e5566c");
    frameR(3.7, 4.5, 12, 21, "#e0edf8", "#f2d47a");
    for (let i = 0; i < 7; i++) {
      const a = 0.3 + i * 0.5;
      fillPoly(g, [iso(0, a, 29), iso(0, a + 0.4, 29), iso(0, a + 0.2, 25.5)], ["#e5566c", "#f2d47a", "#82a0bd", "#7fc28a"][i % 4]);
    }
    edge(g, iso(0, 0.2, 29), iso(0, 3.8, 29), "#8b5a3c");
    windowR(5.7, 7.1, 12, 21, "#7fb98d");
    wallR(g, 7.7, 9.3, 10, 22, "#3f7a57");
    outlineWR(g, 7.7, 9.3, 10, 22);
    fillPoly(g, [iso(8.15, 0, 19.5), iso(8.85, 0, 19.5), iso(8.85, 0, 15), iso(8.5, 0, 12.5), iso(8.15, 0, 15)], "#fff6ea");
    fillPoly(g, [iso(8.3, 0, 17), iso(8.45, 0, 15.5), iso(8.75, 0, 18.2), iso(8.45, 0, 14.6)], "#4f9f5a");
    wallR(g, 10.4, 12.6, 10, 23, pat.foam);
    outlineWR(g, 10.4, 12.6, 10, 23);
    windowR(13.0, 14.4, 12, 21, "#d8b25c");
    windowR(15.4, 16.8, 12, 21, "#c07a64");
    frameL(1.0, 1.7, 15, 23, "#fbf0cf", "#7fc28a");
    frameL(2.0, 2.5, 18, 24, "#e4f4e7", "#82a0bd");
    wallL(g, 4.3, 5.7, 12, 24, "#a7794a");
    wallL(g, 4.4, 5.6, 13, 23, "#d8b07a");
    for (const n of [[4.6, 18, "#fffaf0"], [5.0, 20, "#f2d47a"], [5.2, 15, "#bfe3c7"], [4.7, 14, "#f5d9c9"]]) wallL(g, n[0], n[0] + 0.3, n[1], n[1] + 3, n[2]);
    outlineWL(g, 4.3, 5.7, 12, 24);
    wallL(g, 6.6, 8.2, 13, 26, "#fff6ea");
    wallL(g, 6.75, 8.05, 14.5, 24.5, skyGlass);
    wallL(g, 7.38, 7.48, 14.5, 24.5, "#fff6ea");
    outlineWL(g, 6.6, 8.2, 13, 26);
    frameL(8.6, 9.5, 14, 22, "#e0edf8", "#9cc7a4");
    // papan nama ruang di dinding belakang
    for (const [id, r] of Object.entries(ROOMS)) {
      if (r.plaque.on !== "wall") continue;
      const { a, b } = r.plaque;
      wallR(g, a, b, 24.6, 31.4, INK);
      wallR(g, a + 0.08, b - 0.08, 25.4, 30.6, "#fff6ea");
      drawTextSkew(g, AGENTS[id].label, iso(a + 0.32, 0, 30.0), AGENTS[id].plaqueInk, 0.5);
    }
    return c;
  }

  // Lapisan depan statis: balkon hijau, papan nama ruang depan, dan jalan di depan gedung.
  _buildForeground(key) {
    const c = makeCanvas(W, H);
    const g = c.getContext("2d");
    const pat = buildPatterns(g);
    const night = SKY[key].night;
    box(g, 17.82, 0, 0.18, 10, 9, 0, "#d2ebd0", "#8fc29b", pat.railDark, LINE);
    box(g, 0, 9.82, 18, 0.18, 9, 0, "#d2ebd0", pat.rail, "#7fae8a", LINE);
    fillPoly(g, [iso(0, 10, 9), iso(18, 10, 9), iso(18, 10, 7.5), iso(0, 10, 7.5)], "#9fd0a6");
    const post = (x, y, h) => box(g, x, y, 0.3, 0.3, h, 0, "#eef7ec", "#bfe0c0", "#9fc9a6", LINE);
    for (const x of [0, 3, 6, 9, 12, 15]) post(x - 0.12, 9.72, 11);
    for (const y of [3, 6, 9]) post(17.72, y - 0.12, 11);
    box(g, 17.7, 9.7, 0.36, 0.36, 12, 0, "#eef7ec", "#bfe0c0", "#9fc9a6", LINE);
    const globe = (p) => {
      rect(g, p.x - 1, p.y - 6, 2, 6, INK);
      rect(g, p.x - 3, p.y - 11, 6, 6, INK);
      rect(g, p.x - 2, p.y - 10, 4, 4, night ? "#ffe39a" : "#fff3d0");
      rect(g, p.x - 2, p.y - 10, 2, 1, "#ffffff");
      if (night) this.glows.push(glowBox({ x: p.x, y: p.y - 8 }, 20, 16));
    };
    globe(iso(0.03, 9.87, 11));
    globe(iso(17.88, 9.88, 12));
    globe(iso(17.87, 0.03, 11));
    for (const [id, r] of Object.entries(ROOMS)) {
      if (r.plaque.on !== "rail") continue;
      const { a, b } = r.plaque;
      fillPoly(g, [iso(a, 10, 8), iso(b, 10, 8), iso(b, 10, 1), iso(a, 10, 1)], INK);
      fillPoly(g, [iso(a + 0.08, 10, 7.2), iso(b - 0.08, 10, 7.2), iso(b - 0.08, 10, 1.8), iso(a + 0.08, 10, 1.8)], "#fff6ea");
      drawTextSkew(g, AGENTS[id].label, iso(a + 0.32, 10, 6.6), AGENTS[id].plaqueInk, 0.5);
    }

    // jalan depan: lampu, pot bunga, bangku, orang, pohon
    const lampPost = (p) => {
      rect(g, p.x - 3, p.y - 1, 6, 2, "#2f3a3a");
      rect(g, p.x - 1, p.y - 30, 2, 30, "#2f3a3a");
      rect(g, p.x - 4, p.y - 38, 8, 8, "#2f3a3a");
      rect(g, p.x - 3, p.y - 37, 6, 6, night ? "#ffe39a" : "#f5f0dc");
      rect(g, p.x - 5, p.y - 39, 10, 2, "#2f3a3a");
      if (night) this.glows.push(glowBox({ x: p.x, y: p.y - 34 }, 28, 24));
    };
    lampPost(gnd(-0.4, 12.4));
    lampPost(gnd(20.4, 4.0));
    lampPost(gnd(10.0, 12.5));
    const planter = (a, b) => {
      box(g, a, 10.15, b - a, 0.5, 5, -GH, "#5f8f6c", "#4c7a59", "#3f6a4c", LINE);
      for (let x = a + 0.15; x < b - 0.1; x += 0.3) {
        const p = iso(x, 10.4, -GH + 5);
        rect(g, p.x - 1, p.y - 3, 3, 3, "#5f9a52");
        rect(g, p.x, p.y - 4, 1, 1, ["#e5566c", "#fffaf0", "#f2d47a", "#82a0bd"][Math.round(x * 3) % 4]);
      }
    };
    planter(1.0, 3.2);
    planter(4.2, 6.4);
    planter(11.8, 14.0);
    planter(15.0, 17.2);
    box(g, 13.6, 12.2, 2.2, 0.5, 4, -GH, "#c8915f", "#a46f45", "#8c5c38", LINE);
    box(g, 13.6, 12.6, 2.2, 0.12, 9, -GH, "#c8915f", "#a46f45", "#8c5c38", LINE);
    this._streetPerson(g, gnd(14.4, 12.3), "e", "front_stand");
    this._streetPerson(g, gnd(5.2, 13.2), "d", "back_walkA");
    this._streetPerson(g, gnd(21.0, 8.2), "a", "front_walkB", true);
    drawTree(g, gnd(23.5, 1.5), true);
    return c;
  }

  _streetPerson(g, p, who, frame, flip) {
    const img = this.streetSprites[who][frame];
    const x = Math.round(p.x) - 5;
    const y = Math.round(p.y) - 14;
    rect(g, Math.round(p.x) - 4, Math.round(p.y), 8, 1, "rgba(61,42,38,0.22)");
    if (flip) {
      g.save();
      g.translate(x + img.width, 0);
      g.scale(-1, 1);
      g.drawImage(img, 0, y);
      g.restore();
    } else {
      g.drawImage(img, x, y);
    }
  }

  _buildStatics() {
    const out = [];
    const add = (depth, draw) => out.push({ depth, draw });

    // sekat rendah antar ruangan, dipecah per ubin supaya urutan gambarnya benar
    const wallX = (gy, a, b) => {
      for (let gx = a; gx < b; gx++) add(gx + 0.5 + gy, (g) => lowWall(g, gx, gy - 0.12, 1, 0.24));
    };
    const wallY = (gx, a, b) => {
      for (let gy = a; gy < b; gy++) add(gx + gy + 0.5, (g) => lowWall(g, gx - 0.12, gy, 0.24, 1));
    };
    wallX(4, 0, 2); wallX(4, 3, 7); wallX(4, 8, 12); wallX(4, 13, 15);
    wallX(6, 0, 3); wallX(6, 4, 8); wallX(6, 9, 13); wallX(6, 14, 15);
    wallY(5, 0, 4); wallY(10, 0, 4); wallY(5, 6, 10); wallY(10, 6, 10);
    wallY(15, 0, 4); wallY(15, 6, 10);

    // meja + monitor (layar beranimasi sesuai status) + kursi kosong
    for (const id of Object.keys(ROOMS)) {
      const dk = ROOMS[id].desk;
      add(dk.x + dk.w / 2 + dk.y + dk.d / 2, (g) => this._drawDesk(g, id));
      const seat = ROOMS[id].seat;
      add(seat.gx + seat.gy + 0.04, (g) => {
        const a = this.actors[id];
        const home = Math.abs(a.gx - seat.gx) < 0.05 && Math.abs(a.gy - seat.gy) < 0.05;
        if (!(home && a.mode === "seat")) drawChair(g, iso(seat.gx, seat.gy), false, AGENTS[id].chair);
      });
    }

    const plant = (gx, gy, big) => add(gx + gy, (g) => drawPlant(g, iso(gx, gy), big, this.time));
    [[4.5, 0.5, true], [5.6, 0.5, false], [14.6, 3.5, false], [17.6, 9.4, true], [0.5, 5.6, true],
      [14.4, 4.4, false], [4.5, 9.6, false], [9.5, 9.6, true], [14.5, 9.6, false]].forEach((p) => plant(p[0], p[1], p[2]));
    // penulis: rak buku + lampu lantai
    add(0.375 + 1.5, (g) => drawShelf(g, 0.1, 0.6, 0.55, 1.8, 24, ["#e5566c", "#82a0bd", "#f2d47a", "#7fc28a", "#b39ddb"]));
    add(0.7 + 3.4, (g) => drawFloorLamp(g, iso(0.7, 3.4), SKY[skyKey()].night));
    // keamanan: lemari arsip
    add(9.5 + 0.55, (g) => {
      box(g, 9.2, 0.25, 0.65, 0.6, 16, 0, "#a9b4bf", "#8c97a3", "#76818d", LINE);
      for (const h of [4, 9, 14]) fillPoly(g, [iso(9.3, 0.85, h), iso(9.75, 0.85, h), iso(9.75, 0.85, h - 3), iso(9.3, 0.85, h - 3)], "#c8d1da");
    });
    // pengisi suara: stand mic + speaker
    add(10.9 + 1.4, (g) => drawMic(g, iso(10.9, 1.4)));
    add(14.5 + 0.55, (g) => {
      box(g, 14.25, 0.3, 0.55, 0.5, 13, 0, "#4a4f63", "#3d4253", "#323645", LINE);
      const c = iso(14.5, 0.8, 9);
      rect(g, c.x - 2, c.y - 2, 3, 3, "#9aa3ad");
      rect(g, c.x - 1, c.y - 1, 1, 1, INK);
    });
    // admin: rak, sofa, meja kopi, kursi kuning
    add(16.15 + 0.4, (g) => drawShelf(g, 15.4, 0.15, 1.5, 0.5, 26, ["#c07a64", "#82a0bd", "#e3c58f", "#7fc28a", "#e8a0bf"]));
    add(16.95 + 8.4, (g) => {
      const s = ["#e48f9e", "#c9727f", "#b36270"];
      box(g, 16.1, 8.0, 1.7, 0.75, 5, 0, s[0], s[1], s[2], LINE);
      box(g, 16.1, 8.55, 1.7, 0.2, 11, 0, s[0], s[1], s[2], LINE);
      box(g, 16.1, 8.0, 0.25, 0.75, 8, 0, s[0], s[1], s[2], LINE);
      box(g, 17.55, 8.0, 0.25, 0.75, 8, 0, s[0], s[1], s[2], LINE);
    });
    add(16.6 + 6.7, (g) => {
      box(g, 16.1, 6.4, 1.0, 0.6, 5, 0, "#c8915f", "#a46f45", "#8c5c38", LINE);
      const t = iso(16.6, 6.7, 5);
      rect(g, t.x - 3, t.y - 3, 3, 3, "#fffaf0");
      rect(g, t.x + 1, t.y - 4, 2, 4, "#e5566c");
    });
    add(15.85 + 4.95, (g) => {
      box(g, 15.45, 4.6, 0.8, 0.7, 5, 0, "#f2d47a", "#d8b25c", "#c49a45", LINE);
      box(g, 15.45, 4.6, 0.2, 0.7, 10, 0, "#f2d47a", "#d8b25c", "#c49a45", LINE);
    });
    // lorong: dispenser air + bangku
    add(9.6 + 4.3, (g) => drawCooler(g, iso(9.6, 4.3), this.time));
    add(4.1 + 4.35, (g) => box(g, 3.4, 4.15, 1.4, 0.4, 4, 0, "#c8915f", "#a46f45", "#8c5c38", LINE));
    // pengirim: tumpukan paket
    add(4.4 + 6.7, (g) => {
      box(g, 4.0, 6.3, 0.8, 0.8, 6, 0, "#e1ac74", "#c99560", "#b0804f", LINE);
      box(g, 4.12, 6.42, 0.56, 0.56, 5, 6, "#ebba82", "#d39f68", "#ba8858", LINE);
      box(g, 4.2, 6.5, 0.4, 0.4, 4, 11, "#e1ac74", "#c99560", "#b0804f", LINE);
      const t = iso(4.4, 6.7, 6);
      rect(g, t.x - 1, t.y - 1, 2, 1, "#f2d47a");
    });
    add(3.8 + 9.1, (g) => box(g, 3.4, 8.8, 0.8, 0.6, 4, 0, "#e1ac74", "#c99560", "#b0804f", LINE));
    // editor: rak pita + beanbag
    add(9.4 + 6.6, (g) => drawShelf(g, 9.0, 6.25, 0.8, 0.7, 14, ["#22252a", "#3f6f9f", "#e5566c", "#22252a"]));
    add(8.95 + 9.1, (g) => {
      box(g, 8.5, 8.7, 0.9, 0.8, 4, 0, "#82a0bd", "#6788a8", "#557595", LINE);
      box(g, 8.6, 8.8, 0.7, 0.6, 2, 4, "#9ab7d2", "#7f9fbf", "#6d8dad", LINE);
    });
    // animasi: easel + kaleng cat
    add(14.4 + 6.8, (g) => drawEasel(g, iso(14.4, 6.8), this.time));
    add(12.9 + 9.3, (g) => {
      for (const c of [["#e5566c", 0], ["#82a0bd", 0.45], ["#f2d47a", 0.9]]) {
        box(g, 12.7 + c[1], 9.1, 0.35, 0.35, 4, 0, c[0], shade(c[0], -0.15), shade(c[0], -0.28), LINE);
      }
    });
    return out;
  }

  _drawDesk(g, id) {
    const dk = ROOMS[id].desk;
    box(g, dk.x, dk.y, dk.w, dk.d, 8, 0, "#c8915f", "#a46f45", "#8c5c38", LINE);
    fillPoly(g, [iso(dk.x + 1.2, dk.y + 1, 6.5), iso(dk.x + 1.9, dk.y + 1, 6.5), iso(dk.x + 1.9, dk.y + 1, 2), iso(dk.x + 1.2, dk.y + 1, 2)], "#b77f52");
    fillPoly(g, [iso(dk.x + 1.45, dk.y + 1, 4.8), iso(dk.x + 1.65, dk.y + 1, 4.8), iso(dk.x + 1.65, dk.y + 1, 4), iso(dk.x + 1.45, dk.y + 1, 4)], "#f2d47a");
    const monitor = (cx, cy) => {
      const t = iso(cx, cy, 8);
      const mx = Math.round(t.x) - 7;
      const my = Math.round(t.y) - 13;
      rect(g, mx, my, 14, 10, INK);
      this._drawScreen(g, id, mx + 1, my + 1, 12, 8);
      rect(g, mx + 6, my + 10, 2, 2, INK);
      rect(g, mx + 4, my + 12, 6, 1, INK);
    };
    if (id === "editor") {
      monitor(dk.x + 0.6, dk.y + 0.4);
      monitor(dk.x + 1.4, dk.y + 0.4);
    } else {
      monitor(dk.x + 1, dk.y + 0.4);
    }
    const k = iso(dk.x + 1.15, dk.y + 0.85, 8);
    rect(g, k.x - 4, k.y - 2, 7, 2, "#efe9dd");
    rect(g, k.x - 4, k.y - 1, 7, 1, "#cfc7b8");
    const m = iso(dk.x + 1.8, dk.y + 0.65, 8);
    rect(g, m.x - 1, m.y - 4, 3, 4, INK);
    rect(g, m.x, m.y - 3, 2, 2, AGENTS[id].shirt);
    const lp = iso(dk.x + 0.25, dk.y + 0.3, 8);
    rect(g, lp.x - 1, lp.y - 8, 2, 8, INK);
    rect(g, lp.x - 3, lp.y - 11, 6, 4, "#f2d47a");
    rect(g, lp.x - 3, lp.y - 11, 6, 1, "#fff0b8");
    // map dokumen menumpuk di meja admin
    if (id === "admin") {
      const t = iso(dk.x + 1.75, dk.y + 0.25, 8);
      for (let i = 0; i < Math.min(this.inbox.length, 4); i++) {
        g.drawImage(this.items[this.inbox[i]] || this.items.script, Math.round(t.x) - 3, Math.round(t.y) - 7 - i * 2);
      }
    }
  }

  _drawScreen(g, id, x, y, w, h) {
    const t = this.time;
    const st = this.states[id]?.state || (id === "admin" ? "idle" : "offline");
    const fill = (c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    const px = (c, a, b, ww = 1, hh = 1) => { g.fillStyle = c; g.fillRect(x + a, y + b, ww, hh); };
    if (this.failed[id] > t) {
      fill(Math.floor(t * 4) % 2 ? "#7a2e2a" : "#a63c35");
      for (const [a, b] of [[3, 1], [4, 2], [5, 3], [6, 4], [7, 5], [8, 6], [8, 1], [7, 2], [5, 4], [4, 5], [3, 6]]) px("#fffaf0", a, b);
      return;
    }
    if (id === "admin") {
      if (this.inbox.length) {
        fill(Math.floor(t * 3) % 2 ? "#a63c35" : "#3b2a2a");
        px("#fffaf0", 5, 1, 2, 4);
        px("#fffaf0", 5, 6, 2, 1);
      } else {
        fill("#2b3a52");
        px("#82a0bd", 1, 1, 4, 3);
        px("#9fb4cc", 6, 1, 5, 1);
        px("#9fb4cc", 6, 3, 4, 1);
        px("#9fb4cc", 1, 5, 10, 1);
      }
      return;
    }
    if (st === "offline") return fill(PAL.screenOff);
    if (st === "idle") {
      fill("#2b3a52");
      const k = Math.floor(t * 1.5);
      px("#4f6a8f", k % w, (k * 3) % h);
      return;
    }
    if (st === "just_done") {
      fill("#2f5a3a");
      for (const [a, b] of [[3, 4], [4, 5], [5, 4], [6, 3], [7, 2], [8, 1]]) px("#7fc28a", a, b);
      return;
    }
    // working: animasi sesuai peran
    if (id === "writer") {
      fill("#f6f1e6");
      const n = Math.floor(t * 6) % 30;
      for (let row = 0; row < 3; row++) {
        const len = Math.max(0, Math.min(10, n - row * 10));
        px("#8a7f74", 1, 1 + row * 2, len, 1);
      }
      if (Math.floor(t * 3) % 2) px(INK, 1 + Math.min(10, n % 11), 1 + Math.min(2, Math.floor(n / 10)) * 2);
    } else if (id === "safety") {
      fill("#24402f");
      const k = Math.floor(t * 2) % 4;
      for (let i = 0; i < 3; i++) {
        px("#4f7f5c", 1, 1 + i * 2, 1, 1);
        px("#4f7f5c", 3, 1 + i * 2, 8, 1);
        if (i < k) px("#7fc28a", 1, 1 + i * 2);
      }
    } else if (id === "voice") {
      fill("#2a2440");
      for (let i = 0; i < w; i++) {
        const v = Math.round((Math.sin(t * 9 + i * 1.3) * 0.5 + 0.5) * (h - 2)) + 1;
        px("#f2d47a", i, h - v, 1, v);
      }
    } else if (id === "animator") {
      fill("#2d2a3a");
      const bx = Math.floor((Math.sin(t * 2.2) * 0.5 + 0.5) * (w - 2));
      const by = Math.floor(Math.abs(Math.sin(t * 5)) * (h - 3));
      px("#b39ddb", bx, h - 3 - by, 2, 2);
      px("#5a5470", 0, h - 1, w, 1);
    } else if (id === "editor") {
      fill("#1f2a38");
      const off = Math.floor(t * 6);
      const cols = ["#82a0bd", "#f2d47a", "#b39ddb", "#7fc28a"];
      for (let i = 0; i < w; i++) {
        px(cols[Math.floor((i + off) / 3) % 4], i, 2, 1, 1);
        px(cols[Math.floor((i + off + 2) / 2) % 4], i, 5, 1, 1);
      }
      px("#e5566c", 5, 0, 1, h);
    } else if (id === "delivery") {
      fill("#2d2a24");
      const p = Math.floor((t * 3) % (w - 2));
      px("#5a5040", 1, 3, w - 2, 2);
      px("#e8a46a", 1, 3, p + 1, 2);
    }
  }

  _drawActor(g, a) {
    const frames = this.sprites[a.id];
    const st = this.states[a.id]?.state || (a.id === "admin" ? "idle" : "offline");
    const p = iso(a.gx, a.gy);
    const x = Math.round(p.x) - 5;
    let y = Math.round(p.y) - 15;
    let jump = 0;
    if (a.jumpUntil > this.time) jump = Math.round(Math.sin(((a.jumpUntil - this.time) / 0.4) * Math.PI) * 4);
    if (a.cheerUntil > this.time) jump = Math.round(Math.abs(Math.sin(this.time * 9)) * 4);
    y -= Math.max(0, jump);

    if (a.mode === "seat") {
      if (a.sadUntil > this.time || a.cheerUntil > this.time) {
        g.drawImage(a.sadUntil > this.time ? frames.sad : frames.cheer, x, y - 1);
        return;
      }
      let img = frames.sit_a;
      if (st === "offline") img = frames.sleep;
      else if (st === "working") img = Math.floor(this.time * 7) % 2 ? frames.sit_a : frames.sit_b;
      const breathe = st === "idle" && Math.floor(this.time * 1.2) % 2 ? 1 : 0;
      g.drawImage(img, x, y + 3 + breathe);
      drawChair(g, p, true, AGENTS[a.id].chair);
      return;
    }
    let img;
    if (a.sadUntil > this.time) img = frames.sad;
    else if (a.cheerUntil > this.time) img = frames.cheer;
    else {
      const view = a.face === "front" ? "front" : "back";
      const moving = a.mode === "walk" && a.path.length;
      const step = moving ? (Math.floor(a.walkDist * 4) % 2 ? "walkA" : "walkB") : "stand";
      img = frames[`${view}${a.carry ? "_carry" : ""}_${step}`];
    }
    rect(g, Math.round(p.x) - 4, Math.round(p.y), 8, 1, "rgba(61,42,38,0.22)");
    if (a.flip) {
      g.save();
      g.translate(x + img.width, 0);
      g.scale(-1, 1);
      g.drawImage(img, 0, y);
      g.restore();
    } else {
      g.drawImage(img, x, y);
    }
    if (a.carry) {
      const it = this.items[a.carry];
      const bob = Math.floor(a.walkDist * 4) % 2;
      g.drawImage(it, Math.round(p.x) - Math.floor(it.width / 2), y - it.height + 2 + bob);
    }
  }

  _drawCat(g) {
    const c = this.cat;
    const p = iso(c.gx, c.gy);
    const moving = c.path.length > 0;
    const img = moving ? (Math.floor(c.walkDist * 6) % 2 ? this.catSprites.walkA : this.catSprites.walkB)
      : this.catSprites.sit;
    let y = Math.round(p.y) - img.height + 1;
    if (c.jumpUntil > this.time) y -= Math.round(Math.sin(((c.jumpUntil - this.time) / 0.35) * Math.PI) * 4);
    const x = Math.round(p.x) - 5;
    rect(g, x + 1, Math.round(p.y), 8, 1, "rgba(61,42,38,0.2)");
    if (c.flip) {
      g.save();
      g.translate(x + img.width, 0);
      g.scale(-1, 1);
      g.drawImage(img, 0, y);
      g.restore();
    } else {
      g.drawImage(img, x, y);
    }
    if (!moving && Math.floor(this.time * 2) % 5 === 0) {
      g.fillStyle = "#f2c14e";
      g.fillRect(c.flip ? x + 9 : x, y + 2, 1, 1);
    }
  }

  _drawNight(g) {
    g.fillStyle = "rgba(30,34,78,0.38)";
    g.fillRect(0, 0, W, H);
    for (const gl of this.glows) {
      const grad = g.createRadialGradient(gl.x, gl.y, 0, gl.x, gl.y, gl.r);
      grad.addColorStop(0, "rgba(255,214,128,0.42)");
      grad.addColorStop(0.55, "rgba(255,200,110,0.16)");
      grad.addColorStop(1, "rgba(255,200,110,0)");
      g.fillStyle = grad;
      g.fillRect(gl.x - gl.r, gl.y - gl.r, gl.r * 2, gl.r * 2);
    }
  }

  // titik status di papan nama tiap ruangan (berkedip saat bekerja)
  _drawStatusLights(g) {
    for (const [id, r] of Object.entries(ROOMS)) {
      const st = id === "admin" ? (this.inbox.length ? "working" : "idle") : this.states[id]?.state || "offline";
      const pos = r.plaque.on === "wall" ? iso(r.plaque.b - 0.5, 0, 28.6) : iso(r.plaque.b - 0.5, 10, 5.2);
      const color = STATE_COLOR[st] || "#6b7280";
      const blink = st === "working" && Math.floor(this.time * 3) % 2;
      rect(g, pos.x - 2, pos.y - 2, 5, 5, INK);
      rect(g, pos.x - 1, pos.y - 1, 3, 3, blink ? shade(color, -0.4) : color);
    }
    // jam dinding ruang admin (jam asli)
    const c = iso(17.4, 0, 18);
    const cx = Math.round(c.x);
    const cy = Math.round(c.y);
    rect(g, cx - 4, cy - 4, 9, 9, INK);
    rect(g, cx - 3, cy - 3, 7, 7, "#fffaf0");
    const now = new Date();
    const hand = (ang, len, color) => {
      pxLine(g, cx, cy, cx + Math.round(Math.sin(ang) * len), cy - Math.round(Math.cos(ang) * len), color);
    };
    hand(((now.getHours() % 12) + now.getMinutes() / 60) * (Math.PI / 6), 2, INK);
    hand(now.getMinutes() * (Math.PI / 30), 3, PAL.red);
  }

  _drawParticles(g) {
    for (const p of this.particles) {
      if (p.t < 0) continue;
      const k = p.t / p.life;
      if (p.kind === "item") {
        const e = Math.min(1, p.t / p.life);
        const x = p.x + (p.tx - p.x) * e;
        const y = p.y + (p.ty - p.y) * e - Math.sin(e * Math.PI) * 10;
        g.drawImage(p.sprite, Math.round(x) - 3, Math.round(y) - 3);
      } else if (p.kind === "drop" || p.kind === "sprite") {
        if (p.kind === "drop" && p.t > p.life - 0.6 && Math.floor(p.t * 12) % 2) continue;
        g.drawImage(p.sprite, Math.round(p.x) - 3, Math.round(p.y) - p.sprite.height);
      } else if (p.kind === "confetti") {
        g.fillStyle = p.color;
        g.fillRect(Math.round(p.x), Math.round(p.y), p.w, 1);
      } else if (p.kind === "star") {
        g.fillStyle = p.color;
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        g.fillRect(x, y, 1, 1);
        if (k < 0.5) {
          g.fillRect(x - 1, y, 3, 1);
          g.fillRect(x, y - 1, 1, 3);
        }
      } else if (p.kind === "smoke") {
        g.fillStyle = k < 0.5 ? "#8a9099" : "#b9bec5";
        const s = k < 0.3 ? 2 : 3;
        g.fillRect(Math.round(p.x), Math.round(p.y), s, s);
      } else if (p.kind === "dust") {
        g.fillStyle = "#e6dccb";
        g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      } else if (p.kind === "text") {
        if (k > 0.7 && Math.floor(p.t * 14) % 2) continue;
        const w = textWidth(p.text);
        drawText(g, p.text, p.x - w / 2 + 1, p.y + 1, INK);
        drawText(g, p.text, p.x - w / 2, p.y, p.color);
      }
    }
  }

  _drawBubbles(g) {
    const bubble = (b, x, y) => {
      const w = textWidth(b.text) + 6;
      const bx = Math.round(x - w / 2);
      const by = Math.round(y) - 12;
      const bg = b.color === PAL.white ? "#fffaf0" : b.color;
      g.fillStyle = INK;
      g.fillRect(bx - 1, by - 1, w + 2, 11);
      g.fillRect(Math.round(x) - 2, by + 10, 5, 1);
      g.fillRect(Math.round(x) - 1, by + 11, 3, 1);
      g.fillStyle = bg;
      g.fillRect(bx, by, w, 9);
      g.fillRect(Math.round(x) - 1, by + 9, 3, 1);
      g.fillRect(Math.round(x), by + 10, 1, 1);
      g.fillStyle = shade(bg, -0.08);
      g.fillRect(bx, by + 8, w, 1);
      drawText(g, b.text, bx + 3, by + 2, INK);
    };
    for (const a of Object.values(this.actors)) {
      const p = iso(a.gx, a.gy);
      const headY = p.y - (a.mode === "seat" ? 13 : 17);
      if (a.bubble && a.bubble.until > this.time) {
        bubble(a.bubble, p.x, headY - (a.carry ? 6 : 0));
      } else if (a.mode === "seat" && this.states[a.id]?.state === "offline") {
        const z = Math.floor(this.time * 1.5) % 3;
        drawText(g, "Z", p.x + 4 + z, headY - z * 2, "#9aa3ad");
      }
    }
    if (this.cat.bubble && this.cat.bubble.until > this.time) {
      const p = iso(this.cat.gx, this.cat.gy);
      bubble(this.cat.bubble, p.x, p.y - 9);
    }
  }

  _drawRoomHighlight(g) {
    for (const id of new Set([this.hover, this.selected])) {
      if (!id) continue;
      const r = ROOMS[id];
      const color = id === this.selected ? PAL.yellow : "#fffaf0";
      const pts = [iso(r.x, r.y), iso(r.x + r.w, r.y), iso(r.x + r.w, r.y + r.d), iso(r.x, r.y + r.d)];
      for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        // garis putus-putus berjalan (seperti seleksi di game)
        const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        g.fillStyle = color;
        for (let s = 0; s <= n; s++) {
          if ((s + Math.floor(this.time * 8)) % 4 < 2) {
            g.fillRect(Math.round(a.x + ((b.x - a.x) * s) / n), Math.round(a.y + ((b.y - a.y) * s) / n), 1, 1);
          }
        }
      }
    }
  }

  _drawBanner(g) {
    const b = this.banner;
    if (!b) return;
    const w = textWidth(b.text) + 12;
    const slide = Math.min(1, (this.time - b.start) / 0.2);
    const out = Math.max(0, Math.min(1, (b.until - this.time) / 0.2));
    const y = Math.round(-12 + 18 * Math.min(slide, out));
    const x = Math.round((W - w) / 2);
    g.fillStyle = INK;
    g.fillRect(x - 1, y - 1, w + 2, 13);
    g.fillStyle = b.color;
    g.fillRect(x, y, w, 11);
    g.fillStyle = shade(b.color, 0.25);
    g.fillRect(x, y, w, 1);
    g.fillStyle = shade(b.color, -0.25);
    g.fillRect(x, y + 10, w, 1);
    drawText(g, b.text, x + 6, y + 3, INK);
  }
}

// ------------------------------------------------------------------ pola & primitif adegan
const INK = "#3d2a26";
const LINE = "#5a3d30";

const gnd = (gx, gy, h = 0) => iso(gx, gy, -GH + h);

function rect(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), w, h);
}

function edge(g, a, b, color) {
  pxLine(g, a.x, a.y, b.x, b.y, color);
}

function tileFill(g, gx, gy, w, d, color) {
  fillPoly(g, [iso(gx, gy), iso(gx + w, gy), iso(gx + w, gy + d), iso(gx, gy + d)], color);
}

function wallR(g, a, b, h0, h1, color) {
  fillPoly(g, [iso(a, 0, h1), iso(b, 0, h1), iso(b, 0, h0), iso(a, 0, h0)], color);
}

function wallL(g, a, b, h0, h1, color) {
  fillPoly(g, [iso(0, a, h1), iso(0, b, h1), iso(0, b, h0), iso(0, a, h0)], color);
}

function outlineQuad(g, p, color = LINE) {
  for (let i = 0; i < 4; i++) edge(g, p[i], p[(i + 1) % 4], color);
}
const outlineWR = (g, a, b, h0, h1) => outlineQuad(g, [iso(a, 0, h1), iso(b, 0, h1), iso(b, 0, h0), iso(a, 0, h0)]);
const outlineWL = (g, a, b, h0, h1) => outlineQuad(g, [iso(0, a, h1), iso(0, b, h1), iso(0, b, h0), iso(0, a, h0)]);
const outlineL = (g, a, b, h0, h1) => outlineQuad(g, [iso(a, 10, h1), iso(b, 10, h1), iso(b, 10, h0), iso(a, 10, h0)]);
const outlineR = (g, a, b, h0, h1) => outlineQuad(g, [iso(18, a, h1), iso(18, b, h1), iso(18, b, h0), iso(18, a, h0)]);

// pendar cahaya lampu/jendela di malam hari (lingkaran lembut)
function glowBox(c, w, h) {
  return { x: Math.round(c.x), y: Math.round(c.y), r: Math.max(w, h) * 0.75 };
}

// Teks piksel 3x5 yang dimiringkan mengikuti dinding/balkon isometrik (kemiringan 1:2).
function drawTextSkew(g, str, p, color, slope) {
  g.fillStyle = color;
  let cx = 0;
  for (const ch of String(str).toUpperCase()) {
    const glyph = GLYPHS[ch] || GLYPHS["?"];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if (glyph[r][c] !== "#") continue;
        const dx = cx + c;
        g.fillRect(Math.round(p.x) + dx, Math.round(p.y + r + dx * slope), 1, 1);
      }
    }
    cx += 4;
  }
}

function lowWall(g, gx, gy, w, d) {
  box(g, gx, gy, w, d, LOW_H, 0, "#fff6ea", "#ecd2bf", "#dbbca7", LINE);
}

export const RUGS = {
  writer: [2.0, 1.4, 2.8, 2.2],
  safety: [6.2, 1.5, 3.2, 2.0],
  voice: [11.2, 1.5, 3.2, 2.0],
  delivery: [1.2, 7.6, 3.0, 2.0],
  editor: [6.0, 7.6, 3.2, 2.0],
  animator: [11.0, 7.6, 3.4, 2.0],
  admin: [15.3, 5.6, 2.5, 3.6],
};

function drawRug(g, r, c) {
  const [gx, gy, w, d] = r;
  tileFill(g, gx, gy, w, d, c[1]);
  tileFill(g, gx + 0.12, gy + 0.12, w - 0.24, d - 0.24, c[0]);
  tileFill(g, gx + 0.35, gy + 0.35, w - 0.7, d - 0.7, c[2]);
  tileFill(g, gx + 0.55, gy + 0.55, w - 1.1, d - 1.1, c[0]);
  for (let i = 0.9; i < w - 0.9; i += 0.6) tileFill(g, gx + i, gy + 0.18, 0.2, 0.12, c[2]);
}

function buildPatterns(g) {
  const make = (w, h, draw, offset) => {
    const c = makeCanvas(w, h);
    draw(c.getContext("2d"));
    const p = g.createPattern(c, "repeat");
    if (offset && p.setTransform && typeof DOMMatrix !== "undefined") {
      p.setTransform(new DOMMatrix([1, 0, 0, 1, offset[0], offset[1]]));
    }
    return p;
  };
  const poly = (x, pts, color) => fillPoly(x, pts.map(([px, py]) => ({ x: px, y: py })), color);
  const stripes = (base, stripe, dot) => (x) => {
    x.fillStyle = base; x.fillRect(0, 0, 6, 12);
    x.fillStyle = stripe; x.fillRect(0, 0, 2, 12);
    if (dot) { x.fillStyle = dot; x.fillRect(4, 5, 1, 1); }
  };
  return {
    cobble: make(16, 8, (x) => {
      x.fillStyle = "#a1988c"; x.fillRect(0, 0, 16, 8);
      poly(x, [[8, 0.7], [15.2, 4], [8, 7.3], [0.8, 4]], "#cdc5b8");
      poly(x, [[8, 1.6], [12, 3.4], [8, 3.4]], "#d9d2c6");
      poly(x, [[0, 0], [7.2, 0], [0, 3.3]], "#c2baac");
      poly(x, [[16, 0], [16, 3.3], [8.8, 0]], "#c2baac");
      poly(x, [[0, 8], [0, 4.7], [7.2, 8]], "#c2baac");
      poly(x, [[16, 8], [8.8, 8], [16, 4.7]], "#c2baac");
    }),
    pave: make(20, 10, (x) => {
      x.fillStyle = "#cfc6b6"; x.fillRect(0, 0, 20, 10);
      poly(x, [[10, 0.7], [19, 5], [10, 9.3], [1, 5]], "#e4ddcf");
    }, [OX - HW, OY + GH]),
    wood: make(20, 10, (x) => {
      x.fillStyle = "#c98f5f"; x.fillRect(0, 0, 20, 10);
      poly(x, [[10, 0], [20, 5], [10, 10], [0, 5]], "#d7a06e");
      poly(x, [[5, 2.5], [15, 7.5], [14.2, 7.9], [4.2, 2.9]], "#c4895a");
      poly(x, [[2, 5.6], [6, 7.6], [5.2, 8], [1.2, 6]], "#bd8354");
    }, [OX - HW, OY]),
    herring: make(20, 10, (x) => {
      x.fillStyle = "#e3c79c"; x.fillRect(0, 0, 20, 10);
      poly(x, [[10, 0], [10, 10], [0, 5]], "#efdab4");
      poly(x, [[10, 0], [20, 5], [10, 10]], "#e6cda5");
      x.fillStyle = "#d4b68a"; x.fillRect(10, 0, 1, 10);
    }, [OX - HW, OY]),
    wpPink: make(6, 12, stripes("#f5d9c9", "#eec8b6", "#e6b4a0")),
    wpMint: make(6, 12, stripes("#dcefe0", "#cbe3d0", "#b6d6bd")),
    wpSage: make(6, 12, stripes("#e4e8d2", "#d5dcbe")),
    wpCream: make(8, 8, (x) => {
      x.fillStyle = "#f8ecd2"; x.fillRect(0, 0, 8, 8);
      x.fillStyle = "#e9d3a6"; x.fillRect(1, 1, 1, 1); x.fillRect(5, 5, 1, 1);
    }),
    plaster: make(8, 6, (x) => {
      x.fillStyle = "#f2d68f"; x.fillRect(0, 0, 8, 6);
      x.fillStyle = "#ebcc7f"; x.fillRect(1, 1, 2, 1); x.fillRect(5, 4, 2, 1);
    }),
    rail: make(5, 10, (x) => {
      x.fillStyle = "#6f9d7e"; x.fillRect(0, 0, 5, 10);
      x.fillStyle = "#b6dab8"; x.fillRect(1, 0, 2, 10);
      x.fillStyle = "#cfe9cf"; x.fillRect(1, 0, 1, 10);
    }),
    railDark: make(5, 10, (x) => {
      x.fillStyle = "#5d8a6c"; x.fillRect(0, 0, 5, 10);
      x.fillStyle = "#97c49d"; x.fillRect(1, 0, 2, 10);
    }),
    awning: make(6, 10, (x) => {
      x.fillStyle = "#fff4e4"; x.fillRect(0, 0, 6, 10);
      x.fillStyle = "#e98f85"; x.fillRect(0, 0, 3, 10);
    }),
    foam: make(4, 4, (x) => {
      x.fillStyle = "#4a4f63"; x.fillRect(0, 0, 4, 4);
      x.fillStyle = "#5a6078"; x.fillRect(0, 0, 2, 2); x.fillRect(2, 2, 2, 2);
    }),
  };
}

// ------------------------------------------------------------------ perabot
function drawChair(g, p, occupied, color = "#6b5a7a") {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (occupied) {
    // sandaran rendah: hanya menutupi pinggang, baju warna agent tetap terlihat
    rect(g, x - 5, y - 5, 10, 4, INK);
    rect(g, x - 4, y - 4, 8, 2, color);
    rect(g, x - 4, y - 4, 8, 1, shade(color, 0.25));
    rect(g, x - 1, y - 1, 2, 2, INK);
    rect(g, x - 3, y + 1, 6, 1, INK);
    return;
  }
  rect(g, x - 5, y - 12, 10, 7, INK);
  rect(g, x - 4, y - 11, 8, 5, color);
  rect(g, x - 4, y - 11, 8, 1, shade(color, 0.25));
  rect(g, x - 5, y - 6, 10, 3, INK);
  rect(g, x - 4, y - 5, 8, 1, shade(color, -0.1));
  rect(g, x - 1, y - 3, 2, 3, INK);
  rect(g, x - 3, y, 6, 1, INK);
}

function drawPlant(g, p, big, t) {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  rect(g, x - 4, y - 6, 8, 6, INK);
  rect(g, x - 3, y - 5, 6, 5, "#d98a6a");
  rect(g, x - 3, y - 5, 6, 1, "#f0a888");
  rect(g, x - 3, y - 1, 6, 1, "#b56e52");
  const s = big ? 1.4 : 1;
  const sway = Math.round(Math.sin(t * 1.3 + x) * 0.6);
  for (const b of [[-5, -14, 10, 8, "#4f8746"], [-6, -11, 4, 4, "#5f9a52"], [2, -12, 5, 5, "#5f9a52"], [-3, -18, 6, 6, "#6fae5f"],
    [-1, -21, 3, 4, "#86c46f"], [-4, -15, 2, 2, "#9bd47e"], [3, -16, 2, 3, "#86c46f"]]) {
    rect(g, x + b[0] * s + sway, y - 6 + (b[1] + 6) * s, Math.round(b[2] * s), Math.round(b[3] * s), b[4]);
  }
}

function drawShelf(g, gx, gy, w, d, h, books) {
  box(g, gx, gy, w, d, h, 0, "#c8915f", "#a46f45", "#8c5c38", LINE);
  const rows = Math.floor(h / 6);
  for (let r = 0; r < rows; r++) {
    const hb = 2 + r * 6;
    fillPoly(g, [iso(gx, gy + d, hb + 5), iso(gx + w, gy + d, hb + 5), iso(gx + w, gy + d, hb), iso(gx, gy + d, hb)], "#6e4529");
    let x = gx + 0.05;
    let i = 0;
    while (x < gx + w - 0.15) {
      const bw = 0.12 + ((i * 7 + r * 3) % 3) * 0.04;
      const bh = 3.5 + ((i * 5 + r) % 3) * 0.5;
      fillPoly(g, [iso(x, gy + d, hb + bh), iso(x + bw, gy + d, hb + bh), iso(x + bw, gy + d, hb), iso(x, gy + d, hb)], books[(i + r) % books.length]);
      x += bw + 0.03;
      i++;
    }
  }
}

function drawFloorLamp(g, p, night) {
  rect(g, p.x - 3, p.y - 1, 6, 2, INK);
  rect(g, p.x, p.y - 26, 1, 26, "#5a3d30");
  rect(g, p.x - 4, p.y - 33, 9, 7, INK);
  rect(g, p.x - 3, p.y - 32, 7, 5, night ? "#ffe39a" : "#f6c9a4");
  rect(g, p.x - 3, p.y - 32, 7, 1, "#fff2d8");
}

function drawMic(g, p) {
  rect(g, p.x - 3, p.y - 1, 6, 2, INK);
  rect(g, p.x, p.y - 22, 1, 22, INK);
  rect(g, p.x - 2, p.y - 29, 5, 8, INK);
  rect(g, p.x - 1, p.y - 28, 3, 6, "#9aa3ad");
  rect(g, p.x - 1, p.y - 28, 1, 6, "#c3cad2");
}

function drawEasel(g, p, t) {
  rect(g, p.x - 5, p.y - 22, 1, 22, "#7a5236");
  rect(g, p.x + 4, p.y - 22, 1, 22, "#7a5236");
  rect(g, p.x, p.y - 24, 1, 6, "#7a5236");
  rect(g, p.x - 8, p.y - 30, 17, 13, INK);
  rect(g, p.x - 7, p.y - 29, 15, 11, "#fffaf0");
  rect(g, p.x - 7, p.y - 23, 15, 5, "#9cc7a4");
  rect(g, p.x + 2, p.y - 28, 3, 3, "#f2d47a");
  rect(g, p.x - 5, p.y - 26, 4, 3, "#e5566c");
  if (Math.floor(t * 2) % 2) rect(g, p.x + 3, p.y - 29, 1, 1, "#f2d47a");
}

function drawCooler(g, p, t) {
  rect(g, p.x - 4, p.y - 22, 8, 22, INK);
  rect(g, p.x - 3, p.y - 12, 6, 11, "#eef1f4");
  rect(g, p.x - 3, p.y - 21, 6, 8, "#9cc7e6");
  rect(g, p.x - 3, p.y - 21, 1, 8, "#c9e2f5");
  rect(g, p.x - 2, p.y - 9, 1, 1, "#e5566c");
  rect(g, p.x + 1, p.y - 9, 1, 1, "#82a0bd");
  const k = (t * 1.5) % 4;
  if (k < 1.2) rect(g, p.x, p.y - 14 - Math.floor(k * 5), 1, 1, "#ffffff");
}

function drawTree(g, p, big) {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  const s = big ? 1 : 0.8;
  rect(g, x - 7, y, 14, 2, "rgba(61,42,38,0.2)");
  rect(g, x - 2, y - 16 * s, 4, Math.round(16 * s), "#7a5236");
  rect(g, x - 1, y - 16 * s, 1, Math.round(16 * s), "#956645");
  for (const b of [[-14, -40, 28, 18, "#5f9a52"], [-18, -32, 36, 14, "#5f9a52"], [-11, -48, 22, 12, "#6fae5f"], [-8, -54, 16, 8, "#86c46f"],
    [-15, -26, 30, 8, "#4f8746"], [-6, -44, 6, 4, "#9bd47e"], [6, -36, 6, 4, "#9bd47e"]]) {
    rect(g, x + b[0] * s, y + b[1] * s, Math.round(b[2] * s), Math.round(b[3] * s), b[4]);
  }
}

// ------------------------------------------------------------------ langit (mengikuti jam asli)
export const SKY = {
  day: { glass: "#bfe2ef", night: false },
  dusk: { glass: "#f2c9a8", night: false },
  night: { glass: "#2e3a62", night: true },
};

// ?sky=day|dusk|night di URL memaksa suasana tertentu (berguna untuk mencoba mode malam di siang hari)
const SKY_FORCE = new URLSearchParams(window.location.search).get("sky");

export function skyKey() {
  if (SKY_FORCE in SKY) return SKY_FORCE;
  const h = new Date().getHours();
  if (h >= 7 && h < 17) return "day";
  if ((h >= 17 && h < 19) || (h >= 5 && h < 7)) return "dusk";
  return "night";
}
