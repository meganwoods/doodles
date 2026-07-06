/*!
 * heli3d.js — the heli.js Bell 412, modelled in three dimensions.
 * A box-model airframe with a four-blade rotor turning in a real 3D
 * plane. It flies in, hovers while slowly turning on the spot (so you
 * see it from every side), then lands and spools down — blades sagging
 * below horizontal as the rotor stops, turntable stopping with it.
 *
 *   const pad = Heli3D.hover('#launch-button');
 *   pad.refly();
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.Heli3D = factory();
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
    return R;
  }

  var LIVERIES = ['#c93a35', '#3f8fd2', '#f2b83d', '#4fae6c', '#7a8a4a', '#8a94a8'];
  var ACCENTS = ['#f4f4f1', '#f2b83d', '#c93a35', '#33415c'];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
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
  function depthAlpha(z) { return Math.max(0.4, Math.min(1, 0.78 + z * 0.006)); }

  /* ---------------- airframe ----------------
     Local frame: skid-bottom centre at origin, y up, +x toward the nose,
     z to starboard. Assembled from box faces + a few plates and lines. */

  function boxFaces(cx, cy, cz, sx, sy, sz, color, ink, out) {
    var x0 = cx - sx / 2, x1 = cx + sx / 2;
    var y0 = cy - sy / 2, y1 = cy + sy / 2;
    var z0 = cz - sz / 2, z1 = cz + sz / 2;
    var P = function (x, y, z) { return { x: x, y: y, z: z }; };
    var faces = [
      [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
      [P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)],
      [P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)],
      [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)],
      [P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)],
      [P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)]
    ];
    var tone = [1, 0.72, 1.14, 0.55, 0.9, 0.9];
    for (var i = 0; i < faces.length; i++) {
      out.push({ pts: faces[i], fill: shade(color, tone[i]), edge: ink, cull: true });
    }
  }

  function buildAirframe(u) {
    var F = u.F, body = u.body, accent = u.accent, ink = u.ink;
    var polys = [], lines = [];
    // cabin, nose, boom
    boxFaces(0.05 * F, 0.19 * F, 0, 0.36 * F, 0.2 * F, 0.17 * F, body, ink, polys);
    boxFaces(0.27 * F, 0.16 * F, 0, 0.12 * F, 0.13 * F, 0.13 * F, body, ink, polys);
    boxFaces(-0.34 * F, 0.25 * F, 0, 0.52 * F, 0.05 * F, 0.045 * F, body, ink, polys);
    // windscreen: dark plate leaning back over the nose
    polys.push({
      pts: [
        { x: 0.23 * F, y: 0.29 * F, z: 0.07 * F }, { x: 0.23 * F, y: 0.29 * F, z: -0.07 * F },
        { x: 0.31 * F, y: 0.2 * F, z: -0.06 * F }, { x: 0.31 * F, y: 0.2 * F, z: 0.06 * F }
      ], fill: shade(ink, 0.9), edge: ink, cull: true
    });
    // tail fin plate (both sides drawn — no cull)
    polys.push({
      pts: [
        { x: -0.55 * F, y: 0.27 * F, z: 0 }, { x: -0.66 * F, y: 0.46 * F, z: 0 },
        { x: -0.6 * F, y: 0.23 * F, z: 0 }
      ], fill: accent, edge: ink, cull: false
    });
    // skids + struts
    var rail = function (z) {
      return [
        { x: -0.16 * F, y: 0, z: z }, { x: 0.24 * F, y: 0, z: z },
        { x: 0.3 * F, y: 0.045 * F, z: z }
      ];
    };
    lines.push({ pts: rail(0.1 * F), w: 0.016 * F });
    lines.push({ pts: rail(-0.1 * F), w: 0.016 * F });
    var strut = function (x, z) {
      return { pts: [{ x: x, y: 0.09 * F, z: z * 0.85 }, { x: x, y: 0, z: z }], w: 0.014 * F };
    };
    lines.push(strut(0.12 * F, 0.1 * F));
    lines.push(strut(0.12 * F, -0.1 * F));
    lines.push(strut(-0.06 * F, 0.1 * F));
    lines.push(strut(-0.06 * F, -0.1 * F));
    // mast
    lines.push({ pts: [{ x: 0, y: 0.29 * F, z: 0 }, { x: 0, y: 0.34 * F, z: 0 }], w: 0.018 * F });
    return { polys: polys, lines: lines };
  }

  /* ---------------- the pad ---------------- */

  function Field(target, opts) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('Heli3D: target element not found');
    this.el = el;
    this.o = {};
    var defaults = Field.defaults;
    for (var k in defaults) this.o[k] = (opts && opts[k] !== undefined) ? opts[k] : defaults[k];
    if (this.o.reach == null) {
      this.o.reach = Math.ceil((this.o.altitude[1] + this.o.size[1] * 0.55) * this.o.scale + 26);
    }

    this.seed = this.o.seed == null ? Math.floor(Math.random() * 1e9) : this.o.seed;
    this.progress = 0;
    this.raf = null;
    this.stage = 'flight';
    this._rot = 0;         // rotor angle
    this._spin = 1;        // rotor speed
    this._desc = 0;        // descent 0…1
    this._turn = 0;        // accumulated turntable yaw
    this._t0 = null;

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
      this._onEnter = function () { self.arrive(); };
      this._onLeave = function () { self.depart(); };
      el.addEventListener('pointerenter', this._onEnter);
      el.addEventListener('pointerleave', this._onLeave);
      el.addEventListener('focusin', this._onEnter);
      el.addEventListener('focusout', this._onLeave);
    } else if (trig !== 'manual') {
      this.play();
    }
  }

  Field.defaults = {
    count: 1,
    facing: 'random',
    minGap: 18,
    size: [60, 90],        // fuselage length px
    altitude: [46, 72],
    scale: 1,
    inset: 6,
    reach: null,
    colors: LIVERIES,
    accents: ACCENTS,
    ink: '#5a646f',
    seed: null,
    duration: 2400,
    animate: true,
    autoplay: true,
    whenVisible: false,
    trigger: null,
    idle: true,
    landAfter: 3600,       // a little longer aloft — time to admire the turn
    landDuration: 1900,
    turnSpeed: 1,          // multiplier on the hover turntable rate
    yaw: 0.35,
    tilt: 0.12,
    perspective: 360,
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
    var w = this.el.offsetWidth;
    this.units = [];
    this.placed = 0;

    var group = [], i;
    for (i = 0; i < o.count; i++) {
      var F = R(o.size[0], o.size[1]) * o.scale;
      var body = R.pick(o.colors);
      var accent = R.pick(o.accents);
      if (accent === body) accent = '#f4f4f1';
      var fdir = R.sign();
      if (o.facing === 'left') fdir = -1;
      else if (o.facing === 'right') fdir = 1;
      var u = {
        F: F, body: body, accent: accent, ink: o.ink,
        facing: fdir,
        alt: R(o.altitude[0], o.altitude[1]) * o.scale,
        phi: R(0, TAU),
        span: F * 1.05
      };
      u.frame = buildAirframe(u);
      group.push(u);
    }
    var usable = w - 2 * o.inset;
    var total = function () {
      var t = 0;
      for (var j = 0; j < group.length; j++) t += group[j].span;
      return t + Math.max(0, group.length - 1) * o.minGap;
    };
    while (group.length > 1 && total() > usable) group.pop();
    if (!group.length) return;

    var slack = Math.max(0, usable - total());
    var weights = [], sum = 0;
    for (i = 0; i <= group.length; i++) { var q = R(0.2, 1); weights.push(q); sum += q; }
    var cursor = o.inset + (slack * weights[0]) / sum;
    for (i = 0; i < group.length; i++) {
      var u2 = group[i];
      u2.hx = m + cursor + u2.span / 2;      // hover x in canvas coords
      u2.sx = u2.hx - u2.facing * (this.w * 0.55 + u2.F);
      u2.dur = R(0.6, 0.8);
      u2.delay = R() * (1 - u2.dur);
      this.units.push(u2);
      cursor += u2.span + o.minGap + (slack * weights[i + 1]) / sum;
    }
    this.placed = group.length;
  };

  Field.prototype.draw = function (now) {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    var view = this.view;
    var descE = easeInOut(this._desc);
    var i, j, q;
    for (i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      var lt = clamp01((this.progress - u.delay) / u.dur);
      if (lt <= 0) continue;
      var f = easeInOut(lt);
      var F = u.F;

      // flight path (canvas x) + altitude; skid-bottom origin
      var px = lerp(u.sx, u.hx, f);
      var alt = (u.alt + F * 0.3 * (1 - f)) * (1 - descE);
      // thrust-vector pitch: nose-down accelerating, nose-up flare braking
      // into the hover, level again at zero groundspeed
      var sprof = Math.sin(TAU * f);
      var pitch = -(sprof > 0 ? 0.12 * sprof : 0.2 * sprof);
      var bobY = 0, bobX = 0;
      if (this.o.idle && this.progress >= 1 && this.stage === 'hover' && now !== undefined) {
        // hover-hold wander: layered frequencies, never quite still
        var tb = now * 0.001, ph = u.phi;
        bobY = (Math.sin(tb * 1.6 + ph) * 0.5 + Math.sin(tb * 2.9 + ph * 2.1) * 0.28 +
                Math.sin(tb * 0.7 + ph * 3.3) * 0.42) * F * 0.03;
        bobX = (Math.sin(tb * 0.9 + ph * 1.7) * 0.6 + Math.sin(tb * 2.2 + ph * 0.6) * 0.4) * F * 0.026;
        pitch += (Math.sin(tb * 1.3 + ph) * 0.6 + Math.sin(tb * 3.1 + ph * 2.4) * 0.4) * 0.02;
      }
      // heading: along the travel while flying, then the slow turntable
      var yawA = (u.facing > 0 ? 0 : Math.PI) - u.facing * this._turn;
      var cyw = Math.cos(yawA), syw = Math.sin(yawA);
      var cp = Math.cos(pitch), sp = Math.sin(pitch);

      var toWorld = function (p) {
        // pitch about z, then yaw about y, then place in the canvas
        var x1 = p.x * cp - p.y * sp;
        var y1 = p.x * sp + p.y * cp;
        var r = { x: x1 * cyw + p.z * syw, y: y1, z: -x1 * syw + p.z * cyw };
        return { x: r.x + (px - u.hx) + bobX, y: r.y + alt + bobY, z: r.z };
      };

      var ops = [];
      var fr = u.frame;
      for (j = 0; j < fr.polys.length; j++) {
        var pl = fr.polys[j];
        var pp = [], zsum = 0;
        for (q = 0; q < pl.pts.length; q++) {
          var pj = proj(view, toWorld(pl.pts[q]));
          pp.push(pj);
          zsum += pj.z;
        }
        var area = 0;
        for (q = 0; q < pp.length; q++) {
          var a2 = pp[q], b2 = pp[(q + 1) % pp.length];
          area += a2.x * b2.y - b2.x * a2.y;
        }
        if (pl.cull && area >= 0) continue;
        ops.push({ z: zsum / pp.length, poly: pp, fill: pl.fill, edge: pl.edge });
      }
      for (j = 0; j < fr.lines.length; j++) {
        var ln = fr.lines[j];
        var lp = [], zs = 0;
        for (q = 0; q < ln.pts.length; q++) {
          var lj = proj(view, toWorld(ln.pts[q]));
          lp.push(lj);
          zs += lj.z;
        }
        ops.push({ z: zs / lp.length, line: lp, w: Math.max(0.9, ln.w), color: u.ink });
      }

      // main rotor: blur ring + four blades in a true 3D plane
      var hub = { x: 0, y: 0.34 * F, z: 0 };
      var R0 = 0.5 * F;
      if (this._spin > 0.05) {
        var ring = [], zr = 0;
        for (j = 0; j <= 16; j++) {
          var ra = (j / 16) * TAU;
          var rp = proj(view, toWorld({ x: hub.x + Math.cos(ra) * R0, y: hub.y, z: hub.z + Math.sin(ra) * R0 }));
          ring.push(rp);
          zr += rp.z;
        }
        ops.push({ z: zr / ring.length + 0.01, line: ring, w: 0.9, color: u.ink, alpha: 0.2 * this._spin });
      }
      var cone = 0.05 * this._spin - 0.09 * (1 - this._spin);
      for (j = 0; j < 4; j++) {
        var ba = this._rot + u.phi + j * Math.PI / 2;
        var tipL = { x: hub.x + Math.cos(ba) * R0, y: hub.y + R0 * cone, z: hub.z + Math.sin(ba) * R0 };
        var hb = proj(view, toWorld(hub));
        var tb = proj(view, toWorld(tipL));
        ops.push({ z: (hb.z + tb.z) / 2 + 0.02, line: [hb, tb], w: Math.max(1, F * 0.016), color: u.ink, alpha: 0.9 });
      }
      // tail rotor: small ring + spoke on the port side of the fin
      var trC = { x: -0.63 * F, y: 0.38 * F, z: 0.025 * F };
      var trR = 0.1 * F;
      var tring = [], zt = 0;
      for (j = 0; j <= 10; j++) {
        var ta = (j / 10) * TAU;
        var tp = proj(view, toWorld({ x: trC.x + Math.cos(ta) * trR, y: trC.y + Math.sin(ta) * trR, z: trC.z }));
        tring.push(tp);
        zt += tp.z;
      }
      ops.push({ z: zt / tring.length, line: tring, w: 0.8, color: u.ink, alpha: 0.35 });
      var sa = (this._rot + u.phi) * 2.2;
      var s1 = proj(view, toWorld({ x: trC.x + Math.cos(sa) * trR, y: trC.y + Math.sin(sa) * trR, z: trC.z }));
      var s2 = proj(view, toWorld({ x: trC.x - Math.cos(sa) * trR, y: trC.y - Math.sin(sa) * trR, z: trC.z }));
      ops.push({ z: (s1.z + s2.z) / 2, line: [s1, s2], w: Math.max(0.8, F * 0.012), color: u.ink });

      // downwash ring on the pad while low with rotor turning
      if (this.o.downwash !== false && descE > 0.4 && this._spin > 0.05) {
        var dw = [], zd = 0;
        var dr = F * (0.34 + 0.1 * Math.sin((now || 0) * 0.004 + u.phi));
        for (j = 0; j <= 12; j++) {
          var da = (j / 12) * TAU;
          var dp = proj(view, { x: (px - u.hx) + Math.cos(da) * dr, y: 1, z: Math.sin(da) * dr });
          dw.push(dp);
          zd += dp.z;
        }
        ops.push({ z: zd / dw.length, line: dw, w: 0.8, color: u.ink, alpha: 0.16 * this._spin * descE });
      }

      ops.sort(function (a, b) { return a.z - b.z; });
      ctx.save();
      ctx.translate(u.hx, this.o.reach);
      for (j = 0; j < ops.length; j++) {
        var op = ops[j];
        ctx.globalAlpha = (op.alpha !== undefined ? op.alpha : 1) * depthAlpha(op.z);
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

  Field.prototype._liveLoop = function () {
    var self = this;
    var o = this.o;
    var last = null;
    var tick = function (now) {
      var dt = last == null ? 16.7 : Math.min(50, now - last);
      last = now;
      self._rot += dt * 0.021 * self._spin;
      self._turn += dt * 0.00035 * o.turnSpeed * self._spin;   // turntable slows with the rotor
      var t;
      if (self.stage === 'hover') {
        if (self._t0 == null) self._t0 = now;
        if (o.landAfter && now - self._t0 >= o.landAfter) { self.stage = 'descend'; self._t0 = now; }
        else if (!o.landAfter && !o.idle) { self.draw(now); self.raf = null; return; }
      } else if (self.stage === 'descend') {
        t = clamp01((now - self._t0) / o.landDuration);
        self._desc = t;
        if (t >= 1) { self.stage = 'spool'; self._t0 = now; }
      } else if (self.stage === 'spool') {
        t = clamp01((now - self._t0) / 2400);
        self._spin = 1 - t;
        if (t >= 1) { self._spin = 0; self.stage = 'parked'; self.draw(now); self.raf = null; return; }
      } else if (self.stage === 'spoolup') {
        t = clamp01((now - self._t0) / 1000);
        self._spin = t;
        if (t >= 1) { self.stage = 'ascend'; self._t0 = now; }
      } else if (self.stage === 'ascend') {
        t = clamp01((now - self._t0) / 1200);
        self._desc = 1 - t;
        if (t >= 1) { self.stage = 'hover'; self._t0 = null; }
      } else if (self.stage === 'parked') {
        self.draw(now);
        self.raf = null;
        return;
      }
      self.draw(now);
      self.raf = requestAnimationFrame(tick);
    };
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(tick);
  };

  Field.prototype.animateTo = function (target, ms) {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (!this.o.animate || this._reduced() || ms <= 0) {
      this.progress = target;
      if (target === 1) {
        if (this.o.landAfter) { this._desc = 1; this._spin = 0; this.stage = 'parked'; }
        else this.stage = 'hover';
      }
      this.draw();
      return this;
    }
    var self = this;
    var from = this.progress;
    var start = performance.now();
    var tick = function (now) {
      var t = clamp01((now - start) / ms);
      self.progress = lerp(from, target, t);
      self._rot += 0.35;
      self.draw(now);
      if (t < 1) {
        self.raf = requestAnimationFrame(tick);
      } else {
        self.raf = null;
        if (target === 1) {
          self.stage = 'hover';
          self._t0 = null;
          if (self.o.idle || self.o.landAfter) self._liveLoop();
        }
      }
    };
    this.raf = requestAnimationFrame(tick);
    return this;
  };

  Field.prototype.play = function () {
    this.progress = 0;
    this.stage = 'flight';
    this._desc = 0;
    this._spin = 1;
    this._turn = 0;
    this._t0 = null;
    return this.animateTo(1, this.o.duration);
  };
  Field.prototype.arrive = function () {
    if (this.stage === 'parked' || this.stage === 'spool') return this.takeoff();
    return this.animateTo(1, this.o.duration * (1 - this.progress));
  };
  Field.prototype.depart = function () {
    this.stage = 'flight';
    this._desc = 0;
    this._spin = 1;
    return this.animateTo(0, this.o.duration * 0.6 * this.progress);
  };
  Field.prototype.land = function () {
    if (this.progress >= 1 && (this.stage === 'hover' || this.stage === 'ascend')) {
      this.stage = 'descend';
      this._t0 = performance.now();
      this._liveLoop();
    }
    return this;
  };
  Field.prototype.takeoff = function () {
    if (this.stage === 'parked' || this.stage === 'spool') {
      this.stage = 'spoolup';
      this._t0 = performance.now();
      this._liveLoop();
    }
    return this;
  };
  Field.prototype.finish = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.progress = 1;
    if (this.o.landAfter) {
      this._desc = 1;
      this._spin = 0;
      this.stage = 'parked';
      this.draw();
    } else {
      this.stage = 'hover';
      this._t0 = null;
      this.draw();
      if (this.o.idle && this.o.animate && !this._reduced()) this._liveLoop();
    }
    return this;
  };
  Field.prototype.refly = function (seed) {
    this.seed = seed == null ? Math.floor(Math.random() * 1e9) : seed;
    this.generate();
    return this.play();
  };
  Field.prototype.clear = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.progress = 0;
    this.stage = 'flight';
    this._desc = 0;
    this._spin = 1;
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
  Field.prototype.regrow = Field.prototype.refly;

  return {
    hover: function (target, opts) { return new Field(target, opts); },
    Field: Field,
    palettes: { liveries: LIVERIES, accents: ACCENTS }
  };
});
