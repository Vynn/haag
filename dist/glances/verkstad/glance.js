/*
  Workshop glance: 3D printers while they print, and for a while after a
  print ends. Its own element coordinates: it finds the printers, puts them
  in order and lists up to three as instances, each drawing one printer
  (docs/glances.md#instances). Reads Bambu Lab, OctoPrint, PrusaLink,
  Dremel and Moonraker printers.
  License: GPL-3.0
*/

const MINUTE = 60 * 1000;
const REST = 7200;          // seconds a printer stays after its print ends (setting `rest`)
const RUNS = 'haag-verkstad';   // browser storage: each printer's print
const SHOWN = 3;            // printers taking turns; the rest are counted
const SNAPSHOT = 10 * 1000; // ms between camera snapshots
const LIVE = 1;             // seconds between live frames (Home Assistant's floor is .5)
const PAIR_LEFT_MARGIN = 0.028;   // as Overview's: the clock's least room on the left
const READOUTS = .88;       // the readouts' bottom, as a share of the short side from the top
const ACTIVE = ['preparing', 'heating', 'printing', 'paused'];
const ENDED = ['finished', 'failed', 'cancelled'];
const WORDS = { preparing: 'Preparing', heating: 'Heating', printing: 'Printing', paused: 'Paused',
  finished: 'Finished', failed: 'Failed', cancelled: 'Cancelled' };

// A printer's entities, read by the keys its integration gives them.
function sensors(hass, p) {
  const st = key => hass.states[p.entities[key]];
  const num = key => { const s = st(key), v = Number(s?.state); return s && s.state !== '' && Number.isFinite(v) ? v : null; };
  const text = key => { const v = st(key)?.state; return v && v !== 'unavailable' && v !== 'unknown' ? v : ''; };
  const temp = (now, target) => num(now) == null ? null : { now: num(now), target: num(target) };
  return { hass, p, st, num, text, temp };
}

// When the print ends: from the time left, in its own unit (hours if
// unlabeled), else from an end time.
function ending(r, now, left, end) {
  const v = left ? r.num(left) : null, unit = left && r.st(left)?.attributes?.unit_of_measurement;
  const ms = v == null ? null : v * ({ s: 1000, min: MINUTE, h: 60 * MINUTE, d: 1440 * MINUTE }[unit] ?? 60 * MINUTE);
  const t = end ? Date.parse(r.st(end)?.state) : NaN;
  return ms != null && ms > 0 ? now + ms : Number.isFinite(t) && t > now ? t : null;
}

// A file's name without its folder or G-code extension.
const fileName = s => s.replace(/^.*\//, '').replace(/\.(b?gcode|gco|g)$/i, '');

// Numbered nozzles when there's more than one; the printers here don't say which is active.
const numbered = list => list.map((n, i) => ({ label: list.length > 1 ? `Nozzle ${i + 1}` : 'Nozzle', ...n, active: true }));

/*
  Bambu Lab (greghesp/ha-bambulab): a printer is a device with a print
  status; external spools are devices of their own, through it. Entities
  are matched by translation key, from sensors, binary sensors, cameras
  and images (switches share some keys).
*/
const HEATING = new Set(['heatbed_preheating', 'heating_hotend', 'heating_chamber', 'waiting_for_heatbed_temperature',
  'heatbed_stabilizing', 'thermal_preconditioning', 'waiting_chamber_temperature_equalize']);

// One word for a print status and stage. Before the first layer, a running
// printer is heating or preparing; paused stages are paused.
function bambuState(status, stage, layer) {
  if (status === 'running') {
    if (String(stage).startsWith('paused')) return 'paused';
    if (stage === 'printing' || layer > 0) return 'printing';
    return HEATING.has(stage) ? 'heating' : 'preparing';
  }
  return { prepare: 'preparing', slicing: 'preparing', init: 'preparing', pause: 'paused', finish: 'finished', failed: 'failed', idle: 'idle' }[status] ?? 'offline';
}

// A color from Bambu Lab's #RRGGBBAA, or null when it's unknown (transparent).
const hex = c => typeof c !== 'string' ? null : /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c) && !/^#[0-9a-f]{6}00$/i.test(c) ? c.slice(0, 7) : null;

// The loaded filament's colors: the active AMS tray's, else the active
// external spool's. More than one for a multicolor filament.
function filament(hass, p) {
  const tray = hass.states[p.entities.active_tray]?.attributes;
  const spool = p.spools.map(id => hass.states[id]?.attributes).find(a => a?.active);
  const a = hex(tray?.color) ? tray : spool;
  const cols = [...new Set((Array.isArray(a?.cols) ? a.cols : []).map(hex).filter(Boolean))];
  return cols.length > 1 ? cols : hex(a?.color) ? [hex(a.color)] : [];
}

function readBambu(r, now) {
  const { st, num, temp } = r, layer = num('current_layer');
  const nozzles = r.p.entities.left_nozzle_temp
    ? [['Left', 'left'], ['Right', 'right']].map(([label, side]) => ({ label, ...temp(`${side}_nozzle_temp`, `${side}_target_nozzle_temp`),
      active: st('active_nozzle')?.state === side }))
    : [{ label: 'Nozzle', ...temp('nozzle_temp', 'target_nozzle_temp'), active: true }];
  return {
    state: bambuState(st('print_status')?.state, st('stage')?.state, layer),
    progress: num('print_progress'), layer, layers: num('total_layers'),
    ends: ending(r, now, 'remaining_time', 'end_time'),
    job: st('subtask_name')?.state || st('gcode_file')?.state || '',
    nozzles, bed: temp('bed_temp', 'target_bed_temp'), chamber: temp('chamber_temp', 'target_chamber_temp'),
    fans: [['cooling_fan_speed', 'Part'], ['aux_fan_speed', 'Aux'], ['chamber_fan_speed', 'Chamber']]
      .filter(([key]) => num(key) != null).map(([key, label]) => ({ label, on: num(key) > 0 })),
    colors: filament(r.hass, r.p),
    door: st('door_open'),
  };
}

/*
  OctoPrint (core): one device per server. Unique IDs are "<name>-<server
  ID>", the camera's the server ID alone. It has no finished state: the
  printer goes back to operational, and the job keeps its percentage.
*/
const OCTOPRINT = { printing: 'printing', printing_sd: 'printing', resuming: 'printing', finishing: 'printing',
  starting: 'preparing', starting_sd: 'preparing', pausing: 'paused', paused: 'paused', cancelling: 'cancelled',
  error: 'failed', offline_after_error: 'failed', operational: 'idle', transferring_file: 'idle',
  starting_streaming: 'idle', printing_streaming: 'idle' };   // streaming: a file going to the SD card

function readOctoPrint(r, now, last) {
  const status = r.text('Current State'), progress = r.num('Job Percentage');
  let state = OCTOPRINT[status] ?? 'offline';
  // Back to operational: finished at 100%; short of it, straight after a
  // print, cancelled (until the next one).
  if (status === 'operational') {
    if (progress >= 99.5) state = 'finished';
    else if (ACTIVE.includes(last) || last === 'cancelled') state = 'cancelled';
  }
  const tools = Object.keys(r.p.entities).map(k => k.match(/^actual tool(\d+) temp$/)?.[1]).filter(Boolean).sort((a, b) => a - b);
  return {
    state, progress,
    ends: ending(r, now, null, 'Estimated Finish Time'),
    job: fileName(r.text('Current File')),
    nozzles: numbered(tools.map(t => r.temp(`actual tool${t} temp`, `target tool${t} temp`))),
    bed: r.temp('actual bed temp', 'target bed temp'),
  };
}

/*
  PrusaLink (core): entities by translation key. Temperatures and fans
  (in rpm) are off by default in Home Assistant. Its camera is the file's
  thumbnail.
*/
const PRUSALINK = { printing: 'printing', paused: 'paused', attention: 'paused', finished: 'finished', stopped: 'cancelled',
  error: 'failed', idle: 'idle', ready: 'idle', busy: 'idle' };

const readPrusaLink = (r, now) => ({
  state: PRUSALINK[r.text('printer_state')] ?? 'offline',
  progress: r.num('progress'),
  ends: ending(r, now, null, 'print_finish'),
  job: fileName(r.text('filename')),
  nozzles: numbered([r.temp('nozzle_temperature', 'nozzle_target_temperature')]),
  bed: r.temp('heatbed_temperature', 'heatbed_target_temperature'),
  fans: r.num('fan_print') == null ? [] : [{ label: 'Part', on: r.num('fan_print') > 0 }],
});

/*
  Dremel 3D Printer (core): sensors by translation key; the door has none,
  so it's found by its unique ID's end. Progress, temperatures and the job's
  name are off by default in Home Assistant.
*/
const DREMEL = { preparing: 'preparing', building: 'printing', resuming: 'printing', pausing: 'paused', paused: 'paused',
  completed: 'finished', abort: 'cancelled', idle: 'idle' };

const readDremel = (r, now) => ({
  state: DREMEL[r.text('job_phase')] ?? 'offline',
  progress: r.num('progress'),
  ends: ending(r, now, null, 'completion_time'),
  job: r.text('job_name'),
  nozzles: numbered([r.temp('extruder', 'target_extruder_temperature')]),
  bed: r.temp('platform_temperature', 'target_platform_temperature'),
  chamber: r.temp('chamber'),
  door: r.st('door'),
});

/*
  Moonraker (custom, for Klipper): no translation keys; unique IDs are
  "<entry>_<key>", and webcams are named by the user. Targets are number
  entities. Progress and layers read 0 except while printing.
*/
const MOONRAKER = { printing: 'printing', paused: 'paused', complete: 'finished', cancelled: 'cancelled', error: 'failed', standby: 'idle' };

function readMoonraker(r, now) {
  const tools = Object.keys(r.p.entities).filter(k => /^extruder\d*_temp$/.test(k)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const fan = r.num('fan_speed');
  return {
    state: MOONRAKER[r.text('print_state')] ?? 'offline',
    progress: r.num('progress'), layer: r.num('current_layer'), layers: r.num('total_layer'),
    ends: ending(r, now, 'print_time_left', 'print_eta'),
    job: fileName(r.text('filename')),
    nozzles: numbered(tools.map(t => r.temp(t, t.replace(/_temp$/, '_target')))),
    bed: r.temp('heater_bed_temp', 'heater_bed_target'),
    fans: fan == null ? [] : [{ label: 'Part', on: fan > 0 }],
  };
}

// Each integration: the domains read, each entity's key, the entity a
// printer must have, its pictures (a camera, a cover), and its reader.
const afterEntry = e => e.unique_id?.startsWith(`${e.config_entry_id}_`) ? e.unique_id.slice(e.config_entry_id.length + 1) : null;
const isCamera = e => e.entity_id.startsWith('camera.');
const BRANDS = {
  bambu_lab: { domains: ['sensor', 'binary_sensor', 'camera', 'image'], key: e => e.translation_key,
    state: 'print_status', camera: 'camera', cover: 'cover_image', read: readBambu },
  octoprint: { domains: ['sensor', 'camera'], key: e => isCamera(e) ? 'camera' : e.unique_id?.split('-')[0],
    state: 'Current State', camera: 'camera', read: readOctoPrint },
  prusalink: { domains: ['sensor', 'camera'], key: e => e.translation_key,
    state: 'printer_state', cover: 'job_preview', read: readPrusaLink },
  dremel_3d_printer: { domains: ['sensor', 'binary_sensor', 'camera'],
    key: e => e.translation_key ?? (isCamera(e) ? 'camera' : e.unique_id?.endsWith('_door') ? 'door' : null),
    state: 'job_phase', camera: 'camera', read: readDremel },
  moonraker: { domains: ['sensor', 'camera', 'number'], key: e => isCamera(e) ? (afterEntry(e) === 'thumbnail' ? 'thumbnail' : 'webcam') : afterEntry(e),
    state: 'print_state', camera: 'webcam', cover: 'thumbnail', read: readMoonraker },
};

function findPrinters(hass, entities, devices) {
  const groups = new Map();
  for (const e of entities) {
    const brand = BRANDS[e.platform];
    if (!brand || !e.device_id || e.disabled_by || !brand.domains.includes(e.entity_id.split('.')[0])) continue;
    const key = brand.key(e), g = groups.get(e.device_id) ?? { brand: e.platform, entities: {} };
    if (!key || g.brand !== e.platform) continue;
    groups.set(e.device_id, g);
    g.entities[key] ??= e.entity_id;
  }
  const byId = new Map(devices.map(d => [d.id, d]));
  return [...groups].filter(([, g]) => g.entities[BRANDS[g.brand].state]).map(([id, g]) => {
    const d = byId.get(id), b = BRANDS[g.brand];
    const spools = devices.filter(s => s.via_device_id === id).map(s => groups.get(s.id)?.entities.external_spool).filter(Boolean);
    return { id, brand: g.brand, name: d?.name_by_user || d?.name || '', entities: g.entities, spools,
      camera: g.entities[b.camera] ?? null, cover: g.entities[b.cover] ?? null };
  });
}

// A printer's reading, the same for every integration; what it doesn't
// report is left empty. `last` is the state last seen, for OctoPrint.
function readPrinter(hass, p, now, last) {
  const b = BRANDS[p.brand], r = sensors(hass, p), v = b.read(r, now, last);
  return {
    progress: null, layer: null, layers: null, job: '', bed: null, chamber: null, fans: [], colors: [], door: null,
    ...v,
    changed: Date.parse(r.st(b.state)?.last_changed) || now,
    ends: v.ends == null ? null : Math.round(v.ends / MINUTE) * MINUTE,
    nozzles: (v.nozzles ?? []).filter(n => n.now != null),
  };
}

/*
  A printer's print, kept in the browser: when it started (`since`), when
  it ended (`ended`), whether its rest is over (`cleared`) and the state
  last seen. Seen for the first time, the state's last change stands in
  for now. A print first seen already over, with no record of it (a new
  display, or Home Assistant restarted), isn't shown as just ended.
*/
function track(rec, r, now) {
  const at = rec.last === undefined ? r.changed : now;
  if (ACTIVE.includes(r.state)) {
    if (!rec.since || rec.ended) {
      for (const k in rec) delete rec[k];
      rec.since = at;
    }
  } else if (ENDED.includes(r.state)) {
    if (!rec.since) rec.cleared = true;
    rec.ended ??= at;
    rec.since ??= at;
  }
  rec.last = r.state;
}

const loadRuns = () => { try { return JSON.parse(localStorage.getItem(RUNS)) || {}; } catch { return {}; } };

let workshop = null;   // the coordinator, for printers to report a dismissal

// The coordinator: never shown.
class WorkshopGlance extends HTMLElement {
  constructor() {
    super();
    this._runs = loadRuns();
    workshop = this;
  }

  // A printer's alert was dismissed: its rest is over.
  dismiss(id) {
    const rec = this._runs[id];
    if (!rec?.ended || rec.cleared) return;
    rec.cleared = true;
    this._save();
    this._update();
  }

  // ----- Glance API (docs/glances.md) -----

  setConfig(settings) {
    this._settings = settings;
    this._update();
  }

  set haag(haag) {
    this._haag = haag;
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._finding) this._finding = this._find();
    this._update();
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
  }

  // Registries once, as the core reads them (any logged-in user can).
  async _find() {
    try {
      const [entities, devices] = await Promise.all(['entity', 'device']
        .map(t => this._hass.callWS({ type: `config/${t}_registry/list` })));
      this._printers = findPrinters(this._hass, entities, devices);
    } catch (err) {
      console.error("Håg: the Workshop glance couldn't read Home Assistant's setup", err);
      this._printers = [];
    }
    this._update();
  }

  // Printers printing, paused or getting ready; after a print ends, a rest
  // of `rest` seconds, cut short by the door opening or the alert being
  // dismissed. Failed first, then finished or cancelled, then the closest
  // to finishing; three take turns, the rest are counted.
  _update() {
    if (!this._printers || !this._hass || !this._haag) return;
    const now = Date.now(), rest = (this._settings?.rest ?? REST) * 1000;
    const before = JSON.stringify(this._runs), shown = [];
    let idle = 0;
    for (const p of this._printers) {
      const rec = this._runs[p.id] ??= {}, r = readPrinter(this._hass, p, now, rec.last);
      track(rec, r, now);
      if (rec.ended && !rec.cleared && r.door?.state === 'on' && Date.parse(r.door.last_changed) > rec.ended) rec.cleared = true;
      const showing = ACTIVE.includes(r.state) || (rec.ended && !rec.cleared && now < rec.ended + rest);
      if (showing) shown.push({ p, r, rec });
      else if (r.state !== 'offline') idle++;
    }
    for (const id in this._runs) if (!this._printers.some(p => p.id === id)) delete this._runs[id];
    if (JSON.stringify(this._runs) !== before) this._save();

    const rank = ({ r }) => ({ failed: 0, finished: 1, cancelled: 1 }[r.state] ?? 2);
    shown.sort((a, b) => rank(a) - rank(b) || (rank(a) < 2 ? b.rec.ended - a.rec.ended
      : (a.r.ends ?? Infinity) - (b.r.ends ?? Infinity) || a.rec.since - b.rec.since));
    const more = Math.max(0, shown.length - SHOWN);
    const summary = [more && `${more} more printing`, idle && `${idle} idle`].filter(Boolean).join(' · ');
    this._haag.instances.set(shown.slice(0, SHOWN).map(({ p, r, rec }) => {
      const { changed, door, ...view } = r;
      return { id: p.id, data: { ...view, printer: p.name, ended: ACTIVE.includes(r.state) ? null : rec.ended,
        camera: p.camera, cover: p.cover, summary } };
    }));
    if (!!shown.length !== this._wants) {
      this._wants = !!shown.length;
      if (this._wants) this._haag.request();
      else this._haag.release();
    }
    // A rest ends on its own time.
    clearTimeout(this._timer);
    const ends = shown.filter(s => s.rec.ended && !ACTIVE.includes(s.r.state)).map(s => s.rec.ended + rest);
    if (ends.length) this._timer = setTimeout(() => this._update(), Math.min(...ends) - now + 50);
  }

  _save() {
    try { localStorage.setItem(RUNS, JSON.stringify(this._runs)); } catch {}
  }
}

// Times follow HA's time format and zone, with the weekday when it isn't today.
function formatTime(hass, t, now = Date.now()) {
  const timeZone = hass?.config?.time_zone, style = hass?.locale?.time_format;
  const locale = style === 'system' ? undefined : hass?.locale?.language || hass?.language;
  const day = d => new Intl.DateTimeFormat('en-CA', { timeZone }).format(d);   // YYYY-MM-DD
  const options = { hour: 'numeric', minute: '2-digit', ...{ 12: { hour12: true }, 24: { hourCycle: 'h23' } }[style], timeZone };
  if (day(t) !== day(now)) options.weekday = 'short';
  return new Intl.DateTimeFormat(locale, options).format(t);
}
// "1 h 25 min", "40 min".
const span = ms => {
  const m = Math.max(0, Math.round(ms / MINUTE)), h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};
const esc = s => String(s).replace(/[&<>"]/g, c => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);

const STYLE = `
  :host { display: block; width: 100%; height: 100%; container-type: size; }

  .stage {
    --cluster-gap: calc(2.7 * var(--u));   /* as Overview's */
    --t2: calc(5.5 * var(--u));
    --move: 700ms ease-in-out;
    position: relative; width: 100%; height: 100%; overflow: hidden;
    background: var(--home);
  }
  .stage.paused * { animation-play-state: paused !important; }
  :host([between]) .stage { background: none; }

  /* The picture in the weather area: the sky behind it, dimmed toward the
     night sky above the split; below it, the home color, mostly opaque. */
  .sky, .veil, .panel, .split { position: absolute; inset: 0; }
  .sky { background: radial-gradient(120% 90% at 30% 85%, var(--horizon), transparent 60%), var(--sky); }
  .pic { position: absolute; }
  .pic img { display: block; width: 100%; height: 100%; }
  .pic img.camera { object-fit: cover; }
  .pic img.cover { object-fit: contain; }
  .pic .fallback { position: absolute; color: var(--text-2-out); opacity: .55; }
  .veil {
    background: var(--n-sky); opacity: .35;
    -webkit-mask-image: linear-gradient(var(--haag-split), #000 50%, transparent 50%);
            mask-image: linear-gradient(var(--haag-split), #000 50%, transparent 50%);
  }
  .panel {
    background: var(--home); opacity: .8;
    -webkit-mask-image: linear-gradient(var(--haag-split), transparent 50%, #000 50%);
            mask-image: linear-gradient(var(--haag-split), transparent 50%, #000 50%);
  }
  .split { width: 100%; height: 100%; overflow: visible; }
  .split .track { stroke: color-mix(in oklab, var(--text-2) 30%, transparent); stroke-linecap: round; }
  .split .edge { stroke: color-mix(in oklab, var(--text) 45%, transparent); stroke-linecap: round; }
  .split .fill { stroke-linecap: round; }

  /* Clusters, placed by _layout(), as Overview's. */
  .cluster {
    position: absolute; left: 0; top: 0;
    display: flex; flex-direction: column; align-items: flex-start;
    gap: calc(.4 * var(--u)); line-height: 1.05; white-space: nowrap;
  }
  .stage.animate .cluster { transition: transform var(--move); }
  .stage.animate .cluster.fresh { transition: none; }   /* new readout rows appear in place */
  .t1 { font-size: calc(14 * var(--u)); }
  .t2 { font-size: var(--t2); }
  .t3 { font-size: calc(2.8 * var(--u)); color: var(--text-2); }
  .upper .t3 { color: var(--text-2-out); }
  /* Over the picture, night's text by day too: a camera's frame is mostly dark. */
  .upper { --text: var(--n-text); --text-2: var(--n-text-2); --text-2-out: var(--n-text-2); color: var(--text); }
  .line { display: flex; gap: calc(1.2 * var(--u)); align-items: baseline; }
  .name { max-width: calc(48 * var(--u)); overflow: hidden; text-overflow: ellipsis; }

  /* The clock is Håg's; this stands in for layout to measure. */
  .time { position: relative; line-height: .8; visibility: hidden; }
  .time [data-live="time"] { display: inline-block; line-height: .8; }
  .ampm { position: absolute; left: 100%; top: 0; margin-left: calc(.7 * var(--u)); font-size: var(--t2); line-height: 1; }

  .dot { display: inline-block; width: .8em; height: .8em; margin-right: .2em; border-radius: 50%; background: var(--text-2); vertical-align: -.05em; }
  .dot.go { background: var(--seaglass); }
  .dot.warm, .dot.warn { background: var(--coral); }
  .warn { color: var(--coral); }

  /* Readouts: items side by side, a label over each value. */
  .cells { display: flex; gap: calc(3.2 * var(--u)); align-items: flex-start; }
  .cell { display: flex; flex-direction: column; gap: calc(.4 * var(--u)); }
  .cell.dim .t2 { color: var(--text-2); }
  .fan { display: block; width: calc(5 * var(--u)); height: calc(5 * var(--u)); margin-top: calc(.5 * var(--u)); color: var(--text-2); }
  .fan.on { color: var(--text); animation: spin 1.1s linear infinite; }
  .fan > ha-icon, .fallback > ha-icon { display: flex; width: 100%; height: 100%; --mdc-icon-size: 100%; }
  @keyframes spin { to { rotate: 360deg; } }
  @media (prefers-reduced-motion: reduce) { .fan.on { animation: none; } }
`;

const TEMPLATE = `
  <div class="stage">
    <div class="sky"></div>
    <div class="pic"></div>
    <div class="veil"></div>
    <div class="panel"></div>
    <svg class="split" aria-hidden="true"></svg>
    <section class="upper" aria-label="Printer">
      <div class="cluster"><div class="t1 time"><span data-live="time"></span><span class="ampm" data-live="ampm"></span></div></div>
      <div class="cluster" data-part="printer"></div>
      <div class="cluster" data-part="state"></div>
      <div class="cluster" data-part="summary"></div>
    </section>
    <section class="lower" aria-label="Print">
      <div class="cluster" data-part="job"></div>
      <div class="cluster" data-part="time"></div>
    </section>
    <section class="readouts" aria-label="Readouts"></section>
  </div>
`;

// A readout's empty cell; fill() writes its values, in place.
const cellHTML = c => `<div class="cell"><div class="t3">${c.label}</div>${c.fan
  ? '<span class="fan"></span>' : '<div class="line"><span class="t2"></span><span class="t3"></span></div>'}</div>`;
function fill(el, c) {
  el.classList.toggle('dim', !!c.dim);
  if (c.fan) return el.querySelector('.fan').classList.toggle('on', c.on);
  const [value, sub] = el.querySelectorAll('.line > span');
  value.textContent = c.value;
  sub.textContent = c.sub || '';
  sub.hidden = !c.sub;
}
const degrees = t => `${Math.round(t)}°`;

// One printer, as an instance of the glance.
class WorkshopPrinter extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;
    this._stage = root.querySelector('.stage');
    this._pic = root.querySelector('.pic');
    this._split = root.querySelector('.split');
    this._readouts = root.querySelector('.readouts');
    this._parts = Object.fromEntries([...root.querySelectorAll('[data-part]')].map(el => [el.dataset.part, el]));
    this.addEventListener('haag-instance', () => this._render());
    this.addEventListener('haag-alertrow', () => this._layout());
    this.addEventListener('haag-visible', () => this._visible());
    this.addEventListener('haag-dismissed', e => {
      if (/^(finished|failed):/.test(e.detail.key)) workshop?.dismiss(this._haag?.instance?.id);
    });
  }

  // ----- Glance API (docs/glances.md) -----

  setConfig(settings) {
    this._settings = settings;
    this._alertKey = undefined;   // its alert's settings may have changed
    this._render();
  }

  set haag(haag) {
    this._haag = haag;
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._render();
    else this._picture();
  }

  // Between glances: Overview's two wedges, the picture as the scene, the text in blocks.
  parts() {
    const a = this._haag.layout.angle, root = this.shadowRoot;
    return {
      wedges: [{ from: 180 - a, to: 360 - a, color: 'var(--sky)' }, { from: 360 - a, to: 540 - a, color: 'var(--home)' }],
      scene: [...root.querySelectorAll('.sky, .pic, .veil, .panel, .split')],
      text: [...root.querySelectorAll('.cluster:not(:has(.time))')],
      done: () => { if (this._owed) this._layout(); },
    };
  }

  connectedCallback() {
    this._resize = new ResizeObserver(() => { this._rebuild = true; this._layout(); });
    this._resize.observe(this._stage);
    document.fonts.ready.then(() => { if (this.isConnected) this._layout(); });
    requestAnimationFrame(() => requestAnimationFrame(() => this._stage.classList.add('animate')));
    this._tick();
  }

  disconnectedCallback() {
    this._resize?.disconnect();
    clearTimeout(this._minute);
    clearTimeout(this._snap);
  }

  // The time stand-in and the minutes left, on the minute.
  _tick() {
    clearTimeout(this._minute);
    if (this._haag) {
      this.shadowRoot.querySelector('[data-live="time"]').textContent = this._haag.clock.time;
      this.shadowRoot.querySelector('[data-live="ampm"]').textContent = this._haag.clock.period;
      this._render();
    }
    const now = Date.now();
    this._minute = setTimeout(() => this._tick(), MINUTE - now % MINUTE + 50);
  }

  _visible() {
    const on = !!this._haag?.visible;
    this._stage.classList.toggle('paused', !on);
    this._picture();
  }

  // ----- Text -----

  _render() {
    const d = this._haag?.instance?.data;
    if (!d || !this._hass) return;
    const now = Date.now(), done = ENDED.includes(d.state);
    const dot = { preparing: 'warm', heating: 'warm', printing: 'go', paused: '', finished: 'go', failed: 'warn' }[d.state] ?? '';
    const html = {
      printer: `<div class="t2 name">${esc(d.printer)}</div>`,
      state: `<div class="t2${d.state === 'failed' ? ' warn' : ''}"><span class="dot ${dot}"></span>${WORDS[d.state] ?? ''}</div>`,
      summary: d.summary ? `<div class="t3">${esc(d.summary)}</div>` : '',
      job: `<div class="t2 name">${esc(d.job || 'Print')}</div>${d.layers ? `<div class="t3">${d.layer > 0 ? `Layer ${d.layer} of ${d.layers}` : `${d.layers} layers`}</div>` : ''}`,
      time: done ? `<div class="t2">${d.state === 'finished' ? 'Ended' : 'Stopped'} ${d.ended ? formatTime(this._hass, d.ended, now) : ''}</div>`
        : d.ends ? `<div class="t2">${span(d.ends - now)} left</div><div class="t3">Ends ${formatTime(this._hass, d.ends, now)}</div>` : '',
    };
    // Temperatures, with the target while warming up; then the fans.
    const warming = t => t?.target > 0 && t.now < t.target - 3;
    const temp = (id, label, t, dim) => ({ id, label, value: degrees(t.now), sub: warming(t) ? `/ ${degrees(t.target)}` : '', dim });
    const temps = [
      ...d.nozzles.map(n => temp(`nozzle:${n.label}`, n.label, n, d.nozzles.length > 1 && !n.active)),
      d.bed && temp('bed', 'Bed', d.bed),
      d.chamber && temp('chamber', 'Chamber', { now: d.chamber.now }),
    ].filter(Boolean);
    const fans = d.fans.map(f => ({ id: `fan:${f.label}`, label: f.label, fan: true, on: f.on }));
    const rows = [temps, fans].filter(r => r.length);
    let changed = false;
    for (const [part, h] of Object.entries(html)) {
      if (this._parts[part].innerHTML !== h) { this._parts[part].innerHTML = h; changed = true; }
    }
    // A reading that comes or goes rebuilds the rows; a new value is written in place.
    const shape = JSON.stringify(rows.map(r => r.map(c => c.id)));
    if (shape !== this._shape) {
      this._shape = shape;
      this._rebuild = true;
      changed = true;
    }
    const values = JSON.stringify(rows);
    if (values !== this._values) {
      this._values = values;
      this._rows = rows;
      for (const c of rows.flat()) { const el = this._cells?.get(c.id); if (el) fill(el, c); }
      changed = true;
    }
    this._line(d);
    this._picture();
    this._alert(d);
    if (changed || !this._laidOut) this._layout();
  }

  // Its alert while its print is over (none for a cancelled one); a tap
  // dismisses it, and the printer leaves. Keyed by the print's end, so an earlier dismissal can't hide it.
  _alert(d) {
    const alerts = this._haag?.alerts;
    if (!alerts) return;
    const over = d.state === 'finished' || d.state === 'failed';
    const key = over && d.ended ? `${d.state}:${d.ended}` : null;
    if (key === this._alertKey) return;
    if (this._alertKey) alerts.delete(this._alertKey);
    this._alertKey = key;
    if (key) alerts.set(key, { level: d.state === 'failed' ? 'warning' : 'info', text: `${d.printer} ${d.state}`, dismiss: true });
  }

  // ----- The picture -----

  // The camera while on screen (snapshots, or live), else the print's
  // cover image or thumbnail (fetched again when the job changes), else a
  // drawn printer.
  _picture() {
    const d = this._haag?.instance?.data, hass = this._hass;
    if (!d || !hass) return;
    const url = path => hass.hassUrl ? hass.hassUrl(path) : path;
    const cam = d.camera && hass.states[d.camera], cover = d.cover && hass.states[d.cover];
    const camOk = cam && !['unavailable', 'unknown'].includes(cam.state) && cam.attributes.entity_picture;
    const coverOk = cover && !['unavailable', 'unknown'].includes(cover.state) && cover.attributes.entity_picture;
    const kind = camOk ? 'camera' : coverOk ? 'cover' : 'none';
    const live = this._settings?.camera === 'live', on = !!this._haag.visible;
    let src = null;
    if (kind === 'camera' && on) {
      src = live ? url(`${cam.attributes.entity_picture.replace('/camera_proxy/', '/camera_proxy_stream/')}&interval=${LIVE}`)
        : url(`${cam.attributes.entity_picture}&t=${Math.floor(Date.now() / SNAPSHOT)}`);
    } else if (kind === 'cover') src = url(`${cover.attributes.entity_picture}&t=${encodeURIComponent(`${cover.state} ${d.job}`)}`);
    // A snapshot keeps the last one until the next has loaded.
    if (kind !== this._kind || src !== this._src) {
      this._kind = kind;
      this._src = src;
      if (kind === 'none') {
        this._pic.innerHTML = '<span class="fallback"></span>';
        this._haag.icon(this._pic.firstChild, 'mdi:printer-3d-nozzle');
      } else if (src) {
        let img = this._pic.querySelector('img');
        if (!img) { this._pic.replaceChildren(img = document.createElement('img')); img.alt = ''; }
        img.className = kind;
        img.src = src;
      } else this._pic.replaceChildren();   // the camera, off screen: stop it
      this._placePicture();
    }
    clearTimeout(this._snap);
    if (kind === 'camera' && on && !live) this._snap = setTimeout(() => this._picture(), SNAPSHOT - Date.now() % SNAPSHOT + 50);
  }

  // Centered on the weather area: grown by a third of the short side so it
  // still covers the screen, its middle up and to the left.
  _placePicture() {
    const W = this._stage.clientWidth, H = this._stage.clientHeight, m = Math.min(W, H), grow = m / 3;
    Object.assign(this._pic.style, { left: `${-grow}px`, top: `${-grow}px`, width: `${W + grow}px`, height: `${H + grow}px` });
    const f = this._pic.querySelector('.fallback');
    if (f) {
      const size = m * .16;
      Object.assign(f.style, { width: `${size}px`, height: `${size}px`, left: `${W / 2 - m * .27 + grow - size / 2}px`, top: `${H / 2 - m * .3 + grow - size / 2}px` });
    }
  }

  // ----- Progress along the split -----

  // From the split's lower end, in the filament's color (a gradient for a
  // multicolor one), outlined so white or black filament shows.
  _line(d = this._haag?.instance?.data) {
    const W = this._stage.clientWidth, H = this._stage.clientHeight;
    if (!d || !W) return;
    const k = (W + H) / 2, a = k >= H ? [k - H, H] : [0, k], b = k >= W ? [W, k - W] : [k, 0];
    const f = Math.min(1, Math.max(0, (d.state === 'finished' ? 100 : d.progress ?? 0) / 100));
    const c = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], w = Math.min(W, H) * .009;
    const line = (cls, width, stroke = '') => `<line class="${cls}" x1="${a[0]}" y1="${a[1]}" x2="${c[0]}" y2="${c[1]}" stroke-width="${width}" ${stroke}/>`;
    const cols = d.colors ?? [], id = `fil-${this._haag.instance.id}`;
    const stroke = !cols.length ? 'style="stroke: var(--text-2)"' : cols.length > 1 ? `stroke="url(#${id})"` : `stroke="${cols[0]}"`;
    this._split.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this._split.innerHTML = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${a[0]}" y1="${a[1]}" x2="${c[0]}" y2="${c[1]}">
        ${cols.map((col, i) => `<stop offset="${i / Math.max(1, cols.length - 1)}" stop-color="${col}"/>`).join('')}</linearGradient></defs>
      <line class="track" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke-width="${w}"/>
      ${f > 0 ? line('edge', w + 2) + line('fill', w, stroke) : ''}`;
  }

  // ----- Layout -----

  _px(name) {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;width:var(${name})`;
    this._stage.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  }

  /*
    As Overview: the upper clusters stack up from the clock, the job down
    from the split, each one's nearest visible corner a gap from it; without
    the alert row the clock and the job sit side by side across the split.
    The readouts stack up from near the bottom, where the lower side is
    widest, a row too wide carrying on in another; where the job would come
    closer than a gap, they slide down along the split.
  */
  _layout() {
    const stage = this._stage;
    if (!this._haag || !stage.clientWidth || !this._rows) return;
    this._owed = this.hasAttribute('between');
    if (this._owed) return;
    this._laidOut = true;
    const W = stage.clientWidth, H = stage.clientHeight, m = Math.min(W, H), cy = H / 2;
    const l = this._lay ??= this._haag.layout.on(stage, { graphics: '.fan, .dot' });
    const gap = l.gap, cgap = this._px('--cluster-gap');
    const alert = this._haag.alertrow, half = alert.showing ? (alert.bottom - alert.top) / 2 : 0;
    const root = this.shadowRoot, time = root.querySelector('.time');
    const upper = [...root.querySelectorAll('.upper .cluster')].filter(el => el.childElementCount);
    const lower = [...root.querySelectorAll('.lower .cluster')].filter(el => el.childElementCount);
    this._line();
    this._placePicture();

    // The clock as tall as the job's first block, AM/PM top-aligned to it.
    time.style.fontSize = '';
    if (lower[0]) {
      const t = l.edges(upper[0]), f = l.edges(lower[0]);
      if (t.bottom > t.top && f.bottom > f.top) time.style.fontSize = `${parseFloat(getComputedStyle(time).fontSize) * (f.bottom - f.top) / (t.bottom - t.top)}px`;
    }
    const am = time.querySelector('.ampm');
    am.style.top = '0px';
    am.style.top = `${(l.baseline(time) - l.capHeight(time)) - (l.baseline(am) - l.capHeight(am))}px`;

    const place = (el, ty, target) => {
      const r = l.toSplit(el, ty, target);
      el.style.transform = `translate(${r.x}px, ${ty}px)`;
      return r;
    };
    let outStart = cy - half - cgap, inStart = cy + half + cgap;
    if (!alert.showing && lower[0]) {
      const ot = l.edges(upper[0]), it = l.edges(lower[0]), at = l.pair(upper[0], lower[0]);
      let best = null;
      for (let shift = 0; shift <= H / 2; shift += m * .005) {
        const { upper: t, lower: f } = at(shift);
        if (t.clamped || f.clamped) continue;
        if (!best || t.left > best.left) best = { left: t.left, tBottom: t.y + ot.bottom, fTop: f.y + it.top };
        if (t.left >= PAIR_LEFT_MARGIN * m) break;
      }
      if (best) { outStart = best.tBottom; inStart = best.fTop; }
    }

    let y = outStart;
    for (const el of upper) {
      const o = l.edges(el), ty = y - o.bottom, { x } = place(el, ty, -gap);
      if (el.contains(time)) {
        const base = el.getBoundingClientRect(), r = time.getBoundingClientRect();
        this._haag.clock.place({ x: x + r.left - base.left, y: ty + r.top - base.top,
          size: parseFloat(getComputedStyle(time).fontSize), ampm: this._px('--t2'), color: 'var(--n-text)' });
      }
      y = ty + o.top - cgap;
    }
    y = inStart;
    for (const el of lower) {
      const o = l.edges(el), ty = y - o.top;
      place(el, ty, gap);
      y = ty + o.bottom + cgap;
    }
    const jobEnd = y - cgap;

    // Readouts: rows of cells, cut where one would run off the screen.
    const rows = this._rows.map(r => [...r]);
    const build = () => {
      this._cells = new Map();
      this._readouts.replaceChildren(...rows.map(r => {
        const el = document.createElement('div');
        el.className = 'cluster fresh';
        el.innerHTML = `<div class="cells">${r.map(cellHTML).join('')}</div>`;
        r.forEach((c, i) => { const cel = el.querySelector('.cells').children[i]; this._cells.set(c.id, cel); fill(cel, c); });
        for (const f of el.querySelectorAll('.fan')) this._haag.icon(f, 'mdi:fan');
        return el;
      }));
      return [...this._readouts.children];
    };
    // Up from `bottom`: the readouts' visible top, or the row the screen's
    // edge stopped short.
    const stack = (els, bottom) => {
      let b = bottom;
      for (let i = els.length - 1; i >= 0; i--) {
        const o = l.edges(els[i]), ty = b - o.bottom;
        if (place(els[i], ty, gap).clamped) return { cut: i };
        b = ty + o.top - cgap;
      }
      return { top: b + cgap };
    };
    const bottom = m * READOUTS + (H - m) / 2;
    // The rows as they are, unless a reading came or went, the screen
    // changed, or a row no longer fits.
    let els = [...this._readouts.children], res = !this._rebuild && els.length ? stack(els, bottom) : { cut: 0 };
    if (res.cut !== undefined) {
      els = build();
      res = stack(els, bottom);
      for (let tries = 0; res.cut !== undefined && rows[res.cut].length > 1 && tries < 6; tries++) {
        const i = res.cut, half = Math.ceil(rows[i].length / 2);
        rows.splice(i, 1, rows[i].slice(0, half), rows[i].slice(half));
        els = build();
        res = stack(els, bottom);
      }
    }
    this._rebuild = false;
    const slide = res.top === undefined ? 0 : jobEnd + cgap - res.top;
    if (slide > 0) stack(els, bottom + slide);
    // New rows took their places without moving; later moves slide.
    const fresh = els.filter(el => el.classList.contains('fresh'));
    if (fresh.length) {
      this._readouts.offsetWidth;
      for (const el of fresh) el.classList.remove('fresh');
    }
  }
}

if (!customElements.get('haag-verkstad')) {
  customElements.define('haag-verkstad', WorkshopGlance);
  customElements.define('haag-verkstad-printer', WorkshopPrinter);
}
