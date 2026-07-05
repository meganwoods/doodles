/*!
 * cranes.js — assemble little doodle tower cranes along the edges of things.
 * Companion renderer to flowers.js.
 *
 *   const site = Cranes.build('#hero', { count: 3, edges: ['top'] });
 *   site.rebuild();   // new random skyline
 *   site.destroy();   // remove
 *
 * Cranes are luffing-jib tower cranes (lattice mast, machinery deck,
 * A-frame apex, angled lattice jib, pendant cables, hoist line and hook),
 * generated from a seeded RNG and animated assembling bottom-up. Placement
 * is packed so cranes never overlap: `count` is a request, and if the edge
 * can't fit that many without clutter, fewer are placed.
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.Cranes = factory();
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

  var STRUCTURE = ['#e8a13c', '#d95b2e', '#c93a35', '#dfc23a', '#8a94a8'];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) {
    var c = 1.70158, u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  }
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
    if (target <= 0.1) return;
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

  // a rectangle that pops in, scaling about its centre
  function drawRect(ctx, r, g) {
    if (g <= 0) return;
    ctx.save();
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.scale(g, g);
    ctx.fillStyle = r.fill;
    ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
    if (r.line) {
      ctx.strokeStyle = r.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
    }
    ctx.restore();
  }

  /* ---------------- crane generation ----------------
     Local frame: base of the mast at (0,0), up is -y, the jib points
     toward dir (+1 right / -1 left). All x already include dir. */

  function buildCrane(R, o) {
    var color = R.pick(o.colors);
    var ink = o.ink;
    var dir = R.sign();
    var H = R(o.size[0], o.size[1]) * o.scale;
    var mw = Math.max(5, Math.min(11, H * 0.09));   // mast width
    var cell = mw * 1.15;
    var nCells = Math.max(4, Math.round(H / cell));
    H = nCells * cell;                              // snap to whole lattice cells
    var lw = Math.max(1.2, mw * 0.16);              // structural line width
    var thin = Math.max(0.8, lw * 0.5);             // cables

    var strokes = [], rects = [], i;
    var deckH = mw * 1.15;
    var deckTop = -H - deckH;
    var counterLen = mw * 2.5;                      // deck overhang, counter side
    var frontLen = mw * 1.5;                        // deck overhang, jib side

    // ground pad + feet
    strokes.push(mkStroke([{ x: -mw * 1.6, y: 0 }, { x: mw * 1.6, y: 0 }], lw * 1.4, ink, 0, 0.06));
    strokes.push(mkStroke([{ x: -mw * 0.9, y: 0 }, { x: -mw * 0.5, y: -cell * 0.6 }], lw, color, 0.02, 0.07));
    strokes.push(mkStroke([{ x: mw * 0.9, y: 0 }, { x: mw * 0.5, y: -cell * 0.6 }], lw, color, 0.02, 0.07));

    // mast rails
    var railL = [], railR = [], zigA = [], zigB = [];
    for (i = 0; i <= nCells; i++) {
      var y = -i * cell;
      railL.push({ x: -mw / 2, y: y });
      railR.push({ x: mw / 2, y: y });
      zigA.push({ x: (i % 2 ? -mw / 2 : mw / 2), y: y });
      zigB.push({ x: (i % 2 ? mw / 2 : -mw / 2), y: y });
    }
    var MAST0 = 0.05, MAST1 = 0.42;
    strokes.push(mkStroke(railL, lw, color, MAST0, MAST1));
    strokes.push(mkStroke(railR, lw, color, MAST0, MAST1));
    strokes.push(mkStroke(zigA, thin, color, MAST0 + 0.02, MAST1 + 0.02));
    strokes.push(mkStroke(zigB, thin, color, MAST0 + 0.02, MAST1 + 0.02));

    // machinery deck, cab, boxes, railing
    rects.push({
      x: dir > 0 ? -counterLen : -frontLen, y: deckTop,
      w: counterLen + frontLen, h: deckH, fill: color, line: ink, t0: 0.42, t1: 0.5
    });
    var boxX = -dir * counterLen;
    var nBoxes = R.int(2, 3);
    for (i = 0; i < nBoxes; i++) {
      var bw = mw * R(0.7, 1.0), bh = mw * R(0.6, 1.1);
      boxX += dir * bw * 0.55;
      rects.push({
        x: boxX - bw / 2, y: deckTop - bh, w: bw, h: bh,
        fill: i === 0 ? ink : color, line: ink, t0: 0.45 + i * 0.02, t1: 0.53 + i * 0.02
      });
      boxX += dir * bw * 0.55;
    }
    // cab at the jib end of the deck, with a window
    var cabW = mw * 1.05, cabH = mw * 1.0;
    rects.push({
      x: dir > 0 ? frontLen - cabW : -frontLen, y: deckTop - cabH,
      w: cabW, h: cabH, fill: color, line: ink, t0: 0.46, t1: 0.54
    });
    rects.push({
      x: (dir > 0 ? frontLen - cabW : -frontLen) + cabW * 0.2, y: deckTop - cabH + cabH * 0.2,
      w: cabW * 0.45, h: cabH * 0.4, fill: ink, t0: 0.5, t1: 0.56
    });
    // railing on the counter end
    var railY = deckTop, railTop = deckTop - mw * 0.7;
    var railPts = [];
    for (i = 0; i < 3; i++) {
      var rx = -dir * (counterLen - i * mw * 0.6);
      strokes.push(mkStroke([{ x: rx, y: railY }, { x: rx, y: railTop }], thin, ink, 0.5, 0.56));
    }
    strokes.push(mkStroke([
      { x: -dir * counterLen, y: railTop }, { x: -dir * (counterLen - mw * 1.2), y: railTop }
    ], thin, ink, 0.52, 0.58));

    // A-frame apex above the deck
    var apex = { x: dir * mw * 0.1, y: deckTop - mw * 1.9 };
    strokes.push(mkStroke([{ x: -dir * mw * 0.6, y: deckTop }, apex], lw, color, 0.46, 0.54));
    strokes.push(mkStroke([{ x: dir * mw * 0.8, y: deckTop }, apex], lw, color, 0.46, 0.54));

    // luffing jib: lattice boom angled up from a pivot at the cab
    var alpha = R(0.66, 0.96);                       // 38°–55°
    var J = H * R(0.72, 1.0);
    var pivot = { x: dir * frontLen * 0.75, y: deckTop - mw * 0.2 };
    var tip = {
      x: pivot.x + dir * Math.cos(alpha) * J,
      y: pivot.y - Math.sin(alpha) * J
    };
    var px = Math.sin(alpha) * mw * 0.32, py = Math.cos(alpha) * mw * 0.32; // boom half-thickness
    var chordA = [{ x: pivot.x - dir * px, y: pivot.y - py }, tip];
    var chordB = [{ x: pivot.x + dir * px, y: pivot.y + py }, tip];
    var JIB0 = 0.52, JIB1 = 0.72;
    strokes.push(mkStroke(chordA, lw, color, JIB0, JIB1));
    strokes.push(mkStroke(chordB, lw, color, JIB0, JIB1));
    // boom bracing zigzag
    var bCells = Math.max(3, Math.round(J / (mw * 1.25)));
    var zig = [];
    for (i = 0; i <= bCells; i++) {
      var f = i / bCells;
      var top = i % 2 === 0;
      var sq = 1 - f * 0.85;                         // taper toward the tip
      zig.push({
        x: lerp(pivot.x, tip.x, f) + (top ? -1 : 1) * dir * px * sq,
        y: lerp(pivot.y, tip.y, f) + (top ? -1 : 1) * py * sq
      });
    }
    strokes.push(mkStroke(zig, thin, color, JIB0 + 0.02, JIB1 + 0.03));

    // pendant cables: apex → mid-boom, apex → tip, apex → counter end
    var mid = { x: lerp(pivot.x, tip.x, 0.55), y: lerp(pivot.y, tip.y, 0.55) };
    strokes.push(mkStroke([apex, mid], thin, ink, 0.7, 0.78));
    strokes.push(mkStroke([apex, tip], thin, ink, 0.72, 0.8));
    strokes.push(mkStroke([apex, { x: -dir * counterLen * 0.9, y: deckTop }], thin, ink, 0.7, 0.76));

    // hoist line: from the tip down to a hook (sometimes carrying a load)
    var tipDrop = -tip.y;                            // height of the tip above ground
    var cable = {
      x: tip.x, y: tip.y,
      len: tipDrop * R(0.35, 0.68),
      hook: mw * 0.55,
      load: R.chance(0.35) ? { w: mw * R(1.4, 2.2), h: mw * R(0.5, 0.8) } : null,
      phi: R(0, TAU),
      t0: 0.8, t1: 0.96
    };

    // nameplate on the deck
    var label = null;
    if (o.labels.length && mw >= 6 && R.chance(0.75)) {
      label = {
        text: R.pick(o.labels),
        x: dir > 0 ? (frontLen - counterLen) / 2 - cabW * 0.4 : (counterLen - frontLen) / 2 + cabW * 0.4,
        y: deckTop + deckH / 2,
        size: Math.max(4, mw * 0.72),
        t0: 0.5, t1: 0.6
      };
    }

    // horizontal extents for overlap-free packing
    var jibSide = Math.max(Math.abs(tip.x) + mw, frontLen + cabW);
    var counterSide = counterLen + mw * 1.5;
    var dur = R(0.55, 0.7);
    return {
      strokes: strokes, rects: rects, cable: cable, label: label,
      ink: ink, dir: dir, mw: mw,
      left: dir > 0 ? counterSide : jibSide,
      right: dir > 0 ? jibSide : counterSide,
      topReach: tipDrop + mw * 2,
      delay: 0, dur: dur
    };
  }

  function drawCrane(ctx, c, lt, sway) {
    var i;
    for (i = 0; i < c.strokes.length; i++) {
      var s = c.strokes[i];
      drawStroke(ctx, s, phase(lt, s.t0, s.t1));
    }
    for (i = 0; i < c.rects.length; i++) {
      var r = c.rects[i];
      drawRect(ctx, r, easeOutBack(phase(lt, r.t0, r.t1)));
    }
    if (c.label) {
      var g = phase(lt, c.label.t0, c.label.t1);
      if (g > 0) {
        ctx.save();
        ctx.globalAlpha = g;
        ctx.fillStyle = c.ink;
        ctx.font = c.label.size + 'px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.label.text, c.label.x, c.label.y);
        ctx.restore();
      }
    }
    // hoist line, hook and load — with a gentle pendulum sway when idling
    var ct = phase(lt, c.cable.t0, c.cable.t1);
    if (ct > 0) {
      var len = c.cable.len * easeOutCubic(ct);
      var theta = sway * Math.sin(c.cable.phi);
      var hx = c.cable.x + Math.sin(theta) * len;
      var hy = c.cable.y + Math.cos(theta) * len;
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = Math.max(0.8, c.mw * 0.09);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c.cable.x, c.cable.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      var hg = phase(lt, c.cable.t1 - 0.04, 1);
      if (hg > 0) {
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(theta);
        ctx.scale(hg, hg);
        if (c.cable.load) {
          ctx.fillStyle = c.ink;
          ctx.fillRect(-c.cable.load.w / 2, c.cable.hook * 0.4, c.cable.load.w, c.cable.load.h);
        } else {
          ctx.beginPath();                       // J-shaped hook
          ctx.arc(0, c.cable.hook * 0.55, c.cable.hook * 0.5, -Math.PI / 2, Math.PI * 0.75);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  /* ---------------- the site ---------------- */

  function CraneField(target, opts) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('Cranes: target element not found');
    this.el = el;
    this.o = {};
    var defaults = CraneField.defaults;
    for (var k in defaults) this.o[k] = (opts && opts[k] !== undefined) ? opts[k] : defaults[k];
    if (this.o.reach == null) this.o.reach = Math.ceil(this.o.size[1] * this.o.scale * 2.0 + 24);

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

  CraneField.defaults = {
    count: 3,              // requested cranes; fewer are placed if they'd clutter
    edges: ['top'],        // which edges cranes stand on
    minGap: 16,            // guaranteed clear px between crane footprints
    size: [55, 115],       // min/max mast height in px
    scale: 1,
    inset: 10,
    reach: null,           // canvas margin around the element (auto if null)
    colors: STRUCTURE,
    ink: '#5a646f',        // cables, hooks, pads — a mid grey visible on light & dark
    labels: [],            // nameplates painted on some decks, e.g. ['FABCO']
    seed: null,
    duration: 3200,
    animate: true,
    autoplay: true,
    whenVisible: false,
    trigger: null,         // 'load' | 'visible' | 'hover' | 'manual'
    idle: false,           // keep hooks gently swaying after assembly
    zIndex: 1
  };

  CraneField.prototype.refresh = function () {
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

  CraneField.prototype.generate = function () {
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
    this.cranes = [];
    this.placed = 0;

    // deal the requested count across edges round-robin, then pack each edge
    var perEdge = {};
    var e, i;
    for (i = 0; i < o.edges.length; i++) perEdge[o.edges[i]] = 0;
    for (i = 0; i < o.count; i++) perEdge[o.edges[i % o.edges.length]]++;

    for (var name in perEdge) {
      e = lines[name];
      if (!e) continue;
      var L = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
      var usable = L - 2 * o.inset;

      var group = [];
      for (i = 0; i < perEdge[name]; i++) group.push(buildCrane(R, o));
      // drop cranes until the row fits with clear air between footprints
      var width = function (c) { return c.left + c.right; };
      var total = function () {
        var t = 0;
        for (var j = 0; j < group.length; j++) t += width(group[j]);
        return t + Math.max(0, group.length - 1) * o.minGap;
      };
      while (group.length && total() > usable) group.pop();
      if (!group.length) continue;

      // spread the leftover slack into random gaps (including both ends)
      var slack = usable - total();
      var weights = [], sum = 0;
      for (i = 0; i <= group.length; i++) { var q = R(0.2, 1); weights.push(q); sum += q; }
      var cursor = o.inset + (slack * weights[0]) / sum;
      var theta = e.a + Math.PI / 2;
      for (i = 0; i < group.length; i++) {
        var c = group[i];
        var along = (cursor + c.left) / L;
        c.bx = lerp(e.x0, e.x1, along);
        c.by = lerp(e.y0, e.y1, along);
        c.theta = theta;
        c.delay = R() * (1 - c.dur);
        this.cranes.push(c);
        cursor += width(c) + o.minGap + (slack * weights[i + 1]) / sum;
      }
      this.placed += group.length;
    }
  };

  CraneField.prototype.draw = function (now) {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    var sway = 0;
    if (this.o.idle && this.progress >= 1 && now !== undefined) {
      sway = 0.05 * Math.sin(now * 0.0013);
    }
    for (var i = 0; i < this.cranes.length; i++) {
      var c = this.cranes[i];
      var lt = clamp01((this.progress - c.delay) / c.dur);
      if (lt <= 0) continue;
      ctx.save();
      ctx.translate(c.bx, c.by);
      ctx.rotate(c.theta);
      drawCrane(ctx, c, lt, sway);
      ctx.restore();
    }
  };

  CraneField.prototype._reduced = function () {
    return typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  CraneField.prototype._idleLoop = function () {
    var self = this;
    var tick = function (now) {
      self.draw(now);
      self.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };

  CraneField.prototype.animateTo = function (target, ms) {
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

  CraneField.prototype.play = function () {
    this.progress = 0;
    return this.animateTo(1, this.o.duration);
  };

  CraneField.prototype.assemble = function () {
    return this.animateTo(1, this.o.duration * (1 - this.progress));
  };

  CraneField.prototype.dismantle = function () {
    return this.animateTo(0, this.o.duration * 0.5 * this.progress);
  };

  CraneField.prototype.finish = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.progress = 1;
    this.draw();
    return this;
  };

  CraneField.prototype.rebuild = function (seed) {
    this.seed = seed == null ? Math.floor(Math.random() * 1e9) : seed;
    this.generate();
    return this.play();
  };

  CraneField.prototype.clear = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.progress = 0;
    this.ctx.clearRect(0, 0, this.w, this.h);
    return this;
  };

  CraneField.prototype.destroy = function () {
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
  CraneField.prototype.regrow = CraneField.prototype.rebuild;

  return {
    build: function (target, opts) { return new CraneField(target, opts); },
    Field: CraneField,
    palettes: { structure: STRUCTURE }
  };
});
