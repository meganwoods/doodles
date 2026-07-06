/*!
 * cranes3d.js — the cranes.js doodle site, built in three dimensions.
 * Square lattice towers, triangular lattice jibs, and a slow slew:
 * each jib rotates gently around its tower, hook sweeping through space.
 * Hand-rolled perspective + painter's sort on a 2D canvas. Zero deps.
 *
 *   const site = Cranes3D.build('#hero', { count: 2 });
 *   site.rebuild();
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.Cranes3D = factory();
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

  var STRUCTURE = ['#e8a13c', '#d95b2e', '#c93a35', '#dfc23a', '#8a94a8'];

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

  /* ---- tiny 3d: y up, z toward viewer; fixed camera yaw+tilt ---- */

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
  function rotY(p, c, s) { return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }; }

  /* ---------------- crane generation ----------------
     Tower frame: origin at base centre. Jib frame: origin at the slew
     bearing (top of tower); +x out along the jib; rotated by the slew
     angle each frame. */

  function mkStroke(pts, w, color, t0, t1) {
    var cum = [0], total = 0;
    for (var i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
      cum.push(total);
    }
    return { pts: pts, cum: cum, total: total, w: w, color: color, t0: t0, t1: t1 };
  }

  // 6 faces of an axis-aligned box (in its frame) as fill polys
  function boxFaces(cx, cy, cz, sx, sy, sz, color, ink, t0, t1, out, frame) {
    var x0 = cx - sx / 2, x1 = cx + sx / 2;
    var y0 = cy - sy / 2, y1 = cy + sy / 2;
    var z0 = cz - sz / 2, z1 = cz + sz / 2;
    var P = function (x, y, z) { return { x: x, y: y, z: z }; };
    var faces = [
      [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],  // front
      [P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)],  // back
      [P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)],  // top
      [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)],  // bottom
      [P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)],  // +x
      [P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)]   // -x
    ];
    var tone = [1, 0.75, 1.12, 0.6, 0.88, 0.88];
    var anchor = P(cx, cy, cz);
    for (var i = 0; i < faces.length; i++) {
      out.push({ pts: faces[i], anchor: anchor, fill: shade(color, tone[i]), edge: ink, t0: t0, t1: t1, frame: frame });
    }
  }

  function buildCrane(R, o) {
    var color = R.pick(o.colors);
    var ink = o.ink;
    var H = R(o.size[0], o.size[1]) * o.scale;
    var mw = Math.max(6, Math.min(13, H * 0.1));
    var tw = mw / 2;
    var cell = mw * 1.2;
    var nC = Math.max(4, Math.round(H / cell));
    H = nC * cell;
    var lw = Math.max(1.1, mw * 0.14);
    var thin = Math.max(0.75, lw * 0.5);

    var tower = [], jib = [], boxes = [];
    var i;
    var MAST0 = 0.05, MAST1 = 0.45;

    // ground pad
    tower.push(mkStroke([{ x: -mw, y: 0, z: -mw }, { x: mw, y: 0, z: -mw }, { x: mw, y: 0, z: mw },
      { x: -mw, y: 0, z: mw }, { x: -mw, y: 0, z: -mw }], lw, ink, 0, 0.06));

    // four rails
    var corners = [[-tw, -tw], [tw, -tw], [tw, tw], [-tw, tw]];
    for (i = 0; i < 4; i++) {
      tower.push(mkStroke([{ x: corners[i][0], y: 0, z: corners[i][1] },
        { x: corners[i][0], y: H, z: corners[i][1] }], lw, color, MAST0, MAST1));
    }
    // zigzag bracing on all four faces + rungs every other cell
    var faces = [
      function (t, h) { return { x: lerp(-tw, tw, t), y: h, z: tw }; },
      function (t, h) { return { x: lerp(-tw, tw, t), y: h, z: -tw }; },
      function (t, h) { return { x: tw, y: h, z: lerp(-tw, tw, t) }; },
      function (t, h) { return { x: -tw, y: h, z: lerp(-tw, tw, t) }; }
    ];
    for (i = 0; i < 4; i++) {
      var zig = [];
      for (var c = 0; c <= nC; c++) zig.push(faces[i](c % 2, c * cell));
      tower.push(mkStroke(zig, thin, color, MAST0 + 0.02, MAST1 + 0.02));
    }
    for (var rr = 2; rr < nC; rr += 2) {
      tower.push(mkStroke([
        { x: -tw, y: rr * cell, z: tw }, { x: tw, y: rr * cell, z: tw },
        { x: tw, y: rr * cell, z: -tw }, { x: -tw, y: rr * cell, z: -tw },
        { x: -tw, y: rr * cell, z: tw }
      ], thin, color, MAST0 + (rr / nC) * (MAST1 - MAST0), MAST1 + 0.02));
    }

    // slew deck (jib frame sits at y=0 == top of tower)
    var dh = mw * 0.9;
    boxFaces(0, dh / 2, 0, mw * 2.2, dh, mw * 1.3, color, ink, 0.45, 0.53, boxes, 'jib');

    // apex pyramid on the deck
    var apex = { x: 0, y: dh + mw * 2.1, z: 0 };
    jib.push(mkStroke([{ x: -mw * 0.5, y: dh, z: 0 }, apex], lw, color, 0.5, 0.56));
    jib.push(mkStroke([{ x: mw * 0.5, y: dh, z: 0 }, apex], lw, color, 0.5, 0.56));

    // jib: triangular lattice boom out along +x
    var J = H * R(0.75, 1.0);
    var bw = mw * 0.45, bh = mw * 0.7;
    var JIB0 = 0.55, JIB1 = 0.76;
    var nJ = Math.max(4, Math.round(J / (mw * 1.4)));
    var chordL = [], chordR = [], chordT = [], zigL = [], zigR = [];
    for (i = 0; i <= nJ; i++) {
      var t2 = i / nJ, r = t2 * J, sq = 1 - t2 * 0.7;
      chordL.push({ x: r, y: dh, z: -bw * sq });
      chordR.push({ x: r, y: dh, z: bw * sq });
      chordT.push({ x: r, y: dh + bh * sq, z: 0 });
      zigL.push(i % 2 ? { x: r, y: dh + bh * sq, z: 0 } : { x: r, y: dh, z: -bw * sq });
      zigR.push(i % 2 ? { x: r, y: dh + bh * sq, z: 0 } : { x: r, y: dh, z: bw * sq });
    }
    jib.push(mkStroke(chordL, lw, color, JIB0, JIB1));
    jib.push(mkStroke(chordR, lw, color, JIB0, JIB1));
    jib.push(mkStroke(chordT, lw, color, JIB0, JIB1));
    jib.push(mkStroke(zigL, thin, color, JIB0 + 0.02, JIB1 + 0.02));
    jib.push(mkStroke(zigR, thin, color, JIB0 + 0.02, JIB1 + 0.02));

    // counter-jib + counterweight
    var C = J * R(0.3, 0.4);
    jib.push(mkStroke([{ x: 0, y: dh, z: -bw }, { x: -C, y: dh, z: -bw * 0.6 }], lw, color, 0.55, 0.66));
    jib.push(mkStroke([{ x: 0, y: dh, z: bw }, { x: -C, y: dh, z: bw * 0.6 }], lw, color, 0.55, 0.66));
    boxFaces(-C * 0.92, dh - mw * 0.5, 0, mw * 1.1, mw * 1.1, mw * 1.2, '#6a7280', ink, 0.62, 0.7, boxes, 'jib');

    // pendants
    jib.push(mkStroke([apex, { x: J * 0.55, y: dh + bh * 0.6, z: 0 }], thin, ink, 0.72, 0.8));
    jib.push(mkStroke([apex, { x: J, y: dh + bh * 0.3, z: 0 }], thin, ink, 0.74, 0.82));
    jib.push(mkStroke([apex, { x: -C * 0.92, y: dh, z: 0 }], thin, ink, 0.72, 0.78));

    // trolley + hook
    var trolleyR = J * R(0.55, 0.85);
    boxFaces(trolleyR, dh - mw * 0.25, 0, mw * 0.7, mw * 0.4, mw * 0.5, '#6a7280', ink, 0.8, 0.86, boxes, 'jib');
    var drop = H * R(0.3, 0.6);
    var hasLoad = R.chance(0.4);

    var dur = R(0.55, 0.7);
    return {
      tower: tower, jib: jib, boxes: boxes,
      H: H, mw: mw, lw: lw, ink: ink, color: color,
      trolleyR: trolleyR, dh: dh, drop: drop, hasLoad: hasLoad,
      slew0: R(0, TAU), slewPhase: R(0, TAU),
      span: J + mw, left: J + mw, right: J + mw,
      delay: 0, dur: dur
    };
  }

  /* ---------------- the site ---------------- */

  function Field(target, opts) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('Cranes3D: target element not found');
    this.el = el;
    this.o = {};
    var defaults = Field.defaults;
    for (var k in defaults) this.o[k] = (opts && opts[k] !== undefined) ? opts[k] : defaults[k];
    if (this.o.reach == null) this.o.reach = Math.ceil(this.o.size[1] * this.o.scale * 1.6 + 30);

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
      this._onEnter = function () { self.assemble(); };
      this._onLeave = function () { self.dismantle(); };
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
    minGap: 16,
    size: [60, 110],
    scale: 1,
    inset: 10,
    reach: null,
    colors: STRUCTURE,
    ink: '#5a646f',
    seed: null,
    duration: 3400,
    animate: true,
    autoplay: true,
    whenVisible: false,
    trigger: null,
    idle: true,            // keep slewing after assembly
    slewSpeed: 1,          // multiplier on the idle slew rate
    yaw: 0.5,
    tilt: 0.16,
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
    this.cranes = [];
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
      for (i = 0; i < perEdge[name]; i++) group.push(buildCrane(R, o));
      var width = function (c) { return c.left + c.right; };
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
        var cr = group[i];
        var along = (cursor + cr.left) / L;
        cr.bx = lerp(e.x0, e.x1, along);
        cr.by = lerp(e.y0, e.y1, along);
        cr.rot = e.a;
        cr.delay = R() * (1 - cr.dur);
        this.cranes.push(cr);
        cursor += width(cr) + o.minGap + (slack * weights[i + 1]) / sum;
      }
      this.placed += group.length;
    }
  };

  Field.prototype._emitStroke = function (ops, s, t, transform) {
    var target = s.total * easeOutCubic(t);
    if (target <= 0.1) return;
    var view = this.view;
    var pp = [], zsum = 0;
    for (var i = 0; i < s.pts.length; i++) {
      var p = s.pts[i];
      var partial = null;
      if (s.cum[i] > target) {
        var a = s.pts[i - 1];
        var u = (target - s.cum[i - 1]) / (s.cum[i] - s.cum[i - 1]);
        partial = { x: lerp(a.x, p.x, u), y: lerp(a.y, p.y, u), z: lerp(a.z, p.z, u) };
      }
      var q = proj(view, transform(partial || p));
      pp.push(q);
      zsum += q.z;
      if (partial) break;
    }
    if (pp.length < 2) return;
    ops.push({ z: zsum / pp.length, line: pp, w: s.w, color: s.color });
  };

  Field.prototype.draw = function (now) {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    var animOn = this.o.animate && !this._reduced();
    var i, j, q;
    for (i = 0; i < this.cranes.length; i++) {
      var cr = this.cranes[i];
      var lt = clamp01((this.progress - cr.delay) / cr.dur);
      if (lt <= 0) continue;

      var slew = cr.slew0;
      if (this.o.idle && animOn && now !== undefined && lt >= 1) {
        slew += Math.sin(now * 0.00022 * this.o.slewSpeed + cr.slewPhase) * 1.1;
      }
      var sc = Math.cos(slew), ss = Math.sin(slew);
      var H = cr.H;
      var towerT = function (p) { return p; };
      var jibT = function (p) { var r = rotY(p, sc, ss); return { x: r.x, y: r.y + H, z: r.z }; };

      var ops = [];
      for (j = 0; j < cr.tower.length; j++) {
        var s = cr.tower[j];
        this._emitStroke(ops, s, phase(lt, s.t0, s.t1), towerT);
      }
      for (j = 0; j < cr.jib.length; j++) {
        var s2 = cr.jib[j];
        this._emitStroke(ops, s2, phase(lt, s2.t0, s2.t1), jibT);
      }
      for (j = 0; j < cr.boxes.length; j++) {
        var bx = cr.boxes[j];
        var g = easeOutBack(phase(lt, bx.t0, bx.t1));
        if (g <= 0) continue;
        var pp = [], zsum = 0;
        for (q = 0; q < bx.pts.length; q++) {
          var p3 = {
            x: bx.anchor.x + (bx.pts[q].x - bx.anchor.x) * g,
            y: bx.anchor.y + (bx.pts[q].y - bx.anchor.y) * g,
            z: bx.anchor.z + (bx.pts[q].z - bx.anchor.z) * g
          };
          var pj = proj(this.view, bx.frame === 'jib' ? jibT(p3) : p3);
          pp.push(pj);
          zsum += pj.z;
        }
        // backface cull via winding: skip faces turned away
        var area = 0;
        for (q = 0; q < pp.length; q++) {
          var a2 = pp[q], b2 = pp[(q + 1) % pp.length];
          area += a2.x * b2.y - b2.x * a2.y;
        }
        if (area >= 0) continue;
        ops.push({ z: zsum / pp.length, poly: pp, fill: bx.fill, edge: bx.edge });
      }

      // hoist cable + hook, from the trolley straight down in world space
      var ct = phase(lt, 0.84, 0.97);
      if (ct > 0) {
        var trolleyW = jibT({ x: cr.trolleyR, y: cr.dh - cr.mw * 0.4, z: 0 });
        var dropNow = cr.drop * easeOutCubic(ct);
        var hookW = { x: trolleyW.x, y: trolleyW.y - dropNow, z: trolleyW.z };
        var pA = proj(this.view, trolleyW), pB = proj(this.view, hookW);
        ops.push({
          z: (pA.z + pB.z) / 2, line: [pA, pB],
          w: Math.max(0.7, cr.lw * 0.45), color: cr.ink, hook: { p: pB, r: cr.mw * 0.32, load: cr.hasLoad, g: phase(lt, 0.95, 1) }
        });
      }

      ops.sort(function (a, b) { return a.z - b.z; });
      ctx.save();
      ctx.translate(cr.bx, cr.by);
      ctx.rotate(cr.rot);
      for (j = 0; j < ops.length; j++) {
        var op = ops[j];
        ctx.globalAlpha = depthAlpha(op.z);
        if (op.line) {
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
          if (op.hook && op.hook.g > 0) {
            var hk = op.hook;
            ctx.save();
            ctx.translate(hk.p.x, hk.p.y);
            ctx.scale(hk.g * hk.p.k, hk.g * hk.p.k);
            if (hk.load) {
              ctx.fillStyle = op.color;
              ctx.fillRect(-hk.r * 1.6, 0, hk.r * 3.2, hk.r * 1.5);
            } else {
              ctx.lineWidth = Math.max(0.7, op.w);
              ctx.beginPath();
              ctx.arc(0, hk.r * 0.7, hk.r * 0.6, -Math.PI / 2, Math.PI * 0.75);
              ctx.stroke();
            }
            ctx.restore();
          }
        } else {
          ctx.beginPath();
          ctx.moveTo(op.poly[0].x, op.poly[0].y);
          for (q = 1; q < op.poly.length; q++) ctx.lineTo(op.poly[q].x, op.poly[q].y);
          ctx.closePath();
          ctx.fillStyle = op.fill;
          ctx.fill();
          ctx.strokeStyle = op.edge;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  };

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
  Field.prototype.assemble = function () { return this.animateTo(1, this.o.duration * (1 - this.progress)); };
  Field.prototype.dismantle = function () { return this.animateTo(0, this.o.duration * 0.5 * this.progress); };
  Field.prototype.finish = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.progress = 1;
    this.draw();
    if (this.o.idle && this.o.animate && !this._reduced()) this._idleLoop();
    return this;
  };
  Field.prototype.rebuild = function (seed) {
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
  Field.prototype.regrow = Field.prototype.rebuild;

  return {
    build: function (target, opts) { return new Field(target, opts); },
    Field: Field,
    palettes: { structure: STRUCTURE }
  };
});
