/*!
 * heli.js — a little doodle Bell 412 hovering above things.
 * Companion renderer to flowers.js, cranes.js and kites.js.
 *
 *   const pad = Heli.hover('#launch-button');
 *   pad.refly();     // new livery, fly in again
 *   pad.destroy();   // remove
 *
 * The helicopter flies in from the side, hovers above the element for a
 * moment (gentle bob, four-blade main rotor and tail rotor turning),
 * then descends, sets down on its skids and spools the rotors to a stop
 * (set `landAfter: false` to keep hovering instead). `count` can place
 * more than one, packed with clear air between rotor discs like the
 * other renderers.
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.Heli = factory();
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
    return R;
  }

  /* ---------------- palette & helpers ---------------- */

  var LIVERIES = ['#c93a35', '#3f8fd2', '#f2b83d', '#4fae6c', '#7a8a4a', '#8a94a8'];
  var ACCENTS = ['#f4f4f1', '#f2b83d', '#c93a35', '#33415c'];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ---------------- helicopter drawing ----------------
     Local frame: main-rotor hub at (0,0), +y down, nose toward `fc`
     (facing: +1 right / -1 left). F is overall fuselage length. */

  // rot: accumulated rotor angle; spin: rotor speed 0 (stopped) … 1 (flight);
  // fwd: forward-flight factor 0 (hover) … 1 (full transit speed)
  function drawHeli(ctx, u, rot, spin, fwd) {
    var F = u.F, fc = u.facing, ink = u.ink;
    var lw = Math.max(1, F * 0.018);
    var fx = function (x) { return x * fc; };
    ctx.lineWidth = lw;
    ctx.strokeStyle = ink;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var roofY = F * 0.075;                                 // cabin roof below the hub

    // short deep cabin, long slim boom — 412 proportions
    ctx.beginPath();
    ctx.moveTo(fx(F * 0.13), roofY);                       // windscreen top
    ctx.quadraticCurveTo(fx(F * 0.25), roofY + F * 0.015, fx(F * 0.27), roofY + F * 0.1);  // blunt nose
    ctx.quadraticCurveTo(fx(F * 0.27), roofY + F * 0.19, fx(F * 0.15), roofY + F * 0.21);  // chin
    ctx.lineTo(fx(-F * 0.06), roofY + F * 0.21);           // belly
    ctx.lineTo(fx(-F * 0.13), roofY + F * 0.115);          // cabin rear taper
    ctx.lineTo(fx(-F * 0.63), roofY + F * 0.055);          // boom underside
    ctx.lineTo(fx(-F * 0.63), roofY + F * 0.015);          // tail end
    ctx.lineTo(fx(-F * 0.12), roofY + F * 0.012);          // boom topside, level
    ctx.closePath();
    ctx.fillStyle = u.body;
    ctx.fill();
    ctx.stroke();

    // accent stripe along the cabin
    ctx.save();
    ctx.clip();
    ctx.fillStyle = u.accent;
    ctx.fillRect(fx(-F * 0.65) - (fc > 0 ? 0 : F * 1.0), roofY + F * 0.15, F * 1.0, F * 0.03);
    ctx.restore();

    // tall swept fin, tail rotor mounted high; small tail skid below
    ctx.beginPath();
    ctx.moveTo(fx(-F * 0.54), roofY + F * 0.013);
    ctx.lineTo(fx(-F * 0.695), roofY - F * 0.19);
    ctx.lineTo(fx(-F * 0.64), roofY + F * 0.015);
    ctx.closePath();
    ctx.fillStyle = u.accent;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fx(-F * 0.585), roofY + F * 0.05);
    ctx.lineTo(fx(-F * 0.625), roofY + F * 0.095);
    ctx.stroke();
    var trX = fx(-F * 0.70), trY = roofY - F * 0.135, trR = F * 0.105;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(trX, trY, trR, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    var tp = rot * 2.2 + 0.7;
    ctx.beginPath();
    ctx.moveTo(trX + Math.cos(tp) * trR, trY + Math.sin(tp) * trR);
    ctx.lineTo(trX - Math.cos(tp) * trR, trY - Math.sin(tp) * trR);
    ctx.stroke();

    // horizontal stabilizer
    ctx.beginPath();
    ctx.moveTo(fx(-F * 0.50), roofY + F * 0.033);
    ctx.lineTo(fx(-F * 0.40), roofY + F * 0.033);
    ctx.stroke();

    // steep windscreen + cabin windows (cockpit door + sliding door)
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(fx(F * 0.135), roofY + F * 0.012);
    ctx.lineTo(fx(F * 0.225), roofY + F * 0.04);
    ctx.lineTo(fx(F * 0.195), roofY + F * 0.115);
    ctx.lineTo(fx(F * 0.115), roofY + F * 0.075);
    ctx.closePath();
    ctx.fill();
    var wy = roofY + F * 0.045, ws = F * 0.085;
    ctx.fillRect(fx(F * 0.055) - ws / 2, wy, ws, ws * 0.75);
    ctx.fillRect(fx(-F * 0.05) - ws / 2, wy, ws, ws * 0.75);
    ctx.globalAlpha = 1;
    ctx.beginPath();                                       // sliding-door seam
    ctx.moveTo(fx(F * 0.005), roofY + F * 0.035);
    ctx.lineTo(fx(F * 0.005), roofY + F * 0.195);
    ctx.stroke();

    // long engine cowling with exhaust stub, then the rotor mast
    ctx.fillStyle = u.body;
    ctx.beginPath();
    ctx.moveTo(fx(F * 0.08), roofY);
    ctx.quadraticCurveTo(fx(F * 0.04), roofY - F * 0.052, fx(-F * 0.03), roofY - F * 0.052);
    ctx.lineTo(fx(-F * 0.16), roofY - F * 0.045);
    ctx.quadraticCurveTo(fx(-F * 0.20), roofY - F * 0.04, fx(-F * 0.21), roofY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = ink;
    ctx.fillRect(fx(-F * 0.235) - (fc > 0 ? 0 : F * 0.045), roofY - F * 0.038, F * 0.045, F * 0.02);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(0, roofY - F * 0.052);
    ctx.lineTo(0, 0);
    ctx.stroke();

    // registration on the boom
    if (u.label) {
      ctx.fillStyle = ink;
      ctx.font = Math.max(4, F * 0.042) + 'px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(u.label, fx(-F * 0.30), roofY + F * 0.045);
    }

    // skids
    ctx.beginPath();
    ctx.moveTo(fx(F * 0.09), roofY + F * 0.21);
    ctx.lineTo(fx(F * 0.11), roofY + F * 0.315);
    ctx.moveTo(fx(-F * 0.04), roofY + F * 0.21);
    ctx.lineTo(fx(-F * 0.06), roofY + F * 0.315);
    ctx.moveTo(fx(-F * 0.15), roofY + F * 0.315);
    ctx.lineTo(fx(F * 0.20), roofY + F * 0.315);
    ctx.quadraticCurveTo(fx(F * 0.25), roofY + F * 0.305, fx(F * 0.255), roofY + F * 0.26);
    ctx.stroke();

    // four-blade main rotor: blades projected side-on, plus a blur disc
    // that fades out as the rotor spools down; stopped blades droop more
    var R0 = F * 0.46;
    if (spin > 0.04) {
      ctx.globalAlpha = 0.22 * spin;
      ctx.beginPath();
      ctx.ellipse(0, -F * 0.005, R0, F * 0.03, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    var mp = rot + 0.55;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.6, F * 0.03), 0, TAU);        // hub
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.lineWidth = Math.max(1, F * 0.016);
    // spinning blades cone slightly upward under lift; as the rotor slows
    // the lift goes and they sag below horizontal, bending toward the tips.
    // In forward flight the blade out over the nose runs straight while the
    // one trailing over the boom keeps its flap; symmetric again in the hover.
    var coneS = 0.05 * spin - 0.09 * (1 - spin);
    for (var k = 0; k < 4; k++) {
      var bx = Math.cos(mp + k * Math.PI / 2) * R0;
      if (spin > 0.25 && Math.abs(bx) < R0 * 0.12) continue;  // blade pointing at the viewer
      var cone = (bx * fc > 0) ? coneS * (1 - (fwd || 0)) : coneS;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(bx * 0.55, -Math.abs(bx) * cone * 0.2, bx, -Math.abs(bx) * cone);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- the pad ---------------- */

  function HeliField(target, opts) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('Heli: target element not found');
    this.el = el;
    this.o = {};
    var defaults = HeliField.defaults;
    for (var k in defaults) this.o[k] = (opts && opts[k] !== undefined) ? opts[k] : defaults[k];
    if (this.o.reach == null) {
      this.o.reach = Math.ceil((this.o.altitude[1] + this.o.size[1] * 0.35) * this.o.scale + 26);
    }

    this.seed = this.o.seed == null ? Math.floor(Math.random() * 1e9) : this.o.seed;
    this.progress = 0;
    this.raf = null;
    // flight state: 'flight' | 'hover' | 'descend' | 'spool' | 'parked' | 'spoolup' | 'ascend'
    this.stage = 'flight';
    this._rot = 0;         // accumulated rotor angle
    this._spin = 1;        // rotor speed 0…1
    this._desc = 0;        // descent 0 (hover height) … 1 (skids down)
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
    this.trigger = trig;
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

  HeliField.defaults = {
    count: 1,              // helicopters; extras are packed, never overlapped
    facing: 'random',      // 'left' | 'right' | 'random'
    minGap: 18,            // guaranteed clear px between rotor discs
    size: [58, 88],        // min/max fuselage length in px
    altitude: [42, 68],    // hover height above the element, px
    scale: 1,
    inset: 6,
    reach: null,           // canvas margin around the element (auto if null)
    colors: LIVERIES,
    accents: ACCENTS,
    ink: '#5a646f',        // rotors, skids, windows — visible on light & dark
    labels: [],            // registration painted on the boom, e.g. ['G-MEGN']
    seed: null,
    duration: 2400,        // fly-in ms
    animate: true,
    autoplay: true,
    whenVisible: false,
    trigger: null,         // 'load' | 'visible' | 'hover' | 'manual'
    idle: true,            // bob while hovering + spinning rotors
    landAfter: 2600,       // hover this long (ms) then land; false = hover forever
    landDuration: 1900,    // descent ms
    downwash: true,        // faint draft lines under the skids
    zIndex: 1
  };

  HeliField.prototype.refresh = function () {
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

  HeliField.prototype.generate = function () {
    var R = makeRand(this.seed);
    var o = this.o;
    var m = o.reach;
    var w = this.el.offsetWidth;
    this.units = [];
    this.placed = 0;

    // build, then pack left-to-right above the top edge
    var group = [];
    var i;
    for (i = 0; i < o.count; i++) {
      var F = R(o.size[0], o.size[1]) * o.scale;
      var body = R.pick(o.colors);
      var accent = R.pick(o.accents);
      if (accent === body) accent = '#f4f4f1';
      var fdir = R.sign();                                  // always consumed: keeps seeds stable
      if (o.facing === 'left') fdir = -1;
      else if (o.facing === 'right') fdir = 1;
      group.push({
        F: F, body: body, accent: accent, ink: o.ink,
        facing: fdir,
        alt: R(o.altitude[0], o.altitude[1]) * o.scale,
        label: o.labels.length && F > 55 && R.chance(0.8) ? R.pick(o.labels) : null,
        phi: R(0, TAU),
        span: F * 1.1,
        dur: R(0.6, 0.8)
      });
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
      var u = group[i];
      u.hx = m + cursor + u.span / 2;                       // hover point, canvas coords
      u.hy = m - u.alt;
      u.sx = u.hx - u.facing * (this.w * 0.5 + u.F);        // fly-in start, offscreen
      u.sy = u.hy - u.F * 0.4;
      u.delay = R() * (1 - u.dur);
      this.units.push(u);
      cursor += u.span + o.minGap + (slack * weights[i + 1]) / sum;
    }
    this.placed = group.length;
  };

  HeliField.prototype.draw = function (now) {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    var animOn = this.o.animate && !this._reduced();
    var descE = easeInOut(this._desc);
    // bob fades out on the way down, resumes on the way back up
    var bobF = (this.o.idle && animOn && this.progress >= 1) ? 1 - descE : 0;
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      var lt = clamp01((this.progress - u.delay) / u.dur);
      if (lt <= 0) continue;
      var f = easeInOut(lt);
      // quadratic path from offscreen start to the hover point
      var cx2 = lerp(u.sx, u.hx, 0.75), cy2 = u.sy;
      var g = 1 - f;
      var x = g * g * u.sx + 2 * g * f * cx2 + f * f * u.hx;
      var y = g * g * u.sy + 2 * g * f * cy2 + f * f * u.hy;
      // thrust-vector pitch: nose-down while accelerating out, swinging
      // nose-UP through the deceleration to brake, level at zero groundspeed
      var sp = Math.sin(TAU * f);
      var pitch = -u.facing * (sp > 0 ? 0.12 * sp : 0.2 * sp);
      // descent: hover height down to skids-on-the-roof, with a nose-up flare
      var landY = this.o.reach - u.F * 0.39;
      y += (landY - u.hy) * descE;
      pitch -= u.facing * 0.05 * Math.sin(Math.PI * descE);
      if (bobF > 0 && now !== undefined) {
        // a hover is never still: layered drift on several frequencies,
        // like a pilot holding station with constant small corrections
        var tb = now * 0.001, ph = u.phi;
        y += (Math.sin(tb * 1.6 + ph) * 0.5 + Math.sin(tb * 2.9 + ph * 2.1) * 0.28 +
              Math.sin(tb * 0.7 + ph * 3.3) * 0.42) * u.F * 0.032 * bobF;
        x += (Math.sin(tb * 0.9 + ph * 1.7) * 0.6 + Math.sin(tb * 2.2 + ph * 0.6) * 0.4) * u.F * 0.028 * bobF;
        pitch += (Math.sin(tb * 1.3 + ph) * 0.6 + Math.sin(tb * 3.1 + ph * 2.4) * 0.4) * 0.02 * bobF;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(pitch);
      // blade flapping follows airspeed, which peaks mid-transit
      drawHeli(ctx, u, this._rot + u.phi, this._spin, Math.sin(Math.PI * f));
      ctx.restore();

      // downwash: draft arcs under the skids, dying away with the rotor
      if (this.o.downwash && lt > 0.9 && this._spin > 0.05) {
        var wy = this.o.reach - 6;
        var amp = (now !== undefined ? 0.14 + 0.08 * Math.sin(now * 0.004 + u.phi) : 0.16) * this._spin;
        ctx.save();
        ctx.globalAlpha = amp * (lt - 0.9) * 10;
        ctx.strokeStyle = u.ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(u.hx - u.F * 0.18, wy, u.F * 0.1, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(u.hx + u.F * 0.16, wy, u.F * 0.08, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  HeliField.prototype._reduced = function () {
    return typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  // runs everything after arrival: hover timer, descent, rotor spool, takeoff
  HeliField.prototype._liveLoop = function () {
    var self = this;
    var o = this.o;
    var last = null;
    var tick = function (now) {
      var dt = last == null ? 16.7 : Math.min(50, now - last);
      last = now;
      self._rot += dt * 0.021 * self._spin;
      var t;
      if (self.stage === 'hover') {
        if (self._t0 == null) self._t0 = now;
        if (o.landAfter && now - self._t0 >= o.landAfter) {
          self.stage = 'descend';
          self._t0 = now;
        } else if (!o.landAfter && !o.idle) {
          self.draw(now);
          self.raf = null;
          return;
        }
      } else if (self.stage === 'descend') {
        t = clamp01((now - self._t0) / o.landDuration);
        self._desc = t;
        if (t >= 1) { self.stage = 'spool'; self._t0 = now; }
      } else if (self.stage === 'spool') {
        t = clamp01((now - self._t0) / 2400);
        self._spin = 1 - t;
        if (t >= 1) {
          self._spin = 0;
          self.stage = 'parked';
          self.draw(now);
          self.raf = null;                                  // engine off: stop burning frames
          return;
        }
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

  HeliField.prototype.animateTo = function (target, ms) {
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
      self._rot += 0.35;                                    // rotors turn during flight too
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

  HeliField.prototype.play = function () {
    this.progress = 0;
    this.stage = 'flight';
    this._desc = 0;
    this._spin = 1;
    this._t0 = null;
    return this.animateTo(1, this.o.duration);
  };

  HeliField.prototype.arrive = function () {
    if (this.stage === 'parked' || this.stage === 'spool') return this.takeoff();
    return this.animateTo(1, this.o.duration * (1 - this.progress));
  };

  HeliField.prototype.depart = function () {
    this.stage = 'flight';
    this._desc = 0;
    this._spin = 1;
    return this.animateTo(0, this.o.duration * 0.6 * this.progress);
  };

  // touch down now (from a hover) / lift back off (when parked)
  HeliField.prototype.land = function () {
    if (this.progress >= 1 && (this.stage === 'hover' || this.stage === 'ascend')) {
      this.stage = 'descend';
      this._t0 = performance.now();
      this._liveLoop();
    }
    return this;
  };

  HeliField.prototype.takeoff = function () {
    if (this.stage === 'parked' || this.stage === 'spool') {
      this.stage = 'spoolup';
      this._t0 = performance.now();
      this._liveLoop();
    }
    return this;
  };

  HeliField.prototype.finish = function () {
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
      if ((this.o.idle) && this.o.animate && !this._reduced()) this._liveLoop();
    }
    return this;
  };

  HeliField.prototype.refly = function (seed) {
    this.seed = seed == null ? Math.floor(Math.random() * 1e9) : seed;
    this.generate();
    return this.play();
  };

  HeliField.prototype.clear = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.progress = 0;
    this.stage = 'flight';
    this._desc = 0;
    this._spin = 1;
    this.ctx.clearRect(0, 0, this.w, this.h);
    return this;
  };

  HeliField.prototype.destroy = function () {
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

  // regrow alias, for symmetry with the rest of the family
  HeliField.prototype.regrow = HeliField.prototype.refly;

  return {
    hover: function (target, opts) { return new HeliField(target, opts); },
    Field: HeliField,
    palettes: { liveries: LIVERIES, accents: ACCENTS }
  };
});
