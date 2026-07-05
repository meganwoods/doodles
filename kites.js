/*!
 * kites.js — little doodle people flying kites along the edges of things.
 * Companion renderer to flowers.js and cranes.js.
 *
 *   const sky = Kites.fly('#park', { count: 3 });
 *   sky.relaunch();   // new flyers, new kites
 *   sky.destroy();    // remove
 *
 * Each unit is a stick figure holding a sagging line up to a kite —
 * diamond, delta, box or bird — in bright two-tone colours with a wavy
 * bowed tail. Launching animates the figure appearing, the line paying
 * out with the kite riding it into the sky, then the tail streaming.
 * With `idle: true` (the default) kites keep gently bobbing afterwards.
 * Placement is packed like cranes.js: `count` is a request, and units
 * are spaced so kites never overlap or clutter.
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.Kites = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var TAU = Math.PI * 2;

  /* ---------------- seeded randomness ---------------- */

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

  /* ---------------- palette & helpers ---------------- */

  var KITE_COLORS = ['#e0484f', '#f2913d', '#f4c93f', '#4fae6c', '#3f8fd2', '#7a5fd3', '#e26fae', '#45b8b0'];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function phase(t, t0, t1) { return clamp01((t - t0) / (t1 - t0)); }

  function mkStroke(pts, w, color, t0, t1) {
    var cum = [0];
    var total = 0;
    for (var i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      cum.push(total);
    }
    return { pts: pts, cum: cum, total: total, w: w, color: color, t0: t0, t1: t1 };
  }

  function drawStroke(ctx, s, t) {
    var target = s.total * easeOutCubic(t);
    if (target <= 0.05) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s.pts[0].x, s.pts[0].y);
    for (var i = 1; i < s.pts.length; i++) {
      var a = s.pts[i - 1], b = s.pts[i];
      if (s.cum[i] > target) {
        var u = (target - s.cum[i - 1]) / (s.cum[i] - s.cum[i - 1]);
        ctx.lineTo(lerp(a.x, b.x, u), lerp(a.y, b.y, u));
        break;
      }
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  // fraction of an ad-hoc polyline, for lines recomputed every frame
  function tracePartial(ctx, pts, frac) {
    if (frac <= 0) return null;
    var total = 0, i;
    for (i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    var target = total * Math.min(1, frac);
    var acc = 0, end = pts[pts.length - 1];
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (i = 1; i < pts.length; i++) {
      var seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (acc + seg >= target) {
        var u = (target - acc) / seg;
        end = { x: lerp(pts[i - 1].x, pts[i].x, u), y: lerp(pts[i - 1].y, pts[i].y, u) };
        ctx.lineTo(end.x, end.y);
        break;
      }
      ctx.lineTo(pts[i].x, pts[i].y);
      acc += seg;
    }
    ctx.stroke();
    return end;
  }

  function circlePts(cx, cy, r) {
    var pts = [];
    for (var i = 0; i <= 10; i++) {
      var a = (i / 10) * TAU;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  // quadratic bezier flattened to a polyline: the kite line with sag
  function linePts(hand, kite, wind) {
    var d = Math.hypot(kite.x - hand.x, kite.y - hand.y);
    var cx = (hand.x + kite.x) / 2 + wind * d * 0.05;
    var cy = (hand.y + kite.y) / 2 + d * 0.16;      // sag toward the ground
    var pts = [];
    for (var i = 0; i <= 16; i++) {
      var t = i / 16, u = 1 - t;
      pts.push({
        x: u * u * hand.x + 2 * u * t * cx + t * t * kite.x,
        y: u * u * hand.y + 2 * u * t * cy + t * t * kite.y
      });
    }
    return pts;
  }

  /* ---------------- unit generation ----------------
     Local frame: figure's feet at (0,0), up is -y, wind blows toward
     `wind` (+1 right / -1 left); the kite flies downwind and up. */

  function buildUnit(R, o, wind) {
    var ink = o.ink;
    var strokes = [];
    var P = R(13, 20) * o.scale;                    // figure height
    var lw = Math.max(1.1, P * 0.085);
    var PT1 = 0.14;                                 // figure finishes drawing here

    // stick figure, leaning back a touch against the pull
    var lean = -wind * P * 0.07;
    var hipY = -P * 0.42, neckY = -P * 0.72;
    var stride = R.chance(0.4) ? P * 0.24 : P * 0.13;
    strokes.push(mkStroke([{ x: 0, y: hipY }, { x: -stride, y: 0 }], lw, ink, 0, PT1));
    strokes.push(mkStroke([{ x: 0, y: hipY }, { x: stride * R(0.7, 1.2), y: 0 }], lw, ink, 0, PT1));
    strokes.push(mkStroke([{ x: 0, y: hipY }, { x: lean, y: neckY }], lw, ink, 0.02, PT1));
    strokes.push(mkStroke(circlePts(lean * 1.15, -P * 0.84, P * 0.16), lw * 0.9, ink, 0.04, PT1 + 0.02));
    var hand = { x: wind * P * 0.32, y: -P * 0.58 };
    strokes.push(mkStroke([{ x: lean * 0.8, y: neckY + P * 0.04 }, hand], lw * 0.85, ink, 0.05, PT1 + 0.02));
    if (R.chance(0.65)) {
      strokes.push(mkStroke([
        { x: lean * 0.8, y: neckY + P * 0.08 },
        { x: hand.x * 0.85, y: hand.y + P * 0.06 }
      ], lw * 0.85, ink, 0.05, PT1 + 0.02));
    } else {
      strokes.push(mkStroke([
        { x: lean * 0.8, y: neckY + P * 0.08 },
        { x: -wind * P * 0.2, y: -P * 0.35 }
      ], lw * 0.85, ink, 0.05, PT1 + 0.02));
    }
    // sometimes a small companion stands nearby, watching
    if (R.chance(0.3)) {
      var cp = P * R(0.55, 0.7);
      var cx = -wind * P * R(0.9, 1.5);
      strokes.push(mkStroke([{ x: cx, y: -cp * 0.42 }, { x: cx - cp * 0.14, y: 0 }], lw * 0.8, ink, 0.04, PT1 + 0.04));
      strokes.push(mkStroke([{ x: cx, y: -cp * 0.42 }, { x: cx + cp * 0.14, y: 0 }], lw * 0.8, ink, 0.04, PT1 + 0.04));
      strokes.push(mkStroke([{ x: cx, y: -cp * 0.42 }, { x: cx, y: -cp * 0.72 }], lw * 0.8, ink, 0.04, PT1 + 0.04));
      strokes.push(mkStroke(circlePts(cx, -cp * 0.84, cp * 0.16), lw * 0.7, ink, 0.06, PT1 + 0.06));
      strokes.push(mkStroke([                        // pointing up at the kite
        { x: cx, y: -cp * 0.6 }, { x: cx + wind * cp * 0.3, y: -cp * 0.85 }
      ], lw * 0.7, ink, 0.06, PT1 + 0.06));
    }

    // the kite
    var A = R(o.size[0], o.size[1]) * o.scale;      // altitude
    var kw = R(14, 24) * o.scale;                   // kite width
    var colA = R.pick(o.colors);
    var colB = R.pick(o.colors);
    if (colB === colA) colB = o.colors[(o.colors.indexOf(colA) + 3) % o.colors.length];
    var kite = {
      type: R.pick(['diamond', 'diamond', 'delta', 'box', 'bird']),
      w: kw, h: kw * R(1.15, 1.4),
      colA: colA, colB: colB,
      home: { x: wind * A * R(0.4, 0.75), y: -A },
      lean: wind * R(0.28, 0.48),
      bows: R.int(3, 5),
      phi1: R(0, TAU), phi2: R(0, TAU)
    };

    var tailReach = kite.h * 1.6;
    var downwind = Math.abs(kite.home.x) + kw + tailReach * 0.5 + 8;
    var upwind = Math.max(12, P * 0.8, kw * 0.5);
    var dur = R(0.55, 0.7);
    return {
      strokes: strokes, hand: hand, kite: kite, ink: ink,
      lineW: Math.max(0.8, lw * 0.45),
      left: wind > 0 ? upwind : downwind,
      right: wind > 0 ? downwind : upwind,
      delay: 0, dur: dur
    };
  }

  /* ---------------- kite drawing ---------------- */

  function drawKiteShape(ctx, k, ink) {
    var w = k.w, h = k.h;
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink;
    if (k.type === 'diamond') {
      var T = { x: 0, y: -h / 2 }, Rp = { x: w / 2, y: 0 }, B = { x: 0, y: h / 2 }, L = { x: -w / 2, y: 0 };
      ctx.beginPath();
      ctx.moveTo(T.x, T.y); ctx.lineTo(Rp.x, Rp.y); ctx.lineTo(B.x, B.y); ctx.lineTo(L.x, L.y);
      ctx.closePath();
      ctx.fillStyle = k.colA;
      ctx.fill();
      ctx.fillStyle = k.colB;                        // two opposite quarters
      ctx.beginPath();
      ctx.moveTo(T.x, T.y); ctx.lineTo(Rp.x, Rp.y); ctx.lineTo(0, 0); ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(B.x, B.y); ctx.lineTo(L.x, L.y); ctx.lineTo(0, 0); ctx.closePath();
      ctx.fill();
      ctx.beginPath();                               // outline + spars
      ctx.moveTo(T.x, T.y); ctx.lineTo(Rp.x, Rp.y); ctx.lineTo(B.x, B.y); ctx.lineTo(L.x, L.y);
      ctx.closePath();
      ctx.moveTo(T.x, T.y); ctx.lineTo(B.x, B.y);
      ctx.moveTo(L.x, L.y); ctx.lineTo(Rp.x, Rp.y);
      ctx.stroke();
    } else if (k.type === 'delta') {
      var A2 = { x: 0, y: -h * 0.55 }, R2 = { x: w * 0.55, y: h * 0.35 }, L2 = { x: -w * 0.55, y: h * 0.35 };
      ctx.beginPath();
      ctx.moveTo(A2.x, A2.y); ctx.lineTo(R2.x, R2.y); ctx.lineTo(L2.x, L2.y); ctx.closePath();
      ctx.fillStyle = k.colA;
      ctx.fill();
      ctx.fillStyle = k.colB;
      ctx.beginPath();
      ctx.moveTo(A2.x, A2.y); ctx.lineTo(R2.x, R2.y); ctx.lineTo(0, h * 0.35); ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(A2.x, A2.y); ctx.lineTo(R2.x, R2.y); ctx.lineTo(L2.x, L2.y); ctx.closePath();
      ctx.moveTo(A2.x, A2.y); ctx.lineTo(0, h * 0.35);
      ctx.stroke();
    } else if (k.type === 'box') {
      var cell = h * 0.3;
      ctx.fillStyle = k.colA;
      ctx.fillRect(-w * 0.35, -h / 2, w * 0.7, cell);
      ctx.fillStyle = k.colB;
      ctx.fillRect(-w * 0.35, h / 2 - cell, w * 0.7, cell);
      ctx.strokeRect(-w * 0.35, -h / 2, w * 0.7, cell);
      ctx.strokeRect(-w * 0.35, h / 2 - cell, w * 0.7, cell);
      ctx.beginPath();                               // struts between cells
      ctx.moveTo(-w * 0.35, -h / 2 + cell); ctx.lineTo(-w * 0.35, h / 2 - cell);
      ctx.moveTo(w * 0.35, -h / 2 + cell); ctx.lineTo(w * 0.35, h / 2 - cell);
      ctx.stroke();
    } else { // bird
      ctx.strokeStyle = k.colA;
      ctx.lineWidth = Math.max(1.6, w * 0.14);
      ctx.beginPath();
      ctx.moveTo(-w * 0.6, -h * 0.05);
      ctx.quadraticCurveTo(-w * 0.25, -h * 0.38, 0, 0);
      ctx.quadraticCurveTo(w * 0.25, -h * 0.38, w * 0.6, -h * 0.05);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.09, 0, TAU);
      ctx.fill();
    }
  }

  function drawUnit(ctx, u, lt, now, wind, idleOn) {
    var i;
    for (i = 0; i < u.strokes.length; i++) {
      var s = u.strokes[i];
      drawStroke(ctx, s, phase(lt, s.t0, s.t1));
    }
    var ft = phase(lt, 0.12, 0.72);                  // flight: line pays out, kite rides it
    if (ft <= 0) return;
    var k = u.kite;

    var bobX = 0, bobY = 0, wob = 0;
    if (idleOn && now !== undefined) {
      bobX = Math.sin(now * 0.0009 + k.phi1) * k.w * 0.22;
      bobY = Math.sin(now * 0.0014 + k.phi2) * k.w * 0.16;
      wob = Math.sin(now * 0.0012 + k.phi1) * 0.06;
    }
    var target = { x: k.home.x + bobX, y: k.home.y + bobY };
    var path = linePts(u.hand, target, wind);

    ctx.strokeStyle = u.ink;
    ctx.lineWidth = u.lineW;
    ctx.lineCap = 'round';
    var pos = tracePartial(ctx, path, easeInOut(ft));
    if (!pos) return;

    var g = 0.7 + 0.3 * ft;                          // kite grows slightly as it climbs
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(k.lean * ft + wob);
    ctx.scale(g, g);
    // tail streams out once the kite is most of the way up
    var tt = phase(lt, 0.6, 0.88);
    if (tt > 0) {
      var sx = wind * k.w * 0.2, sy = k.h * 0.3;
      var perpX = sy, perpY = -sx;
      var pl = Math.hypot(perpX, perpY);
      perpX /= pl; perpY /= pl;
      var wavePh = idleOn && now !== undefined ? now * 0.0025 : 1.2;
      var tail = [{ x: 0, y: k.h * 0.5 }];
      for (i = 1; i <= k.bows; i++) {
        var off = Math.sin(i * 1.7 + wavePh + k.phi2) * k.w * 0.14;
        tail.push({
          x: sx * i + perpX * off,
          y: k.h * 0.5 + sy * i + perpY * off
        });
      }
      ctx.strokeStyle = u.ink;
      ctx.lineWidth = u.lineW;
      tracePartial(ctx, tail, tt);
      var shown = Math.floor(tt * k.bows);
      ctx.strokeStyle = k.colB;
      ctx.lineWidth = Math.max(1.1, k.w * 0.08);
      for (i = 1; i <= shown; i++) {                 // little ribbon bows
        var b = tail[i];
        ctx.beginPath();
        ctx.moveTo(b.x - k.w * 0.09, b.y - k.w * 0.07);
        ctx.lineTo(b.x + k.w * 0.09, b.y + k.w * 0.07);
        ctx.moveTo(b.x - k.w * 0.09, b.y + k.w * 0.07);
        ctx.lineTo(b.x + k.w * 0.09, b.y - k.w * 0.07);
        ctx.stroke();
      }
    }
    drawKiteShape(ctx, k, u.ink);
    ctx.restore();
  }

  /* ---------------- the sky ---------------- */

  function KiteField(target, opts) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('Kites: target element not found');
    this.el = el;
    this.o = {};
    var defaults = KiteField.defaults;
    for (var k in defaults) this.o[k] = (opts && opts[k] !== undefined) ? opts[k] : defaults[k];
    if (this.o.reach == null) this.o.reach = Math.ceil(this.o.size[1] * this.o.scale + 70);

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
    this.trigger = trig;
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

  KiteField.defaults = {
    count: 3,              // requested flyers; fewer are placed if they'd clutter
    edges: ['top'],        // which edges people stand on
    minGap: 14,            // guaranteed clear px between unit footprints
    size: [60, 125],       // min/max kite altitude in px
    scale: 1,
    inset: 10,
    reach: null,           // canvas margin around the element (auto if null)
    colors: KITE_COLORS,
    ink: '#5a646f',        // figures, lines, tails — a mid grey visible on light & dark
    seed: null,
    duration: 3000,
    animate: true,
    autoplay: true,
    whenVisible: false,
    trigger: null,         // 'load' | 'visible' | 'hover' | 'manual'
    idle: true,            // kites keep bobbing and tails keep waving
    zIndex: 1
  };

  KiteField.prototype.refresh = function () {
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
    this.generate();
    this.draw();
  };

  KiteField.prototype.generate = function () {
    var R = makeRand(this.seed);
    var o = this.o;
    var m = o.reach;
    var w = this.el.offsetWidth, h = this.el.offsetHeight;
    var lines = {
      top:    { x0: m, y0: m, x1: m + w, y1: m, a: -Math.PI / 2 },
      bottom: { x0: m + w, y0: m + h, x1: m, y1: m + h, a: Math.PI / 2 },
      left:   { x0: m, y0: m + h, x1: m, y1: m, a: Math.PI },
      right:  { x0: m + w, y0: m, x1: m + w, y1: m + h, a: 0 }
    };
    this.wind = R.sign();                            // one wind direction per field
    this.units = [];
    this.placed = 0;

    var perEdge = {};
    var i;
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
      var theta = e.a + Math.PI / 2;
      for (i = 0; i < group.length; i++) {
        var u = group[i];
        var along = (cursor + u.left) / L;
        u.bx = lerp(e.x0, e.x1, along);
        u.by = lerp(e.y0, e.y1, along);
        u.theta = theta;
        u.delay = R() * (1 - u.dur);
        this.units.push(u);
        cursor += width(u) + o.minGap + (slack * weights[i + 1]) / sum;
      }
      this.placed += group.length;
    }
  };

  KiteField.prototype.draw = function (now) {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    var idleOn = this.o.idle && this.progress >= 1 && this.o.animate && !this._reduced();
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      var lt = clamp01((this.progress - u.delay) / u.dur);
      if (lt <= 0) continue;
      ctx.save();
      ctx.translate(u.bx, u.by);
      ctx.rotate(u.theta);
      drawUnit(ctx, u, lt, now, this.wind, idleOn);
      ctx.restore();
    }
  };

  KiteField.prototype._reduced = function () {
    return typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  KiteField.prototype._idleLoop = function () {
    var self = this;
    var tick = function (now) {
      self.draw(now);
      self.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };

  KiteField.prototype.animateTo = function (target, ms) {
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

  KiteField.prototype.play = function () {
    this.progress = 0;
    return this.animateTo(1, this.o.duration);
  };

  KiteField.prototype.launch = function () {
    return this.animateTo(1, this.o.duration * (1 - this.progress));
  };

  KiteField.prototype.land = function () {
    return this.animateTo(0, this.o.duration * 0.5 * this.progress);
  };

  KiteField.prototype.finish = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.progress = 1;
    this.draw();
    if (this.o.idle && this.o.animate && !this._reduced()) this._idleLoop();
    return this;
  };

  KiteField.prototype.relaunch = function (seed) {
    this.seed = seed == null ? Math.floor(Math.random() * 1e9) : seed;
    this.generate();
    return this.play();
  };

  KiteField.prototype.clear = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.progress = 0;
    this.ctx.clearRect(0, 0, this.w, this.h);
    return this;
  };

  KiteField.prototype.destroy = function () {
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

  // regrow alias, for symmetry with flowers.js
  KiteField.prototype.regrow = KiteField.prototype.relaunch;

  return {
    fly: function (target, opts) { return new KiteField(target, opts); },
    Field: KiteField,
    palettes: { kites: KITE_COLORS }
  };
});
