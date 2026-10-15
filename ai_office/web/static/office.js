// AI Office - kantor pixel art 2.5D (isometrik). Tiap agent punya ruangan sendiri. Saat job pindah
// tahap, agent berdiri, mengangkat hasil kerjanya, lalu berjalan lewat lorong ke ruangan agent
// berikutnya untuk menyerahkannya. Semua digambar ke kanvas beresolusi rendah (W x H) lalu
// diperbesar tanpa smoothing, jadi pixelnya tetap tajam. Murni Canvas 2D, tanpa aset gambar.
"use strict";

import { sfx } from "/static/sfx.js";

// ------------------------------------------------------------------ dunia & proyeksi
const W = 288;
const H = 184;
const OX = 112; // posisi layar sudut belakang lantai (grid 0,0)
const OY = 46;
const HW = 8; // setengah lebar ubin (ubin 16x8 pixel)
const HH = 4;
const GRID_W = 18;
const GRID_D = 10;
const WALL_H = 26; // tinggi dinding luar
const LOW_H = 6; // tinggi sekat antar ruangan

function iso(gx, gy) {
  return { x: OX + (gx - gy) * HW, y: OY + (gx + gy) * HH };
}

function toGrid(px, py) {
  const a = (px - OX) / HW;
  const b = (py - OY) / HH;
  return { gx: (a + b) / 2, gy: (b - a) / 2 };
}

const PAL = {
  outline: "#1b1d20",
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
  white: "#f1f0ec",
  ink: "#22252a",
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
    label: "PENULIS", name: "Penulis Naskah", shirt: "#e8a0bf", hair: "#6b4a32",
    acc: "glasses", accColor: "#22252a", carpet: "#e6cdd7", item: "script",
    role: "Menulis naskah video dari topik.",
  },
  safety: {
    label: "KEAMANAN", name: "Penasihat Keamanan", shirt: "#7fc28a", hair: "#2b2b30",
    acc: "hardhat", accColor: "#f2d47a", carpet: "#cadfca", item: "checked",
    role: "Memeriksa naskah supaya aman untuk anak.",
  },
  voice: {
    label: "SUARA", name: "Pengisi Suara", shirt: "#f2d47a", hair: "#7b4f92",
    acc: "headphones", accColor: "#3b4048", carpet: "#ece0b9", item: "cassette",
    role: "Membacakan naskah jadi rekaman suara.",
  },
  animator: {
    label: "ANIMASI", name: "Pembuat Animasi", shirt: "#b39ddb", hair: "#d98aa8",
    acc: "beret", accColor: "#c75c5c", carpet: "#d9d0e9", item: "reel",
    role: "Menggambar animasi untuk tiap scene.",
  },
  editor: {
    label: "EDITOR", name: "Editor", shirt: "#82a0bd", hair: "#3a2a22",
    acc: "cap", accColor: "#3f6f9f", carpet: "#cad6e2", item: "tape",
    role: "Menggabungkan suara, animasi, subtitle, dan musik.",
  },
  delivery: {
    label: "PENGIRIM", name: "Pengirim", shirt: "#e8a46a", hair: "#a4532e",
    acc: "cap", accColor: "#7a4b2a", carpet: "#eacfb6", item: "box",
    role: "Mengirim video jadi ke folder tujuan.",
  },
  admin: {
    label: "ADMIN", name: "Admin", shirt: "#5a6270", hair: "#9aa0a8",
    acc: "tie", accColor: "#d9776b", carpet: null, item: "stamped",
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
    plate: () => { const p = iso(x + 2.5, 0); return { x: p.x, y: p.y - WALL_H - 5 }; },
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
    plate: () => { const p = iso(x + 2.5, GRID_D); return { x: p.x, y: p.y + 12 }; },
  };
}

const ROOMS = {
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
    plate: () => { const p = iso(16.5, 0); return { x: p.x, y: p.y - WALL_H - 5 }; },
  },
};

// barang yang ditunggu admin di tiap gerbang persetujuan
const GATE_ITEM = { awaiting_script_approval: "checked", awaiting_final_approval: "tape" };

// tahap job -> lokasi (ruangan) yang mengerjakannya
const STAGE_ROOM = {
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

function drawText(g, str, x, y, color) {
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
function isoBox(g, x, y, w, d, h, z, top, left, right) {
  const T = up(iso(x, y), z + h);
  const R = up(iso(x + w, y), z + h);
  const B = up(iso(x + w, y + d), z + h);
  const L = up(iso(x, y + d), z + h);
  fillPoly(g, [L, B, up(B, -h), up(L, -h)], left);
  fillPoly(g, [B, R, up(R, -h), up(B, -h)], right);
  fillPoly(g, [T, R, B, L], top);
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
  "..hhhh..", ".hhhhhh.", ".hssssh.", ".sesses.", ".ssssss.", "..ssss..",
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
    h: def.hair, s: "#f0c8a0", e: "#22252a", c: def.shirt, d: shade(def.shirt, -0.22),
    p: "#3b4048", k: "#22252a", a: def.accColor, w: "#f1f0ec", g: "#22252a",
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
    const catColors = { o: "#e8a46a", e: "#22252a" };
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
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.time += dt;
      this._update(dt);
      this._draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
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
    if (type === "job_created") {
      this._dropEnvelope();
      this._showBanner(`JOB BARU: ${job.id}`, PAL.blue);
      sfx.play("coin");
      return { tag: "BARU", kind: "info", text: `Job #${job.id} masuk: "${job.topic}"` };
    }
    if (type !== "job_status") return null;
    const prev = job.previous;
    const next = job.status;
    if (!prev || prev === next) return null;
    const from = STAGE_ROOM[prev];
    const to = STAGE_ROOM[next];
    const title = job.title || job.topic;

    if (next === "done") {
      this._celebrate();
      this._showBanner(`VIDEO ${job.id} SELESAI!`, PAL.green);
      return { tag: "SELESAI", kind: "ok", text: `Video #${job.id} selesai: "${title}"` };
    }
    if (next === "failed") {
      const who = from || "writer";
      this._fail(who);
      this._showBanner(`JOB ${job.id} GAGAL`, PAL.red);
      return { tag: "GAGAL", kind: "bad", text: `Job #${job.id} gagal di ruang ${AGENTS[who].label}` };
    }
    if (next === "rejected") {
      this._adminTask(() => this._reject());
      return { tag: "DITOLAK", kind: "bad", text: `ADMIN menolak job #${job.id}` };
    }
    if (!from || !to || from === to) return null;

    if (from === "admin") {
      // admin baru berangkat setelah kiriman untuknya benar-benar tiba di meja
      const item = GATE_ITEM[prev] || "stamped";
      this._deliver("admin", to, item, { say: "OK!", recvSay: "SIAP!", fromInbox: true,
        ready: this._inboxReady() });
      return { tag: "DISETUJUI", kind: "ok",
        text: `ADMIN menyetujui dan mengantar ${ITEM_NAME[item]} ke ${AGENTS[to].label}` };
    }
    if (prev === "safety_review" && next === "writing") {
      this._deliver("safety", "writer", "revise", { say: "REVISI", recvSay: "OKE!", sfx: "revise" });
      return { tag: "REVISI", kind: "warn", text: "KEAMANAN minta PENULIS merevisi naskah" };
    }
    const item = AGENTS[from].item;
    if (to === "admin") {
      this._deliver(from, "admin", item, { say: "!", sfx: "bell" });
      return { tag: "MENUNGGU", kind: "warn",
        text: `${AGENTS[from].label} mengirim ${ITEM_NAME[item]} ke ADMIN, menunggu persetujuan` };
    }
    this._deliver(from, to, item, { say: "!", recvSay: "+1" });
    return { tag: "ANTAR", kind: "info",
      text: `${AGENTS[from].label} menyerahkan ${ITEM_NAME[item]} ke ${AGENTS[to].label}` };
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
    const avail = Math.max(W, wrap ? wrap.clientWidth : W);
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
      this.bg = this._buildBackground(key);
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

    this._drawParticles(g);
    this._drawBubbles(g);
    this._drawPlates(g);
    this._drawBanner(g);

    this.ctx.clearRect(0, 0, W, H);
    this.ctx.drawImage(this.screen, 0, 0);
  }

  _buildBackground(key) {
    const c = makeCanvas(W, H);
    const g = c.getContext("2d");
    const sky = SKY[key];

    // lempeng lantai (sisi tebal diorama)
    const A = iso(0, GRID_D);
    const B = iso(GRID_W, GRID_D);
    const R = iso(GRID_W, 0);
    fillPoly(g, [A, B, up(B, -7), up(A, -7)], PAL.slabL);
    fillPoly(g, [B, R, up(R, -7), up(B, -7)], PAL.slabR);
    pxLine(g, A.x, A.y + 1, B.x, B.y + 1, shade(PAL.slabL, 0.25));

    // ubin lantai
    for (let gx = 0; gx < GRID_W; gx++) {
      for (let gy = 0; gy < GRID_D; gy++) {
        const room = this._roomAt(gx + 0.5, gy + 0.5);
        let color;
        if (room && AGENTS[room].carpet) {
          color = shade(AGENTS[room].carpet, (gx + gy) % 2 ? -0.04 : 0);
        } else if (room === "admin") {
          color = gy % 2 ? PAL.woodB : PAL.wood;
        } else {
          color = (gx + gy) % 2 ? PAL.hallB : PAL.hallA;
        }
        fillPoly(g, [iso(gx, gy), iso(gx + 1, gy), iso(gx + 1, gy + 1), iso(gx, gy + 1)], color);
      }
    }
    // keset warna agent di depan tiap pintu
    for (const id of PIPELINE_IDS) {
      const r = ROOMS[id];
      const mx = Math.floor(r.door.gx);
      const my = r.row === "front" ? 5 : 4;
      fillPoly(g, [iso(mx + 0.15, my + 0.2), iso(mx + 0.85, my + 0.2), iso(mx + 0.85, my + 0.8),
        iso(mx + 0.15, my + 0.8)], shade(AGENTS[id].shirt, -0.1));
    }
    // karpet ruang admin
    fillPoly(g, [iso(15.6, 6.2), iso(17.6, 6.2), iso(17.6, 9.2), iso(15.6, 9.2)], "#8f6f8f");
    fillPoly(g, [iso(15.9, 6.5), iso(17.3, 6.5), iso(17.3, 8.9), iso(15.9, 8.9)], "#a8829f");

    // dinding luar belakang (kiri: sepanjang gx=0, kanan: sepanjang gy=0)
    const T0 = iso(0, 0);
    fillPoly(g, [up(T0, WALL_H), up(A, WALL_H), A, T0], PAL.wallL);
    fillPoly(g, [up(T0, WALL_H), up(R, WALL_H), R, T0], PAL.wallR);
    pxLine(g, T0.x, T0.y - WALL_H, A.x, A.y - WALL_H, PAL.wallTop);
    pxLine(g, T0.x, T0.y - WALL_H, R.x, R.y - WALL_H, PAL.wallTop);
    pxLine(g, T0.x, T0.y - WALL_H, T0.x, T0.y, shade(PAL.wallL, -0.1));
    // plint bawah
    pxLine(g, T0.x, T0.y - 1, A.x, A.y - 1, PAL.wallTrim);
    pxLine(g, T0.x, T0.y - 1, R.x, R.y - 1, PAL.wallTrim);

    // jendela (langit mengikuti jam asli)
    const winR = (a, b) => this._wallPanelR(g, a, b, 7, 19, sky);
    const winL = (a, b) => this._wallPanelL(g, a, b, 7, 19, sky);
    winR(0.8, 2.2);
    winR(5.8, 7.2);
    winR(13.0, 14.4);
    winL(0.8, 2.6);
    winL(7.2, 9.2);
    // papan pengumuman (gabus) di dinding kiri, di ujung lorong
    const s0 = iso(0, 4.2);
    const s1 = iso(0, 5.8);
    fillPoly(g, [up(s0, 19), up(s1, 19), up(s1, 9), up(s0, 9)], "#8c6a4a");
    fillPoly(g, [up(s0, 18), up(s1, 18), up(s1, 10), up(s0, 10)], "#c9a26e");
    g.fillStyle = PAL.white;
    g.fillRect(Math.round(s0.x) - 4, Math.round(s0.y) - 16, 3, 3);
    g.fillRect(Math.round(s0.x) - 9, Math.round(s0.y) - 12, 3, 4);
    g.fillStyle = PAL.yellow;
    g.fillRect(Math.round(s0.x) - 7, Math.round(s0.y) - 17, 2, 2);
    // poster/dekor per ruang belakang
    this._poster(g, 3.0, 4.0, PAL.red, PAL.white); // penulis: ABC
    this._poster(g, 8.0, 9.2, PAL.green, PAL.yellow); // keamanan
    for (let i = 0; i < 3; i++) this._poster(g, 10.4 + i * 0.8, 10.9 + i * 0.8, "#3b4048", "#4a505a"); // busa studio
    return c;
  }

  // panel di dinding kanan (sepanjang gy=0) dari gx a..b, tinggi h0..h1 pixel
  _wallPanelR(g, a, b, h0, h1, sky) {
    const p = iso(a, 0);
    const q = iso(b, 0);
    fillPoly(g, [up(p, h1 + 1), up(q, h1 + 1), up(q, h0 - 1), up(p, h0 - 1)], PAL.wallTop);
    fillPoly(g, [up(p, h1), up(q, h1), up(q, h0), up(p, h0)], sky.color);
    this._skyDetail(g, (p.x + q.x) / 2, (p.y + q.y) / 2 - (h0 + h1) / 2, sky);
    const m = iso((a + b) / 2, 0);
    pxLine(g, m.x, m.y - h1, m.x, m.y - h0, PAL.wallTop);
  }

  _wallPanelL(g, a, b, h0, h1, sky) {
    const p = iso(0, a);
    const q = iso(0, b);
    fillPoly(g, [up(p, h1 + 1), up(q, h1 + 1), up(q, h0 - 1), up(p, h0 - 1)], PAL.wallTop);
    fillPoly(g, [up(p, h1), up(q, h1), up(q, h0), up(p, h0)], shade(sky.color, -0.06));
    this._skyDetail(g, (p.x + q.x) / 2, (p.y + q.y) / 2 - (h0 + h1) / 2, sky);
    const m = iso(0, (a + b) / 2);
    pxLine(g, m.x, m.y - h1, m.x, m.y - h0, PAL.wallTop);
  }

  _skyDetail(g, x, y, sky) {
    g.fillStyle = sky.detail;
    if (sky.night) {
      g.fillRect(Math.round(x) - 3, Math.round(y) - 2, 1, 1);
      g.fillRect(Math.round(x) + 2, Math.round(y) + 1, 1, 1);
    } else {
      g.fillRect(Math.round(x) - 3, Math.round(y) - 1, 4, 1);
      g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 2, 1);
    }
  }

  _poster(g, a, b, frame, inner) {
    const p = iso(a, 0);
    const q = iso(b, 0);
    fillPoly(g, [up(p, 18), up(q, 18), up(q, 9), up(p, 9)], frame);
    fillPoly(g, [up(p, 16), up(q, 16), up(q, 11), up(p, 11)], inner);
  }

  _buildStatics() {
    const out = [];
    const add = (depth, draw) => out.push({ depth, draw });

    // sekat rendah antar ruangan, dipecah per ubin supaya urutan gambarnya benar
    const wallX = (gy, a, b) => {
      for (let gx = a; gx < b; gx++) add(gx + 0.5 + gy, (g) => lowWallX(g, gx, gy));
    };
    const wallY = (gx, a, b) => {
      for (let gy = a; gy < b; gy++) add(gx + gy + 0.5, (g) => lowWallY(g, gx, gy));
    };
    wallX(4, 0, 2); wallX(4, 3, 7); wallX(4, 8, 12); wallX(4, 13, 15);
    wallX(6, 0, 3); wallX(6, 4, 8); wallX(6, 9, 13); wallX(6, 14, 15);
    wallY(5, 0, 4); wallY(10, 0, 4); wallY(5, 6, 10); wallY(10, 6, 10);
    wallY(15, 0, 4); wallY(15, 6, 10);

    // meja + monitor + kursi kosong (kursi berpenghuni digambar bersama karakternya)
    for (const id of Object.keys(ROOMS)) {
      const dk = ROOMS[id].desk;
      add(dk.x + dk.w / 2 + dk.y + dk.d / 2, (g) => this._drawDesk(g, id));
      const seat = ROOMS[id].seat;
      add(seat.gx + seat.gy + 0.04, (g) => {
        const a = this.actors[id];
        const home = Math.abs(a.gx - seat.gx) < 0.05 && Math.abs(a.gy - seat.gy) < 0.05;
        if (!(home && a.mode === "seat")) drawChair(g, iso(seat.gx, seat.gy), false);
      });
    }

    // tanaman & perabot
    const plant = (gx, gy) => add(gx + gy, (g) => drawPlant(g, iso(gx, gy), this.time));
    [[0.5, 0.5], [5.5, 0.5], [10.5, 0.5], [4.5, 9.6], [9.5, 9.6], [14.5, 9.6], [0.5, 5.6],
      [14.4, 4.4], [15.5, 9.4]].forEach(([x, y]) => plant(x, y));
    // rak buku penulis
    add(4.5 + 0.5, (g) => drawShelf(g, 4.1, 0.15, 0.8, 0.7, 15, ["#c75c5c", "#3f6f9f", "#f2d47a", "#7fc28a"]));
    // lemari arsip keamanan
    add(9.5 + 0.5, (g) => isoBox(g, 9.2, 0.2, 0.7, 0.6, 11, 0, "#9aa3ad", "#7c8590", "#6a727c"));
    // stand mic pengisi suara
    add(10.9 + 1.4, (g) => drawMic(g, iso(10.9, 1.4)));
    // easel pembuat animasi
    add(14.5 + 6.6, (g) => drawEasel(g, iso(14.5, 6.6), this.time));
    // rak pita editor
    add(9.3 + 6.6, (g) => drawShelf(g, 9.0, 6.25, 0.8, 0.7, 10, ["#22252a", "#3f6f9f", "#22252a"]));
    // tumpukan paket pengirim
    add(4.4 + 6.7, (g) => {
      isoBox(g, 4.0, 6.3, 0.8, 0.8, 5, 0, "#d8a46e", "#c08a55", "#a87545");
      isoBox(g, 4.15, 6.45, 0.55, 0.55, 4, 5, "#e3b47e", "#c99560", "#b0804f");
    });
    // dispenser air di lorong
    add(9.6 + 4.3, (g) => drawCooler(g, iso(9.6, 4.3), this.time));
    // sofa & rak ruang admin
    add(16.9 + 8.4, (g) => {
      isoBox(g, 16.2, 8.0, 1.6, 0.7, 4, 0, "#5d6f9a", "#4a5a80", "#3d4b6b");
      isoBox(g, 17.5, 8.0, 0.3, 0.7, 4, 4, "#5d6f9a", "#4a5a80", "#3d4b6b");
    });
    add(17.6 + 0.9, (g) => drawShelf(g, 17.25, 0.15, 0.6, 1.4, 16, ["#d9776b", "#82a0bd", "#e3c58f", "#7fc28a"]));
    return out;
  }

  _drawDesk(g, id) {
    const dk = ROOMS[id].desk;
    isoBox(g, dk.x, dk.y, dk.w, dk.d, 7, 0, PAL.desk, PAL.deskL, PAL.deskR);
    const top = up(iso(dk.x + dk.w / 2, dk.y + dk.d / 2), 7);
    // keyboard & mug
    g.fillStyle = "#cfd4da";
    g.fillRect(Math.round(top.x) - 3, Math.round(top.y) + 1, 5, 1);
    g.fillStyle = AGENTS[id].shirt;
    g.fillRect(Math.round(top.x) + 6, Math.round(top.y) - 1, 2, 2);
    // monitor
    const mx = Math.round(top.x) - 5;
    const my = Math.round(top.y) - 10;
    g.fillStyle = PAL.outline;
    g.fillRect(mx, my, 11, 8);
    g.fillRect(mx + 4, my + 8, 3, 2);
    this._drawScreen(g, id, mx + 1, my + 1, 9, 6);
    // map dokumen menumpuk di meja admin
    if (id === "admin") {
      for (let i = 0; i < Math.min(this.inbox.length, 4); i++) {
        g.drawImage(this.items[this.inbox[i]] || this.items.script, Math.round(top.x) + 6,
          Math.round(top.y) - 5 - i * 2);
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
      [[2, 1], [3, 2], [4, 3], [5, 4], [6, 1], [5, 2], [3, 4], [2, 5]].forEach(([a, b]) => px(PAL.white, a, b));
      return;
    }
    if (id === "admin") {
      if (this.inbox.length) {
        fill(Math.floor(t * 3) % 2 ? "#a63c35" : "#3b2a2a");
        px(PAL.white, 4, 1, 1, 3);
        px(PAL.white, 4, 5);
      } else {
        fill("#2b3a52");
        px(PAL.blue, 1 + (Math.floor(t * 2) % 7), 2, 1, 2);
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
      [[2, 3], [3, 4], [4, 3], [5, 2], [6, 1]].forEach(([a, b]) => px(PAL.green, a, b));
      return;
    }
    // working: animasi sesuai peran
    if (id === "writer") {
      fill("#e6e4de");
      const n = Math.floor(t * 6) % 24;
      for (let row = 0; row < 3; row++) {
        const len = Math.max(0, Math.min(7, n - row * 7));
        px("#5a6270", 1, 1 + row * 2, len, 1);
      }
      if (Math.floor(t * 3) % 2) px(PAL.ink, 1 + Math.min(7, n % 8), 1 + Math.min(2, Math.floor(n / 8)) * 2);
    } else if (id === "safety") {
      fill("#1f3a2a");
      const k = Math.floor(t * 2) % 4;
      for (let i = 0; i < 3; i++) {
        px("#4f7f55", 1, 1 + i * 2, 1, 1);
        px("#4f7f55", 3, 1 + i * 2, 5, 1);
        if (i < k) px(PAL.green, 1, 1 + i * 2);
      }
    } else if (id === "voice") {
      fill("#2a2440");
      for (let i = 0; i < w; i++) {
        const v = Math.round((Math.sin(t * 9 + i * 1.3) * 0.5 + 0.5) * (h - 1)) + 1;
        px(PAL.yellow, i, h - v, 1, v);
      }
    } else if (id === "animator") {
      fill("#2d2a3a");
      const bx = Math.floor((Math.sin(t * 2.2) * 0.5 + 0.5) * (w - 2));
      const by = Math.floor(Math.abs(Math.sin(t * 5)) * (h - 2));
      px("#b39ddb", bx, h - 2 - by, 2, 2);
      px("#5a5470", 0, h - 1, w, 1);
    } else if (id === "editor") {
      fill("#1f2a38");
      const off = Math.floor(t * 6);
      const cols = [PAL.blue, PAL.yellow, "#b39ddb", PAL.green];
      for (let i = 0; i < w; i++) {
        px(cols[Math.floor((i + off) / 3) % 4], i, 1, 1, 1);
        px(cols[Math.floor((i + off + 2) / 2) % 4], i, 3, 1, 1);
      }
      px(PAL.red, 4, 0, 1, h);
    } else if (id === "delivery") {
      fill("#2d2a24");
      const p = Math.floor((t * 3) % (w - 1));
      px("#5a5040", 0, 2, w, 2);
      px("#e8a46a", 0, 2, p + 1, 2);
    }
  }

  _drawActor(g, a) {
    const frames = this.sprites[a.id];
    const st = this.states[a.id]?.state || (a.id === "admin" ? "idle" : "offline");
    const p = iso(a.gx, a.gy);
    let x = Math.round(p.x) - 5;
    let y = Math.round(p.y) - 15;
    let jump = 0;
    if (a.jumpUntil > this.time) jump = Math.round(Math.sin(((a.jumpUntil - this.time) / 0.4) * Math.PI) * 4);
    if (a.cheerUntil > this.time) jump = Math.round(Math.abs(Math.sin(this.time * 9)) * 4);
    y -= Math.max(0, jump);

    if (a.mode === "seat") {
      let img;
      if (st === "offline") img = frames.sleep;
      else if (st === "working") img = Math.floor(this.time * 7) % 2 ? frames.sit_a : frames.sit_b;
      else img = frames.sit_a;
      const breathe = st === "idle" && Math.floor(this.time * 1.2) % 2 ? 1 : 0;
      if (a.sadUntil > this.time || a.cheerUntil > this.time) {
        img = a.sadUntil > this.time ? frames.sad : frames.cheer;
        g.drawImage(img, x, y - 1);
        return;
      }
      g.drawImage(img, x, y + 3 + breathe);
      drawChair(g, p, true);
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
    // bayangan
    g.fillStyle = "rgba(27,29,32,0.25)";
    g.fillRect(Math.round(p.x) - 3, Math.round(p.y), 7, 1);
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
      g.fillStyle = "#e8a46a";
      g.fillRect(c.flip ? x + 9 : x, y + 2, 1, 1);
    }
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
        g.fillStyle = "#c9ced4";
        g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      } else if (p.kind === "text") {
        if (k > 0.7 && Math.floor(p.t * 14) % 2) continue;
        const w = textWidth(p.text);
        drawText(g, p.text, p.x - w / 2 + 1, p.y + 1, PAL.outline);
        drawText(g, p.text, p.x - w / 2, p.y, p.color);
      }
    }
  }

  _drawBubbles(g) {
    const bubble = (b, x, y) => {
      const w = textWidth(b.text) + 4;
      const bx = Math.round(x - w / 2);
      const by = Math.round(y) - 10;
      g.fillStyle = PAL.outline;
      g.fillRect(bx - 1, by - 1, w + 2, 11);
      g.fillRect(Math.round(x) - 1, by + 10, 3, 1);
      g.fillRect(Math.round(x), by + 11, 1, 1);
      g.fillStyle = b.color === PAL.white ? PAL.white : b.color;
      g.fillRect(bx, by, w, 9);
      g.fillRect(Math.round(x), by + 9, 1, 1);
      drawText(g, b.text, bx + 2, by + 2, PAL.outline);
    };
    for (const a of Object.values(this.actors)) {
      const p = iso(a.gx, a.gy);
      const headY = p.y - (a.mode === "seat" ? 14 : 18);
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

  _drawPlates(g) {
    for (const [id, r] of Object.entries(ROOMS)) {
      const def = AGENTS[id];
      const st = id === "admin" ? (this.inbox.length ? "working" : "idle")
        : this.states[id]?.state || "offline";
      const pos = r.plate();
      const w = textWidth(def.label) + 9;
      const x = Math.round(pos.x - w / 2);
      const y = Math.round(pos.y);
      const active = this.hover === id || this.selected === id;
      g.fillStyle = active ? def.shirt : PAL.outline;
      g.fillRect(x - 1, y - 1, w + 2, 9);
      g.fillStyle = "#262a30";
      g.fillRect(x, y, w, 7);
      // titik status berkedip saat kerja
      const blink = st === "working" && Math.floor(this.time * 3) % 2;
      const dot = STATE_COLOR[st] || "#6b7280";
      g.fillStyle = blink ? shade(dot, -0.4) : dot;
      g.fillRect(x + 2, y + 2, 3, 3);
      drawText(g, def.label, x + 7, y + 1, def.shirt);
    }
    // jam dinding ruang admin (jam asli)
    const c = up(iso(16.4, 0), 14);
    const cx = Math.round(c.x);
    const cy = Math.round(c.y);
    g.fillStyle = PAL.outline;
    g.fillRect(cx - 4, cy - 4, 9, 9);
    g.fillStyle = PAL.white;
    g.fillRect(cx - 3, cy - 3, 7, 7);
    const now = new Date();
    const hand = (ang, len, color) => {
      pxLine(g, cx, cy, cx + Math.round(Math.sin(ang) * len), cy - Math.round(Math.cos(ang) * len), color);
    };
    hand(((now.getHours() % 12) + now.getMinutes() / 60) * (Math.PI / 6), 2, PAL.outline);
    hand(now.getMinutes() * (Math.PI / 30), 3, PAL.red);
  }

  _drawRoomHighlight(g) {
    for (const id of new Set([this.hover, this.selected])) {
      if (!id) continue;
      const r = ROOMS[id];
      const color = id === this.selected ? PAL.yellow : PAL.white;
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
    const y = Math.round(-12 + 16 * Math.min(slide, out));
    const x = Math.round((W - w) / 2);
    g.fillStyle = PAL.outline;
    g.fillRect(x - 1, y - 1, w + 2, 13);
    g.fillStyle = b.color;
    g.fillRect(x, y, w, 11);
    g.fillStyle = shade(b.color, 0.25);
    g.fillRect(x, y, w, 1);
    g.fillStyle = shade(b.color, -0.25);
    g.fillRect(x, y + 10, w, 1);
    drawText(g, b.text, x + 6, y + 3, PAL.outline);
  }
}

const PIPELINE_IDS = ["writer", "safety", "voice", "animator", "editor", "delivery"];

// ------------------------------------------------------------------ perabot
function lowWallX(g, gx, gy) {
  const a = iso(gx, gy);
  const b = iso(gx + 1, gy);
  fillPoly(g, [up(a, LOW_H), up(b, LOW_H), b, a], PAL.lowL);
  pxLine(g, a.x, a.y - LOW_H, b.x, b.y - LOW_H, PAL.lowTop);
}

function lowWallY(g, gx, gy) {
  const a = iso(gx, gy);
  const b = iso(gx, gy + 1);
  fillPoly(g, [up(a, LOW_H), up(b, LOW_H), b, a], PAL.lowR);
  pxLine(g, a.x, a.y - LOW_H, b.x, b.y - LOW_H, PAL.lowTop);
}

function drawChair(g, p, occupied) {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  g.fillStyle = PAL.outline;
  g.fillRect(x - 1, y - 1, 3, 2);
  if (occupied) {
    // sandaran kursi rendah: hanya menutupi pinggang, baju warna agent tetap terlihat
    g.fillRect(x - 5, y - 5, 10, 4);
    g.fillStyle = "#3b4048";
    g.fillRect(x - 4, y - 4, 8, 2);
    g.fillStyle = "#4a505a";
    g.fillRect(x - 4, y - 4, 8, 1);
  } else {
    g.fillRect(x - 4, y - 5, 8, 3);
    g.fillRect(x - 4, y - 11, 8, 6);
    g.fillStyle = "#3b4048";
    g.fillRect(x - 3, y - 10, 6, 4);
    g.fillRect(x - 3, y - 4, 6, 1);
  }
}

function drawPlant(g, p, t) {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  g.fillStyle = PAL.outline;
  g.fillRect(x - 3, y - 5, 7, 6);
  g.fillStyle = PAL.pot;
  g.fillRect(x - 2, y - 4, 5, 4);
  g.fillStyle = PAL.potDark;
  g.fillRect(x - 2, y - 1, 5, 1);
  const sway = Math.round(Math.sin(t * 1.3 + x) * 0.6);
  g.fillStyle = PAL.plantDark;
  g.fillRect(x - 3 + sway, y - 10, 7, 5);
  g.fillStyle = PAL.plant;
  g.fillRect(x - 2 + sway, y - 12, 2, 6);
  g.fillRect(x + 1 + sway, y - 11, 2, 5);
  g.fillRect(x - 4 + sway, y - 8, 2, 2);
  g.fillRect(x + 3 + sway, y - 9, 2, 2);
}

function drawShelf(g, x, y, w, d, h, colors) {
  isoBox(g, x, y, w, d, h, 0, "#9c7a55", "#7a5d40", "#6a5037");
  // punggung buku di sisi kiri rak
  const L = iso(x, y + d);
  const B = iso(x + w, y + d);
  for (let row = 0; row < Math.floor(h / 5); row++) {
    for (let i = 1; i < Math.abs(B.x - L.x) - 1; i += 2) {
      g.fillStyle = colors[(i + row) % colors.length];
      const yy = L.y + ((B.y - L.y) * i) / (B.x - L.x) - 3 - row * 5;
      g.fillRect(Math.round(L.x + i), Math.round(yy), 1, 3);
    }
  }
}

function drawMic(g, p) {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  g.fillStyle = PAL.outline;
  g.fillRect(x - 2, y - 1, 5, 1);
  g.fillRect(x, y - 13, 1, 12);
  g.fillRect(x - 1, y - 17, 3, 5);
  g.fillStyle = "#9aa3ad";
  g.fillRect(x, y - 16, 1, 3);
}

function drawEasel(g, p, t) {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  g.fillStyle = "#7a5d40";
  g.fillRect(x - 4, y - 14, 1, 14);
  g.fillRect(x + 4, y - 14, 1, 14);
  g.fillStyle = PAL.outline;
  g.fillRect(x - 6, y - 17, 13, 10);
  g.fillStyle = PAL.white;
  g.fillRect(x - 5, y - 16, 11, 8);
  // lukisan kecil: matahari + bukit
  g.fillStyle = "#b39ddb";
  g.fillRect(x - 5, y - 11, 11, 3);
  g.fillStyle = PAL.yellow;
  g.fillRect(x + 1, y - 15, 2, 2);
  if (Math.floor(t * 2) % 2) g.fillRect(x + 2, y - 16, 1, 1);
}

function drawCooler(g, p, t) {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  g.fillStyle = PAL.outline;
  g.fillRect(x - 3, y - 18, 7, 18);
  g.fillStyle = "#dfe3e8";
  g.fillRect(x - 2, y - 10, 5, 9);
  g.fillStyle = "#9cc3e6";
  g.fillRect(x - 2, y - 17, 5, 6);
  g.fillStyle = "#c9e2f5";
  g.fillRect(x - 2, y - 17, 1, 6);
  // gelembung naik sesekali
  const k = (t * 1.5) % 4;
  if (k < 1.2) {
    g.fillStyle = PAL.white;
    g.fillRect(x, y - 12 - Math.floor(k * 4), 1, 1);
  }
  g.fillStyle = PAL.red;
  g.fillRect(x - 1, y - 8, 1, 1);
  g.fillStyle = PAL.blue;
  g.fillRect(x + 1, y - 8, 1, 1);
}

// ------------------------------------------------------------------ langit
const SKY = {
  day: { color: "#c8d4e0", detail: "#f1f0ec", night: false },
  dusk: { color: "#e8b89a", detail: "#f6dcc8", night: false },
  night: { color: "#2e3a52", detail: "#f1f0ec", night: true },
};

function skyKey() {
  const h = new Date().getHours();
  if (h >= 7 && h < 17) return "day";
  if ((h >= 17 && h < 19) || (h >= 5 && h < 7)) return "dusk";
  return "night";
}
