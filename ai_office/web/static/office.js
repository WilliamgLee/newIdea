// AI Office - kantor 2.5D isometrik (Canvas). Tiap agent punya meja & karakter sesuai perannya,
// animasi mengikuti status real-time (working/just_done/idle/offline) dari SSE.
// Ringan: murni Canvas 2D, tanpa engine 3D. Deterministik + waktu untuk animasi idle.
"use strict";

const AGENTS = [
  { id: "writer", label: "Penulis Naskah", prop: "book", color: "#FF8FC7" },
  { id: "safety", label: "Penasihat Keamanan", prop: "shield", color: "#5CCB5F" },
  { id: "voice", label: "Pengisi Suara", prop: "mic", color: "#FFD43B" },
  { id: "animator", label: "Pembuat Animasi", prop: "tablet", color: "#A66CFF" },
  { id: "editor", label: "Editor", prop: "film", color: "#3FA9F5" },
  { id: "delivery", label: "Pengirim", prop: "box", color: "#FF9F43" },
];

const STATE_LABEL = {
  working: "sedang kerja",
  just_done: "baru selesai",
  idle: "santai",
  offline: "offline",
};

// koordinat grid tiap meja (kolom,baris) di lantai isometrik
const DESK_CELLS = [
  [0, 0], [2, 0],
  [0, 2], [2, 2],
  [0, 4], [2, 4],
];

const TILE_W = 150; // setengah lebar ubin
const TILE_H = 86; // setengah tinggi ubin

export class Office {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.states = {}; // id -> {state, job_id, label}
    this.origin = { x: 0, y: 0 };
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._resize();
    window.addEventListener("resize", () => this._resize());
    this._raf = null;
  }

  setStates(agents) {
    agents.forEach((a) => (this.states[a.agent] = a));
  }

  start() {
    const loop = (ts) => {
      this.draw(ts / 1000);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _resize() {
    const w = this.canvas.clientWidth || 960;
    const h = this.canvas.clientHeight || 560;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.W = w;
    this.H = h;
    // pusatkan lantai
    this.origin = { x: w / 2, y: 120 };
  }

  // grid -> layar (proyeksi isometrik)
  iso(cx, cy) {
    return {
      x: this.origin.x + (cx - cy) * TILE_W * 0.5,
      y: this.origin.y + (cx + cy) * TILE_H * 0.5,
    };
  }

  draw(t) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this._floor();
    // gambar meja dari belakang ke depan agar tumpukan benar
    const order = AGENTS.map((a, i) => ({ a, i })).sort(
      (p, q) => (DESK_CELLS[p.i][0] + DESK_CELLS[p.i][1]) - (DESK_CELLS[q.i][0] + DESK_CELLS[q.i][1]),
    );
    order.forEach(({ a, i }) => this._station(a, DESK_CELLS[i], t));
  }

  _floor() {
    const ctx = this.ctx;
    for (let cx = -1; cx <= 4; cx++) {
      for (let cy = -1; cy <= 6; cy++) {
        const p = this.iso(cx, cy);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + TILE_W * 0.5, p.y + TILE_H * 0.5);
        ctx.lineTo(p.x, p.y + TILE_H);
        ctx.lineTo(p.x - TILE_W * 0.5, p.y + TILE_H * 0.5);
        ctx.closePath();
        ctx.fillStyle = (cx + cy) % 2 === 0 ? "#eef3fb" : "#e4ecf7";
        ctx.fill();
        ctx.strokeStyle = "#d4ddee";
        ctx.stroke();
      }
    }
  }

  _station(agent, cell, t) {
    const st = this.states[agent.id] || { state: "idle" };
    const base = this.iso(cell[0], cell[1]);
    const working = st.state === "working";
    const offline = st.state === "offline";

    this._desk(base, agent);
    this._character(base, agent, st, t);

    // papan nama + status
    this._nameplate(base, agent, st);

    // indikator "baru selesai": kilau
    if (st.state === "just_done") this._sparkle(base, t);
    if (offline) this._zzz(base, t);
    if (working) this._workFx(base, agent, t);
  }

  _desk(base, agent) {
    const ctx = this.ctx;
    const x = base.x;
    const y = base.y + 10;
    // kaki meja
    ctx.fillStyle = "#b98048";
    ctx.fillRect(x - 70, y, 140, 10);
    // permukaan meja (isometrik sederhana)
    ctx.beginPath();
    ctx.moveTo(x, y - 30);
    ctx.lineTo(x + 85, y + 8);
    ctx.lineTo(x, y + 46);
    ctx.lineTo(x - 85, y + 8);
    ctx.closePath();
    ctx.fillStyle = "#d9a066";
    ctx.fill();
    ctx.strokeStyle = "#a06a3a";
    ctx.stroke();
    // properti sesuai peran
    this._prop(agent.prop, x, y - 6, agent.color);
  }

  _prop(kind, x, y, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "#3D2C4F";
    ctx.lineWidth = 2;
    if (kind === "book") {
      ctx.fillStyle = color;
      ctx.fillRect(-26, -18, 52, 32);
      ctx.strokeRect(-26, -18, 52, 32);
      ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(0, 14); ctx.stroke();
    } else if (kind === "shield") {
      ctx.beginPath();
      ctx.moveTo(0, -22); ctx.lineTo(22, -10); ctx.lineTo(14, 20);
      ctx.lineTo(0, 28); ctx.lineTo(-14, 20); ctx.lineTo(-22, -10); ctx.closePath();
      ctx.fillStyle = color; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8, 2); ctx.lineTo(-2, 10); ctx.lineTo(10, -8); ctx.stroke();
    } else if (kind === "mic") {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(0, -8, 12, 18, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, 26); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-12, 26); ctx.lineTo(12, 26); ctx.stroke();
    } else if (kind === "tablet") {
      ctx.fillStyle = color;
      ctx.fillRect(-24, -18, 48, 34); ctx.strokeRect(-24, -18, 48, 34);
      ctx.strokeStyle = "#fff";
      ctx.beginPath(); ctx.moveTo(-14, 8); ctx.quadraticCurveTo(0, -12, 14, 8); ctx.stroke();
    } else if (kind === "film") {
      ctx.fillStyle = color;
      ctx.fillRect(-26, -16, 52, 32); ctx.strokeRect(-26, -16, 52, 32);
      ctx.fillStyle = "#fff";
      for (let i = -22; i <= 18; i += 10) { ctx.fillRect(i, -14, 4, 4); ctx.fillRect(i, 10, 4, 4); }
    } else if (kind === "box") {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -20); ctx.lineTo(26, -6); ctx.lineTo(26, 16);
      ctx.lineTo(0, 30); ctx.lineTo(-26, 16); ctx.lineTo(-26, -6); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(0, 30); ctx.stroke();
    }
    ctx.restore();
  }

  _character(base, agent, st, t) {
    const ctx = this.ctx;
    const x = base.x;
    const y = base.y - 46;
    const working = st.state === "working";
    const offline = st.state === "offline";
    // "mengetik": badan sedikit naik-turun. idle: napas pelan. offline: diam & pudar.
    const bob = offline ? 0 : Math.sin(t * (working ? 10 : 2) + agent.id.length) * (working ? 4 : 2);
    ctx.save();
    ctx.globalAlpha = offline ? 0.4 : 1;
    ctx.translate(x, y + bob);

    // badan
    ctx.fillStyle = agent.color;
    ctx.strokeStyle = "#3D2C4F";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-20, 20); ctx.quadraticCurveTo(-24, -14, 0, -14);
    ctx.quadraticCurveTo(24, -14, 20, 20); ctx.closePath();
    ctx.fill(); ctx.stroke();

    // kepala
    ctx.beginPath();
    ctx.arc(0, -30, 18, 0, Math.PI * 2);
    ctx.fillStyle = "#ffe0bd"; ctx.fill(); ctx.stroke();
    // mata
    ctx.fillStyle = "#3D2C4F";
    const blink = Math.sin(t * 1.5 + agent.id.length) > 0.96 ? 1 : 0;
    if (!blink) {
      ctx.beginPath(); ctx.arc(-6, -32, 2.4, 0, 7); ctx.arc(6, -32, 2.4, 0, 7); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(-9, -32); ctx.lineTo(-3, -32);
      ctx.moveTo(3, -32); ctx.lineTo(9, -32); ctx.stroke();
    }
    // mulut (senyum saat kerja/selesai)
    ctx.beginPath();
    if (st.state === "just_done" || working) {
      ctx.arc(0, -26, 5, 0.1 * Math.PI, 0.9 * Math.PI);
    } else {
      ctx.moveTo(-4, -24); ctx.lineTo(4, -24);
    }
    ctx.stroke();

    // tangan mengetik saat working
    if (working) {
      const h = Math.sin(t * 16) * 3;
      ctx.strokeStyle = agent.color; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-14, 4); ctx.lineTo(-6, 14 + h);
      ctx.moveTo(14, 4); ctx.lineTo(6, 14 - h); ctx.stroke();
    }
    ctx.restore();
  }

  _nameplate(base, agent, st) {
    const ctx = this.ctx;
    const x = base.x;
    const y = base.y + 60;
    const label = STATE_LABEL[st.state] || st.state;
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    const w = Math.max(ctx.measureText(agent.label).width, 90) + 20;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.strokeStyle = "#d4ddee";
    roundRect(ctx, x - w / 2, y, w, 38, 8);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#3D2C4F";
    ctx.fillText(agent.label, x, y + 15);
    ctx.fillStyle = stateColor(st.state);
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillText("● " + label, x, y + 30);
  }

  _sparkle(base, t) {
    const ctx = this.ctx;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + t * 2;
      const r = 34 + Math.sin(t * 4 + i) * 6;
      star(ctx, base.x + Math.cos(a) * r, base.y - 60 + Math.sin(a) * r, 5, "#FFD43B");
    }
  }

  _zzz(base, t) {
    const ctx = this.ctx;
    ctx.fillStyle = "#9aa";
    ctx.font = "700 16px system-ui";
    ctx.textAlign = "left";
    const o = (t % 2) * 10;
    ctx.fillText("z", base.x + 18, base.y - 72 - o);
  }

  _workFx(base, agent, t) {
    const ctx = this.ctx;
    // gelembung aktivitas kecil di atas kepala
    const o = Math.sin(t * 3) * 3;
    ctx.fillStyle = agent.color;
    ctx.beginPath();
    ctx.arc(base.x + 22, base.y - 78 + o, 4, 0, 7);
    ctx.arc(base.x + 32, base.y - 82 + o, 3, 0, 7);
    ctx.fill();
  }
}

function stateColor(state) {
  return { working: "#E5A800", just_done: "#3B9C3F", idle: "#3FA9F5", offline: "#999" }[state]
    || "#999";
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function star(ctx, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 ? size * 0.4 : size;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
