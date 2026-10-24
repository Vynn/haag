/*
  Håg: Home Assistant at a glance.
  License: GPL-3.0

  This file is the plugin's main module. It registers:
    - the dashboard strategy  `custom:haag`  (ll-strategy-dashboard-haag)
    - the idle-screen card    `custom:haag-idle-card`

  Status: v0.1.0 in development. Live so far: date, time, build version,
  outdoor conditions, and one row per indoor floor (HVAC status,
  temperature, air quality, people), next appointments, people away.
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
  return { entities, floors, areas, iot, deviceName };
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
   Icons
   Material Design Icons, drawn by HA's own `ha-icon` (D17), so the plugin
   ships no icon data. Names per D83–D88.
------------------------------------------------------------------------ */

const ERR_ICON = 'mdi:alert';
const HVAC_ICONS = {
  heat: 'mdi:fire', cool: 'mdi:snowflake', fan: 'mdi:fan',
  idle: 'mdi:thermostat', off: 'mdi:power-off', err: ERR_ICON,
};
const READING_ICONS = {
  hum: 'mdi:water-percent', co2: 'mdi:sprout', pm25: 'mdi:molecule',
  radon: 'mdi:radioactive', co: 'mdi:molecule-co', aqi: 'mdi:leaf',
};
const APPT_ICONS = {
  soon: 'mdi:calendar-clock', later: 'mdi:calendar-arrow-right',
  err: 'mdi:calendar-alert', empty: 'mdi:party-popper',
};

// Temperature icon (D84): low at or below freezing, high at or above
// 85 °F / 29 °C, in the reading's own unit.
function thermometerIcon(value, unit) {
  if (typeof value !== 'number') return 'mdi:thermometer';
  const [low, high] = /C/i.test(unit) ? [0, 29] : [32, 85];
  return value <= low ? 'mdi:thermometer-low'
       : value >= high ? 'mdi:thermometer-high'
       : 'mdi:thermometer';
}

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

/* ------------------------------------------------------------------------
   People
   Who's on which floor, and who's away (D49). People are HA `person`
   entities; settings `providers.people`:
     exclude: [person_id, ...]   people not counted (D61), e.g. visitors
     include: [person_id, ...]   only these (optional)
     links:   { person_id: person_id }   follow someone else's location
                                         when you have none of your own (D90)
   ------------------------------------------------------------------------ */

function discoverPeople(hass, overrides = {}) {
  const all = Object.keys(hass.states).filter(id => id.startsWith('person.'));
  const ids = (overrides.include || all).filter(id => !(overrides.exclude || []).includes(id) && hass.states[id]);
  return { ids, links: overrides.links || {} };
}

/**
 * Floor for a tracker's reported location: a floor name, an area name (on
 * that floor), or a room name that starts with or contains a floor name
 * (ESPresense reports e.g. "Basement Bathroom"). Returns floor_id or null.
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

// Initials from a display name (D86 fallback when there's no picture).
const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

/* ------------------------------------------------------------------------
   Calendar
   Appointments come from HA calendar entities through the calendar.get_events
   action (any logged-in user can call it). Which calendars: settings
   `providers.calendar.calendars: [entity_id, ...]` (D60), or every visible
   calendar when unset.
   ------------------------------------------------------------------------ */

// With no alert, the clock keeps at least this much room on its left
// (fraction of the card's shorter side), so wide times (10:00–12:59) don't
// press against the edge (D58).
const PAIR_LEFT_MARGIN = 0.105;

const APPT_COUNT = 4;                 // appointments shown
const APPT_REFRESH = 5 * 60 * 1000;   // refetch every 5 minutes
const APPT_DAYS = 30;                 // look-ahead window
const APPT_MAX_CH = 28;               // no appointment line is ever wider than this
const APPT_TOLERANCE_CH = 2;          // how far a line may pass the second-longest
// Shown when nothing is scheduled in the window (not an error).
const APPT_EMPTY = { day: "Looks like it's YOU time", night: "Shouldn't you be asleep?" };

// Day or night from HA's sun entity; by the clock if there isn't one.
function isNight(hass, now = new Date()) {
  const sun = Object.keys(hass?.states || {}).find(id => id.startsWith('sun.'));
  if (sun) return hass.states[sun].state === 'below_horizon';
  const h = now.getHours();
  return h < 6 || h >= 20;
}
const DAY = 24 * 60 * 60 * 1000;

function discoverCalendars(hass, reg, overrides = {}) {
  if (overrides.calendars) return overrides.calendars;
  return reg.entities
    .filter(e => e.entity_id.startsWith('calendar.') && !e.disabled_by && !e.hidden_by && hass.states[e.entity_id])
    .map(e => e.entity_id);
}

// All-day events come as plain dates (YYYY-MM-DD); the end date is exclusive.
const isAllDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v);
// Note: an all-day date is read as local midnight in the browser's time zone,
// which matches HA's as long as the display device is set to the same zone.
const toDate = v => isAllDay(v) ? new Date(`${v}T00:00:00`) : new Date(v);

/**
 * Upcoming events across the given calendars, soonest first, including ones
 * in progress, over the next APPT_DAYS days.
 */
async function fetchEvents(hass, calendars) {
  if (!calendars.length) return [];
  const now = new Date();
  const get = async days => {
    const res = await hass.callWS({
      type: 'call_service', domain: 'calendar', service: 'get_events',
      target: { entity_id: calendars },
      service_data: { start_date_time: now.toISOString(), end_date_time: new Date(now.getTime() + days * DAY).toISOString() },
      return_response: true,
    });
    return Object.entries(res.response || {}).flatMap(([calendar, { events = [] }]) =>
      events.map(e => ({ calendar, summary: e.summary || '', start: e.start, end: e.end,
                         allDay: isAllDay(e.start), startAt: toDate(e.start), endAt: toDate(e.end) })));
  };
  const events = await get(APPT_DAYS);
  return events.filter(e => e.endAt > now).sort((a, b) => a.startAt - b.startAt);
}

/* ------------------------------------------------------------------------
   Idle card
   ------------------------------------------------------------------------ */

const STYLE = `
  :host {
    /* One size unit for everything: 1% of the card's shorter side, times a
       global scale. Lowering --haag-scale shrinks every size and gap
       together, so all proportions stay the same. */
    --haag-scale: 0.9;
    --u: calc(1cqmin * var(--haag-scale));
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
    --gap: calc(2.5 * var(--u));          /* perpendicular distance from the split line to clusters */
    --alert-pad: calc(1.2 * var(--u));    /* vertical padding of the alert row */
    --cluster-gap: calc(2.7 * var(--u));  /* visible gap between clusters (see opticalEdges) */
    /* Medium text step (D54). Also sizes AM/PM and the appointment stagger,
       which are defined as "the medium line". 5.5 makes date + conditions as
       tall as a floor block (D96). */
    --t2: calc(5.5 * var(--u));
    /* Person icons: as tall as the medium digits, border included (D49).
       An estimate until _fitPortraits() measures the real font. */
    --portrait: calc(.71 * var(--t2));
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
    background: repeating-linear-gradient(45deg, transparent 0 calc(1.2 * var(--u)), rgba(0,0,0,.09) calc(1.2 * var(--u)) calc(1.6 * var(--u)));
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
    gap: calc(.4 * var(--u));
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

  /* No active alert: the row fades out and the two sides close in (D58). */
  .stage.animate .alert-row { transition: opacity var(--move), visibility var(--move); }
  .stage.no-alert .alert-row { opacity: 0; visibility: hidden; }

  /* Three text sizes (D54). */
  .t1 { font-size: calc(14 * var(--u)); }
  .t2 { font-size: var(--t2); }
  .t3 { font-size: calc(2.8 * var(--u)); }

  .line { display: flex; gap: calc(1.2 * var(--u)); align-items: baseline; }

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
    margin-left: calc(.7 * var(--u));
    font-size: var(--t2);   /* AM/PM: medium step */
    line-height: 1;
  }

  /* Icon box: a fixed .8em square holding HA's ha-icon (D17). The box sets
     the spacing, so icons never change the layout; motion runs on the icon
     inside, never on the box. */
  .ico {
    display: inline-block;
    width: .8em;
    height: .8em;
    margin-right: .2em;
    vertical-align: -.05em;
  }
  .ico > ha-icon { display: flex; width: 100%; height: 100%; --mdc-icon-size: 100%; }
  /* HVAC status on the floor's temperature icon (D83). Placeholder colours
     until the palette arrives (D77). */
  .ico.heat { color: #d29a68; }
  .ico.cool { color: #7fa6c8; }
  .ico.fan  { color: #9aa; }
  .ico.off  { opacity: .35; }
  .ico.err  { color: #c0392b; }
  /* HVAC motion (D83): slow and gentle. Heat flickers from its base, cool
     turns very slowly, fan spins slowly. */
  .ico.heat > ha-icon { transform-origin: 50% 90%; animation: flicker 4s ease-in-out infinite; }
  .ico.cool > ha-icon { animation: turn 40s linear infinite; }
  .ico.fan  > ha-icon { animation: turn 12s linear infinite; }
  @keyframes flicker {
    0%, 100% { transform: scale(1, 1);     opacity: 1; }
    35%      { transform: scale(.97, .92); opacity: .85; }
    60%      { transform: scale(1, .97);   opacity: .95; }
  }
  @keyframes turn { to { transform: rotate(1turn); } }
  @media (prefers-reduced-motion: reduce) { .ico > ha-icon { animation: none; } }
  /* Slot with no entity on this install: hidden, not labelled (D7). */
  [data-slot][hidden] { display: none; }
  /* Bad or missing value: "Err", icon becomes an alert (D88). */
  [data-slot].err > .ico { color: #c0392b; }

  .status-line { display: flex; align-items: center; }
  .status-line .people { margin-left: calc(2.4 * var(--u)); }
  /* People away sit before the outdoor temperature, mirroring the floor rows. */
  .status-line .people.away { margin-left: 0; margin-right: calc(2.4 * var(--u)); }
  .aq { display: flex; gap: calc(1 * var(--u)); }

  .appointments { display: flex; flex-direction: column; gap: calc(.4 * var(--u)); align-items: flex-start; }
  /* More than 24 hours away: day shown, plus a visual cue (placeholder). */
  .appt.later { opacity: .55; }
  /* Ongoing or within the hour: "breathes in", brightening on each breath
     at the same 6 s pace as the nobody-away frame (D85). */
  .appt.soon { opacity: .7; animation: breathe-in 6s ease-in-out infinite; }
  @keyframes breathe-in {
    0%, 100% { opacity: .7; }
    50%      { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) { .appt.soon { animation: none; opacity: 1; } }
  .appt-error .ico { color: #c0392b; }   /* calendar error (D85: calendar-alert icon) */

  /* Each appointment: icon, then text. Each later day steps in by one
     indent, following the diagonal. */
  .appt { display: flex; align-items: baseline; margin-left: calc(var(--indent, 0) * var(--t2)); }   /* one step = the medium line */
  /* Width is set per line by _fitAppointments(): no line reaches past the
     second-longest by more than a small tolerance. Lines are cut off with
     "…"; only the soonest appointment may wrap to a second line first. */
  .appt .text {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .appt.wrap .text {
    white-space: normal;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .people { display: flex; gap: calc(.8 * var(--u)); align-items: center; }
  /* One rounded square per person: their HA picture, or initials (D86). */
  .person {
    width: var(--portrait);   /* border-box: the border is inside this size */
    aspect-ratio: 1;
    border: calc(.35 * var(--u)) solid var(--line);
    border-radius: 30%;
    flex: none;
    overflow: hidden;
    display: grid;
    place-items: center;
    font-size: calc(.38 * var(--portrait));   /* initials keep their proportion */
    line-height: 1;
    box-sizing: border-box;
  }
  .person img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Linked people together: one outline around the group (D90). */
  /* The outline floats around the icons: it takes no layout space, so it
     never changes a row's height or any spacing. */
  .person-group { position: relative; display: flex; gap: calc(.8 * var(--u)); }
  .person-group::before {
    content: '';
    position: absolute;
    inset: calc(-.5 * var(--u));   /* .25 gap + .25 outline */
    border: calc(.25 * var(--u)) solid var(--line);
    border-radius: calc(1.6 * var(--u));
    pointer-events: none;
  }
  /* Nobody away: one empty frame that slowly "breathes" (D65). */
  .person.empty { animation: breathe 6s ease-in-out infinite; }
  @keyframes breathe {
    0%, 100% { opacity: .25; }
    50%      { opacity: .8; }
  }
  @media (prefers-reduced-motion: reduce) { .person.empty { animation: none; opacity: .5; } }
`;

// Markup. Values marked data-live are filled in by the card.
const TEMPLATE = `
  <div class="stage">
    <div class="weather-bg"></div>

    <section class="side outdoor" aria-label="Outdoor">
      <!-- Time and date are separate blocks, each following the line on its
           own; the date sits above the time. -->
      <div class="cluster">
        <div class="t1 time"><span data-live="time"></span><span class="ampm overhang" data-live="ampm"></span></div>
      </div>
      <div class="cluster">
        <div class="t2" data-live="date" data-descender="0.5"></div>
      </div>
      <div class="cluster">
        <div class="status-line">
          <div class="people away"></div>
          <div class="line">
            <span class="t2" data-slot="out-temp"><span class="ico"></span><span data-live="out-temp"></span></span>
            <span class="t3" data-slot="out-hum"><span class="ico"></span><span data-live="out-hum"></span></span>
            <span class="t3" data-slot="out-aqi"><span class="ico"></span><span data-live="out-aqi"></span></span>
          </div>
        </div>
      </div>
      <div class="cluster">
        <div class="appointments"></div>
      </div>
    </section>

    <!-- One cluster per indoor floor, built by the card from discovery. -->
    <section class="side indoor" aria-label="Indoor"></section>

    <div class="alert-row t2"><span class="ico"><ha-icon icon="mdi:information"></ha-icon></span><span data-live="version"></span></div>
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
      if (this._calendars && this._calendarStamp !== this._calendarStates()) this._refreshEvents();
    }
  }

  // Find entities once (registries rarely change; reload the page to re-run).
  async _discover() {
    try {
      this._reg = await loadRegistries(this._hass);
      const providers = this._config?.providers || {};
      this._slots = discoverOutdoor(this._hass, this._reg, providers.outdoor || {});
      this._floors = discoverFloors(this._hass, this._reg, providers.floors || {});
      this._calendars = discoverCalendars(this._hass, this._reg, providers.calendar || {});
      this._people = discoverPeople(this._hass, providers.people || {});
      this._groups = linkGroups(this._people);
      this._buildFloors();
      this._render(true);
      this._refreshEvents();
    } catch (err) {
      console.error('Håg: discovery failed', err);
    }
  }

  // Fetch appointments now and every few minutes; also refetch when a
  // watched calendar changes state (an event starts or ends).
  async _refreshEvents() {
    clearTimeout(this._eventsTimer);
    try {
      this._events = await fetchEvents(this._hass, this._calendars);
      this._apptLimit = APPT_COUNT;   // new events: start from the full count
    } catch (err) {
      console.error('Håg: calendar fetch failed', err);
      this._events = 'Err';
    }
    this._calendarStamp = this._calendarStates();
    this._renderAppointments();
    this._eventsTimer = setTimeout(() => this._refreshEvents(), APPT_REFRESH);
  }

  _calendarStates() {
    return (this._calendars || []).map(id => this._hass.states[id]?.last_changed).join('|');
  }

  // Show or hide the alert row. In v0.1 the row always shows the build
  // version (D64); real alerts will drive this later.
  setAlertVisible(visible) {
    this._stage?.classList.toggle('no-alert', !visible);
    this._resetApptLimit();
    this._layout();
  }

  // Space may have grown (alert hidden, bigger screen, new events): go back to
  // the full appointment count; _layout() trims it again if it doesn't fit.
  _resetApptLimit() {
    if ((this._apptLimit ?? APPT_COUNT) === APPT_COUNT) return;
    this._apptLimit = APPT_COUNT;
    this._apptKey = null;
    this._renderAppointments();
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

    this._resize = new ResizeObserver(() => { this._resetApptLimit(); this._layout(); });
    this._resize.observe(this._stage);
    // Enable motion only after the first layout, so nothing slides in on load.
    requestAnimationFrame(() => requestAnimationFrame(() => this._stage.classList.add('animate')));
  }

  disconnectedCallback() {
    this._resize?.disconnect();
    clearTimeout(this._timer);
    clearTimeout(this._eventsTimer);
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

    this._renderAppointments();   // relative labels (within 24 h, soon) move with the clock
    this._layout();
    this._timer = setTimeout(() => this._tick(), 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  }

  // Next appointments, soonest at the bottom (nearest the center).
  // Within 24 hours: time only. Later: day and time, with the "later" cue.
  // Ongoing or within the hour: the "soon" breathing. None, or the calendars
  // failed: an error line (D65).
  _renderAppointments() {
    const list = this.shadowRoot.querySelector('.appointments');
    if (!list || this._events === undefined) return;
    const hass = this._hass;
    const tz = hass?.config?.time_zone;
    const locale = hass?.language || navigator.language;
    const time = d => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(d);
    const day = d => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: tz }).format(d);
    const dateKey = d => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);   // YYYY-MM-DD
    const now = new Date();

    let rows;
    const upcoming = this._events === 'Err' ? [] : this._events.filter(e => e.endAt > now).slice(0, this._apptLimit ?? APPT_COUNT);
    if (this._events === 'Err') {
      rows = [{ cls: 'appt-error err', icon: APPT_ICONS.err, text: 'Err' }];          // calendars failed (D88)
    } else if (!upcoming.length) {
      rows = [{ cls: 'appt-empty', icon: APPT_ICONS.empty, text: APPT_EMPTY[isNight(hass, now) ? 'night' : 'day'] }];   // nothing in the window
    } else {
      // Indent level = how many distinct days come before this one's day.
      const days = [...new Set(upcoming.map(e => dateKey(e.startAt)))];
      rows = upcoming.map(e => {
        const later = e.startAt - now > DAY;
        const soon = e.startAt <= now || e.startAt - now <= 60 * 60 * 1000;
        let when;
        if (e.allDay) when = dateKey(e.startAt) === dateKey(now) ? 'Today' : day(e.startAt);
        else when = later ? `${day(e.startAt)} ${time(e.startAt)}` : time(e.startAt);
        return {
          cls: `appt${later ? ' later' : ''}${soon && !later ? ' soon' : ''}${e === upcoming[0] ? ' wrap' : ''}`,
          icon: later ? APPT_ICONS.later : APPT_ICONS.soon,
          text: `${when} ${e.summary}`,
          indent: days.indexOf(dateKey(e.startAt)),
        };
      }).reverse();   // soonest last = nearest the center
    }

    const key = JSON.stringify(rows);
    if (key === this._apptKey) return;
    this._apptKey = key;
    list.replaceChildren(...rows.map(r => {
      const div = document.createElement('div');
      div.className = `t3 ${r.cls}`;
      div.style.setProperty('--indent', r.indent || 0);
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = r.text;   // event titles are never parsed as HTML
      div.innerHTML = '<span class="ico"></span>';
      setIcon(div.firstElementChild, r.icon);
      div.append(text);
      return div;
    }));
    this._layout();
  }

  // Build one cluster per floor (label / HVAC + temperature / air quality).
  _buildFloors() {
    const indoor = this.shadowRoot.querySelector('.indoor');
    const slot = (name, cls = '') =>
      `<span class="${cls}" data-slot="${name}"><span class="ico"></span><span class="val"></span></span>`;
    indoor.innerHTML = this._floors.map(f => `
      <div class="cluster" data-floor="${f.id}">
        <div class="t3"></div>
        <div class="status-line">${slot('temp', 't2')}<span class="people"></span></div>
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

    // A slot's icon: its own, or the alert icon when its value is bad (D88).
    // Icons don't change any size, so they never need a re-layout.
    const icon = (slot, value, name) => setIcon(slot.querySelector('.ico'), value === 'Err' ? ERR_ICON : name);
    const tempUnit = ref => unitOf(hass, ref) || hass.config?.unit_system?.temperature || '';

    // Outdoor
    const { temperature, humidity, aqi } = this._slots;
    const outTemp = numericValue(hass, temperature);
    const outHum = numericValue(hass, humidity);
    const outAqi = numericValue(hass, aqi);
    changed = this._fill(q('out-temp'), outTemp, v => `${v}°`) || changed;
    changed = this._fill(q('out-hum'),  outHum,  v => `${v}%`) || changed;
    changed = this._fill(q('out-aqi'),  outAqi,  v => `AQI ${v}`) || changed;
    icon(q('out-temp'), outTemp, thermometerIcon(outTemp, tempUnit(temperature)));
    icon(q('out-hum'),  outHum,  READING_ICONS.hum);
    icon(q('out-aqi'),  outAqi,  READING_ICONS.aqi);

    // Floors
    this._in.forEach((el, i) => {
      const f = this._floors[i];
      const fs = name => el.querySelector(`[data-slot="${name}"]`);
      const temp = numericValue(hass, f.slots.temp);
      changed = this._fill(fs('temp'), temp, v => `${v}°`) || changed;
      for (const k of f.aq) {
        const ref = f.slots[k];
        const value = numericValue(hass, ref);
        const fmt = k === 'hum' ? v => `${v}%` : v => `${v} ${unitOf(hass, ref)}`.trim();
        changed = this._fill(fs(k), value, fmt) || changed;
        icon(fs(k), value, READING_ICONS[k]);
      }

      // The temperature's icon shows the HVAC status (D47, D83), or the
      // error icon when the temperature itself is bad (D88). A floor with
      // no thermostat shows a thermometer (D84).
      const box = fs('temp').querySelector('.ico');
      const status = temp === 'Err' ? 'err' : (hvacStatus(hass, f.climate) || '');
      if (box.dataset.status !== status) {
        box.className = `ico ${status}`;
        box.dataset.status = status;
      }
      setIcon(box, status ? HVAC_ICONS[status] : thermometerIcon(temp, tempUnit(f.slots.temp)));
    });

    changed = this._renderPeople() || changed;

    if (changed) this._layout();
  }

  // Put each person's icon on their floor's row or before the outdoor
  // temperature (away). Rebuilds a spot only when who's in it changes.
  _renderPeople() {
    if (!this._people || !this._reg) return false;
    const hass = this._hass;
    const where = locatePeople(hass, this._people, this._reg);
    const spots = new Map(this._in.map((el, i) => [this._floors[i].id, el.querySelector('.people')]));
    const away = this.shadowRoot.querySelector('.people.away');
    const at = {};
    for (const [id, loc] of Object.entries(where)) {
      const key = loc.away ? '__away' : loc.floor;
      (at[key] ||= []).push(id);
    }
    let changed = false;
    const fill = (spot, ids, emptyFrame) => {
      if (!spot) return;
      // Same group together; within a group, people with their own location
      // first, then those following a link; then by person. Groups of 2+ get
      // one outline.
      ids.sort((a, b) =>
        (this._groups[a] - this._groups[b]) ||
        (Number(!!where[a].linked) - Number(!!where[b].linked)) ||
        a.localeCompare(b));
      const key = JSON.stringify(ids.map(id => [id, hass.states[id]?.attributes?.entity_picture || ''])) + emptyFrame;
      if (spot.dataset.key === key) return;
      spot.dataset.key = key;
      changed = true;
      const icon = id => {
        const st = hass.states[id];
        const el = document.createElement('span');
        el.className = 'person';
        const pic = st?.attributes?.entity_picture;
        if (pic) {
          const img = document.createElement('img');
          img.src = hass.hassUrl ? hass.hassUrl(pic) : pic;
          img.alt = st.attributes.friendly_name || '';
          el.append(img);
        } else {
          el.textContent = initials(st?.attributes?.friendly_name);
        }
        return el;
      };
      const nodes = [];
      for (let i = 0; i < ids.length;) {
        let j = i;
        while (j < ids.length && this._groups[ids[j]] === this._groups[ids[i]]) j++;
        if (j - i > 1) {
          const g = document.createElement('span');
          g.className = 'person-group';
          g.append(...ids.slice(i, j).map(icon));
          nodes.push(g);
        } else nodes.push(icon(ids[i]));
        i = j;
      }
      if (!ids.length && emptyFrame) {
        const e = document.createElement('span');
        e.className = 'person empty';
        nodes.push(e);
      }
      spot.replaceChildren(...nodes);
    };
    for (const [floor, spot] of spots) fill(spot, at[floor] || [], false);
    fill(away, at.__away || [], true);   // nobody away: the breathing frame
    return changed;
  }

  // ----- Layout engine (ported from design/wireframe-idle.html) -----

  _capHeight(el) {
    const cs = getComputedStyle(el);
    this._measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return this._measure.measureText('H').actualBoundingBoxAscent;
  }

  // How far an element's own text reaches below its baseline (0 if it has no
  // descenders).
  _descent(el) {
    const cs = getComputedStyle(el);
    this._measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return Math.max(0, this._measure.measureText(el.textContent).actualBoundingBoxDescent);
  }

  // Baseline of an element's text: the first line's, via a zero-size inline
  // probe, or the last visible line's (for text that wraps or is cut off),
  // counted from the first in whole line heights.
  _baselineY(el, last = false) {
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    el.insertBefore(probe, el.firstChild);
    const first = probe.getBoundingClientRect().bottom;
    probe.remove();
    if (!last) return first;
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    if (!lh) return first;
    const lines = Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
    return first + (lines - 1) * lh;
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
          top = Math.min(top, this._baselineY(el) - this._capHeight(el));
          // data-descender="f" counts that fraction of the text's actual
          // descender as part of its visible bottom (the date's "y" hangs
          // toward the clock; D56 exception).
          const share = parseFloat(el.dataset.descender) || 0;
          bottom = Math.max(bottom, this._baselineY(el, true) + share * this._descent(el));
        }
        walk(el);
      }
    };
    walk(cluster);
    return { top: top - base, bottom: bottom - base };
  }

  // Keep the appointment block's right edge even: measure each line at full
  // length (minus its day indent), then cap every line at the second-longest
  // plus a small tolerance, shifted back by its own indent (and never more
  // than APPT_MAX_CH). Lines past the cap are cut off; the soonest wraps to
  // a second line first.
  _fitAppointments() {
    const rows = [...this.shadowRoot.querySelectorAll('.appointments > .appt')];
    if (!rows.length) return;
    const texts = rows.map(r => r.querySelector('.text'));
    texts.forEach(t => { t.style.maxWidth = 'none'; t.style.whiteSpace = 'nowrap'; t.style.display = 'inline-block'; });
    const listLeft = rows[0].parentElement.getBoundingClientRect().left;
    const right = texts.map(t => t.getBoundingClientRect().right - listLeft);   // natural right edges
    const lefts = texts.map(t => t.getBoundingClientRect().left - listLeft);
    texts.forEach(t => { t.style.whiteSpace = ''; t.style.display = ''; });

    const cs = getComputedStyle(texts[0]);
    this._measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const ch = this._measure.measureText('0').width;
    // Stagger-aware: compare lines with their day indent taken out, so the
    // right edges step down the diagonal the same way the left edges do.
    const indent = rows.map(r => parseFloat(getComputedStyle(r).marginLeft) || 0);
    const unstaggered = right.map((r, i) => r - indent[i]);
    const sorted = [...unstaggered].sort((a, b) => b - a);
    const cap = rows.length > 1 ? sorted[1] + APPT_TOLERANCE_CH * ch : Infinity;

    texts.forEach((t, i) => {
      t.style.maxWidth = `${Math.min(cap + indent[i] - lefts[i], APPT_MAX_CH * ch)}px`;
    });
  }

  // Make person icons exactly as tall as the medium digits (cap top to
  // baseline, border included), and sit each row of them inside its
  // temperature's digits, so a row with people is no taller than one
  // without (D49, D96).
  _fitPortraits() {
    const stage = this.shadowRoot.querySelector('.stage');
    const rows = [...this.shadowRoot.querySelectorAll('.status-line')];
    const digits = row => [...row.querySelectorAll('.t2[data-slot] > :last-child')]
      .find(el => el.getClientRects().length && el.textContent.trim());
    const ref = rows.map(digits).find(Boolean);
    if (!ref) return;                           // nothing to measure yet
    stage.style.setProperty('--portrait', `${this._capHeight(ref)}px`);
    for (const row of rows) {
      const people = row.querySelector('.people');
      const text = digits(row);
      if (!people) continue;
      people.style.transform = '';
      if (!text || !people.getClientRects().length) continue;   // no temperature: stay centered
      const capTop = this._baselineY(text) - this._capHeight(text);
      people.style.transform = `translateY(${capTop - people.getBoundingClientRect().top}px)`;
    }
  }

  // Size the clock so its numerals are exactly as tall as the top floor block
  // (cap top to baseline), so the two line up across the divide (D58). The
  // clock is a unique element, so it doesn't have to follow the size steps.
  _fitTime() {
    const time = this.shadowRoot.querySelector('.time');
    const top = this._in[0];
    if (!time || !top) return;
    time.style.fontSize = '';                   // start from the default size
    const t = this._opticalEdges(this._out[0]);
    const f = this._opticalEdges(top);
    const current = t.bottom - t.top, target = f.bottom - f.top;
    if (current > 0 && target > 0) {
      time.style.fontSize = `${parseFloat(getComputedStyle(time).fontSize) * target / current}px`;
    }
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
    // With the alert row shown, clusters clear it by one gap. Without it, the
    // innermost block on each side (the time; the top floor) is centered on
    // the middle, so the two sit side by side across the line, and slide
    // past each other as the alert row opens.
    const alertOn = !stage.classList.contains('no-alert');
    const half = alertOn ? this._alertRow.getBoundingClientRect().height / 2 : 0;

    stage.style.setProperty('--haag-split', (180 - this._angle) + 'deg');
    this._fitPortraits();
    this._fitTime();
    this._alignAmPm();
    this._fitAppointments();

    // Horizontal position for a cluster at height ty, with its nearest
    // visible corner at signed distance `target` from the line. `clamped` is
    // true when the card's edge stops it short, i.e. it would cross the line.
    const solveX = (el, ty, target, pick) => {
      const corners = this._shapeCorners(el);
      const sNoX = corners.map(([x, y]) => sa * x + ca * (ty + y - cy));
      const want = cx + (target - pick(...sNoX)) / sa;
      const minX = Math.min(...corners.map(c => c[0]));
      const maxX = Math.max(...corners.map(c => c[0]));
      const tx = Math.min(Math.max(want, edge - minX), W - edge - maxX);
      return { tx, left: tx + minX, clamped: Math.abs(tx - want) > 0.5 };
    };
    const place = (el, ty, target, pick) => {
      el.style.transform = `translate(${solveX(el, ty, target, pick).tx}px, ${ty}px)`;
    };

    // Visible bottom of the first outdoor cluster, and visible top of the
    // first indoor cluster.
    let outStart = cy - half - cgap;
    let inStart = cy + half + cgap;
    if (!alertOn && this._out[0] && this._in[0]) {
      // No alert: the time and the top floor sit side by side at the same
      // height (D58), centered on the middle if they fit there. If the
      // clock is too wide to clear the line that low, or to keep at least
      // PAIR_LEFT_MARGIN from the card's left edge, the pair slides up only
      // as far as needed. If no height works, fall back to stacking from
      // the center.
      const ot = this._opticalEdges(this._out[0]);
      const it = this._in[0] && this._opticalEdges(this._in[0]);
      const tH = ot.bottom - ot.top, fH = it.bottom - it.top;
      const step = Math.min(W, H) * 0.005;
      // Slide the pair up the line until the clock clears the left margin.
      // The margin is a preference: if the top floor would hit the right edge
      // first, keep the furthest slide where both still sit on the line
      // (D58: side by side wins over the margin, for square displays).
      let best = null;
      for (let shift = 0; shift <= H / 2; shift += step) {
        const tBottom = cy + tH / 2 - shift, fTop = cy - fH / 2 - shift;
        const t = solveX(this._out[0], tBottom - ot.bottom, -gap, Math.max);
        const f = solveX(this._in[0], fTop - it.top, gap, Math.min);
        if (t.clamped || f.clamped) continue;
        if (!best || t.left > best.left) best = { left: t.left, tBottom, fTop };
        if (t.left >= PAIR_LEFT_MARGIN * Math.min(W, H)) break;
      }
      if (best) {
        outStart = best.tBottom;
        inStart = best.fTop;
      } else {                                 // nothing fits on the line: stack
        outStart = cy - cgap / 2;
        inStart = cy + cgap / 2;
      }
    }

    let y = outStart;                          // visible bottom of next outdoor cluster
    let outTop = Infinity;                     // final top of the outdoor stack's ink
    for (const el of this._out) {
      const o = this._opticalEdges(el);
      const ty = y - o.bottom;
      place(el, ty, -gap, Math.max);
      // Measured relative to the cluster, so a running transition doesn't skew it.
      const base = el.getBoundingClientRect().top;
      const inkTop = Math.min(...this._inkParts(el).map(p => p.getBoundingClientRect().top - base));
      outTop = Math.min(outTop, ty + inkTop);
      y = ty + o.top - cgap;
    }

    y = inStart;                               // visible top of next indoor cluster
    for (const el of this._in) {
      const o = this._opticalEdges(el);
      const ty = y - o.top;
      place(el, ty, gap, Math.min);
      y = ty + o.bottom + cgap;
    }

    // Not enough room above the outdoor stack: drop the furthest appointment
    // and lay out again (D94).
    const shown = this.shadowRoot.querySelectorAll('.appointments > .appt').length;
    if (outTop < edge && shown > 1) {
      this._apptLimit = shown - 1;
      this._apptKey = null;
      this._renderAppointments();   // re-renders and calls _layout() again
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
