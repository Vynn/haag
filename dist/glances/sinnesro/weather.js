/*
  Overview Glance: the weather background. Cel-shaded scenes for Home
  Assistant's 15 weather conditions, in inline SVG animated with CSS; the
  random events (lightning, gusts, night visitors, the dragon) are timed
  here.

  Every condition uses one shared set of elements (sun, moon, stars, cloud
  slots, rain and snow sheets, …). A condition only says which are in and
  how they look, so a change moves each element from where it is.

  Scene units: 100 = the screen's shorter side. The square scene sits at
  0..100 on the center, its diagonal on the split (x + y = 100); on other
  shapes the sky and the drifting layers extend into the leftover strip,
  and the sun and moon keep to the screen's top-left corner.
  License: GPL-3.0
*/

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.append(n);
  return n;
};
// Seeded random for layouts (the same on every reload); Math.random for events.
const seeded = seed => (a, b) => { seed = (seed * 16807) % 2147483647; return a + (seed / 2147483647) * (b - a); };
const rnd = (a, b) => a + Math.random() * (b - a);
const f = v => v.toFixed(2);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const SLOW = () => reduced.matches ? 3 : 1;   // reduced motion: loops at a third of the speed

// Settled snow, 0 bare to 1 full. Registered on the document, since
// @property rules don't apply inside shadow DOM.
try { CSS.registerProperty({ name: '--wx-snow', syntax: '<number>', inherits: true, initialValue: '0' }); } catch { /* already registered */ }

/* ---------- What each condition uses ---------- */
const SCENES = {
  'none':            { clouds: {} },   // unknown or unavailable: plain sky
  'sunny':           { sun: 1, clouds: {} },
  'clear-night':     { moon: 1, stars: 2, clouds: {} },
  'partlycloudy':    { sun: 1, moon: 1, stars: 1, clouds: { f2: 'fair', f4: 'fair', b1: 'back' } },
  'cloudy':          { wash: 'cloudy', clouds: { f1: 'grey', f2: 'grey', f3: 'grey', f4: 'grey', f5: 'grey', b1: 'back-grey', b2: 'back-grey', b3: 'back-grey', b4: 'back-grey' } },
  'rainy':           { wash: 'rain', rain: 1, clouds: { f1: 'grey', f2: 'grey', f3: 'grey', f4: 'grey', b1: 'back-grey', b3: 'back-grey' } },
  'pouring':         { wash: 'pour', rain: 2, clouds: { f1: 'storm', f2: 'storm', f3: 'storm', f4: 'storm', f5: 'storm', b1: 'back-storm', b2: 'back-storm', b3: 'back-storm', b4: 'back-storm' } },
  'lightning':       { wash: 'storm', lightning: 1, clouds: { t1: 'storm', t2: 'storm', f1: 'storm', f3: 'storm', t3: 'back-storm', b2: 'back-storm', b4: 'back-storm' } },
  'lightning-rainy': { wash: 'storm', lightning: 1, rain: 1, clouds: { t1: 'storm', t2: 'storm', f1: 'storm', f3: 'storm', t3: 'back-storm', b2: 'back-storm', b4: 'back-storm' } },
  'exceptional':     { wash: 'exc', exc: 1, lightning: 1, fog: 'some', clouds: { f1: 'storm', b1: 'back-storm', b2: 'back-storm', t3: 'back-storm' } },
  'windy':           { sun: 1, moon: 1, stars: 1, wind: 1, clouds: {} },
  'windy-variant':   { sun: 1, moon: 1, stars: 1, wind: 1, clouds: { s1: 'fair', s2: 'fair', s3: 'back', s4: 'back' } },
  'fog':             { sun: 1, moon: 1, fog: 1, wash: 'fog', clouds: {} },
  'hail':            { wash: 'storm', hail: 1, clouds: { t1: 'storm', t2: 'storm', f1: 'storm', f3: 'storm', t3: 'back-storm', b2: 'back-storm' } },
  'snowy':           { wash: 'snow', snow: 'full', clouds: { f1: 'fair', f2: 'fair', f3: 'fair', b1: 'back', b3: 'back' } },
  'snowy-rainy':     { wash: 'rain', rain: 1, snow: 'mix', clouds: { f1: 'grey', f2: 'grey', f3: 'grey', b1: 'back-grey', b3: 'back-grey' } },
};

/* Cloud slots over the whole height of the outdoor side (the bottom isn't
   the ground). y = baseline in the square; s = scale; ph = phase. Each
   drifts from off the left edge to just past the split at its height;
   front clouds move faster than back ones. */
const SLOTS = [
  { id: 'f1', layer: 'front', kind: 'rolling',  s: .76, y: 22, ph: .05 },
  { id: 'f2', layer: 'front', kind: 'rolling',  s: .64, y: 38, ph: .45 },
  { id: 'f3', layer: 'front', kind: 'rolling',  s: .70, y: 54, ph: .75 },
  { id: 'f4', layer: 'front', kind: 'rolling',  s: .60, y: 70, ph: .25 },
  { id: 'f5', layer: 'front', kind: 'rolling',  s: .58, y: 84, ph: .60 },
  { id: 't1', layer: 'front', kind: 'towering', s: .78, y: 42, ph: .30 },
  { id: 't2', layer: 'front', kind: 'towering', s: .66, y: 68, ph: .85 },
  { id: 'b1', layer: 'back',  kind: 'rolling',  s: .54, y: 12, ph: .55 },
  { id: 'b2', layer: 'back',  kind: 'rolling',  s: .50, y: 28, ph: .15 },
  { id: 'b3', layer: 'back',  kind: 'rolling',  s: .52, y: 46, ph: .90 },
  { id: 'b4', layer: 'back',  kind: 'rolling',  s: .48, y: 62, ph: .40 },
  { id: 't3', layer: 'back',  kind: 'towering', s: .60, y: 28, ph: .65 },
  // Stratus: long, flat layers that move fast with the wind (windy-variant).
  { id: 's1', layer: 'front', kind: 'stratus',  s: .62, y: 30, ph: .20, spd: 3.4 },
  { id: 's2', layer: 'front', kind: 'stratus',  s: .55, y: 58, ph: .65, spd: 3.0 },
  { id: 's3', layer: 'back',  kind: 'stratus',  s: .48, y: 16, ph: .45, spd: 2.2 },
  { id: 's4', layer: 'back',  kind: 'stratus',  s: .50, y: 76, ph: .90, spd: 2.0 },
];
const SPEED = { front: 1.5, back: .9 };   // units per second

// Rolling cloud, drawn moving left: bumps shrink into a tapered tail on the right.
const ROLL = '<rect x="0" y="-14" width="84" height="14" rx="7"/><circle cx="20" cy="-21" r="19"/><circle cx="44" cy="-22" r="15"/><circle cx="63" cy="-16" r="11"/><circle cx="78" cy="-11" r="7"/><path d="M76 0C92 0 104 -3 114 -10C102 -7 90 -8 80 -14Z"/>';
// Underside: a slim, smooth band in the shadow tone along the flat bottom.
const UNDER = '<g class="us"><rect x="8" y="-3.4" width="70" height="3.4" rx="1.7"/></g>';
// Stratus: one main streak tapering into a long tail, a thin wisp above and below.
const STRATUS = '<path d="M0 -2.5C4 -7 30 -8.5 70 -8C110 -7.5 150 -5.5 182 -3C150 -1.5 100 -.5 60 -.3C30 -.2 2 .5 0 -2.5Z"/>'
  + '<path d="M40 -9.5C70 -13 120 -13 160 -10C130 -9 90 -8.5 40 -9.5Z"/>'
  + '<path d="M90 1.5C115 .2 150 .2 175 1C150 2.2 115 2.6 90 1.5Z"/>';
const TOWER = ROLL + '<circle cx="14" cy="-33" r="12"/><circle cx="28" cy="-44" r="15"/><circle cx="42" cy="-36" r="13"/><circle cx="30" cy="-58" r="11"/>';
// Rain streak: thicker and round at the leading (bottom) end, tapering up.
const streak = tail => `M-0.35 -${tail}L0.35 -${tail}L1.4 -1.2A1.4 1.4 0 0 1 -1.4 -1.2Z`;
const TAIL = { light: 36, heavy: 56 };

// Lit part of the moon (r = 13), northern hemisphere: waxing is lit on the right.
const R = 13;
const PHASES = {
  new_moon: '',
  waxing_crescent: `M0 -${R}A${R} ${R} 0 0 1 0 ${R}A${R / 2} ${R} 0 0 0 0 -${R}Z`,
  first_quarter:   `M0 -${R}A${R} ${R} 0 0 1 0 ${R}Z`,
  waxing_gibbous:  `M0 -${R}A${R} ${R} 0 0 1 0 ${R}A${R / 2} ${R} 0 0 1 0 -${R}Z`,
  full_moon:       `M0 -${R}A${R} ${R} 0 1 1 0 ${R}A${R} ${R} 0 1 1 0 -${R}Z`,
  waning_gibbous:  `M0 -${R}A${R} ${R} 0 0 0 0 ${R}A${R / 2} ${R} 0 0 0 0 -${R}Z`,
  last_quarter:    `M0 -${R}A${R} ${R} 0 0 0 0 ${R}Z`,
  waning_crescent: `M0 -${R}A${R} ${R} 0 0 0 0 ${R}A${R / 2} ${R} 0 0 1 0 -${R}Z`,
};

// Sun and moon height over the day, at a steady speed: a constant climb
// for most of the way, easing only near the top, and the same rate below
// the horizon. At rising and setting the body is centered just below the
// bottom edge, out of view about 45 minutes later. The peak sits 13 below
// the screen's top edge.
const HORIZON_Y = 110, PEAK_BELOW_TOP = 13;
const ease = u => u <= .6 ? 1.25 * u : .75 + 1.25 * (u - .6) - 1.5625 * (u - .6) ** 2;
const bodyAt = (t, [rise, peak, set], peakY) => {
  const span = HORIZON_Y - peakY, n = x => ((x % 24) + 24) % 24;
  const T = n(t - rise), P = n(peak - rise), S = n(set - rise);
  if (T <= S) return HORIZON_Y - span * ease(T <= P ? T / P : (S - T) / (S - P));
  const [dt, side] = T - S < 24 - T ? [T - S, S - P] : [24 - T, P];   // hours since setting, or until rising
  return Math.min(240, HORIZON_Y + span * 1.25 / side * dt);
};
// The moon mirrors the sun, offset so the two are never in view together.
const MOON_OFFSET = 1.6;                // hours after sunset, before sunrise
const BODY_SCALE = 2;                   // sun and moon drawings (radius 12 / 13) at 200%
const BODY_X = 13;                      // a quarter of the moon's width is cropped on the left

/* ---------- Wind: season, detritus, easter eggs ---------- */
// Meteorological seasons by calendar month, flipped for the southern hemisphere.
const seasonNow = south => {
  const n = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][new Date().getMonth()];
  return south ? { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' }[n] : n;
};
// [kind, color, shade]
const DETRITUS = {
  spring: [['petal', '#F4A7C0', '#D97FA0'], ['petal', '#FBEFF3', '#E4C9D3']],
  summer: [['leaf', '#7BB661', '#5E9447'], ['leaf', '#9CCB6E', '#7AAA52']],
  autumn: [['leaf', '#E59A3A', '#C47A22'], ['leaf', '#D4553A', '#AE3C26'], ['leaf', '#A86B3C', '#86512A']],
  winter: [['leaf', '#A88B6A', '#8A6F52'], ['needles', '#4F6B4A']],
};
const drawPiece = (g, [kind, c1, c2]) => {
  if (kind === 'leaf') {                     // almond leaf, lower half in shade, with a midrib
    svgEl('path', { d: 'M-2.5 0Q0 -1.8 2.5 0Q0 1.8 -2.5 0Z', fill: c2 }, g);
    svgEl('path', { d: 'M-2.5 0Q0 -1.8 2.5 0Z', fill: c1 }, g);
    svgEl('path', { d: 'M-2.3 0H2.3', stroke: c2, 'stroke-width': .2 }, g);
  } else if (kind === 'petal') {
    svgEl('path', { d: 'M0 0C1.2 -1.4 2.6 -1 2.6 0C2.6 1 1.2 1.4 0 0Z', fill: c1 }, g);
    svgEl('path', { d: 'M0 0C1.2 .7 2.2 .9 2.6 0C2.6 1 1.2 1.4 0 0Z', fill: c2 }, g);
  } else {                                   // a little cluster of pine needles
    for (const a of [-22, 0, 22]) svgEl('path', { d: 'M0 0H2.4', stroke: c1, 'stroke-width': .28, 'stroke-linecap': 'round', transform: `rotate(${a})` }, g);
    svgEl('circle', { r: .35, fill: '#7A5A3A' }, g);
  }
};
// Easter eggs: odd things that now and then blow through with a gust.
const EGGS = {
  kite(g) {
    svgEl('path', { d: 'M-4.5 4Q-7 6 -9 5Q-11 4 -13 6', fill: 'none', stroke: '#555', 'stroke-width': .2 }, g);
    for (const [x, y] of [[-7, 5.6], [-10.3, 4.6]]) svgEl('path', { d: `M${x} ${y}l.9 -.7l0 1.4Z`, fill: '#F2C14E' }, g);
    svgEl('path', { d: 'M0 -4L3 0L0 5L-3 0Z', fill: '#E8505B' }, g);
    svgEl('path', { d: 'M0 -4L3 0L0 5Z', fill: '#C93F49' }, g);
    svgEl('path', { d: 'M0 -4V5M-3 0H3', stroke: '#9E2F38', 'stroke-width': .2 }, g);
  },
  balloon(g) {
    svgEl('path', { d: 'M0 3.2Q-.8 5 .4 6.5Q1.4 8 .2 9.6', fill: 'none', stroke: '#555', 'stroke-width': .18 }, g);
    svgEl('ellipse', { rx: 2.4, ry: 3, fill: '#E8505B' }, g);
    svgEl('path', { d: 'M0 -3A2.4 3 0 0 1 0 3A1.4 3 0 0 0 0 -3Z', fill: '#C93F49' }, g);
    svgEl('ellipse', { cx: -1, cy: -1.3, rx: .5, ry: .8, fill: '#F7A2A8' }, g);
    svgEl('path', { d: 'M-.4 3.2L.4 3.2L0 2.6Z', fill: '#C93F49' }, g);
  },
  newspaper(g) {
    svgEl('rect', { x: -3.4, y: -2.4, width: 6.8, height: 4.8, fill: '#EEEAE0' }, g);
    svgEl('rect', { x: 0, y: -2.4, width: 3.4, height: 4.8, fill: '#DCD7CB' }, g);
    for (const y of [-1.6, -.6, .4, 1.4]) svgEl('rect', { x: -2.8, y, width: 2.2, height: .35, fill: '#A9A49A' }, g);
    svgEl('rect', { x: .6, y: -1.6, width: 2.2, height: 1.4, fill: '#A9A49A' }, g);
  },
  tincan(g) {
    svgEl('rect', { x: -1.4, y: -2.2, width: 2.8, height: 4.4, rx: .3, fill: '#B9C2CC' }, g);
    svgEl('rect', { x: .3, y: -2.2, width: 1.1, height: 4.4, fill: '#98A2AD' }, g);
    svgEl('rect', { x: -1.4, y: -.8, width: 2.8, height: 1.6, fill: '#D4553A' }, g);
    svgEl('ellipse', { cy: -2.2, rx: 1.4, ry: .45, fill: '#DDE3E8' }, g);
  },
  plane(g) {
    svgEl('path', { d: 'M-3.5 .8L4 0L-3.5 -1.6Z', fill: '#FFFFFF' }, g);
    svgEl('path', { d: 'M-3.5 .8L4 0L-2.2 0Z', fill: '#D8E0E8' }, g);
  },
  umbrella(g) {                              // blown inside out
    svgEl('path', { d: 'M0 -.6V4.2Q0 5 -.8 5', fill: 'none', stroke: '#333', 'stroke-width': .3, 'stroke-linecap': 'round' }, g);
    svgEl('path', { d: 'M-3.5 -2Q0 1.5 3.5 -2L2.6 -2.6Q0 .2 -2.6 -2.6Z', fill: '#3E6FB0' }, g);
    svgEl('path', { d: 'M0 -.6Q1.8 -1 3.5 -2L2.6 -2.6Q1.2 -1.2 0 -.9Z', fill: '#2F5690' }, g);
  },
};
// Things the tornado carries (the tin can and umbrella come from EGGS).
const EXCEPTIONAL_THINGS = {
  cow(g) {
    for (const x of [-2.2, -1.1, 1.2, 2.2]) svgEl('rect', { x: x - .3, y: .8, width: .6, height: 1.8, fill: '#E9E4D8' }, g);
    for (const x of [-2.2, -1.1, 1.2, 2.2]) svgEl('rect', { x: x - .3, y: 2.2, width: .6, height: .5, fill: '#3A3A3A' }, g);
    svgEl('path', { d: 'M-3 -1.2Q-3.9 -.4 -3.7 1', fill: 'none', stroke: '#3A3A3A', 'stroke-width': .25, 'stroke-linecap': 'round' }, g);
    svgEl('rect', { x: -3, y: -1.6, width: 6, height: 3.2, rx: 1.2, fill: '#F4F1EA' }, g);
    svgEl('rect', { x: -3, y: .2, width: 6, height: 1.4, rx: .7, fill: '#D9D3C6' }, g);
    svgEl('ellipse', { cx: -1.2, cy: -.6, rx: 1, ry: .7, fill: '#2A2A2A' }, g);
    svgEl('ellipse', { cx: 1.1, cy: .4, rx: .7, ry: .5, fill: '#2A2A2A' }, g);
    svgEl('rect', { x: 2.4, y: -2.4, width: 2.2, height: 1.9, rx: .7, fill: '#F4F1EA' }, g);
    svgEl('rect', { x: 3.4, y: -1.3, width: 1.4, height: 1, rx: .5, fill: '#E9A3A3' }, g);
    svgEl('path', { d: 'M2.8 -2.4l-.4 -.7M4 -2.4l.4 -.7', stroke: '#CFC6B4', 'stroke-width': .3, 'stroke-linecap': 'round' }, g);
    svgEl('circle', { cx: 3.3, cy: -1.8, r: .22, fill: '#2A2A2A' }, g);
  },
  dino(g) {                                  // a small, friendly T-rex
    svgEl('path', { d: 'M-4 1Q-6 0 -7.5 -1.5Q-5 -.5 -3 -1Q-1 -3 1.5 -2.5L3.8 -3.2Q5 -3 5 -2L4.2 -1.2L2.6 -1.4Q2.4 0 1.6 .6L2 3L1 3L.6 1L-1.2 1.2L-1 3L-2 3L-2.2 1.2Z', fill: '#6FA35A' }, g);
    svgEl('path', { d: 'M-4 1Q-2 1.6 -.6 1.1L-1.2 1.2L-2.2 1.2Z', fill: '#4E7D3E' }, g);
    svgEl('path', { d: 'M1.9 -.8l.8 .6', stroke: '#4E7D3E', 'stroke-width': .35, 'stroke-linecap': 'round' }, g);
    svgEl('circle', { cx: 3.3, cy: -2.5, r: .25, fill: '#1E2A18' }, g);
  },
};

// The dragon, facing right (+x): big bat wings with finger bones and a
// scalloped trailing edge, a long S-curved neck, a horned head with an
// open jaw, tucked legs and a curled tail. Bronze, gold and warm grey.
const MOUTH = [11.2, -3.5], BREATH_TILT = 30, BREATH_LEN = 11.6;
const drawDragon = g => {
  const BONE = '#5B4636', MEM = '#9C8C7A', MEM_FAR = '#6F6357', BODY = '#7A4A22', GOLD = '#C8923E', BELLY = '#D8B06A';
  const wing = (cls, fill, k, dx, dy) => {
    const flap = svgEl('g', { class: `wing ${cls}` }, svgEl('g', { transform: `translate(${dx} ${dy}) scale(${k})` }, g));
    svgEl('path', { d: 'M0 0L3 -9.6L-3 -17Q-4.6 -13 -9 -14Q-10 -9.4 -13 -8Q-11 -4.6 -12 -2.5Q-7 -2.2 -4 .6Z', fill }, flap);
    svgEl('path', { d: 'M0 0L3 -9.6M3 -9.6L-3 -17M3 -9.6L-9 -14M3 -9.6L-13 -8M3 -9.6L-12 -2.5M3 -9.6L4.4 -10.6', fill: 'none', stroke: BONE, 'stroke-width': .45, 'stroke-linecap': 'round' }, flap);
  };
  wing('far', MEM_FAR, .78, 1.6, -2.2);
  svgEl('path', { d: 'M-3.4 .4Q-8 2.6 -12 2Q-15 1.6 -15.4 -.6Q-15.4 -2.4 -13.6 -2.2Q-12.6 -2 -13 -1', fill: 'none', stroke: BODY, 'stroke-width': 1.2, 'stroke-linecap': 'round' }, g);
  svgEl('path', { d: 'M-1.6 1.4L-2.8 3.4L-1.6 3.6M2 1.2L3 2.9L4 2.8', fill: 'none', stroke: BODY, 'stroke-width': .7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  svgEl('ellipse', { cx: 0, cy: 0, rx: 4, ry: 2.1, fill: BODY }, g);
  svgEl('path', { d: 'M-3.4 .8Q0 2.6 3.6 .6Q0 1.5 -3.4 .8Z', fill: BELLY }, g);
  svgEl('path', { d: 'M2.6 -1.2Q5 -1.4 6 -3.4Q6.8 -5.2 8.6 -5.2L9 -3.8Q7.6 -3.6 7.2 -2.2Q6.4 .2 3.2 .8Z', fill: BODY }, g);
  svgEl('path', { d: 'M7.6 -5.9Q9.6 -6.4 11.2 -5Q11.8 -4.4 11.4 -4L9.6 -3.6Q8.4 -3.4 7.8 -4.2Z', fill: BODY }, g);
  svgEl('path', { d: 'M9.8 -3.7L11.4 -3.3L10 -2.9Z', fill: BODY }, g);
  svgEl('path', { d: 'M8 -6L6.4 -7.6L8.4 -6.4ZM8.8 -6.2L7.8 -8.2L9.4 -6.4Z', fill: GOLD }, g);
  svgEl('circle', { cx: 9.4, cy: -5, r: .28, fill: '#FFD447' }, g);
  svgEl('path', { d: 'M-3 -1.3Q0 -2.4 2.8 -1.6M3.4 -1.6Q5.6 -2.2 6.4 -4', fill: 'none', stroke: GOLD, 'stroke-width': .4, 'stroke-linecap': 'round' }, g);
  wing('', MEM, 1, 0, -1.2);
  // Fire from the open jaw, angled down: red, orange, then a brighter core.
  const breath = svgEl('g', { class: 'breath' }, svgEl('g', { transform: `translate(${MOUTH[0]} ${MOUTH[1]}) rotate(${BREATH_TILT})` }, g));
  svgEl('path', { d: 'M0 0Q4.5 -2.6 10.5 -1.2Q7 -.2 11.6 .8Q5.8 2 0 0Z', fill: '#D9381E' }, breath);
  svgEl('path', { d: 'M0 0Q3.6 -1.6 8 -.6Q5.6 0 8.6 .6Q4.2 1.3 0 0Z', fill: '#F26A1B' }, breath);
  svgEl('path', { d: 'M0 0Q2.4 -.8 5 -.2Q3.4 .2 5.4 .4Q2.6 .7 0 0Z', fill: '#F57A1F' }, breath);
  return breath.parentNode;
};
// A patch of the flame trail on the alert row: a glowing orange base with
// jagged tongues, deep red at the back and red-orange in front.
const TONGUE = 'M-1 0C-1.2 -1 -.6 -1.8 -.2 -3.4C.1 -2.4 .6 -2 .5 -1.4C1 -1.7 1.2 -2.2 1.3 -2.6C1.6 -1.6 1.3 -.6 1 0Z';
const drawFlamePatch = g => {
  svgEl('rect', { x: -3.2, y: -.5, width: 6.4, height: .7, rx: .35, fill: '#F26A1B' }, g);
  const tongue = (dx, k, fill) => {
    const at = svgEl('g', { transform: `translate(${dx} 0) scale(${k.toFixed(2)})` }, g);
    svgEl('path', { class: 'lick', d: TONGUE, fill, style: `--d:${(-Math.random() * .3).toFixed(2)}s` }, at);
  };
  for (const dx of [-1.8, 0, 1.8]) tongue(dx, rnd(.8, 1.35), '#C8281E');
  for (const dx of [-1, 1]) tongue(dx, rnd(.6, .9), '#E8481C');
};

// A thin wind streak (length 10), with a small upturned whoosh at the front.
const WSTREAK = 'M0 0Q5 -.7 8.6 -.45Q9.8 -.4 10 -1.5Q10.1 -.2 8.6 .25Q5 .5 0 0Z';

/* ---------- Styles ---------- */
export const WEATHER_STYLE = `
  /* Weather colors: night / day, mixed by Håg's --haag-daylight like the
     palette. Clouds: highlight / body / shadow for fair, grey and storm,
     and the smaller, bluer back layer. */
  .stage {
    --n-cf-hl: #4D5B7C;  --n-cf: #3B4868;  --n-cf-sh: #2B3654;   --d-cf-hl: #FFFFFF;  --d-cf: #EAF2F9;  --d-cf-sh: #BFD3E6;
    --n-cg-hl: #424E6A;  --n-cg: #333E58;  --n-cg-sh: #252E45;   --d-cg-hl: #F0F4F8;  --d-cg: #D8E0E8;  --d-cg-sh: #A9B8C8;
    --n-cs-hl: #323B55;  --n-cs: #252D44;  --n-cs-sh: #191F33;   --d-cs-hl: #A3AFC2;  --d-cs: #8692A8;  --d-cs-sh: #66728A;
    --n-cb-hl: #384468;  --n-cb: #2C3756;  --n-cb-sh: #222B47;   --d-cb-hl: #E9F3FC;  --d-cb: #D2E3F2;  --d-cb-sh: #ADC4DA;
    --n-cbg-hl: #343E59; --n-cbg: #29324B; --n-cbg-sh: #1F273C;  --d-cbg-hl: #DAE1E9; --d-cbg: #C2CCD7; --d-cbg-sh: #9FADBD;
    --n-cbs-hl: #29314A; --n-cbs: #1F263B; --n-cbs-sh: #171D2E;  --d-cbs-hl: #8F9BB0; --d-cbs: #76839A; --d-cbs-sh: #5C687F;
    /* Rain by depth, lightning, sky washes */
    --n-rain-far: #3A5274;  --d-rain-far: #A3C3DA;
    --n-rain-mid: #6A89B0;  --d-rain-mid: #C9E2F4;
    --n-rain-near: #A8C4E8; --d-rain-near: #EEF8FF;
    --n-bolt: #FFF3B0;      --d-bolt: #FFFBE6;
    --n-flash: #DDE6FF;     --d-flash: #FFFFFF;
    --n-w-cloudy: #0A0E1A;  --d-w-cloudy: #D5DEE8;
    --n-w-rain: #0A0E1A;    --d-w-rain: #A3B1C2;
    --n-w-pour: #070A14;    --d-w-pour: #8696A9;
    --n-w-storm: #05070F;   --d-w-storm: #5F7590;
    --n-w-snow: #2A3350;    --d-w-snow: #E6ECF2;
    /* Snow by depth, plus its shadow tone */
    --n-snow-far: #56657F;  --d-snow-far: #D6E2EE;
    --n-snow-mid: #8696B2;  --d-snow-mid: #ECF2F8;
    --n-snow-near: #C6D3E6; --d-snow-near: #FFFFFF;
    --n-snow-sh: #3B4964;   --d-snow-sh: #B4C8DC;
    /* Wind streaks; exceptional: tornado tones, the spider, a green storm wash; fog */
    --n-wind: #9FB4D2;      --d-wind: #FFFFFF;
    --n-tor-a: #46524B;     --d-tor-a: #B4BCB6;
    --n-tor-b: #3A443F;     --d-tor-b: #98A29C;
    --n-tor-hl: #5B675F;    --d-tor-hl: #D2D9D4;
    --n-kaiju: #10151F;     --d-kaiju: #3E4A5C;
    --n-w-exc: #0E1A14;     --d-w-exc: #5E7A64;
    --n-fog-light: #5D6A86; --d-fog-light: #EEF3F7;
    --n-fog-base: #46526C;  --d-fog-base: #D7E0E9;
    --n-w-fog: #2B3348;     --d-w-fog: #DDE5EC;
    /* Hail by depth, and its streak */
    --n-hail-far: #6E829F;  --d-hail-far: #B9CCDD;
    --n-hail-mid: #90A5C0;  --d-hail-mid: #D3E1EE;
    --n-hail-near: #B9C9DD; --d-hail-near: #EEF5FB;
    --n-hail-streak: #C9D6E8; --d-hail-streak: #FFFFFF;

    --wx-p: calc(var(--haag-daylight) * 100%);
    --cf-hl:  color-mix(in oklab, var(--d-cf-hl) var(--wx-p), var(--n-cf-hl));
    --cg-hl:  color-mix(in oklab, var(--d-cg-hl) var(--wx-p), var(--n-cg-hl));
    --cs-hl:  color-mix(in oklab, var(--d-cs-hl) var(--wx-p), var(--n-cs-hl));
    --cb-hl:  color-mix(in oklab, var(--d-cb-hl) var(--wx-p), var(--n-cb-hl));
    --cbg-hl: color-mix(in oklab, var(--d-cbg-hl) var(--wx-p), var(--n-cbg-hl));
    --cbs-hl: color-mix(in oklab, var(--d-cbs-hl) var(--wx-p), var(--n-cbs-hl));
    --cf:     color-mix(in oklab, var(--d-cf) var(--wx-p), var(--n-cf));
    --cf-sh:  color-mix(in oklab, var(--d-cf-sh) var(--wx-p), var(--n-cf-sh));
    --cg:     color-mix(in oklab, var(--d-cg) var(--wx-p), var(--n-cg));
    --cg-sh:  color-mix(in oklab, var(--d-cg-sh) var(--wx-p), var(--n-cg-sh));
    --cs:     color-mix(in oklab, var(--d-cs) var(--wx-p), var(--n-cs));
    --cs-sh:  color-mix(in oklab, var(--d-cs-sh) var(--wx-p), var(--n-cs-sh));
    --cb:     color-mix(in oklab, var(--d-cb) var(--wx-p), var(--n-cb));
    --cb-sh:  color-mix(in oklab, var(--d-cb-sh) var(--wx-p), var(--n-cb-sh));
    --cbg:    color-mix(in oklab, var(--d-cbg) var(--wx-p), var(--n-cbg));
    --cbg-sh: color-mix(in oklab, var(--d-cbg-sh) var(--wx-p), var(--n-cbg-sh));
    --cbs:    color-mix(in oklab, var(--d-cbs) var(--wx-p), var(--n-cbs));
    --cbs-sh: color-mix(in oklab, var(--d-cbs-sh) var(--wx-p), var(--n-cbs-sh));
    --rain-far:  color-mix(in oklab, var(--d-rain-far) var(--wx-p), var(--n-rain-far));
    --rain-mid:  color-mix(in oklab, var(--d-rain-mid) var(--wx-p), var(--n-rain-mid));
    --rain-near: color-mix(in oklab, var(--d-rain-near) var(--wx-p), var(--n-rain-near));
    --bolt:      color-mix(in oklab, var(--d-bolt) var(--wx-p), var(--n-bolt));
    --flash:     color-mix(in oklab, var(--d-flash) var(--wx-p), var(--n-flash));
    --w-cloudy:  color-mix(in oklab, var(--d-w-cloudy) var(--wx-p), var(--n-w-cloudy));
    --w-rain:    color-mix(in oklab, var(--d-w-rain) var(--wx-p), var(--n-w-rain));
    --w-pour:    color-mix(in oklab, var(--d-w-pour) var(--wx-p), var(--n-w-pour));
    --w-storm:   color-mix(in oklab, var(--d-w-storm) var(--wx-p), var(--n-w-storm));
    --w-snow:    color-mix(in oklab, var(--d-w-snow) var(--wx-p), var(--n-w-snow));
    --snow-far:  color-mix(in oklab, var(--d-snow-far) var(--wx-p), var(--n-snow-far));
    --snow-mid:  color-mix(in oklab, var(--d-snow-mid) var(--wx-p), var(--n-snow-mid));
    --snow-near: color-mix(in oklab, var(--d-snow-near) var(--wx-p), var(--n-snow-near));
    --snow-sh:   color-mix(in oklab, var(--d-snow-sh) var(--wx-p), var(--n-snow-sh));
    --wind:      color-mix(in oklab, var(--d-wind) var(--wx-p), var(--n-wind));
    --tor-a:     color-mix(in oklab, var(--d-tor-a) var(--wx-p), var(--n-tor-a));
    --tor-b:     color-mix(in oklab, var(--d-tor-b) var(--wx-p), var(--n-tor-b));
    --tor-hl:    color-mix(in oklab, var(--d-tor-hl) var(--wx-p), var(--n-tor-hl));
    --kaiju:     color-mix(in oklab, var(--d-kaiju) var(--wx-p), var(--n-kaiju));
    --w-exc:     color-mix(in oklab, var(--d-w-exc) var(--wx-p), var(--n-w-exc));
    --fog-light: color-mix(in oklab, var(--d-fog-light) var(--wx-p), var(--n-fog-light));
    --fog-base:  color-mix(in oklab, var(--d-fog-base) var(--wx-p), var(--n-fog-base));
    --w-fog:     color-mix(in oklab, var(--d-w-fog) var(--wx-p), var(--n-w-fog));
    --hail-far:  color-mix(in oklab, var(--d-hail-far) var(--wx-p), var(--n-hail-far));
    --hail-mid:  color-mix(in oklab, var(--d-hail-mid) var(--wx-p), var(--n-hail-mid));
    --hail-near: color-mix(in oklab, var(--d-hail-near) var(--wx-p), var(--n-hail-near));
    --hail-streak: color-mix(in oklab, var(--d-hail-streak) var(--wx-p), var(--n-hail-streak));
    --snow-in: 360s;     /* settling while it snows */
    --snow-out: 720s;    /* melting after it stops */
    --change: 6s;        /* one condition change */
    --slow: 1;           /* loop durations x this */
  }
  /* Reduced motion: every loop keeps going at a third of the speed; events stop (JS). */
  @media (prefers-reduced-motion: reduce) { .stage { --slow: 3; } }

  .wx { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  /* Out of the scene and faded: costs nothing. (SVG children of a hidden
     group keep their CSS animations running, so those stop too.) */
  .wx-off { display: none; }
  .wx-off * { animation: none !important; }

  /* Sky wash per condition. */
  .wash {
    fill: var(--wash, transparent);
    opacity: var(--wash-a, 0);
    transition: fill calc(var(--change) * .6) ease-in-out, opacity calc(var(--change) * .6) ease-in-out;
  }
  .stage[data-wash="cloudy"] { --wash: var(--w-cloudy); --wash-a: .35; }
  .stage[data-wash="rain"]   { --wash: var(--w-rain);   --wash-a: .45; }
  .stage[data-wash="pour"]   { --wash: var(--w-pour);   --wash-a: .55; }
  .stage[data-wash="storm"]  { --wash: var(--w-storm);  --wash-a: .55; }
  .stage[data-wash="snow"]   { --wash: var(--w-snow);   --wash-a: .35; }
  .stage[data-wash="fog"]    { --wash: var(--w-fog);    --wash-a: .45; }
  .stage[data-wash="exc"]    { --wash: var(--w-exc);    --wash-a: .5; }
  /* By day, secondary text on the outdoor side darkens under the darker
     washes to keep at least 4.5:1: partway toward the main text color in
     rain, all the way in pouring rain, storms, hail and the exceptional
     sky. Nights are unchanged. */
  .stage[data-wash="rain"] { --text-2-out: color-mix(in oklab, var(--text) calc(var(--haag-daylight) * 60%), var(--text-2)); }
  .stage:is([data-wash="pour"], [data-wash="storm"], [data-wash="exc"]) { --text-2-out: color-mix(in oklab, var(--text) calc(var(--haag-daylight) * 100%), var(--text-2)); }
  .outdoor .t3 { transition: color calc(var(--change) * .6) ease-in-out; }

  /* Shared elements: in or out per condition. Default = out; its
     transition is used when an element leaves, the [data-on] state's when
     it arrives. */
  .wx .vis { opacity: 0; transition: opacity calc(var(--change) * .45) ease-in-out; }
  .wx .vis[data-on="1"] { opacity: 1; }
  .wx :is(.sunv, .moonv)[data-on="1"] { transition-delay: calc(var(--change) * .35); }
  .wx :is(.stars-a, .stars-b)[data-on="1"] { transition-delay: calc(var(--change) * .5); }
  .wx .cloud { transition-delay: calc(var(--change) * .3); }          /* leave after the rain stops */
  .wx .cloud[data-on="1"] { transition-delay: 0s; transition-duration: calc(var(--change) * .55); }
  .wx .rain { transition-duration: calc(var(--change) * .3); }        /* stops first */
  .wx .rain[data-on="1"] { transition-delay: calc(var(--change) * .45); transition-duration: calc(var(--change) * .4); }

  /* Sun: capsule rays breathing in place, staggered around the disc. */
  .wx .sun-sh { fill: #F5A524; }
  .wx .sun-bd { fill: #FFD447; }
  .wx .sun-hl { fill: none; stroke: #FFF2B0; stroke-width: 2; stroke-linecap: round; }
  .wx .ray {
    stroke-width: 2.6;
    stroke-linecap: round;
    transform-box: fill-box;
    transform-origin: 0% 50%;
    animation: wx-rays calc(4.8s * var(--slow)) ease-in-out calc(var(--d) * var(--slow)) infinite alternate;
  }
  .wx .ray.lit { stroke: #FFD447; }
  .wx .ray.shade { stroke: #F5A524; }
  @keyframes wx-rays { from { transform: scaleX(.72); } to { transform: scaleX(1.12); } }

  /* Moon: dark disc, lit phase, craters on the lit part only. */
  .wx .moon-dark { fill: #252E4D; }
  .wx .moon-lit { fill: #8D97A7; }
  .wx .moon-shade { fill: #1B2236; opacity: .22; }      /* slight cel shadow on the lower right */
  .wx :is(.maria, .pits) { fill: #7B8596; }            /* seas and craters */
  .wx .maria-core { fill: #626B7B; }                    /* darker middles of the seas */
  .wx .bright { fill: #8D97A7; }                        /* young bright craters: highland grey */
  .wx .rims path { fill: none; stroke: #626B7B; stroke-linecap: round; }   /* crater shadows */
  .wx .moon-rim { fill: none; stroke: #45527A; stroke-width: .5; display: none; }
  .wx .moon-face { transform-box: fill-box; transform-origin: center; }
  .stage.wx-south .wx .moon-face { transform: rotate(180deg); }   /* seen upside down from the south */

  /* Stars, Milky Way. */
  .wx .tw { animation: wx-twinkle calc(var(--t) * var(--slow)) ease-in-out calc(var(--d) * var(--slow)) infinite alternate; }
  @keyframes wx-twinkle { from { opacity: .3; } to { opacity: 1; } }
  .wx .milky { fill: #8FA6C8; opacity: .05; }

  /* Clouds: one body color and one shadow per variant; they keep drifting
     while their color changes. While day and night switch, cloud colors
     follow it directly (a fill transition would lag behind the sky). */
  .wx .cloud .bd { fill: var(--c); transition: fill calc(var(--change) * .5) ease-in-out; }
  .wx .cloud :is(.sh, .us) { fill: var(--c-sh); transition: fill calc(var(--change) * .5) ease-in-out; }
  .wx .cloud .hl { fill: var(--c-hl); transition: fill calc(var(--change) * .5) ease-in-out; }
  .stage.wx-theming .wx .cloud :is(.bd, .sh, .hl, .us) { transition: none; }
  .stage.wx-theming .outdoor .t3 { transition: none; }
  .wx .cloud[data-v="fair"]       { --c: var(--cf);  --c-sh: var(--cf-sh);  --c-hl: var(--cf-hl); }
  .wx .cloud[data-v="grey"]       { --c: var(--cg);  --c-sh: var(--cg-sh);  --c-hl: var(--cg-hl); }
  .wx .cloud[data-v="storm"]      { --c: var(--cs);  --c-sh: var(--cs-sh);  --c-hl: var(--cs-hl); }
  .wx .cloud[data-v="back"]       { --c: var(--cb);  --c-sh: var(--cb-sh);  --c-hl: var(--cb-hl); }
  .wx .cloud[data-v="back-grey"]  { --c: var(--cbg); --c-sh: var(--cbg-sh); --c-hl: var(--cbg-hl); }
  .wx .cloud[data-v="back-storm"] { --c: var(--cbs); --c-sh: var(--cbs-sh); --c-hl: var(--cbs-hl); }
  .wx .drift { animation: wx-drift calc(var(--t) * var(--slow)) linear calc(var(--d) * var(--slow)) infinite; }
  .stage.wx-left .wx .drift { animation-direction: reverse; }
  @keyframes wx-drift { from { transform: translateX(var(--x0)); } to { transform: translateX(var(--x1)); } }
  /* Shapes are drawn moving left (tail trailing right); mirrored when the
     drift is to the right. Each copy mirrors on its own, so the shadow
     stays on the lower right. */
  .wx .mir { transform-box: fill-box; transform-origin: center; }
  .stage:not(.wx-left) .wx .mir { transform: scaleX(-1); }

  /* Rain: streaks fall to the split; some splash there. */
  .wx .fall { animation: wx-fall calc(var(--t) * var(--slow)) linear calc(var(--d) * var(--slow)) infinite; }
  @keyframes wx-fall { to { transform: translate(var(--tx), var(--ty)); } }
  .wx .far  { fill: var(--rain-far); }
  .wx .mid  { fill: var(--rain-mid); }
  .wx .near { fill: var(--rain-near); }
  .wx .spl {
    opacity: 0;
    transform-box: fill-box;
    transform-origin: 50% 100%;
    animation: wx-splash calc(var(--t) * var(--slow)) linear calc(var(--d) * var(--slow)) infinite;
  }
  @keyframes wx-splash {
    0%   { opacity: 1; transform: scale(.5); }
    14%  { opacity: 0; transform: translateY(-.5px) scale(1.3); }
    100% { opacity: 0; }
  }

  /* Snow: puffs that sway as they fall, slanted by the wind. */
  .wx .sway { animation: wx-sway calc(var(--sp) * var(--slow)) ease-in-out calc(var(--sd) * var(--slow)) infinite alternate; }
  @keyframes wx-sway { from { transform: translateX(calc(var(--sa) * -1)); } to { transform: translateX(var(--sa)); } }
  .wx .fsh { fill: var(--snow-sh); }
  .wx .sf-far .fbd, .wx .spl.sf-far { fill: var(--snow-far); }
  .wx .sf-mid .fbd, .wx .spl.sf-mid { fill: var(--snow-mid); }
  .wx .sf-near .fbd, .wx .spl.sf-near { fill: var(--snow-near); }
  /* Settled snow: grows while it snows (to 1 over --snow-in), melts after
     (back to 0 over --snow-out). Reversing midway is smooth. */
  .wx .accum { --wx-snow: 0; transition: --wx-snow var(--snow-out) linear; }
  .stage[data-snowing="1"] .wx .accum { --wx-snow: 1; transition-duration: var(--snow-in); }
  .wx :is(.acc-corner, .acc-alert) { fill: var(--snow-near); }
  .wx .acc-alert { transform: scaleY(var(--wx-snow)); }      /* grows up from the alert row's top */
  .wx .acc-corner { transform: scale(var(--wx-snow)); }      /* grows out of the corner */
  .wx .acc-corner.wide { transform: scaleY(var(--wx-snow)); }   /* wide screens: grows up from the bottom */
  .stage[data-alert="0"] .wx .alert-snow { display: none; }

  /* Exceptional: serious and a bit funny. A twisting tornado of marker
     strokes touching down on the split, cows, a dinosaur and junk circling
     it, and a giant spider climbing in at the bottom corner. */
  .wx .tor-streak { opacity: .55; }                    /* translucent: overlaps darken, like marker */
  .wx .tor-streak.a { fill: var(--tor-a); }
  .wx .tor-streak.b { fill: var(--tor-b); }
  .wx .tor-streak.hl { fill: var(--tor-hl); opacity: .45; }
  .wx .twist { animation: wx-twist calc(var(--t) * var(--slow)) ease-in-out calc(var(--d) * var(--slow)) infinite alternate; }
  @keyframes wx-twist { from { transform: translateX(calc(var(--w) * -1)); } to { transform: translateX(var(--w)); } }
  .wx .funnel { transform-origin: 15px 85px; animation: wx-lean calc(5.5s * var(--slow)) ease-in-out infinite alternate; }
  @keyframes wx-lean { from { transform: rotate(-3deg); } to { transform: rotate(3deg); } }
  .wx .dust { fill: var(--tor-b); animation: wx-dust calc(1.6s * var(--slow)) ease-in-out calc(var(--d) * var(--slow)) infinite alternate; transform-box: fill-box; transform-origin: center; }
  @keyframes wx-dust { from { transform: scale(.8); opacity: .7; } to { transform: scale(1.2); opacity: 1; } }
  /* Giant spider: pulling forward and easing back, legs stepping in two
     alternating sets, eyes blinking. */
  .wx .spider { animation: wx-creep calc(9s * var(--slow)) ease-in-out infinite alternate; }
  @keyframes wx-creep { from { transform: translateY(.6px); } to { transform: translateY(-1.2px); } }
  .wx .spider .bd { fill: var(--kaiju); }
  .wx .spider .hl { fill: color-mix(in oklab, var(--kaiju), #fff 16%); }
  .wx .spider .mark { fill: #B8373F; }
  .wx .spider .leg { fill: none; stroke: var(--kaiju); stroke-width: .65; stroke-linecap: round; stroke-linejoin: round; }
  .wx .spider .step { transform-box: fill-box; animation: wx-step calc(.9s * var(--slow)) ease-in-out calc(var(--d) * var(--slow)) infinite alternate; }
  .wx .spider .step.l { transform-origin: 100% 50%; }
  .wx .spider .step.r { transform-origin: 0% 50%; }
  @keyframes wx-step { from { transform: rotate(-7deg); } to { transform: rotate(7deg); } }
  .wx .spider .eye { fill: #F2C14E; animation: wx-blink calc(5s * var(--slow)) step-end infinite; }
  @keyframes wx-blink { 0%, 92%, 100% { opacity: 1; } 93%, 96% { opacity: 0; } }
  /* Dragon: wings flapping, fire on the way down; flames flicker along
     the alert row's top edge. */
  .wx .wing { transform-box: fill-box; transform-origin: 50% 100%; animation: wx-flap .46s ease-in-out infinite alternate; }
  .wx .wing.far { animation-delay: -.23s; }
  @keyframes wx-flap { from { transform: scaleY(1); } to { transform: scaleY(-.35); } }
  .wx .breath { transform-box: fill-box; transform-origin: 0% 50%; animation: wx-flick .11s ease-in-out infinite alternate; }
  .wx .lick { transform-box: fill-box; transform-origin: 50% 100%; animation: wx-lick .16s ease-in-out var(--d) infinite alternate; }
  @keyframes wx-lick { from { transform: scaleY(.85); } to { transform: scaleY(1.08); } }
  @keyframes wx-flick { from { transform: scale(.9, .85); } to { transform: scale(1.08, 1.1); } }

  /* Wind: thin streaks with an upturned whoosh at the front, a few all
     the time, plus gusts carrying seasonal detritus and, now and then, an
     easter egg. Shapes face the way the wind blows. */
  .wx .streak { fill: var(--wind); }
  .wx .streak-run { opacity: 0; animation: wx-streak calc(var(--t) * var(--slow)) linear calc(var(--d) * var(--slow)) infinite; }
  .stage.wx-left .wx .streak-run { animation-direction: reverse; }
  @keyframes wx-streak {
    0%   { opacity: 0; transform: translateX(0); }
    10%  { opacity: .75; }
    50%  { opacity: .75; }
    60%  { opacity: 0; transform: translateX(var(--dist)); }
    100% { opacity: 0; transform: translateX(var(--dist)); }
  }
  .wx .wmir { transform-box: fill-box; transform-origin: center; }
  .stage.wx-left .wx .wmir { transform: scaleX(-1); }

  /* Fog: wavy ribbons whose waves slide with the wind and thin wisps, in
     front of the other weather and behind the text; one wispy ribbon
     crosses the bottom of the clock, in front of it. The sun and moon show
     through a pale veil (fading toward the fog's color, not the sky's). */
  .wx .fog-ribbons path { opacity: .8; }
  .wx .fog-ribbons path:nth-child(odd) { fill: var(--fog-light); }
  .wx .fog-ribbons path:nth-child(even) { fill: var(--fog-base); }
  .wx .fog-wisps path { fill: var(--fog-light); opacity: .7; }
  .wx .fog-shift { animation: wx-fogshift calc(var(--t) * var(--slow)) linear infinite; }
  .stage.wx-left .wx .fog-shift { animation-direction: reverse; }
  @keyframes wx-fogshift { from { transform: translateX(0); } to { transform: translateX(var(--lam)); } }
  .wx .fog-front { fill: var(--fog-light); opacity: .75; }
  .wx .fog-veil { fill: var(--fog-light); opacity: .55; }
  /* Some fog (exceptional): only the lower ribbons and the wisps. */
  .stage[data-fog="some"] .wx :is(.fog-veil, .fog-over),
  .stage[data-fog="some"] .wx .fog-ribbons > g:nth-child(-n+5) { display: none; }

  /* Hail: small pellets with a white glint and a long faint streak,
     falling fast. About 1 in 6 hop off the split (or the left edge). */
  .wx .hs { fill: var(--hail-streak); opacity: .45; }
  .wx .hg { fill: #FFFFFF; }
  .wx .hl-far .hp, .wx .hop.hl-far { fill: var(--hail-far); }
  .wx .hl-mid .hp, .wx .hop.hl-mid { fill: var(--hail-mid); }
  .wx .hl-near .hp, .wx .hop.hl-near { fill: var(--hail-near); }
  .wx .hop { opacity: 0; }

  /* Lightning. With reduced motion, one still bolt instead of strikes. */
  .wx :is(.bolts path, .bolts-front path, .static-bolt) { fill: none; stroke: var(--bolt); stroke-linecap: round; stroke-linejoin: round; }
  .wx .flash { fill: var(--flash); }
  .wx .static-bolt { display: none; stroke-width: .5; }
  @media (prefers-reduced-motion: reduce) { .stage[data-lightning="1"] .wx .static-bolt { display: inline; } }
`;

/* ---------- Markup ---------- */
// Under the text: sky elements and weather. The fade mask thins them out
// toward the split; the clip keeps falling things on the outdoor side.
const UNDER_SVG = `
  <defs>
    <linearGradient id="wx-fg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="100">
      <stop offset=".38" stop-color="#fff"/><stop offset=".56" stop-color="#000"/>
    </linearGradient>
    <mask id="wx-fade" maskUnits="userSpaceOnUse" class="wx-box">
      <rect class="wx-box" fill="url(#wx-fg)"/>
    </mask>
    <clipPath id="wx-out"><polygon class="wx-outdoor"/></clipPath>
    <clipPath id="wx-sun"><circle r="12"/></clipPath>
    <clipPath id="wx-moon"><path class="moon-clip"/></clipPath>
  </defs>
  <g mask="url(#wx-fade)">
    <rect class="wash wx-box"/>
    <g class="vis stars-b" data-on="0"><polygon class="milky"/><g class="mw-dots"></g><g class="stars-extra"></g></g>
    <g class="vis stars-a" data-on="0"></g>
    <g class="vis sunv" data-on="0"><g class="sun-pos"><g transform="scale(${BODY_SCALE})">
      <g class="rays"></g>
      <circle r="12" class="sun-sh"/>
      <circle cx="-2" cy="-2" r="12" class="sun-bd" clip-path="url(#wx-sun)"/>
      <path class="sun-hl" d="M-9 1.9A8.5 8.5 0 0 1 1.9 -9"/>
    </g></g></g>
    <g class="vis moonv" data-on="0"><g class="moon-pos"><g transform="scale(${BODY_SCALE})"><g class="moon-face">
      <circle r="${R}" class="moon-dark"/>
      <path class="moon-lit"/>
      <g class="craters" clip-path="url(#wx-moon)">
        <g class="maria"></g>
        <g class="maria-core"></g>
        <g class="pits"></g>
        <g class="bright"></g>
        <g class="rims"></g>
        <path class="moon-shade" fill-rule="evenodd" d="M13 0A13 13 0 1 1 -13 0A13 13 0 1 1 13 0ZM11.4 -1.6A13 13 0 1 1 -14.6 -1.6A13 13 0 1 1 11.4 -1.6Z"/>
      </g>
      <circle r="${R}" class="moon-rim"/>
    </g></g></g></g>
    <g class="visitors"></g>
    <g class="clouds-back"></g>
  </g>
  <g clip-path="url(#wx-out)">
    <g class="bolts"></g>
    <path class="static-bolt" d="M26 28L22 36L27 41L20 52L24 57L19 68"/>
  </g>
  <g class="vis rain rain-l" data-on="0"><g class="drops" clip-path="url(#wx-out)"></g><g class="splashes"></g></g>
  <g class="vis rain rain-h" data-on="0"><g class="drops" clip-path="url(#wx-out)"></g><g class="splashes"></g></g>
  <g class="vis rain hail" data-on="0"><g class="drops" clip-path="url(#wx-out)"></g><g class="bounces"></g></g>
  <g class="vis rain snow-full" data-on="0"><g class="drops" clip-path="url(#wx-out)"></g><g class="splashes"></g></g>
  <g class="vis excv" data-on="0"><g class="spider-at"></g><g class="dragon-at"></g></g>
  <g class="vis rain snow-mix" data-on="0"><g class="drops" clip-path="url(#wx-out)"></g><g class="splashes"></g></g>
  <g class="accum" clip-path="url(#wx-out)">
    <g transform="translate(0 100)"><path class="acc-corner"/></g>
  </g>
  <g mask="url(#wx-fade)">
    <g class="vis excv" data-on="0"><g class="funnel"></g></g>
    <g class="clouds-front"></g>
    <g class="vis excv" data-on="0"><g class="orbit"></g></g>
    <g class="vis windv" data-on="0"><g class="streaks"></g><g class="gusts"></g></g>
    <g class="vis fogv" data-on="0"><rect class="fog-veil wx-box"/><g class="fog-ribbons"></g><g class="fog-wisps"></g></g>
    <rect class="flash wx-box" opacity="0"/>
  </g>
  <!-- Cloud-to-cloud strikes arc in front of the clouds. -->
  <g clip-path="url(#wx-out)"><g class="bolts-front"></g></g>`;

// Over the text: the fog ribbon across the bottom of the clock, and the
// alert row's snow (across its full width, crossing the split: a small
// "fourth wall" break) with the dragon's flames.
const OVER_SVG = `
  <defs><clipPath id="wx-out-over"><polygon class="wx-outdoor"/></clipPath></defs>
  <g class="vis fogv fog-over" data-on="0">
    <g clip-path="url(#wx-out-over)"><g class="fog-shift fog-front-g"><path class="fog-front"/></g></g>
  </g>
  <g class="accum alert-snow">
    <g class="acc-alert-at"><path class="acc-alert"/></g>
    <g class="bar-flames"></g>
  </g>`;

// Wind bearing (where the wind comes from) to a drift direction: a west
// wind blows left to right (+1), an east wind right to left (-1); within
// 20° of north or south it keeps the current direction (0).
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const WIND_HOLD = 2 * 60 * 1000;   // a new direction must hold this long
function windDir(bearing) {
  let deg = Number(bearing);
  if (bearing == null || bearing === '' || Number.isNaN(deg)) {
    const i = COMPASS.indexOf(String(bearing ?? '').trim().toUpperCase());
    if (i < 0) return 0;
    deg = i * 22.5;
  }
  deg = ((deg % 360) + 360) % 360;
  if (deg > 20 && deg < 160) return -1;
  if (deg > 200 && deg < 340) return 1;
  return 0;
}

/* ---------- The scene ---------- */
export class Weather {
  // root: the glance's stage (classes and data attributes go on it);
  // under, over: the two <svg class="wx"> layers.
  constructor(root, under, over) {
    this.root = root;
    this.under = under;
    this.over = over;
    under.innerHTML = UNDER_SVG;
    over.innerHTML = OVER_SVG;
    this.cond = 'none';
    this.phase = null;
    this.day = null;
    this.dir = 1;                 // +1 drift right (also the no-data fallback), -1 left
    this.visible = true;
    this.change = 6;
    this.hours = { now: 12, sun: [6, 12, 18], midnight: 0 };
    this.root.dataset.alert = '0';
    for (const el of this._all('.vis')) el.classList.add('wx-off');
    this._onMotion = () => { this.build(); this.apply(); };
    reduced.addEventListener('change', this._onMotion);
  }

  _all(sel) { return [...this.under.querySelectorAll(sel), ...this.over.querySelectorAll(sel)]; }
  q(sel) { return this.under.querySelector(sel) || this.over.querySelector(sel); }

  destroy() {
    reduced.removeEventListener('change', this._onMotion);
    this._stopEvents();
  }

  // Screen size in pixels: sets the scene's bounds and builds the layouts.
  resize(W, H) {
    if (!W || !H || (W === this.W && H === this.H)) return;
    this.W = W; this.H = H;
    const S = Math.min(W, H), w = W / S * 100, h = H / S * 100;
    const b = this.b = { x0: (100 - w) / 2, y0: (100 - h) / 2, w, h };
    b.x1 = b.x0 + w; b.y1 = b.y0 + h;
    // The outdoor side: the screen above the split.
    const pts = [[b.x0, b.y0], [100 - b.y0, b.y0]];
    const yl = 100 - b.x0;                     // where the split meets the left edge
    if (yl <= b.y1) pts.push([b.x0, yl]);
    else pts.push([100 - b.y1, b.y1], [b.x0, b.y1]);
    b.out = pts;
    b.area = Math.abs(pts.reduce((a, [x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; return a + x * v - u * y; }, 0)) / 2;
    b.k = b.area / 5000;                       // outdoor area against the square's
    // The outdoor height at the left edge, for spreading things over it.
    b.top = b.y0;
    b.mapY = y => b.y0 + y * (100 - b.y0) / 100;
    for (const svg of [this.under, this.over]) svg.setAttribute('viewBox', `${f(b.x0)} ${f(b.y0)} ${f(w)} ${f(h)}`);
    for (const el of this._all('.wx-box')) {
      el.setAttribute('x', f(b.x0)); el.setAttribute('y', f(b.y0));
      el.setAttribute('width', f(w)); el.setAttribute('height', f(h));
    }
    for (const el of this._all('.wx-outdoor')) el.setAttribute('points', pts.map(p => p.map(f).join(',')).join(' '));
    this.build();
    this.setSky(this.hours);
    this.place(this.marksPx);
    this.apply(true);
  }

  build() {
    if (!this.b) return;
    const rand = seeded(11), b = this.b;

    // Sun rays: eight capsules; the three facing away from the light are in shadow.
    const rays = this.q('.rays');
    rays.replaceChildren();
    for (let i = 0; i < 8; i++) {
      const a = i * 45;                       // 0 = right, clockwise
      const g = svgEl('g', { transform: `rotate(${a})` }, rays);
      svgEl('line', { class: `ray ${a <= 90 ? 'shade' : 'lit'}`, x1: 15.5, y1: 0, x2: 19.5, y2: 0, style: `--d:${(-i * .6).toFixed(1)}s` }, g);
    }

    this.buildMoon();

    // Stars: a base set (any clear-ish night) and an extra set plus the
    // Milky Way (clear nights only), spread over the outdoor sky.
    const COLORS = ['#F1EADC', '#F6E7C1', '#DCE6F5'];
    const star = (parent, rMin, rMax) => {
      let x, y;
      do { x = rand(b.x0 + 1, 76); y = rand(b.y0 + 1, 64); } while (x + y > 84);
      svgEl('circle', {
        class: 'tw', cx: f(x), cy: f(y), r: f(rand(rMin, rMax)),
        fill: COLORS[Math.floor(rand(0, 3))],
        style: `--t:${rand(3, 8).toFixed(1)}s;--d:${(-rand(0, 8)).toFixed(1)}s`,
      }, parent);
    };
    this.q('.stars-a').replaceChildren();
    this.q('.stars-extra').replaceChildren();
    for (let i = 0; i < Math.round(16 * b.k); i++) star(this.q('.stars-a'), .28, .55);
    for (let i = 0; i < Math.round(34 * b.k); i++) star(this.q('.stars-extra'), .18, .42);
    // Milky Way: a very faint ribbon with denser tiny stars along it.
    const P0 = [0, 32], P1 = [72, 6];
    const dx = P1[0] - P0[0], dy = P1[1] - P0[1], len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const width = u => 4.5 + 2.2 * Math.sin(u * Math.PI * 3 + 1) + 1.2 * Math.sin(u * Math.PI * 7);
    const top = [], bottom = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24, cx = P0[0] + dx * u, cy = P0[1] + dy * u, w = width(u) / 2;
      top.push(`${f(cx + nx * w)},${f(cy + ny * w)}`);
      bottom.unshift(`${f(cx - nx * w)},${f(cy - ny * w)}`);
    }
    this.q('.milky').setAttribute('points', [...top, ...bottom].join(' '));
    const mw = this.q('.mw-dots');
    mw.replaceChildren();
    for (let i = 0; i < 90; i++) {
      const u = rand(0, 1), off = (rand(-1, 1) + rand(-1, 1)) / 2 * width(u) * .6;
      svgEl('circle', {
        cx: f(P0[0] + dx * u + nx * off), cy: f(P0[1] + dy * u + ny * off),
        r: f(rand(.1, .22)), fill: COLORS[Math.floor(rand(0, 3))], opacity: f(rand(.45, .9)),
      }, mw);
    }

    // Clouds, three tones: the shadow copy, a highlight copy nudged up and
    // left, then the body between them. What shows of each is a sliver:
    // highlight on the upper-left edges, shadow on the lower right.
    // Rebuilt clouds keep whether they're in, and their look.
    const was = Object.fromEntries([...this.under.querySelectorAll('.cloud')].map(c => [c.dataset.slot, [c.dataset.on, c.dataset.v]]));
    for (const host of [this.q('.clouds-back'), this.q('.clouds-front')]) host.replaceChildren();
    for (const s of SLOTS) {
      const shape = { towering: TOWER, stratus: STRATUS }[s.kind] || ROLL;
      const w = (s.kind === 'stratus' ? 182 : 114) * s.s;
      const h = ({ towering: 69, stratus: 16 }[s.kind] || 40) * s.s;
      const y = b.mapY(s.y);
      const x0 = b.x0 - w - 2;                    // fully off the left edge
      const x1 = 100 - y + h / 2 + 2;             // left edge past the split at mid-height
      const t = (x1 - x0) / (s.spd || SPEED[s.layer]);
      const [on, v] = was[s.id] || ['0', 'fair'];
      this.q(s.layer === 'back' ? '.clouds-back' : '.clouds-front').insertAdjacentHTML('beforeend', `
        <g class="vis cloud${on === '1' ? '' : ' wx-off'}" data-slot="${s.id}" data-layer="${s.layer}" data-on="${on}" data-v="${v}">
          <g class="drift" style="--x0:${f(x0)}px;--x1:${f(x1)}px;--t:${f(t)}s;--d:${f(-s.ph * t)}s">
            <g transform="translate(0 ${f(y)}) scale(${s.s})">
              <g class="mir sh">${shape}</g>
              <g transform="translate(-4.2 -5.4)"><g class="mir hl">${shape}</g></g>
              <g transform="translate(-2.6 -3.4)"><g class="mir bd">${shape}${s.kind === 'stratus' ? '' : UNDER}</g></g>
            </g>
          </g>
        </g>`);
    }

    this.buildRain();
    this.buildSnow();
    this.buildHail();
    this.buildFog();
    this.buildWind();
    this.buildExceptional();
    this.buildAccumulation();
  }

  // The near side of the moon, simplified into flat seas and a few
  // landmark craters (north up). Coordinates are fractions of the radius.
  buildMoon() {
    for (const s of ['.maria', '.maria-core', '.pits', '.bright', '.rims']) this.q(s).replaceChildren();
    const blob = pts => {                      // smooth closed outline through the points
      const P = pts.map(([x, y]) => [x * R, y * R]), n = P.length;
      let d = `M${f(P[0][0])} ${f(P[0][1])}`;
      for (let i = 0; i < n; i++) {
        const [p0, p1, p2, p3] = [P[(i + n - 1) % n], P[i], P[(i + 1) % n], P[(i + 2) % n]];
        d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
      }
      return d + 'Z';
    };
    const MARIA = [
      [[-.58, -.38], [-.5, -.6], [-.3, -.68], [-.08, -.58], [-.05, -.38], [-.15, -.22], [-.38, -.2]],                     // Imbrium
      [[-.9, -.25], [-.72, -.42], [-.58, -.3], [-.42, -.15], [-.38, .05], [-.48, .25], [-.62, .38], [-.82, .32], [-.93, .05]], // Procellarum
      [[.02, -.5], [.14, -.6], [.3, -.52], [.32, -.36], [.18, -.28], [.04, -.34]],                                       // Serenitatis
      [[.22, -.26], [.42, -.3], [.55, -.14], [.5, .02], [.34, .04], [.22, -.08]],                                        // Tranquillitatis
      [[.58, -.3], [.7, -.39], [.82, -.31], [.78, -.2], [.64, -.2]],                                                     // Crisium
      [[.52, .04], [.68, 0], [.74, .16], [.62, .3], [.5, .22]],                                                          // Fecunditatis
      [[.31, .24], [.42, .2], [.46, .32], [.36, .39]],                                                                   // Nectaris
      [[-.3, .22], [-.05, .2], [.02, .36], [-.12, .48], [-.32, .42]],                                                    // Nubium
      [[-.58, .36], [-.46, .33], [-.41, .44], [-.53, .5]],                                                               // Humorum
      [[-.45, -.72], [-.1, -.81], [.3, -.75], [.31, -.69], [-.1, -.74], [-.42, -.66], 'thin'],                           // Frigoris
      [[-.05, -.24], [.06, -.25], [.07, -.16], [-.04, -.15]],                                                            // Vaporum
    ];
    // Seas: smooth, organic blobs with a gentle wobble; larger seas get a
    // darker core built the same way.
    const mrand = seeded(5);
    const wobble = (pts, amt) => pts.flatMap((a, i) => {
      const c = pts[(i + 1) % pts.length];
      const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const n = Math.max(1, Math.round(l / .09));
      return Array.from({ length: n }, (_, j) => {
        const t = j / n, o = j ? mrand(-amt, amt) : 0;
        return [a[0] + dx * t - dy / l * o, a[1] + dy * t + dx / l * o];
      });
    });
    for (const sea of MARIA) {
      const thin = sea.at(-1) === 'thin', m = thin ? sea.slice(0, -1) : sea;
      svgEl('path', { d: blob(wobble(m, .025)) }, this.q('.maria'));
      if (thin) continue;                     // thin seas stay one tone
      const cx = m.reduce((v, p) => v + p[0], 0) / m.length, cy = m.reduce((v, p) => v + p[1], 0) / m.length;
      const size = Math.max(...m.map(p => Math.hypot(p[0] - cx, p[1] - cy)));
      if (size < .1) continue;                // small seas stay one tone
      const core = m.map(([x, y]) => [cx + (x - cx) * .5, cy + (y - cy) * .5]);
      svgEl('path', { d: blob(wobble(core, .015)) }, this.q('.maria-core'));
    }
    // Craters: bright young ones (Tycho, Copernicus, Kepler, Aristarchus)
    // in the highland grey, older ones (and dark-floored Plato) in the sea
    // grey, each with a shadow on its upper-left inside wall.
    const shade = (x, y, r) => {
      const a0 = 150 * Math.PI / 180, a1 = 300 * Math.PI / 180, rr = r * .72;
      svgEl('path', {
        d: `M${f(x + rr * Math.cos(a0))} ${f(y + rr * Math.sin(a0))}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + rr * Math.cos(a1))} ${f(y + rr * Math.sin(a1))}`,
        'stroke-width': f(r * .38),
      }, this.q('.rims'));
    };
    for (const [x, y, r] of [[-.12, .68, .06], [-.33, -.1, .06], [-.55, -.06, .04], [-.62, -.32, .035]].map(([x, y, r]) => [x * R, y * R, r * R])) {
      svgEl('circle', { cx: f(x), cy: f(y), r: f(r) }, this.q('.bright'));
      shade(x, y, r);
    }
    for (const [x, y, r] of [[-.12, -.72, .05], [.55, .5, .055], [.2, .62, .045], [-.6, .62, .05], [.75, -.55, .04], [.35, .72, .035]].map(([x, y, r]) => [x * R, y * R, r * R])) {
      svgEl('circle', { cx: f(x), cy: f(y), r: f(r) }, this.q('.pits'));
      shade(x, y, r);
    }
  }

  // Where falling things start, and how far they may slant: from above the
  // top edge across the outdoor side, further upwind so slanted paths
  // still cover it. `over` is the square's upwind margin.
  _startX(rand, over) {
    const b = this.b, m = over * b.h / 100;
    return this.dir > 0 ? rand(b.x0 - m, 100 - b.y0) : rand(b.x0, 100 - b.y0 + m);
  }

  // Two rain sheets (light and heavy), so rainy and pouring can crossfade.
  // Each drop starts above the top edge, falls behind the clouds and keeps
  // going until its whole tail has passed the split, so nothing pops.
  buildRain() {
    const rand = seeded(23), b = this.b;
    const k = Math.tan(15 * Math.PI / 180) * this.dir;     // sideways per unit of fall
    const norm = 150 * Math.max(1, (b.w + b.h) / 200);
    for (const [sel, heavy] of [['.rain-l', false], ['.rain-h', true]]) {
      const drops = this.q(`${sel} .drops`), splashes = this.q(`${sel} .splashes`);
      drops.replaceChildren();
      splashes.replaceChildren();
      const n = (heavy ? 120 : 60) * b.k;
      const tail = heavy ? TAIL.heavy : TAIL.light;
      // [depth, share, fall speed (units/s), size]
      for (const [depth, share, speed, size] of [['far', .45, 38, .11], ['mid', .35, 48, .14], ['near', .2, 60, .18]]) {
        const g = svgEl('g', { class: depth }, drops);
        const sc = size * (heavy ? 1.1 : 1);
        const L = tail * sc;                                // streak length
        const y0 = b.y0 - L - 1;                            // fully above the screen
        let made = 0, tries = 0;
        while (made < Math.round(n * share) && tries++ < 20000) {
          const x0 = this._startX(rand, 34);
          const tLine = (100 - x0 - y0) / (1 + k);          // fall until the head meets the split
          if (tLine < L) continue;
          if (rand(0, 1) > tLine / norm) continue;          // even density: long paths cover more sky
          const total = tLine + L * 1.2;                    // until the tail is past the split too
          const dur = total / (speed * (heavy ? 1.4 : 1));
          const delay = -rand(0, dur);
          const fall = svgEl('g', { class: 'fall', style: `--tx:${f(k * total)}px;--ty:${f(total)}px;--t:${f(dur)}s;--d:${f(delay)}s` }, g);
          svgEl('path', { d: streak(tail), transform: `translate(${f(x0)} ${f(y0)}) rotate(${-15 * this.dir}) scale(${sc.toFixed(3)})` }, fall);
          // About 1 in 7 drops splash where they meet the split, timed to
          // the moment the head lands.
          const ex = x0 + k * tLine, ey = y0 + tLine;
          if (rand(0, 1) < 1 / 7 && ex > b.x0 && ey > b.y0 && ey < b.y1) {
            const at = svgEl('g', { transform: `translate(${f(ex)} ${f(ey)})` }, splashes);
            const sp = svgEl('g', { class: `spl ${depth}`, style: `--t:${f(dur)}s;--d:${f(delay + tLine / total * dur)}s` }, at);
            svgEl('circle', { cx: -.8, cy: -.5, r: .32 }, sp);
            svgEl('circle', { cx: .8, cy: -.5, r: .32 }, sp);
            svgEl('circle', { cx: 0, cy: -1, r: .25 }, sp);
          }
          made++;
        }
      }
    }
  }

  // Exceptional: everything is drawn once; CSS and a few looping
  // animations keep it going while the scene is on.
  buildExceptional() {
    const rand = seeded(71);
    // Tornado: translucent marker strokes (flat, slanted ends) stacked into
    // a funnel narrowing to a tip on the split at (15, 85). Rows are
    // thicker than their spacing, so strokes overlap; each slides side to
    // side at its own pace, so the overlaps keep shifting.
    const funnel = this.q('.funnel');
    funnel.replaceChildren();
    const cxAt = t => 30 - 15 * t + 3 * Math.sin(t * Math.PI);
    const wAt = t => 36 * (1 - t) ** 1.15 + 2;
    const yAt = t => 18 + t * 67;
    const stroke = (x0, x1, y, h) => {                      // a marker stroke with chisel ends
      const k = h * .55;
      return `M${f(x0 + k)} ${f(y - h / 2)}L${f(x1 + k)} ${f(y - h / 2)}L${f(x1 - k)} ${f(y + h / 2)}L${f(x0 - k)} ${f(y + h / 2)}Z`;
    };
    const ROWS = 28;
    for (let i = 0; i < ROWS; i++) {
      const t = i / (ROWS - 1), cy = yAt(t), w = wAt(t), cx = cxAt(t), h = 4.4 - 2.3 * t;
      const g = svgEl('g', { class: 'twist', style: `--w:${f(w * .16)}px;--t:${f(rand(.9, 1.7))}s;--d:${f(-rand(0, 1.7))}s` }, funnel);
      const x0 = cx - w / 2 * rand(.85, 1.05), x1 = cx + w / 2 * rand(.85, 1.05);
      svgEl('path', { class: `tor-streak ${i % 2 ? 'b' : 'a'}`, d: stroke(x0, x1, cy + rand(-.4, .4), h * rand(.85, 1.1)) }, g);
      // Now and then a second, shorter stroke in the other tone or the light one.
      if (rand(0, 1) < .45) {
        const a = rand(0, .5), c = a + rand(.25, .5);
        svgEl('path', { class: `tor-streak ${rand(0, 1) < .5 ? 'hl' : (i % 2 ? 'a' : 'b')}`, d: stroke(x0 + (x1 - x0) * a, x0 + (x1 - x0) * c, cy + rand(-.8, .8), h * rand(.5, .8)) }, g);
      }
    }
    for (const [dx, dy, r] of [[-2.5, -.6, 1.6], [2, -.4, 1.3], [0, -1.6, 1.1], [-4, .4, .9], [3.8, .5, .8]]) {
      svgEl('circle', { class: 'dust', cx: 15 + dx, cy: 85 + dy, r: r * 1.3, style: `--d:${f(-rand(0, 1.6))}s` }, funnel);
    }
    // Things caught in it, circling the funnel (smaller and dimmer behind it).
    const orbit = this.q('.orbit');
    orbit.replaceChildren();
    this.orbitAnims?.forEach(a => a.cancel());
    this.orbitAnims = [];
    const slow = SLOW();
    const ITEMS = [['cow', .38, 0, 5.2], ['cow', .62, .45, 6.1], ['dino', .22, .7, 4.6], ['tincan', .78, .2, 3.8], ['umbrella', .5, .85, 5.6]];
    for (const [kind, t, phase, secs] of ITEMS) {
      const cy = yAt(t), rx = wAt(t) / 2 + 4;
      const g = svgEl('g', {}, orbit), spin = svgEl('g', {}, g);
      (EGGS[kind] || EXCEPTIONAL_THINGS[kind])(spin);
      const frames = [];
      for (let k = 0; k <= 36; k++) {
        const th = (k / 36 + phase) * Math.PI * 2, front = Math.cos(th);
        frames.push({ transform: `translate(${f(cxAt(t) + rx * Math.sin(th))}px, ${f(cy + 2.4 * front)}px) scale(${f(.7 + .3 * front)})`, opacity: f(.55 + .45 * (front + 1) / 2) });
      }
      this.orbitAnims.push(g.animate(frames, { duration: secs * 1000 * slow, iterations: Infinity }));
      this.orbitAnims.push(spin.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${rand(0, 1) < .5 ? -360 : 360}deg)` }], { duration: secs * 700 * slow, iterations: Infinity }));
    }
    // A giant spider climbing in over the bottom-left corner of the square:
    // abdomen still outside, front legs reaching in, one foot on the edge
    // and one on the split. It's outside the fade, so it can climb across
    // onto the indoor side.
    const spiderAt = this.q('.spider-at');
    spiderAt.replaceChildren();
    const spider = svgEl('g', { class: 'spider' }, svgEl('g', { transform: 'translate(8 90) rotate(35) scale(2.8)' }, spiderAt));
    // Legs, climbing: [attach y, knee, foot] on the left side; mirrored on the right.
    const LEGS = [[-2.6, [-4, -9], [-3.2, -14]], [-1.6, [-6.5, -5], [-9.5, -8.5]], [-.6, [-6.5, 1], [-10, 4]], [.4, [-4.8, 4.5], [-6.5, 10]]];
    LEGS.forEach(([ay, knee, foot], i) => {
      for (const side of [-1, 1]) {
        const step = svgEl('g', { class: `step ${side < 0 ? 'l' : 'r'}`, style: `--d:${((i + (side > 0 ? 1 : 0)) % 2) * -.9}s` }, spider);
        svgEl('path', { class: 'leg', d: `M${f(side * 1.2)} ${ay}Q${f(side * -knee[0] * .6)} ${f(knee[1] - 1.4)} ${f(side * -knee[0])} ${f(knee[1])}L${f(side * -foot[0])} ${f(foot[1])}` }, step);
      }
    });
    svgEl('ellipse', { class: 'bd', cx: 0, cy: 4.2, rx: 3.6, ry: 4.4 }, spider);           // abdomen
    svgEl('ellipse', { class: 'hl', cx: -1.2, cy: 2.6, rx: 1.4, ry: 2 }, spider);
    svgEl('path', { class: 'mark', d: 'M-.9 3.2L.9 3.2L0 4.4Z M-.9 5.6L.9 5.6L0 4.4Z' }, spider);   // hourglass
    svgEl('ellipse', { class: 'bd', cx: 0, cy: -1.4, rx: 2.4, ry: 2.3 }, spider);           // head and thorax
    svgEl('ellipse', { class: 'hl', cx: -.8, cy: -2, rx: .8, ry: .7 }, spider);
    for (const [x, y, r] of [[-.75, -3, .38], [.75, -3, .38], [-1.35, -2.4, .26], [1.35, -2.4, .26], [-.35, -2.3, .2], [.35, -2.3, .2]]) {
      svgEl('circle', { class: 'eye', cx: x, cy: y, r }, spider);
    }
  }

  // Dragon: every 30–60 s while the scene is on. It swoops along a curve
  // from the upper left, dipping behind the clock, then climbs off the top
  // right. Fire is on during the dive; where it reaches the alert row's
  // top, a trail of small flames flickers out.
  scheduleDragon(sec) {
    clearTimeout(this.dragonTimer);
    this.dragonTimer = setTimeout(() => {
      if (!SCENES[this.cond].exc) return;
      this.dragon();
      this.scheduleDragon(rnd(30, 60));
    }, sec * 1000);
  }
  dragon() {
    if (reduced.matches || !this.visible) return;
    const S = 1.3, MS = 4200, b = this.b;
    const P0 = [b.x0 - 28, 6], P1 = [30, 76], P2 = [Math.max(112, b.x1 + 12), -2];
    const at = t => [0, 1].map(i => (1 - t) ** 2 * P0[i] + 2 * (1 - t) * t * P1[i] + t * t * P2[i]);
    const heading = t => { const d = [0, 1].map(i => 2 * (1 - t) * (P1[i] - P0[i]) + 2 * t * (P2[i] - P1[i])); return Math.atan2(d[1], d[0]); };
    const flyer = svgEl('g', {}, this.q('.dragon-at'));
    const mouth = drawDragon(svgEl('g', { transform: `scale(${S})` }, flyer));
    const frames = [];
    for (let k = 0; k <= 40; k++) {
      const t = k / 40, [x, y] = at(t);
      frames.push({ transform: `translate(${f(x)}px, ${f(y)}px) rotate(${f(heading(t) * 180 / Math.PI)}deg)` });
    }
    flyer.animate(frames, { duration: MS, easing: 'linear' }).onfinish = () => flyer.remove();
    const FIRE = [.2, .5];                                   // during the dive
    mouth.animate([
      { opacity: 0 }, { opacity: 0, offset: FIRE[0] }, { opacity: 1, offset: FIRE[0] + .02 },
      { opacity: 1, offset: FIRE[1] - .02 }, { opacity: 0, offset: FIRE[1] }, { opacity: 0 },
    ], { duration: MS, fill: 'both' });
    // Flames on the alert row where the fire reaches it (only while it's shown).
    const bar = this.marks?.band;
    if (bar == null) return;
    const flames = this.q('.bar-flames');
    for (let t = FIRE[0]; t <= FIRE[1]; t += .02) {
      const [x, y] = at(t), a = heading(t), c = a + BREATH_TILT * Math.PI / 180;
      const mx = x + S * (MOUTH[0] * Math.cos(a) - MOUTH[1] * Math.sin(a)), my = y + S * (MOUTH[0] * Math.sin(a) + MOUTH[1] * Math.cos(a));
      const tx = mx + S * BREATH_LEN * Math.cos(c), ty = my + S * BREATH_LEN * Math.sin(c);
      if (ty < bar - 5.33 || tx < b.x0 - 2 || tx > b.x1 + 2) continue;   // the fire doesn't reach the row here
      setTimeout(() => {
        const g = svgEl('g', { transform: `translate(${f(tx + rnd(-1, 1))} ${f(bar)})` }, flames);
        const patch = svgEl('g', {}, g);
        drawFlamePatch(patch);
        // Flares up, then burns low and flickering for a few seconds, then dies out.
        patch.animate([
          { transform: 'scale(.2, .1)', opacity: 0 },
          { transform: 'scale(1, 1)', opacity: 1, offset: .05 },
          { transform: 'scale(1, .55)', offset: .15 },
          { transform: 'scale(1, .42)', offset: .3 },
          { transform: 'scale(1, .52)', offset: .45 },
          { transform: 'scale(1, .4)', offset: .6 },
          { transform: 'scale(1, .47)', offset: .75 },
          { transform: 'scale(1, .32)', opacity: .9, offset: .88 },
          { transform: 'scale(.8, .05)', opacity: 0 },
        ], { duration: rnd(6000, 7000), easing: 'ease-in-out' }).onfinish = () => g.remove();
      }, t * MS);
    }
  }

  // Wind: a few streaks all the time, each crossing now and then.
  buildWind() {
    const rand = seeded(61), b = this.b;
    const host = this.q('.streaks');
    host.replaceChildren();
    for (let i = 0; i < Math.round(8 * b.k); i++) {
      const y = b.mapY(rand(4, 90)), x = rand(b.x0 - 15, Math.max(b.x0 - 5, 92 - y - 30)), L = rand(14, 26), th = rand(.8, 1.3);
      const at = svgEl('g', { transform: `translate(${f(x)} ${f(y)})` }, host);
      const run = svgEl('g', { class: 'streak-run', style: `--dist:${f(rand(40, 60))}px;--t:${f(rand(4, 7))}s;--d:${f(-rand(0, 7))}s` }, at);
      const mir = svgEl('g', { class: 'wmir' }, run);
      svgEl('path', { class: 'streak', d: WSTREAK, transform: `scale(${f(L / 10)} ${f(th)})` }, mir);
    }
  }

  // Gusts: every 15–40 s while it's windy, 3–5 s of faster streaks and
  // seasonal detritus; about 1 gust in 15 carries an easter egg.
  scheduleGust(sec) {
    clearTimeout(this.gustTimer);
    this.gustTimer = setTimeout(() => {
      if (!SCENES[this.cond].wind) return;
      this.gust();
      this.scheduleGust(rnd(15, 40));
    }, sec * 1000);
  }
  gust(forceEgg = false) {
    if (reduced.matches || !this.visible) return;
    const host = this.q('.gusts'), dir = this.dir, b = this.b;
    const startX = () => dir > 0 ? rnd(b.x0 - 25, 25) : rnd(45, 95);
    const fly = (el, dist, ms, delay, bob, spin) => {
      const [mover, spinner] = el;
      mover.animate([
        { transform: 'translate(0, 0)', opacity: 0 },
        { transform: `translate(${f(dir * dist * .12)}px, ${f(bob)}px)`, opacity: 1, offset: .12 },
        { transform: `translate(${f(dir * dist * .4)}px, ${f(-bob)}px)`, offset: .4 },
        { transform: `translate(${f(dir * dist * .7)}px, ${f(bob)}px)`, opacity: 1, offset: .7 },
        { transform: `translate(${f(dir * dist)}px, 0)`, opacity: 0 },
      ], { duration: ms, delay, fill: 'both' }).onfinish = () => mover.parentNode.remove();
      if (spinner) spinner.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${f(spin)}deg)` }], { duration: ms, delay, fill: 'both' });
    };
    const place = y => {
      const at = svgEl('g', { transform: `translate(${f(startX())} ${f(y)})` }, host);
      const mover = svgEl('g', {}, at);
      return [mover, svgEl('g', {}, mover)];
    };
    // Faster streaks.
    for (let i = 0; i < 12; i++) {
      const [mover, inner] = place(b.mapY(rnd(4, 90)));
      const mir = svgEl('g', { class: 'wmir' }, inner);
      svgEl('path', { class: 'streak', d: WSTREAK, transform: `scale(${f(rnd(1.6, 3))} ${f(rnd(.9, 1.4))})` }, mir);
      fly([mover], rnd(50, 75), rnd(900, 1400), rnd(0, 2500), 0, 0);
    }
    // Seasonal detritus, tumbling and bobbing.
    const kinds = DETRITUS[seasonNow(this.root.classList.contains('wx-south'))];
    for (let i = 0; i < 6; i++) {
      const [mover, spinner] = place(b.mapY(rnd(10, 88)));
      drawPiece(spinner, kinds[Math.floor(rnd(0, kinds.length))]);
      fly([mover, spinner], rnd(60, 90), rnd(2200, 3500), rnd(0, 3000), rnd(2, 4), rnd(360, 900) * (Math.random() < .5 ? -1 : 1));
    }
    // Now and then, something odd.
    if (forceEgg || Math.random() < 1 / 15) {
      const names = Object.keys(EGGS), name = names[Math.floor(rnd(0, names.length))];
      const [mover, spinner] = place(b.mapY(rnd(12, 70)));
      EGGS[name](spinner);
      const tumbles = name === 'tincan' || name === 'newspaper';
      fly([mover, spinner], 95, rnd(4000, 5200), rnd(500, 1500), rnd(2, 3.5), tumbles ? rnd(300, 600) * dir : rnd(-25, 25));
    }
  }

  // Fog: wavy ribbons across the whole height and thin wisps drifting
  // over them. Ribbons repeat every wavelength, so sliding by one
  // wavelength loops seamlessly; the direction follows the wind.
  _fogBand(y, amp, lam, th, phase, pinch = 0) {
    const b = this.b, top = [], bot = [];
    for (let x = b.x0 - lam; x <= b.x1 + lam + .01; x += 2) {
      const a = 2 * Math.PI * x / lam;
      const t = th * (1 - pinch + pinch * (.5 + .5 * Math.sin(a + phase * 2)));   // pinch: wispy thin spots
      top.push([x, y + amp * Math.sin(a + phase)]);
      bot.push([x, y + t + amp * .8 * Math.sin(a + phase + .9)]);
    }
    return 'M' + top.map(p => `${f(p[0])} ${f(p[1])}`).join('L') + 'L' + bot.reverse().map(p => `${f(p[0])} ${f(p[1])}`).join('L') + 'Z';
  }
  buildFog() {
    const rand = seeded(53), b = this.b;
    const ribbons = this.q('.fog-ribbons');
    ribbons.replaceChildren();
    // Ten ribbons over the full height, closer together (and a little
    // thicker) toward the bottom.
    const RIBBONS = 10;
    for (let i = 0; i < RIBBONS; i++) {
      const u = (i / (RIBBONS - 1)) ** .7, y = b.mapY(4 + 92 * u);
      const lam = rand(42, 62), t = rand(36, 54), th = 4 + 2.5 * u;
      const g = svgEl('g', { class: 'fog-shift', style: `--lam:${f(lam)}px;--t:${f(t)}s` }, ribbons);
      svgEl('path', { d: this._fogBand(y, rand(1.2, 2.2), lam, th, rand(0, 6.28), .35) }, g);
    }
    // Wisps: thin tapered streaks drifting across faster than the ribbons.
    const wisps = this.q('.fog-wisps');
    wisps.replaceChildren();
    for (let i = 0; i < Math.round(12 * b.k); i++) {
      const y = b.mapY(4 + 92 * rand(0, 1) ** .6), L = rand(22, 40), h = rand(.7, 1.2);   // more of them low down
      const x0 = b.x0 - L - 2, x1 = 100 - y + 2, t = (x1 - x0) / rand(2, 3);
      const g = svgEl('g', { class: 'drift', style: `--x0:${f(x0)}px;--x1:${f(x1)}px;--t:${f(t)}s;--d:${f(-rand(0, t))}s` }, wisps);
      svgEl('path', { d: `M0 ${f(y)}Q${f(L / 2)} ${f(y - h)} ${f(L)} ${f(y)}Q${f(L / 2)} ${f(y + h * .6)} 0 ${f(y)}Z` }, g);
    }
    const front = this.q('.fog-front-g');
    front.style.setProperty('--lam', '40px');
    front.style.setProperty('--t', '34s');
  }

  // Hail: small pellets, each with a white glint and a long faint streak
  // behind, falling fast and nearly straight. Each stone hits the split
  // (or, blown left, the screen's left edge) and keeps going until its
  // streak has passed; about 1 in 6 hops off what it hit.
  buildHail() {
    const rand = seeded(41), b = this.b;
    const k = Math.tan(10 * Math.PI / 180) * this.dir;
    const hrand = seeded(43);                  // hop variety, kept apart so the stones' layout doesn't shift
    const drops = this.q('.hail .drops'), hops = this.q('.hail .bounces');
    drops.replaceChildren();
    hops.replaceChildren();
    this.hopAnims?.forEach(a => a.cancel());
    this.hopAnims = [];
    const n = 56 * b.k, norm = 130 * Math.max(1, (b.w + b.h) / 200);
    // [depth, share, fall speed (units/s), pellet radius, streak length]
    for (const [depth, share, speed, r, tail] of [['far', .45, 82, .32, 6], ['mid', .35, 102, .41, 7.6], ['near', .2, 124, .5, 9.2]]) {
      const g = svgEl('g', { class: `hl-${depth}` }, drops);
      const y0 = b.y0 - tail - 2;
      let made = 0, tries = 0;
      while (made < Math.round(n * share) && tries++ < 20000) {
        const x0 = this._startX(rand, 20);
        const tLine = (100 - x0 - y0) / (1 + k);              // reaches the split
        const tEdge = k < 0 ? (x0 - b.x0) / -k : Infinity;    // reaches the left edge (blown left)
        const tHit = Math.min(tLine, tEdge), edge = tEdge < tLine;
        if (tHit < tail || y0 + tHit < b.y0 + 5) continue;    // none land in the top 5% (too short a fall)
        if (rand(0, 1) > tHit / norm) continue;               // even density
        const total = tHit + tail * 1.2;
        const dur = total / speed;
        const delay = -rand(0, dur);
        const fall = svgEl('g', { class: 'fall', style: `--tx:${f(k * total)}px;--ty:${f(total)}px;--t:${f(dur)}s;--d:${f(delay)}s` }, g);
        const stone = svgEl('g', { transform: `translate(${f(x0)} ${f(y0)}) rotate(${(-10 * this.dir).toFixed(1)})` }, fall);
        svgEl('path', { class: 'hs', d: `M${f(-r * .45)} ${f(-r * .4)}L${f(r * .45)} ${f(-r * .4)}L0 ${f(-r - tail)}Z` }, stone);
        svgEl('circle', { class: 'hp', r }, stone);
        svgEl('circle', { class: 'hg', cx: f(-r * .35), cy: f(-r * .35), r: f(r * .3) }, stone);
        // About 1 in 6 hop off what they hit: up and to the left off the
        // split, to the right off the left edge. Hops are events: none
        // with reduced motion.
        const ex = x0 + k * tHit, ey = y0 + tHit;
        if (rand(0, 1) < 1 / 6 && ey > b.y0 && ey < b.y1) {
          const reach = 3 * hrand(.85, 1.15), lift = 2.4 * hrand(.75, 1.25), secs = .75 * hrand(.8, 1.2);
          if (reduced.matches) { made++; continue; }
          const at = svgEl('g', { transform: `translate(${f(Math.max(ex, b.x0 + r))} ${f(ey)})` }, hops);
          const bx = edge ? reach : -reach, by = edge ? -.4 : -.8;
          const hp = svgEl('g', { class: `hop hl-${depth}` }, at);
          svgEl('circle', { r: f(r * .8) }, hp);
          // About three quarters of a second whatever the stone's speed, so
          // its keyframes are set per stone, synced to the landing.
          const hf = Math.min(.9, secs / dur);
          this.hopAnims.push(hp.animate([
            { offset: 0, opacity: 1, transform: 'translate(0, 0)' },
            { offset: hf * .45, opacity: 1, transform: `translate(${f(bx * .5)}px, ${f(-lift)}px)` },
            { offset: hf, opacity: 0, transform: `translate(${f(bx)}px, ${by}px)` },
            { offset: 1, opacity: 0, transform: `translate(${f(bx)}px, ${by}px)` },
          ], { duration: dur * 1000, iterations: Infinity, delay: (delay + tHit / total * dur) * 1000, easing: 'linear' }));
        }
        made++;
      }
    }
  }

  // Snow sheets: full (snowy, settles) and mixed with rain (snowy-rainy,
  // splashes like rain). Puffs fall slowly, sway side to side, and drift
  // further with the wind than rain does.
  buildSnow() {
    const rand = seeded(31), b = this.b;
    const k = Math.tan(30 * Math.PI / 180) * this.dir;
    const norm = 160 * Math.max(1, (b.w + b.h) / 200);
    for (const [sel, mix] of [['.snow-full', false], ['.snow-mix', true]]) {
      const drops = this.q(`${sel} .drops`), splashes = this.q(`${sel} .splashes`);
      drops.replaceChildren();
      splashes.replaceChildren();
      const n = (mix ? 50 : 240) * b.k;
      // [depth, share, fall speed (units/s), radius, sway]
      for (const [depth, share, speed, r, sway] of [['far', .45, 6, .45, 1.5], ['mid', .35, 8, .62, 2.3], ['near', .2, 10, .85, 3.3]]) {
        const g = svgEl('g', { class: `sf-${depth}` }, drops);
        const y0 = b.y0 - 2;
        let made = 0, tries = 0;
        while (made < Math.round(n * share) && tries++ < 20000) {
          const x0 = this._startX(rand, 60);
          const tLine = (100 - x0 - y0) / (1 + k);
          if (tLine < 2) continue;
          if (rand(0, 1) > tLine / norm) continue;           // even density
          const total = tLine + r * 3 + sway;                // until fully past the split
          const dur = total / speed;
          const delay = -rand(0, dur);
          const fall = svgEl('g', { class: 'fall', style: `--tx:${f(k * total)}px;--ty:${f(total)}px;--t:${f(dur)}s;--d:${f(delay)}s` }, g);
          const w = svgEl('g', { class: 'sway', style: `--sa:${sway}px;--sp:${f(rand(1.8, 3.4))}s;--sd:${f(-rand(0, 3))}s` }, fall);
          svgEl('circle', { class: 'fsh', cx: f(x0 + r * .3), cy: f(y0 + r * .3), r }, w);
          svgEl('circle', { class: 'fbd', cx: f(x0), cy: f(y0), r }, w);
          const ex = x0 + k * tLine, ey = y0 + tLine;
          if (mix && rand(0, 1) < 1 / 7 && ex > b.x0 && ey > b.y0 && ey < b.y1) {
            const at = svgEl('g', { transform: `translate(${f(ex)} ${f(ey)})` }, splashes);
            const sp = svgEl('g', { class: `spl sf-${depth}`, style: `--t:${f(dur)}s;--d:${f(delay + tLine / total * dur)}s` }, at);
            svgEl('circle', { cx: -.8, cy: -.5, r: .32 }, sp);
            svgEl('circle', { cx: .8, cy: -.5, r: .32 }, sp);
            svgEl('circle', { cx: 0, cy: -1, r: .25 }, sp);
          }
          made++;
        }
      }
    }
  }

  // Settled snow in the bottom corner, drawn at full depth; CSS scales it
  // with --wx-snow. One smooth drift, deepest in the corner, sweeping up
  // the screen's left edge and up the split. On wide screens the corner is
  // the screen's own, so the drift also runs along the bottom to the split.
  buildAccumulation() {
    const b = this.b, el = this.q('.acc-corner');
    const wide = b.x0 < -.01;
    el.classList.toggle('wide', wide);
    // Origin: where the split meets the bottom (the square's corner).
    // Up the left edge is -y, up the split is (+x, -y).
    const rise = 'C20 -23 40 -42 77.8 -77.8';
    if (!wide) { el.setAttribute('d', `M0 -56C1.2 -41 4.8 -27 11 -22${rise}L0 0Z`); return; }
    const L = b.x0, D = -L;
    el.setAttribute('d', `M${f(L)} -56C${f(L + 1.2)} -41 ${f(L + 4.8)} -27 ${f(L + 11)} -22`
      + `C${f(L + 11 + D * .4)} -17 ${f(11 - D * .4)} -17 11 -22${rise}L0 0L${f(L)} 0Z`);
  }

  // Positions that follow the text and the alert row, in pixels: the
  // alert band's top (null when hidden) and the clock numerals' baseline.
  place({ band = null, clock = null } = {}) {
    this.marksPx = { band, clock };
    const S = this.W && Math.min(this.W, this.H) / 100, b = this.b;
    if (!S) return;
    const toY = px => px == null ? null : b.y0 + px / S;
    this.marks = { band: toY(band), clock: toY(clock) };
    this.root.dataset.alert = band == null ? '0' : '1';
    if (this.marks.band != null) this._alertSnow(this.marks.band);
    // The fog ribbon over the bottom of the clock.
    if (this.marks.clock != null) this.q('.fog-front').setAttribute('d', this._fogBand(this.marks.clock - 1.25, .5, 40, 2.4, 1, .75));
  }
  // Snow on the alert row: one continuous layer across the full width with
  // a wavy, windblown top, deepest toward the left of the clock.
  _alertSnow(top) {
    const b = this.b;
    const TOP = [[0, 2.5], [5, 2.3], [10, 2.2], [14, 2.6], [18, 2.9], [22, 3.0], [28, 3.2], [36, 3.5], [44, 3.3],
                 [52, 3.1], [60, 3.0], [68, 2.9], [76, 2.8], [84, 2.6], [92, 2.4], [100, 2.3]];
    const pts = TOP.map(([x, h]) => [b.x0 + x / 100 * b.w, -h]);
    let d = `M${f(b.x0)} 0L${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {    // smooth curve through the depths
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
    }
    this.q('.acc-alert').setAttribute('d', `${d}L${f(b.x1)} 0Z`);
    this.q('.acc-alert-at').setAttribute('transform', `translate(0 ${f(top)})`);
  }

  // Time of day, in hours: now, and the sun's rise, peak and set (the moon
  // mirrors them around midnight).
  setSky(hours) {
    this.hours = hours;
    if (!this.b) return;
    const { now, sun: [rise, noon, set], midnight } = hours;
    const peakY = this.b.y0 + PEAK_BELOW_TOP, x = this.b.x0 + BODY_X;
    const moon = [set + MOON_OFFSET, midnight, rise - MOON_OFFSET];
    this.q('.sun-pos').setAttribute('transform', `translate(${f(x)} ${f(bodyAt(now, [rise, noon, set], peakY))})`);
    this.q('.moon-pos').setAttribute('transform', `translate(${f(x)} ${f(bodyAt(now, moon, peakY))})`);
  }

  setPhase(p) {
    if (p === this.phase) return;
    this.phase = p;
    const d = PHASES[p] ?? PHASES.waxing_gibbous;   // unknown: waxing gibbous
    this.q('.moon-lit').setAttribute('d', d);
    this.q('.moon-clip').setAttribute('d', d);
    this.q('.moon-rim').style.display = p === 'new_moon' ? 'inline' : 'none';
  }

  setSouth(on) { this.root.classList.toggle('wx-south', on); }

  // Day colors in effect (Håg's daylight). Stars and night visitors follow it.
  setDaylight(day) {
    if (day === this.day) return;
    if (this.day !== null) {
      // While the colors switch, cloud fills follow them directly.
      this.root.classList.add('wx-theming');
      clearTimeout(this.themeTimer);
      this.themeTimer = setTimeout(() => this.root.classList.remove('wx-theming'), 2600);
    }
    this.day = day;
    this.apply();
  }

  setCondition(c) {
    c = SCENES[c] ? c : 'none';
    if (c === this.cond) return;
    this.cond = c;
    this.apply();
  }

  // Wind bearing: a new direction must hold for two minutes before the
  // clouds, rain and streaks flip; near north or south it keeps the last.
  setWind(bearing) {
    const want = windDir(bearing), first = !this.windSeen, now = Date.now();
    if (want) this.windSeen = true;
    clearTimeout(this.windTimer);
    if (!want || want === this.dir) { this.windSince = null; return; }
    if (first) { this._flip(want); return; }   // the first direction: no wait
    this.windSince ??= now;
    if (now - this.windSince >= WIND_HOLD) { this.windSince = null; this._flip(want); }
    else this.windTimer = setTimeout(() => this.setWind(bearing), WIND_HOLD - (now - this.windSince) + 50);
  }
  _flip(dir) {
    this.dir = dir;
    this.root.classList.toggle('wx-left', dir < 0);
    if (this.b) { this.buildRain(); this.buildSnow(); this.buildHail(); }
  }

  // On screen or not: off screen, scripted animations pause (CSS ones
  // pause with the glance) and events stop.
  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    for (const svg of [this.under, this.over]) {
      for (const a of svg.getAnimations({ subtree: true })) {
        if (a instanceof CSSAnimation || a instanceof CSSTransition) continue;
        if (!v && a.playState === 'running') a.pause();
        else if (v && a.playState === 'paused') a.play();
      }
    }
    this.apply();
  }

  // Put each shared element in or out for the current condition, then
  // start or stop its events. `instant` skips the fades (first paint).
  apply(instant = false) {
    if (!this.b) return;
    const sc = SCENES[this.cond], night = this.day === false;
    if (instant) this.root.style.setProperty('--change', '0s');
    const on = (el, v) => this._show(el, !!v, instant);
    on(this.q('.sunv'), sc.sun);                 // below the horizon it's simply out of view
    on(this.q('.moonv'), sc.moon);
    on(this.q('.stars-a'), night && sc.stars >= 1);
    on(this.q('.stars-b'), night && sc.stars >= 2);
    for (const s of SLOTS) {
      const c = this.q(`.cloud[data-slot="${s.id}"]`), v = sc.clouds[s.id];
      if (v) c.dataset.v = v;                    // leaving clouds keep their color while they fade
      on(c, v);
    }
    this.root.dataset.wash = sc.wash || 'none';
    on(this.q('.rain-l'), sc.rain === 1);
    on(this.q('.rain-h'), sc.rain === 2);
    on(this.q('.hail'), sc.hail);
    for (const el of this._all('.fogv')) on(el, sc.fog);
    this.root.dataset.fog = sc.fog === 'some' ? 'some' : sc.fog ? '1' : '0';
    on(this.q('.windv'), sc.wind);
    for (const el of this._all('.excv')) on(el, sc.exc);
    on(this.q('.snow-full'), sc.snow === 'full');
    on(this.q('.snow-mix'), sc.snow === 'mix');
    this.root.dataset.snowing = sc.snow === 'full' ? '1' : '0';   // only plain snow settles
    this.root.dataset.lightning = sc.lightning ? '1' : '0';
    if (instant) { this.root.getBoundingClientRect(); this.root.style.removeProperty('--change'); }
    this._events();
  }

  // In or out; once faded out, switched off so it costs nothing.
  _show(el, v, instant) {
    clearTimeout(el._wxOff);
    if (v) {
      if (el.classList.contains('wx-off')) {
        el.classList.remove('wx-off');
        if (!instant) el.getBoundingClientRect();   // render it at opacity 0 first, so it fades in
      }
      el.dataset.on = '1';
    } else {
      el.dataset.on = '0';
      if (instant) el.classList.add('wx-off');
      else el._wxOff = setTimeout(() => { if (el.dataset.on === '0') el.classList.add('wx-off'); }, this.change * 1000 + 200);
    }
  }

  // Events run only on screen and without reduced motion. The tornado's
  // circling things are a loop, so they run whenever it's in and on screen.
  _events() {
    this._stopEvents();
    const sc = SCENES[this.cond];
    this.orbitAnims?.forEach(a => sc.exc && this.visible ? a.play() : a.pause());
    if (!this.visible || reduced.matches) return;
    if (sc.exc) this.scheduleDragon(rnd(4, 8));
    if (sc.wind) this.scheduleGust(rnd(3, 6));
    // Lightning comes last, once the storm clouds are in.
    if (sc.lightning) this.enableTimer = setTimeout(() => this.scheduleBurst(rnd(1.5, 4)), this.change * 850);
    // Shooting stars every 1–2 minutes; the space station every 5.
    const shoot = () => { this.shootTimer = setTimeout(() => { this.shoot(); shoot(); }, rnd(60, 120) * 1000); };
    shoot();
    this.stationTimer = setInterval(() => this.station(), 5 * 60 * 1000);
  }
  _stopEvents() {
    for (const t of ['dragonTimer', 'gustTimer', 'enableTimer', 'burstTimer', 'shootTimer']) clearTimeout(this[t]);
    clearInterval(this.stationTimer);
  }

  /* ----- Lightning: bursts of 2–3 strikes; burst starts at most 60 s apart ----- */
  scheduleBurst(sec) {
    clearTimeout(this.burstTimer);
    this.burstTimer = setTimeout(() => {
      if (!SCENES[this.cond].lightning) return;
      this.burst();
      this.scheduleBurst(rnd(20, 60));        // start to start
    }, sec * 1000);
  }
  burst() {
    if (reduced.matches || !this.visible) return;
    const n = Math.random() < .5 ? 2 : 3;
    let at = 0;
    for (let i = 0; i < n; i++) {
      setTimeout(() => this.strike(), at * 1000);
      at += rnd(1, 2.6);                       // at least 1 s apart: well under 3 flashes a second
    }
  }
  strike() {
    const r = Math.random(), double = Math.random() < .5;
    this.q('.flash').animate(double
      ? [{ opacity: 0 }, { opacity: .16, offset: .15 }, { opacity: .04, offset: .4 }, { opacity: .12, offset: .6 }, { opacity: 0 }]
      : [{ opacity: 0 }, { opacity: .16, offset: .3 }, { opacity: 0 }], { duration: double ? 380 : 220 });
    if (r > .8) return;                        // a flash with no bolt
    const ground = r < .5;
    const bolt = ground ? this.groundBolt() : this.cloudBolt();
    this.q(ground ? '.bolts' : '.bolts-front').append(bolt);   // ground strikes start behind the clouds
    bolt.animate([{ opacity: 0 }, { opacity: 1, offset: .08 }, { opacity: .35, offset: .3 }, { opacity: 1, offset: .45 }, { opacity: 0 }], { duration: 420 })
      .onfinish = () => bolt.remove();
  }
  jag(p0, p1, depth, disp) {               // midpoint displacement
    if (!depth) return [p0, p1];
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy);
    const off = rnd(-1, 1) * disp;
    const m = [(p0[0] + p1[0]) / 2 - dy / l * off, (p0[1] + p1[1]) / 2 + dx / l * off];
    return [...this.jag(p0, m, depth - 1, disp / 2).slice(0, -1), ...this.jag(m, p1, depth - 1, disp / 2)];
  }
  pathOf(pts) { return 'M' + pts.map(p => `${f(p[0])} ${f(p[1])}`).join('L'); }
  branch(g, pts, mainLen, width) {
    const i = 1 + Math.floor(rnd(1, pts.length - 3));
    const [a, c] = [pts[i - 1], pts[i]];
    const ang = Math.atan2(c[1] - a[1], c[0] - a[0]) + (Math.random() < .5 ? -1 : 1) * rnd(.45, .8);
    const l = mainLen * rnd(.2, .38);
    const end = [pts[i][0] + Math.cos(ang) * l, pts[i][1] + Math.sin(ang) * l];
    svgEl('path', { d: this.pathOf(this.jag(pts[i], end, 3, l * .22)), 'stroke-width': width }, g);
  }
  groundBolt() {                             // cloud to ground: ends on the split
    const g = svgEl('g');
    const y0 = rnd(26, 48), yEnd = rnd(Math.max(58, y0 + 16), 88);
    const p0 = [rnd(6, Math.min(46, 100 - y0 - 14)), y0], p1 = [100 - yEnd, yEnd];
    const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const pts = this.jag(p0, p1, 4, l * .18);
    svgEl('path', { d: this.pathOf(pts), 'stroke-width': .55 }, g);
    const n = Math.random() < .5 ? 1 : 2;
    for (let i = 0; i < n; i++) this.branch(g, pts, l, .32);
    return g;
  }
  cloudBolt() {                              // cloud to cloud: across the cloud band
    const g = svgEl('g');
    const y = rnd(12, 60);
    const p0 = [rnd(2, Math.max(4, 100 - y - 42)), y];
    const p1 = [Math.min(p0[0] + rnd(18, 34), 100 - y - 8), y + rnd(-6, 6)];
    const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const pts = this.jag(p0, p1, 4, l * .22);
    svgEl('path', { d: this.pathOf(pts), 'stroke-width': .42 }, g);
    if (Math.random() < .6) this.branch(g, pts, l, .26);
    return g;
  }

  /* ----- Night visitors (only when stars are out) ----- */
  starsOut() { return this.day === false && (SCENES[this.cond].stars || 0) >= 1 && !reduced.matches && this.visible; }
  shoot(again = true) {
    if (!this.starsOut()) return;
    // About 46 units in 1.3 s, with a long tail.
    const left = Math.random() < .5;
    const ang = (Math.random() < .5 ? 1 : -1) * rnd(15, 32) + (left ? 180 : 0);
    const x = left ? rnd(38, 72) : rnd(2, 30), y = rnd(3, 22);
    const outer = svgEl('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)})` }, this.q('.visitors'));
    const inner = svgEl('g', {}, outer);
    svgEl('polygon', { points: '0,-.3 0,.3 -14,0', fill: '#F6F1E3' }, inner);
    svgEl('circle', { r: .4, fill: '#FFFFFF' }, inner);
    inner.animate([
      { transform: 'translateX(0)', opacity: 0 },
      { transform: 'translateX(5px)', opacity: 1, offset: .12 },
      { transform: 'translateX(38px)', opacity: 1, offset: .8 },
      { transform: 'translateX(46px)', opacity: 0 },
    ], { duration: 1300, easing: 'ease-in' }).onfinish = () => outer.remove();
    // Now and then, a second one right behind it.
    if (again && Math.random() < .01) setTimeout(() => this.shoot(false), rnd(400, 900));
  }
  station() {
    if (!this.starsOut()) return;
    const from = [-3, 27], to = [44, -3];
    const ang = Math.atan2(to[1] - from[1], to[0] - from[0]) * 180 / Math.PI;
    const outer = svgEl('g', { transform: `translate(${from[0]} ${from[1]}) rotate(${ang.toFixed(1)})` }, this.q('.visitors'));
    const inner = svgEl('g', {}, outer);
    // A hint of the station's shape around a steady light.
    const hint = svgEl('g', { fill: '#8FA6C8', opacity: .45 }, inner);
    svgEl('rect', { x: -.7, y: -.25, width: 1.4, height: .5 }, hint);
    svgEl('rect', { x: -2.3, y: -.65, width: 1.3, height: 1.3 }, hint);
    svgEl('rect', { x: 1, y: -.65, width: 1.3, height: 1.3 }, hint);
    const light = svgEl('circle', { r: .45, fill: '#FFFFFF' }, inner);
    // Blinks like an airplane (not realistic, on purpose): dim, then a quick double strobe.
    light.animate([
      { opacity: .35 }, { opacity: .35, offset: .7 }, { opacity: 1, offset: .72 }, { opacity: .35, offset: .76 },
      { opacity: 1, offset: .8 }, { opacity: .35, offset: .84 }, { opacity: .35 },
    ], { duration: 1500, iterations: Infinity });
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    inner.animate([
      { transform: 'translateX(0)', opacity: 0 },
      { transform: `translateX(${dist * .08}px)`, opacity: 1, offset: .08 },
      { transform: `translateX(${dist * .92}px)`, opacity: 1, offset: .92 },
      { transform: `translateX(${dist}px)`, opacity: 0 },
    ], { duration: 25000 }).onfinish = () => outer.remove();
  }
}
