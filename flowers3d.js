/*!
 * flowers3d.js — the flowers.js doodle garden, grown in three dimensions.
 * Standalone companion renderer: real 3D stems, leaves and petal fans,
 * hand-rolled perspective projection onto the same overlay <canvas>,
 * painter's-algorithm depth sorting, and a gentle 3D wind. Zero deps.
 *
 *   const field = Flowers3D.grow('#card', { edges: ['top'] });
 *   field.regrow();
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.Flowers3D = factory();
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

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) {
    var c = 1.70158, u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  }
  function phase(t, t0, t1) { return clamp01((t - t0) / (t1 - t0)); }
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var c = function (v) { return Math.max(0, Math.min(255, Math.round(v * f))); };
    return 'rgb(' + c(n >> 16) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
  }

  /* ---------------- tiny 3d ----------------
     Unit-local frame: y up out of the edge, x along the edge,
     z toward the viewer. Camera: fixed yaw + slight downward tilt,
     simple perspective; painter's sort on view-space z. */

  function makeView(yaw, tilt, f) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var ct = Math.cos(tilt), st = Math.sin(tilt);
    return { cy: cy, sy: sy, ct: ct, st: st, f: f };
  }
  function proj(v, p) {
    var x = p.x * v.cy + p.z * v.sy;
    var z1 = -p.x * v.sy + p.z * v.cy;
    var y1 = p.y * v.ct - z1 * v.st;
    var z2 = p.y * v.st + z1 * v.ct;
    var k = v.f / (v.f - z2);
    return { x: x * k, y: -y1 * k, k: k, z: z2 };
  }
  function depthAlpha(z) { return Math.max(0.35, Math.min(1, 0.72 + z * 0.006)); }

  // vector bits
  function norm(p) {
    var l = Math.hypot(p.x, p.y, p.z) || 1;
    return { x: p.x / l, y: p.y / l, z: p.z / l };
  }
  function cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  }
  // any orthonormal basis (u, w) perpendicular to axis d
  function basis(d) {
    var ref = Math.abs(d.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    var u = norm(cross(d, ref));
    return { u: u, w: norm(cross(d, u)) };
  }

  /* ---------------- plant generation ---------------- */

  var STEM_END = 0.6;

  // 3D random-walk stem: starts up out of the edge, wanders in yaw & lean
  function growStem(R, len) {
    var n = Math.max(8, Math.round(len / 6));
    var step = len / n;
    var pts = [{ x: 0, y: 0, z: 0 }];
    var yawA = R(0, TAU);
    var lean = R(0.05, 0.3);
    var p = { x: 0, y: 0, z: 0 };
    for (var i = 0; i < n; i++) {
      yawA += (R() - 0.5) * 1.2;
      lean += (R() - 0.5) * 0.22;
      lean = Math.max(0, Math.min(0.7, lean));
      p = {
        x: p.x + Math.sin(yawA) * Math.sin(lean) * step,
        y: p.y + Math.cos(lean) * step,
        z: p.z + Math.cos(yawA) * Math.sin(lean) * step
      };
      pts.push(p);
    }
    return pts;
  }

  // curling tendril in a tilted 3D plane
  function tendril(R, at, dir, len, side) {
    var b = basis(dir);
    var a = 0, step = len / 9, curl = lerp(0.04, 0.075, R()) * side;
    var u = 0, w = 0;
    var pts = [at];
    for (var i = 0; i < 34; i++) {
      a += curl; curl *= 1.09; step *= 0.95;
      u += Math.cos(a) * step;
      w += Math.sin(a) * step;
      pts.push({
        x: at.x + dir.x * u * 0.4 + b.u.x * u * 0.6 + b.w.x * w,
        y: at.y + dir.y * u * 0.4 + b.u.y * u * 0.6 + b.w.y * w,
        z: at.z + dir.z * u * 0.4 + b.u.z * u * 0.6 + b.w.z * w
      });
    }
    return pts;
  }

  function mkStroke(pts, w0, w1, color, t0, t1) {
    var cum = [0], total = 0;
    for (var i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
      cum.push(total);
    }
    return { pts: pts, cum: cum, total: total, w0: w0, w1: w1, color: color, t0: t0, t1: t1 };
  }
  function pointAt(s, f) {
    var target = s.total * clamp01(f);
    for (var i = 1; i < s.pts.length; i++) {
      if (s.cum[i] >= target) {
        var a = s.pts[i - 1], b = s.pts[i];
        var seg = s.cum[i] - s.cum[i - 1];
        var u = seg > 0 ? (target - s.cum[i - 1]) / seg : 0;
        return {
          p: { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) },
          d: norm({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z })
        };
      }
    }
    var q = s.pts[s.pts.length - 1], r = s.pts[s.pts.length - 2];
    return { p: q, d: norm({ x: q.x - r.x, y: q.y - r.y, z: q.z - r.z }) };
  }

  // a filled polygon in 3D (leaf, petal, disc): points + anchor for pop-in
  function mkPoly(pts, anchor, fill, edge, t0, t1) {
    return { pts: pts, anchor: anchor, fill: fill, edge: edge, t0: t0, t1: t1 };
  }
  function leafPoly(at, dir, side, len, color, t0, t1) {
    var b = basis(dir);
    var s = side;
    var mk = function (f, w) {
      return {
        x: at.x + dir.x * len * 0.2 * f + b.u.x * len * f * s + b.w.x * w * len,
        y: at.y + dir.y * len * 0.2 * f + b.u.y * len * f * s + b.w.y * w * len,
        z: at.z + dir.z * len * 0.2 * f + b.u.z * len * f * s + b.w.z * w * len
      };
    };
    return mkPoly([mk(0, 0), mk(0.5, 0.34), mk(1, 0), mk(0.5, -0.34)], at, color, shade(color, 0.85), t0, t1);
  }

  function makeBloom(R, at, tipDir, size, o, polys) {
    // face the bloom mostly toward the viewer (a touch of the stem's own tilt)
    var axis = norm({ x: tipDir.x * 0.4, y: tipDir.y * 0.4 + 0.2, z: tipDir.z * 0.4 + 0.9 });
    var b = basis(axis);
    var n = R.int(5, 8);
    var petal = R.pick(o.petals);
    var edge = shade(petal, 0.72);
    var center = R.pick(o.centers);
    var rot = R(0, TAU);
    var i, j;
    for (i = 0; i < n; i++) {
      var a = rot + (i / n) * TAU;
      var du = Math.cos(a), dw = Math.sin(a);
      // petal: pointed oval lying in the bloom plane, tipped slightly up the axis
      var pts = [];
      var P = [[0, 0, 0], [0.5, 0.3, 0.08], [1.15, 0, 0.22], [0.5, -0.3, 0.08]];
      for (j = 0; j < P.length; j++) {
        var r = P[j][0] * size, side = P[j][1] * size, lift = P[j][2] * size;
        pts.push({
          x: at.x + (b.u.x * du + b.w.x * dw) * r + (b.u.x * -dw + b.w.x * du) * side + axis.x * lift,
          y: at.y + (b.u.y * du + b.w.y * dw) * r + (b.u.y * -dw + b.w.y * du) * side + axis.y * lift,
          z: at.z + (b.u.z * du + b.w.z * dw) * r + (b.u.z * -dw + b.w.z * du) * side + axis.z * lift
        });
      }
      polys.push(mkPoly(pts, at, petal, edge, STEM_END, 0.95));
    }
    // centre disc facing along the axis
    var disc = [];
    for (i = 0; i < 8; i++) {
      var ca = (i / 8) * TAU;
      disc.push({
        x: at.x + (b.u.x * Math.cos(ca) + b.w.x * Math.sin(ca)) * size * 0.34 + axis.x * size * 0.12,
        y: at.y + (b.u.y * Math.cos(ca) + b.w.y * Math.sin(ca)) * size * 0.34 + axis.y * size * 0.12,
        z: at.z + (b.u.z * Math.cos(ca) + b.w.z * Math.sin(ca)) * size * 0.34 + axis.z * size * 0.12
      });
    }
    polys.push(mkPoly(disc, at, center, shade(center, 0.7), STEM_END + 0.05, 1));
  }

  function buildPlant(R, o) {
    var strokes = [], polys = [];
    var roll = R();
    var kind = roll < 0.62 ? 'flower' : roll < 0.82 ? 'curl' : 'sprout';
    var stemColor = R.pick(o.stems);
    var leafColor = shade(stemColor, R(0.95, 1.3));
    var len = R(o.size[0], o.size[1]) * o.scale;
    if (kind === 'curl') len *= 0.85;
    if (kind === 'sprout') len *= 0.55;

    var stemPts = growStem(R, len);
    var w0 = Math.max(1.3, Math.min(2.6, len * 0.045)) * o.scale;
    var stem;
    if (kind === 'curl') {
      var end = stemPts[stemPts.length - 1], pv = stemPts[stemPts.length - 2];
      var tipD = norm({ x: end.x - pv.x, y: end.y - pv.y, z: end.z - pv.z });
      stem = mkStroke(stemPts.concat(tendril(R, end, tipD, len * 0.55, R.sign()).slice(1)), w0, w0 * 0.35, stemColor, 0, 0.88);
    } else {
      stem = mkStroke(stemPts, w0, w0 * 0.5, stemColor, 0, STEM_END);
    }
    strokes.push(stem);
    var stemOnly = mkStroke(stemPts, w0, w0, stemColor, 0, 1);

    var shoots = kind === 'sprout' ? (R.chance(0.5) ? 1 : 0) : R.int(0, 2);
    var i;
    for (i = 0; i < shoots; i++) {
      var f = R(0.3, 0.72);
      var q = pointAt(stemOnly, f);
      var t0 = f * STEM_END;
      strokes.push(mkStroke(tendril(R, q.p, q.d, len * R(0.28, 0.45), R.sign()),
        w0 * 0.6, w0 * 0.25, stemColor, t0, Math.min(t0 + 0.34, 1)));
    }

    var nLeaves = kind === 'sprout' ? 2 : R.int(1, 3);
    for (i = 0; i < nLeaves; i++) {
      var lf = R(0.25, 0.8);
      var lq = pointAt(stemOnly, lf);
      var lt0 = lf * STEM_END;
      polys.push(leafPoly(lq.p, lq.d, R.sign(), Math.max(5, len * R(0.16, 0.28)), leafColor, lt0, Math.min(lt0 + 0.18, 1)));
    }

    if (kind === 'flower') {
      var tip = pointAt(stemOnly, 1);
      makeBloom(R, tip.p, tip.d, Math.max(4.5, Math.min(13, len * 0.17)) * o.scale, o, polys);
    }

    var dur = R(0.45, 0.65);
    return {
      strokes: strokes, polys: polys, h: len,
      swayPhase: R(0, TAU), swayAmp: R(0.5, 1),
      delay: R() * (1 - dur), dur: dur
    };
  }

  /* ---------------- the field ---------------- */

  function Field(target, opts) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('Flowers3D: target element not found');
    this.el = el;
    this.o = {};
    var defaults = Field.defaults;
    for (var k in defaults) this.o[k] = (opts && opts[k] !== undefined) ? opts[k] : defaults[k];
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

  Field.defaults = {
    edges: ['top', 'bottom', 'left', 'right'],
    spacing: 42,
    density: 1,
    size: [26, 78],
    scale: 1,
    inset: 8,
    reach: null,
    petals: PETALS,
    stems: STEM_GREENS,
    centers: CENTERS,
    seed: null,
    duration: 2800,
    animate: true,
    autoplay: true,
    whenVisible: false,
    trigger: null,
    idle: true,            // 3D wind: plants keep gently swaying
    yaw: 0.5,              // camera yaw — how much "around the side" you see
    tilt: 0.14,            // camera tilt — how much "down onto" you see
    perspective: 320,      // focal length; smaller = more dramatic depth
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
    this.plants = [];
    for (var i = 0; i < o.edges.length; i++) {
      var e = lines[o.edges[i]];
      if (!e) continue;
      var L = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
      var pos = o.inset + R() * (o.spacing / o.density) * 0.6;
      while (pos < L - o.inset) {
        var t = pos / L;
        var plant = buildPlant(R, o);
        plant.bx = lerp(e.x0, e.x1, t);
        plant.by = lerp(e.y0, e.y1, t);
        plant.rot = e.a;
        this.plants.push(plant);
        pos += (o.spacing / o.density) * R(0.6, 1.5);
      }
    }
  };

  // partial 3D polyline by arc length, with a wind shear applied per point
  Field.prototype._strokeOp = function (ops, s, t, plant, wind) {
    var target = s.total * easeOutCubic(t);
    if (target <= 0.1) return;
    var out = [s.pts[0]];
    for (var i = 1; i < s.pts.length; i++) {
      var a = s.pts[i - 1], b = s.pts[i];
      if (s.cum[i] > target) {
        var u = (target - s.cum[i - 1]) / (s.cum[i] - s.cum[i - 1]);
        out.push({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) });
        break;
      }
      out.push(b);
    }
    this._emit(ops, out, null, s, plant, wind, s.cum, target);
  };

  Field.prototype._emit = function (ops, pts3, poly, s, plant, wind, cum, drawn) {
    var view = this.view;
    var H2 = plant.h * plant.h || 1;
    var pp = [], zsum = 0;
    for (var i = 0; i < pts3.length; i++) {
      var p = pts3[i];
      var sway = wind * plant.swayAmp * (p.y * p.y / H2);
      var q = proj(view, { x: p.x + sway * plant.h * 0.18, y: p.y, z: p.z + sway * plant.h * 0.1 });
      pp.push(q);
      zsum += q.z;
    }
    var zAvg = zsum / pp.length;
    if (poly) {
      ops.push({ z: zAvg, poly: pp, fill: poly.fill, edge: poly.edge, g: poly.g, ax: poly.ax, ay: poly.ay });
    } else {
      ops.push({ z: zAvg, line: pp, w0: s.w0, w1: s.w1, color: s.color, cum: cum, total: s.total, drawn: drawn });
    }
  };

  Field.prototype.draw = function (now) {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    var animOn = this.o.animate && !this._reduced();
    var i, j;
    for (i = 0; i < this.plants.length; i++) {
      var plant = this.plants[i];
      var lt = clamp01((this.progress - plant.delay) / plant.dur);
      if (lt <= 0) continue;
      var wind = (this.o.idle && animOn && now !== undefined)
        ? Math.sin(now * 0.0012 + plant.swayPhase) * 0.5 : 0;

      var ops = [];
      for (j = 0; j < plant.strokes.length; j++) {
        var s = plant.strokes[j];
        this._strokeOp(ops, s, phase(lt, s.t0, s.t1), plant, wind);
      }
      for (j = 0; j < plant.polys.length; j++) {
        var pl = plant.polys[j];
        var g = easeOutBack(phase(lt, pl.t0, pl.t1));
        if (g <= 0) continue;
        // scale the polygon about its anchor for the pop-in
        var pts3 = [];
        for (var q = 0; q < pl.pts.length; q++) {
          pts3.push({
            x: pl.anchor.x + (pl.pts[q].x - pl.anchor.x) * g,
            y: pl.anchor.y + (pl.pts[q].y - pl.anchor.y) * g,
            z: pl.anchor.z + (pl.pts[q].z - pl.anchor.z) * g
          });
        }
        this._emit(ops, pts3, { fill: pl.fill, edge: pl.edge }, null, plant, wind);
      }
      ops.sort(function (a, b) { return a.z - b.z; });

      ctx.save();
      ctx.translate(plant.bx, plant.by);
      ctx.rotate(plant.rot);
      for (j = 0; j < ops.length; j++) {
        var op = ops[j];
        ctx.globalAlpha = depthAlpha(op.z);
        if (op.line) {
          // one path per stroke: overlapping per-segment caps band under alpha
          ctx.strokeStyle = op.color;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          var kAvg = 0, n;
          for (n = 0; n < op.line.length; n++) kAvg += op.line[n].k;
          kAvg /= op.line.length;
          var drawnFrac = op.total ? Math.min(1, op.drawn / op.total) : 1;
          ctx.lineWidth = lerp(op.w0, lerp(op.w0, op.w1, drawnFrac), 0.5) * kAvg;
          ctx.beginPath();
          ctx.moveTo(op.line[0].x, op.line[0].y);
          for (n = 1; n < op.line.length; n++) ctx.lineTo(op.line[n].x, op.line[n].y);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(op.poly[0].x, op.poly[0].y);
          for (var q2 = 1; q2 < op.poly.length; q2++) ctx.lineTo(op.poly[q2].x, op.poly[q2].y);
          ctx.closePath();
          // backfaces read a touch darker — a free 3D shading cue
          var area = 0;
          for (var q3 = 0; q3 < op.poly.length; q3++) {
            var p1 = op.poly[q3], p2 = op.poly[(q3 + 1) % op.poly.length];
            area += p1.x * p2.y - p2.x * p1.y;
          }
          ctx.fillStyle = area < 0 ? op.fill : shade2(op.fill, 0.85);
          ctx.fill();
          ctx.strokeStyle = op.edge;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  };

  // shade() works on #hex; polygon fills may already be rgb() from shade()
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
  Field.prototype.bloom = function () { return this.animateTo(1, this.o.duration * (1 - this.progress)); };
  Field.prototype.wilt = function () { return this.animateTo(0, this.o.duration * 0.5 * this.progress); };
  Field.prototype.finish = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.progress = 1;
    this.draw();
    if (this.o.idle && this.o.animate && !this._reduced()) this._idleLoop();
    return this;
  };
  Field.prototype.regrow = function (seed) {
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

  return {
    grow: function (target, opts) { return new Field(target, opts); },
    Field: Field,
    palettes: { petals: PETALS, stems: STEM_GREENS, centers: CENTERS }
  };
});
