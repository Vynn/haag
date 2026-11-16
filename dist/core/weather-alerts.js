/*
  Håg core: weather alerts.
  A part of the core in a file of its own. It imports nothing (what it
  needs is handed to it), and haag.js loads it with a tag of its own:
  raise that tag when this file changes (docs/development.md#file-tags).
  License: GPL-3.0

  From HA's alert integrations, one source at a time. Each source's
  adapter reads its entities, or calls its action, into one shape:
  { key, event, severity or level, start, end, urgency, status, type }.
*/

const MINUTE = 60 * 1000;

const WX_AHEAD = 24 * 60 * MINUTE;   // upcoming alerts show from this long before they start
export const WX_REFRESH = 15 * MINUTE;      // actions are called again at least this often
const CAP_LEVELS = { extreme: 'critical', severe: 'warning', moderate: 'info' };   // minor, unknown: hidden
const DWD_LEVELS = { 2: 'info', 3: 'warning', 4: 'critical' };                     // 1 (yellow): hidden
const ECCC_LEVELS = { yellow: 'info', orange: 'warning', red: 'critical' };        // no colour: hidden
const ECCC_SHOWN = ['warnings', 'watches', 'advisories'];   // not statements or endings
const METEOALARM = 'Information provided by MeteoAlarm';
const AMTLICH = /^Amtliche\s+\S*WARNUNG\s+vor\s+/i;   // NINA headline lead, dropped so the time fits

// Sources in the order they're used (core, then custom), with their names.
export const WX_SOURCES = {
  nina: 'NINA', environment_canada: 'Environment Canada', dwd_weather_warnings: 'DWD', meteoalarm: 'MeteoAlarm',
  cap_alerts: 'CAP Alerts', nws_alerts: 'NWS Alerts', weatheralerts: 'Weather Alerts',
};

/**
 * The weather alert source: the one chosen in settings, else the first
 * installed, in WX_SOURCES order. None when weather alerts are off.
 * `notice(level, text)` is told when the chosen one isn't installed.
 * Returns { platform, entities, ... } or null.
 */
export function discoverWeather(hass, reg, settings, notice = () => {}) {
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
export function readWeather(hass, src, fetched) {
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
 * information from a day ahead; Extreme ones hold the row. `time(t,
 * now)` writes a time as Home Assistant's settings do.
 */
export function weatherAlerts(list, time, now = Date.now()) {
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
      alerts.push({ key: a.key, level: 'info', text: `${a.event} from ${time(a.start, now)}` });
    } else {
      const text = a.end === null ? a.event : `${a.event} until ${time(a.end, now)}`;
      alerts.push({ key: a.key, level, text, hold: level === 'critical' });
    }
  }
  if (alerts.length) later(now - now % (60 * MINUTE) + 60 * MINUTE);   // weekdays change at midnight
  return { alerts, next };
}
