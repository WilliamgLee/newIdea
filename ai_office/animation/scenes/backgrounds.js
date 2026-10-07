/* AI Office - latar belakang (6). Masing-masing: function(gt) -> SVG. Cerah & deterministik. */
(function (A) {
  "use strict";
  const u = A.u;
  const { el, grp, wrap, tf, d } = u;
  const P = A.PAL;
  const W = A.W; const H = A.H;

  function vgrad(id, c1, c2) {
    return wrap("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 },
      el("stop", { offset: 0, "stop-color": c1 }) + el("stop", { offset: 1, "stop-color": c2 }));
  }
  const rect = (fill, y, h) => el("rect", { x: 0, y: y || 0, width: W, height: h || H, fill });

  function cloud(x, y, s, drift) {
    const cx = ((x + drift) % (W + 400)) - 200;
    return grp({ transform: tf(cx, y, 0, s), opacity: 0.95 },
      el("ellipse", { cx: 0, cy: 0, rx: 120, ry: 70, fill: "#FFFFFF" }),
      el("ellipse", { cx: 90, cy: 20, rx: 90, ry: 55, fill: "#FFFFFF" }),
      el("ellipse", { cx: -90, cy: 20, rx: 90, ry: 55, fill: "#FFFFFF" }),
      el("rect", { x: -170, y: 10, width: 340, height: 60, rx: 30, fill: "#FFFFFF" }));
  }
  function sun(x, y, gt) {
    let rays = "";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + gt * 0.25;
      rays += el("line", {
        x1: x + Math.cos(a) * 95, y1: y + Math.sin(a) * 95,
        x2: x + Math.cos(a) * 140, y2: y + Math.sin(a) * 140,
        stroke: P.sunRay, "stroke-width": 14, "stroke-linecap": "round",
      });
    }
    return rays + el("circle", { cx: x, cy: y, r: 80, fill: P.sun, stroke: P.sunRay, "stroke-width": 6 });
  }
  function hill(cy, color) {
    return el("path", { d: d("M", 0, cy, "Q", W / 2, cy - 220, W, cy, "L", W, H, "L", 0, H, "Z"), fill: color });
  }

  A.backgrounds.sky = function (gt) {
    return rect("url(#bgSky)") + wrap("defs", {}, vgrad("bgSky", P.sky1, P.sky2)) +
      sun(240, 300, gt) + cloud(200, 430, 1.1, gt * 18) + cloud(760, 620, 0.8, gt * 12 + 300) +
      cloud(500, 300, 0.6, gt * 9 + 600);
  };

  A.backgrounds.garden = function (gt) {
    let flowers = "";
    for (let i = 0; i < 7; i++) {
      const x = 90 + i * 150; const y = A.GROUND_Y + 120 + (i % 2) * 120;
      const sway = Math.sin(gt * 1.5 + i) * 6;
      const petal = A.CONFETTI[i % A.CONFETTI.length];
      flowers += grp({ transform: tf(x + sway, y) },
        el("rect", { x: -5, y: 0, width: 10, height: 110, fill: P.grass3 }),
        [0, 72, 144, 216, 288].map((a) => el("ellipse", {
          cx: 0, cy: -34, rx: 20, ry: 30, fill: petal, transform: "rotate(" + a + ")",
        })).join(""),
        el("circle", { r: 18, fill: P.sun }));
    }
    return rect("url(#bgGarden)") + wrap("defs", {}, vgrad("bgGarden", P.sky1, P.sky2)) +
      sun(850, 260, gt) + cloud(260, 360, 0.9, gt * 14) +
      hill(A.GROUND_Y + 40, P.hill) + rect(P.grass, A.GROUND_Y + 120, H) + flowers;
  };

  A.backgrounds.room = function (gt) {
    let dots = "";
    for (let i = 0; i < 24; i++) {
      dots += el("circle", { cx: (i % 6) * 190 + 90, cy: Math.floor(i / 6) * 190 + 120, r: 14, fill: "#FFFFFF", opacity: 0.5 });
    }
    const toys = grp({ transform: tf(120, A.GROUND_Y + 150) },
      el("rect", { x: 0, y: 0, width: 90, height: 90, rx: 14, fill: P.sun }),
      el("rect", { x: 70, y: -30, width: 90, height: 120, rx: 14, fill: "#FF8FC7" }),
      el("circle", { cx: 230, cy: 60, r: 46, fill: "#3FA9F5" }));
    return rect("url(#bgRoom)") + wrap("defs", {}, vgrad("bgRoom", "#FFE1F0", "#FFF3E0")) +
      dots + rect(P.wood, A.GROUND_Y + 150, H) +
      el("rect", { x: 0, y: A.GROUND_Y + 150, width: W, height: 20, fill: P.wood2 }) + toys;
  };

  A.backgrounds.farm = function (gt) {
    const fence = (() => {
      let s = "";
      for (let x = -20; x < W + 60; x += 150) {
        s += el("rect", { x, y: A.GROUND_Y + 60, width: 26, height: 150, rx: 6, fill: P.wood });
      }
      s += el("rect", { x: 0, y: A.GROUND_Y + 100, width: W, height: 22, fill: P.wood2 });
      s += el("rect", { x: 0, y: A.GROUND_Y + 150, width: W, height: 22, fill: P.wood2 });
      return s;
    })();
    const barn = grp({ transform: tf(W - 300, A.GROUND_Y - 180) },
      el("rect", { x: 0, y: 60, width: 260, height: 200, fill: "#E86B5A" }),
      el("path", { d: d("M", -20, 60, "L", 130, -30, "L", 280, 60, "Z"), fill: "#C94C3C" }),
      el("rect", { x: 95, y: 150, width: 70, height: 110, fill: P.wood2 }));
    return rect("url(#bgFarm)") + wrap("defs", {}, vgrad("bgFarm", P.sky1, P.sky2)) +
      sun(850, 240, gt) + cloud(240, 360, 0.9, gt * 14) +
      hill(A.GROUND_Y, P.grass2) + rect(P.grass, A.GROUND_Y + 80, H) + barn + fence;
  };

  A.backgrounds.beach = function (gt) {
    let waves = "";
    for (let k = 0; k < 3; k++) {
      const y = A.GROUND_Y - 120 + k * 46;
      const off = Math.sin(gt * 1.5 + k) * 30;
      waves += el("path", {
        d: d("M", 0, y, "Q", 270, y - 26 + off, 540, y, "T", W, y, "L", W, y + 60, "L", 0, y + 60, "Z"),
        fill: k % 2 ? P.sea2 : P.sea, opacity: 0.9,
      });
    }
    return rect("url(#bgBeach)") + wrap("defs", {}, vgrad("bgBeach", P.sky1, "#BFF0FF")) +
      sun(240, 280, gt) + rect(P.sea, A.GROUND_Y - 120, 300) + waves +
      el("path", { d: d("M", 0, A.GROUND_Y + 30, "Q", W / 2, A.GROUND_Y - 30, W, A.GROUND_Y + 30, "L", W, H, "L", 0, H, "Z"), fill: P.sand }) +
      el("ellipse", { cx: 200, cy: H - 160, rx: 60, ry: 24, fill: P.sand2 });
  };

  A.backgrounds.classroom = function (gt) {
    const board = grp({ transform: tf(W / 2, 420) },
      el("rect", { x: -420, y: -200, width: 840, height: 400, rx: 20, fill: P.board, stroke: P.wood2, "stroke-width": 24 }),
      el("path", { d: d("M", -300, 120, "Q", -150, 80, 0, 120), stroke: "#FFFFFF", "stroke-width": 6, fill: "none", opacity: 0.6 }),
      el("circle", { cx: 180, cy: -40, r: 50, fill: "none", stroke: "#FFF3A3", "stroke-width": 6, opacity: 0.7 }));
    return rect("url(#bgClass)") + wrap("defs", {}, vgrad("bgClass", P.mint, "#FFF6E0")) +
      board + rect(P.wood, A.GROUND_Y + 150, H) +
      el("rect", { x: 0, y: A.GROUND_Y + 150, width: W, height: 18, fill: P.wood2 });
  };
})(self.AIAnim);
