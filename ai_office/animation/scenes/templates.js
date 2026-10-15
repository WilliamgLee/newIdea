/* AI Office - template scene (10). Masing-masing:
 *   layout(scene) -> {x,y,s} posisi karakter (dipakai inti untuk transisi antar-scene)
 *   renderAt(ctx) -> {back, char:{pose,emotion,look,pointAt,clap}, front, textPulse}
 * Semua deterministik; animasi masuk/keluar via progres waktu.
 */
(function (A) {
  "use strict";
  const u = A.u;
  const { grp, el, prog, E, clamp } = u;
  const T = A.templates;
  const CX = A.W / 2;
  const GY = A.GROUND_Y;

  const objOf = (name) => A.objects[name] || A.objects._fallback;
  const colorArr = (sc) => (sc.color && A.COLORS[sc.color]) ? A.COLORS[sc.color] : null;

  /** objek muncul: pop-in dengan easing + melayang; keluar menyusut */
  function showObject(name, x, y, scale, ctx, startIn, opts) {
    opts = opts || {};
    const pin = prog(ctx.t, startIn || 0.15, 0.6, E.outBack);
    const s = scale * pin * (1 - ctx.exit);
    if (s < 0.01) return "";
    const inner = objOf(name)({ gt: ctx.gt, color: opts.color || null, i: opts.i || 0 });
    const halo = opts.halo ? A.halo(x, y, 150 * s, ctx.gt) : "";
    return grp({ transform: u.tf(x, y, 0, s) }, halo + inner);
  }

  // --------------------------------------------------- intro (scene pertama)
  T.intro = {
    layout: () => ({ x: CX, y: GY, s: 1.0, enter: "rise" }),
    renderAt(ctx) {
      const sp = A.sparkleBurst(CX, GY - 520, 0.25, ctx.t, { n: 12, r: 320, seed: 1 });
      return { char: { pose: ctx.scene.pose, emotion: ctx.scene.emotion }, front: sp, textPulse: true };
    },
  };

  // ------------------------------------------------------------- outro (akhir)
  T.outro = {
    layout: () => ({ x: CX, y: GY, s: 1.05 }),
    renderAt(ctx) {
      const conf = A.confetti(ctx.t, 7, 40);
      const sp = A.sparkleBurst(CX, GY - 520, 0.2, ctx.t, { n: 14, r: 360, seed: 2 });
      return { char: { pose: ctx.scene.pose, emotion: ctx.scene.emotion }, back: conf, front: sp, textPulse: true };
    },
  };

  // --------------------------------------------- show_object (1 objek, karakter menunjuk)
  T.show_object = {
    layout: () => ({ x: CX - 300, y: GY, s: 0.9 }),
    renderAt(ctx) {
      const sc = ctx.scene;
      const ox = CX + 230; const oy = GY - 420;
      const front = showObject(sc.items[0], ox, oy, 1.15, ctx, 0.2, { color: colorArr(sc), halo: true });
      return {
        char: { pose: "point", emotion: sc.emotion, pointAt: { x: 1 }, look: { x: 1, y: -0.3 } },
        front, textPulse: true,
      };
    },
  };

  // ------------------------------------------- count_objects (muncul satu-satu, dihitung)
  T.count_objects = {
    layout: () => ({ x: CX, y: GY, s: 0.8 }),
    renderAt(ctx) {
      const sc = ctx.scene;
      const n = clamp(sc.count || sc.items.length || 1, 1, 10);
      const name = sc.items[0];
      const color = colorArr(sc);
      const cols = n <= 3 ? n : n <= 6 ? 3 : 4;
      const rows = Math.ceil(n / cols);
      const gapX = Math.min(260, 820 / cols);
      const gapY = 240;
      const topY = GY - 560;
      const per = Math.max(0.12, (ctx.dur - 1.2) / n);
      let items = "";
      let shown = 0;
      for (let i = 0; i < n; i++) {
        const r = Math.floor(i / cols); const c = i % cols;
        const inRow = Math.min(cols, n - r * cols);
        const x = CX + (c - (inRow - 1) / 2) * gapX;
        const y = topY + r * gapY;
        const start = 0.4 + i * per;
        const pin = prog(ctx.t, start, 0.45, E.outBack);
        if (pin > 0.01) shown = i + 1;
        const s = 0.62 * pin * (1 - ctx.exit);
        if (s < 0.01) continue;
        const o = grp({ transform: u.tf(x, y, 0, s) }, objOf(name)({ gt: ctx.gt, color, i }));
        const badge = A.numberBadge(i + 1, x + 70, y - 80, prog(ctx.t, start + 0.1, 0.3), 220 * s * 1.6);
        items += o + badge;
      }
      return {
        char: { pose: "point", emotion: "excited", pointAt: { x: 1 }, look: { x: 0.2, y: -0.6 } },
        front: items, textPulse: true, _shown: shown,
      };
    },
  };

  // ------------------------------------------------ compare (2 objek berdampingan)
  T.compare = {
    layout: () => ({ x: CX, y: GY, s: 0.72 }),
    renderAt(ctx) {
      const sc = ctx.scene;
      const color = colorArr(sc);
      const left = showObject(sc.items[0], CX - 250, GY - 430, 1.0, ctx, 0.2, { color, i: 0 });
      const right = showObject(sc.items[1] || sc.items[0], CX + 250, GY - 430, 1.0, ctx, 0.45, { i: 1 });
      const vs = prog(ctx.t, 0.7, 0.4, E.outBack) * (1 - ctx.exit);
      const vsEl = vs > 0.01 ? A.bigText("vs", { x: CX, y: GY - 430, scale: vs * 0.5, maxSize: 120 }) : "";
      return {
        char: { pose: "idle", emotion: sc.emotion, look: { x: 0, y: -0.5 } },
        back: left + right, front: vsEl, textPulse: true,
      };
    },
  };

  // --------------------------------------------- guess (objek tersembunyi, lalu terungkap)
  T.guess = {
    layout: () => ({ x: CX - 300, y: GY, s: 0.9 }),
    renderAt(ctx) {
      const sc = ctx.scene;
      const ox = CX + 230; const oy = GY - 420;
      const reveal = ctx.dur * 0.6; // waktu objek terungkap
      const before = ctx.t < reveal;
      let front = "";
      if (before) {
        const wob = Math.sin(ctx.gt * 4) * 6;
        const pin = prog(ctx.t, 0.2, 0.5, E.outBack);
        front = grp({ transform: u.tf(ox, oy, wob, pin) },
          el("circle", { r: 150, fill: "#B49BE0", stroke: A.PAL.ink, "stroke-width": 8 }),
          A.bigText("?", { x: 0, y: 0, scale: 1.3, maxSize: 200 }));
      } else {
        const sp = A.sparkleBurst(ox, oy, reveal, ctx.t, { n: 10, r: 240, seed: 5 });
        const pop = prog(ctx.t, reveal, 0.45, E.outBack);
        front = grp({ transform: u.tf(ox, oy, 0, pop * (1 - ctx.exit)) },
          A.halo(0, 0, 150, ctx.gt) + objOf(sc.items[0])({ gt: ctx.gt, color: colorArr(sc) })) + sp;
      }
      return {
        char: {
          pose: before ? "think" : "clap", emotion: before ? "thinking" : "excited",
          pointAt: { x: 1 }, look: { x: 1, y: -0.3 }, clap: !before,
        },
        front, textPulse: true,
      };
    },
  };

  // ------------------------------------- find_odd (3 objek sama + 1 beda, cari yang beda)
  T.find_odd = {
    layout: () => ({ x: CX - 330, y: GY, s: 0.75 }),
    renderAt(ctx) {
      const sc = ctx.scene;
      const same = sc.items[0];
      const odd = sc.items[1] || sc.items[0];
      const oddIdx = u.hash(sc.id, "odd") % 4;
      const reveal = ctx.dur * 0.6;
      const after = ctx.t >= reveal;
      const color = colorArr(sc);
      const spots = [[CX + 10, GY - 680], [CX + 330, GY - 680], [CX + 10, GY - 360], [CX + 330, GY - 360]];
      let front = "";
      spots.forEach(([x, y], i) => {
        const isOdd = i === oddIdx;
        const pin = prog(ctx.t, 0.2 + i * 0.18, 0.45, E.outBack);
        let s = 0.82 * pin * (1 - ctx.exit);
        if (after && isOdd) s *= 1 + 0.12 * Math.abs(Math.sin((ctx.t - reveal) * 6));
        if (s < 0.01) return;
        const wob = after ? 0 : Math.sin(ctx.gt * 3 + i) * 4;
        const inner = objOf(isOdd ? odd : same)({ gt: ctx.gt, color: isOdd ? null : color, i });
        const halo = after && isOdd ? A.halo(0, 0, 170, ctx.gt) : "";
        const dim = after && !isOdd ? 0.45 : 1;
        front += grp({ transform: u.tf(x, y, wob, s), opacity: dim }, halo + inner);
      });
      const [ox, oy] = spots[oddIdx];
      front += A.sparkleBurst(ox, oy, reveal, ctx.t, { n: 12, r: 200, seed: 11 });
      return {
        char: {
          pose: after ? "clap" : "think", emotion: after ? "excited" : "thinking",
          look: { x: 1, y: -0.4 }, pointAt: { x: 1 }, clap: after,
        },
        front, textPulse: true,
      };
    },
  };

  // --------------------------------------- pattern (A-B-A-B-?, lalu terungkap A)
  T.pattern = {
    layout: () => ({ x: CX, y: GY, s: 0.72 }),
    renderAt(ctx) {
      const sc = ctx.scene;
      const a = sc.items[0];
      const b = sc.items[1] || sc.items[0];
      const color = colorArr(sc);
      const reveal = ctx.dur * 0.65;
      const after = ctx.t >= reveal;
      const y = GY - 760;
      let front = "";
      for (let i = 0; i < 5; i++) {
        const x = CX + (i - 2) * 200;
        const pin = prog(ctx.t, 0.25 + i * 0.3, 0.4, E.outBack);
        const s = 0.6 * pin * (1 - ctx.exit);
        if (s < 0.01) continue;
        const bob = Math.sin(ctx.gt * 3 + i * 0.9) * 10;
        if (i < 4) {
          const name = i % 2 === 0 ? a : b;
          front += grp({ transform: u.tf(x, y + bob, 0, s) },
            objOf(name)({ gt: ctx.gt, color: i % 2 === 0 ? color : null, i }));
        } else if (!after) {
          front += grp({ transform: u.tf(x, y + bob, Math.sin(ctx.gt * 4) * 6, s * 1.4) },
            el("circle", { r: 95, fill: "#B49BE0", stroke: A.PAL.ink, "stroke-width": 8 }),
            A.bigText("?", { x: 0, y: 0, scale: 0.9, maxSize: 150 }));
        } else {
          const pop = prog(ctx.t, reveal, 0.45, E.outBack) * (1 - ctx.exit);
          front += grp({ transform: u.tf(x, y, 0, 0.6 * pop) },
            A.halo(0, 0, 200, ctx.gt) + objOf(a)({ gt: ctx.gt, color, i }));
        }
      }
      front += A.sparkleBurst(CX + 400, y, reveal, ctx.t, { n: 10, r: 170, seed: 12 });
      return {
        char: {
          pose: after ? "jump" : "think", emotion: after ? "excited" : "thinking",
          look: { x: 0.4, y: -0.8 }, clap: false,
        },
        front, textPulse: true,
      };
    },
  };

  // ---------------------------------- color_change (satu benda berganti-ganti warna)
  const BRIGHT = ["merah", "kuning", "biru", "hijau", "oranye", "ungu", "merah_muda"];
  T.color_change = {
    layout: () => ({ x: CX - 300, y: GY, s: 0.9 }),
    renderAt(ctx) {
      const sc = ctx.scene;
      const start = Math.max(0, BRIGHT.indexOf(sc.color || "merah"));
      const steps = 4;
      const per = ctx.dur / steps;
      const k = Math.min(steps - 1, Math.floor(ctx.t / per));
      const colorName = BRIGHT[(start + k) % BRIGHT.length];
      const ox = CX + 230;
      const oy = GY - 420;
      const pin = prog(ctx.t, 0.15, 0.6, E.outBack);
      const bump = 1 + 0.1 * Math.max(0, 1 - (ctx.t - k * per) / 0.3);
      const s = 1.15 * pin * bump * (1 - ctx.exit);
      let front = "";
      if (s > 0.01) {
        front = grp({ transform: u.tf(ox, oy, 0, s) },
          A.halo(0, 0, 150, ctx.gt) + objOf(sc.items[0])({ gt: ctx.gt, color: A.COLORS[colorName] }));
      }
      for (let i = 1; i < steps; i++) {
        front += A.sparkleBurst(ox, oy, i * per, ctx.t, { n: 10, r: 230, seed: 20 + i });
      }
      return {
        char: { pose: "point", emotion: "excited", pointAt: { x: 1 }, look: { x: 1, y: -0.3 } },
        front, textPulse: true,
      };
    },
  };

  // ----------------------------------- sing_along (menari & tepuk tangan + not musik)
  function note(x, y, s, color, rot) {
    return grp({ transform: u.tf(x, y, rot, s) },
      el("ellipse", { cx: 0, cy: 0, rx: 26, ry: 20, fill: color, stroke: A.PAL.ink, "stroke-width": 6,
        transform: "rotate(-20)" }),
      el("rect", { x: 16, y: -92, width: 12, height: 92, rx: 4, fill: A.PAL.ink }),
      el("path", { d: "M22 -92 Q60 -76 52 -40 Q46 -62 22 -66 Z", fill: A.PAL.ink }));
  }
  T.sing_along = {
    layout: () => ({ x: CX, y: GY, s: 1.0 }),
    renderAt(ctx) {
      const beat = Math.floor(ctx.t / 0.6);
      const clapNow = beat % 2 === 1;
      let back = "";
      const n = 8;
      const life = 2.4;
      for (let i = 0; i < n; i++) {
        // not muncul bergiliran dan tersebar merata di lebar layar
        const delay = (i / n) * life;
        const tt = (ctx.t - delay) % life;
        if (ctx.t < delay || tt < 0) continue;
        const p = tt / life;
        const slot = (i * 3) % n; // urutan kolom diacak agar tidak berbaris
        const x0 = 120 + ((slot + 0.5) / n) * (A.W - 240) + (u.rand(ctx.scene.id, "nx", i) - 0.5) * 60;
        const x = x0 + Math.sin(tt * 3 + i) * 50;
        const y = GY - 250 - p * 950;
        const s = (1.1 + u.rand(ctx.scene.id, "ns", i) * 0.5) * Math.min(1, p * 5) * (1 - p * 0.4) * (1 - ctx.exit);
        if (s < 0.01) continue;
        back += grp({ opacity: 1 - p * 0.8 }, note(x, y, s, A.CONFETTI[i % A.CONFETTI.length], Math.sin(tt * 4 + i) * 15));
      }
      return {
        char: { pose: clapNow ? "clap" : "jump", emotion: "excited", clap: clapNow, look: { x: 0, y: -0.2 } },
        back, textPulse: true,
      };
    },
  };
})(self.AIAnim);
