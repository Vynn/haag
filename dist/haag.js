/*
  Håg: Home Assistant at a Glance.
  License: GPL-3.0

  The core. It registers the dashboard strategy `custom:haag` and the host
  that shows glances (see docs/glances.md). Built-in glances are in glances/.

  Plain JavaScript, no build step. Sizes use container query units
  (cqmin = 1% of the screen's shorter side), so one layout scales from a
  phone to a 4K screen.
*/

const VERSION = '0.1.2';
const MANIFEST = 'haag/v1';   // config format marker

/* ------------------------------------------------------------------------
   Shared setup
   ------------------------------------------------------------------------ */

// Registered properties can be animated: the split angle, and daylight
// (0 night, 1 day), which mixes the palette. @property rules don't apply
// inside shadow DOM, so they're registered globally.
for (const prop of [
  { name: '--haag-split', syntax: '<angle>', inherits: true, initialValue: '135deg' },
  { name: '--haag-daylight', syntax: '<number>', inherits: true, initialValue: '0' },
]) {
  try { CSS.registerProperty(prop); } catch { /* already registered, or not supported */ }
}

// Bundled typeface: Open Sans, variable weight and width (SIL Open Font
// License 1.1, in assets/OFL.txt). Font rules inside shadow DOM aren't used
// by Chromium, so the font is registered on the document. It has its own
// family name so it can't clash with an Open Sans installed on the device.
// The file URL keeps this module's query string (the cache tag HACS or the
// Marketplace adds), so an update also refreshes the font.
const FONT_FAMILY = 'Haag Open Sans';
(() => {
  try {
    const url = new URL('./assets/open-sans.ttf', import.meta.url);
    url.search = new URL(import.meta.url).search;
    const face = new FontFace(FONT_FAMILY, `url("${url}")`, { weight: '300 800', stretch: '75% 100%', display: 'swap' });
    document.fonts.add(face);
    return face.load().catch(err => console.warn('Håg: typeface failed to load; using the system font', err));
  } catch (err) {
    return Promise.resolve();
  }
})();

/* ------------------------------------------------------------------------
   Dashboard strategy: `strategy: type: custom:haag`
   One full-screen view holding the host. The strategy block is passed
   through as the host's config.
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
        cards: [{ type: 'custom:haag-host', manifest: MANIFEST, ...options }],
      }],
    };
  }
}

/* ------------------------------------------------------------------------
   Discovery
   Finds entities from HA's registries instead of hardcoded IDs.
   Anything found can be overridden in settings, under
   `providers.outdoor.<slot>: <entity_id>`.
   ------------------------------------------------------------------------ */

// Readings that share a device class but aren't the plain measurement.
const DERIVED = /dew.?point|feels.?like|wet.?bulb|apparent|heat.?index|wind.?chill/i;

// Integration iot_class ranking: local before internet, push before polling.
const IOT_RANK = { local_push: 0, local_polling: 1, cloud_push: 2, cloud_polling: 3 };

// Number of decimal places in a numeric state: a stand-in for precision.
const decimals = state => (/^-?\d+\.(\d+)$/.exec(state)?.[1].length) ?? 0;

/**
 * Read the registries once and index what discovery needs.
 * Registry reads work for any logged-in user.
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
  return { entities, floors, areas, iot, deviceName };
}

/**
 * Outdoor slots from the Exterior floor: temperature, humidity, AQI,
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
 * Indoor floors, in display order (center to edge): the ground floor
 * first, then the floors above it going up, then the floors below it going
 * down. The ground floor is the lowest indoor floor at level 0 or above.
 * (For example: First Floor, Second Floor, then Basement.)
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
 * One row per indoor floor: HVAC status, temperature, and an air-quality
 * line. Readings come from the floor's air-quality monitors (devices with a
 * CO₂, PM2.5, radon or carbon monoxide sensor). With several monitors, one is
 * primary and the others only fill readings it lacks. Without a
 * monitor, the thermostat's own temperature and humidity are used.
 *
 * Monitor priority: settings order first; then the source rules (local before
 * internet, push before polling, more decimal places); then device name as a
 * fail-safe. Users can and should set the order when this guesses wrong.
 *
 * Overrides: providers.floors.<floor_id>.monitors: [device_id, ...]
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

    // Rank them: settings order, then local/push and precision, then name.
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
 * A slot's display value: null if there's no entity (hide the slot),
 * 'Err' if the entity exists but its value is bad or missing.
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

// Unit shown after a value: the entity's own unit.
const unitOf = (hass, ref) => (ref && !ref.attr && hass.states[ref.entity]?.attributes?.unit_of_measurement) || '';

/**
 * HVAC status for a floor's thermostat: 'heat', 'cool', 'fan', 'idle',
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
   Icons
   Material Design Icons, drawn by HA's own `ha-icon`, so Håg ships no icon
   data.
   ------------------------------------------------------------------------ */

// Show an icon in an icon box. The ha-icon inside is created once and only
// touched when the name changes; the box keeps its size either way, so
// icons never move the layout.
function setIcon(box, name) {
  if (!box) return;
  const icon = box.firstElementChild || box.appendChild(document.createElement('ha-icon'));
  if ((icon.getAttribute('icon') || '') === name) return;
  if (name) icon.setAttribute('icon', name);
  else icon.removeAttribute('icon');
}

// The alert row's icons, fitted to its digits: drawn top and bottom in
// MDI's 24-unit grid (@mdi/js 7.4.47). Glances fit their own icons.
const ALERT_INK = { 'mdi:information': [2, 22], 'mdi:alert-octagon': [3, 21] };
const FIGURE = .719 * 30;   // Open Sans digit height, in grid units (1em = 30)

// Scale an alert icon so its drawn part runs from the baseline (22.5 units
// down its .8em box) to the digit tops, about its center.
function fitAlertIcon(box, name) {
  const icon = box.firstElementChild, ink = ALERT_INK[name];
  if (!icon) return;
  if (!ink) { icon.style.scale = icon.style.translate = ''; return; }
  const [top, bottom] = ink;
  const s = FIGURE / (bottom - top);
  icon.style.scale = s.toFixed(3);
  icon.style.translate = `0 ${((10.5 - s * (bottom - 12)) / 24 * 100).toFixed(2)}%`;
}

/* ------------------------------------------------------------------------
   People
   Who's on which floor, and who's away. People are HA `person`
   entities; settings `providers.people`:
     exclude: [person_id, ...]   people not counted, e.g. visitors
     include: [person_id, ...]   only these (optional)
     links:   { person_id: person_id }   follow someone else's location
                                         when you have none of your own
   ------------------------------------------------------------------------ */

function discoverPeople(hass, overrides = {}) {
  const all = Object.keys(hass.states).filter(id => id.startsWith('person.'));
  const ids = (overrides.include || all).filter(id => !(overrides.exclude || []).includes(id) && hass.states[id]);
  return { ids, links: overrides.links || {} };
}

/**
 * Floor for a tracker's reported location: a floor name, an area name (on
 * that floor), or a room name that starts with or contains a floor name
 * (room-presence trackers report e.g. "Upstairs Office"). Returns floor_id or null.
 */
function floorForPlace(place, reg) {
  if (!place) return null;
  const p = place.trim().toLowerCase();
  const indoor = reg.floors.filter(f => !isExterior(f));
  const byFloor = indoor.find(f => f.name.toLowerCase() === p || f.floor_id === p);
  if (byFloor) return byFloor.floor_id;
  const byArea = reg.areas.find(a => a.name.toLowerCase() === p || a.area_id === p);
  if (byArea?.floor_id && indoor.some(f => f.floor_id === byArea.floor_id)) return byArea.floor_id;
  const inName = indoor.find(f => new RegExp(`\\b${f.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(p));
  return inName?.floor_id ?? null;
}

// A person's own location: { floor }, { home } (floor unknown), { away },
// or null when HA doesn't know.
function ownLocation(hass, id, reg) {
  const st = hass.states[id];
  if (!st || st.state === 'unknown' || st.state === 'unavailable') return null;
  if (st.state !== 'home') return { away: true };
  for (const t of st.attributes.device_trackers || []) {
    const floor = floorForPlace(hass.states[t]?.state, reg);
    if (floor) return { floor };
  }
  return { home: true };
}

/**
 * Where each person shows: { person_id: { floor } | { away } }, with
 * `linked: true` when the location came from a link. People
 * without a location of their own follow their link (through the group);
 * home-but-unknown-floor takes a linked person's floor if there is one.
 * People with no usable location aren't shown.
 */
function locatePeople(hass, people, reg) {
  const own = Object.fromEntries(people.ids.map(id => [id, ownLocation(hass, id, reg)]));
  const follow = id => {
    const seen = new Set([id]);
    let next = people.links[id];
    while (next && !seen.has(next)) {
      seen.add(next);
      const loc = own[next] ?? ownLocation(hass, next, reg);
      if (loc && (loc.away || loc.floor)) return loc;
      next = people.links[next];
    }
    return null;
  };
  const where = {};
  for (const id of people.ids) {
    let loc = own[id];
    if (!loc || loc.home) {
      const linked = follow(id);
      // No location at all: take the linked one. Home but floor unknown:
      // take a linked person's floor (not their "away").
      if (linked && (!loc || linked.floor)) loc = { ...linked, linked: true };
    }
    if (loc?.floor || loc?.away) where[id] = loc;
  }
  return where;
}

// Linked people form groups (connected through links in either direction).
function linkGroups(people) {
  const group = {};
  const ids = new Set([...people.ids, ...Object.keys(people.links), ...Object.values(people.links)]);
  let n = 0;
  for (const start of ids) {
    if (group[start] !== undefined) continue;
    const stack = [start];
    while (stack.length) {
      const id = stack.pop();
      if (group[id] !== undefined) continue;
      group[id] = n;
      if (people.links[id]) stack.push(people.links[id]);
      for (const [a, b] of Object.entries(people.links)) if (b === id) stack.push(a);
    }
    n++;
  }
  return group;
}

/* ------------------------------------------------------------------------
   Calendars and daylight
   Which calendars glances read: settings `providers.calendar.calendars:
   [entity_id, ...]`, or every visible calendar when unset.
   ------------------------------------------------------------------------ */

// Day or night from HA's sun entity; without one, day is 6:00 to 18:00.
function isNight(hass, now = new Date()) {
  const sun = Object.keys(hass?.states || {}).find(id => id.startsWith('sun.'));
  if (sun) return hass.states[sun].state === 'below_horizon';
  const h = now.getHours();
  return h < 6 || h >= 18;
}

function discoverCalendars(hass, reg, overrides = {}) {
  if (overrides.calendars) return overrides.calendars;
  return reg.entities
    .filter(e => e.entity_id.startsWith('calendar.') && !e.disabled_by && !e.hidden_by && hass.states[e.entity_id])
    .map(e => e.entity_id);
}

/* ------------------------------------------------------------------------
   Glances
   Bootstraps register through window.haagGlances (docs/glances.md).
   ------------------------------------------------------------------------ */

const GLANCE_FORMAT = 'haag-glance/v1';
const BUILT_IN = ['sinnesro'];
const DEFAULT_GLANCE = 'sinnesro';
const CYCLE = 30;           // seconds per turn when several glances want the screen
const STARTUP_LIMIT = 60;   // seconds before an empty screen turns critical
const SPLIT_ANGLE = 45;     // the diagonal, from horizontal
const NAME = /^[a-z][a-z0-9_-]*$/;
const THEMES = ['auto', 'dark', 'light'];   // auto follows the sun
const BUILT_IN_BASE = new URL('./glances/', import.meta.url).href;
const HELP_URL = 'https://github.com/Vynn/haag/blob/main/docs/glances.md';

// Notices go to the browser console until real alerts arrive in 0.3.
// Each is given once.
const reported = new Set();
function notice(message, detail) {
  if (reported.has(message)) return;
  reported.add(message);
  console.warn(`Håg: ${message}`, ...(detail === undefined ? [] : [detail]));
}

// Every registration, by glance name, in arrival order.
const registry = new Map();
const registryListeners = new Set();

function register(reg) {
  const name = reg?.manifest?.name;
  if (typeof name !== 'string' || !NAME.test(name)) {
    notice(`a glance has an invalid name: ${name}`, reg?.url);
    return;
  }
  registry.set(name, [...(registry.get(name) || []), reg]);
  registryListeners.forEach(fn => fn());
}

const isBuiltIn = reg => String(reg.url || '').startsWith(BUILT_IN_BASE);

// The registration a name runs. A built-in glance wins a clash; two others
// with one name both lose.
function resolve(name) {
  const regs = registry.get(name) || [];
  const builtIn = regs.find(isBuiltIn);
  if (regs.length > 1) {
    notice(`${regs.length} glances are named "${name}"; ${builtIn ? 'the built-in one runs' : 'none of them runs'}`,
           regs.map(r => r.url));
  }
  if (builtIn) return builtIn;
  return regs.length === 1 ? regs[0] : null;
}

// Bootstraps that loaded before the core wait in a plain array.
const waiting = Array.isArray(window.haagGlances) ? window.haagGlances : [];
window.haagGlances = { push: (...regs) => regs.forEach(register) };
waiting.forEach(register);

// Built-in bootstraps, with this module's cache tag.
for (const name of BUILT_IN) {
  const url = new URL(`./glances/${name}/${name}.js`, import.meta.url);
  url.search = new URL(import.meta.url).search;
  import(url.href).catch(err => notice(`the built-in glance "${name}" failed to load`, err));
}

// The settings that decide which glances run.
function readSettings(config) {
  const glances = config.glances && typeof config.glances === 'object' ? config.glances : {};
  for (const name of Object.keys(glances)) {
    if (!NAME.test(name)) notice(`"${name}" isn't a valid glance name (lowercase letters, digits, _ and -, starting with a letter)`);
  }
  const def = String(config.default ?? DEFAULT_GLANCE);
  let cycle = Number(config.cycle ?? CYCLE);
  if (!(cycle > 0)) {
    notice(`cycle must be a number of seconds; using ${CYCLE}`);
    cycle = CYCLE;
  }
  let theme = String(config.theme ?? 'auto');
  if (!THEMES.includes(theme)) {
    notice(`theme must be auto, dark or light; using auto`);
    theme = 'auto';
  }
  return {
    glances,
    def,
    defOn: glances[def]?.enabled !== false,
    order: Object.keys(glances).filter(n => NAME.test(n) && n !== def && glances[n]?.enabled === true),
    cycle,
    theme,
  };
}

/* ------------------------------------------------------------------------
   Host
   The one Home Assistant card on Håg's dashboard. It runs the glances,
   picks the one on screen, and draws the alert row above it.
   ------------------------------------------------------------------------ */

const HOST_STYLE = `
  :host {
    /* One size unit for everything: 1% of the screen's shorter side, times
       a global scale. Glances inherit it. */
    --haag-scale: 0.9;
    --u: calc(1cqmin * var(--haag-scale));
    --move: 700ms ease-in-out;
    display: block;
    width: 100%;
    height: var(--haag-height, 100vh);
    container-type: size;
    font-family: 'Haag Open Sans', system-ui, sans-serif;
  }

  /* Palette: night and day values, mixed in OKLab by --haag-daylight
     (0 night, 1 day). Glances inherit the mixed colours. Values are
     placeholders until the text pass. */
  .stage {
    --n-sky: #10162A;       --d-sky: #7CC8F2;        /* outdoor base */
    --n-horizon: #1D3442;   --d-horizon: #FFD6E7;    /* outdoor glow */
    --n-home: #1E2433;      --d-home: #F6FAFF;       /* indoor base */
    --n-band: #FFFFFF14;    --d-band: #FFFFFFB3;     /* alert row */
    --n-text: #F1EADC;      --d-text: #0E1F3A;
    --n-text-2: #A9B0C2;    --d-text-2: #34537A;     /* secondary */
    --n-coral: #FF7A68;     --d-coral: #D6336C;      /* heating, alerts */
    --n-seaglass: #72D8C6;  --d-seaglass: #0B8A5E;   /* cooling */
    --n-mist: #8FA6C8;      --d-mist: #FFFFFF;       /* haze */
    --day-mix: calc(var(--haag-daylight) * 100%);
    --sky: color-mix(in oklab, var(--d-sky) var(--day-mix), var(--n-sky));
    --horizon: color-mix(in oklab, var(--d-horizon) var(--day-mix), var(--n-horizon));
    --home: color-mix(in oklab, var(--d-home) var(--day-mix), var(--n-home));
    --band: color-mix(in oklab, var(--d-band) var(--day-mix), var(--n-band));
    --text: color-mix(in oklab, var(--d-text) var(--day-mix), var(--n-text));
    --text-2: color-mix(in oklab, var(--d-text-2) var(--day-mix), var(--n-text-2));
    --coral: color-mix(in oklab, var(--d-coral) var(--day-mix), var(--n-coral));
    --seaglass: color-mix(in oklab, var(--d-seaglass) var(--day-mix), var(--n-seaglass));
    --mist: color-mix(in oklab, var(--d-mist) var(--day-mix), var(--n-mist));
    /* Secondary text on the sky: a touch darker by day, for 4.5:1. */
    --text-2-out: color-mix(in oklab, var(--text) calc(var(--haag-daylight) * 7%), var(--text-2));

    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: linear-gradient(var(--haag-split), var(--sky) 50%, var(--home) 50%);
    color: var(--text);
  }
  /* Day and night switch quickly, at sunrise and sunset. */
  .stage.animate { transition: --haag-daylight 2.5s ease-in-out; }

  /* Glances fill the screen; switching crossfades. */
  .glances > * {
    position: absolute;
    inset: 0;
    opacity: 0;
    visibility: hidden;
    transition: opacity var(--move), visibility var(--move);
  }
  .glances > .on { opacity: 1; visibility: visible; }

  /* Alert row: full width through the center, above every glance. One
     line of text, so the icon sits on its baseline. */
  .alert-row {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    translate: 0 -50%;
    padding: calc(1.2 * var(--u)) 0;
    font-size: calc(5.5 * var(--u));
    text-align: center;
    white-space: nowrap;
  }
  .stage.animate .alert-row { transition: opacity var(--move), visibility var(--move), background-color var(--move); }
  .alert-row.hidden { opacity: 0; visibility: hidden; }
  /* Severity. */
  .alert-row.info { background: var(--band); }
  .alert-row.info .ico { color: var(--text-2); }
  /* Troubleshooting can run long, so a critical alert wraps inside the row.
     Coral, with white text by day and night-sky text at night. */
  .alert-row.critical {
    padding-inline: calc(4 * var(--u));
    background: var(--coral);
    color: color-mix(in oklab, #FFFFFF var(--day-mix), var(--n-sky));
    white-space: normal;
  }
  .alert-row a { color: inherit; margin-left: .8em; }
  .msg { font-variant-numeric: tabular-nums; }   /* steady countdown */

  .ico { display: inline-block; width: .8em; height: .8em; margin-right: .2em; vertical-align: -.05em; }
  .ico > ha-icon { display: flex; width: 100%; height: 100%; --mdc-icon-size: 100%; }
`;

const HOST_TEMPLATE = `
  <div class="stage">
    <div class="glances"></div>
    <div class="alert-row info" role="status"><span class="ico"></span><span class="msg"></span><span class="links"></span></div>
  </div>
`;

class HaagHost extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `<style>${HOST_STYLE}</style>${HOST_TEMPLATE}`;
    const root = this.shadowRoot;
    this._stage = root.querySelector('.stage');
    this._layer = root.querySelector('.glances');
    this._row = root.querySelector('.alert-row');
    this._running = new Map();   // name → { reg, el, visible, wants }
    this._loading = new Set();
    this._failed = new Set();
    this._showing = null;
    this._placeholder = true;    // the version row (until 0.3)
    this._sync = this._sync.bind(this);
  }

  // ----- Lovelace card API -----

  setConfig(config) {
    this._config = config;
    this._settings = readSettings(config);
    this._updateDaylight();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this._updateDaylight();
    if (first) this._discover();
    for (const { el } of this._running.values()) el.hass = hass;
  }

  getCardSize() { return 12; }

  // Test page: show or hide the version row.
  setAlertVisible(visible) {
    this._placeholder = visible;
    this._updateAlert();
  }

  // ----- Lifecycle -----

  connectedCallback() {
    this._startedAt ??= Date.now();
    this.style.setProperty('--haag-split', `${180 - SPLIT_ANGLE}deg`);
    registryListeners.add(this._sync);
    this._sync();
    this._updateAlert();
    // At the startup limit: report missing glances, and turn critical if
    // nothing is on screen.
    const left = STARTUP_LIMIT * 1000 - (Date.now() - this._startedAt);
    if (left > 0) this._limitTimer = setTimeout(() => { this._reportMissing(); this._updateAlert(); }, left + 50);
    // Animate only after the first frame, so nothing fades in on load.
    requestAnimationFrame(() => requestAnimationFrame(() => this._stage.classList.add('animate')));
  }

  disconnectedCallback() {
    registryListeners.delete(this._sync);
    clearTimeout(this._turnTimer);
    clearTimeout(this._limitTimer);
    clearTimeout(this._countTimer);
    this._turnTimer = null;
    this._countTimer = null;
  }

  // ----- Glances -----

  // Find entities once (registries rarely change; reload to re-run), then
  // start the glances. Without registries, glances still run, with nothing
  // discovered.
  async _discover() {
    const hass = this._hass;
    const p = this._config?.providers || {};
    let reg = { entities: [], floors: [], areas: [], iot: {}, deviceName: {} };
    try {
      reg = await loadRegistries(hass);
    } catch (err) {
      console.error('Håg: discovery failed', err);
    }
    const people = discoverPeople(hass, p.people || {});
    this._providers = {
      outdoor: discoverOutdoor(hass, reg, p.outdoor || {}),
      floors: discoverFloors(hass, reg, p.floors || {}),
      people: { ...people, groups: linkGroups(people) },
      calendars: discoverCalendars(hass, reg, p.calendar || {}),
      value: ref => numericValue(this._hass, ref),
      unit: ref => unitOf(this._hass, ref),
      hvac: climate => hvacStatus(this._hass, climate),
      locate: () => locatePeople(this._hass, people, reg),
    };
    this._sync();
  }

  // Start what settings turn on; stop what a new clash rules out.
  _sync() {
    if (!this._settings || !this._providers || !this.isConnected) return;
    const { def, defOn, order } = this._settings;
    for (const [name, entry] of this._running) {
      if (resolve(name) !== entry.reg) this._stop(name);
    }
    for (const name of defOn ? [def, ...order] : order) {
      if (this._running.has(name) || this._loading.has(name) || this._failed.has(name)) continue;
      const reg = resolve(name);
      if (reg) this._load(name, reg);
    }
    this._schedule();
  }

  async _load(name, reg) {
    this._loading.add(name);
    try {
      const { format, element } = reg.manifest;
      if (format !== GLANCE_FORMAT) throw new Error(`format ${format} isn't supported`);
      await reg.load();
      if (!customElements.get(element)) throw new Error(`<${element}> isn't defined`);
      if (resolve(name) !== reg || !this.isConnected) return;
      const entry = { reg, el: document.createElement(element), visible: false, wants: false };
      entry.el.haag = this._context(entry);
      entry.el.setConfig?.(this._settings.glances[name] || {});
      if (this._hass) entry.el.hass = this._hass;
      this._layer.append(entry.el);
      this._running.set(name, entry);
    } catch (err) {
      this._failed.add(name);
      notice(`the glance "${name}" failed to load`, { file: reg.url, error: err });
    } finally {
      this._loading.delete(name);
      this._schedule();
    }
  }

  _stop(name) {
    this._running.get(name)?.el.remove();
    this._running.delete(name);
  }

  // What a glance gets from Håg (docs/glances.md).
  _context(entry) {
    const host = this;
    return {
      providers: this._providers,
      get daylight() { return host._daylight; },
      layout: { angle: SPLIT_ANGLE },
      icon: setIcon,
      get alert() { return host._alertBand(); },
      get visible() { return entry.visible; },
      request() { entry.wants = true; host._schedule(); },
      release() { entry.wants = false; host._schedule(); },
    };
  }

  // What's on screen: glances that want it take turns, in settings order;
  // otherwise the default glance.
  _schedule(rotate = false) {
    if (!this._settings) return;
    const { def, order, cycle } = this._settings;
    const asking = order.filter(n => this._running.get(n)?.wants);
    let next = this._showing;
    if (!asking.length) next = this._running.has(def) ? def : null;
    else if (rotate || !asking.includes(next)) next = asking[(asking.indexOf(next) + 1) % asking.length];
    const changed = next !== this._showing;
    if (changed) this._show(next);
    if (asking.length < 2) {
      clearTimeout(this._turnTimer);
      this._turnTimer = null;
    } else if (changed || rotate || !this._turnTimer) {
      clearTimeout(this._turnTimer);
      this._turnTimer = setTimeout(() => { this._turnTimer = null; this._schedule(true); }, cycle * 1000);
    }
    this._updateAlert();
  }

  _show(name) {
    this._showing = name;
    for (const [n, entry] of this._running) {
      const on = n === name;
      if (entry.visible === on) continue;
      entry.visible = on;
      entry.el.classList.toggle('on', on);
      entry.el.dispatchEvent(new Event('haag-visible'));
    }
  }

  // ----- Day and night -----

  // The theme setting, or the sun when it's auto.
  _updateDaylight() {
    const theme = this._settings?.theme;
    this._daylight = theme === 'light' || (theme !== 'dark' && !isNight(this._hass));
    this._stage.style.setProperty('--haag-daylight', this._daylight ? 1 : 0);
  }

  // ----- Alert row -----

  // The startup alert, a critical alert when nothing can show, or the
  // version as placeholder content until 0.3.
  _updateAlert() {
    if (this._startedAt === undefined) return;
    if (this._showing) this._ready = true;
    const waited = Date.now() - this._startedAt;
    if (this._showing) {
      this._setAlert({ level: 'info', icon: 'mdi:information', text: `Håg · v${VERSION}`, hidden: !this._placeholder });
    } else if (!this._ready && waited < STARTUP_LIMIT * 1000) {
      this._setAlert({ level: 'info', icon: 'mdi:information', text: 'Starting up' });
      this._countdown();
    } else {
      this._setAlert({ level: 'critical', icon: 'mdi:alert-octagon', text: this._problem(), help: true });
      this._reportMissing();
    }
  }

  // Why nothing can show.
  _problem() {
    if (!this._hass) return 'No connection to Home Assistant';
    const { def, defOn } = this._settings || {};
    const regs = registry.get(def) || [];
    const title = regs[0]?.manifest?.title || def;
    if (!defOn) return `Nothing to show: ${title} is turned off`;
    if (this._failed.has(def)) return `Nothing to show: ${title} failed to load`;
    if (regs.length > 1 && !regs.some(isBuiltIn)) return `Nothing to show: ${regs.length} glances are named ${def}`;
    if (!regs.length) return `Nothing to show: ${def} isn't installed`;
    return `Nothing to show: ${title} hasn't started`;
  }

  _reportMissing() {
    if (!this._settings) return;
    const { def, defOn, order } = this._settings;
    for (const name of defOn ? [def, ...order] : order) {
      if (!registry.has(name)) notice(`settings name a glance that isn't installed: ${name}`);
    }
  }

  // Seconds left to the startup limit, so the row doesn't look frozen.
  // Written in place: the band doesn't move, so glances aren't told.
  _countdown() {
    if (this._countTimer) return;
    const tick = () => {
      const left = STARTUP_LIMIT * 1000 - (Date.now() - this._startedAt);
      this._row.querySelector('.msg').textContent = `Starting up · ${Math.max(0, Math.ceil(left / 1000))} s`;
      this._countTimer = left > 0 ? setTimeout(tick, left % 1000 || 1000) : null;
    };
    tick();
  }

  _setAlert(state) {
    const key = JSON.stringify(state);
    if (key === this._alertKey) return;
    this._alertKey = key;
    clearTimeout(this._countTimer);
    this._countTimer = null;
    const { level, icon, text, help = false, hidden = false } = state;
    const row = this._row;
    row.className = `alert-row ${level}${hidden ? ' hidden' : ''}`;
    const box = row.querySelector('.ico');
    setIcon(box, icon);
    fitAlertIcon(box, icon);
    row.querySelector('.msg').textContent = text;
    // Settings opens edit mode (admins, storage-mode dashboards).
    row.querySelector('.links').innerHTML = help
      ? `<a href="?edit=1">Settings</a><a href="${HELP_URL}" target="_blank" rel="noopener">Help</a>`
      : '';
    for (const { el } of this._running.values()) el.dispatchEvent(new Event('haag-alert'));
  }

  // The row's band, relative to the screen.
  _alertBand() {
    const top = this.getBoundingClientRect().top;
    const r = this._row.getBoundingClientRect();
    return { showing: !this._row.classList.contains('hidden'), top: r.top - top, bottom: r.bottom - top };
  }
}

/* ------------------------------------------------------------------------
   Registration
   ------------------------------------------------------------------------ */

if (!customElements.get('ll-strategy-dashboard-haag')) {
  customElements.define('ll-strategy-dashboard-haag', HaagStrategy);
}
if (!customElements.get('haag-host')) {
  customElements.define('haag-host', HaagHost);
}

console.info(`%c Håg %c v${VERSION} `, 'background:#222;color:#fff;border-radius:3px 0 0 3px', 'background:#999;color:#fff;border-radius:0 3px 3px 0');
