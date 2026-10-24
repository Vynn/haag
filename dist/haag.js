/*
  Håg: Home Assistant at a glance.
  License: GPL-3.0

  This file is the plugin's main module. It registers:
    - the dashboard strategy  `custom:haag`  (ll-strategy-dashboard-haag)
    - the idle-screen card    `custom:haag-idle-card`

  Status: v0.1.0 in development. Live so far: date, time, build version.
  Everything else shows wireframe placeholder values until it's wired to
  discovery.

  Plain JavaScript, no build step (D3). Sizes use container query units
  (cqmin = 1% of the card's shorter side), so one layout scales from a
  phone to a 4K screen.
*/

const VERSION = '0.1.0-dev';
const MANIFEST = 'haag/v1';   // config format marker (D82)

/* ------------------------------------------------------------------------
   Shared setup
   ------------------------------------------------------------------------ */

// Registering the split angle as an <angle> lets the browser animate it.
// (@property rules don't apply inside shadow DOM, so register it globally.)
try {
  CSS.registerProperty({ name: '--haag-split', syntax: '<angle>', inherits: true, initialValue: '135deg' });
} catch { /* already registered, or not supported */ }

/* ------------------------------------------------------------------------
   Dashboard strategy: `strategy: type: custom:haag`
   Generates one full-screen view holding the idle card. Everything in the
   strategy block is passed through as the card's config.
   ------------------------------------------------------------------------ */

class HaagStrategy extends HTMLElement {
  static async generate(config /*, hass */) {
    const { type, ...options } = config;   // drop `custom:haag` itself
    return {
      title: 'Håg',
      views: [{
        title: 'Håg',
        path: 'haag',
        type: 'panel',
        cards: [{ type: 'custom:haag-idle-card', manifest: MANIFEST, ...options }],
      }],
    };
  }
}

/* ------------------------------------------------------------------------
   Idle card
   ------------------------------------------------------------------------ */

const STYLE = `
  :host {
    display: block;
    width: 100%;
    height: var(--haag-height, 100vh);
    container-type: size;
    font-family: system-ui, sans-serif;   /* Open Sans once bundled (D91) */
    color: #222;
  }

  /* Wireframe placeholder colours; the real palette comes later (D77). */
  .stage {
    --out: #d6d6d6;
    --in: #ececec;
    --line: #999;
    --gap: 2.5cqmin;          /* perpendicular distance from the split line to clusters */
    --alert-pad: 1.2cqmin;    /* vertical padding of the alert row */
    --cluster-gap: 2.7cqmin;  /* visible gap between clusters (see opticalEdges) */
    --move: 700ms ease-in-out;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: linear-gradient(var(--haag-split), var(--out) 50%, var(--in) 50%);
  }
  .stage.animate { transition: --haag-split var(--move); }

  /* Weather background (placeholder hatch); fades across the split. */
  .weather-bg {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(45deg, transparent 0 1.2cqmin, rgba(0,0,0,.09) 1.2cqmin 1.6cqmin);
    -webkit-mask-image: linear-gradient(var(--haag-split), #000 38%, transparent 56%);
            mask-image: linear-gradient(var(--haag-split), #000 38%, transparent 56%);
  }

  /* Clusters: positioned by layout(). Content inside is left-aligned; the
     cluster as a whole is justified toward the split line (D44). */
  .side { display: contents; }
  .cluster {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: .4cqmin;
    line-height: 1.05;
    white-space: nowrap;
  }
  .stage.animate .cluster { transition: transform var(--move); }

  /* Alert row: full width through the center (D48). */
  .alert-row {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    translate: 0 -50%;
    padding: var(--alert-pad) 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, .55);
    white-space: nowrap;
  }

  /* Three text sizes (D54). */
  .t1 { font-size: 14cqmin; }
  .t2 { font-size: 4.5cqmin; }
  .t3 { font-size: 2.8cqmin; }

  .line { display: flex; gap: 1.2cqmin; align-items: baseline; }

  /* Clock: tight box around the numerals; AM/PM hangs outside it, top-aligned
     by alignAmPm(), so layout() can tuck it toward the line. */
  .time { position: relative; line-height: .8; }
  /* The numerals' own box must be as tight as the line (inline boxes include
     the font's full height, which would push the layout around). */
  .time [data-live="time"] { display: inline-block; line-height: .8; }
  .ampm {
    position: absolute;
    left: 100%;
    top: 0;
    margin-left: .7cqmin;
    font-size: 4.5cqmin;
    line-height: 1;
  }

  /* Icon slot placeholder (MDI icons come later, D83–D88). */
  .ico {
    display: inline-block;
    width: .8em;
    height: .8em;
    margin-right: .2em;
    background: var(--line);
    vertical-align: -.05em;
  }
  .ico.cool { background: #7fa6c8; }
  .ico.heat { background: #d29a68; }

  .status-line { display: flex; align-items: center; }
  .status-line .people { margin-left: 2.4cqmin; }
  .aq { display: flex; gap: 1cqmin; }

  .agenda { display: flex; align-items: last baseline; gap: 1.6cqmin; }
  .appointments { display: flex; flex-direction: column; gap: .4cqmin; align-items: flex-start; }
  .appt.later { opacity: .55; }

  .people { display: flex; gap: .8cqmin; align-items: center; }
  .person {
    width: 4.5cqmin;
    aspect-ratio: 1;
    border: .35cqmin solid var(--line);
    border-radius: 30%;
    flex: none;
  }
`;

// Markup. Values marked data-live are filled in by the card; the rest are
// wireframe placeholders until discovery is wired up.
const TEMPLATE = `
  <div class="stage">
    <div class="weather-bg"></div>

    <section class="side outdoor" aria-label="Outdoor">
      <div class="cluster">
        <div class="t2" data-live="date"></div>
        <div class="t1 time"><span data-live="time"></span><span class="ampm overhang" data-live="ampm"></span></div>
      </div>
      <div class="cluster">
        <div class="line">
          <span class="t2"><span class="ico"></span>72°</span>
          <span class="t3"><span class="ico"></span>35%</span>
          <span class="t3"><span class="ico"></span>AQI 42</span>
        </div>
      </div>
      <div class="cluster">
        <div class="agenda">
          <div class="people"><span class="person"></span></div>
          <div class="appointments">
            <div class="t3 appt later"><span class="ico"></span>Sat 10:00 AM Soccer</div>
            <div class="t3 appt"><span class="ico"></span>2:00 PM School pickup</div>
            <div class="t3 appt"><span class="ico"></span>9:30 AM Dentist</div>
          </div>
        </div>
      </div>
    </section>

    <section class="side indoor" aria-label="Indoor">
      <div class="cluster">
        <div class="t3">First Floor</div>
        <div class="status-line"><span class="t2"><span class="ico heat"></span>73°</span><span class="people"><span class="person"></span><span class="person"></span></span></div>
        <div class="aq t3"><span><span class="ico"></span>48%</span><span><span class="ico"></span>690 ppm</span><span><span class="ico"></span>21 µg/m³</span></div>
      </div>
      <div class="cluster">
        <div class="t3">Second Floor</div>
        <div class="status-line"><span class="t2"><span class="ico cool"></span>70°</span><span class="people"><span class="person"></span></span></div>
        <div class="aq t3"><span><span class="ico"></span>52%</span><span><span class="ico"></span>640 ppm</span><span><span class="ico"></span>9 µg/m³</span></div>
      </div>
      <div class="cluster">
        <div class="t3">Basement</div>
        <div class="status-line"><span class="t2"><span class="ico"></span>74°</span></div>
        <div class="aq t3"><span><span class="ico"></span>43%</span><span><span class="ico"></span>610 ppm</span></div>
      </div>
    </section>

    <div class="alert-row t2"><span class="ico"></span><span data-live="version"></span></div>
  </div>
`;

class HaagIdleCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;
    this._angle = 45;   // split line angle from horizontal (D42)
    this._measure = document.createElement('canvas').getContext('2d');
  }

  // ----- Lovelace card API -----

  setConfig(config) {
    this._config = { manifest: MANIFEST, ...config };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._tick();
  }

  getCardSize() { return 12; }

  // ----- Lifecycle -----

  connectedCallback() {
    const root = this.shadowRoot;
    this._stage = root.querySelector('.stage');
    this._alertRow = root.querySelector('.alert-row');
    this._out = [...root.querySelectorAll('.outdoor .cluster')];
    this._in = [...root.querySelectorAll('.indoor .cluster')];
    this._live = Object.fromEntries([...root.querySelectorAll('[data-live]')].map(el => [el.dataset.live, el]));

    this._live.version.textContent = `Håg · v${VERSION}`;
    this._tick();

    this._resize = new ResizeObserver(() => this._layout());
    this._resize.observe(this._stage);
    // Enable motion only after the first layout, so nothing slides in on load.
    requestAnimationFrame(() => requestAnimationFrame(() => this._stage.classList.add('animate')));
  }

  disconnectedCallback() {
    this._resize?.disconnect();
    clearTimeout(this._timer);
  }

  // ----- Live content -----

  // Update the clock, then wake up again at the start of the next minute.
  _tick() {
    clearTimeout(this._timer);
    if (!this._live) return;
    const now = new Date();
    const tz = this._hass?.config?.time_zone;   // HA's time zone, not the browser's
    const locale = this._hass?.language || navigator.language;

    // 12-hour clock with a separate AM/PM label (D46).
    const parts = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).formatToParts(now);
    const pick = type => parts.find(p => p.type === type)?.value ?? '';
    this._live.time.textContent = `${pick('hour')}:${pick('minute')}`;
    this._live.ampm.textContent = pick('dayPeriod').toUpperCase();

    // Long-form date above the time (D52).
    this._live.date.textContent = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }).format(now);

    this._layout();
    this._timer = setTimeout(() => this._tick(), 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  }

  // ----- Layout engine (ported from design/wireframe-idle.html) -----

  _capHeight(el) {
    const cs = getComputedStyle(el);
    this._measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return this._measure.measureText('H').actualBoundingBoxAscent;
  }

  // Baseline of an element's text, via a zero-size inline probe.
  _baselineY(el) {
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    el.insertBefore(probe, el.firstChild);
    const y = probe.getBoundingClientRect().bottom;
    probe.remove();
    return y;
  }

  // The visible pieces of a cluster: elements that hold text, plus graphics.
  _inkParts(el) {
    return [...el.querySelectorAll('*')].filter(e =>
      e.getClientRects().length &&
      (e.matches('.ico, .person') ||
       [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())));
  }

  // Corners of a cluster's visible shape, relative to its top-left.
  _shapeCorners(el) {
    const base = el.getBoundingClientRect();
    return this._inkParts(el).flatMap(p => {
      const r = p.getBoundingClientRect();
      const l = r.left - base.left, t = r.top - base.top;
      const rr = r.right - base.left, b = r.bottom - base.top;
      return [[l, t], [rr, t], [l, b], [rr, b]];
    });
  }

  // Visible top/bottom of a cluster (cap height to baseline; graphics by box),
  // relative to its top, so every gap looks the same (D56).
  _opticalEdges(cluster) {
    const base = cluster.getBoundingClientRect().top;
    let top = Infinity, bottom = -Infinity;
    const walk = node => {
      for (const el of node.children) {
        if (!el.getClientRects().length) continue;
        if (el.matches('.ico, .person')) {
          const r = el.getBoundingClientRect();
          top = Math.min(top, r.top);
          bottom = Math.max(bottom, r.bottom);
          continue;
        }
        if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) {
          const b = this._baselineY(el);
          top = Math.min(top, b - this._capHeight(el));
          bottom = Math.max(bottom, b);
        }
        walk(el);
      }
    };
    walk(cluster);
    return { top: top - base, bottom: bottom - base };
  }

  // Top-align AM/PM with the clock numerals by measured cap height.
  _alignAmPm() {
    for (const am of this.shadowRoot.querySelectorAll('.ampm')) {
      const clock = am.parentElement;
      const delta = (this._baselineY(clock) - this._capHeight(clock)) - (this._baselineY(am) - this._capHeight(am));
      am.style.top = (am.offsetTop + delta) + 'px';
    }
  }

  _px(name) {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;width:var(${name})`;
    this._stage.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  }

  /*
    Justify every cluster to the split line.
    The line passes through the center at angle α; its unit normal toward the
    indoor side is n = (sin α, cos α). A point's signed distance is
    s = n · (p − c). Outdoor clusters stack upward from the alert row with
    their nearest visible corner at s = −gap; indoor clusters stack downward
    at s = +gap. Positions are clamped to the card.
  */
  _layout() {
    const stage = this._stage;
    if (!stage || !stage.clientWidth) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    const cx = W / 2, cy = H / 2;
    const a = this._angle * Math.PI / 180, sa = Math.sin(a), ca = Math.cos(a);
    const gap = this._px('--gap'), cgap = this._px('--cluster-gap');
    const edge = Math.min(W, H) * 0.02;
    const half = this._alertRow.getBoundingClientRect().height / 2;

    stage.style.setProperty('--haag-split', (180 - this._angle) + 'deg');
    this._alignAmPm();

    const place = (el, ty, target, pick) => {
      const corners = this._shapeCorners(el);
      const sNoX = corners.map(([x, y]) => sa * x + ca * (ty + y - cy));
      let tx = cx + (target - pick(...sNoX)) / sa;
      const minX = Math.min(...corners.map(c => c[0]));
      const maxX = Math.max(...corners.map(c => c[0]));
      tx = Math.min(Math.max(tx, edge - minX), W - edge - maxX);
      el.style.transform = `translate(${tx}px, ${ty}px)`;
    };

    let y = cy - half - cgap;                 // visible bottom of next outdoor cluster
    for (const el of this._out) {
      const o = this._opticalEdges(el);
      const ty = y - o.bottom;
      place(el, ty, -gap, Math.max);
      y = ty + o.top - cgap;
    }

    y = cy + half + cgap;                     // visible top of next indoor cluster
    for (const el of this._in) {
      const o = this._opticalEdges(el);
      const ty = y - o.top;
      place(el, ty, gap, Math.min);
      y = ty + o.bottom + cgap;
    }
  }
}

/* ------------------------------------------------------------------------
   Registration
   ------------------------------------------------------------------------ */

if (!customElements.get('ll-strategy-dashboard-haag')) {
  customElements.define('ll-strategy-dashboard-haag', HaagStrategy);
}
if (!customElements.get('haag-idle-card')) {
  customElements.define('haag-idle-card', HaagIdleCard);
}

console.info(`%c Håg %c v${VERSION} `, 'background:#222;color:#fff;border-radius:3px 0 0 3px', 'background:#999;color:#fff;border-radius:0 3px 3px 0');
