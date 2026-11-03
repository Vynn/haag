/*
  Appliance Glance (skeleton): washers, dryers and dishwashers while they
  run, and loads waiting to be emptied. It asks for the screen while any machine has
  something to show. The layout is a placeholder until its design.
  License: GPL-3.0
*/

const MINUTE = 60 * 1000;

// What the glance shows for each state, and whether it wants the screen.
const STATES = {
  running: { label: 'Running', wants: true },
  paused:  { label: 'Paused', wants: true },
  done:    { label: 'Done', wants: true },
  error:   { label: 'Error', wants: true },
  idle:    { label: 'Idle', wants: false },
};

// A state from a value, by sets: { running: [...], ... }, else `fallback`.
const sorted = (sets, fallback) => v => Object.keys(sets).find(k => sets[k].includes(v)) ?? fallback;

/*
  Sources: how each integration describes a machine, drafted from its own
  code. `find(keys)` gives the kinds a device's entities make up (a
  device may be one machine, or a washer and dryer pair); `read(get,
  kind)` gives { state, phase, ends, progress } from `get(key)`, the state
  object of the device's entity with that key (its translation key, or
  for integrations that set none, the end of its unique ID).
*/
const SOURCES = {
  smartthings: {
    find: keys => ['washer', 'dryer'].filter(k => keys.has(`${k}_machine_state`)),
    read: (get, kind) => {
      const machine = get(`${kind}_machine_state`)?.state, job = get(`${kind}_job_state`)?.state;
      return {
        state: machine === 'run' ? 'running' : machine === 'pause' ? 'paused' : ['finish', 'finished'].includes(job) ? 'done' : 'idle',
        phase: job === 'none' ? null : job,
        ends: get('completion_time')?.state,
        progress: get(`${kind}_progress`)?.state,
      };
    },
  },
  whirlpool: {
    find: keys => ['washer', 'dryer'].filter(k => keys.has(`${k}_state`)),
    read: (get, kind) => {
      const s = get(`${kind}_state`)?.state;
      return {
        state: sorted({ done: ['complete'], paused: ['pause', 'delay_paused', 'smart_grid_pause'],
          error: ['hard_stop_or_error', 'exception', 'power_failure'],
          idle: ['standby', 'setting', 'system_initialize', 'delay_countdown', 'smart_delay', 'demo_mode'] }, 'running')(s),
        phase: s?.startsWith('cycle_') ? s.slice(6) : null,
        ends: get('end_time')?.state,
      };
    },
  },
  home_connect: {
    find: keys => keys.has('operation_state') ? [null] : [],
    read: get => ({
      state: sorted({ running: ['run'], paused: ['pause'], done: ['finished'], error: ['error', 'actionrequired'] }, 'idle')(get('operation_state')?.state),
      ends: get('program_finish_time')?.state,
      progress: get('program_progress')?.state,
    }),
  },
  miele: {
    find: keys => keys.has('status') ? [null] : [],
    read: get => {
      const left = Number(get('remaining_time')?.state);
      return {
        state: sorted({ running: ['in_use'], paused: ['pause', 'rinse_hold'], done: ['program_ended'], error: ['failure'] }, 'idle')(get('status')?.state),
        phase: get('program_phase')?.state,
        ends: left > 0 ? Date.now() + left * MINUTE : null,   // minutes left
      };
    },
  },
  lg_thinq: {
    find: keys => keys.has('current_state') && !keys.has('current_dish_washing_course') ? [null] : [],
    read: get => {
      const s = get('current_state')?.state;
      return {
        state: sorted({ done: ['end', 'complete', 'done'], paused: ['pause', 'paused', 'rinse_hold'], error: ['error', 'power_fail'],
          idle: ['power_off', 'power_on', 'initial', 'standby', 'sleep', 'reservation', 'reserved'] }, 'running')(s),
        phase: s,
        ends: get('remain')?.state,
      };
    },
  },
  // Custom (HACS): no translation keys; the device's main sensor carries
  // the run as attributes.
  smartthinq_sensors: {
    find: keys => keys.has('main') ? [null] : [],
    read: get => {
      const a = get('main')?.attributes || {};
      const [h, m] = String(a.remain_time ?? '').split(':').map(Number);
      return {
        state: a.error_state === 'on' ? 'error' : a.run_completed === 'on' ? 'done' : get('main')?.state === 'on' ? 'running' : 'idle',
        phase: a.run_state,
        ends: h * 60 + m > 0 ? Date.now() + (h * 60 + m) * MINUTE : null,
      };
    },
  },
};

// Custom (HACS): Sub-Zero, Wolf and Cove appliances. No translation keys;
// entities by their own names ("Wash status" → wash_status).
SOURCES.subzero = {
  find: keys => keys.has('wash_status') ? ['dishwasher'] : [],
  read: get => {
    const s = get('wash_status')?.state;
    return {
      state: sorted({ running: ['Running', 'Drying'], done: ['Complete'], error: ['Error'] }, 'idle')(s),
      phase: s === 'Drying' ? 'drying' : get('wash_cycle')?.state,
      ends: get('wash_cycle_end')?.state,
    };
  },
};

// The entity keys a source reads: translation keys; for SmartThinQ the
// main sensor (the one with the run's attributes); for Sub-Zero the
// entity's own name.
function keyOf(e, hass) {
  if (e.platform === 'subzero') return e.entity_id.startsWith('sensor.') || e.entity_id.startsWith('binary_sensor.')
    ? (e.original_name || '').toLowerCase().replace(/\W+/g, '_') : null;
  if (e.platform !== 'smartthinq_sensors') return e.translation_key;
  return e.entity_id.startsWith('sensor.') && 'run_completed' in (hass.states[e.entity_id]?.attributes || {}) ? 'main' : null;
}

// Every machine: { id, platform, kind, name, entities: { key: entity_id } }.
function findMachines(hass, entities, devices) {
  const name = Object.fromEntries(devices.map(d => [d.id, d.name_by_user || d.name || '']));
  const groups = new Map();
  for (const e of entities) {
    if (!SOURCES[e.platform] || !e.device_id || e.disabled_by || !hass.states[e.entity_id]) continue;
    const key = keyOf(e, hass);
    if (!key) continue;
    const g = groups.get(e.device_id) ?? { platform: e.platform, entities: {} };
    g.entities[key] = e.entity_id;
    groups.set(e.device_id, g);
  }
  return [...groups].flatMap(([id, g]) => SOURCES[g.platform].find(new Set(Object.keys(g.entities)))
    .map(kind => ({ id: `${id}:${kind ?? ''}`, platform: g.platform, kind, name: name[id], entities: g.entities })));
}

function readMachine(hass, m) {
  const get = key => hass.states[m.entities[key]];
  const r = SOURCES[m.platform].read(get, m.kind);
  const ends = r.ends == null ? null : typeof r.ends === 'number' ? r.ends : Date.parse(r.ends);
  return { ...r, ends: Number.isFinite(ends) ? ends : null, progress: Number.isFinite(Number(r.progress)) ? Number(r.progress) : null };
}

const STYLE = `
  :host { display: block; background: var(--home); color: var(--text); }
  /* Placeholder: one line per machine, above the alert row. */
  .machines {
    position: absolute; inset: 0 0 55%;
    display: flex; flex-direction: column; justify-content: flex-end; align-items: center;
    gap: calc(1.5 * var(--u)); padding: calc(4 * var(--u));
  }
  .machine { font-size: calc(5.5 * var(--u)); }
  .machine .more { font-size: calc(3.2 * var(--u)); color: var(--text-2); }
`;

class ApplianceGlance extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `<style>${STYLE}</style><div class="machines"></div>`;
  }

  setConfig(settings) { this._settings = settings; }
  set haag(haag) { this._haag = haag; }

  set hass(hass) {
    this._hass = hass;
    if (!this._finding) this._finding = this._find();
    this._render();
  }

  disconnectedCallback() { clearTimeout(this._timer); }

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
    this._render();
  }

  _render() {
    if (!this._machines || !this._haag) return;
    const now = Date.now();
    const shown = this._machines.map(m => ({ m, r: readMachine(this._hass, m) })).filter(({ r }) => STATES[r.state]?.wants);
    if (!!shown.length !== this._wants) {
      this._wants = !!shown.length;
      if (this._wants) this._haag.request();
      else this._haag.release();
    }
    this.shadowRoot.querySelector('.machines').replaceChildren(...shown.map(({ m, r }) => {
      const line = document.createElement('div');
      line.className = 'machine';
      const left = r.ends && r.state === 'running' ? Math.max(0, Math.round((r.ends - now) / MINUTE)) : null;
      line.textContent = `${m.kind ? m.kind[0].toUpperCase() + m.kind.slice(1) : m.name} · ${STATES[r.state].label}`;
      const more = [r.phase && r.state === 'running' ? r.phase.replace(/_/g, ' ') : null,
        left !== null ? `${left} min left` : null, r.progress !== null ? `${Math.round(r.progress)}%` : null].filter(Boolean);
      if (more.length) {
        const span = document.createElement('div');
        span.className = 'more';
        span.textContent = more.join(' · ');
        line.append(span);
      }
      return line;
    }));
    // Minutes left change on the minute.
    clearTimeout(this._timer);
    if (shown.length) this._timer = setTimeout(() => this._render(), MINUTE - now % MINUTE + 50);
  }
}

customElements.define('haag-vitvaror', ApplianceGlance);
