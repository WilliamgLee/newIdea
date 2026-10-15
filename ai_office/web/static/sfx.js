// Efek suara chiptune AI Office. Semua bunyi disintesis langsung dengan WebAudio (tanpa file
// audio), jadi satu tema dengan tampilan pixel. Dipakai dashboard publik & panel admin.
//
// - Setiap klik tombol (button, .btn, select, checkbox) otomatis berbunyi "click".
//   Tombol bisa memilih bunyi lain lewat atribut data-sfx="nama".
// - Tombol #sound-toggle menyalakan/mematikan suara (tersimpan di localStorage). Tombol M juga.
"use strict";

const PREF_KEY = "ai_office_sound";
const NOTE = {
  C4: 262, E4: 330, G4: 392, A4: 440, C5: 523, D5: 587, E5: 659, G5: 784, A5: 880,
  B5: 988, C6: 1047, E6: 1319, G6: 1568,
};

let ctx = null;
let master = null;
let unlocked = false;
let enabled = readPref();

function readPref() {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

function writePref(on) {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    /* mode privat / storage diblokir: abaikan */
  }
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Satu nada: gelombang, frekuensi awal -> akhir, durasi (detik), volume, jeda mulai.
function tone(type, f0, f1, dur, vol = 0.5, at = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

// Desis pendek (langkah kaki, kertas) lewat noise yang difilter.
function hiss(dur, vol = 0.2, at = 0, cutoff = 2500) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = cutoff;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

const SOUNDS = {
  click: () => tone("square", NOTE.E5, NOTE.A5, 0.05, 0.28),
  select: () => {
    tone("triangle", NOTE.C5, NOTE.C6, 0.08, 0.45);
    tone("square", NOTE.G5, NOTE.G5, 0.05, 0.12, 0.06);
  },
  toggle: () => {
    tone("square", NOTE.C5, NOTE.C5, 0.06, 0.25);
    tone("square", NOTE.G5, NOTE.G5, 0.09, 0.25, 0.06);
  },
  coin: () => {
    tone("square", NOTE.B5, NOTE.B5, 0.07, 0.25);
    tone("square", NOTE.E6, NOTE.E6, 0.22, 0.25, 0.07);
  },
  pickup: () => tone("triangle", NOTE.G4, NOTE.G5, 0.1, 0.45),
  step: () => hiss(0.025, 0.05, 0, 3500),
  handoff: () => {
    tone("square", NOTE.C5, NOTE.C5, 0.07, 0.22);
    tone("square", NOTE.E5, NOTE.E5, 0.07, 0.22, 0.07);
    tone("square", NOTE.G5, NOTE.G5, 0.13, 0.22, 0.14);
  },
  bell: () => {
    tone("triangle", NOTE.E6, NOTE.E6, 0.25, 0.4);
    tone("triangle", NOTE.C6, NOTE.C6, 0.35, 0.35, 0.22);
  },
  revise: () => {
    tone("square", NOTE.G4, NOTE.E4, 0.12, 0.25);
    tone("square", NOTE.E4, NOTE.C4, 0.22, 0.25, 0.13);
  },
  done: () => {
    [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => tone("square", f, f, 0.1, 0.22, i * 0.1));
    tone("square", NOTE.C6, NOTE.C6, 0.4, 0.24, 0.3);
    tone("triangle", NOTE.C4, NOTE.C4, 0.7, 0.4, 0.3);
    tone("square", NOTE.G5, NOTE.G5, 0.08, 0.15, 0.55);
    tone("square", NOTE.C6, NOTE.C6, 0.3, 0.2, 0.63);
  },
  fail: () => {
    tone("sawtooth", 220, 98, 0.45, 0.22);
    tone("square", 196, 196, 0.08, 0.15, 0.05);
  },
  reject: () => tone("square", 196, 82, 0.22, 0.25),
  jump: () => tone("square", 420, 840, 0.08, 0.18),
  meow: () => {
    tone("triangle", 700, 1150, 0.12, 0.35);
    tone("triangle", 1150, 620, 0.25, 0.3, 0.12);
  },
  paper: () => hiss(0.08, 0.12, 0, 1800),
};

export const sfx = {
  get enabled() {
    return enabled;
  },
  play(name) {
    // sebelum ada interaksi pengguna, browser memblokir audio: lewati diam-diam
    if (!enabled || !unlocked) return;
    const fn = SOUNDS[name];
    if (fn) fn();
  },
  setEnabled(on) {
    enabled = Boolean(on);
    writePref(enabled);
    syncToggle();
    if (enabled) {
      unlock();
      SOUNDS.toggle();
    }
  },
  toggle() {
    this.setEnabled(!enabled);
  },
};

function unlock() {
  if (unlocked) return;
  if (audio()) unlocked = true;
}

function syncToggle() {
  const b = document.getElementById("sound-toggle");
  if (!b) return;
  b.textContent = enabled ? "SOUND: ON" : "SOUND: OFF";
  b.setAttribute("aria-pressed", String(enabled));
}

const CLICKABLE = "button, .btn, select, summary, input[type=checkbox], input[type=radio], "
  + "input[type=submit], input[type=button]";

document.addEventListener("pointerdown", unlock, true);
document.addEventListener("keydown", unlock, true);

document.addEventListener("click", (e) => {
  const target = e.target.closest(CLICKABLE);
  if (!target || target.disabled) return;
  if (target.id === "sound-toggle") {
    sfx.toggle();
    return;
  }
  sfx.play(target.dataset.sfx || "click");
  // link bergaya tombol: tunda navigasi sebentar agar bunyinya sempat terdengar
  if (enabled && target.matches("a.btn[href]") && !target.target
      && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.defaultPrevented) {
    e.preventDefault();
    setTimeout(() => (window.location.href = target.href), 110);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "m" && e.key !== "M") return;
  if (e.target.closest("input, textarea, select, [contenteditable]")) return;
  sfx.toggle();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", syncToggle);
} else {
  syncToggle();
}
