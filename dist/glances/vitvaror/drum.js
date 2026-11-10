/*
  Appliances glance: the drum. One drum on the screen's center, shared by
  the machines shown: one fills it; two take halves on the split; three
  take thirds, one edge on the split toward the upper right. The ground
  splits along the same lines. Each part holds its machine's contents, a
  progress ring on the rim and its text. A washer: water and tumbling
  clothes; a dryer: tumbling clothes; a washer-dryer: either, by its
  phase; a dishwasher: its racks from above, the spray arm turning on the
  center.
  License: GPL-3.0
*/

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, parent) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent?.append(el);
  return el;
};
const rad = d => d * Math.PI / 180;
const lerp = (a, b, e) => a + (b - a) * e;
const ease = u => u < .5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;   // in and out
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let clips = 0;   // clip path IDs, unique on the page

// Kinds in order: parts go to machines in this order, two of a kind in
// the order they started.
export const KINDS = { washer: 'Washer', washer_dryer: 'Washer-dryer', dryer: 'Dryer', dishwasher: 'Dishwasher' };
const RANK = Object.fromEntries(Object.keys(KINDS).map((k, i) => [k, i]));
// What's drawn: a washer-dryer is a dryer while drying.
const drawn = m => m.kind === 'washer_dryer' ? (['dry', 'cool'].includes(m.phase) ? 'dryer' : 'washer') : m.kind;

// Parts: each machine's wedge [from, to] in degrees (0 = right,
// clockwise; 1:30 on a clock is -45), in kind order. Halves: left, then
// right. Thirds: lower left, right, top.
const HALVES = [[135, 315], [-45, 135]];
const THIRDS = [[75, 195], [-45, 75], [195, 315]];
function parts(active) {
  if (active.length === 1) return [{ key: active[0], from: -45, to: 315 }];
  const slots = active.length === 2 ? HALVES : THIRDS;
  return active.map((key, i) => ({ key, from: slots[i][0], to: slots[i][1] }));
}

// While the alert row shows, thirds turn 15° clockwise into a Y.
const Y_TURN = 15, TURN_TIME = 700;   // degrees; ms, as Håg's moves
const CLOCK_SIZE = 1.5;               // the clock's numerals, to the machines' names

export const DRUM_STYLE = `
  .stage {
    position: absolute; inset: 0; overflow: hidden; background: var(--home);
    --n-rim: #8D97A7;    --d-rim: #A7B3C3;      /* steel */
    --n-rim-sh: #626B7B; --d-rim-sh: #7D8999;   /* steel, shadow side */
    --n-water: #3C6E96;  --d-water: #5BB1E6;
    --rim: color-mix(in oklab, var(--d-rim) var(--day-mix), var(--n-rim));
    --rim-sh: color-mix(in oklab, var(--d-rim-sh) var(--day-mix), var(--n-rim-sh));
    --water: color-mix(in oklab, var(--d-water) var(--day-mix), var(--n-water));
    /* Inside the drum: light, by day and by night. */
    --in-drum: #E2E4E7; --in-water: #5BB1E6; --in-wire: #BCC0C6; --in-metal: #A9AEB5; --in-metal-sh: #7F848C;
    --in-text: var(--d-text); --in-text-2: var(--d-text-2); --in-coral: var(--d-coral);
    /* Each part's ground: the home color, tinted toward its machine. */
    --ground-washer: color-mix(in oklab, var(--home) 86%, var(--water));
    --ground-washer_dryer: var(--ground-washer);
    --ground-dryer: color-mix(in oklab, var(--home) 88%, var(--coral));
    --ground-dishwasher: color-mix(in oklab, var(--home) 88%, var(--seaglass));
  }
  /* Between glances Håg paints the ground. */
  :host([between]) .stage { background: none !important; }
  .stage svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .stage.paused *, .stage .paused * { animation-play-state: paused !important; }
  .labels { position: absolute; inset: 0; pointer-events: none; }
  /* Each part's text in two blocks, the name and its two lines. */
  .lab { position: absolute; transform: translateX(-50%); text-align: center; white-space: nowrap; line-height: 1.15; color: var(--in-text); }
  .lab .t2 { font-size: var(--size); }
  .lab .t3 { font-size: calc(var(--size) * .58); color: var(--in-text-2); }
  .lab.error .t3:first-of-type { color: var(--in-coral); }
  .ghost { position: absolute; inset: 0; pointer-events: none; }

  .drum { fill: var(--in-drum); }
  .veil { fill: var(--in-drum); opacity: .3; }   /* quiets the contents under the text */
  .rim { fill: none; stroke: var(--rim); }
  .rim-sh { fill: none; stroke: var(--rim-sh); }
  .glare { fill: #fff; opacity: .10; }
  .divider { stroke-linecap: round; }
  .track { fill: none; stroke: color-mix(in oklab, var(--text-2) 25%, transparent); stroke-linecap: round; }
  .arc { fill: none; stroke: var(--text-2); stroke-linecap: round; }
  .arc.done { stroke: var(--seaglass); }
  .arc.error { stroke: var(--coral); }
  /* --wash: the water, dyed pink by the red sock (set per part) */
  .water { fill: var(--wash, var(--in-water)); opacity: .85; }
  .bubble { fill: none; stroke: color-mix(in oklab, var(--wash, var(--in-water)), #fff 55%); }
  .wire { stroke: var(--in-wire); fill: none; }
  .arm { fill: var(--in-metal); }
  .spray { fill: color-mix(in oklab, var(--in-water), #fff 45%); }
  .steam { fill: none; stroke: color-mix(in oklab, var(--in-text-2) 55%, transparent); stroke-linecap: round; }
  .sparkle { fill: #fff; }

  /* Everything turns on the drum's center (transform-origin set inline). */
  @keyframes turn { to { rotate: 1turn; } }
  @keyframes rise { 0% { translate: 0 0; opacity: 0; } 30% { opacity: .9; } 100% { translate: 0 var(--rise); opacity: 0; } }
  @keyframes flicker { 0%, 100% { opacity: .2; } 50% { opacity: .9; } }
  .spin-arm { animation: turn 3s linear infinite; }
  .bubble, .steam { animation: rise 3s ease-out infinite; }
  .spray { animation: flicker .5s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .stage svg * { animation-duration: 0s !important; } }
`;

function wedgePath(cx, cy, r, from, to) {
  if (to - from >= 359.9) return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  const p = a => `${cx + r * Math.cos(rad(a))} ${cy + r * Math.sin(rad(a))}`;
  return `M${cx} ${cy}L${p(from)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${p(to)}Z`;
}
function arcPath(cx, cy, r, from, to) {
  if (to - from >= 359.9) to = from + 359.9;
  const p = a => `${cx + r * Math.cos(rad(a))} ${cy + r * Math.sin(rad(a))}`;
  return `M${p(from)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${p(to)}`;
}

// A steady random sequence, so a part looks the same each time it's drawn.
const seeded = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// A smooth closed outline through points (Catmull-Rom as cubic curves).
const smooth = pts => {
  const n = pts.length, P = i => pts[(i + n) % n];
  let d = `M${P(0)[0].toFixed(1)} ${P(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ` +
      `${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
};

// ---------- Laundry ----------

// Mostly whites and greys, a few muted tones; nothing loud. The easter
// egg: on a red sock run, the sock dyes the water and the lighter clothes
// pink (the glance says how pink).
const CLOTHES = ['#ECEAE4', '#E2DED5', '#F3F2EE', '#D3D6D9', '#B9BEC4', '#9AA1A9', '#7B828B', '#A7B1B9', '#B5AC9C', '#9CA596', '#C7BBAD', '#DCD8CF'];
const SOCK = { red: '#D7262E', dark: '#A31B22', light: '#F27470' }, PINK = '#F27A9B', DYED_WATER = '#E8558A';
// A clothes color dyed p of the way: whites take the most, darker pieces less.
const dye = (hex, p) => {
  if (!p) return hex;
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const a = rgb(hex), b = rgb(PINK), light = (Math.max(...a) + Math.min(...a)) / 510;
  const k = p * .55 * Math.min(1, Math.max(.3, (light - .4) / .45));
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join('');
};
// The load and water dyed p of the way (null: no sock).
function retint(g, p) {
  for (const el of g.querySelectorAll('[data-c]')) el.setAttribute('fill', dye(el.getAttribute('data-c'), p ?? 0));
  if (p) g.style.setProperty('--wash', `color-mix(in oklab, var(--in-water), ${DYED_WATER} ${Math.round(p * 45)}%)`);
  else g.style.removeProperty('--wash');
}

// Fabric, around 0,0: a lumpy wad, a twisted length (a sleeve, a towel
// wrung in the wash) or a tangle of two or three. Each with a fold or two
// and a soft highlight on the upper left. R: the size it's drawn at.
function fabric(el, rnd, R, color) {
  const kind = rnd() < .45 ? 'wad' : rnd() < .6 ? 'twist' : 'tangle';
  const crease = d => svgEl('path', { d, fill: 'none', stroke: '#000', 'stroke-opacity': .16, 'stroke-width': R * .012, 'stroke-linecap': 'round' }, el);
  const wad = (ox, oy, w, h, c) => {
    const n = 7 + Math.floor(rnd() * 3), pts = [];
    for (let k = 0; k < n; k++) {
      const t = k / n * 2 * Math.PI, j = .72 + rnd() * .45;
      pts.push([ox + Math.cos(t) * w / 2 * j, oy + Math.sin(t) * h / 2 * j]);
    }
    svgEl('path', { d: smooth(pts), fill: c, 'data-c': c }, el);
    svgEl('path', { d: smooth(pts.map(([x, y]) => [ox + (x - ox) * .45 - w * .12, oy + (y - oy) * .4 - h * .14])), fill: '#fff', opacity: .28 }, el);
    crease(`M${ox - w * .2} ${oy + h * .05}q${w * .15} ${h * .2} ${w * .35} ${h * .02}`);
    if (rnd() < .6) crease(`M${ox + w * .05} ${oy - h * .25}q${w * .1} ${h * .18} ${w * .02} ${h * .38}`);
  };
  const twist = (ox, oy, len, wide, c, turn) => {
    const n = 9, top = [], bottom = [], bend = (rnd() - .5) * len * .5;
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = ox + (t - .5) * len, y = oy + Math.sin(t * Math.PI) * bend;
      const half = wide / 2 * (.45 + .55 * Math.abs(Math.cos(t * Math.PI * 1.5 + turn)));   // pinched where it twists
      top.push([x, y - half]); bottom.unshift([x, y + half]);
    }
    svgEl('path', { d: smooth([...top, ...bottom]), fill: c, 'data-c': c }, el);
    for (let k = 1; k < 3; k++) {   // the twist's folds
      const t = k / 3, x = ox + (t - .5) * len, y = oy + Math.sin(t * Math.PI) * bend;
      crease(`M${x - wide * .3} ${y - wide * .4}q${wide * .35} ${wide * .4} ${wide * .1} ${wide * .8}`);
    }
    svgEl('path', { d: smooth(top.slice(1, -1).map(([x, y]) => [x, y + wide * .18])), fill: 'none', stroke: '#fff', 'stroke-opacity': .3, 'stroke-width': R * .012 }, el);
  };
  if (kind === 'wad') wad(0, 0, R * (.17 + rnd() * .13), R * (.11 + rnd() * .08), color);
  else if (kind === 'twist') twist(0, 0, R * (.3 + rnd() * .14), R * (.07 + rnd() * .04), color, rnd() * 3);
  else {
    // Tangled: a twisted length wrapped over a wad, sometimes a third piece.
    wad(-R * .04, R * .02, R * .16, R * .11, color);
    twist(R * .03, -R * .01, R * .3, R * .065, CLOTHES[Math.floor(rnd() * CLOTHES.length)], rnd() * 3);
    if (rnd() < .5) wad(R * .09, R * .04, R * .1, R * .07, CLOTHES[Math.floor(rnd() * CLOTHES.length)]);
  }
}

// The red sock, around 0,0 at the size fabric is drawn: leg and foot, a
// darker cuff, heel and toe, a light edge along the leg.
function drawSock(el, R) {
  const w = R * .08, P = (x, y) => `${(x * R).toFixed(1)} ${(y * R).toFixed(1)}`;
  const line = (d, stroke, width) => svgEl('path', { d, fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, el);
  line(`M${P(-.08, -.15)}L${P(-.05, .03)}Q${P(-.04, .09)} ${P(.03, .085)}L${P(.12, .08)}`, SOCK.red, w);
  line(`M${P(-.08, -.15)}L${P(-.076, -.12)}`, SOCK.dark, w * 1.04);
  line(`M${P(-.052, .062)}L${P(-.044, .074)}`, SOCK.dark, w * .92);
  line(`M${P(.112, .08)}L${P(.12, .08)}`, SOCK.dark, w * .96);
  line(`M${P(-.1, -.13)}L${P(-.073, .02)}`, SOCK.light, w * .22);
}

// Clothes, with weight: the drum drags the heap up its rising side (it
// slips, and slides back down when the drum slows); past a height pieces
// tumble off and drop, heavily, back onto the heap. Spinning presses the
// load to the wall; a cycle ended leaves it in a heap at the bottom.
// Washers turn one way then the other; dryers keep turning. Returns the
// load's motion (step), or null when it's still for good.
const SPEED = { wash: 2.6, rinse: 3, spin: 15, dry: 2.3, cool: 1.2 };   // radians per second
function clothes(g, cx, cy, R, m, kind, marks, mid, wv) {
  const rnd = seeded(kind === 'dryer' ? 7 : 3), ended = m.status === 'ended';
  // A full load: the heap fills the drum below a line a quarter of the
  // way down from its middle, in five layers from the wall inward.
  const LAYERS = 5, n = 30, pieces = [];
  for (let i = 0; i < n; i++) {
    const el = svgEl('g', {}, g), color = CLOTHES[Math.floor(rnd() * CLOTHES.length)];
    // The sock takes a rider's place; the piece is still drawn (unseen) so the rest of the load stays the same.
    if (m.pink != null && i === 6) { fabric(svgEl('g'), rnd, R * 1.65, color); drawSock(el, R * 1.65); }
    else fabric(el, rnd, R * 1.65, color);
    const layer = i % LAYERS, home = R * (.86 - layer * .11);
    const edge = Math.asin(Math.min(1, R * .25 / home)), slot = Math.floor(i / LAYERS), slots = Math.ceil(n / LAYERS);
    // Half the load rides up the rising side and tumbles over; the rest
    // churns in the bottom quadrant, each piece turning in place against
    // its neighbours and the wall, like gears.
    const rides = layer <= 1 || (layer === 2 && slot % 2 === 0);
    let ha = edge + (Math.PI - 2 * edge) * (slot + .5 + (rnd() - .5) * .6) / slots;   // its place in the heap
    if (!rides) ha = Math.PI / 2 + (ha - Math.PI / 2) * .55;
    pieces.push({ el, home, ha, held: true, a: ha, r: home, x: 0, y: 0, vx: 0, vy: 0, turn: rnd() * 360, spin: 0, rides,
      letGo: .05 + rnd() * .6, grip: rides ? .9 + rnd() * .1 : .08 + rnd() * .12,
      gear: (layer % 2 ? -1 : 1) * (2.2 + rnd() * 1.4) });   // its turn per drum turn: neighbouring layers counter-rotate
  }
  retint(g, m.pink);
  const s = { cx, cy, R, kind, phase: m.phase, pieces, marks, dir: rising(mid), water: wv, drum: 0, t: 0,
    still: m.status === 'paused' || reduce.matches };
  for (const p of s.pieces) placePiece(s, p);
  return ended ? null : s;
}
// Turning lifts the load up the side its part shows: clockwise on the
// left (up from the bottom), the other way on the right.
const rising = mid => Math.cos(rad(mid)) < 0 ? 1 : -1;
// A rebuilt load picks up where the old one was, so nothing jumps.
function carry(from, to) {
  if (from.pieces.length !== to.pieces.length) return;
  Object.assign(to, { drum: from.drum, t: from.t });
  if (from.water && to.water) to.water.tilt = from.water.tilt;
  from.pieces.forEach((p, i) => {
    const { held, a, r, x, y, vx, vy, turn, spin, letGo } = p;
    Object.assign(to.pieces[i], { held, a, r, x, y, vx, vy, turn, spin, letGo });
    placePiece(to, to.pieces[i]);
  });
}

function placePiece(s, p) {
  if (p.held) { p.x = s.cx + p.r * Math.cos(p.a); p.y = s.cy + p.r * Math.sin(p.a); }
  p.el.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.turn.toFixed(1)})`);
}

// One step of the drum and its load.
function step(s, dt) {
  s.t += dt;
  let w = (SPEED[s.phase] ?? 2) * s.dir;
  if (s.phase === 'wash' || s.phase === 'rinse') {
    // Washers rock: a few turns one way, a pause, then back.
    const cycle = s.phase === 'wash' ? 6 : 4.5, u = s.t % (2 * cycle);
    w = (u % cycle) > cycle - .8 ? 0 : u < cycle ? w : -w;
  }
  s.drum += w * dt;
  s.marks?.setAttribute('transform', `rotate(${(s.drum * 180 / Math.PI).toFixed(1)} ${s.cx} ${s.cy})`);
  if (s.water) {   // the surface leans with the drum, lagging a little
    const wv = s.water;
    wv.tilt += (Math.max(-.24, Math.min(.24, w * .1)) - wv.tilt) * Math.min(1, dt * 1.6);
    drawWater(s, wv, s.t);
  }
  const g = s.R * 6;   // gravity, px/s²: heavy, wet cloth
  for (const p of s.pieces) {
    if (s.phase === 'spin') {   // pressed to the wall, turning with the drum
      p.held = true; p.r += (s.R * .82 - p.r) * Math.min(1, dt * 4); p.a += w * dt; p.turn += w * dt * 57.3;
    } else if (p.held) {
      p.r += (p.home - p.r) * Math.min(1, dt * 3);
      // Carried by the drum, slipping; riders go round with it while it
      // turns, and the heap (and a rider when the drum stops) slides back
      // toward its place.
      const da = p.rides && Math.abs(w) > .3 ? w * p.grip : w * p.grip + 1.6 * Math.sin(p.ha - p.a);
      p.a += da * dt;
      p.turn += (p.rides ? da : w * p.gear) * dt * 57.3;   // riders turn with the drum; the heap churns
      // High enough, and it falls (also when the drum stops).
      if (s.cy + p.r * Math.sin(p.a) < s.cy - s.R * p.letGo) {
        p.held = false;
        p.x = s.cx + p.r * Math.cos(p.a); p.y = s.cy + p.r * Math.sin(p.a);
        const v = w * p.grip * p.r * .8;   // thrown off with the drum's speed, but heavy
        p.vx = -Math.sin(p.a) * v; p.vy = Math.cos(p.a) * v;
        p.spin = (Math.random() - .5) * 220;
      }
    } else {
      p.vy += g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.turn += p.spin * dt;
      const dx = p.x - s.cx, dy = p.y - s.cy, d = Math.hypot(dx, dy);
      // Back on the heap: low in the drum at its resting depth, or at the wall.
      if ((dy > 0 && d >= p.home) || d >= s.R * .88) {
        p.held = true; p.a = Math.atan2(dy, dx); p.r = Math.min(d, s.R * .88);
        p.letGo = .05 + Math.random() * .6;
      }
    }
    placePiece(s, p);
  }
}

// Water: low in the drum. As the drum turns it drags the water up the
// wall that's rising, tilting the surface, with small travelling waves;
// it settles back when the drum stops. None while spinning or drying.
// Returns what step() redraws.
function water(g, cx, cy, R, phase, ended) {
  if (phase === 'spin' || phase === 'dry' || phase === 'cool') return null;
  const wv = { level: cy + (ended ? R * .66 : phase === 'rinse' ? R * .3 : R * .36), tilt: 0 };
  const w = svgEl('g', { class: 'water' }, g);
  wv.body = svgEl('path', {}, w);
  wv.foam = svgEl('path', { fill: 'none', stroke: 'color-mix(in oklab, var(--wash, var(--in-water)), #fff 35%)', 'stroke-width': R * .022, 'stroke-linejoin': 'round' }, w);
  if (!ended) for (let i = 0; i < 6; i++) {
    svgEl('circle', { class: 'bubble', cx: cx + (i - 2.5) * R * .25, cy: wv.level + R * .4, r: R * (.022 + (i % 3) * .01), 'stroke-width': R * .011,
      style: `--rise:${-R * .35}px; animation-delay:${-i * .5}s` }, g);
  }
  drawWater({ cx, cy, R }, wv, 0);
  return wv;
}

function drawWater({ cx, cy, R }, wv, t) {
  const x0 = cx - R * 1.05, x1 = cx + R * 1.05, n = 48, dir = wv.tilt >= 0 ? 1 : -1;   // waves travel with the drag
  const surface = x => wv.level + wv.tilt * (x - cx)
    + R * .022 * Math.sin((x - cx) / R * 7 - t * 2.6 * dir) + R * .01 * Math.sin((x - cx) / R * 15 + t * 3.3);
  let line = '';
  for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; line += `${i ? 'L' : 'M'}${x.toFixed(1)} ${surface(x).toFixed(1)}`; }
  wv.body.setAttribute('d', `${line}L${x1} ${cy + R * 1.2}L${x0} ${cy + R * 1.2}Z`);
  wv.foam.setAttribute('d', line);
}

// ---------- Dishes ----------

// A full load from above, tipped a little toward the viewer (rounds
// squashed, a side showing below each rim). Packed so nothing piles on
// anything else, loosely sorted: plates down the left, bowls and glasses
// up top, mugs and pots on the right, pans along the bottom; gaps filled
// with smaller pieces. Muted china, glass and steel. Two layers of food
// fade in turn: the big smears first, then the small bits. A three-arm
// sprayer turns on the drum's center, its drops flickering along the
// arms. Drying steams; a cycle ended sparkles.
const TILT = .84;   // how round things squash, seen at a slight angle
const DISH = {
  plate: '#EFEBE3', plate2: '#F5F4F0', side: '#CDC7BC', bowl: '#E4E0D8', mug: '#C9CED3', mug2: '#B9AE9F',
  glass: '#D7E0E6', steel: '#B4BAC1', steelSide: '#868D96', steelIn: '#9BA2AA', pan: '#3F4348', panRim: '#5A5F66',
};
const FOOD = ['#7A5A3A', '#8E5A44', '#7D7A4F', '#6B4E36', '#A07A52'];   // muted sauce, crumbs and greens
// [kind, count, angle from°, to°, radius from, to (of R), size (of R)]
const LOAD = [
  ['pan', 3, 50, 150, .5, .76, .19], ['pot', 3, -15, 50, .42, .74, .21], ['pot', 1, 145, 175, .5, .7, .19],
  ['plate', 9, 160, 250, .4, .86, .2], ['bowl', 4, 240, 292, .35, .84, .155],
  ['glass', 5, 285, 345, .3, .86, .1], ['mug', 3, 330, 370, .35, .86, .11],
];
const FILL = [['plate2', .15], ['bowl', .13], ['mug2', .1], ['glass', .09]];   // gap fillers, biggest first
const FOOT = { plate: 1, plate2: 1, bowl: 1, glass: 1.05, mug: 1.3, mug2: 1.3, pot: 1.25, pan: 1.15 };   // footprint, of size (a pan's handle lies along the rim)
// How far the wash has come without progress from the machine: by phase.
const WASHED = { wash: .25, rinse: .6, dry: 1 };
const washed = m => m.progress ?? WASHED[m.phase] ?? 0;

function dishes(g, cx, cy, R, part, m) {
  const ended = m.status === 'ended', p = washed(m), wet = ended || m.phase === 'dry' ? 0 : 1;
  // Big smears go first (gone by 40%), then the small bits (30% to 75%).
  const big = wet * Math.max(0, 1 - p / .4), small = wet * Math.min(1, Math.max(0, 1 - (p - .3) / .45));
  const rnd = seeded(5);   // the layout: the same at every progress
  const grid = R * .2;
  for (let k = -5; k <= 5; k++) {
    svgEl('line', { class: 'wire', x1: cx + k * grid, y1: cy - R, x2: cx + k * grid, y2: cy + R, 'stroke-width': R * .01, opacity: .7 }, g);
    svgEl('line', { class: 'wire', x1: cx - R, y1: cy + k * grid, x2: cx + R, y2: cy + k * grid, 'stroke-width': R * .01, opacity: .7 }, g);
  }
  const ell = (x, y, rx, fill, extra = {}) => svgEl('ellipse', { cx: x, cy: y, rx, ry: rx * TILT, fill, ...extra }, g);
  // Food, two layers, where it collects on each kind of dish: smears in
  // a plate's well with crumbs along the well's edge; a pool in a bowl's
  // bottom with bits up its wall; burnt patches in a pan or pot with crud
  // packed into the corner where wall meets base; a ring in a mug; film in
  // a glass. Each dish has its own random sequence, so the load stays put.
  let dishNo = 0;
  function stains(kind, x, y, s) {
    const fr = seeded(101 + dishNo++);
    const color = () => FOOD[Math.floor(fr() * FOOD.length)];
    const blob = (ox, oy, rx, ry, alpha, c = color()) => {
      if (alpha <= 0) return;
      const pts = [], n = 7;
      for (let k = 0; k < n; k++) {
        const t = k / n * 2 * Math.PI, j = .65 + fr() * .5;
        pts.push([x + ox * s + Math.cos(t) * rx * s * j, y + oy * s + Math.sin(t) * ry * s * j * TILT]);
      }
      svgEl('path', { d: smooth(pts), fill: c, opacity: alpha * .85 }, g);
    };
    const crumbs = (n, ring, spread, alpha, size = .035) => {
      if (alpha <= 0) return;
      for (let k = 0; k < n; k++) {
        const t = fr() * 6.3, rr = ring * (1 + (fr() - .5) * spread) * s, sz = s * size * (.6 + fr() * .9);
        const cx2 = x + Math.cos(t) * rr, cy2 = y + Math.sin(t) * rr * TILT;
        svgEl('ellipse', { cx: cx2, cy: cy2, rx: sz, ry: sz * (.6 + fr() * .4), transform: `rotate(${fr() * 180} ${cx2} ${cy2})`, fill: color(), opacity: alpha * (.75 + fr() * .25) }, g);
      }
    };
    const ring = (rr, width, alpha, c = color(), oy = 0) => alpha > 0 &&
      svgEl('ellipse', { cx: x, cy: y + oy * s, rx: rr * s, ry: rr * s * TILT, fill: 'none', stroke: c, 'stroke-width': width * s, opacity: alpha * .7 }, g);
    if (kind === 'plate') {
      blob((fr() - .5) * .3, (fr() - .5) * .25, .34, .24, big);
      blob((fr() - .5) * .4, (fr() - .5) * .3, .2, .14, big);
      crumbs(14, .6, .12, small); crumbs(4, .2, .9, small);
    } else if (kind === 'bowl') {
      blob(0, .08, .42, .3, big);
      crumbs(11, .62, .14, small);
    } else if (kind === 'pot' || kind === 'pan') {
      blob((fr() - .5) * .3, .06, .45, .34, big);
      blob((fr() - .5) * .3, .04, .22, .16, big, '#3E3328');   // burnt on
      crumbs(18, .8, .07, small, .04);                       // packed into the corner
    } else if (kind === 'mug') {
      ring(.6, .09, big, '#6B4E36', .04);                     // the coffee line
      crumbs(5, .45, .4, small);
    } else if (kind === 'glass') {
      blob(0, .3, .6, .25, big * .55, FOOD[0]);               // a milky film
      ring(.55, .06, small, FOOD[4], .35);                    // the last of it, at the base
    }
  }
  const sparkle = (x, y, s) => svgEl('path', { class: 'sparkle', d: `M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z` }, g);
  const DRAW = {
    plate: (x, y, s, a, c = DISH.plate) => { ell(x, y + s * .06, s, DISH.side); ell(x, y, s, c); ell(x, y, s * .62, 'none', { stroke: DISH.side, 'stroke-width': s * .05 }); stains('plate', x, y, s); },
    plate2: (x, y, s, a) => DRAW.plate(x, y, s, a, DISH.plate2),
    bowl: (x, y, s) => { ell(x, y + s * .12, s, DISH.side); ell(x, y, s, DISH.bowl); ell(x, y + s * .06, s * .7, DISH.side, { opacity: .6 }); stains('bowl', x, y, s); },
    mug: (x, y, s, a, c = DISH.mug) => {
      svgEl('rect', { x: x + s * .75, y: y - s * .1, width: s * .45, height: s * .55, rx: s * .2, fill: 'none', stroke: c, 'stroke-width': s * .16 }, g);
      ell(x, y + s * .2, s, c, { opacity: .85 }); ell(x, y, s, c); ell(x, y + s * .05, s * .72, '#000', { opacity: .18 }); stains('mug', x, y, s);
    },
    mug2: (x, y, s, a) => DRAW.mug(x, y, s, a, DISH.mug2),
    glass: (x, y, s) => {
      ell(x, y + s * .45, s * .85, DISH.glass, { opacity: .35 });
      svgEl('rect', { x: x - s, y, width: 2 * s, height: s * .45, fill: DISH.glass, opacity: .3 }, g);
      ell(x, y, s, DISH.glass, { opacity: .55, stroke: '#fff', 'stroke-width': s * .1 });
      stains('glass', x, y, s);
    },
    pot: (x, y, s) => {
      for (const side of [-1, 1]) svgEl('rect', { x: x + side * s * 1.05 - s * .18, y: y - s * .1, width: s * .36, height: s * .22, rx: s * .1, fill: DISH.steelSide }, g);
      ell(x, y + s * .22, s, DISH.steelSide); ell(x, y, s, DISH.steel); ell(x, y + s * .08, s * .82, DISH.steelIn); stains('pot', x, y + s * .08, s);
    },
    pan: (x, y, s, a) => {   // the handle along the rim, out of the others' way
      const t = rad(a + 90), hx = x + Math.cos(t) * s * 1.7, hy = y + Math.sin(t) * s * 1.7 * TILT;
      svgEl('line', { x1: x, y1: y, x2: hx, y2: hy, stroke: DISH.pan, 'stroke-width': s * .22, 'stroke-linecap': 'round' }, g);
      ell(x, y + s * .1, s, DISH.panRim); ell(x, y, s, DISH.pan); ell(x, y, s * .85, '#fff', { opacity: .05 }); stains('pan', x, y, s);
    },
  };

  // Packed: a few tries for each spot; none may sit on another (a sliver
  // of overlap allowed), on the sprayer's hub or past the rim. Plates
  // stand in rows, leaning on each other, so they may overlap more.
  const placed = [{ x: cx, y: cy, r: R * .12 }];
  const flat = k => k === 'plate' || k === 'plate2';
  const fits = (x, y, r, kind) => Math.hypot(x - cx, (y - cy) / TILT) + r * .8 <= R * .95 &&
    placed.every(q => Math.hypot(x - q.x, y - q.y) >= (r + q.r) * (flat(kind) && flat(q.kind) ? .62 : .84));
  const put = (kind, a0, a1, r0, r1, size, tries) => {
    for (let t = 0; t < tries; t++) {
      const a = a0 + (a1 - a0) * rnd(), r = (r0 + (r1 - r0) * rnd()) * R, s = size * R * (.92 + rnd() * .16);
      const x = cx + Math.cos(rad(a)) * r, y = cy + Math.sin(rad(a)) * r * TILT, foot = s * (FOOT[kind] || 1);
      if (!fits(x, y, foot, kind)) continue;
      placed.push({ x, y, r: foot, kind });
      DRAW[kind](x, y, s, a);
      if (ended && rnd() < .4) sparkle(x + s * .4, y - s * .35, s * .3);
      return true;
    }
    return false;
  };
  for (const [kind, n, a0, a1, r0, r1, size] of LOAD) for (let i = 0; i < n; i++) put(kind, a0, a1, r0, r1, size, 300);
  // Fill the gaps, smaller pieces last, until nothing more fits.
  for (const [kind, size] of FILL) { let misses = 0; while (misses < 4) if (!put(kind, 0, 360, .18, .92, size, 400)) misses++; }

  // Three-arm sprayer on the center, turning while it washes and rinses,
  // fine drops flickering along each arm.
  const washing = !ended && (m.phase === 'wash' || m.phase === 'rinse');
  const arm = svgEl('g', { class: washing ? 'spin-arm' : '', style: `transform-origin:${cx}px ${cy}px` }, g);
  for (let k = 0; k < 3; k++) {
    const tip = svgEl('g', { transform: `rotate(${k * 120} ${cx} ${cy})` }, arm);
    svgEl('path', { class: 'arm', d: `M${cx} ${cy - R * .06}L${cx + R * .74} ${cy - R * .03}Q${cx + R * .8} ${cy} ${cx + R * .74} ${cy + R * .03}L${cx} ${cy + R * .06}Z` }, tip);
    if (washing) for (let j = 1; j <= 12; j++) {
      svgEl('circle', { class: 'spray', cx: cx + j * R * .06, cy: cy + (j % 2 ? -1 : 1) * R * (.065 + (j % 3) * .012), r: R * (.011 + (j % 3) * .002),
        style: `animation-delay:${-(j * .07 + k * .13)}s` }, tip);
    }
  }
  svgEl('circle', { class: 'arm', cx, cy, r: R * .11 }, arm);
  svgEl('circle', { cx, cy, r: R * .045, fill: 'var(--in-metal-sh)' }, arm);
  if (!ended && m.phase === 'dry') {
    const mid = (part.from + part.to) / 2, half = (part.to - part.from) / 2;
    for (let k = 0; k < 6; k++) {
      const ang = rad(mid + (k - 2.5) * half / 3.2), x = cx + R * .55 * Math.cos(ang), y = cy + R * .55 * Math.sin(ang);
      svgEl('path', { class: 'steam', d: `M${x} ${y}q${R * .06} ${-R * .08} 0 ${-R * .16}t0 ${-R * .16}`, 'stroke-width': R * .025,
        style: `--rise:${-R * .25}px; animation-delay:${-k * .5}s` }, g);
    }
  }
}

// What a part's inside shows; when it changes, the inside is drawn again.
// A dishwasher's food fades with progress, in steps of 5%.
const lookOf = m => `${drawn(m)} ${m.status} ${m.phase} ${m.kind === 'dishwasher' ? Math.round(washed(m) * 20) : ''}`;

// Distance between a segment and a box [left, top, right, bottom]; 0 where they cross.
function segBox(x0, y0, x1, y1, [l, t, r, b]) {
  const dx = x1 - x0, dy = y1 - y0;
  let lo = 0, hi = 1;
  for (const [p, q] of [[-dx, x0 - l], [dx, r - x0], [-dy, y0 - t], [dy, b - y0]]) {
    if (!p) { if (q < 0) { lo = 2; break; } continue; }
    if (p < 0) lo = Math.max(lo, q / p); else hi = Math.min(hi, q / p);
  }
  if (lo <= hi) return 0;
  const toBox = (x, y) => Math.hypot(Math.max(l - x, 0, x - r), Math.max(t - y, 0, y - b));
  const toSeg = (x, y) => {
    const u = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x0 + u * dx - x, y0 + u * dy - y);
  };
  return Math.min(toBox(x0, y0), toBox(x1, y1), toSeg(l, t), toSeg(r, t), toSeg(l, b), toSeg(r, b));
}

// ---------- The drum ----------

/*
  new Drum(stage, { band, gap }): draws in `stage` (an svg and a .labels
  box inside it). band(): the alert row, { showing, top, bottom } in px
  from the stage's top; gap(): px between text and a line.
  show(machines): the machines to show, up to three, each
    { key, kind, name, since, status, phase, progress, pink, lines }:
    kind: washer, washer_dryer, dryer or dishwasher; name: the device's,
    for two of a kind; since: when it started (orders two of a kind);
    status: running, paused, ended or error; phase: what to draw (wash,
    rinse, spin, dry or cool); progress: 0 to 1, or null (a full ring);
    pink: how dyed a red sock run's load is, or null; lines: two lines of
    text.
  A machine starting or stopping sweeps the parts to their new places,
  one change at a time; anything else changes in place.
*/
export class Drum {
  constructor(stage, { band, gap, clock }) {
    Object.assign(this, { stage, band, gapOf: gap, clockOf: clock });
    this.svg = stage.querySelector('svg');
    this.labels = stage.querySelector('.labels');
    this.machines = new Map();   // key → its latest, while shown or wanted
    this.target = [];            // keys wanted, in kind order
    this.sims = [];              // loads in motion
    this.geo = null;
    this.row = this.rowTo = band().showing ? 1 : 0;   // 0 without the alert row, 1 with it; rowTo: where it's going
    this.turn = 0;
    this.visible = false;
  }

  byKind = (a, b) => {
    const m = this.machines.get(a), n = this.machines.get(b);
    return RANK[m.kind] - RANK[n.kind] || m.since - n.since;
  };

  // The name shown: the kind; the device's name for two of a kind.
  label(key, keys) {
    const m = this.machines.get(key);
    return m.name && keys.some(k => k !== key && this.machines.get(k)?.kind === m.kind) ? m.name : KINDS[m.kind];
  }

  show(list) {
    for (const m of list) this.machines.set(m.key, m);
    this.target = list.map(m => m.key).sort(this.byKind);
    const shown = this.geo?.refs.map(r => r.part.key) ?? [], leaving = this.geo?.leaving.map(r => r.part.key) ?? [];
    for (const k of this.machines.keys()) if (!this.target.includes(k) && !shown.includes(k) && !leaving.includes(k)) this.machines.delete(k);
    for (const r of this.geo?.refs ?? []) this.refresh(r);
    if (shown.length !== this.target.length || shown.some(k => !this.target.includes(k))) this.regroup();
  }

  // On screen, the loads move; off screen, they stop, and a sweep under
  // way ends where it was going.
  setVisible(on) {
    this.visible = on;
    this.stage.classList.toggle('paused', !on);
    if (on) return this.run();
    cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.geo?.moving) this.render();
  }

  drop(sim) {
    const i = this.sims.indexOf(sim);
    if (i >= 0) this.sims.splice(i, 1);
  }

  run() {
    if (this.frame || !this.visible) return;
    let last = performance.now();
    const frame = now => {
      const dt = Math.min(.05, (now - last) / 1000);
      last = now;
      for (const s of this.sims) if (!s.still) step(s, dt);
      this.frame = requestAnimationFrame(frame);
    };
    this.frame = requestAnimationFrame(frame);
  }

  // The alert row opening or closing: thirds turn, texts move.
  setRow(showing) {
    const target = showing ? 1 : 0, from = this.row, t0 = performance.now();
    cancelAnimationFrame(this.rowFrame);
    this.rowTo = target;
    this.placeClock();
    if (!this.visible || reduce.matches) {
      this.row = target;
      if (this.geo) this.applyGeometry(this.geo.moving);
      return;
    }
    const tick = now => {
      const u = Math.min(1, (now - t0) / TURN_TIME);
      this.row = lerp(from, target, ease(u));
      if (this.geo) this.applyGeometry(this.geo.moving);
      if (u < 1) this.rowFrame = requestAnimationFrame(tick);
    };
    this.rowFrame = requestAnimationFrame(tick);
  }

  // The alert row's height, also before it has held an alert: as Håg
  // draws it, one line at 5.5 units with 1.2 units above and below.
  bandHeight() {
    const { top, bottom } = this.band();
    if (bottom > top) return bottom - top;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;font-size:calc(5.5 * var(--u));padding:calc(1.2 * var(--u)) 0';
    probe.textContent = 'H';
    this.stage.append(probe);
    const h = probe.offsetHeight;
    probe.remove();
    return h;
  }

  // Draws the glance afresh: on a new size, back on screen, or when
  // sweeping doesn't apply. With reduced motion, the old drawing fades out
  // over the new one.
  render(fade = false) {
    cancelAnimationFrame(this.sweepFrame);
    let ghost = null;
    if (fade && this.geo) {
      ghost = document.createElement('div');
      ghost.className = 'ghost';
      ghost.style.background = this.stage.style.background;
      ghost.append(this.svg.cloneNode(true), this.labels.cloneNode(true));
    }
    const { stage, svg } = this, W = stage.clientWidth, H = stage.clientHeight, cx = W / 2, cy = H / 2;
    const active = this.target;
    // The drum fills the glance, its progress ring just inside the edges
    // on a square screen; the text sits on top.
    const R = Math.min(W, H) * .405;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.replaceChildren();
    this.labels.replaceChildren();
    this.sims.length = 0;
    this.geo = null;
    stage.style.background = '';
    if (active.length && R > 0) {
      const ps = parts(active);
      this.row = this.rowTo = this.band().showing ? 1 : 0;
      // Layers: the parts' insides, their rings, then the rim and the dividers over all.
      const layer = () => svgEl('g', {}, svg);
      const geo = this.geo = { cx, cy, R, ps, refs: [], leaving: [], three: ps.length === 3 ? 1 : 0, defs: svgEl('defs', {}, svg),
        band: this.bandHeight(), space: this.gapOf(), gap: this.gapOf() + R * .0175 };   // gap: from the divider's edge
      geo.inside = layer();
      geo.rings = layer();
      svgEl('circle', { class: 'rim', cx, cy, r: R, 'stroke-width': R * .07 }, svg);
      svgEl('path', { class: 'rim-sh', d: arcPath(cx, cy, R + R * .02, -20, 110), 'stroke-width': R * .035 }, svg);
      geo.dividers = layer();
      for (const part of ps) geo.refs.push(this.buildPart(part));
      if (ps.length > 1) geo.refs.forEach(r => this.addDivider(r));
      this.fitLabels();
      this.applyGeometry();
    } else this.placeClock();
    if (ghost) {
      stage.append(ghost);
      ghost.animate({ opacity: [1, 0] }, { duration: TURN_TIME, easing: 'ease-in-out' }).onfinish = () => ghost.remove();
    }
  }

  // One machine's part: its inside (clipped to its wedge), its ring and its text.
  buildPart(part) {
    const { R, defs, inside, rings } = this.geo, m = this.machines.get(part.key), id = `haag-clip-${++clips}`;
    const clipPath = svgEl('path', {}, svgEl('clipPath', { id }, defs));
    const r = { part, clipPath, g: svgEl('g', { 'clip-path': `url(#${id})` }, inside) };
    this.fill(r, m);
    r.track = svgEl('path', { class: 'track', 'stroke-width': R * .055 }, rings);
    r.arc = svgEl('path', { 'stroke-width': R * .055 }, rings);
    const block = n => {
      const el = this.labels.appendChild(document.createElement('div'));
      for (let i = 0; i < n; i++) el.appendChild(document.createElement('div')).className = n === 1 ? 't2' : 't3';
      return el;
    };
    r.name = block(1);
    r.lines = block(2);
    this.write(r, m);
    return r;
  }

  // A part's inside: the drum, its contents, the veil that quiets them
  // under the text, and the glare. A load drawn again keeps its motion.
  fill(r, m) {
    const { cx, cy, R, ps } = this.geo, old = r.sim, kind = drawn(m), ended = m.status === 'ended';
    if (old) this.drop(old);
    r.sim = null;
    r.g.replaceChildren();
    r.g.classList.toggle('paused', m.status === 'paused');
    svgEl('circle', { class: 'drum', cx, cy, r: R }, r.g);
    if (kind === 'dishwasher') dishes(r.g, cx, cy, R, r.part, m);
    else {
      // Each drum varies a little: the washer's paddles, the dryer's vents.
      const marks = svgEl('g', {}, r.g);   // turned with the drum (see step)
      if (kind === 'washer') for (let k = 0; k < 3; k++) {
        const a = rad(k * 120 - 90), P = (rr, t) => `${cx + R * rr * Math.cos(t)} ${cy + R * rr * Math.sin(t)}`;
        svgEl('path', { d: `M${P(.97, a - .12)}L${P(.82, a)}L${P(.97, a + .12)}Z`, fill: 'var(--in-metal)', opacity: .6 }, marks);
      }
      else for (let k = 0; k < 24; k++) {
        const a = rad(k * 15);
        svgEl('circle', { cx: cx + R * .9 * Math.cos(a), cy: cy + R * .9 * Math.sin(a), r: R * .018, fill: 'var(--in-metal)', opacity: .55 }, marks);
      }
      const wv = water(r.g, cx, cy, R, kind === 'washer' ? m.phase : 'dry', ended);
      r.sim = clothes(r.g, cx, cy, R, m, kind, marks, ps.length === 1 ? 180 : (r.part.from + r.part.to) / 2, wv);
      if (r.sim) {
        if (old) carry(old, r.sim);
        this.sims.push(r.sim);
      }
    }
    svgEl('circle', { class: 'veil', cx, cy, r: R }, r.g);
    svgEl('path', { class: 'glare', d: `M${cx - R * .7} ${cy - R * .35}A${R * .8} ${R * .8} 0 0 1 ${cx - R * .2} ${cy - R * .75}A${R * .95} ${R * .95} 0 0 0 ${cx - R * .7} ${cy - R * .35}Z` }, r.g);
    Object.assign(r, { m, look: lookOf(m), pink: m.pink });
  }

  // A part's text and ring from its machine.
  write(r, m) {
    r.name.className = r.lines.className = `lab ${m.status}`;
    r.name.firstChild.textContent = this.label(r.part.key, this.geo.ps.map(p => p.key));
    [...r.lines.children].forEach((el, i) => { el.textContent = m.lines[i] ?? ''; });
    r.p = m.status === 'ended' || m.progress == null ? 1 : Math.max(0, Math.min(1, m.progress));
    r.arc.setAttribute('class', `arc ${m.status === 'ended' ? 'done' : m.status === 'error' ? 'error' : ''}`);
  }

  // A shown machine's news, in place: its inside drawn again when what it
  // shows changes, else the dye; then its ring and text.
  refresh(r) {
    const m = this.machines.get(r.part.key);
    if (!m || m === r.m) return;
    if (lookOf(m) !== r.look) this.fill(r, m);
    else if (m.pink !== r.pink) retint(r.g, m.pink);
    Object.assign(r, { m, pink: m.pink });
    const text = r.name.textContent + r.lines.textContent;
    this.write(r, m);
    const changed = text !== r.name.textContent + r.lines.textContent;
    if (this.geo.moving) this.geo.refit ||= changed;
    else {
      if (changed) this.fitLabels();
      this.applyGeometry();
    }
  }

  addDivider(r) {
    r.divider ||= svgEl('line', { class: 'divider', stroke: `var(--ground-${this.machines.get(r.part.key).kind})`, 'stroke-width': this.geo.R * .035 }, this.geo.dividers);
  }

  // Machines starting or stopping: the parts sweep to their new places, as
  // the thirds turn for the alert row. A new part opens from the seam
  // between its neighbours; a leaving one closes into the seam where its
  // neighbours meet. Every edge turns the same way, whichever is less
  // travel (clockwise on a tie). What's inside keeps moving.
  // No line crosses text: each text rides inside its part, a gap from
  // every line, shrinking and growing with it, and travels around the
  // center when parts trade places. One machine's text sits on the
  // center, where the lines start, so it moves to its new place (or
  // leaves) before the sweep; text going to the center waits until the
  // lines are gone. Machines starting and stopping at once go one at a
  // time: those stopping first, unless that would leave nothing; then one
  // starting. Off screen, or with reduced motion, it's drawn afresh.
  async regroup() {
    const geo = this.geo;
    if (!geo || !this.target.length || !this.visible || reduce.matches) return this.render(this.visible && reduce.matches);
    if (geo.moving) return;   // the sweep under way picks up the change
    for (;;) {
      const target = this.target, shown = this.geo.refs.map(r => r.part.key);
      const stop = shown.find(k => !target.includes(k)), start = target.find(k => !shown.includes(k));
      if (!stop && !start) return;
      const next = stop && (shown.length > 1 || !start) ? shown.filter(k => k !== stop) : [...shown, start];
      if (!await this.sweep(next.sort(this.byKind))) return;
      for (const k of this.machines.keys()) if (!this.target.includes(k) && !next.includes(k)) this.machines.delete(k);
    }
  }

  // One sweep to the parts of these machines; false if drawn afresh meanwhile.
  async sweep(active) {
    const mine = this.geo, { cx, cy, R } = mine, ps = parts(active), old = mine.refs;
    const was = new Map(old.map(r => [r.part.key, r])), now = new Map(ps.map(p => [p.key, p]));
    const around = (list, key) => {   // clockwise neighbours
      const cw = [...list].sort((a, b) => a.from - b.from), i = cw.findIndex(p => p.key === key), n = cw.length;
      return [cw[(i - 1 + n) % n], cw[(i + 1) % n]];
    };
    // Each part's edges [from, to], before (a) and after (b).
    const plan = [];
    for (const p of ps) {
      const r = was.get(p.key);
      if (r) { plan.push({ ref: r, a: [r.part.from, r.part.to], b: [p.from, p.to] }); continue; }
      const [prev, next] = around(ps, p.key);
      const seam = was.get(prev.key)?.part.to ?? was.get(next.key)?.part.from ?? p.from;
      plan.push({ part: p, a: [seam, seam], b: [p.from, p.to], fade: 'in' });
    }
    for (const r of old) if (!now.has(r.part.key)) {
      const [prev, next] = around(old.map(q => q.part), r.part.key);
      const seam = now.get(prev.key)?.to ?? now.get(next.key)?.from ?? (r.part.from + r.part.to) / 2;
      plan.push({ ref: r, a: [r.part.from, r.part.to], b: [seam, seam], fade: 'out' });
    }
    const cwd = x => (x % 360 + 360) % 360, ccwd = x => cwd(x) && cwd(x) - 360;
    const turnBy = (s, dir) => (dir > 0 ? cwd : ccwd)(s.b[0] - s.a[0]);
    const travel = dir => plan.reduce((sum, s) => {
      const df = turnBy(s, dir);
      return sum + Math.abs(df) + Math.abs(s.a[0] + df + s.b[1] - s.b[0] - s.a[1]);
    }, 0);
    const dir = travel(1) <= travel(-1) ? 1 : -1;
    for (const s of plan) { const df = turnBy(s, dir); s.b = [s.a[0] + df, s.a[0] + df + s.b[1] - s.b[0]]; }

    // The new layout: new parts drawn, the text fitted and placed for it.
    const was3 = mine.three, oneWas = old.length === 1, oneNow = ps.length === 1;
    const kept = plan.filter(s => !s.fade).map(s => s.ref), start = new Map(kept.map(r => [r, at(r)]));
    mine.ps = ps;
    for (const r of kept) r.name.firstChild.textContent = this.label(r.part.key, active);   // named when two of a kind
    for (const s of plan) if (s.fade === 'in') s.ref = this.buildPart(s.part);
    mine.refs = ps.map(p => plan.find(s => s.ref.part.key === p.key && s.fade !== 'out').ref);
    mine.leaving = plan.filter(s => s.fade === 'out').map(s => s.ref);
    for (const r of mine.refs) r.part = now.get(r.part.key);
    this.fitLabels();
    const end = new Map(mine.refs.map(r => [r, { ...this.anchors(r, this.row), size: at(r).size }]));
    for (const s of plan) s.ref.part = { key: s.ref.part.key, from: s.a[0], to: s.a[1] };
    for (const r of kept) setSize(r, start.get(r).size);   // until it moves
    for (const s of plan) if (s.fade === 'in') {
      const b = end.get(s.ref);
      putText(s.ref, b.x, b.name, b.lines);
      s.ref.name.style.opacity = s.ref.lines.style.opacity = 0;
    }
    mine.moving = true;
    this.applyGeometry(true);
    const run = (ms, fn) => new Promise(done => {
      const t0 = performance.now();
      const tick = time => {
        if (this.geo !== mine) return done();   // drawn afresh meanwhile
        const u = Math.min(1, (time - t0) / ms);
        fn(u, ease(u));
        if (u < 1) this.sweepFrame = requestAnimationFrame(tick); else done();
      };
      tick(t0);
    });
    const slide = (r, a, b) => run(TURN_TIME, (u, e) => {
      putText(r, lerp(a.x, b.x, e), lerp(a.name, b.name, e), lerp(a.lines, b.lines, e));
      setSize(r, lerp(a.size, b.size, e));
    });

    // Off the center first: one machine's text moves to its new place, or
    // leaves. Leaving text also goes first when no part stays (the new
    // parts' edges would sweep over it), and new text comes after.
    const early = plan.filter(s => s.fade === 'out' && (oneWas || !kept.length)).map(s => s.ref);
    if (oneWas && kept.includes(old[0])) await slide(old[0], start.get(old[0]), end.get(old[0]));
    if (early.length) await run(TURN_TIME / 2, u => early.forEach(r => exit(r, u)));
    if (this.geo !== mine) return false;
    if (!oneNow || !oneWas) [...mine.refs, ...mine.leaving].forEach(r => this.addDivider(r));

    // The sweep. Each text keeps its angle from its part's middle (moving
    // from where it was to where it goes) and its distance from the
    // center, then shrinks as far as it must to clear every line.
    const midOf = (f, t, three) => (f + t) / 2 + this.row * Y_TURN * three;
    const polar = (x, y) => [Math.atan2(y - cy, x - cx) * 180 / Math.PI, Math.hypot(x - cx, y - cy)];
    const norm = d => ((d + 180) % 360 + 360) % 360 - 180;
    const rides = [];
    for (const s of plan) {
      if (s.fade === 'out' ? early.includes(s.ref) : s.fade === 'in' && (oneNow || !kept.length)) continue;   // done before, or after
      const r = s.ref, d = dims(r), s0 = at(r).size, a = at(r);
      const center = (p, size) => [p.x, p.name + (d.hn + d.hl) * size / s0 / 2];
      const [ta, ra] = polar(...center(a, s0));
      const b = s.fade || oneNow ? null : end.get(r);   // the leaving, the new and those going to the center hold
      const [tb, rb] = b ? polar(...center(b, b.size)) : [ta, ra];
      const midA = midOf(...s.a, was3), midB = midOf(...s.b, ps.length === 3 ? 1 : 0), offA = norm(ta - midA);
      // Its angle from its part's middle: the new and the leaving keep theirs; those holding stay put.
      const off = s.fade === 'in' ? [norm(ta - midB), norm(ta - midB)] : s.fade === 'out' ? [offA, offA]
        : [offA, b ? norm(tb - midB) : midA + offA - midB];
      // Going around the center (parts trading places), it swings out to clear the middle.
      const swing = Math.abs(midB + off[1] - midA - off[0]) > 60 ? Math.max(0, R * .5 - (ra + rb) / 2) : 0;
      rides.push({ s, r, d, s0, offA: off[0], offB: off[1], ra, rb, swing, sa: a.size, sb: b ? b.size : a.size });
    }
    await run(TURN_TIME, (u, e) => {
      for (const s of plan) { s.ref.part.from = lerp(s.a[0], s.b[0], e); s.ref.part.to = lerp(s.a[1], s.b[1], e); }
      mine.three = lerp(was3, ps.length === 3 ? 1 : 0, e);
      this.applyGeometry(true);
      for (const v of rides) {
        const { s, r, d, s0 } = v, part = r.part, span = part.to - part.from;
        let size = lerp(v.sa, v.sb, e), alpha = 1;
        if (s.fade === 'in') { size *= span / (s.b[1] - s.b[0]); alpha = Math.max(0, (u - .6) / .4); }
        if (s.fade === 'out') { size *= span / (s.a[1] - s.a[0]); exit(r, u / .35); alpha = 1 - u / .35; }
        if (alpha <= 0) continue;
        const t = rad((part.from + part.to) / 2 + this.turn + lerp(v.offA, v.offB, e)), rr = lerp(v.ra, v.rb, e) + v.swing * Math.sin(Math.PI * e);
        const x = cx + rr * Math.cos(t), y = cy + rr * Math.sin(t), k = this.fitted(x, y, d, size / s0, part);
        const top = y - (d.hn + d.hl) * k / 2;
        putText(r, x, top, top + d.hn * k);
        setSize(r, s0 * k);
        if (s.fade === 'in') r.name.style.opacity = r.lines.style.opacity = alpha;
      }
    });
    if (this.geo !== mine) return false;
    // Settled: the leaving parts go, the others take their new places.
    for (const r of mine.leaving) {
      [r.g, r.clipPath.parentNode, r.track, r.arc, r.divider, r.name, r.lines].forEach(el => el?.remove());
      if (r.sim) this.drop(r.sim);
    }
    mine.leaving = [];
    for (const r of mine.refs) {
      r.part = now.get(r.part.key);
      // The load rises up the side its part now shows.
      if (r.sim) r.sim.dir = rising(oneNow ? 180 : (r.part.from + r.part.to) / 2);
      if (oneNow) { r.divider?.remove(); r.divider = null; }
    }
    this.applyGeometry(true);

    // Then to the center, with the lines gone; new text comes last when no
    // part stayed, as leaving text went first.
    if (oneNow && kept.length) await slide(mine.refs[0], at(mine.refs[0]), end.get(mine.refs[0]));
    else if (oneNow || !kept.length) await run(TURN_TIME / 2, u => mine.refs.forEach(r => { r.name.style.opacity = r.lines.style.opacity = u; }));
    if (this.geo !== mine) return false;
    for (const r of mine.refs) { setSize(r, end.get(r).size); r.name.style.opacity = r.lines.style.opacity = ''; }
    mine.moving = false;
    if (mine.refit) { mine.refit = false; this.fitLabels(); }   // text changed meanwhile
    this.applyGeometry();
    return true;
  }

  // The largest scale, up to k, at which a text stacked on x, y (dims d at
  // scale 1) sits in its part, inside the rim and clear of every line.
  fitted(x, y, d, k, part) {
    const { cx, cy, R, refs, leaving } = this.geo, edge = this.geo.gap - 1, turn = this.turn;
    const rays = [...refs, ...leaving].flatMap(q => [q.part.from, q.part.to])
      .map(a => [cx + R * 1.2 * Math.cos(rad(a + turn)), cy + R * 1.2 * Math.sin(rad(a + turn))]);
    const into = ((Math.atan2(y - cy, x - cx) * 180 / Math.PI - part.from - turn) % 360 + 360) % 360;
    const clear = k => {
      const top = y - (d.hn + d.hl) * k / 2, mid = top + d.hn * k;
      return [[d.wn, top, mid], [d.wl, mid, top + (d.hn + d.hl) * k]].every(([w, t, b]) => {
        if (b <= t) return true;
        const box = [x - w * k / 2, t, x + w * k / 2, b];
        return [[box[0], t], [box[2], t], [box[0], b], [box[2], b]].every(([px, py]) => Math.hypot(px - cx, py - cy) <= R * .9)
          && rays.every(([x1, y1]) => segBox(cx, cy, x1, y1, box) >= edge);
      });
    };
    let lo = k * .3, hi = k;
    if (into > part.to - part.from) return lo;
    if (clear(k)) return k;
    if (!clear(lo)) return lo;
    for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (clear(m)) lo = m; else hi = m; }
    return lo;
  }

  // A part's edges, ring and divider, between these angles.
  drawEdges(r, from, to, gap) {
    const { cx, cy, R } = this.geo, ring = R * 1.13, open = to - from - 2 * gap > .5;
    r.clipPath.setAttribute('d', wedgePath(cx, cy, R, from, to));
    r.track.setAttribute('d', open ? arcPath(cx, cy, ring, from + gap, to - gap) : '');
    r.arc.setAttribute('d', open && r.p > 0 ? arcPath(cx, cy, ring, from + gap, from + gap + (to - from - 2 * gap) * r.p) : '');
    if (r.divider) {
      Object.entries({ x1: cx, y1: cy, x2: cx + R * 1.2 * Math.cos(rad(to)), y2: cy + R * 1.2 * Math.sin(rad(to)) })
        .forEach(([k, v]) => r.divider.setAttribute(k, v));
    }
  }

  // For Håg's transitions: the grounds, the text, and the drum drawn through
  // the turning wedges, fading.
  parts() {
    const geo = this.geo;
    if (!geo) return { wedges: [{ from: -45, to: 315, color: 'var(--home)' }] };
    const all = [...geo.refs, ...geo.leaving], gap = all.length > 1 ? 4 : 0;
    const ground = kind => {
      const probe = document.createElement('i');
      probe.style.color = `var(--ground-${kind})`;
      this.stage.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return {
      wedges: all.map(r => ({ from: r.part.from + this.turn, to: r.part.to + this.turn, color: ground(this.machines.get(r.part.key).kind) })),
      text: all.map(r => [r.name, r.lines]),
      turn: (spans, opacity) => {
        this.turning = true;
        this.svg.style.opacity = opacity;
        if (this.geo === geo) all.forEach((r, i) => this.drawEdges(r, spans[i].from, spans[i].to, gap));
      },
      done: () => {
        this.turning = false;
        this.svg.style.opacity = '';
        if (this.geo) this.applyGeometry(this.geo.moving);
      },
    };
  }

  // Edges, rings, ground and (unless a sweep is moving it) text, for the
  // current turn.
  applyGeometry(moving = false) {
    if (this.turning) return;   // Håg is drawing it, between glances
    const geo = this.geo, { cx, cy } = geo, all = [...geo.refs, ...geo.leaving];
    const gap = all.length > 1 ? 4 : 0;
    this.turn = this.row * Y_TURN * geo.three;
    for (const r of all) this.drawEdges(r, r.part.from + this.turn, r.part.to + this.turn, gap);
    // Ground: the same wedges, out to the edges.
    const start = all[0].part.from + this.turn;
    const wedges = all.map(r => {
      const f = ((r.part.from + this.turn - start) % 360 + 360) % 360;
      return [f, f + r.part.to - r.part.from, this.machines.get(r.part.key).kind];
    }).sort((a, b) => a[0] - b[0]);
    this.stage.style.background = `conic-gradient(from ${start + 90}deg at 50% 50%, ${wedges.map(([f, t, kind]) =>
      `var(--ground-${kind}) ${f}deg ${t}deg`).join(', ')})`;
    if (!moving) this.placeLabels();
  }

  // Each text in its part with nothing to clear, at row (0 without the alert
  // row, 1 with it):
  // - one machine: the name above the drum's middle and its lines below, a
  //   gap the alert row's height between;
  // - halves and thirds: partway out along the part's middle; the thirds
  //   turn into the Y with the row.
  rest(r, row) {
    const { cx, cy, R, ps, band } = this.geo, hn = r.name.offsetHeight, h = hn + r.lines.offsetHeight;
    if (ps.length === 1) {
      const clear = band / 2 + R * .05;
      return { x: cx, name: cy - clear - hn, lines: cy + clear };
    }
    const t = ps.length === 3 ? row * Y_TURN : 0, mid = rad((r.part.from + r.part.to) / 2 + t), d = R * (ps.length === 2 ? .5 : .55);
    const c = cy + d * Math.sin(mid);
    return { x: cx + d * Math.cos(mid), name: c - h / 2, lines: c - h / 2 + hn };
  }

  // How far the text slides at row (0 or 1) to clear the clock and the row by
  // a gap, as Overview's clusters do, straight up and down: text above the
  // middle up, below it down, each side as one.
  clearing(row, clock) {
    const { cx, cy, ps, refs, band, space } = this.geo;
    const { left, top } = this.clockBox(row, clock), bottom = top + clock.height, right = left + clock.width;
    let up = 0, down = 0;
    for (const r of refs) {
      const a = this.rest(r, row), hn = r.name.offsetHeight, hl = r.lines.offsetHeight;
      const boxes = ps.length === 1 ? [[r.name.offsetWidth, a.name, hn], [r.lines.offsetWidth, a.lines, hl]]
        : [[Math.max(r.name.offsetWidth, r.lines.offsetWidth), a.name, hn + hl]];
      for (const [w, y, h] of boxes) {
        if (!h) continue;
        const over = a.x + w / 2 + space > left && a.x - w / 2 - space < right;
        if (y + h / 2 < cy) up = Math.max(up, y + h - Math.min(over ? top - space : Infinity, row ? cy - band / 2 - space : Infinity));
        else down = Math.max(down, Math.max(over && !row ? bottom + space : -Infinity, row ? cy + band / 2 + space : -Infinity) - y);
      }
    }
    return { up, down };
  }

  // Each text's place at row: where it rests, slid clear.
  anchors(r, row) {
    const { cy, ps, slide } = this.geo, a = this.rest(r, row);
    const up = lerp(slide[0].up, slide[1].up, row), down = lerp(slide[0].down, slide[1].down, row);
    if (ps.length === 1) return { x: a.x, name: a.name - up, lines: a.lines + down };
    const by = a.name + (r.name.offsetHeight + r.lines.offsetHeight) / 2 < cy ? -up : down;
    return { x: a.x, name: a.name + by, lines: a.lines + by };
  }

  // The clock's box at row (0 or 1): its colon on the drum's axis, at the
  // middle or a gap above the alert row, then clear of the dividers by a
  // gap, as the other glances' clocks are of the split. Halves: slid left,
  // into the upper-left half. Thirds: raised, into the top third.
  clockBox(row, { width, height, colon }) {
    const { cx, cy, R, ps, band, space, gap } = this.geo;
    const box = { left: cx - colon, top: row ? cy - band / 2 - space - height : cy - height / 2 };
    if (ps.length < 2 || !height) return box;
    const t = ps.length === 3 ? row * Y_TURN : 0, c = [cx, cy];
    const rays = ps.map(p => [c, [cx + 2 * R * Math.cos(rad(p.to + t)), cy + 2 * R * Math.sin(rad(p.to + t))]]);
    const clear = () => {
      const { left: l, top: tp } = box, r = l + width, b = tp + height;
      const edges = [[[l, tp], [r, tp]], [[r, tp], [r, b]], [[r, b], [l, b]], [[l, b], [l, tp]]];
      return rays.every(([p, q]) => edges.every(([a, e]) => segDist(a, e, p, q) >= gap));
    };
    const step = Math.max(1, height * .02);
    for (let n = 0; n < 500 && !clear(); n++) {
      if (ps.length === 2) box.left -= step;
      else box.top -= step;
    }
    return box;
  }

  // Håg's clock: its numerals half again the names' size, in its box.
  // Håg moves it as the text moves.
  placeClock() {
    const clock = this.clockOf();
    if (!clock) return;
    const W = this.stage.clientWidth, H = this.stage.clientHeight, geo = this.geo;
    const size = geo?.clockSize ?? CLOCK_SIZE * .09 * Math.min(W, H), m = clock.measure(size);
    if (!geo) {
      const y = this.rowTo ? H / 2 - this.bandHeight() / 2 - this.gapOf() - m.height : H / 2 - m.height / 2;
      return clock.place({ x: W / 2, y, size, color: 'var(--d-text)', align: 'colon' });
    }
    const { left, top } = this.clockBox(this.rowTo ? 1 : 0, m);
    clock.place({ x: left + m.colon, y: top, size, color: 'var(--d-text)', align: 'colon' });
  }

  placeLabels() {
    for (const r of this.geo.refs) {
      const a = this.anchors(r, this.row);
      putText(r, a.x, a.name, a.lines);
    }
  }

  // Shrinks the text until every part's fits: clear of the rim and the
  // dividers, and of the alert row while it shows, once slid clear of the
  // clock. Checked with and without the row, so the size holds when it comes
  // and goes. One size for every part, so the texts match.
  fitLabels() {
    const geo = this.geo, { cx, cy, R, ps } = geo, edge = geo.gap - 1, bh = geo.band / 2 + R * .03;
    const inside = (px, py, part, t) => {
      const dx = px - cx, dy = py - cy;
      if (Math.hypot(dx, dy) > R * .9) return false;
      if (ps.length === 1) return true;
      const from = rad(part.from + t), to = rad(part.to + t);
      const a = from + ((Math.atan2(dy, dx) - from) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const off = e => Math.abs(dx * Math.sin(e) - dy * Math.cos(e));   // distance from an edge's line
      return a <= to && off(from) >= edge && off(to) >= edge;
    };
    const fits = (r, row) => {
      const a = this.anchors(r, row), t = ps.length === 3 ? row * Y_TURN : 0;
      return ['name', 'lines'].every(k => {
        const w = r[k].offsetWidth / 2, h = r[k].offsetHeight, top = a[k];
        if (!h) return true;
        if (row && top < cy + bh && top + h > cy - bh) return false;
        return [[-w, 0], [w, 0], [-w, h], [w, h]].every(([x, y]) => inside(a.x + x, top + y, r.part, t));
      });
    };
    const base = [9, 7, 6][ps.length - 1] * Math.min(this.stage.clientWidth, this.stage.clientHeight) / 100;   // one machine, halves, thirds
    for (let k = 1; ; k *= .94) {
      for (const r of geo.refs) setSize(r, base * k);
      geo.clockSize = base * k * CLOCK_SIZE;
      const clock = this.clockOf()?.measure(geo.clockSize) ?? { width: 0, height: 0, colon: 0 };
      geo.slide = [this.clearing(0, clock), this.clearing(1, clock)];
      if (k < .6 || geo.refs.every(r => fits(r, 0) && fits(r, 1))) break;
    }
    this.placeClock();
  }
}

// A leaving text's way out, p from 0 to 1: it fades.
const exit = (r, p) => { r.name.style.opacity = r.lines.style.opacity = Math.max(0, 1 - p); };
const at = r => ({ x: parseFloat(r.name.style.left), name: parseFloat(r.name.style.top),
  lines: parseFloat(r.lines.style.top), size: parseFloat(r.name.style.getPropertyValue('--size')) });
const putText = (r, x, name, lines) => {
  Object.assign(r.name.style, { left: `${x}px`, top: `${name}px` });
  Object.assign(r.lines.style, { left: `${x}px`, top: `${lines}px` });
};
// Least distance between segments ab and cd: 0 where they cross.
const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function toSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy);
}
function segDist(a, b, c, d) {
  if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return 0;
  return Math.min(toSeg(a, c, d), toSeg(b, c, d), toSeg(c, a, b), toSeg(d, a, b));
}
const setSize = (r, px) => { for (const el of [r.name, r.lines]) el.style.setProperty('--size', `${px}px`); };
const dims = r => ({ wn: r.name.offsetWidth, hn: r.name.offsetHeight, wl: r.lines.offsetWidth, hl: r.lines.offsetHeight });
