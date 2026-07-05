/*!
 * flowers.js — grow little doodle-style flowers around the edges of things.
 *
 *   const field = Flowers.grow('#card', { edges: ['top'], density: 1.2 });
 *   field.regrow();   // new random arrangement
 *   field.destroy();  // remove
 *
 * Plants are generated procedurally from a seeded RNG (curvy stems, curly
 * tendrils, leaves, and a mix of bloom shapes) and animated growing out of
 * the chosen edges on an overlay <canvas>.
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.Flowers = factory();
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

  /* ---------------- palettes & helpers ---------------- */

  var STEM_GREENS = ['#4a7c3f', '#3d6b35', '#5b8c4a', '#6b9a55', '#38623a', '#527a3e'];
  var PETALS = ['#e05780', '#f2a1c0', '#b47ce8', '#8d5fd3', '#f6c445', '#f28d52', '#fdf1e0', '#8fb8e8', '#d94f5c', '#e88fc5'];
  var CENTERS = ['#f4b942', '#e8952e', '#a56a32', '#8a4f7d'];

  // named variants: any bundle of options, merged between defaults and user opts
  var THEMES = {
    autumn: {
      petals: ['#d9662a', '#e8a32d', '#b04a2a', '#dfb843', '#93302a', '#f0dcae', '#c97b3d'],
      stems: ['#7a6a2f', '#8a6b3a', '#5c552e', '#6e4f2a', '#95793a'],
      centers: ['#5c3a1e', '#8a5a2b', '#3f2d1a']
    },
    noir: {
      petals: ['#f4f4f1', '#dcdcd6', '#c2c2bb', '#a8a8a0', '#8e8e86'],
      stems: ['#62625b', '#75756d', '#54544d', '#87877f'],
      centers: ['#151513', '#f4f4f1', '#5a5a54']
    },
    meadow: { density: 2.3, spacing: 28, size: [18, 62] }
  };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) {
    var c = 1.70158, u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  }
  function phase(t, t0, t1) { return clamp01((t - t0) / (t1 - t0)); }

  // darken (f < 1) or lighten (f > 1) a #rrggbb colour
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var c = function (v) { return Math.max(0, Math.min(255, Math.round(v * f))); };
    return 'rgb(' + c(n >> 16) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
  }

  /* ---------------- geometry ---------------- */

  // random-walk polyline: a stem that wanders around its base angle
  function growStem(R, x, y, angle, len, wobble, arc) {
    var n = Math.max(8, Math.round(len / 6));
    var step = len / n;
    var pts = [{ x: x, y: y }];
    var a = angle;
    for (var i = 0; i < n; i++) {
      a += (R() - 0.5) * wobble + arc;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      pts.push({ x: x, y: y });
    }
    return pts;
  }

  // a shoot that starts straight-ish and curls into a tightening spiral
  function tendril(R, x, y, angle, len, side) {
    var pts = [{ x: x, y: y }];
    var a = angle;
    var step = len / 9;
    var curl = lerp(0.04, 0.075, R()) * side;
    for (var i = 0; i < 40; i++) {
      a += curl;
      curl *= 1.085;
      step *= 0.95;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      pts.push({ x: x, y: y });
    }
    return pts;
  }

  function mkStroke(pts, w0, w1, color, t0, t1) {
    var cum = [0];
    var total = 0;
    for (var i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      cum.push(total);
    }
    return { pts: pts, cum: cum, total: total, w0: w0, w1: w1, color: color, t0: t0, t1: t1 };
  }

  // point + tangent angle at fraction f of a stroke's arc length
  function pointAt(stroke, f) {
    var target = stroke.total * clamp01(f);
    for (var i = 1; i < stroke.pts.length; i++) {
      if (stroke.cum[i] >= target) {
        var a = stroke.pts[i - 1], b = stroke.pts[i];
        var seg = stroke.cum[i] - stroke.cum[i - 1];
        var u = seg > 0 ? (target - stroke.cum[i - 1]) / seg : 0;
        return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), a: Math.atan2(b.y - a.y, b.x - a.x) };
      }
    }
    var p = stroke.pts[stroke.pts.length - 1], q = stroke.pts[stroke.pts.length - 2];
    return { x: p.x, y: p.y, a: Math.atan2(p.y - q.y, p.x - q.x) };
  }

  /* ---------------- plant generation ---------------- */

  var STEM_END = 0.6; // fraction of a plant's local timeline spent growing the main stem

  function makeBloom(R, x, y, angle, size, o) {
    var type = R.pick(['daisy', 'daisy', 'round', 'round', 'spark', 'spark', 'cluster', 'bud']);
    var petal = R.pick(o.petals);
    var bloom = {
      x: x, y: y, angle: angle, type: type, size: size,
      petal: petal, edge: shade(petal, 0.72), center: R.pick(o.centers),
      n: R.int(5, 8), rot: R(0, TAU), t0: STEM_END, t1: 0.95
    };
    if (type === 'cluster') {
      bloom.dots = [];
      var k = R.int(6, 10);
      for (var i = 0; i < k; i++) {
        var da = R(0, TAU), dr = R(0, size * 0.85);
        bloom.dots.push({
          x: Math.cos(da) * dr, y: Math.sin(da) * dr,
          r: size * R(0.24, 0.4), c: shade(petal, R(0.8, 1.2))
        });
      }
    }
    return bloom;
  }

  function buildPlant(R, ox, oy, edgeAngle, o) {
    var strokes = [], leaves = [], blooms = [];
    var roll = R();
    var kind = roll < 0.62 ? 'flower' : roll < 0.82 ? 'curl' : 'sprout';
    var stemColor = R.pick(o.stems);
    var leafColor = shade(stemColor, R(0.95, 1.3));

    var len = R(o.size[0], o.size[1]) * o.scale;
    if (kind === 'curl') len *= 0.85;
    if (kind === 'sprout') len *= 0.55;

    var angle = edgeAngle + R(-0.32, 0.32);
    var stemPts = growStem(R, ox, oy, angle, len, R(0.22, 0.45), R(-0.05, 0.05));
    var w0 = Math.max(1.3, Math.min(2.6, len * 0.045)) * o.scale;
    var stem;

    if (kind === 'curl') {
      // main stem flows straight into a curling tip
      var tp = stemPts[stemPts.length - 1], pv = stemPts[stemPts.length - 2];
      var tipA = Math.atan2(tp.y - pv.y, tp.x - pv.x);
      var curlPts = tendril(R, tp.x, tp.y, tipA, len * 0.55, R.sign());
      stem = mkStroke(stemPts.concat(curlPts.slice(1)), w0, w0 * 0.35, stemColor, 0, 0.88);
    } else {
      stem = mkStroke(stemPts, w0, w0 * 0.5, stemColor, 0, STEM_END);
    }
    strokes.push(stem);
    var stemOnly = mkStroke(stemPts, w0, w0, stemColor, 0, 1); // for anchor lookups

    // side shoots: curly tendrils, sometimes tipped with a little dot-bud
    var shoots = kind === 'sprout' ? (R.chance(0.5) ? 1 : 0) : R.int(0, 2);
    var side = R.sign();
    for (var i = 0; i < shoots; i++) {
      var f = R(0.3, 0.72);
      var p = pointAt(stemOnly, f);
      side = -side;
      var t0 = f * STEM_END;
      var sPts = tendril(R, p.x, p.y, p.a + side * R(0.5, 1.0), len * R(0.28, 0.45), side);
      strokes.push(mkStroke(sPts, w0 * 0.6, w0 * 0.25, stemColor, t0, Math.min(t0 + 0.34, 1)));
      if (R.chance(0.4)) {
        var tip = sPts[sPts.length - 1];
        blooms.push({
          x: tip.x, y: tip.y, type: 'dot', size: Math.max(1.6, len * 0.035),
          petal: R.pick(o.petals), edge: null, angle: 0,
          t0: Math.min(t0 + 0.3, 0.9), t1: Math.min(t0 + 0.45, 1)
        });
      }
    }

    // leaves along the stem, alternating sides
    var nLeaves = kind === 'sprout' ? 2 : R.int(1, 3);
    var lSide = R.sign();
    for (var j = 0; j < nLeaves; j++) {
      var lf = R(0.25, 0.8);
      var lp = pointAt(stemOnly, lf);
      lSide = -lSide;
      var lt0 = lf * STEM_END;
      leaves.push({
        x: lp.x, y: lp.y, angle: lp.a + lSide * R(0.55, 1.05),
        len: Math.max(5, len * R(0.16, 0.28)), color: leafColor,
        t0: lt0, t1: Math.min(lt0 + 0.18, 1)
      });
    }

    // bloom on top
    if (kind === 'flower') {
      var end = pointAt(stemOnly, 1);
      var bSize = Math.max(4.5, Math.min(13, len * 0.17)) * o.scale;
      blooms.push(makeBloom(R, end.x, end.y, end.a, bSize, o));
    } else if (kind === 'sprout' && R.chance(0.6)) {
      var se = pointAt(stemOnly, 1);
      var budPetal = R.pick(o.petals);
      blooms.push({
        x: se.x, y: se.y, angle: se.a, type: 'bud',
        size: Math.max(3, len * 0.16), petal: budPetal,
        edge: shade(budPetal, 0.72), t0: STEM_END, t1: 0.9
      });
    }

    var dur = R(0.45, 0.65);
    return { strokes: strokes, leaves: leaves, blooms: blooms, delay: R() * (1 - dur), dur: dur };
  }

  /* ---------------- drawing ---------------- */

  function drawStroke(ctx, s, t) {
    var target = s.total * easeOutCubic(t);
    if (target <= 0.1) return;
    ctx.strokeStyle = s.color;
    ctx.lineCap = 'round';
    for (var i = 1; i < s.pts.length; i++) {
      var a = s.pts[i - 1], b = s.pts[i];
      var bx = b.x, by = b.y;
      if (s.cum[i] > target) {
        var u = (target - s.cum[i - 1]) / (s.cum[i] - s.cum[i - 1]);
        bx = lerp(a.x, b.x, u);
        by = lerp(a.y, b.y, u);
      }
      ctx.lineWidth = lerp(s.w0, s.w1, s.cum[i - 1] / s.total);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(bx, by);
      ctx.stroke();
      if (s.cum[i] > target) break;
    }
  }

  function drawLeaf(ctx, l, g) {
    if (g <= 0) return;
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.angle);
    ctx.scale(g, g);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(l.len * 0.5, -l.len * 0.3, l.len, 0);
    ctx.quadraticCurveTo(l.len * 0.5, l.len * 0.3, 0, 0);
    ctx.fillStyle = l.color;
    ctx.fill();
    ctx.restore();
  }

  function drawBloom(ctx, b, g) {
    if (g <= 0) return;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(g, g);
    var i, a, s = b.size;
    ctx.lineWidth = 1;

    if (b.type === 'dot') {
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, TAU);
      ctx.fillStyle = b.petal;
      ctx.fill();

    } else if (b.type === 'bud') {
      ctx.rotate(b.angle);
      ctx.beginPath();
      ctx.moveTo(-s * 0.1, 0);
      ctx.quadraticCurveTo(s * 0.45, -s * 0.6, s * 1.05, 0);
      ctx.quadraticCurveTo(s * 0.45, s * 0.6, -s * 0.1, 0);
      ctx.fillStyle = b.petal;
      ctx.fill();
      ctx.strokeStyle = b.edge;
      ctx.stroke();

    } else if (b.type === 'daisy') {
      for (i = 0; i < b.n; i++) {
        a = b.rot + (i / b.n) * TAU;
        ctx.save();
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(s * 0.62, 0, s * 0.6, s * 0.26, 0, 0, TAU);
        ctx.fillStyle = b.petal;
        ctx.fill();
        ctx.strokeStyle = b.edge;
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.34, 0, TAU);
      ctx.fillStyle = b.center;
      ctx.fill();
      ctx.strokeStyle = shade(b.center, 0.7);
      ctx.stroke();

    } else if (b.type === 'round') {
      var k = Math.min(b.n, 6);
      for (i = 0; i < k; i++) {
        a = b.rot + (i / k) * TAU;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * s * 0.58, Math.sin(a) * s * 0.58, s * 0.48, 0, TAU);
        ctx.fillStyle = b.petal;
        ctx.fill();
        ctx.strokeStyle = b.edge;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.36, 0, TAU);
      ctx.fillStyle = b.center;
      ctx.fill();

    } else if (b.type === 'spark') {
      // asterisk / starburst flower
      ctx.strokeStyle = b.petal;
      ctx.lineWidth = Math.max(1.1, s * 0.14);
      ctx.lineCap = 'round';
      for (i = 0; i < b.n; i++) {
        a = b.rot + (i / b.n) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * s * 0.2, Math.sin(a) * s * 0.2);
        ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.2, 0, TAU);
      ctx.fillStyle = b.center;
      ctx.fill();

    } else if (b.type === 'cluster') {
      for (i = 0; i < b.dots.length; i++) {
        var d = b.dots[i];
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, TAU);
        ctx.fillStyle = d.c;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /* ---------------- the field ---------------- */

  function FlowerField(target, opts) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('Flowers: target element not found');
    this.el = el;
    this.o = {};
    var defaults = FlowerField.defaults;
    var theme = opts && opts.theme ? THEMES[opts.theme] : null;
    if (opts && opts.theme && !theme) throw new Error('Flowers: unknown theme "' + opts.theme + '"');
    for (var k in defaults) {
      this.o[k] = defaults[k];
      if (theme && theme[k] !== undefined) this.o[k] = theme[k];
      if (opts && opts[k] !== undefined) this.o[k] = opts[k];
    }
    if (this.o.reach == null) this.o.reach = Math.ceil(this.o.size[1] * this.o.scale * 1.6 + 24);

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
      this._onEnter = function () { self.bloom(); };
      this._onLeave = function () { self.wilt(); };
      el.addEventListener('pointerenter', this._onEnter);
      el.addEventListener('pointerleave', this._onLeave);
      el.addEventListener('focusin', this._onEnter);
      el.addEventListener('focusout', this._onLeave);
    } else if (trig !== 'manual') {
      this.play();
    }
  }

  FlowerField.defaults = {
    edges: ['top', 'bottom', 'left', 'right'], // which edges sprout
    direction: 'out',      // 'out' = away from the element, 'in' = over it
    spacing: 42,           // average px between plants (before density)
    density: 1,            // multiplier: 2 = twice as many plants
    size: [26, 78],        // min/max stem length in px
    scale: 1,              // overall size multiplier
    inset: 8,              // keep-clear margin at each edge's corners
    reach: null,           // canvas margin around the element (auto if null)
    petals: PETALS,
    stems: STEM_GREENS,
    centers: CENTERS,
    seed: null,            // set for a reproducible arrangement
    duration: 2800,        // grow animation ms
    animate: true,
    autoplay: true,
    whenVisible: false,    // wait until scrolled into view
    theme: null,           // 'autumn' | 'noir' | 'meadow' (see Flowers.themes)
    trigger: null,         // 'load' | 'visible' | 'hover' | 'manual'
    zIndex: 1
  };

  FlowerField.prototype.refresh = function () {
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

  FlowerField.prototype.generate = function () {
    var R = makeRand(this.seed);
    var o = this.o;
    var m = o.reach;
    var w = this.el.offsetWidth, h = this.el.offsetHeight;
    var flip = o.direction === 'in' ? Math.PI : 0;
    var lines = {
      top:    { x0: m, y0: m, x1: m + w, y1: m, a: -Math.PI / 2 },
      bottom: { x0: m, y0: m + h, x1: m + w, y1: m + h, a: Math.PI / 2 },
      left:   { x0: m, y0: m, x1: m, y1: m + h, a: Math.PI },
      right:  { x0: m + w, y0: m, x1: m + w, y1: m + h, a: 0 }
    };
    this.plants = [];
    for (var i = 0; i < o.edges.length; i++) {
      var e = lines[o.edges[i]];
      if (!e) continue;
      var L = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
      var pos = o.inset + R() * (o.spacing / o.density) * 0.6;
      while (pos < L - o.inset) {
        var t = pos / L;
        this.plants.push(buildPlant(R, lerp(e.x0, e.x1, t), lerp(e.y0, e.y1, t), e.a + flip, o));
        pos += (o.spacing / o.density) * R(0.6, 1.5);
      }
    }
  };

  FlowerField.prototype.draw = function () {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    for (var i = 0; i < this.plants.length; i++) {
      var p = this.plants[i];
      var lt = clamp01((this.progress - p.delay) / p.dur);
      if (lt <= 0) continue;
      var j;
      for (j = 0; j < p.strokes.length; j++) {
        var s = p.strokes[j];
        drawStroke(ctx, s, phase(lt, s.t0, s.t1));
      }
      for (j = 0; j < p.leaves.length; j++) {
        var l = p.leaves[j];
        drawLeaf(ctx, l, easeOutBack(phase(lt, l.t0, l.t1)));
      }
      for (j = 0; j < p.blooms.length; j++) {
        var b = p.blooms[j];
        drawBloom(ctx, b, easeOutBack(phase(lt, b.t0, b.t1)));
      }
    }
  };

  FlowerField.prototype.animateTo = function (target, ms) {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    var reduced = typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!this.o.animate || reduced || ms <= 0) {
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
      self.draw();
      self.raf = t < 1 ? requestAnimationFrame(tick) : null;
    };
    this.raf = requestAnimationFrame(tick);
    return this;
  };

  FlowerField.prototype.play = function () {
    this.progress = 0;
    return this.animateTo(1, this.o.duration);
  };

  // grow from the current state (hover-in); wilting reverses the growth (hover-out)
  FlowerField.prototype.bloom = function () {
    return this.animateTo(1, this.o.duration * (1 - this.progress));
  };

  FlowerField.prototype.wilt = function () {
    return this.animateTo(0, this.o.duration * 0.5 * this.progress);
  };

  FlowerField.prototype.finish = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.progress = 1;
    this.draw();
    return this;
  };

  FlowerField.prototype.regrow = function (seed) {
    this.seed = seed == null ? Math.floor(Math.random() * 1e9) : seed;
    this.generate();
    return this.play();
  };

  FlowerField.prototype.clear = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.progress = 0;
    this.ctx.clearRect(0, 0, this.w, this.h);
    return this;
  };

  FlowerField.prototype.destroy = function () {
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

  return {
    grow: function (target, opts) { return new FlowerField(target, opts); },
    Field: FlowerField,
    themes: THEMES,
    palettes: { petals: PETALS, stems: STEM_GREENS, centers: CENTERS }
  };
});
