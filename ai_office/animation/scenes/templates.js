/* AI Office - template scene (6). Masing-masing:
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
})(self.AIAnim);
