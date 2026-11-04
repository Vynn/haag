/*
  Appliance Glance: washers, dryers, washer-dryers and dishwashers while
  they run, and for a while after a cycle ends. It asks for the screen
  while any machine has something to show.
  License: GPL-3.0
*/

// The drum, loaded with this file's cache tag (a relative import would drop it).
const drumUrl = new URL('./drum.js', import.meta.url);
drumUrl.search = new URL(import.meta.url).search;
const { Drum, DRUM_STYLE, KINDS } = await import(drumUrl.href);

const MINUTE = 60 * 1000;
const REST = 7200;   // seconds a machine rests after its cycle ends (setting `rest`)
const RUNS = 'haag-vitvaror';   // browser storage: each machine's run
const SHOWN = 3;     // machines at once; the others wait for a free part
const SOCK_ODDS = 1 / 25;

// A state from a value, by sets: { running: [...], ... }, else `fallback`.
const sorted = (sets, fallback) => v => Object.keys(sets).find(k => sets[k].includes(v)) ?? fallback;

/*
  Sources: how each integration describes a machine, from its own code.
  `find(keys, all, device)` gives the machines a device makes up, as
  [{ kind, part, name }] (part: what `read` and `main` need to tell a
  device's machines apart); `keys` are its enabled entities' keys, `all`
  those of every entity it has, disabled ones too (for integrations that
  store no type, which entities exist tells it). `main(part)` is the key
  whose last change dates the state; `read(get, part)` gives { state,
  phase, ends, progress } from `get(key)`, the state object of the
  device's entity with that key: its translation key; for integrations
  that set none, see keyOf. State: running, paused, done, error or idle;
  progress in percent. `door(entry)`: whether a registry entry is the
  machine's door (on or open: open).
*/
const LAUNDRY = { 'Washing machine': 'washer', 'Tumble dryer': 'dryer', 'Dishwasher': 'dishwasher', 'Washer dryer': 'washer_dryer' };
const binary = e => e.entity_id.startsWith('binary_sensor.');
const endsWith = (e, key) => binary(e) && String(e.unique_id).endsWith(key);
// A kind by a device's name, for integrations that store none.
const guess = device => {
  const s = `${device?.name_by_user ?? ''} ${device?.name ?? ''}`;
  return /dish/i.test(s) ? 'dishwasher' : /wash\w*[\s-]*(and\s+)?dry|combo/i.test(s) ? 'washer_dryer'
    : /dryer/i.test(s) ? 'dryer' : /wash/i.test(s) ? 'washer' : null;
};

const SOURCES = {
  // A washer and a dryer on one device: a washer-dryer. Flex washers have
  // an upper washer (`washer_sub`). Washers and washer-dryers share
  // `completion_time`, kept twice.
  smartthings: {
    find: keys => {
      const has = p => keys.has(`${p}_machine_state`);
      if (has('washer') && has('dryer')) return [{ kind: 'washer_dryer', part: 'combo' }];
      return [['washer', 'washer'], ['washer_sub', 'washer', 'Upper washer'], ['dryer', 'dryer'], ['dishwasher', 'dishwasher']]
        .filter(([part]) => has(part)).map(([part, kind, name]) => ({ part, kind, name }));
    },
    main: part => `${part === 'combo' ? 'washer' : part}_machine_state`,
    read: (get, part) => {
      // A washer-dryer reads as the half that's running or paused, else the one that finished.
      const halves = part === 'combo' ? ['washer', 'dryer'] : [part];
      const job = p => get(`${p}_job_state`)?.state, ended = p => ['finish', 'finished'].includes(job(p));
      const at = halves.find(p => ['run', 'pause'].includes(get(`${p}_machine_state`)?.state)) ?? halves.find(ended) ?? halves[0];
      const machine = get(`${at}_machine_state`)?.state;
      const times = part === 'washer_sub' ? [get('washer_sub_completion_time')] : [get('completion_time'), get('completion_time#2')];
      return {
        state: machine === 'run' ? 'running' : machine === 'pause' ? 'paused' : ended(at) ? 'done' : 'idle',
        phase: job(at) === 'none' ? null : job(at),
        ends: Math.max(...times.map(s => Date.parse(s?.state)).filter(Number.isFinite)),
        progress: get(`${at}_progress`)?.state,
      };
    },
    door: e => binary(e) && e.translation_key === 'door',
  },
  whirlpool: {
    find: keys => ['washer', 'dryer'].filter(k => keys.has(`${k}_state`)).map(kind => ({ kind, part: kind })),
    main: part => `${part}_state`,
    read: (get, part) => {
      const s = get(`${part}_state`)?.state;
      return {
        state: sorted({ running: ['running_maincycle', 'running_postcycle', 'cycle_filling', 'cycle_rinsing', 'cycle_sensing', 'cycle_soaking', 'cycle_spinning', 'cycle_washing'],
          paused: ['pause', 'delay_paused', 'smart_grid_pause'], done: ['complete'], error: ['hard_stop_or_error', 'exception', 'power_failure'] }, 'idle')(s),
        phase: s?.startsWith('cycle_') ? s.slice(6) : null,
        ends: get('end_time')?.state,
      };
    },
    door: e => endsWith(e, 'door'),
  },
  // No type stored: told by entities only some types get, else by name.
  // Ovens and coffee makers report the same way, so a device not told
  // apart is left out.
  home_connect: {
    find: (keys, all, device) => {
      if (!keys.has('operation_state')) return [];
      const kind = all.has('salt_lack') || all.has('rinse_aid_lack') ? 'dishwasher' : all.has('drying_process_finished') ? 'dryer'
        : guess(device) ?? (all.has('poor_i_dos_1_fill_level') ? 'washer' : null);
      return kind ? [{ kind }] : [];
    },
    main: () => 'operation_state',
    read: get => ({
      state: sorted({ running: ['run'], paused: ['pause'], done: ['finished'], error: ['error', 'actionrequired'] }, 'idle')(get('operation_state')?.state),
      ends: get('program_finish_time')?.state,
      progress: get('program_progress')?.state,
    }),
    door: e => e.entity_id.startsWith('sensor.') && e.translation_key === 'door',
  },
  // The registry's model names the type.
  miele: {
    find: (keys, all, device) => keys.has('status') && LAUNDRY[device?.model] ? [{ kind: LAUNDRY[device.model] }] : [],
    main: () => 'status',
    read: get => {
      const left = Number(get('remaining_time')?.state), phase = get('program_phase')?.state;
      return {
        state: sorted({ running: ['in_use'], paused: ['pause', 'rinse_hold'], done: ['program_ended'], error: ['failure'] }, 'idle')(get('status')?.state),
        phase: ['not_running', 'program_running', 'finished'].includes(phase) ? null : phase,
        ends: get('finish')?.state ?? (left > 0 ? Date.now() + left * MINUTE : null),   // minutes left
      };
    },
    door: e => endsWith(e, 'state_signal_door'),
  },
  // The registry's model ends with the type: "… (DEVICE_WASHER)". A
  // WashTower is two devices, the dryer's named so.
  lg_thinq: {
    find: (keys, all, device) => {
      const type = /\((DEVICE_\w+)\)$/.exec(device?.model ?? '')?.[1];
      const kind = { DEVICE_WASHER: 'washer', DEVICE_DRYER: 'dryer', DEVICE_DISH_WASHER: 'dishwasher', DEVICE_WASHCOMBO_MAIN: 'washer_dryer',
        DEVICE_WASHCOMBO_MINI: 'washer', DEVICE_WASHTOWER_WASHER: 'washer', DEVICE_WASHTOWER_DRYER: 'dryer',
        DEVICE_WASHTOWER: /dryer/i.test(device?.name ?? '') ? 'dryer' : 'washer' }[type];
      return kind && keys.has('current_state') ? [{ kind }] : [];
    },
    main: () => 'current_state',
    read: get => {
      const s = get('current_state')?.state;
      return {
        state: sorted({ done: ['end', 'complete', 'done', 'running_end'], paused: ['pause', 'paused', 'rinse_hold'], error: ['error', 'power_fail'],
          idle: ['power_off', 'power_on', 'initial', 'initializing', 'standby', 'sleep', 'reservation', 'reserved', 'preference', 'macrosector', 'setdate', 'cancel'] }, 'running')(s),
        phase: s,
        ends: get('remain')?.state,
      };
    },
    door: e => endsWith(e, 'door_state'),
  },
  // Custom: no translation keys. The device's main sensor carries the run
  // as attributes; its run-completed sensor dates the end. The model ends
  // with the type, "… (WASHER)"; a WashTower's dryer hangs off its washer.
  smartthinq_sensors: {
    find: (keys, all, device) => {
      const type = /\((\w+)\)$/.exec(device?.model ?? '')?.[1];
      const kind = { WASHER: 'washer', DRYER: 'dryer', DISHWASHER: 'dishwasher', TOWER_WASHER: 'washer', TOWER_DRYER: 'dryer',
        TOWER_WASHERDRYER: device?.via_device_id ? 'dryer' : 'washer' }[type];
      return kind && keys.has('main') ? [{ kind }] : [];
    },
    main: () => 'run_completed',
    read: get => {
      const a = get('main')?.attributes || {};
      const [h, m] = String(a.remain_time ?? '').split(':').map(Number);
      return {
        state: a.error_state === 'on' ? 'error' : a.run_completed === 'on' ? 'done' : get('main')?.state === 'on' ? 'running' : 'idle',
        phase: ['-', ''].includes(a.run_state) ? null : a.run_state,
        ends: h * 60 + m > 0 ? Date.now() + (h * 60 + m) * MINUTE : null,
      };
    },
    door: e => endsWith(e, 'door_open'),
  },
  // Custom: no translation keys; entities by their own names ("Wash
  // status" → wash_status).
  subzero: {
    find: keys => keys.has('wash_status') ? [{ kind: 'dishwasher' }] : [],
    main: () => 'wash_status',
    read: get => {
      const s = get('wash_status')?.state;
      return {
        state: sorted({ running: ['Running', 'Drying'], done: ['Complete'], error: ['Error'] }, 'idle')(s),
        phase: s === 'Drying' ? 'drying' : null,
        ends: get('wash_cycle_end')?.state,
      };
    },
    door: e => endsWith(e, 'door_ajar'),
  },
};

// The entity keys a source reads: translation keys; for SmartThinQ the
// main sensor (the one with the run's attributes) and the run-completed
// sensor; for Sub-Zero the entity's own name.
function keyOf(e, hass) {
  if (e.platform === 'subzero') return e.entity_id.startsWith('sensor.') || binary(e)
    ? (e.original_name || '').toLowerCase().replace(/\W+/g, '_') : null;
  if (e.platform !== 'smartthinq_sensors') return e.translation_key;
  if (endsWith(e, 'run_completed')) return 'run_completed';
  return e.entity_id.startsWith('sensor.') && 'run_completed' in (hass.states[e.entity_id]?.attributes || {}) ? 'main' : null;
}

// Every machine: { id, platform, kind, part, name, main, door, entities:
// { key: entity_id } }. A key a device has twice is kept as key#2.
function findMachines(hass, entities, devices) {
  const byId = new Map(devices.map(d => [d.id, d]));
  const groups = new Map();
  for (const e of entities) {
    const source = SOURCES[e.platform];
    if (!source || !e.device_id) continue;
    const g = groups.get(e.device_id) ?? { platform: e.platform, entities: {}, all: new Set() };
    groups.set(e.device_id, g);
    if (e.translation_key) g.all.add(e.translation_key);
    if (e.disabled_by || !hass.states[e.entity_id]) continue;
    if (source.door(e)) g.door = e.entity_id;
    const key = keyOf(e, hass);
    if (key) g.entities[key in g.entities ? `${key}#2` : key] = e.entity_id;
  }
  return [...groups].flatMap(([id, g]) => {
    const source = SOURCES[g.platform], d = byId.get(id);
    return source.find(new Set(Object.keys(g.entities)), g.all, d).map(({ kind, part = null, name }) => ({
      id: `${id}:${part ?? ''}`, platform: g.platform, kind, part, main: source.main(part), door: g.door,
      name: name ?? (d?.name_by_user || d?.name || ''), entities: g.entities }));
  });
}

function readMachine(hass, m) {
  const get = key => hass.states[m.entities[key]];
  const r = SOURCES[m.platform].read(get, m.part);
  const ends = r.ends == null ? null : typeof r.ends === 'number' ? r.ends : Date.parse(r.ends);
  return { ...r, ends: Number.isFinite(ends) ? ends : null, progress: Number.isFinite(Number(r.progress)) ? Number(r.progress) : null,
    changed: Date.parse(get(m.main)?.last_changed) || Date.now() };
}

// What's drawn for a phase, by the words integrations use; else the
// kind's first.
const PHASES = [[/spin|drain|centrifug/i, 'spin'], [/rins/i, 'rinse'], [/cool|crease|wrinkle|fluff/i, 'cool'], [/dry/i, 'dry']];
const DRAWN = { washer: ['wash', 'rinse', 'spin'], washer_dryer: ['wash', 'rinse', 'spin', 'dry', 'cool'], dryer: ['dry', 'cool'], dishwasher: ['wash', 'rinse', 'dry'] };
const drawPhase = (kind, phase) => {
  const p = PHASES.find(([re]) => re.test(phase ?? ''))?.[1];
  return DRAWN[kind].includes(p) ? p : DRAWN[kind][0];
};

// How pink a red sock run's load is: with progress (a washer-dryer washes
// in about the first half of its cycle), else by phase; fully pink when
// the cycle ends, and while drying.
const pinkness = m => m.status === 'ended' || ['dry', 'cool'].includes(m.phase) ? 1
  : m.progress != null ? Math.min(1, m.progress / (m.kind === 'washer_dryer' ? .5 : 1))
  : { wash: .3, rinse: .6, spin: .85 }[m.phase] ?? 0;

/*
  A machine's run, kept in the browser: when it started (`since`), when
  its cycle ended (`ended`), whether its rest is over (`cleared`), its
  red sock, what it last drew (`phase`) and the state last seen. A cycle
  ends on the integration's finished state, or when a running machine
  goes idle or off. Seen for the first time, the state's last change
  stands in for now.
*/
function track(rec, r, phase, now) {
  const at = rec.last === undefined ? r.changed : now;
  if (['running', 'paused', 'error'].includes(r.state)) {
    if (!rec.since || rec.ended) {
      for (const k in rec) delete rec[k];
      Object.assign(rec, { since: at, sock: Math.random() < SOCK_ODDS });
    }
    rec.phase = phase;
  } else if (r.state === 'done') {
    rec.ended ??= at;
    rec.since ??= at;
  } else if (['running', 'paused'].includes(rec.last) && !rec.ended) rec.ended = at;
  rec.last = r.state;
}

const loadRuns = () => { try { return JSON.parse(localStorage.getItem(RUNS)) || {}; } catch { return {}; } };

// Times follow HA's time format and zone, with the weekday when it isn't today.
function formatTime(hass, t, now = Date.now()) {
  const timeZone = hass?.config?.time_zone, style = hass?.locale?.time_format;
  const locale = style === 'system' ? undefined : hass?.locale?.language || hass?.language;
  const day = d => new Intl.DateTimeFormat('en-CA', { timeZone }).format(d);   // YYYY-MM-DD
  const options = { hour: 'numeric', minute: '2-digit', ...{ 12: { hour12: true }, 24: { hourCycle: 'h23' } }[style], timeZone };
  if (day(t) !== day(now)) options.weekday = 'short';
  return new Intl.DateTimeFormat(locale, options).format(t);
}
// "3 min", "2 h", rounded down.
const duration = ms => { const m = Math.floor(ms / MINUTE); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

class ApplianceGlance extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${DRUM_STYLE}</style><div class="stage"><svg aria-hidden="true"></svg><div class="labels"></div></div>`;
    this._stage = root.querySelector('.stage');
    this._runs = loadRuns();
    this._drum = new Drum(this._stage, {
      band: () => this._haag?.alertrow ?? { showing: false, top: 0, bottom: 0 },
      gap: () => (this._lay ??= this._haag.layout.on(this._stage)).gap,
    });
    // Off screen, the drum stops; the alert row moves the text.
    this.addEventListener('haag-visible', () => this._drum.setVisible(this._haag.visible));
    this.addEventListener('haag-alertrow', () => this._drum.setRow(this._haag.alertrow.showing));
    // A dismissed "cycle ended" ends that machine's rest.
    this.addEventListener('haag-dismissed', e => {
      const [alert, ...id] = e.detail.key.split(':'), rec = this._runs[id.join(':')];
      if (alert !== 'ended' || !rec) return;
      rec.cleared = true;
      this._save();
      this._update();
    });
  }

  // ----- Glance API (docs/glances.md) -----

  setConfig(settings) {
    this._settings = settings;
    this._update();
  }

  set haag(haag) {
    this._haag = haag;
    this._drum.setVisible(haag.visible);
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._finding) this._finding = this._find();
    this._update();
  }

  connectedCallback() {
    this._resize = new ResizeObserver(() => this._drum.render());
    this._resize.observe(this._stage);
    // Text is measured, so draw again once the typeface has loaded.
    document.fonts.ready.then(() => { if (this.isConnected) this._drum.render(); });
  }

  disconnectedCallback() {
    this._resize?.disconnect();
    clearTimeout(this._timer);
    this._drum.setVisible(false);
  }

  // Registries once, as the core reads them (any logged-in user can).
  async _find() {
    try {
      const [entities, devices] = await Promise.all(['entity', 'device']
        .map(t => this._hass.callWS({ type: `config/${t}_registry/list` })));
      this._machines = findMachines(this._hass, entities, devices);
    } catch (err) {
      console.error("Håg: Appliance Glance couldn't read Home Assistant's setup", err);
      this._machines = [];
    }
    this._update();
  }

  // On overall (haag.easterEggs) and not turned off here.
  _eggs() {
    return this._haag?.easterEggs !== false && this._settings?.easter_eggs !== false;
  }

  // What each machine shows: running, paused or an error while it lasts;
  // after its cycle ends, a rest of `rest` seconds. Up to three at once,
  // the first to start.
  _update() {
    if (!this._machines || !this._hass || !this._haag) return;
    const now = Date.now(), rest = (this._settings?.rest ?? REST) * 1000;
    const before = JSON.stringify(this._runs), shown = [];
    for (const mc of this._machines) {
      const r = readMachine(this._hass, mc), rec = this._runs[mc.id] ??= {};
      track(rec, r, drawPhase(mc.kind, r.phase), now);
      // The door opening after the cycle ends ends the rest.
      const door = this._door(mc);
      if (rec.ended && !rec.cleared && ['on', 'open'].includes(door?.state) && Date.parse(door.last_changed) > rec.ended) rec.cleared = true;
      const status = ['running', 'paused', 'error'].includes(r.state) ? r.state
        : rec.ended && !rec.cleared && now < rec.ended + rest ? 'ended' : null;
      if (status) shown.push({ mc, r, rec, status });
    }
    for (const id in this._runs) if (!this._machines.some(m => m.id === id)) delete this._runs[id];
    if (JSON.stringify(this._runs) !== before) this._save();
    this._alert(shown);

    shown.sort((a, b) => a.rec.since - b.rec.since);
    const list = shown.slice(0, SHOWN).map(s => this._machine(s, now));
    const sig = JSON.stringify(list);
    if (sig !== this._sig) {
      this._sig = sig;
      this._drum.show(list);
    }
    if (!!shown.length !== this._wants) {
      this._wants = !!shown.length;
      if (this._wants) this._haag.request();
      else this._haag.release();
    }
    // Minutes change on the minute; a rest ends on its own time.
    clearTimeout(this._timer);
    const next = Math.min(now - now % MINUTE + MINUTE, ...shown.filter(s => s.status === 'ended').map(s => s.rec.ended + rest));
    if (shown.length) this._timer = setTimeout(() => this._update(), next - now + 50);
  }

  // A machine's door: one set in `doors` (any of its entities → a contact
  // sensor), else its integration's own.
  _door(mc) {
    const doors = this._settings?.doors ?? {};
    const id = Object.values(mc.entities).map(e => doors[e]).find(Boolean) ?? mc.door;
    return id ? this._hass.states[id] : null;
  }

  _save() {
    try { localStorage.setItem(RUNS, JSON.stringify(this._runs)); } catch {}
  }

  // Alerts: a cycle ended (a tap dismisses it, ending the rest) and
  // errors, for every machine, shown or waiting. Named by kind, or by
  // device for two of a kind.
  _alert(shown) {
    const want = new Map();
    for (const { mc, status } of shown) {
      const name = mc.name && this._machines.some(m => m !== mc && m.kind === mc.kind) ? mc.name : KINDS[mc.kind];
      if (status === 'ended') want.set(`ended:${mc.id}`, { level: 'info', text: `${name} cycle ended`, dismiss: true });
      if (status === 'error') want.set(`error:${mc.id}`, { level: 'warning', text: `${name} error` });
    }
    for (const key of this._alerts ?? []) if (!want.has(key)) this._haag.alerts.delete(key);
    for (const [key, a] of want) this._haag.alerts.set(key, a);
    this._alerts = new Set(want.keys());
  }

  // A machine as the drum takes it.
  _machine({ mc, r, rec, status }, now) {
    const kind = mc.kind, phase = status === 'ended' ? rec.phase ?? DRAWN[kind][0] : drawPhase(kind, r.phase);
    const running = status === 'running' || status === 'paused';
    const m = { key: mc.id, kind, name: mc.name, since: rec.since, status, phase,
      progress: running && r.progress != null ? r.progress / 100 : null };
    m.pink = this._eggs() && rec.sock && (kind === 'washer' || kind === 'washer_dryer') ? pinkness(m) : null;
    const left = running && r.ends ? ` · ${Math.max(0, Math.round((r.ends - now) / MINUTE))} min left` : '';
    m.lines = {
      running: [`${r.phase ? cap(String(r.phase).replace(/_/g, ' ')) : 'Running'}${left}`, r.ends ? `Ends at ${formatTime(this._hass, r.ends, now)}` : ''],
      paused: [`Paused${left}`, ''],
      ended: ['Cycle ended', now - rec.ended < MINUTE ? 'Just now' : `${duration(now - rec.ended)} ago`],
      error: ['Error', 'Check the machine'],
    }[status];
    return m;
  }
}

customElements.define('haag-vitvaror', ApplianceGlance);
