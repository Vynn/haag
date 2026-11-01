/*
  Håg: Home Assistant at a Glance.
  License: GPL-3.0

  The core. It registers the dashboard strategy `custom:haag` and the host
  that shows glances (see docs/glances.md). Built-in glances are in glances/.

  Plain JavaScript, no build step. Sizes use container query units
  (cqmin = 1% of the screen's shorter side), so one layout scales from a
  phone to a 4K screen.
*/

const VERSION = '0.3.0';
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
    return face.load().catch(err => notice('info', "Typeface didn't load · using the system font", err));
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

  // The settings editor in HA's dashboard editor (see Settings editor).
  static async getConfigElement() {
    await loadHaForm();
    return document.createElement('haag-editor');
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
 * Outdoor slots: temperature, humidity and AQI from the Exterior floor;
 * the weather from there, or from anywhere when it has none; the moon
 * phase from anywhere (it belongs to no floor).
 * Returns { slot: entity_id | null }.
 */
const isExterior = floor => /exterior|outdoor|outside/i.test(floor.name);
const MOON_PHASES = ['new_moon', 'waxing_crescent', 'first_quarter', 'waxing_gibbous',
  'full_moon', 'waning_gibbous', 'last_quarter', 'waning_crescent'];

function discoverOutdoor(hass, reg, overrides = {}) {
  const exterior = reg.floors.find(isExterior);
  const all = reg.entities.filter(e => !e.disabled_by && !e.hidden_by && hass.states[e.entity_id]);
  const pool = all.filter(e => exterior && e.floor === exterior.floor_id);

  const best = (match, from = pool) => {
    const candidates = from.filter(e => {
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
  const weather = e => e.entity_id.startsWith('weather.');
  // HA's Moon integration: an enum sensor with the eight phases as options.
  const moon = (e, st) => dc('enum')(e, st) && MOON_PHASES.every(p => st.attributes.options?.includes(p));
  // AQI: not PurpleAir's VOC index. Preferred: Google's local index over its
  // UAQI (which runs backwards), and of a US and China pair, the one for
  // HA's country.
  const china = hass.config?.country === 'CN';
  const aqi = (e, st) => dc('aqi')(e, st) && !(e.platform === 'purpleair' && e.translation_key === 'voc_aqi');
  const aqiFirst = (e, st) => aqi(e, st) && !(e.platform === 'google_air_quality' && e.translation_key === 'uaqi') &&
    (chinaIndex(e) ?? china) === china;

  return {
    temperature: overrides.temperature ?? best(dc('temperature')),
    humidity:    overrides.humidity    ?? best(dc('humidity')),
    aqi:         overrides.aqi         ?? best(aqiFirst) ?? best(aqi),
    weather:     overrides.weather     ?? best(weather) ?? best(weather, all),
    moon:        overrides.moon        ?? best(moon, all),
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
const ALERT_INK = { 'mdi:information': [2, 22], 'mdi:alert': [2, 21], 'mdi:alert-octagon': [3, 21] };
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
   Household alerts
   Built-in alerts for things without a glance of their own: hazards,
   leaks, things left open or unlocked, and air quality. Sensors are found
   by device class. Their settings are under alerts.core (see Settings).
   ------------------------------------------------------------------------ */

const MINUTE = 60 * 1000;

// Alarms: critical at once, and they hold the row.
const HAZARDS = { smoke: 'Smoke Alert', carbon_monoxide: 'Carbon Monoxide (CO) Alert', gas: 'Gas Alert' };

// Things left open, by binary sensor and cover device class.
const OPENINGS = {
  door:    { noun: 'door',        binary: ['door'],        cover: ['door'] },
  garage:  { noun: 'garage door', binary: ['garage_door'], cover: ['garage'] },
  gate:    { noun: 'gate',        binary: [],              cover: ['gate'] },
  window:  { noun: 'window',      binary: ['window'],      cover: ['window'] },
  opening: { noun: 'opening',     binary: ['opening'],     cover: [], named: true },   // by the entity's own name
};
const UNLOCKED = ['unlocked', 'open', 'opening', 'unlocking'];

// Indoor readings, with their limits in each unit they may come in
// (µ and μ both written u). Readings in other units aren't watched.
const CO_MG = 28.01 / 24.055;   // mg/m³ per ppm of CO at 20 °C, as HA converts
const READINGS = {
  carbon_dioxide:  { label: 'CO₂',   limits: { ppm: 1000 } },
  pm25:            { label: 'PM2.5', limits: { 'ug/m³': 35.5 } },
  radon:           { label: 'radon', limits: { 'Bq/m³': 100, 'pCi/L': 100 / 37 } },
  carbon_monoxide: { label: 'CO',    limits: { ppm: 30, ppb: 30000, 'mg/m³': 30 * CO_MG, 'ug/m³': 30000 * CO_MG } },
};
const unitKey = unit => String(unit).replace(/[µμ]/g, 'u');

// Radon: a monitor's long-term average, else its 1-day, else the rest.
const radonRank = e => {
  const s = `${e.translation_key || ''} ${e.unique_id || ''} ${e.original_name || ''}`;
  return /long.?term/i.test(s) ? 0 : /1.?day|short.?term/i.test(s) ? 1 : /week/i.test(s) ? 2 : 3;
};

// Outdoor AQI scales: band names from low to high (by the lowest value in
// each), and where warnings start. Each warns where at-risk people are
// named or told to cut back, or at the band named moderate when a scale
// gives no advice. China's index uses aqicn's names. Google's UAQI runs
// backwards: it warns below its limit.
const US_BANDS = [[0, 'good'], [51, 'moderate'], [101, 'unhealthy for sensitive groups'], [151, 'unhealthy'],
  [201, 'very unhealthy'], [301, 'hazardous']];
const AQI_SCALES = {
  us:   { warn: 51, bands: US_BANDS },
  cn:   { warn: 51, bands: US_BANDS },
  aqhi: { warn: 4,  bands: [[0, 'low risk'], [4, 'moderate risk'], [7, 'high risk'], [11, 'very high risk']] },
  daqi: { warn: 4,  bands: [[0, 'low'], [4, 'moderate'], [7, 'high'], [10, 'very high']] },
  owm:  { warn: 3,  bands: [[0, 'good'], [2, 'fair'], [3, 'moderate'], [4, 'poor'], [5, 'very poor']] },
  caqi: { warn: 50, bands: [[0, 'very low'], [25, 'low'], [50, 'medium'], [75, 'high'], [101, 'very high']] },
  uaqi: { warn: 60, below: true, bands: [[0, 'poor'], [20, 'low'], [40, 'moderate'], [60, 'good'], [80, 'excellent']] },
  gios: { warn: 'moderate', levels: ['very_good', 'good', 'moderate', 'sufficient', 'bad', 'very_bad'] },   // no number
};
const AQI_PLATFORMS = { environment_canada: 'aqhi', openweathermap: 'owm', airly: 'caqi', gios: 'gios' };

// Of a US and China pair (AirVisual, Tomorrow.io): true for the China
// index, false for the US one; null for other sensors.
function chinaIndex(e) {
  if (e.platform === 'airvisual') return /_cn_/.test(e.unique_id || '');
  if (e.platform === 'tomorrowio') return /china/.test(e.translation_key || '');
  return null;
}

// An AQI sensor's scale, by its integration; unknown ones read as US AQI.
// Google's local index is named in the sensor's name.
function aqiScale(hass, e) {
  if (chinaIndex(e)) return 'cn';
  if (e.platform === 'google_air_quality') {
    if (e.translation_key === 'uaqi') return 'uaqi';
    const name = hass.states[e.entity_id]?.attributes.friendly_name || '';
    return [['aqhi', /AQHI/i], ['daqi', /DAQI/i], ['caqi', /CAQI/i], ['cn', /\b(CN|China|MEE|MEP)\b/i]]
      .find(([, re]) => re.test(name))?.[0] ?? 'us';
  }
  return AQI_PLATFORMS[e.platform] || 'us';
}

/**
 * The sensors household alerts watch: enabled, visible, with a state,
 * for the alerts turned on in settings (alerts.core), less the sensors
 * left out. Readings are indoor only; outdoor air is the AQI Overview
 * shows, or Airly's or GIOŚ's index when there's none.
 * Returns [{ entity, kind, cls?, area, subject, name, after?, critical?,
 * hold?, limit?, ... }], timings in ms and limits in the sensor's unit.
 */
function discoverAlerts(hass, reg, outdoorAqi, settings) {
  const exterior = reg.floors.find(isExterior)?.floor_id;
  const areaName = Object.fromEntries(reg.areas.map(a => [a.area_id, a.name]));
  const all = reg.entities.filter(e => !e.disabled_by && !e.hidden_by && hass.states[e.entity_id]);
  const nameOf = e => hass.states[e.entity_id].attributes.friendly_name || e.entity_id;
  const watch = [];
  // An alert names the area, else the device, else the entity.
  const add = (e, kind, more) => watch.push({ entity: e.entity_id, kind, area: e.area,
    subject: areaName[e.area] || reg.deviceName[e.device_id] || nameOf(e), name: nameOf(e), ...more });
  const radon = new Map();   // device → its preferred radon reading
  for (const e of all) {
    const domain = e.entity_id.split('.')[0];
    const { device_class: dc, unit_of_measurement: unit } = hass.states[e.entity_id].attributes;
    const opening = key => Object.keys(OPENINGS).find(k => OPENINGS[k][key].includes(dc));
    if (domain === 'binary_sensor') {
      if (HAZARDS[dc]) add(e, 'hazard', { cls: dc });
      else if (dc === 'moisture') add(e, 'leak');
      else if (opening('binary')) add(e, 'open', { cls: opening('binary') });
    } else if (domain === 'cover') {
      if (opening('cover')) add(e, 'open', { cls: opening('cover'), cover: true });
    } else if (domain === 'lock') {
      add(e, 'lock');
    } else if (domain === 'sensor' && READINGS[dc] && !(exterior && e.floor === exterior)) {
      const limits = READINGS[dc].limits;
      const limit = unit ? limits[unitKey(unit)] : Object.values(limits)[0];
      if (limit === undefined) continue;
      const more = { cls: dc, limit, unit: unit || Object.keys(limits)[0], toCanon: Object.values(limits)[0] / limit };
      if (dc === 'radon' && e.device_id) {
        const kept = radon.get(e.device_id);
        if (!kept || radonRank(e) < radonRank(kept.e)) radon.set(e.device_id, { e, more });
      } else add(e, 'reading', more);
    }
  }
  for (const { e, more } of radon.values()) add(e, 'reading', more);

  const regional = e => (e.platform === 'airly' && e.translation_key === 'caqi') ||
    (e.platform === 'gios' && e.translation_key === 'aqi');
  const aqi = outdoorAqi ? reg.entities.find(e => e.entity_id === outdoorAqi) ?? { entity_id: outdoorAqi } : all.find(regional);
  if (aqi) watch.push({ entity: aqi.entity_id, kind: 'aqi', scale: aqiScale(hass, aqi) });

  // Settings: timings, and the limit in the sensor's own unit. A CO alarm
  // keeps its area's CO readings, quiet, to show their level.
  const coAlarm = settings.co.enabled;
  return watch.flatMap(w => {
    const s = settings[CORE_ALERT_OF[coverOf(w)]];
    const quiet = !s.enabled || s.exclude.includes(w.entity);
    if (quiet && !(coAlarm && w.kind === 'reading' && w.cls === 'carbon_monoxide')) return [];
    return [{ ...w, quiet, after: s.after * 1000, critical: s.critical_after * 1000, hold: s.hold * 1000,
      ...(w.limit && { limit: s.limit / w.toCanon }) }];
  });
}

// A number as HA's number format writes it (from HA's frontend: each style
// stands for a locale).
function formatNumber(hass, n, digits = 0) {
  const style = hass?.locale?.number_format;
  if (style === 'none') return String(Math.round(n * 10 ** digits) / 10 ** digits);
  const locale = { comma_decimal: 'en-US', decimal_comma: 'de', space_comma: 'fr', quote_decimal: 'de-CH' }[style]
    ?? (style === 'system' ? undefined : hass?.locale?.language || hass?.language);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
}

// A time as HA's time format writes it (12 or 24 hours, or the locale's
// own), in HA's time zone, with the weekday when it isn't today:
// "4:00 PM", "16:00", "Sat 4:00 PM".
function formatTime(hass, t, now = Date.now()) {
  const timeZone = hass?.config?.time_zone;
  const style = hass?.locale?.time_format;
  const locale = style === 'system' ? undefined : hass?.locale?.language || hass?.language;
  const day = d => new Intl.DateTimeFormat('en-CA', { timeZone }).format(d);   // YYYY-MM-DD
  const options = { hour: 'numeric', minute: '2-digit', ...{ 12: { hour12: true }, 24: { hourCycle: 'h23' } }[style], timeZone };
  if (day(t) !== day(now)) options.weekday = 'short';
  return new Intl.DateTimeFormat(locale, options).format(t);
}

// "3 min", "2 h", "4 d", rounded down.
function duration(ms) {
  const m = Math.floor(ms / MINUTE);
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const listOf = names => names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * Household alerts from the latest states: [{ key, level, text, hold,
 * since }], one per type, and when to look again (ms time, or Infinity).
 * `seen` keeps when each reading first passed its limit. `fits(text)`
 * says whether text fits the alert row; groups name their members when
 * it does, and count them otherwise.
 */
function householdAlerts(hass, watch, seen, fits, now = Date.now()) {
  let next = Infinity;
  const later = t => { if (t > now) next = Math.min(next, t); };
  const groups = new Map();   // alert key → members
  const join = (key, member) => groups.set(key, [...(groups.get(key) || []), member]);

  for (const w of watch) {
    const st = hass.states[w.entity];
    if (!st || st.state === 'unavailable' || st.state === 'unknown') {
      seen.delete(w.entity);
      continue;
    }
    if (w.quiet) continue;
    const since = Date.parse(st.last_changed) || now;
    const waited = (wait, id) => now - since >= wait ? join(id, { w, since }) : later(since + wait);
    if (w.kind === 'hazard') {
      if (st.state === 'on') join(`hazard:${w.cls}`, { w, since });
    } else if (w.kind === 'leak') {
      if (st.state !== 'on') continue;
      const critical = now - since >= w.critical;
      join('leak', { w, since, critical });
      if (critical) later(now + MINUTE - (now - since) % MINUTE);   // the duration shown
      else later(since + w.critical);
    } else if (w.kind === 'open') {
      if (w.cover ? st.state !== 'closed' : st.state === 'on') waited(w.after, `open:${w.cls}`);
    } else if (w.kind === 'lock') {
      if (st.state === 'jammed') join('jammed', { w, since });
      else if (UNLOCKED.includes(st.state)) waited(w.after, 'unlocked');
    } else {
      // Readings and outdoor AQI: past the limit for the hold, from when first seen.
      const scale = AQI_SCALES[w.scale];
      let value = Number(st.state), band, past;
      if (scale?.levels) {
        value = null;
        band = st.state.replace(/_/g, ' ');
        past = scale.levels.indexOf(st.state) >= scale.levels.indexOf(scale.warn);
      } else if (!Number.isFinite(value)) {
        seen.delete(w.entity);
        continue;
      } else if (scale) {
        band = scale.bands.findLast(([min]) => Math.round(value) >= min)?.[1];
        past = scale.below ? value < scale.warn : value >= scale.warn;
      } else past = value >= w.limit;
      if (!past) {
        seen.delete(w.entity);
        continue;
      }
      const first = seen.get(w.entity) ?? now;
      seen.set(w.entity, first);
      if (now - first >= w.hold) join(w.kind === 'aqi' ? 'aqi' : `reading:${w.cls}`, { w, since: first, value, band });
      else later(first + w.hold);
    }
  }

  const alerts = [];
  for (const [key, members] of groups) {
    const [kind, cls] = key.split(':');
    const subjects = [...new Set(members.map(m => m.w.subject))];
    const n = members.length;
    // Names if one, or if they fit; otherwise a count.
    const named = (text, counted) => subjects.length === 1 || fits(text) ? text : counted;
    const areas = lead => named(`${lead} in ${listOf(subjects)}`, `${lead} in ${subjects.length} areas`);
    let level = 'info', hold = false, text;
    if (kind === 'hazard') {
      level = 'critical';
      hold = true;
      text = areas(HAZARDS[cls]);
      // A CO alarm shows its area's CO reading, in ppm.
      const area = members[0].w.area;
      const ppm = subjects.length === 1 && cls === 'carbon_monoxide' && area && Math.max(...watch
        .filter(w => w.kind === 'reading' && w.cls === 'carbon_monoxide' && w.area === area)
        .map(w => Number(hass.states[w.entity]?.state) * w.toCanon).filter(Number.isFinite));
      if (ppm > 0) text += ` · ${formatNumber(hass, ppm)} ppm`;
    } else if (kind === 'leak') {
      const critical = members.filter(m => m.critical);
      level = critical.length ? 'critical' : 'warning';
      text = areas('Water Leak');
      if (critical.length) text += ` · ${duration(now - Math.min(...critical.map(m => m.since)))}`;
    } else if (kind === 'open') {
      const { noun, named: byName } = OPENINGS[cls];
      if (byName) {
        const names = [...new Set(members.map(m => m.w.name))];
        text = names.length === 1 || fits(`${listOf(names)} open`) ? `${listOf(names)} open` : `${n} ${noun}s open`;
      } else if (subjects.length === 1) {
        const nouns = n > 1 ? `${noun}s` : noun;
        // An area that repeats the type is dropped ("Garage door open").
        text = ` ${noun} `.includes(` ${subjects[0].toLowerCase()} `) ? `${cap(nouns)} open` : `${subjects[0]} ${nouns} open`;
      } else text = named(`${listOf(subjects)} ${noun}s open`, `${n} ${noun}s open`);
    } else if (kind === 'unlocked') {
      text = named(`${listOf(subjects)} unlocked`, `${n} locks unlocked`);
    } else if (kind === 'jammed') {
      level = 'warning';
      text = named(`${listOf(subjects)} ${n > 1 ? 'locks' : 'lock'} jammed`, `${n} locks jammed`);
    } else if (kind === 'reading') {
      const { label } = READINGS[cls];
      level = 'warning';
      if (subjects.length === 1) {
        // The reading furthest past its limit, in its own unit.
        const top = members.reduce((a, b) => b.value / b.w.limit > a.value / a.w.limit ? b : a);
        text = `${subjects[0]} ${label} high · ${formatNumber(hass, top.value, top.value < 10 ? 1 : 0)} ${top.w.unit}`;
      } else text = named(`${listOf(subjects)} ${label} high`, `${cap(label)} high in ${subjects.length} areas`);
    } else {
      const { value, band } = members[0];
      level = 'warning';
      text = `Outdoor air ${band}${value === null ? '' : ` · AQI ${formatNumber(hass, value)}`}`;
    }
    alerts.push({ key, level, text, hold, since: Math.max(...members.map(m => m.since)) });
  }
  return { alerts, next };
}

/* ------------------------------------------------------------------------
   Weather alerts
   From HA's alert integrations, one source at a time. Each source's
   adapter reads its entities, or calls its action, into one shape:
   { key, event, severity or level, start, end, urgency, status, type }.
   ------------------------------------------------------------------------ */

const WX_AHEAD = 24 * 60 * MINUTE;   // upcoming alerts show from this long before they start
const WX_REFRESH = 15 * MINUTE;      // actions are called again at least this often
const CAP_LEVELS = { extreme: 'critical', severe: 'warning', moderate: 'info' };   // minor, unknown: hidden
const DWD_LEVELS = { 2: 'info', 3: 'warning', 4: 'critical' };                     // 1 (yellow): hidden
const ECCC_LEVELS = { yellow: 'info', orange: 'warning', red: 'critical' };        // no colour: hidden
const ECCC_SHOWN = ['warnings', 'watches', 'advisories'];   // not statements or endings
const METEOALARM = 'Information provided by MeteoAlarm';
const AMTLICH = /^Amtliche\s+\S*WARNUNG\s+vor\s+/i;   // NINA headline lead, dropped so the time fits

// Sources in the order they're used (core, then custom), with their names.
const WX_SOURCES = {
  nina: 'NINA', environment_canada: 'Environment Canada', dwd_weather_warnings: 'DWD', meteoalarm: 'MeteoAlarm',
  cap_alerts: 'CAP Alerts', nws_alerts: 'NWS Alerts', weatheralerts: 'Weather Alerts',
};

/**
 * The weather alert source: the one chosen in settings, else the first
 * installed, in WX_SOURCES order. None when weather alerts are off.
 * Returns { platform, entities, ... } or null.
 */
function discoverWeather(hass, reg, settings) {
  if (!settings.enabled) return null;
  const on = reg.entities.filter(e => !e.disabled_by && hass.states[e.entity_id]);
  const of = (platform, test = () => true) => on.filter(e => e.platform === platform && test(e));
  const ids = list => list.map(e => e.entity_id);
  const order = Object.keys(WX_SOURCES).sort((a, b) => (b === settings.source) - (a === settings.source));
  for (const platform of order) {
    let src = { platform, entities: [] };
    if (platform === 'nina') {
      // Each slot's warning sensor, with its headline and severity sensors.
      const byUid = Object.fromEntries(of(platform).map(e => [e.unique_id, e.entity_id]));
      const slots = of(platform, e => e.entity_id.startsWith('binary_sensor.'));
      src.entities = ids(slots);
      src.slots = Object.fromEntries(slots.map(e =>
        [e.entity_id, { headline: byUid[`${e.unique_id}-headline`], severity: byUid[`${e.unique_id}-severity`] }]));
    } else if (platform === 'environment_canada') {
      // Its alert sensors say when to call get_alerts again.
      const alerts = of(platform, e => [...ECCC_SHOWN, 'statements', 'endings'].includes(e.translation_key));
      src.entities = ids(alerts);
      src.entries = [...new Set(alerts.map(e => e.config_entry_id))];
    } else if (platform === 'dwd_weather_warnings') {
      src.entities = ids(of(platform, e => /warning_level$/.test(e.translation_key || '')));
    } else if (platform === 'meteoalarm') {
      // Set up in YAML, so not in the registry: found by its attribution.
      src.entities = Object.keys(hass.states).filter(id =>
        id.startsWith('binary_sensor.') && hass.states[id].attributes.attribution === METEOALARM);
    } else if (platform === 'cap_alerts') {
      // One sensor per alert, coming and going: found on each update.
      if (of(platform).length) return src;
    } else {
      src.entities = ids(of(platform, e => e.entity_id.startsWith('sensor.')));
    }
    if (src.entities.length) return src;
    if (platform === settings.source) notice('info', `Weather alert source "${WX_SOURCES[platform]}" isn't installed`);
  }
  return null;
}

const when = v => (v === null || v === undefined || v === 'null' || v === '') ? null : Date.parse(v) || null;
const given = v => v === 'null' || v === '' ? null : v ?? null;   // Weather Alerts writes "null"

/**
 * The source's alerts, in one shape. `fetched` holds action results
 * (Environment Canada's by config entry, NINA's by slot).
 */
function readWeather(hass, src, fetched) {
  const attrs = id => hass.states[id]?.attributes || {};
  const on = id => hass.states[id]?.state === 'on';
  const out = new Map();   // by key; DWD can list a warning twice
  const add = a => out.set(a.key, { ...a, event: given(a.event), start: when(a.start), end: when(a.end) });
  switch (src.platform) {
    case 'nina':
      for (const id of src.entities.filter(on)) {
        const { headline, severity } = src.slots[id] || {};
        const d = fetched.get(id) || {};
        add({ key: `${id}|${attrs(id).id}`, event: (hass.states[headline]?.state ?? d.headline)?.replace(AMTLICH, ''),
          severity: hass.states[severity]?.state ?? d.severity, start: d.start, end: d.expires });
      }
      break;
    case 'environment_canada':
      for (const entry of src.entries) {
        const data = fetched.get(entry) || {};
        for (const cat of ECCC_SHOWN) for (const a of data[cat] || []) {
          add({ key: `${a.title}|${a.date}`, event: a.title,
            level: ECCC_LEVELS[String(a.alert_colour_level).toLowerCase()] ?? null, end: a.expiry_time });
        }
      }
      break;
    case 'dwd_weather_warnings':
      for (const id of src.entities) {
        const a = attrs(id), w = (i, k) => a[`warning_${i}_${k}`];
        for (let i = 1; i <= (a.warning_count || 0); i++) {
          add({ key: `${w(i, 'headline')}|${w(i, 'start')}`, event: w(i, 'name') || w(i, 'headline'),
            level: DWD_LEVELS[w(i, 'level')] ?? null, start: w(i, 'start'), end: w(i, 'end') });
        }
      }
      break;
    case 'meteoalarm':
      for (const id of src.entities.filter(on)) {
        const a = attrs(id);
        add({ key: `${id}|${a.identifier ?? a.event}`, event: a.event || a.headline, severity: a.severity,
          urgency: a.urgency, start: a.onset, end: a.expires });
      }
      break;
    case 'cap_alerts':
      for (const id in hass.states) {
        const st = hass.states[id], a = st.attributes;
        if (!a.incident_platform_version || ['cancel', 'expired'].includes(a.phase)) continue;   // stale ones stay
        add({ key: a.id || id, event: a.event || a.friendly_name, severity: a.severity_normalized || st.state,
          urgency: a.urgency, status: a.status, type: a.msg_type, start: a.onset, end: a.ends || a.expires });
      }
      break;
    case 'nws_alerts':
      for (const id of src.entities) for (const a of attrs(id).Alerts || []) {
        add({ key: a.ID, event: a.Event, severity: a.Severity, status: a.Status, type: a.Type,
          start: a.Onset, end: a.Ends || a.Expires });
      }
      break;
    case 'weatheralerts':
      for (const id of src.entities) for (const a of attrs(id).alerts || []) {
        add({ key: a.id, event: a.event, severity: a.severity, urgency: a.urgency, status: a.status,
          type: a.messageType, start: a.onset, end: given(a.ends) ?? a.expires });
      }
      break;
  }
  return [...out.values()];
}

/**
 * Weather alerts for the row: [{ key, level, text, hold }], and when to
 * look again (ms time, or Infinity). Ended, cancelled, past, test and
 * exercise alerts are dropped. One that hasn't started shows as
 * information from a day ahead; Extreme ones hold the row.
 */
function weatherAlerts(hass, list, now = Date.now()) {
  let next = Infinity;
  const later = t => { if (t > now) next = Math.min(next, t); };
  const lower = v => String(v ?? '').toLowerCase();
  const alerts = [];
  for (const a of list) {
    if (lower(a.type) === 'cancel' || (a.status && lower(a.status) !== 'actual') || lower(a.urgency) === 'past') continue;
    if (a.end !== null && a.end <= now) continue;
    const level = 'level' in a ? a.level : CAP_LEVELS[lower(a.severity)];
    if (!level || !a.event) continue;
    if (a.end !== null) later(a.end);
    if (a.start !== null && a.start > now) {
      if (a.start - now > WX_AHEAD) {
        later(a.start - WX_AHEAD);
        continue;
      }
      later(a.start);
      alerts.push({ key: a.key, level: 'info', text: `${a.event} from ${formatTime(hass, a.start, now)}` });
    } else {
      const text = a.end === null ? a.event : `${a.event} until ${formatTime(hass, a.end, now)}`;
      alerts.push({ key: a.key, level, text, hold: level === 'critical' });
    }
  }
  if (alerts.length) later(now - now % (60 * MINUTE) + 60 * MINUTE);   // weekdays change at midnight
  return { alerts, next };
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

// Alert row.
const LEVELS = ['info', 'warning', 'critical'];   // severity, low to high
const LEVEL_ICON = { info: 'mdi:information', warning: 'mdi:alert', critical: 'mdi:alert-octagon' };
const TURN = 8;        // seconds per alert when several take turns
const MOVE = 700;      // ms per turn's slide; matches --move
const MIN_FIT = .7;    // long text shrinks to this share of its size, then is cut

// Håg's notices: in the alert row of every display, and in the browser
// console with any detail. Each is given once. Information notices leave
// the row after NOTICE_TIME; warnings stay until the display reloads.
const NOTICE_TIME = 5 * MINUTE;
const notices = new Map();   // text → { level, at }
const noticeListeners = new Set();
function notice(level, text, detail) {
  if (notices.has(text)) return;
  notices.set(text, { level, at: Date.now() });
  console.warn(`Håg: ${text}`, ...(detail === undefined ? [] : [detail]));
  noticeListeners.forEach(fn => fn());
}

// Every registration, by glance name, in arrival order.
const registry = new Map();
const registryListeners = new Set();

function register(reg) {
  const name = reg?.manifest?.name;
  if (typeof name !== 'string' || !NAME.test(name)) {
    notice('warning', `Glance name not valid: "${name}"`, reg?.url);
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
    const runs = builtIn ? 'the built-in one runs' : regs.length === 2 ? 'neither runs' : 'none runs';
    notice('warning', `${regs.length} glances named "${name}" · ${runs}`, regs.map(r => r.url));
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
  import(url.href).catch(err => notice('warning', `Glance "${name}" didn't load`, err));
}

/* ------------------------------------------------------------------------
   Settings
   One definition of every option (its address in the strategy block,
   type, default and label) for reading, checking and the editor. A bad
   value gives a notice and its default. Sections Håg doesn't know are
   kept as they are.
   ------------------------------------------------------------------------ */

// Household alerts in settings (alerts.core.<key>), all off by default:
// what each covers, and its timings (seconds) and limit, where it has them.
const CORE_ALERTS = {
  smoke:        { label: 'Smoke alarms', covers: ['hazard:smoke'] },
  co:           { label: 'Carbon monoxide alarms', covers: ['hazard:carbon_monoxide'] },
  gas:          { label: 'Gas alarms', covers: ['hazard:gas'] },
  leak:         { label: 'Water leaks', covers: ['leak'], critical_after: 900 },
  doors:        { label: 'Doors', covers: ['open:door'], after: 300 },
  windows:      { label: 'Windows', covers: ['open:window'], after: 300 },
  openings:     { label: 'Other openings', covers: ['open:opening'], after: 300 },
  garage_doors: { label: 'Garage doors', covers: ['open:garage'], after: 300 },
  gates:        { label: 'Gates', covers: ['open:gate'], after: 300 },
  locks:        { label: 'Locks', covers: ['lock'], after: 300 },
  co2:          { label: 'CO₂', covers: ['reading:carbon_dioxide'], hold: 900, limit: 1000 },
  pm25:         { label: 'PM2.5', covers: ['reading:pm25'], hold: 900, limit: 35.5 },
  radon:        { label: 'Radon', covers: ['reading:radon'], hold: 900, limit: 100 },
  co_level:     { label: 'Carbon monoxide levels', covers: ['reading:carbon_monoxide'], hold: 900, limit: 30 },
  outdoor_air:  { label: 'Outdoor air', covers: ['aqi'], hold: 900 },
};
// What a watched sensor is, as CORE_ALERTS names it.
const coverOf = w => w.kind === 'leak' || w.kind === 'lock' || w.kind === 'aqi' ? w.kind : `${w.kind}:${w.cls}`;
const CORE_ALERT_OF = Object.fromEntries(Object.entries(CORE_ALERTS).flatMap(([key, a]) => a.covers.map(c => [c, key])));
const TIMINGS = { after: 'wait', critical_after: 'critical after', hold: 'hold' };

// Every option. `*` stands for any key at that level (a glance's name, a
// floor's ID). `gui: false` keeps an option to YAML (the raw editor).
// Types: text, seconds, number, choice, boolean, entity, entities,
// devices, links.
const OPTIONS = [
  { path: 'default', type: 'text', default: DEFAULT_GLANCE, label: 'Default glance', help: 'Shown when nothing else needs the screen' },
  { path: 'cycle', type: 'seconds', default: CYCLE, label: 'Cycle', help: 'Seconds per turn when several glances want the screen' },
  { path: 'theme', type: 'choice', choices: THEMES, default: 'auto', label: 'Theme', help: 'auto follows the sun' },
  { path: 'glances.*.enabled', type: 'boolean', default: false, label: 'On' },
  { path: 'providers.outdoor.temperature', type: 'entity', filter: { domain: 'sensor', device_class: 'temperature' }, label: 'Outdoor temperature' },
  { path: 'providers.outdoor.humidity', type: 'entity', filter: { domain: 'sensor', device_class: 'humidity' }, label: 'Outdoor humidity' },
  { path: 'providers.outdoor.aqi', type: 'entity', filter: { domain: 'sensor', device_class: 'aqi' }, label: 'Outdoor air quality index' },
  { path: 'providers.outdoor.weather', type: 'entity', filter: { domain: 'weather' }, label: 'Weather' },
  { path: 'providers.outdoor.moon', type: 'entity', filter: { domain: 'sensor', device_class: 'enum' }, label: 'Moon phase' },
  { path: 'providers.floors.*.monitors', type: 'devices', label: 'air-quality monitors', help: 'Most trusted first' },
  { path: 'providers.floors.*.climate', type: 'entity', filter: { domain: 'climate' }, label: 'thermostat' },
  { path: 'providers.people.exclude', type: 'entities', filter: { domain: 'person' }, label: 'People left out', help: 'Guests, for example' },
  { path: 'providers.people.include', type: 'entities', filter: { domain: 'person' }, label: 'Only these people' },
  { path: 'providers.people.links', type: 'links', gui: false, label: 'Linked people' },
  { path: 'providers.calendar.calendars', type: 'entities', filter: { domain: 'calendar' }, label: 'Calendars', help: 'Every calendar when none are chosen' },
  { path: 'alerts.turn', type: 'seconds', default: TURN, label: 'Turn', help: 'Seconds per alert when several take turns' },
  ...Object.entries(CORE_ALERTS).flatMap(([key, a]) => [
    { path: `alerts.core.${key}.enabled`, type: 'boolean', default: false, label: a.label },
    ...(key === 'outdoor_air' ? [] : [{ path: `alerts.core.${key}.exclude`, type: 'entities', label: `${a.label}: sensors left out` }]),
    ...Object.keys(TIMINGS).filter(t => t in a).map(t =>
      ({ path: `alerts.core.${key}.${t}`, type: 'seconds', default: a[t], label: `${a.label} ${TIMINGS[t]}` })),
    ...('limit' in a ? [{ path: `alerts.core.${key}.limit`, type: 'number', default: a.limit, label: `${a.label} limit` }] : []),
  ]),
  { path: 'alerts.weather.enabled', type: 'boolean', default: true, label: 'Weather alerts' },
  { path: 'alerts.weather.source', type: 'choice', choices: Object.keys(WX_SOURCES), default: null, label: 'Weather alert source', help: 'Found automatically when not chosen' },
];

const optionAt = path => OPTIONS.find(o => {
  const a = o.path.split('.'), b = path.split('.');
  return a.length === b.length && a.every((p, i) => p === '*' || p === b[i]);
});
const valueAt = (obj, path) => path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), obj);
const isStrings = v => Array.isArray(v) && v.every(x => typeof x === 'string');

// A value checked against its option: the value, or the default with a
// notice when it's set but not usable.
function checked(config, path) {
  const o = optionAt(path);
  const v = valueAt(config, path);
  if (v === undefined || v === null) return o.default ?? null;
  const n = Number(v);
  const ok = {
    text: () => typeof v === 'string' && v !== '',
    seconds: () => n > 0,
    number: () => n > 0,
    choice: () => o.choices.includes(v),
    boolean: () => typeof v === 'boolean',
    entity: () => typeof v === 'string',
    entities: () => isStrings(v),
    devices: () => isStrings(v),
    links: () => v && typeof v === 'object' && Object.values(v).every(x => typeof x === 'string'),
  }[o.type]();
  if (ok) return o.type === 'seconds' || o.type === 'number' ? n : v;
  const label = cap(o.label);
  const fallback = o.default == null ? 'ignored'
    : o.type === 'boolean' ? (o.default ? 'on' : 'off')
    : `using ${o.default}${o.type === 'seconds' ? ' s' : ''}`;
  notice('info', o.type === 'seconds' || o.type === 'number'
    ? `${label} setting isn't a number · ${fallback}`
    : `${label} setting not recognized · ${fallback}`, o.choices ? o.choices.join(', ') : path);
  return o.default ?? null;
}

const objectAt = (config, path) => { const v = valueAt(config, path); return v && typeof v === 'object' ? v : {}; };

// All settings, checked.
function readSettings(config) {
  const get = path => checked(config, path);
  const glances = objectAt(config, 'glances');
  for (const name of Object.keys(glances)) {
    if (!NAME.test(name)) notice('warning', `Glance name not valid: "${name}"`, 'lowercase letters, digits, _ and -, starting with a letter');
  }
  const def = get('default');
  const on = name => get(`glances.${name}.enabled`);
  const outdoor = Object.fromEntries(['temperature', 'humidity', 'aqi', 'weather', 'moon']
    .map(k => [k, get(`providers.outdoor.${k}`)]).filter(([, v]) => v !== null));
  const floors = Object.fromEntries(Object.keys(objectAt(config, 'providers.floors')).map(id =>
    [id, Object.fromEntries(['monitors', 'climate'].map(k => [k, get(`providers.floors.${id}.${k}`)]).filter(([, v]) => v !== null))]));
  const people = Object.fromEntries(['exclude', 'include', 'links']
    .map(k => [k, get(`providers.people.${k}`)]).filter(([, v]) => v !== null));
  const calendars = get('providers.calendar.calendars');
  const core = Object.fromEntries(Object.entries(CORE_ALERTS).map(([key, a]) => [key, {
    enabled: get(`alerts.core.${key}.enabled`),
    exclude: key === 'outdoor_air' ? [] : get(`alerts.core.${key}.exclude`) ?? [],
    ...Object.fromEntries(['after', 'critical_after', 'hold', 'limit'].filter(t => t in a).map(t => [t, get(`alerts.core.${key}.${t}`)])),
  }]));
  return {
    glances,
    def,
    defOn: glances[def]?.enabled !== false,
    order: Object.keys(glances).filter(n => NAME.test(n) && n !== def && glances[n]?.enabled === true && on(n)),
    cycle: get('cycle'),
    theme: get('theme'),
    turn: get('alerts.turn'),
    providers: { outdoor, floors, people, calendar: calendars ? { calendars } : {} },
    alerts: { core, weather: { enabled: get('alerts.weather.enabled'), source: get('alerts.weather.source') } },
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
     (0 night, 1 day). Glances inherit the mixed colors. Values are
     placeholders until the text pass. */
  .stage {
    --n-sky: #10162A;       --d-sky: #7CC8F2;        /* outdoor base */
    --n-horizon: #1D3442;   --d-horizon: #FFD6E7;    /* outdoor glow */
    --n-home: #1E2433;      --d-home: #F6FAFF;       /* indoor base */
    --n-band: #FFFFFF14;    --d-band: #FFFFFFB3;     /* alert row */
    --n-text: #F1EADC;      --d-text: #0E1F3A;
    --n-text-2: #A9B0C2;    --d-text-2: #34537A;     /* secondary */
    --n-coral: #FF7A68;     --d-coral: #D6336C;      /* heating, errors */
    --n-seaglass: #72D8C6;  --d-seaglass: #0B8A5E;   /* cooling */
    --n-mist: #8FA6C8;      --d-mist: #FFFFFF;       /* haze */
    --n-warn: #C99A3A;      --d-warn: #F6D365;       /* warning alerts only */
    --n-crit: #C9433E;      --d-crit: #B42318;       /* critical alerts only */
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
    --warn: color-mix(in oklab, var(--d-warn) var(--day-mix), var(--n-warn));
    --crit: color-mix(in oklab, var(--d-crit) var(--day-mix), var(--n-crit));
    /* Ink on a warning: the night sky at night, the text color by day. */
    --warn-ink: color-mix(in oklab, var(--d-text) var(--day-mix), var(--n-sky));
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

  /* Alert row: full width through the center, above every glance. Each
     alert is a slide of one line, its icon on the text's baseline; a turn
     pushes the old slide out to the left. */
  .alert-row {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    translate: 0 -50%;
    overflow: hidden;
    font-size: calc(5.5 * var(--u));
  }
  .stage.animate .alert-row { transition: opacity var(--move), visibility var(--move), background-color var(--move), color var(--move); }
  .alert-row.hidden { opacity: 0; visibility: hidden; }
  /* Severity: a wash for information; warning and critical fill the band. */
  .alert-row.info { background: var(--band); }
  .alert-row.warning { background: var(--warn); color: var(--warn-ink); }
  .alert-row.critical { background: var(--crit); color: #FFFFFF; }
  /* Long text shrinks to fit (the .fit size, set in code), then is cut. */
  .slide {
    padding: calc(1.2 * var(--u)) calc(4 * var(--u));
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .slide.entering { position: absolute; inset: 0; }
  .slide.measure { position: absolute; inset: 0; visibility: hidden; }
  .alert-row a { color: inherit; margin-left: .8em; }
  .msg { font-variant-numeric: tabular-nums; }   /* steady countdown */

  /* Version, for testing: bottom center, low contrast. */
  .version {
    position: absolute;
    left: 0;
    right: 0;
    bottom: var(--u);
    text-align: center;
    font-size: calc(2.2 * var(--u));
    color: var(--text-2);
    opacity: .5;
    pointer-events: none;
  }

  .ico { display: inline-block; width: .8em; height: .8em; margin-right: .2em; vertical-align: -.05em; }
  .ico > ha-icon { display: flex; width: 100%; height: 100%; --mdc-icon-size: 100%; }
`;

const HOST_TEMPLATE = `
  <div class="stage">
    <div class="glances"></div>
    <div class="alert-row hidden" role="status"></div>
    <div class="version">Håg v${VERSION}</div>
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
    this._alerts = new Map();    // id → alert (see _raise)
    this._queue = [];            // ids taking turns, in order
    this._current = null;        // id on the row
    this._own = this._alertsFor('haag', true);       // starting up, nothing to show
    this._home = this._alertsFor('home', true);      // household alerts
    this._weather = this._alertsFor('weather', true);
    this._notices = this._alertsFor('notice', true);
    this._showNotices = this._showNotices.bind(this);
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
    this._household();
    this._weatherAlerts();
  }

  getCardSize() { return 12; }

  // Test page: show or hide a sample information alert.
  setSampleAlert(on) {
    if (on) this._own.set('sample', { level: 'info', text: 'Sample alert' });
    else this._own.delete('sample');
  }

  // ----- Lifecycle -----

  connectedCallback() {
    this._startedAt ??= Date.now();
    this.style.setProperty('--haag-split', `${180 - SPLIT_ANGLE}deg`);
    registryListeners.add(this._sync);
    noticeListeners.add(this._showNotices);
    this._showNotices();
    this._sync();
    this._updateAlert();
    // At the startup limit: report missing glances, and turn critical if
    // nothing is on screen.
    const left = STARTUP_LIMIT * 1000 - (Date.now() - this._startedAt);
    if (left > 0) this._limitTimer = setTimeout(() => { this._reportMissing(); this._updateAlert(); }, left + 50);
    // Alert text refits, and groups may switch between names and a count,
    // when the screen or the typeface changes.
    const refit = () => {
      this._fitCache?.clear();
      this._household();
      this._fit();
    };
    this._resize ??= new ResizeObserver(refit);
    this._resize.observe(this);
    document.fonts.ready.then(() => { if (this.isConnected) refit(); });
    this._timeTurns();
    this._household();
    this._weatherAlerts();
    // Animate only after the first frame, so nothing fades in on load.
    requestAnimationFrame(() => requestAnimationFrame(() => this._stage.classList.add('animate')));
  }

  disconnectedCallback() {
    registryListeners.delete(this._sync);
    noticeListeners.delete(this._showNotices);
    clearTimeout(this._noticeTimer);
    clearTimeout(this._turnTimer);
    clearTimeout(this._limitTimer);
    clearTimeout(this._countTimer);
    clearTimeout(this._alertTimer);
    clearTimeout(this._homeTimer);
    clearTimeout(this._wxTimer);
    this._resize?.disconnect();
    this._turnTimer = null;
    this._countTimer = null;
    this._alertTimer = null;
  }

  // ----- Glances -----

  // Find entities once (registries rarely change; reload to re-run), then
  // start the glances. Without registries, glances still run, with nothing
  // discovered.
  async _discover() {
    const hass = this._hass;
    const p = this._settings.providers;
    let reg = { entities: [], floors: [], areas: [], iot: {}, deviceName: {} };
    try {
      reg = await loadRegistries(hass);
    } catch (err) {
      notice('warning', "Couldn't read Home Assistant's setup", err);
    }
    const people = discoverPeople(hass, p.people);
    this._providers = {
      outdoor: discoverOutdoor(hass, reg, p.outdoor),
      floors: discoverFloors(hass, reg, p.floors),
      people: { ...people, groups: linkGroups(people) },
      calendars: discoverCalendars(hass, reg, p.calendar),
      value: ref => numericValue(this._hass, ref),
      unit: ref => unitOf(this._hass, ref),
      hvac: climate => hvacStatus(this._hass, climate),
      locate: () => locatePeople(this._hass, people, reg),
    };
    this._sync();
    try {
      this._watch = discoverAlerts(hass, reg, this._providers.outdoor.aqi, this._settings.alerts.core);
    } catch (err) {
      console.error('Håg: household alert discovery failed', err);
    }
    this._seen = new Map();   // reading → when first seen past its limit
    this._household();
    this._wxSource = discoverWeather(hass, reg, this._settings.alerts.weather);
    this._wxFetched = new Map();   // action results, by config entry or NINA slot
    this._wxCalls = new Map();     // when each action was last called, and for what
    this._weatherAlerts();
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
    let entry;
    try {
      const { format, element } = reg.manifest;
      if (format !== GLANCE_FORMAT) throw Object.assign(new Error(`format ${format} isn't supported`), { newer: true });
      await reg.load();
      if (!customElements.get(element)) throw new Error(`<${element}> isn't defined`);
      if (resolve(name) !== reg || !this.isConnected) return;
      entry = { reg, el: document.createElement(element), visible: false, wants: false,
        alerts: this._alertsFor(`glance:${name}`) };
      entry.el.haag = this._context(entry);
      entry.el.setConfig?.(this._settings.glances[name] || {});
      if (this._hass) entry.el.hass = this._hass;
      this._layer.append(entry.el);
      this._running.set(name, entry);
    } catch (err) {
      entry?.alerts.clear();   // anything it raised before failing
      this._failed.add(name);
      const title = reg.manifest?.title || `Glance "${name}"`;
      notice('warning', err.newer ? `${title} needs a newer Håg` : `${title} didn't load`, { file: reg.url, error: err });
    } finally {
      this._loading.delete(name);
      this._schedule();
    }
  }

  _stop(name) {
    const entry = this._running.get(name);
    entry?.alerts.clear();
    entry?.el.remove();
    this._running.delete(name);
  }

  // What a glance gets from Håg (docs/glances.md).
  _context(entry) {
    const host = this;
    const { set, delete: del, clear } = entry.alerts;
    return {
      providers: this._providers,
      get daylight() { return host._daylight; },
      layout: { angle: SPLIT_ANGLE },
      icon: setIcon,
      get alertrow() { return host._alertBand(); },
      alerts: { set, delete: del, clear },   // its own, at any severity; the core picks the icon
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

  // ----- Household alerts -----

  // Raise, update and clear household alerts from the latest states, and
  // look again when the next wait ends.
  _household() {
    if (!this._watch || !this._hass || !this.isConnected) return;
    clearTimeout(this._homeTimer);
    const { alerts, next } = householdAlerts(this._hass, this._watch, this._seen, text => this._fitsRow(text));
    this._home.replace(alerts);
    this._homeTimer = next < Infinity ? setTimeout(() => this._household(), Math.max(1000, next - Date.now())) : null;
  }

  // ----- Notices -----

  // Håg's notices on the row: information ones until NOTICE_TIME after
  // they were given, warnings until the display reloads.
  _showNotices() {
    clearTimeout(this._noticeTimer);
    const now = Date.now();
    const shown = [...notices].filter(([, n]) => n.level !== 'info' || now - n.at < NOTICE_TIME);
    this._notices.replace(shown.map(([text, n]) => ({ key: text, level: n.level, text, since: n.at })));
    const next = Math.min(...shown.filter(([, n]) => n.level === 'info').map(([, n]) => n.at + NOTICE_TIME));
    if (next < Infinity) this._noticeTimer = setTimeout(this._showNotices, next - now);
  }

  // ----- Weather alerts -----

  // Weather alerts from the source's latest data, looked at again when the
  // next one starts or ends, or an action is due.
  _weatherAlerts() {
    const src = this._wxSource, hass = this._hass;
    if (!src || !hass || !this.isConnected) return;
    clearTimeout(this._wxTimer);
    if (src.entities.length && src.entities.every(id => hass.states[id]?.state === 'unavailable')) {
      notice('info', `Couldn't read weather alerts from ${WX_SOURCES[src.platform]}`);
    }
    const due = this._callWeather(src);
    const { alerts, next } = weatherAlerts(hass, readWeather(hass, src, this._wxFetched));
    this._weather.replace(alerts);
    const at = Math.min(next, due);
    this._wxTimer = at < Infinity ? setTimeout(() => this._weatherAlerts(), Math.max(1000, at - Date.now())) : null;
  }

  // Sources read through an action (Environment Canada; NINA's times):
  // call it when its entities change, or after WX_REFRESH. Results re-run
  // the alerts. Returns when the next call is due.
  _callWeather(src) {
    const hass = this._hass;
    let calls = [];
    if (src.platform === 'environment_canada') {
      const changed = src.entities.map(id => hass.states[id]?.last_updated).join();
      calls = src.entries.map(entry => ({ key: entry, sig: changed, pick: r => r,
        msg: { domain: 'environment_canada', service: 'get_alerts', service_data: { config_entry_id: entry } } }));
    } else if (src.platform === 'nina') {
      calls = src.entities.filter(id => hass.states[id]?.state === 'on').map(id => ({ key: id,
        sig: hass.states[id].attributes.id, pick: r => r?.[id],
        msg: { domain: 'nina', service: 'get_details', target: { entity_id: id } } }));
    }
    let due = Infinity;
    for (const { key, sig, pick, msg } of calls) {
      const last = this._wxCalls.get(key);
      const stale = !last || last.sig !== sig || Date.now() - last.at >= WX_REFRESH;
      if (stale && !last?.pending) {
        const call = { sig, at: Date.now(), pending: true };
        this._wxCalls.set(key, call);
        Promise.resolve()   // a throw becomes a rejection
          .then(() => hass.callWS({ type: 'call_service', ...msg, return_response: true }))
          .then(r => this._wxFetched.set(key, pick(r.response)))
          .catch(err => notice('info', `Couldn't read weather alerts from ${WX_SOURCES[src.platform]}`, err))
          .finally(() => {
            call.pending = false;
            this._weatherAlerts();
          });
      }
      due = Math.min(due, this._wxCalls.get(key).at + WX_REFRESH);
    }
    return due;
  }

  // Whether alert text fits the row on one line at its smallest size,
  // measured on a hidden slide.
  _fitsRow(text) {
    this._fitCache ??= new Map();
    let fits = this._fitCache.get(text);
    if (fits === undefined) {
      const m = this._measure ??= this._row.appendChild(this._makeSlide());
      m.classList.add('measure');
      m.querySelector('.msg').textContent = text;
      const cs = getComputedStyle(m);
      const room = m.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      fits = m.querySelector('.fit').getBoundingClientRect().width * MIN_FIT <= room;
      this._fitCache.set(text, fits);
    }
    return fits;
  }

  // ----- Alert row -----

  // Håg's own alert: starting up with a countdown, then critical if
  // nothing can show.
  _updateAlert() {
    if (this._startedAt === undefined) return;
    if (this._showing) this._ready = true;
    const waited = Date.now() - this._startedAt;
    if (this._showing) {
      this._stopCountdown();
      this._own.delete('startup');
    } else if (!this._ready && waited < STARTUP_LIMIT * 1000) {
      this._countdown();
    } else {
      this._stopCountdown();
      this._own.set('startup', { level: 'critical', text: this._problem(), help: true, own: true });
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
      if (!registry.has(name)) notice('warning', `Glance "${name}" isn't installed`);
    }
  }

  // Seconds left to the startup limit, so the row doesn't look frozen.
  _countdown() {
    if (this._countTimer) return;
    const tick = () => {
      const left = STARTUP_LIMIT * 1000 - (Date.now() - this._startedAt);
      this._own.set('startup', { level: 'info', text: `Starting up · ${Math.max(0, Math.ceil(left / 1000))} s`, own: true });
      this._countTimer = left > 0 ? setTimeout(tick, left % 1000 || 1000) : null;
    };
    tick();
  }

  _stopCountdown() {
    clearTimeout(this._countTimer);
    this._countTimer = null;
  }

  // One source's alerts (Håg's own, household, weather, a glance): set,
  // delete and clear by key, kept apart from other sources'. Only core
  // sources may hold the row, show alone or carry help links. replace()
  // sets a whole list ([{ key, ... }]) and deletes the rest.
  _alertsFor(source, core = false) {
    const host = this, keys = new Set(), id = key => `${source}:${key}`;
    const set = (key, { level, text, since, hold, own, help } = {}) => {
      keys.add(key);
      host._raise(id(key), { level: LEVELS.includes(level) ? level : 'info', text: String(text ?? ''), since,
        ...(core && { hold: !!hold, own: !!own, help: !!help }) });
    };
    const del = key => {
      keys.delete(key);
      host._clear(id(key));
    };
    return {
      set,
      delete: del,
      clear: () => [...keys].forEach(del),
      replace(list) {
        const now = new Set(list.map(a => a.key));
        [...keys].filter(k => !now.has(k)).forEach(del);
        for (const { key, ...a } of list) set(key, a);
      },
    };
  }

  // Raise or update an alert by id. level: info, warning or critical.
  // hold: the alert stays put and others wait (holders take turns among
  // themselves). own: Håg's own alert, shown alone. help: settings and
  // help links. since: when it started (newest goes first); kept on update.
  _raise(id, { level = 'info', text = '', hold = false, own = false, help = false, since } = {}) {
    const old = this._alerts.get(id);
    since ??= old?.since ?? Date.now();
    if (old && old.level === level && old.text === text && old.hold === hold && old.own === own &&
        old.help === help && old.since === since) return;
    this._alerts.set(id, { id, level, text, hold, own, help, since });
    this._pick();
  }

  _clear(id) {
    if (this._alerts.delete(id)) this._pick();
  }

  // Who takes turns: Håg's own alert, with its notices whatever their
  // severity; otherwise the highest severity present, and only its holders
  // if it has any. Newest first.
  _turns() {
    const all = [...this._alerts.values()];
    const own = all.filter(a => a.own);
    if (own.length) return [...own, ...all.filter(a => a.id.startsWith('notice:'))].sort((a, b) => b.since - a.since);
    const top = Math.max(-1, ...all.map(a => LEVELS.indexOf(a.level)));
    let turns = all.filter(a => LEVELS.indexOf(a.level) === top);
    if (turns.some(a => a.hold)) turns = turns.filter(a => a.hold);
    return turns.sort((a, b) => b.since - a.since);
  }

  // Keep the turn order: new alerts go next, cleared ones drop out. When
  // the alert on the row leaves the turns (cleared, or a more severe one
  // arrived), the next one cuts in at once.
  _pick() {
    const ids = this._turns().map(a => a.id);
    const old = this._queue, cur = this._current;
    const queue = old.filter(id => ids.includes(id));
    queue.splice(queue.indexOf(cur) + 1, 0, ...ids.filter(id => !queue.includes(id)));
    this._queue = queue;
    let next = cur;
    if (!queue.includes(cur)) {
      const i = old.indexOf(cur);
      next = [...old.slice(i + 1), ...old.slice(0, i)].find(id => queue.includes(id)) ?? queue[0] ?? null;
    }
    this._showAlert(next);
    this._timeTurns(next !== cur);
  }

  // Turns run while more than one alert takes them.
  _timeTurns(restart = false) {
    if (this._queue.length < 2) {
      clearTimeout(this._alertTimer);
      this._alertTimer = null;
    } else if (restart || !this._alertTimer) {
      clearTimeout(this._alertTimer);
      this._alertTimer = setTimeout(() => {
        const q = this._queue;
        this._alertTimer = null;
        this._showAlert(q[(q.indexOf(this._current) + 1) % q.length]);
        this._timeTurns(true);
      }, (this._settings?.turn ?? TURN) * 1000);
    }
  }

  // Put an alert on the row: in place if it's the one already there, by a
  // push if it's another, or hide the row when there's none. The band's
  // color fades to the alert's severity.
  _showAlert(id) {
    const alert = this._alerts.get(id);
    const row = this._row;
    const hidden = row.classList.contains('hidden');
    const other = id !== this._current;
    this._current = alert ? id : null;
    if (!alert) {
      if (!hidden) {
        row.classList.add('hidden');
        this._tellGlances();
      }
      return;
    }
    row.className = `alert-row ${alert.level}`;
    if (other && !hidden && this._slide) this._push(alert);
    else this._fill(this._slide ??= row.appendChild(this._makeSlide()), alert);
    if (hidden) this._tellGlances();
  }

  // Glances keep their content clear of the band.
  _tellGlances() {
    for (const { el } of this._running.values()) el.dispatchEvent(new Event('haag-alertrow'));
  }

  _makeSlide() {
    const slide = document.createElement('div');
    slide.className = 'slide';
    slide.innerHTML = '<span class="fit"><span class="ico"></span><span class="msg"></span><span class="links"></span></span>';
    return slide;
  }

  _fill(slide, alert) {
    const key = `${alert.level}|${alert.help}|${alert.text}`;
    if (slide.dataset.key === key) return;
    slide.dataset.key = key;
    const icon = LEVEL_ICON[alert.level];
    const box = slide.querySelector('.ico');
    setIcon(box, icon);
    fitAlertIcon(box, icon);
    slide.querySelector('.msg').textContent = alert.text;
    // Settings opens edit mode (admins, storage-mode dashboards).
    slide.querySelector('.links').innerHTML = alert.help
      ? `<a href="?edit=1">Settings</a><a href="${HELP_URL}" target="_blank" rel="noopener">Help</a>`
      : '';
    this._fit(slide);
  }

  // A turn: the new slide pushes the old one out to the left. With
  // reduced motion, they crossfade.
  _push(alert) {
    this._settle();
    const old = this._slide;
    const next = this._row.appendChild(this._makeSlide());
    next.classList.add('entering');
    this._fill(next, alert);
    this._slide = next;
    if (!this._stage.classList.contains('animate')) {
      old.remove();
      next.classList.remove('entering');
      return;
    }
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timing = { duration: MOVE, easing: 'ease-in-out' };
    const anims = [
      next.animate(still ? { opacity: [0, 1] } : { transform: ['translateX(100%)', 'none'] }, timing),
      old.animate(still ? { opacity: [1, 0] } : { transform: ['none', 'translateX(-100%)'] }, timing),
    ];
    this._sliding = { old, next, anims };
    anims[1].onfinish = () => this._settle();
  }

  // End a push: the old slide goes and the new one takes its place.
  _settle() {
    const s = this._sliding;
    if (!s) return;
    this._sliding = null;
    for (const a of s.anims) a.cancel();
    s.old.remove();
    s.next.classList.remove('entering');
  }

  // Shrink a slide's text to fit one line, down to MIN_FIT; past that its
  // end is cut with an ellipsis.
  _fit(slide = this._slide) {
    const fit = slide?.querySelector('.fit');
    if (!fit) return;
    fit.style.fontSize = '';
    const cs = getComputedStyle(slide);
    const room = slide.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const width = fit.getBoundingClientRect().width;
    if (room > 0 && width > room) fit.style.fontSize = `${Math.max(MIN_FIT, room / width * .99)}em`;
  }

  // The row's band, relative to the screen.
  _alertBand() {
    const top = this.getBoundingClientRect().top;
    const r = this._row.getBoundingClientRect();
    return { showing: !this._row.classList.contains('hidden'), top: r.top - top, bottom: r.bottom - top };
  }
}

/* ------------------------------------------------------------------------
   Settings editor
   Shown in Home Assistant's dashboard editor, built from HA's own form
   (ha-form) out of OPTIONS. It edits the same strategy block as the raw
   configuration editor, writes only what's changed, and keeps every part
   it doesn't show.
   ------------------------------------------------------------------------ */

// HA loads its form parts when one of its own editors needs them; a
// built-in card's editor brings them in.
async function loadHaForm() {
  if (customElements.get('ha-form')) return;
  try {
    const helpers = await window.loadCardHelpers();
    const card = await helpers.createCardElement({ type: 'entities', entities: [] });
    await card.constructor.getConfigElement();
  } catch (err) {
    console.warn("Håg: Home Assistant's form didn't load", err);
  }
}

// The form's picker for an option.
function selectorOf(o) {
  const filter = o.filter && { filter: o.filter };
  return {
    seconds: { number: { min: 1, max: 3600, step: 1, mode: 'box', unit_of_measurement: 's' } },
    number: { number: { min: 0, step: 'any', mode: 'box' } },
    choice: { select: { options: o.choices ?? [], mode: 'dropdown' } },
    boolean: { boolean: {} },
    entity: { entity: { ...filter } },
    entities: { entity: { multiple: true, ...filter } },
    devices: { device: { multiple: true } },
  }[o.type] ?? { text: {} };
}

function setPath(obj, path, value) {
  const keys = path.split('.'), last = keys.pop();
  for (const k of keys) obj = (obj[k] && typeof obj[k] === 'object') ? obj[k] : (obj[k] = {});
  obj[last] = value;
}

// Removes a value, and any section it leaves empty.
function unsetPath(obj, path) {
  const [k, ...rest] = path.split('.');
  if (!obj || typeof obj !== 'object' || !(k in obj)) return;
  if (!rest.length) delete obj[k];
  else {
    unsetPath(obj[k], rest.join('.'));
    if (obj[k] && typeof obj[k] === 'object' && !Object.keys(obj[k]).length) delete obj[k];
  }
}

class HaagEditor extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!customElements.get('ha-form')) {
      this.textContent = "Home Assistant's form didn't load. Håg's settings can be edited in the code editor.";
      return;
    }
    if (!this._form) {
      this._form = this.appendChild(document.createElement('ha-form'));
      this._form.computeLabel = s => s.label ?? '';
      this._form.computeHelper = s => s.help ?? '';
      this._form.addEventListener('value-changed', e => this._changed(e));
    }
    const schema = this._schema();
    this._shown = this._data(schema);
    Object.assign(this._form, { hass: this._hass, data: this._shown });
    const key = JSON.stringify(schema);   // a new schema only when the sections change
    if (key !== this._schemaKey) {
      this._schemaKey = key;
      this._form.schema = schema;
    }
  }

  // Sections, each listing its options' fields. Only options shown in
  // the GUI; the rest are kept for the code editor.
  _schema() {
    const field = (path, label) => {
      const o = optionAt(path);
      return { name: path, label: label ?? o.label, help: o.help, selector: selectorOf(o) };
    };
    const section = (title, fields, expanded = false) =>
      ({ type: 'expandable', name: title.toLowerCase(), flatten: true, title, expanded, schema: fields });
    const glances = [...registry.keys()].sort();
    const titleOf = name => registry.get(name)?.[0]?.manifest?.title || name;
    const floors = orderFloors(Object.values(this._hass.floors || {}));
    return [
      section('General', [
        { name: 'default', label: 'Default glance', help: optionAt('default').help,
          selector: { select: { mode: 'dropdown', options: glances.map(n => ({ value: n, label: titleOf(n) })) } } },
        field('cycle'),
        field('theme'),
      ], true),
      section('Glances', glances.map(n => field(`glances.${n}.enabled`, titleOf(n)))),
      section('Outdoor', ['temperature', 'humidity', 'aqi', 'weather', 'moon'].map(k => field(`providers.outdoor.${k}`))),
      section('Floors', floors.flatMap(f => [
        field(`providers.floors.${f.floor_id}.monitors`, `${f.name} air-quality monitors`),
        field(`providers.floors.${f.floor_id}.climate`, `${f.name} thermostat`),
      ])),
      section('People', ['exclude', 'include'].map(k => field(`providers.people.${k}`))),
      section('Calendars', [field('providers.calendar.calendars')]),
    ];
  }

  // What the form shows: each field's value from settings, or its default.
  _data(schema) {
    const config = this._config;
    const def = config.default ?? DEFAULT_GLANCE;
    const data = {};
    for (const { schema: fields } of schema) {
      for (const { name } of fields) {
        const glance = /^glances\.(.+)\.enabled$/.exec(name)?.[1];
        const v = valueAt(config, name);
        data[name] = glance ? (glance === def ? v !== false : v === true) : v ?? optionAt(name)?.default ?? undefined;
      }
    }
    return data;
  }

  // Write what changed into the strategy block: a cleared field is
  // removed, so Håg finds it again or uses its default.
  _changed(e) {
    e.stopPropagation();
    const data = e.detail.value;
    const config = structuredClone(this._config);
    for (const key of Object.keys(data)) {
      const v = data[key];
      if (JSON.stringify(v) === JSON.stringify(this._shown[key])) continue;
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) unsetPath(config, key);
      else setPath(config, key, v);
    }
    this._config = config;
    this._shown = data;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
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
if (!customElements.get('haag-editor')) {
  customElements.define('haag-editor', HaagEditor);
}

console.info(`%c Håg %c v${VERSION} `, 'background:#222;color:#fff;border-radius:3px 0 0 3px', 'background:#999;color:#fff;border-radius:0 3px 3px 0');
