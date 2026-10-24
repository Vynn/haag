/*
  Håg: Home Assistant at a glance.
  License: GPL-3.0

  This file is the plugin's main module. It registers:
    - the dashboard strategy  `custom:haag`  (ll-strategy-dashboard-haag)
    - the idle-screen card    `custom:haag-idle-card`

  Status: v0.1.0 in development. Live so far: date, time, build version,
  outdoor conditions, and one row per indoor floor (HVAC status,
  temperature, humidity, CO₂, PM2.5). People and appointments are still
  placeholders.
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
   Discovery
   Finds entities from HA's registries instead of hardcoded IDs (D4).
   Anything found can be overridden in settings (D5), under
   `providers.outdoor.<slot>: <entity_id>`.
   ------------------------------------------------------------------------ */

// Readings that share a device class but aren't the plain measurement (D92).
const DERIVED = /dew.?point|feels.?like|wet.?bulb|apparent|heat.?index|wind.?chill/i;

// Integration iot_class ranking: local before internet, push before polling (D92).
const IOT_RANK = { local_push: 0, local_polling: 1, cloud_push: 2, cloud_polling: 3 };

// Number of decimal places in a numeric state: a stand-in for precision.
const decimals = state => (/^-?\d+\.(\d+)$/.exec(state)?.[1].length) ?? 0;

/**
 * Read the registries once and index what discovery needs.
 * Registry reads work for any logged-in user (D19).
 */
async function loadRegistries(hass) {
  const [entities, devices, areas, floors] = await Promise.all(
    ['entity', 'device', 'area', 'floor'].map(t => hass.callWS({ type: `config/${t}_registry/list` })));
  const deviceArea = Object.fromEntries(devices.map(d => [d.id, d.area_id]));
  const areaFloor = Object.fromEntries(areas.map(a => [a.area_id, a.floor_id]));
  for (const e of entities) {
    e.area = e.area_id || deviceArea[e.device_id] || null;   // own area, or its device's
    e.floor = areaFloor[e.area] || null;
  }
  // Integration manifests, for local vs internet (iot_class). Any user can read these.
  const platforms = [...new Set(entities.map(e => e.platform))];
  const manifests = await hass.callWS({ type: 'manifest/list', integrations: platforms }).catch(() => []);
  const iot = Object.fromEntries(manifests.map(m => [m.domain, m.iot_class]));
  const deviceName = Object.fromEntries(devices.map(d => [d.id, d.name_by_user || d.name || '']));
  return { entities, floors, iot, deviceName };
}

/**
 * Outdoor slots from the Exterior floor (D62): temperature, humidity, AQI,
 * weather condition. Returns { slot: entity_id | null }.
 */
const isExterior = floor => /exterior|outdoor|outside/i.test(floor.name);

function discoverOutdoor(hass, reg, overrides = {}) {
  const exterior = reg.floors.find(isExterior);
  const pool = reg.entities.filter(e =>
    exterior && e.floor === exterior.floor_id && !e.disabled_by && !e.hidden_by && hass.states[e.entity_id]);

  const best = match => {
    const candidates = pool.filter(e => {
      const st = hass.states[e.entity_id];
      return match(e, st) && !DERIVED.test(`${e.translation_key || ''} ${e.original_name || ''} ${e.entity_id}`);
    });
    candidates.sort((a, b) =>
      ((IOT_RANK[reg.iot[a.platform]] ?? 9) - (IOT_RANK[reg.iot[b.platform]] ?? 9)) ||   // local, push first
      (Number(!!a.translation_key) - Number(!!b.translation_key)) ||                     // plain reading first
      (decimals(hass.states[b.entity_id].state) - decimals(hass.states[a.entity_id].state)) ||  // more precise
      a.entity_id.localeCompare(b.entity_id));
    return candidates[0]?.entity_id ?? null;
  };
  const dc = cls => (e, st) => e.entity_id.startsWith('sensor.') && st.attributes.device_class === cls;

  return {
    temperature: overrides.temperature ?? best(dc('temperature')),
    humidity:    overrides.humidity    ?? best(dc('humidity')),
    aqi:         overrides.aqi         ?? best(dc('aqi')),
    weather:     overrides.weather     ?? best(e => e.entity_id.startsWith('weather.')),
  };
}

/**
 * Indoor floors, in display order (center to edge, D52): the ground floor
 * first, then the floors above it going up, then the floors below it going
 * down. The ground floor is the lowest indoor floor at level 0 or above.
 * (Your setup: First Floor, Second Floor, Basement.)
 */
function orderFloors(floors) {
  const indoor = floors.filter(f => !isExterior(f));
  const level = f => f.level ?? 0;
  const ground = Math.min(...indoor.map(level).filter(l => l >= 0), Infinity);
  const up = indoor.filter(f => level(f) >= ground).sort((a, b) => level(a) - level(b));
  const down = indoor.filter(f => level(f) < ground).sort((a, b) => level(b) - level(a));
  return [...up, ...down];
}

// Device classes that mark a device as an air-quality monitor.
const MONITOR_CLASSES = ['carbon_dioxide', 'pm25', 'radon', 'carbon_monoxide'];

// Air-quality line: these first, in this order; if any is missing on a floor,
// the alternates fill in, up to three readings in total.
const AQ_PREFERRED = ['hum', 'co2', 'pm25'];
const AQ_ALTERNATES = ['radon', 'co'];

/**
 * One row per indoor floor (D47): HVAC status, temperature, and an air-quality
 * line. Readings come from the floor's air-quality monitors (devices with a
 * CO₂, PM2.5, radon or carbon monoxide sensor). With several monitors, one is
 * primary and the others only fill readings it lacks (D59). Without a
 * monitor, the thermostat's own temperature and humidity are used (D28).
 *
 * Monitor priority: settings order first; then the D92 rules (local before
 * internet, push before polling, more decimal places); then device name as a
 * fail-safe. Users can and should set the order when this guesses wrong.
 *
 * Overrides (D5): providers.floors.<floor_id>.monitors: [device_id, ...]
 * and providers.floors.<floor_id>.climate: <entity_id>.
 *
 * Returns [{ id, name, climate, slots, aq }], where each slot is
 * { entity, attr? } or null, and `aq` lists the slot names for the
 * air-quality line. Floors with nothing to show are left out.
 */
function discoverFloors(hass, reg, overrides = {}) {
  return orderFloors(reg.floors).map(floor => {
    const opt = overrides[floor.floor_id] || {};
    const pool = reg.entities.filter(e =>
      e.floor === floor.floor_id && !e.disabled_by && !e.hidden_by && hass.states[e.entity_id] &&
      !DERIVED.test(`${e.translation_key || ''} ${e.original_name || ''} ${e.entity_id}`));
    const dcOf = e => hass.states[e.entity_id].attributes.device_class;
    const sensors = pool.filter(e => e.entity_id.startsWith('sensor.'));

    // Air-quality monitors on this floor.
    const monitorIds = [...new Set(sensors
      .filter(e => MONITOR_CLASSES.includes(dcOf(e)) && e.device_id)
      .map(e => e.device_id))];

    // Rank them: settings order, then D92 (local/push, precision), then name.
    const order = opt.monitors || [];
    const readings = id => sensors.filter(e => e.device_id === id);
    const iotRank = id => Math.min(...readings(id).map(e => IOT_RANK[reg.iot[e.platform]] ?? 9));
    const precision = id => {
      const r = readings(id);
      return r.reduce((sum, e) => sum + decimals(hass.states[e.entity_id].state), 0) / (r.length || 1);
    };
    monitorIds.sort((a, b) =>
      ((order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)) ||
      (iotRank(a) - iotRank(b)) ||
      (precision(b) - precision(a)) ||
      (reg.deviceName[a] || '').localeCompare(reg.deviceName[b] || ''));

    // First monitor (in priority order) that has a reading of this class.
    const fromMonitors = cls => {
      for (const id of monitorIds) {
        const e = sensors.find(x => x.device_id === id && dcOf(x) === cls);
        if (e) return { entity: e.entity_id };
      }
      return null;
    };

    const climate = opt.climate ?? pool.find(e => e.entity_id.startsWith('climate.'))?.entity_id ?? null;
    const slots = {
      temp:  fromMonitors('temperature') ?? (climate ? { entity: climate, attr: 'current_temperature' } : null),
      hum:   fromMonitors('humidity')    ?? (climate ? { entity: climate, attr: 'current_humidity' } : null),
      co2:   fromMonitors('carbon_dioxide'),
      pm25:  fromMonitors('pm25'),
      radon: fromMonitors('radon'),
      co:    fromMonitors('carbon_monoxide'),
    };
    const aq = [...AQ_PREFERRED, ...AQ_ALTERNATES].filter(k => slots[k]).slice(0, 3);
    const empty = !climate && !slots.temp && aq.length === 0;
    return empty ? null : { id: floor.floor_id, name: floor.name, climate, slots, aq };
  }).filter(Boolean);
}

/**
 * A slot's display value: null if there's no entity (hide the slot, D7),
 * 'Err' if the entity exists but its value is bad or missing (D88).
 * `ref` is an entity_id, or { entity, attr } to read an attribute instead.
 */
function numericValue(hass, ref) {
  if (!ref) return null;
  const { entity, attr } = typeof ref === 'string' ? { entity: ref } : ref;
  const st = hass.states[entity];
  const raw = attr ? st?.attributes?.[attr] : st?.state;
  const n = Number(raw);
  return raw !== null && raw !== undefined && raw !== '' && Number.isFinite(n) ? Math.round(n) : 'Err';
}

// Unit shown after a value: the entity's own unit (D32).
const unitOf = (hass, ref) => (ref && !ref.attr && hass.states[ref.entity]?.attributes?.unit_of_measurement) || '';

/**
 * HVAC status for a floor's thermostat (D83): 'heat', 'cool', 'fan', 'idle',
 * 'off' or 'err'; null if the floor has no thermostat.
 */
function hvacStatus(hass, climate) {
  if (!climate) return null;
  const st = hass.states[climate];
  if (!st || st.state === 'unavailable' || st.state === 'unknown') return 'err';
  const action = st.attributes.hvac_action;
  if (action === 'heating' || action === 'preheating' || action === 'defrosting') return 'heat';
  if (action === 'cooling') return 'cool';
  if (action === 'fan' || action === 'drying') return 'fan';
  if (action === 'off' || st.state === 'off') return 'off';
  return 'idle';
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
  /* HVAC status on the floor's temperature icon (D83). Placeholder colours
     until real icons and the palette arrive. */
  .ico.heat { background: #d29a68; }
  .ico.cool { background: #7fa6c8; }
  .ico.fan  { background: #9aa; }
  .ico.off  { opacity: .35; }
  .ico.err  { background: #c0392b; }
  /* Slot with no entity on this install: hidden, not labelled (D7). */
  [data-slot][hidden] { display: none; }
  /* Bad or missing value: "Err", icon becomes an alert (D88). */
  [data-slot].err > .ico { background: #c0392b; }

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

// Markup. Values marked data-live are filled in by the card; the people and
// appointments are still wireframe placeholders.
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
          <span class="t2" data-slot="out-temp"><span class="ico"></span><span data-live="out-temp"></span></span>
          <span class="t3" data-slot="out-hum"><span class="ico"></span><span data-live="out-hum"></span></span>
          <span class="t3" data-slot="out-aqi"><span class="ico"></span><span data-live="out-aqi"></span></span>
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

    <!-- One cluster per indoor floor, built by the card from discovery. -->
    <section class="side indoor" aria-label="Indoor"></section>

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
    if (first) {
      this._tick();
      this._discover();
    } else {
      this._render();
    }
  }

  // Find entities once (registries rarely change; reload the page to re-run).
  async _discover() {
    try {
      this._reg = await loadRegistries(this._hass);
      const providers = this._config?.providers || {};
      this._slots = discoverOutdoor(this._hass, this._reg, providers.outdoor || {});
      this._floors = discoverFloors(this._hass, this._reg, providers.floors || {});
      this._buildFloors();
      this._render(true);
    } catch (err) {
      console.error('Håg: discovery failed', err);
    }
  }

  getCardSize() { return 12; }

  // ----- Lifecycle -----

  connectedCallback() {
    const root = this.shadowRoot;
    this._stage = root.querySelector('.stage');
    this._alertRow = root.querySelector('.alert-row');
    this._out = [...root.querySelectorAll('.outdoor .cluster')];
    this._in = [];   // filled by _buildFloors() after discovery
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

  // Build one cluster per floor (label / HVAC + temperature / air quality).
  _buildFloors() {
    const indoor = this.shadowRoot.querySelector('.indoor');
    const slot = (name, cls = '') =>
      `<span class="${cls}" data-slot="${name}"><span class="ico"></span><span class="val"></span></span>`;
    indoor.innerHTML = this._floors.map(f => `
      <div class="cluster" data-floor="${f.id}">
        <div class="t3"></div>
        <div class="status-line">${slot('temp', 't2')}</div>
        <div class="aq t3">${f.aq.map(k => slot(k)).join('')}</div>
      </div>`).join('');
    this._in = [...indoor.querySelectorAll('.cluster')];
    this._in.forEach((el, i) => { el.firstElementChild.textContent = this._floors[i].name; });
  }

  // Fill one slot: hidden if there's no entity, "Err" for bad values.
  // Returns true if anything visible changed.
  _fill(slot, value, format) {
    const out = slot.querySelector('.val, [data-live]');
    const text = value === null ? '' : value === 'Err' ? 'Err' : format(value);
    if (slot.hidden === (value === null) && out.textContent === text) return false;
    slot.hidden = value === null;
    slot.classList.toggle('err', value === 'Err');
    out.textContent = text;
    return true;
  }

  // hass updates arrive for every state change in the house, so only
  // re-measure the layout when something on screen actually changed.
  _render(force = false) {
    const hass = this._hass;
    if (!this._live || !this._slots || !hass) return;
    const root = this.shadowRoot;
    const q = name => root.querySelector(`[data-slot="${name}"]`);
    let changed = force;

    // Outdoor
    const { temperature, humidity, aqi } = this._slots;
    changed = this._fill(q('out-temp'), numericValue(hass, temperature), v => `${v}°`) || changed;
    changed = this._fill(q('out-hum'),  numericValue(hass, humidity),    v => `${v}%`) || changed;
    changed = this._fill(q('out-aqi'),  numericValue(hass, aqi),         v => `AQI ${v}`) || changed;

    // Floors
    this._in.forEach((el, i) => {
      const f = this._floors[i];
      const fs = name => el.querySelector(`[data-slot="${name}"]`);
      const temp = numericValue(hass, f.slots.temp);
      changed = this._fill(fs('temp'), temp, v => `${v}°`) || changed;
      for (const k of f.aq) {
        const ref = f.slots[k];
        const fmt = k === 'hum' ? v => `${v}%` : v => `${v} ${unitOf(hass, ref)}`.trim();
        changed = this._fill(fs(k), numericValue(hass, ref), fmt) || changed;
      }

      // The temperature's icon shows the HVAC status (D47, D83), or the
      // error icon when the temperature itself is bad (D88).
      const icon = fs('temp').querySelector('.ico');
      const status = temp === 'Err' ? 'err' : (hvacStatus(hass, f.climate) || '');
      if (icon.dataset.status !== status) {
        icon.className = `ico ${status}`;
        icon.dataset.status = status;
        changed = true;
      }
    });

    if (changed) this._layout();
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
