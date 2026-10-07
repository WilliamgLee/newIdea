/* AI Office - objek (29). Masing-masing: function(ctx) -> SVG, digambar di sekitar (0,0),
 * ukuran kira-kira 220px, deterministik. ctx = {gt, color:[main,dark]|null, i}. */
(function (A) {
  "use strict";
  const u = A.u;
  const { el, grp, wrap, tf, d } = u;
  const P = A.PAL;
  const O = A.objects;
  const col = (ctx, fb) => (ctx && ctx.color ? ctx.color : fb);

  const circle = (r, fill, stroke) => el("circle", { r, fill, stroke: stroke || "none", "stroke-width": stroke ? 6 : 0 });
  const bob = (gt, amp, spd) => tf(0, Math.sin((gt || 0) * (spd || 2)) * (amp || 8));

  // ---- hewan ----
  function animalBase(ctx, body, dark, parts) {
    return grp({ transform: bob(ctx.gt, 6, 1.8) }, parts);
  }
  O.kucing = (ctx) => { const [c, dk] = col(ctx, ["#FFC93C", "#E5A800"]);
    return grp({ transform: bob(ctx.gt, 6, 2) },
      el("ellipse", { cx: 0, cy: 40, rx: 100, ry: 80, fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: d("M", 90, 60, "Q", 170, 20, 150, -40), stroke: c, "stroke-width": 26, fill: "none", "stroke-linecap": "round" }),
      el("circle", { cx: 0, cy: -70, r: 70, fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: d("M", -55, -120, "L", -30, -70, "L", -72, -72, "Z"), fill: c, stroke: dk, "stroke-width": 4 }),
      el("path", { d: d("M", 55, -120, "L", 30, -70, "L", 72, -72, "Z"), fill: c, stroke: dk, "stroke-width": 4 }),
      circleEyes(-24, -78, 24, 78), el("path", { d: "M-10 -52 L10 -52 L0 -42 Z", fill: "#FF7CA3" })); };
  O.anjing = (ctx) => { const [c, dk] = col(ctx, ["#C98A5A", "#9C6433"]);
    return grp({ transform: bob(ctx.gt, 6, 2.1) },
      el("ellipse", { cx: 0, cy: 44, rx: 104, ry: 78, fill: c, stroke: dk, "stroke-width": 6 }),
      el("circle", { cx: 0, cy: -64, r: 72, fill: c, stroke: dk, "stroke-width": 6 }),
      el("ellipse", { cx: -78, cy: -58, rx: 26, ry: 50, fill: dk }),
      el("ellipse", { cx: 78, cy: -58, rx: 26, ry: 50, fill: dk }),
      el("ellipse", { cx: 0, cy: -40, rx: 40, ry: 32, fill: "#F0D2AC" }),
      el("circle", { cx: 0, cy: -54, r: 14, fill: P.ink }),
      circleEyes(-26, -84, 26, 84)); };
  O.sapi = (ctx) => { const [c, dk] = col(ctx, ["#FFFFFF", "#D8DCE4"]);
    return grp({ transform: bob(ctx.gt, 5, 1.7) },
      el("ellipse", { cx: 0, cy: 50, rx: 110, ry: 80, fill: c, stroke: dk, "stroke-width": 6 }),
      el("ellipse", { cx: -40, cy: 40, rx: 30, ry: 26, fill: P.ink }),
      el("ellipse", { cx: 50, cy: 70, rx: 24, ry: 20, fill: P.ink }),
      el("circle", { cx: 0, cy: -56, r: 70, fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: "M-66 -108 Q-96 -120 -86 -90", stroke: dk, "stroke-width": 14, fill: "none", "stroke-linecap": "round" }),
      el("path", { d: "M66 -108 Q96 -120 86 -90", stroke: dk, "stroke-width": 14, fill: "none", "stroke-linecap": "round" }),
      el("ellipse", { cx: 0, cy: -34, rx: 44, ry: 30, fill: "#FF9EC2" }),
      circleEyes(-26, -74, 26, 74)); };
  O.ayam = (ctx) => { const [c, dk] = col(ctx, ["#FFFFFF", "#E0C84A"]);
    return grp({ transform: bob(ctx.gt, 7, 2.4) },
      el("ellipse", { cx: 0, cy: 30, rx: 80, ry: 90, fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: "M-20 -70 Q0 -110 20 -70 Q40 -104 44 -64", fill: "#FF5252" }),
      el("circle", { cx: 0, cy: -50, r: 50, fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: "M40 -46 L86 -36 L40 -22 Z", fill: "#FF9F43" }),
      circleEyes(-16, -58, 16, 58, 12)); };
  O.bebek = (ctx) => { const [c, dk] = col(ctx, ["#FFD43B", "#E5A800"]);
    return grp({ transform: bob(ctx.gt, 6, 2.2) },
      el("ellipse", { cx: 0, cy: 36, rx: 96, ry: 72, fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: "M80 20 Q150 10 120 70", fill: c, stroke: dk, "stroke-width": 5 }),
      el("circle", { cx: -40, cy: -46, r: 54, fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: "M-96 -46 L-40 -34 L-96 -22 Z", fill: "#FF9F43" }),
      circleEyes(-54, -58, -30, -58, 12)); };
  O.kambing = (ctx) => { const [c, dk] = col(ctx, ["#EFE7D8", "#C9BBA0"]);
    return grp({ transform: bob(ctx.gt, 5, 1.9) },
      el("ellipse", { cx: 0, cy: 44, rx: 100, ry: 76, fill: c, stroke: dk, "stroke-width": 6 }),
      el("circle", { cx: 0, cy: -56, r: 64, fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: "M-50 -104 Q-80 -150 -40 -140", stroke: dk, "stroke-width": 14, fill: "none", "stroke-linecap": "round" }),
      el("path", { d: "M50 -104 Q80 -150 40 -140", stroke: dk, "stroke-width": 14, fill: "none", "stroke-linecap": "round" }),
      el("path", { d: "M-16 0 Q0 24 16 0", stroke: dk, "stroke-width": 10, fill: "none" }),
      circleEyes(-24, -64, 24, 64)); };
  O.kuda = (ctx) => { const [c, dk] = col(ctx, ["#B5794F", "#8C5833"]);
    return grp({ transform: bob(ctx.gt, 5, 1.8) },
      el("ellipse", { cx: 0, cy: 50, rx: 112, ry: 72, fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: "M40 -10 Q110 -40 120 40", stroke: dk, "stroke-width": 20, fill: "none" }),
      el("ellipse", { cx: 70, cy: -70, rx: 44, ry: 60, fill: c, stroke: dk, "stroke-width": 6, transform: "rotate(18 70 -70)" }),
      el("path", { d: "M40 -120 L52 -70 M90 -120 L80 -70", stroke: dk, "stroke-width": 12, "stroke-linecap": "round" }),
      circleEyes(60, -84, 86, -78, 12)); };
  O.burung = (ctx) => { const [c, dk] = col(ctx, ["#3FA9F5", "#1F7CC4"]);
    const flap = Math.sin((ctx.gt || 0) * 8) * 20;
    return grp({ transform: bob(ctx.gt, 10, 2) },
      el("ellipse", { cx: 0, cy: 10, rx: 70, ry: 60, fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: d("M", -10, 0, "Q", -90, -20 - flap, -70, 30), fill: dk }),
      el("path", { d: d("M", 10, 0, "Q", 90, -20 - flap, 70, 30), fill: dk }),
      el("path", { d: "M60 -6 L104 2 L60 16 Z", fill: "#FF9F43" }),
      circleEyes(24, -14, 24, -14, 12)); };
  O.ikan = (ctx) => { const [c, dk] = col(ctx, ["#FF9F43", "#E07A14"]);
    return grp({ transform: bob(ctx.gt, 8, 2.2) },
      el("ellipse", { cx: 0, cy: 0, rx: 100, ry: 68, fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: "M80 0 L160 -50 L160 50 Z", fill: c, stroke: dk, "stroke-width": 5 }),
      el("path", { d: "M-10 -60 L-40 -100 L20 -66 Z", fill: dk }),
      el("circle", { cx: -40, cy: -8, r: 16, fill: "#FFFFFF", stroke: P.ink, "stroke-width": 3 }),
      el("circle", { cx: -44, cy: -8, r: 7, fill: P.ink })); };
  O.katak = (ctx) => { const [c, dk] = col(ctx, ["#5CCB5F", "#3B9C3F"]);
    return grp({ transform: bob(ctx.gt, 7, 2.5) },
      el("ellipse", { cx: 0, cy: 30, rx: 110, ry: 78, fill: c, stroke: dk, "stroke-width": 6 }),
      el("ellipse", { cx: -90, cy: 70, rx: 40, ry: 20, fill: dk }),
      el("ellipse", { cx: 90, cy: 70, rx: 40, ry: 20, fill: dk }),
      el("circle", { cx: -44, cy: -56, r: 40, fill: c, stroke: dk, "stroke-width": 6 }),
      el("circle", { cx: 44, cy: -56, r: 40, fill: c, stroke: dk, "stroke-width": 6 }),
      el("circle", { cx: -44, cy: -56, r: 18, fill: "#FFFFFF", stroke: P.ink, "stroke-width": 3 }),
      el("circle", { cx: 44, cy: -56, r: 18, fill: "#FFFFFF", stroke: P.ink, "stroke-width": 3 }),
      el("circle", { cx: -44, cy: -52, r: 8, fill: P.ink }), el("circle", { cx: 44, cy: -52, r: 8, fill: P.ink }),
      el("path", { d: "M-40 20 Q0 50 40 20", stroke: P.ink, "stroke-width": 6, fill: "none", "stroke-linecap": "round" })); };

  function circleEyes(x1, y1, x2, y2, r) {
    r = r || 16;
    return el("circle", { cx: x1, cy: y1, r, fill: "#FFFFFF", stroke: P.ink, "stroke-width": 3 }) +
      el("circle", { cx: x2, cy: y2, r, fill: "#FFFFFF", stroke: P.ink, "stroke-width": 3 }) +
      el("circle", { cx: x1, cy: y1 + 3, r: r * 0.5, fill: P.ink }) +
      el("circle", { cx: x2, cy: y2 + 3, r: r * 0.5, fill: P.ink });
  }

  // ---- buah ----
  O.apel = (ctx) => { const [c, dk] = col(ctx, A.COLORS.merah);
    return grp({ transform: bob(ctx.gt, 6, 2) },
      el("path", { d: "M0 -70 Q20 -110 50 -96", stroke: "#7a4", "stroke-width": 10, fill: "none", "stroke-linecap": "round" }),
      el("ellipse", { cx: 30, cy: -80, rx: 36, ry: 20, fill: "#5CCB5F", transform: "rotate(-30 30 -80)" }),
      el("path", { d: "M0 -60 Q-96 -60 -96 20 Q-96 110 0 110 Q96 110 96 20 Q96 -60 0 -60 Z", fill: c, stroke: dk, "stroke-width": 6 }),
      el("ellipse", { cx: -34, cy: -6, rx: 20, ry: 30, fill: "#FFFFFF", opacity: 0.4 })); };
  O.pisang = (ctx) => { const [c, dk] = col(ctx, A.COLORS.kuning);
    return grp({ transform: bob(ctx.gt, 6, 2) },
      el("path", { d: "M-90 -70 Q-110 60 20 100 Q130 100 110 40 Q60 80 -30 40 Q-70 10 -58 -66 Z", fill: c, stroke: dk, "stroke-width": 6 }),
      el("rect", { x: -70, y: -86, width: 24, height: 30, rx: 8, fill: "#7a5" })); };
  O.jeruk = (ctx) => { const [c, dk] = col(ctx, A.COLORS.oranye);
    return grp({ transform: bob(ctx.gt, 6, 2) }, circle(96, c, dk),
      el("ellipse", { cx: -30, cy: -30, rx: 22, ry: 32, fill: "#FFFFFF", opacity: 0.35 }),
      el("ellipse", { cx: 0, cy: -92, rx: 26, ry: 14, fill: "#5CCB5F" })); };
  O.semangka = (ctx) => { const [c, dk] = col(ctx, ["#5CCB5F", "#3B9C3F"]);
    return grp({ transform: bob(ctx.gt, 6, 2) },
      el("path", { d: "M-100 0 A100 100 0 0 1 100 0 Z", fill: c, stroke: dk, "stroke-width": 6, transform: "rotate(0)" }),
      el("path", { d: "M-80 0 A80 80 0 0 1 80 0 Z", fill: "#FF6B81" }),
      [-50, 0, 50].map((x) => el("ellipse", { cx: x, cy: -30, rx: 7, ry: 12, fill: P.ink })).join("")); };
  O.anggur = (ctx) => { const [c, dk] = col(ctx, A.COLORS.ungu);
    let g = "";
    [[0, 0], [-40, 0], [40, 0], [-20, 44], [20, 44], [0, 88], [-60, 44], [60, 44]].forEach(([x, y]) =>
      { g += el("circle", { cx: x, cy: y, r: 30, fill: c, stroke: dk, "stroke-width": 4 }); });
    return grp({ transform: bob(ctx.gt, 6, 2) }, g, el("path", { d: "M0 -30 Q10 -70 40 -70", stroke: "#7a5", "stroke-width": 8, fill: "none" })); };
  O.stroberi = (ctx) => { const [c, dk] = col(ctx, A.COLORS.merah);
    return grp({ transform: bob(ctx.gt, 6, 2) },
      el("path", { d: "M0 110 Q-90 40 -74 -40 Q-40 -40 0 -58 Q40 -40 74 -40 Q90 40 0 110 Z", fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: "M-60 -50 L0 -90 L60 -50 L20 -60 L0 -30 L-20 -60 Z", fill: "#5CCB5F" }),
      [[-30, 0], [20, 10], [-10, 40], [40, 40]].map(([x, y]) => el("circle", { cx: x, cy: y, r: 5, fill: "#FFF3A3" })).join("")); };

  // ---- bentuk ----
  O.lingkaran = (ctx) => grp({ transform: bob(ctx.gt, 6, 2) }, circle(100, col(ctx, A.COLORS.merah)[0], col(ctx, A.COLORS.merah)[1]));
  O.segitiga = (ctx) => { const [c, dk] = col(ctx, A.COLORS.hijau);
    return grp({ transform: bob(ctx.gt, 6, 2) }, el("path", { d: "M0 -100 L100 80 L-100 80 Z", fill: c, stroke: dk, "stroke-width": 8, "stroke-linejoin": "round" })); };
  O.persegi = (ctx) => { const [c, dk] = col(ctx, A.COLORS.biru);
    return grp({ transform: bob(ctx.gt, 6, 2) }, el("rect", { x: -92, y: -92, width: 184, height: 184, rx: 18, fill: c, stroke: dk, "stroke-width": 8 })); };
  O.bintang = (ctx) => { const [c, dk] = col(ctx, A.COLORS.kuning);
    let p = "";
    for (let i = 0; i < 10; i++) { const a = (Math.PI / 5) * i - Math.PI / 2; const r = i % 2 ? 44 : 104;
      p += (i ? "L" : "M") + " " + u.num(Math.cos(a) * r) + " " + u.num(Math.sin(a) * r) + " "; }
    return grp({ transform: tf(0, Math.sin((ctx.gt || 0) * 2) * 6, Math.sin((ctx.gt || 0) * 1.5) * 6) },
      el("path", { d: p + "Z", fill: c, stroke: dk, "stroke-width": 8, "stroke-linejoin": "round" })); };
  O.hati = (ctx) => { const [c, dk] = col(ctx, A.COLORS.merah_muda);
    return grp({ transform: tf(0, Math.sin((ctx.gt || 0) * 2) * 6, 0, 1 + Math.sin((ctx.gt || 0) * 4) * 0.04) },
      el("path", { d: "M0 90 C-120 0 -70 -100 0 -40 C70 -100 120 0 0 90 Z", fill: c, stroke: dk, "stroke-width": 8, "stroke-linejoin": "round" })); };

  // ---- benda ----
  O.bola = (ctx) => { const [c, dk] = col(ctx, A.COLORS.merah);
    return grp({ transform: bob(ctx.gt, 10, 2.4) }, circle(96, c, dk),
      el("path", { d: "M-96 0 Q0 -40 96 0 M-96 0 Q0 40 96 0 M0 -96 L0 96", stroke: dk, "stroke-width": 5, fill: "none" })); };
  O.mobil = (ctx) => { const [c, dk] = col(ctx, A.COLORS.biru);
    return grp({ transform: bob(ctx.gt, 5, 2) },
      el("rect", { x: -110, y: -10, width: 220, height: 70, rx: 24, fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: "M-70 -10 Q-40 -70 40 -70 L70 -10 Z", fill: c, stroke: dk, "stroke-width": 6 }),
      el("rect", { x: -40, y: -58, width: 70, height: 44, rx: 8, fill: "#DDF4FF" }),
      el("circle", { cx: -60, cy: 64, r: 34, fill: P.ink }), el("circle", { cx: 60, cy: 64, r: 34, fill: P.ink }),
      el("circle", { cx: -60, cy: 64, r: 14, fill: "#CCC" }), el("circle", { cx: 60, cy: 64, r: 14, fill: "#CCC" })); };
  O.balon = (ctx) => { const [c, dk] = col(ctx, A.COLORS.merah);
    return grp({ transform: tf(0, Math.sin((ctx.gt || 0) * 1.5) * 14, Math.sin((ctx.gt || 0) * 1.2) * 4) },
      el("path", { d: "M0 90 Q-80 90 -80 -10 Q-80 -90 0 -90 Q80 -90 80 -10 Q80 90 0 90 Z", fill: c, stroke: dk, "stroke-width": 5 }),
      el("path", { d: "M0 90 L10 110 L-10 110 Z", fill: dk }),
      el("path", { d: "M0 110 Q20 160 -10 210", stroke: "#aaa", "stroke-width": 3, fill: "none" }),
      el("ellipse", { cx: -30, cy: -30, rx: 16, ry: 26, fill: "#FFFFFF", opacity: 0.4 })); };
  O.bunga = (ctx) => { const [c, dk] = col(ctx, A.COLORS.merah_muda);
    return grp({ transform: bob(ctx.gt, 6, 1.6) },
      [0, 60, 120, 180, 240, 300].map((a) => el("ellipse", { cx: 0, cy: -56, rx: 28, ry: 46, fill: c, stroke: dk, "stroke-width": 4, transform: "rotate(" + a + ")" })).join(""),
      circle(36, P.sun, P.sunRay)); };
  O.matahari = (ctx) => grp({ transform: tf(0, 0, (ctx.gt || 0) * 20) }, A.backgrounds ? "" : "",
    (function () { let r = ""; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2;
      r += el("line", { x1: Math.cos(a) * 90, y1: Math.sin(a) * 90, x2: Math.cos(a) * 130, y2: Math.sin(a) * 130, stroke: P.sunRay, "stroke-width": 14, "stroke-linecap": "round" }); }
      return r + el("circle", { r: 80, fill: P.sun, stroke: P.sunRay, "stroke-width": 6 }) +
        el("circle", { cx: -24, cy: -10, r: 8, fill: P.ink }) + el("circle", { cx: 24, cy: -10, r: 8, fill: P.ink }) +
        el("path", { d: "M-24 24 Q0 44 24 24", stroke: P.ink, "stroke-width": 6, fill: "none", "stroke-linecap": "round" }); })());
  O.bulan = (ctx) => { const [c] = col(ctx, A.COLORS.kuning);
    return grp({ transform: bob(ctx.gt, 6, 1.4) }, el("path", { d: "M60 -90 A100 100 0 1 0 60 90 A80 80 0 1 1 60 -90 Z", fill: c, stroke: "#E5A800", "stroke-width": 6 })); };
  O.payung = (ctx) => { const [c, dk] = col(ctx, A.COLORS.merah);
    return grp({ transform: bob(ctx.gt, 6, 1.6) },
      el("path", { d: "M-110 0 A110 110 0 0 1 110 0 Z", fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: "M-110 0 Q-74 24 -37 0 Q0 24 37 0 Q74 24 110 0", fill: "none", stroke: dk, "stroke-width": 5 }),
      el("path", { d: "M0 0 L0 120 Q0 150 30 150", stroke: dk, "stroke-width": 10, fill: "none" })); };
  O.topi = (ctx) => { const [c, dk] = col(ctx, A.COLORS.biru);
    return grp({ transform: bob(ctx.gt, 5, 1.8) },
      el("ellipse", { cx: 0, cy: 60, rx: 130, ry: 30, fill: c, stroke: dk, "stroke-width": 6 }),
      el("path", { d: "M-80 60 Q-70 -80 0 -80 Q70 -80 80 60 Z", fill: c, stroke: dk, "stroke-width": 6 }),
      el("circle", { cx: 0, cy: -80, r: 18, fill: P.sun })); };

  // objek default jika entah bagaimana tidak ada (tidak terjadi karena validasi)
  O._fallback = (ctx) => circle(90, "#CCC", "#999");
})(self.AIAnim);
