/* AI Office - pustaka animasi: INTI (matematika, SVG, teks, lip-sync, timeline).
 *
 * Aturan wajib: semua fungsi DETERMINISTIK. Hasil hanya bergantung pada input
 * (plan + waktu t). Dilarang memakai Math.random, Date, atau animasi CSS.
 * Setiap frame = renderFrame(plan, t) -> string SVG 1080x1920.
 */
(function (A) {
  "use strict";

  A.W = 1080;
  A.H = 1920;
  A.GROUND_Y = 1290; // garis kaki karakter
  A.TEXT_Y = 330; // posisi teks layar (on_screen_text)
  A.templates = A.templates || {};
  A.backgrounds = A.backgrounds || {};
  A.objects = A.objects || {};
  A.characters = A.characters || {};

  // ------------------------------------------------------------- angka
  const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    linear: (p) => p,
    inOutSine: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
    outCubic: (p) => 1 - Math.pow(1 - p, 3),
    inCubic: (p) => p * p * p,
    inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    outBack: (p) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    },
  };
  /** progres 0..1 dari t di jendela [start, start+dur], lalu di-ease */
  const prog = (t, start, dur, ease) => (ease || E.linear)(clamp((t - start) / dur));

  /** hash FNV-1a: angka acak yang SELALU sama untuk input yang sama */
  function hash(...parts) {
    let h = 0x811c9dc5;
    for (const part of parts) {
      const s = String(part);
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      h ^= 0x7c;
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  const rand = (...parts) => hash(...parts) / 4294967296;

  // --------------------------------------------------------------- SVG
  const fmt = (v, k) => {
    const r = Math.round(v * k) / k;
    return r === 0 ? "0" : String(r);
  };
  const num = (v) => fmt(v, 10);
  const num3 = (v) => fmt(v, 1000);
  const FINE = { opacity: 1, "fill-opacity": 1, "stroke-opacity": 1, offset: 1 };
  const esc = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function attrs(o) {
    let s = "";
    for (const k in o) {
      const v = o[k];
      if (v === undefined || v === null || v === false || v === "") continue;
      s += " " + k + '="' + (typeof v === "number" ? (FINE[k] ? num3(v) : num(v)) : esc(v)) + '"';
    }
    return s;
  }
  const el = (tag, o) => "<" + tag + attrs(o) + "/>";
  const wrap = (tag, o, inner) => "<" + tag + attrs(o) + ">" + inner + "</" + tag + ">";
  const grp = (o, ...kids) => wrap("g", o || {}, kids.join(""));
  /** transform: translate(x y) rotate(r) scale(sx sy) */
  function tf(x, y, r, sx, sy) {
    const parts = [];
    if (x || y) parts.push("translate(" + num(x || 0) + " " + num(y || 0) + ")");
    if (r) parts.push("rotate(" + num(r) + ")");
    if (sx === undefined) sx = 1;
    if (sy === undefined) sy = sx;
    if (sx !== 1 || sy !== 1) parts.push("scale(" + num3(sx) + " " + num3(sy) + ")");
    return parts.length ? parts.join(" ") : undefined;
  }
  /** data path: d("M", 0, 0, "L", 10, 10) */
  const d = (...parts) => parts.map((p) => (typeof p === "number" ? num(p) : p)).join(" ");

  A.u = { clamp, lerp, E, prog, hash, rand, num, num3, esc, attrs, el, wrap, grp, tf, d };

  // ------------------------------------------------------------ gaya
  A.PAL = {
    ink: "#3D2C4F", white: "#FFFFFF", cream: "#FFF6E0", sparkle: "#FFF3A3",
    sky1: "#6EC6FF", sky2: "#DDF4FF", sun: "#FFD43B", sunRay: "#FFB020",
    grass: "#7BD15A", grass2: "#62C04A", grass3: "#4FA83D", hill: "#A6E39A",
    wood: "#D9A066", wood2: "#B98048", sand: "#FCE3A8", sand2: "#F2CF84",
    sea: "#3FB8F5", sea2: "#2A9BDB", wall: "#FFE9C9", wall2: "#FFD9A3",
    mint: "#DDF4E4", board: "#2F6B4F",
  };
  /** warna katalog -> [utama, gelap] */
  A.COLORS = {
    merah: ["#FF5252", "#D63A3A"], kuning: ["#FFD43B", "#E5A800"],
    biru: ["#3FA9F5", "#1F7CC4"], hijau: ["#5CCB5F", "#3B9C3F"],
    oranye: ["#FF9F43", "#E07A14"], ungu: ["#A66CFF", "#7B45D6"],
    merah_muda: ["#FF8FC7", "#E0629E"], cokelat: ["#B5794F", "#8C5833"],
    hitam: ["#4A4A5E", "#2E2E3C"], putih: ["#FFFFFF", "#DDE1EA"],
  };
  A.CONFETTI = ["#FF5252", "#FFD43B", "#3FA9F5", "#5CCB5F", "#A66CFF", "#FF8FC7", "#FF9F43"];
  A.FONT = "AIOfficeFont, Fredoka, 'Baloo 2', 'Comic Sans MS', 'Segoe UI Black', 'Arial Rounded MT Bold', sans-serif";

  // ------------------------------------------------------------ teks
  const EM = 0.6; // perkiraan lebar rata-rata satu huruf (x ukuran font)
  /** pecah teks jadi 1-2 baris + ukuran font agar muat maxW */
  A.fitLines = function (text, maxW, maxSize) {
    const clean = String(text).trim().replace(/\s+/g, " ");
    const words = clean.split(" ");
    let lines = [clean];
    let size = Math.min(maxSize, maxW / (Math.max(1, clean.length) * EM));
    if (size < maxSize * 0.62 && words.length > 1) {
      let best = null;
      for (let k = 1; k < words.length; k++) {
        const a = words.slice(0, k).join(" ");
        const b = words.slice(k).join(" ");
        const w = Math.max(a.length, b.length);
        if (!best || w < best.w) best = { a, b, w };
      }
      lines = [best.a, best.b];
      size = Math.min(maxSize, maxW / (best.w * EM));
    }
    return { lines, size: Math.max(40, size) };
  };

  /** teks besar putih dengan garis tepi tebal (gaya channel) */
  A.bigText = function (text, o) {
    const fit = A.fitLines(text, o.maxW || 920, o.maxSize || 150);
    const size = fit.size;
    const lh = size * 1.08;
    let inner = "";
    fit.lines.forEach((line, k) => {
      const y = (k - (fit.lines.length - 1) / 2) * lh + size * 0.36;
      const base = {
        "text-anchor": "middle", "font-size": size, "font-family": A.FONT, "font-weight": 700,
      };
      inner += wrap("text", { ...base, x: 7, y: y + 9, fill: A.PAL.ink, opacity: 0.25 }, esc(line));
      inner += wrap("text", {
        ...base, x: 0, y, fill: o.fill || "#FFFFFF", stroke: A.PAL.ink,
        "stroke-width": size * 0.15, "stroke-linejoin": "round", "paint-order": "stroke",
      }, esc(line));
    });
    return grp({ transform: tf(o.x, o.y, o.rot || 0, o.scale === undefined ? 1 : o.scale) }, inner);
  };

  // -------------------------------------------------------- lip-sync
  /** suku kata kasar (Bahasa Indonesia fonetis): huruf vokal tiap suku kata */
  A.syllables = function (word) {
    const w = String(word).toLowerCase();
    if (/^\d+$/.test(w)) return ["a", "a"];
    const m = w.match(/[aiueo]+/g);
    return m && m.length ? m.map((g) => g[0]) : ["a"];
  };
  /** bukaan mulut 0..1 + vokal pada waktu t (relatif awal scene) */
  A.mouthAt = function (words, t) {
    if (words) {
      for (const w of words) {
        if (t < w.start) break;
        if (t <= w.end) {
          const syl = A.syllables(w.text);
          const p = clamp((t - w.start) / Math.max(0.06, w.end - w.start)) * syl.length;
          const k = Math.min(syl.length - 1, Math.floor(p));
          const bump = Math.sin(Math.PI * clamp(p - k));
          return { open: 0.2 + 0.8 * bump, vowel: syl[k] };
        }
      }
    }
    return { open: 0, vowel: "a" };
  };
  /** kedipan 0 (terbuka) .. 1 (tertutup); jadwal acak-deterministik per karakter */
  A.blinkAt = function (seed, gt) {
    let tb = 0.9 + rand(seed, "b0") * 1.4;
    for (let k = 1; k < 300 && tb <= gt; k++) {
      const dt = gt - tb;
      if (dt < 0.16) return Math.sin((Math.PI * dt) / 0.16);
      tb += 2.4 + rand(seed, "b", k) * 2.2;
    }
    return 0;
  };

  // --------------------------------------------------------- partikel
  /** bintang kilau 4 sudut */
  A.star4 = function (x, y, s, rot, fill, opacity) {
    const p = d("M", 0, -1, "Q", 0.18, -0.18, 1, 0, "Q", 0.18, 0.18, 0, 1, "Q", -0.18, 0.18, -1, 0,
      "Q", -0.18, -0.18, 0, -1, "Z");
    return el("path", { d: p, fill, opacity, transform: tf(x, y, rot, s) });
  };
  /** ledakan kilau pada t0 (sekali) */
  A.sparkleBurst = function (x, y, t0, t, o) {
    o = o || {};
    const dt = t - t0;
    if (dt < 0 || dt > 0.9) return "";
    const n = o.n || 10;
    const r = o.r || 220;
    const p = E.outCubic(clamp(dt / 0.9));
    let s = "";
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(o.seed || 0, "sp", i) * 0.5;
      const rr = r * (0.55 + 0.45 * rand(o.seed || 0, "sr", i)) * p;
      const size = (o.size || 26) * (1 - p * 0.6);
      const fill = i % 2 ? "#FFFFFF" : A.PAL.sparkle;
      s += A.star4(x + Math.cos(a) * rr, y + Math.sin(a) * rr, size, p * 90, fill, 1 - p);
    }
    return s;
  };
  /** konfeti jatuh (outro) */
  A.confetti = function (t, seed, n) {
    if (t <= 0) return "";
    let s = "";
    for (let i = 0; i < n; i++) {
      const x0 = rand(seed, "cx", i) * A.W;
      const speed = 260 + rand(seed, "cv", i) * 220;
      const delay = rand(seed, "cd", i) * 1.2;
      const tt = t - delay;
      if (tt <= 0) continue;
      const y = -60 + ((tt * speed) % (A.H + 120));
      const x = x0 + Math.sin(tt * (1.5 + rand(seed, "cs", i) * 2) + i) * 40;
      const rot = tt * (120 + rand(seed, "cr", i) * 200) * (i % 2 ? 1 : -1);
      const color = A.CONFETTI[i % A.CONFETTI.length];
      const w = 18 + rand(seed, "cw", i) * 14;
      s += el("rect", {
        x: -w / 2, y: -w / 4, width: w, height: w / 2, rx: 4, fill: color,
        transform: tf(x, y, rot, 1, Math.abs(Math.cos(tt * 4 + i)) * 0.8 + 0.2),
      });
    }
    return s;
  };
  /** lingkaran cahaya lembut di belakang objek */
  A.halo = function (x, y, r, gt) {
    if (r <= 1) return "";
    const pulse = 1 + 0.04 * Math.sin(gt * 3);
    return el("circle", { cx: x, cy: y, r: r * pulse, fill: "#FFFFFF", opacity: 0.45 }) +
      el("circle", { cx: x, cy: y, r: r * 0.78 * pulse, fill: "#FFFFFF", opacity: 0.35 });
  };
  /** lencana angka (hitung benda) */
  A.numberBadge = function (n, x, y, s, size) {
    if (s <= 0.01) return "";
    const r = Math.max(30, Math.min(48, size * 0.24));
    return grp({ transform: tf(x, y, 0, s) },
      el("circle", { cx: 0, cy: 0, r, fill: "#FFFFFF", stroke: A.PAL.ink, "stroke-width": 7 }),
      wrap("text", {
        x: 0, y: r * 0.42, "text-anchor": "middle", "font-size": r * 1.25, "font-family": A.FONT,
        "font-weight": 700, fill: A.PAL.ink,
      }, String(n)));
  };

  // ---------------------------------------------------------- timeline
  const EXIT_SEC = 0.28; // elemen scene keluar sebelum scene berikutnya
  const MOVE_SEC = 0.55; // karakter pindah posisi antar-scene
  A.EXIT_SEC = EXIT_SEC;

  function background(ctx) {
    const sc = ctx.scene;
    let s = A.backgrounds[sc.background](ctx.gt);
    if (ctx.prev && ctx.prev.background !== sc.background) {
      const p = prog(ctx.t, 0, 0.45, E.inOutSine);
      if (p < 1) s = A.backgrounds[ctx.prev.background](ctx.gt) + grp({ opacity: p }, s);
    }
    return s;
  }

  function drawCharacter(ctx, c) {
    if (!c) return "";
    const sc = ctx.scene;
    const L = A.templates[sc.template].layout(sc);
    let x = L.x;
    let y = L.y;
    let s = L.s;
    let hop = 0;
    const prev = ctx.prev;
    if (prev && prev.character === sc.character) {
      const P = A.templates[prev.template].layout(prev);
      const p = prog(ctx.t, 0, MOVE_SEC, E.inOutCubic);
      x = lerp(P.x, L.x, p);
      s = lerp(P.s, L.s, p);
      if (Math.abs(P.x - L.x) > 40) hop = Math.sin(Math.PI * p) * 70;
    } else if (L.enter === "rise") {
      y += (1 - prog(ctx.t, 0, 0.7, E.outBack)) * 900;
    } else {
      s *= prog(ctx.t, 0.05, 0.5, E.outBack);
    }
    if (ctx.next && ctx.next.character !== sc.character) s *= 1 - ctx.exit;
    if (s < 0.01) return "";
    const m = A.mouthAt(sc.words, ctx.t);
    return A.characters[sc.character].draw({
      x, y, s, hop, t: ctx.t, gt: ctx.gt, open: m.open, vowel: m.vowel,
      pose: c.pose || sc.pose, emotion: c.emotion || sc.emotion,
      look: c.look || null, pointAt: c.pointAt || null, clap: c.clap,
    });
  }

  function sceneText(ctx, out) {
    const text = ctx.scene.text;
    if (!text) return "";
    let s = prog(ctx.t, 0.2, 0.5, E.outBack) * (1 - ctx.exit);
    if (out.textPulse) s *= 1 + 0.05 * Math.sin(ctx.gt * 5);
    if (s <= 0.01) return "";
    return A.bigText(text, { x: A.W / 2, y: A.TEXT_Y, scale: s, rot: Math.sin(ctx.gt * 2.1) * 2 });
  }

  A.sceneIndexAt = function (plan, t) {
    const sc = plan.scenes;
    let i = 0;
    while (i < sc.length - 1 && t >= sc[i].start + sc[i].duration) i++;
    return i;
  };

  /** FRAME pada waktu global t (detik) -> string SVG */
  A.renderFrame = function (plan, t) {
    const i = A.sceneIndexAt(plan, t);
    const sc = plan.scenes[i];
    const lt = clamp(t - sc.start, 0, sc.duration);
    const ctx = {
      plan, scene: sc, t: lt, gt: t, dur: sc.duration, index: i,
      prev: plan.scenes[i - 1] || null, next: plan.scenes[i + 1] || null,
      isLast: i === plan.scenes.length - 1,
    };
    ctx.exit = ctx.isLast ? 0 : prog(lt, sc.duration - EXIT_SEC, EXIT_SEC, E.inCubic);
    const out = A.templates[sc.template].renderAt(ctx) || {};
    return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">' +
      background(ctx) + (out.back || "") + drawCharacter(ctx, out.char) + (out.front || "") +
      sceneText(ctx, out) + "</svg>";
  };

  /** periksa plan: semua nama harus ada di pustaka */
  A.validatePlan = function (plan) {
    const errs = [];
    if (!plan || !Array.isArray(plan.scenes) || !plan.scenes.length) return ["plan tanpa scene"];
    plan.scenes.forEach((sc) => {
      const where = "scene " + sc.id + ": ";
      if (!A.templates[sc.template]) errs.push(where + "template tidak ada: " + sc.template);
      const ch = A.characters[sc.character];
      if (!ch) errs.push(where + "karakter tidak ada: " + sc.character);
      else {
        if (ch.poses.indexOf(sc.pose) < 0) errs.push(where + "pose tidak ada: " + sc.pose);
        if (ch.emotions.indexOf(sc.emotion) < 0) errs.push(where + "emosi tidak ada: " + sc.emotion);
      }
      if (!A.backgrounds[sc.background]) errs.push(where + "latar tidak ada: " + sc.background);
      (sc.items || []).forEach((it) => {
        if (!A.objects[it]) errs.push(where + "objek tidak ada: " + it);
      });
      if (sc.color && !A.COLORS[sc.color]) errs.push(where + "warna tidak ada: " + sc.color);
    });
    return errs;
  };

  /** daftar isi pustaka (dicocokkan dengan catalog.yaml oleh test) */
  A.manifest = function () {
    const characters = {};
    Object.keys(A.characters).forEach((k) => {
      characters[k] = { poses: A.characters[k].poses.slice(), emotions: A.characters[k].emotions.slice() };
    });
    return {
      templates: Object.keys(A.templates), backgrounds: Object.keys(A.backgrounds),
      objects: Object.keys(A.objects).filter((k) => k[0] !== "_"),
      colors: Object.keys(A.COLORS), characters,
    };
  };

  // ------------------------------------------------- jembatan browser
  A.load = function (plan) {
    const errs = A.validatePlan(plan);
    if (!errs.length) A._plan = plan;
    return errs;
  };
  A.show = function (t) {
    const stage = document.getElementById("stage");
    stage.innerHTML = A.renderFrame(A._plan, t);
    return stage.getBoundingClientRect().height;
  };
  /** satu pintu untuk test (Node atau browser) */
  A.handle = function (req) {
    if (req.op === "manifest") return A.manifest();
    if (req.op === "validate") return A.validatePlan(req.plan);
    if (req.op === "frames") return req.times.map((t) => A.renderFrame(req.plan, t));
    throw new Error("op tidak dikenal: " + req.op);
  };
})((self.AIAnim = self.AIAnim || {}));
