# flowers.js 🌸

Algorithmic doodle flowers that grow around the edges of DOM elements —
curvy stems, curly tendrils, leaves, and a mix of little bloom shapes
(daisies, buds, starbursts, clusters), animated growing out of whichever
edges you choose. Zero dependencies, one file, ~11 kB unminified.

**Live demo:** https://doodles.spotspot.workers.dev/ (or open `index.html` locally).

## Usage

```html
<script src="flowers.js"></script>
<script>
  const field = Flowers.grow('#card', {
    edges: ['top', 'bottom', 'left', 'right'],
    density: 1,
  });
</script>
```

`Flowers.grow(target, options)` accepts a selector string or an element.
It inserts an absolutely-positioned overlay `<canvas>` inside the element
(pointer-events: none), so flowers track the element through layout
changes and scrolling. For several elements:
`document.querySelectorAll('.pretty').forEach(el => Flowers.grow(el))`.

## Options (all optional)

| option        | default                              | meaning |
|---------------|--------------------------------------|---------|
| `edges`       | `['top','bottom','left','right']`    | which edges sprout |
| `theme`       | none                                 | `'autumn'` (russet/gold), `'noir'` (greyscale), `'meadow'` (dense small wildflowers) — see `Flowers.themes` |
| `trigger`     | `'load'`                             | `'load'`, `'visible'` (grow when scrolled into view), `'hover'` (bloom on pointer-enter, wilt on leave), `'manual'` |
| `direction`   | `'out'`                              | `'out'` grows away from the element, `'in'` grows over it |
| `spacing`     | `42`                                 | average px between plants |
| `density`     | `1`                                  | multiplier — `2` ⇒ twice as many plants |
| `size`        | `[26, 78]`                           | min/max stem length, px |
| `scale`       | `1`                                  | overall size multiplier |
| `reach`       | auto                                 | canvas margin around the element, px |
| `petals` / `stems` / `centers` | built-in palettes   | arrays of `#rrggbb` colours |
| `seed`        | random                               | set for a reproducible arrangement |
| `duration`    | `2800`                               | grow animation, ms |
| `animate`     | `true`                               | `false` ⇒ render fully grown instantly |
| `whenVisible` | `false`                              | wait to grow until scrolled into view |
| `zIndex`      | `1`                                  | overlay canvas z-index |

Themes are just option bundles (colours and/or density); explicit options win
over the theme, which wins over the defaults. Add your own with
`Flowers.themes.mytheme = { petals: [...], stems: [...] }`.

## Field methods

- `field.regrow(seed?)` — new arrangement, replay the growth
- `field.bloom()` / `field.wilt()` — animate to grown / back to nothing (what `trigger: 'hover'` uses)
- `field.finish()` — jump to fully grown
- `field.clear()` — remove the flowers (keeps the field)
- `field.destroy()` — remove the canvas and observers

## cranes.js 🏗️

A companion renderer: little luffing-jib tower cranes (after another
notebook sketch) that assemble along edges — lattice mast rising first,
then the deck and cab, the angled jib, pendant cables, and finally the
hoist line dropping its hook. Same overlay-canvas approach, same API shape.

```html
<script src="cranes.js"></script>
<script>
  const site = Cranes.build('#hero', {
    count: 3,           // a request, not a promise — see below
    labels: ['FABCO'],  // nameplates painted on some decks
    idle: true,         // hooks keep gently swaying after assembly
  });
  site.rebuild();       // a new skyline
</script>
```

`count` is packed, never crowded: each crane's full footprint (jib reach
included) is laid out with at least `minGap` px of clear air, and if the
edge can't fit the requested number, fewer are placed — `site.placed`
tells you how many made it. No meadows of cranes.

Options shared with flowers: `edges` (default `['top']`), `size`
(mast height range, default `[55, 115]`), `scale`, `seed`, `duration`,
`animate`, `trigger` (including `'hover'`, which assembles on enter and
dismantles on leave), `zIndex`. Crane-specific: `count`, `minGap`,
`colors` (structure palette), `ink` (cables/hooks), `labels`, `idle`.

Methods: `rebuild(seed?)` (alias `regrow`), `assemble()`, `dismantle()`,
`finish()`, `clear()`, `destroy()`.

## kites.js 🪁

The third renderer: little stick-figure people flying kites. Each unit is
a figure leaning back against the pull (sometimes with a small companion
pointing at the sky), a sagging line, and a kite in one of four forms —
diamond, delta, box, or bird — in bright two-tone colours with a wavy,
bowed tail. One wind direction per field, so every kite leans the same way.

```html
<script src="kites.js"></script>
<script>
  const sky = Kites.fly('#park', { count: 3 });
  sky.relaunch();   // new flyers, new kites
</script>
```

Launching animates the figure appearing, the line paying out with the
kite riding it up, then the tail streaming. `idle: true` (the default for
kites) keeps kites bobbing and tails waving afterwards; set `idle: false`
for a still scene after launch.

`count` packs exactly like cranes.js — guaranteed `minGap` between unit
footprints (kite drift and tail included), fewer placed when they'd
clutter, actual number in `sky.placed`.

Options shared with the others: `edges` (default `['top']`), `size` (kite
altitude range, default `[60, 125]`), `scale`, `seed`, `duration`,
`animate`, `trigger` (`'hover'` launches on enter and reels the kite back
in on leave), `zIndex`. Kite-specific: `count`, `minGap`, `colors`, `ink`,
`idle`.

Methods: `relaunch(seed?)` (alias `regrow`), `launch()`, `land()`,
`finish()`, `clear()`, `destroy()`.

## heli.js 🚁

A little Bell 412 that hovers above things — made for sitting above a
button or a heading. Four-blade main rotor (it's a 412, not a two-blade
Huey), boxy cabin with sliding-door windows, engine cowling, slim high
tail boom with a swept fin and high-mounted tail rotor, and skids. It
flies in nose-down, flares nose-up to brake as it reaches the hover
(thrust vectored against the direction of travel, level again at zero
groundspeed), then holds a lively station — real helicopters never sit
still, so it wanders on layered frequencies in position and pitch — then
descends with a little nose-up flare, sets down on its skids, and spools
the rotors to a stop — the blur disc fades, the blades come to rest, and
the animation loop shuts off entirely (a parked helicopter costs no CPU).
Set `landAfter: false` to keep it hovering forever instead.

```html
<script src="heli.js"></script>
<script>
  const pad = Heli.hover('#launch-button', {
    facing: 'left',      // or 'right', 'random'
    labels: ['G-MEGN'],  // registration painted on the boom
  });
  pad.refly();           // fly in again with a new livery
</script>
```

Liveries come from a construction-adjacent palette (rescue red, utility
blue, survey yellow, olive, fleet grey) with an accent stripe and fin.
`count` defaults to 1; more are packed with clear air between rotor
discs like the other renderers (`pad.placed` reports the actual number).

Options shared with the others: `size` (fuselage length, default
`[58, 88]`), `scale`, `seed`, `duration`, `animate`, `trigger`
(`'hover'` flies in on enter and departs on leave), `zIndex`.
Heli-specific: `count`, `facing`, `altitude` (hover height, default
`[42, 68]`), `landAfter` (hover ms before landing, default `2600`;
`false` = hover forever), `landDuration` (descent ms, default `1900`),
`minGap`, `colors`, `accents`, `ink`, `labels`, `idle` (default true),
`downwash` (default true).

Methods: `refly(seed?)` (alias `regrow`), `arrive()`, `depart()`,
`land()` (touch down now), `takeoff()` (spool up and lift back to a
hover — with `landAfter` set it will land again after the hover),
`finish()`, `clear()`, `destroy()`.

## In three dimensions 🧊

Each renderer has a separate 3D sibling — same doodle style, same API
shape, one extra standalone file each, still zero dependencies. Instead
of a 3D library they carry a tiny hand-rolled engine: 3D geometry, a
fixed perspective camera (`yaw`, `tilt`, `perspective` options),
painter's-algorithm depth sorting, depth-faded ink, and backface shading
so folded surfaces read as lit and shadowed.

- **`flowers3d.js`** → `Flowers3D.grow(...)` — stems wander in real 3D,
  tendrils curl in tilted planes, petal fans face the camera, and the
  whole garden sways on a 3D breeze while idle.
- **`cranes3d.js`** → `Cranes3D.build(...)` — square lattice towers with
  braced faces and triangular lattice jibs that **slew**: each jib slowly
  rotates around its tower, hook sweeping through space (`slewSpeed`).
- **`kites3d.js`** → `Kites3D.fly(...)` — box kites are actual boxes,
  diamonds fold along their spine with a dihedral, and kites drift on a
  3D Lissajous breeze with wavy tails.
- **`heli3d.js`** → `Heli3D.hover(...)` — a box-model 412 that flies in,
  hovers while turning on the spot so you see every side (`turnSpeed`),
  then lands and spools down, turntable stopping with the rotor.

They share the 2D options (`edges`/`count`, `size`, `seed`, `trigger`,
`animate`, `idle`, packing guarantees) and the same methods, `regrow`
alias included. The 3D idle motion is what sells the depth, so `idle`
defaults to true everywhere; it still respects `prefers-reduced-motion`.

## Colophon 🗒️

This family of renderers was generated by Claude Fable (Anthropic's
Claude 5 model) in Claude Code, working from hand-drawn images in an old
meeting notebook: pencil flowers curling up a page margin, and a lattice
tower crane labelled "FABCO" doodled beside an October 2015 to-do list.
`flowers.js` and `cranes.js` come directly from those sketches (a real
Bell 412 photo tuned the helicopter); `kites.js` and `heli.js` were asked
for afterwards and drawn to match the same doodle style. The graph-paper
demo page is a nod to where it all started.

## Notes

- All renderers respect `prefers-reduced-motion` (final state, no animation).
- The target element gets `position: relative` if it was `static`.
- An `overflow: hidden` target will clip anything growing outward —
  put the field on a wrapper element instead.
