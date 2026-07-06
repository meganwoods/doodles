/*!
 * kites3d.js — the kites.js flyers, aloft in three dimensions.
 * Box kites are real 3D boxes, diamonds fold along their spine with a
 * dihedral, lines sag through space, and kites drift on a 3D breeze.
 * Hand-rolled perspective + painter's sort on a 2D canvas. Zero deps.
 *
 *   const sky = Kites3D.fly('#park', { count: 2 });
 *   sky.relaunch();
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.Kites3D = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var TAU = Math.PI * 2;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRand(seed) {
    var f = mulberry32(seed);
    var R = function (min, max) {
      if (min === undefined) return f();
      return min + (max - min) * f();
    };
    R.pick = function (arr) { return arr[Math.floor(f() * arr.length) % arr.length]; };
    R.sign = function () { return f() < 0.5 ? -1 : 1; };
    R.chance = function (p) { return f() < p; };
    R.int = function (min, max) { return Math.floor(R(min, max + 1)); };
    return R;
  }

  var KITE_COLORS = ['#e0484f', '#f2913d', '#f4c93f', '#4fae6c', '#3f8fd2', '#7a5fd3', '#e26fae', '#45b8b0'];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function phase(t, t0, t1) { return clamp01((t - t0) / (t1 - t0)); }
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var c = function (v) { return Math.max(0, Math.min(255, Math.round(v * f))); };
    return 'rgb(' + c(n >> 16) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
  }

  /* ---- tiny 3d ---- */

  function makeView(yaw, tilt, f) {
    return { cy: Math.cos(yaw), sy: Math.sin(yaw), ct: Math.cos(tilt), st: Math.sin(tilt), f: f };
  }
  function proj(v, p) {
    var x = p.x * v.cy + p.z * v.sy;
    var z1 = -p.x * v.sy + p.z * v.cy;
    var y1 = p.y * v.ct - z1 * v.st;
    var z2 = p.y * v.st + z1 * v.ct;
    var k = v.f / (v.f - z2);
    return { x: x * k, y: -y1 * k, k: k, z: z2 };
  }
  function depthAlpha(z) { return Math.max(0.35, Math.min(1, 0.75 + z * 0.006)); }
  function rotYP(p, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
  }
  function rotZP(p, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
  }

  /* ---------------- unit generation ----------------
     Local frame: figure's feet at origin, y up, x along the edge
     (wind blows toward wind*x), z toward the viewer. Kite geometry is
     authored in kite-local coords and oriented at draw time. */

  function buildUnit(R, o, wind) {
    var P = R(13, 20) * o.scale;
    var lw = Math.max(1.1, P * 0.085);
    var lean = -wind * P * 0.07;
    var hand = { x: wind * P * 0.32, y: P * 0.58, z: 0 };
    var figure = [
      [{ x: 0, y: P * 0.42, z: 0 }, { x: -P * 0.15, y: 0, z: -P * 0.08 }],
      [{ x: 0, y: P * 0.42, z: 0 }, { x: P * 0.15, y: 0, z: P * 0.08 }],
      [{ x: 0, y: P * 0.42, z: 0 }, { x: lean, y: P * 0.72, z: 0 }],
      [{ x: lean * 0.8, y: P * 0.68, z: 0 }, hand],
      [{ x: lean * 0.8, y: P * 0.64, z: 0 }, { x: hand.x * 0.85, y: hand.y - P * 0.06, z: 0 }]
    ];

    var A = R(o.size[0], o.size[1]) * o.scale;
    var kw = R(15, 26) * o.scale;
    var colA = R.pick(o.colors);
    var colB = R.pick(o.colors);
    if (colB === colA) colB = o.colors[(o.colors.indexOf(colA) + 3) % o.colors.length];
    var type = R.pick(['box', 'box', 'diamond', 'diamond', 'delta']);

    // kite geometry in kite-local coords: y up, x downwind, z across
    var strokes = [], polys = [];
    var h = kw * 1.25;
    function poly(pts, fill) { polys.push({ pts: pts, fill: fill, edge: shade(fill, 0.72) }); }
    var i;
    if (type === 'box') {
      var hw = kw * 0.32, cellH = h * 0.3;
      var cor = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
      for (i = 0; i < 4; i++) {
        strokes.push([{ x: cor[i][0], y: -h / 2, z: cor[i][1] }, { x: cor[i][0], y: h / 2, z: cor[i][1] }]);
      }
      for (i = 0; i < 4; i++) {
        var a = cor[i], b = cor[(i + 1) % 4];
        poly([{ x: a[0], y: h / 2 - cellH, z: a[1] }, { x: b[0], y: h / 2 - cellH, z: b[1] },
              { x: b[0], y: h / 2, z: b[1] }, { x: a[0], y: h / 2, z: a[1] }], colA);
        poly([{ x: a[0], y: -h / 2, z: a[1] }, { x: b[0], y: -h / 2, z: b[1] },
              { x: b[0], y: -h / 2 + cellH, z: b[1] }, { x: a[0], y: -h / 2 + cellH, z: a[1] }], colB);
      }
    } else if (type === 'diamond') {
      // face the viewer; wings fold away in z along the spine (dihedral)
      var T = { x: 0, y: h * 0.55, z: 0 }, B = { x: 0, y: -h * 0.55, z: 0 };
      var L = { x: -kw * 0.55, y: 0, z: -kw * 0.3 };
      var Rt = { x: kw * 0.55, y: 0, z: -kw * 0.3 };
      poly([T, L, B], colA);
      poly([T, B, Rt], colB);
      strokes.push([T, B]);
      strokes.push([L, Rt]);
    } else { // delta
      var A2 = { x: 0, y: h * 0.5, z: 0 };
      var L2 = { x: -kw * 0.6, y: -h * 0.4, z: -kw * 0.18 };
      var R2 = { x: kw * 0.6, y: -h * 0.4, z: -kw * 0.18 };
      var K = { x: 0, y: -h * 0.42, z: kw * 0.12 };
      poly([A2, L2, K], colA);
      poly([A2, K, R2], colB);
      strokes.push([A2, K]);
    }

    var dur = R(0.55, 0.7);
    return {
      figure: figure, hand: hand, lw: lw,
      kite: {
        type: type, strokes: strokes, polys: polys, w: kw, h: h, colB: colB,
        home: { x: wind * A * R(0.4, 0.7), y: A, z: R(-A * 0.25, A * 0.25) },
        bows: R.int(3, 5), phi1: R(0, TAU), phi2: R(0, TAU),
        lean: wind * R(0.3, 0.5)
      },
      left: (wind > 0 ? Math.max(14, P) : Math.abs(wind * A * 0.7) + kw * 1.6) + 6,
      right: (wind > 0 ? Math.abs(wind * A * 0.7) + kw * 1.6 : Math.max(14, P)) + 6,
      delay: 0, dur: dur
    };
  }

  /* ---------------- the sky ---------------- */

  function Field(target, opts) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('Kites3D: target element not found');
    this.el = el;
    this.o = {};
    var defaults = Field.defaults;
    for (var k in defaults) this.o[k] = (opts && opts[k] !== undefined) ? opts[k] : defaults[k];
    if (this.o.reach == null) this.o.reach = Math.ceil(this.o.size[1] * this.o.scale + 80);

    this.seed = this.o.seed == null ? Math.floor(Math.random() * 1e9) : this.o.seed;
    this.progress = 0;
    this.raf = null;

    var cs = getComputedStyle(el);
    if (cs.position === 'static') el.style.position = 'relative';
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.position = 'absolute';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = String(this.o.zIndex);
    el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    var self = this;
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(function () { self.refresh(); });
      this._ro.observe(el);
    }
    this.refresh();

    var trig = this.o.trigger ||
      (!this.o.autoplay ? 'manual' : (this.o.whenVisible ? 'visible' : 'load'));
    if (trig === 'visible' && typeof IntersectionObserver !== 'undefined') {
      this._io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) { self._io.disconnect(); self._io = null; self.play(); }
      }, { threshold: 0.15 });
      this._io.observe(el);
    } else if (trig === 'hover') {
      this._onEnter = function () { self.launch(); };
      this._onLeave = function () { self.land(); };
      el.addEventListener('pointerenter', this._onEnter);
      el.addEventListener('pointerleave', this._onLeave);
      el.addEventListener('focusin', this._onEnter);
      el.addEventListener('focusout', this._onLeave);
    } else if (trig !== 'manual') {
      this.play();
    }
  }

  Field.defaults = {
    count: 2,
    edges: ['top'],
    minGap: 14,
    size: [60, 125],
    scale: 1,
    inset: 10,
    reach: null,
    colors: KITE_COLORS,
    ink: '#5a646f',
    seed: null,
    duration: 3000,
    animate: true,
    autoplay: true,
    whenVisible: false,
    trigger: null,
    idle: true,
    yaw: 0.4,
    tilt: 0.1,
    perspective: 340,
    zIndex: 1
  };

  Field.prototype.refresh = function () {
    var m = this.o.reach;
    var w = this.el.offsetWidth + m * 2;
    var h = this.el.offsetHeight + m * 2;
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.canvas.style.left = -(m + this.el.clientLeft) + 'px';
    this.canvas.style.top = -(m + this.el.clientTop) + 'px';
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.view = makeView(this.o.yaw, this.o.tilt, this.o.perspective);
    this.generate();
    this.draw();
  };

  Field.prototype.generate = function () {
    var R = makeRand(this.seed);
    var o = this.o;
    var m = o.reach;
    var w = this.el.offsetWidth, h = this.el.offsetHeight;
    var lines = {
      top:    { x0: m, y0: m, x1: m + w, y1: m, a: 0 },
      bottom: { x0: m + w, y0: m + h, x1: m, y1: m + h, a: Math.PI },
      left:   { x0: m, y0: m + h, x1: m, y1: m, a: Math.PI / 2 },
      right:  { x0: m + w, y0: m, x1: m + w, y1: m + h, a: -Math.PI / 2 }
    };
    this.wind = R.sign();
    this.units = [];
    this.placed = 0;

    var perEdge = {}, i;
    for (i = 0; i < o.edges.length; i++) perEdge[o.edges[i]] = 0;
    for (i = 0; i < o.count; i++) perEdge[o.edges[i % o.edges.length]]++;

    for (var name in perEdge) {
      var e = lines[name];
      if (!e) continue;
      var L = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
      var usable = L - 2 * o.inset;
      var group = [];
      for (i = 0; i < perEdge[name]; i++) group.push(buildUnit(R, o, this.wind));
      var width = function (u) { return u.left + u.right; };
      var total = function () {
        var t = 0;
        for (var j = 0; j < group.length; j++) t += width(group[j]);
        return t + Math.max(0, group.length - 1) * o.minGap;
      };
      while (group.length && total() > usable) group.pop();
      if (!group.length) continue;
      var slack = usable - total();
      var weights = [], sum = 0;
      for (i = 0; i <= group.length; i++) { var q = R(0.2, 1); weights.push(q); sum += q; }
      var cursor = o.inset + (slack * weights[0]) / sum;
      for (i = 0; i < group.length; i++) {
        var u = group[i];
        var along = (cursor + u.left) / L;
        u.bx = lerp(e.x0, e.x1, along);
        u.by = lerp(e.y0, e.y1, along);
        u.rot = e.a;
        u.delay = R() * (1 - u.dur);
        this.units.push(u);
        cursor += width(u) + o.minGap + (slack * weights[i + 1]) / sum;
      }
      this.placed += group.length;
    }
  };

  Field.prototype.draw = function (now) {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    var animOn = this.o.animate && !this._reduced();
    var view = this.view;
    var i, j, q;
    for (i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      var lt = clamp01((this.progress - u.delay) / u.dur);
      if (lt <= 0) continue;
      var k = u.kite;

      // 3D breeze: kite drifts on a slow Lissajous curve
      var bob = { x: 0, y: 0, z: 0 }, wob = 0;
      if (this.o.idle && animOn && now !== undefined && lt >= 1) {
        bob.x = Math.sin(now * 0.0008 + k.phi1) * k.w * 0.25;
        bob.y = Math.sin(now * 0.0013 + k.phi2) * k.w * 0.18;
        bob.z = Math.sin(now * 0.0005 + k.phi1 * 2) * k.w * 0.5;
        wob = Math.sin(now * 0.001 + k.phi2) * 0.1;
      }
      var home = { x: k.home.x + bob.x, y: k.home.y + bob.y, z: k.home.z + bob.z };

      var ops = [];
      // figure
      for (j = 0; j < u.figure.length; j++) {
        var seg = u.figure[j];
        var pA = proj(view, seg[0]), pB = proj(view, seg[1]);
        ops.push({ z: (pA.z + pB.z) / 2, line: [pA, pB], w: u.lw, color: this.o.ink });
      }
      var headP = proj(view, { x: -this.wind * u.hand.x * 0.25, y: u.hand.y * 1.45, z: 0 });
      ops.push({ z: headP.z, head: headP, r: u.hand.y * 0.28, color: this.o.ink, w: u.lw * 0.9 });

      // line pays out along a sagging 3D curve; kite rides the end of it
      var ft = phase(lt, 0.12, 0.72);
      if (ft <= 0) { this._run(ctx, u, ops); continue; }
      var fEnd = easeInOut(ft);
      var mid = {
        x: (u.hand.x + home.x) / 2 + this.wind * 8,
        y: (u.hand.y + home.y) / 2 - Math.hypot(home.x - u.hand.x, home.y - u.hand.y) * 0.14,
        z: (u.hand.z + home.z) / 2
      };
      var lineP = [], pos = null, zs = 0;
      var NL = 14;
      for (j = 0; j <= NL; j++) {
        var t2 = (j / NL) * fEnd;
        var g1 = 1 - t2;
        var pt = {
          x: g1 * g1 * u.hand.x + 2 * g1 * t2 * mid.x + t2 * t2 * home.x,
          y: g1 * g1 * u.hand.y + 2 * g1 * t2 * mid.y + t2 * t2 * home.y,
          z: g1 * g1 * u.hand.z + 2 * g1 * t2 * mid.z + t2 * t2 * home.z
        };
        var pj = proj(view, pt);
        lineP.push(pj);
        zs += pj.z;
        if (j === NL) pos = pt;
      }
      ops.push({ z: zs / lineP.length, line: lineP, w: Math.max(0.7, u.lw * 0.45), color: this.o.ink });

      // kite at the line's end, leaning downwind, wobbling on the breeze
      var g2 = 0.7 + 0.3 * ft;
      var leanZ = -this.wind * (k.lean + wob);
      for (j = 0; j < k.polys.length; j++) {
        var pl = k.polys[j];
        var pp = [], zsum = 0;
        for (q = 0; q < pl.pts.length; q++) {
          var lp = rotZP(rotYP(pl.pts[q], wob * 2), leanZ);
          var wp = { x: pos.x + lp.x * g2, y: pos.y + lp.y * g2, z: pos.z + lp.z * g2 };
          var qq = proj(view, wp);
          pp.push(qq);
          zsum += qq.z;
        }
        var area = 0;
        for (q = 0; q < pp.length; q++) {
          var a3 = pp[q], b3 = pp[(q + 1) % pp.length];
          area += a3.x * b3.y - b3.x * a3.y;
        }
        ops.push({
          z: zsum / pp.length, poly: pp,
          fill: area < 0 ? pl.fill : shade2(pl.fill, 0.8), edge: pl.edge
        });
      }
      for (j = 0; j < k.strokes.length; j++) {
        var st = k.strokes[j];
        var pp2 = [], zsum2 = 0;
        for (q = 0; q < st.length; q++) {
          var lp2 = rotZP(rotYP(st[q], wob * 2), leanZ);
          var qq2 = proj(view, { x: pos.x + lp2.x * g2, y: pos.y + lp2.y * g2, z: pos.z + lp2.z * g2 });
          pp2.push(qq2);
          zsum2 += qq2.z;
        }
        ops.push({ z: zsum2 / pp2.length, line: pp2, w: Math.max(0.8, u.lw * 0.5), color: this.o.ink });
      }

      // wavy 3D tail with little bows
      var tt = phase(lt, 0.6, 0.88);
      if (tt > 0) {
        var wavePh = (this.o.idle && animOn && now !== undefined) ? now * 0.0025 : 1.2;
        var tail = [proj(view, { x: pos.x, y: pos.y - k.h * 0.5, z: pos.z })];
        var zt = tail[0].z;
        var bows = [];
        var nB = Math.max(1, Math.floor(tt * k.bows));
        for (j = 1; j <= k.bows; j++) {
          var off = Math.sin(j * 1.7 + wavePh + k.phi2) * k.w * 0.16;
          var tp3 = {
            x: pos.x + this.wind * k.w * 0.22 * j + off * 0.4,
            y: pos.y - k.h * 0.5 - k.h * 0.3 * j,
            z: pos.z + off
          };
          var tpj = proj(view, tp3);
          if (j <= nB) {
            tail.push(tpj);
            bows.push(tpj);
            zt += tpj.z;
          }
        }
        ops.push({ z: zt / tail.length, line: tail, w: Math.max(0.7, u.lw * 0.4), color: this.o.ink, bows: bows, bowColor: k.colB, bowR: k.w * 0.09 });
      }

      this._run(ctx, u, ops);
    }
  };

  Field.prototype._run = function (ctx, u, ops) {
    var j, q;
    ops.sort(function (a, b) { return a.z - b.z; });
    ctx.save();
    ctx.translate(u.bx, u.by);
    ctx.rotate(u.rot);
    for (j = 0; j < ops.length; j++) {
      var op = ops[j];
      ctx.globalAlpha = depthAlpha(op.z);
      if (op.head) {
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.w;
        ctx.beginPath();
        ctx.arc(op.head.x, op.head.y, op.r * op.head.k, 0, TAU);
        ctx.stroke();
      } else if (op.line) {
        ctx.strokeStyle = op.color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        var kAvg = 0;
        for (q = 0; q < op.line.length; q++) kAvg += op.line[q].k;
        kAvg /= op.line.length;
        ctx.lineWidth = op.w * kAvg;
        ctx.beginPath();
        ctx.moveTo(op.line[0].x, op.line[0].y);
        for (q = 1; q < op.line.length; q++) ctx.lineTo(op.line[q].x, op.line[q].y);
        ctx.stroke();
        if (op.bows) {
          ctx.strokeStyle = op.bowColor;
          ctx.lineWidth = Math.max(1, op.w * 2.2);
          for (q = 0; q < op.bows.length; q++) {
            var b = op.bows[q], r = op.bowR * b.k;
            ctx.beginPath();
            ctx.moveTo(b.x - r, b.y - r * 0.7);
            ctx.lineTo(b.x + r, b.y + r * 0.7);
            ctx.moveTo(b.x - r, b.y + r * 0.7);
            ctx.lineTo(b.x + r, b.y - r * 0.7);
            ctx.stroke();
          }
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(op.poly[0].x, op.poly[0].y);
        for (q = 1; q < op.poly.length; q++) ctx.lineTo(op.poly[q].x, op.poly[q].y);
        ctx.closePath();
        ctx.fillStyle = op.fill;
        ctx.fill();
        ctx.strokeStyle = op.edge;
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  function shade2(color, f) {
    if (color.charAt(0) === '#') return shade(color, f);
    var m = color.match(/\d+/g);
    if (!m) return color;
    var c = function (v) { return Math.max(0, Math.min(255, Math.round(v * f))); };
    return 'rgb(' + c(+m[0]) + ',' + c(+m[1]) + ',' + c(+m[2]) + ')';
  }

  Field.prototype._reduced = function () {
    return typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
  };
  Field.prototype._idleLoop = function () {
    var self = this;
    var tick = function (now) {
      self.draw(now);
      self.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };
  Field.prototype.animateTo = function (target, ms) {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (!this.o.animate || this._reduced() || ms <= 0) {
      this.progress = target;
      this.draw();
      return this;
    }
    var self = this;
    var from = this.progress;
    var start = performance.now();
    var tick = function (now) {
      var t = clamp01((now - start) / ms);
      self.progress = lerp(from, target, t);
      self.draw(now);
      if (t < 1) {
        self.raf = requestAnimationFrame(tick);
      } else {
        self.raf = null;
        if (target === 1 && self.o.idle) self._idleLoop();
      }
    };
    this.raf = requestAnimationFrame(tick);
    return this;
  };
  Field.prototype.play = function () { this.progress = 0; return this.animateTo(1, this.o.duration); };
  Field.prototype.launch = function () { return this.animateTo(1, this.o.duration * (1 - this.progress)); };
  Field.prototype.land = function () { return this.animateTo(0, this.o.duration * 0.5 * this.progress); };
  Field.prototype.finish = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.progress = 1;
    this.draw();
    if (this.o.idle && this.o.animate && !this._reduced()) this._idleLoop();
    return this;
  };
  Field.prototype.relaunch = function (seed) {
    this.seed = seed == null ? Math.floor(Math.random() * 1e9) : seed;
    this.generate();
    return this.play();
  };
  Field.prototype.clear = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.progress = 0;
    this.ctx.clearRect(0, 0, this.w, this.h);
    return this;
  };
  Field.prototype.destroy = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this._ro) this._ro.disconnect();
    if (this._io) this._io.disconnect();
    if (this._onEnter) {
      this.el.removeEventListener('pointerenter', this._onEnter);
      this.el.removeEventListener('pointerleave', this._onLeave);
      this.el.removeEventListener('focusin', this._onEnter);
      this.el.removeEventListener('focusout', this._onLeave);
    }
    this.canvas.remove();
  };
  Field.prototype.regrow = Field.prototype.relaunch;

  return {
    fly: function (target, opts) { return new Field(target, opts); },
    Field: Field,
    palettes: { kites: KITE_COLORS }
  };
});
