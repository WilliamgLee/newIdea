/* AI Office - karakter SVG: Kiki (kucing kuning) & Bubu (beruang cokelat).
 * Keduanya memakai rig yang sama: badan, kepala, mata (kedip), mulut (lip-sync),
 * dua tangan (pose + menunjuk + tepuk), telinga. Semua deterministik.
 */
(function (A) {
  "use strict";
  const u = A.u;
  const { grp, el, wrap, tf, d, clamp, lerp, E } = u;
  const P = A.PAL;

  const POSES = ["idle", "wave", "point", "jump", "think", "clap"];
  const EMOTIONS = ["happy", "excited", "surprised", "thinking", "calm"];

  // ------------------------------------------------------------ mata
  function eye(cx, cy, r, blink, look) {
    const lx = look ? clamp(look.x, -1, 1) * r * 0.3 : 0;
    const ly = look ? clamp(look.y, -1, 1) * r * 0.3 : 0;
    const open = 1 - clamp(blink);
    if (open < 0.08) {
      return el("path", {
        d: d("M", cx - r, cy, "Q", cx, cy + r * 0.5, cx + r, cy),
        stroke: P.ink, "stroke-width": r * 0.3, fill: "none", "stroke-linecap": "round",
      });
    }
    return grp({},
      el("ellipse", { cx, cy, rx: r, ry: r * open, fill: "#FFFFFF", stroke: P.ink, "stroke-width": 3 }),
      el("circle", { cx: cx + lx, cy: cy + ly, r: r * 0.6 * open, fill: P.ink }),
      el("circle", { cx: cx + lx + r * 0.22, cy: cy + ly - r * 0.25 * open, r: r * 0.2, fill: "#FFFFFF" }));
  }

  // ----------------------------------------------------------- mulut
  function mouth(cx, cy, open, vowel, smile) {
    const w = 44 * (vowel === "i" || vowel === "e" ? 1.25 : vowel === "o" || vowel === "u" ? 0.7 : 1);
    const h = 10 + open * 70;
    if (open < 0.12) {
      const curve = 16 * smile;
      return el("path", {
        d: d("M", cx - w * 0.5, cy, "Q", cx, cy + curve, cx + w * 0.5, cy),
        stroke: P.ink, "stroke-width": 7, fill: "none", "stroke-linecap": "round",
      });
    }
    return grp({},
      el("ellipse", { cx, cy: cy + h * 0.1, rx: w * 0.5, ry: h * 0.5, fill: "#5B3B52", stroke: P.ink, "stroke-width": 5 }),
      el("ellipse", { cx, cy: cy + h * 0.32, rx: w * 0.3, ry: h * 0.28, fill: "#FF7CA3" }));
  }

  // --------------------------------------------------------- alis/emosi
  function brows(cx, eyeR, emotion, gt) {
    const y = -eyeR * 2.1;
    let a = 0; let dy = 0;
    if (emotion === "surprised") dy = -8;
    else if (emotion === "thinking") a = 14;
    else if (emotion === "excited") dy = -5;
    const brow = (sx) => el("path", {
      d: d("M", -22, 0, "Q", 0, -10, 22, 0),
      transform: tf(cx * sx, y + dy, a * sx, 0.8),
      stroke: P.ink, "stroke-width": 7, fill: "none", "stroke-linecap": "round",
    });
    return brow(-1) + brow(1);
  }

  // ------------------------------------------------------------ tangan
  /** lengan dari bahu ke telapak dengan sedikit lengkung */
  function arm(sx, sy, hx, hy, color, dark) {
    const mx = (sx + hx) / 2 - (hy - sy) * 0.15;
    const my = (sy + hy) / 2 + (hx - sx) * 0.15;
    return el("path", {
      d: d("M", sx, sy, "Q", mx, my, hx, hy),
      stroke: color, "stroke-width": 34, fill: "none", "stroke-linecap": "round",
    }) + el("circle", { cx: hx, cy: hy, r: 26, fill: color, stroke: dark, "stroke-width": 4 });
  }

  function handsFor(pose, t, gt, clap, pointAt, color, dark, shoulder) {
    const sxl = -shoulder; const sxr = shoulder; const sy = -40;
    let lh = [-shoulder - 20, 120]; let rh = [shoulder + 20, 120];
    if (pose === "wave") {
      const w = Math.sin(gt * 9) * 28;
      rh = [shoulder + 90, -150 + w * 0.4];
      lh = [-shoulder - 30, 90];
    } else if (pose === "point") {
      const dir = pointAt && pointAt.x < 0 ? -1 : 1;
      const px = (shoulder + 120) * dir;
      rh = dir > 0 ? [px, -40] : lh;
      lh = dir > 0 ? [-shoulder - 20, 110] : [px, -40];
    } else if (pose === "think") {
      rh = [40, -210]; // tangan ke dagu
      lh = [-shoulder - 10, 110];
    } else if (pose === "clap" || clap) {
      const c = Math.abs(Math.sin(gt * 10)) * 60;
      lh = [-20 - c, -70]; rh = [20 + c, -70];
    } else if (pose === "jump") {
      rh = [shoulder + 70, -180]; lh = [-shoulder - 70, -180];
    } else {
      // idle: ayun halus
      const s = Math.sin(gt * 2) * 10;
      lh = [-shoulder - 20, 120 + s]; rh = [shoulder + 20, 120 - s];
    }
    return arm(sxl, sy, lh[0], lh[1], color, dark) + arm(sxr, sy, rh[0], rh[1], color, dark);
  }

  // ----------------------------------------------------- faktor pose tubuh
  function bodyMotion(pose, t, gt) {
    let bob = Math.sin(gt * 2) * 6; // napas
    let rot = 0; let jump = 0; let lean = 0;
    if (pose === "jump") jump = Math.abs(Math.sin(gt * 4)) * 90;
    else if (pose === "wave") lean = 4;
    else if (pose === "think") { rot = -4; lean = -3; }
    else if (pose === "excited") bob = Math.sin(gt * 6) * 10;
    return { bob, rot, jump, lean };
  }

  // --------------------------------------------------------- bentuk spesies
  function catEars(color, dark) {
    const ear = (sx) => el("path", {
      d: d("M", 0, 0, "L", 55 * sx, -120, "L", 95 * sx, -10, "Z"),
      fill: color, stroke: dark, "stroke-width": 5, "stroke-linejoin": "round",
      transform: tf(60 * sx, -150),
    }) + el("path", { d: d("M", 0, 0, "L", 32 * sx, -72, "L", 55 * sx, -8, "Z"), fill: "#FF9EC2", transform: tf(60 * sx, -150) });
    return ear(-1) + ear(1);
  }
  function bearEars(color, dark) {
    const ear = (sx) => grp({ transform: tf(95 * sx, -150) },
      el("circle", { r: 48, fill: color, stroke: dark, "stroke-width": 5 }),
      el("circle", { r: 24, fill: "#E7B98C" }));
    return ear(-1) + ear(1);
  }
  function catFace(open, vowel, blink, look, emotion, gt, R, color, dark) {
    const whisk = (sx, i) => el("line", {
      x1: 20 * sx, y1: -4 + i * 16, x2: 90 * sx, y2: -16 + i * 20,
      stroke: P.ink, "stroke-width": 3, "stroke-linecap": "round", opacity: 0.7,
    });
    return el("path", { d: d("M", -12, 44, "L", 12, 44, "L", 0, 58, "Z"), fill: "#FF7CA3", stroke: dark, "stroke-width": 3 }) +
      [-1, 1].map((s) => [0, 1].map((i) => whisk(s, i)).join("")).join("");
  }
  function bearSnout() {
    return el("ellipse", { cx: 0, cy: 44, rx: 70, ry: 52, fill: "#F0D2AC" }) +
      el("ellipse", { cx: 0, cy: 20, rx: 20, ry: 14, fill: P.ink });
  }

  // --------------------------------------------------------- pembuat karakter
  function makeChar(opts) {
    const base = { poses: POSES, emotions: EMOTIONS };
    base.draw = function (s) {
      const col = opts.color; const dark = opts.dark; const belly = opts.belly;
      const R = 150; const bodyW = 150; const bodyH = 200;
      const m = bodyMotion(s.pose, s.t, s.gt);
      const blink = A.blinkAt(opts.seed, s.gt);
      const smile = s.emotion === "calm" ? 0.6 : s.emotion === "thinking" ? 0.1 : 1;
      const headRot = (s.look ? s.look.x * 4 : 0) + (s.emotion === "thinking" ? -3 : 0);
      const legs = el("ellipse", { cx: -55, cy: bodyH + 58, rx: 46, ry: 30, fill: dark }) +
        el("ellipse", { cx: 55, cy: bodyH + 58, rx: 46, ry: 30, fill: dark });
      const body = el("path", {
        d: d("M", -bodyW, 40, "Q", -bodyW - 10, bodyH, 0, bodyH + 40, "Q", bodyW + 10, bodyH, bodyW, 40,
          "Q", bodyW * 0.7, -30, 0, -30, "Q", -bodyW * 0.7, -30, -bodyW, 40, "Z"),
        fill: col, stroke: dark, "stroke-width": 6,
      }) + el("ellipse", { cx: 0, cy: bodyH * 0.62, rx: bodyW * 0.52, ry: bodyH * 0.44, fill: belly });
      const ears = opts.species === "cat" ? catEars(col, dark) : bearEars(col, dark);
      const faceExtra = opts.species === "cat"
        ? catFace(s.open, s.vowel, blink, s.look, s.emotion, s.gt, R, col, dark)
        : bearSnout();
      const head = grp({ transform: tf(0, -bodyH * 0.1 - R * 0.7, headRot) },
        ears,
        el("circle", { cx: 0, cy: 0, r: R, fill: col, stroke: dark, "stroke-width": 6 }),
        faceExtra,
        eye(-56, -14, 30, blink, s.look), eye(56, -14, 30, blink, s.look),
        brows(56, 30, s.emotion, s.gt),
        mouth(0, 70, s.open, s.vowel, smile),
        (s.emotion === "excited" || s.emotion === "happy"
          ? el("ellipse", { cx: -96, cy: 48, rx: 26, ry: 18, fill: "#FF9EC2", opacity: 0.6 }) +
            el("ellipse", { cx: 96, cy: 48, rx: 26, ry: 18, fill: "#FF9EC2", opacity: 0.6 })
          : ""));
      const hands = handsFor(s.pose, s.t, s.gt, s.clap, s.pointAt, col, dark, bodyW * 0.8);
      const scale = s.s * (opts.scale || 1);
      return grp({ transform: tf(s.x, s.y - m.jump - s.hop, m.rot + m.lean, scale) },
        grp({ transform: tf(0, -bodyH - R * 0.3) }, legs, body, hands, head));
    };
    return base;
  }

  A.characters.kiki = makeChar({
    species: "cat", color: P.sun, dark: "#E5A800", belly: "#FFF0C2", seed: 11, scale: 1,
  });
  A.characters.bubu = makeChar({
    species: "bear", color: "#C98A5A", dark: "#9C6433", belly: "#E7C8A4", seed: 23, scale: 1,
  });
})(self.AIAnim);
