/*
  Overview Glance: the time and date, outdoor conditions, one row per
  indoor floor, people, and the next appointments. Håg's default glance.
  License: GPL-3.0
*/

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

// Temperature icon: low at or below freezing, high at or above
// 85 °F / 29 °C, in the reading's own unit.
function thermometerIcon(value, unit) {
  if (typeof value !== 'number') return 'mdi:thermometer';
  const [low, high] = /C/i.test(unit) ? [0, 29] : [32, 85];
  return value <= low ? 'mdi:thermometer-low'
       : value >= high ? 'mdi:thermometer-high'
       : 'mdi:thermometer';
}

// Initials from a display name (fallback when there's no picture).
const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

// With no alert, the clock keeps at least this much room on its left
// (fraction of the screen's shorter side), so wide times (10:00–12:59) don't
// press against the edge.
const PAIR_LEFT_MARGIN = 0.105;

const APPT_COUNT = 4;                 // appointments shown
const APPT_REFRESH = 5 * 60 * 1000;   // refetch every 5 minutes
const APPT_DAYS = 30;                 // look-ahead window
const HOUR = 60 * 60 * 1000;
const SOON_AHEAD = 1 * HOUR;          // soon: starts within this...
const SOON_SINCE = 2 * HOUR;          // ...or started within this and still on
// Shown when nothing is scheduled in the window (not an error).
const APPT_EMPTY = { day: "Looks like it's YOU time", night: "Shouldn't you be asleep?" };

const DAY = 24 * 60 * 60 * 1000;

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
      events.map(e => ({ calendar, summary: e.summary || '', location: e.location || '', start: e.start, end: e.end,
                         allDay: isAllDay(e.start), startAt: toDate(e.start), endAt: toDate(e.end) })));
  };
  const events = await get(APPT_DAYS);
  return events.filter(e => e.endAt > now).sort((a, b) => a.startAt - b.startAt);
}

const STYLE = `
  /* Size unit, typeface and colour come from Håg. */
  :host {
    display: block;
    width: 100%;
    height: 100%;
    container-type: size;
  }

  /* Colours come from Håg's palette. */
  .stage {
    --line: var(--text-2);
    --gap: calc(2.5 * var(--u));          /* perpendicular distance from the split line to clusters */
    --cluster-gap: calc(2.7 * var(--u));  /* visible gap between clusters (see opticalEdges) */
    /* Medium text step. Also sizes AM/PM and the appointment stagger,
       which are defined as "the medium line". 5.5 makes date + conditions as
       tall as a floor block. */
    --t2: calc(5.5 * var(--u));
    /* Person icons: as tall as the medium digits, border included.
       An estimate until _fitPortraits() measures the real font. */
    --portrait: calc(.71 * var(--t2));
    --move: 700ms ease-in-out;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--home);
  }
  .stage.paused * { animation-play-state: paused !important; }

  /* Outdoor side: sky with a soft horizon glow, cut at the split. The
     weather background goes here. */
  .sky {
    position: absolute;
    inset: 0;
    background: radial-gradient(120% 90% at 30% 85%, var(--horizon), transparent 60%), var(--sky);
    -webkit-mask-image: linear-gradient(var(--haag-split), #000 50%, transparent 50%);
            mask-image: linear-gradient(var(--haag-split), #000 50%, transparent 50%);
  }

  /* Clusters: positioned by layout(). Content inside is left-aligned; the
     cluster as a whole is justified toward the split line. */
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

  /* Three text sizes. */
  .t1 { font-size: calc(14 * var(--u)); }
  .t2 { font-size: var(--t2); }
  .t3 { font-size: calc(2.8 * var(--u)); color: var(--text-2); }
  .outdoor .t3 { color: var(--text-2-out); }

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

  /* Icon box: a fixed .8em square holding HA's ha-icon. The box sets
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
  /* HVAC status on the floor's temperature icon. */
  .ico.heat { color: var(--coral); }
  .ico.cool { color: var(--seaglass); }
  .ico.fan  { color: var(--text-2); }
  .ico.off  { color: var(--text-2); opacity: .35; }
  .ico.err  { color: var(--coral); }
  /* HVAC motion: slow and gentle. Heat flickers from its base, cool
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
  /* Slot with no entity on this install: hidden, not labelled. */
  [data-slot][hidden] { display: none; }
  /* Bad or missing value: "Err", icon becomes an alert. */
  [data-slot].err > .ico { color: var(--coral); }

  .status-line { display: flex; align-items: center; }
  .status-line .people { margin-left: calc(2.4 * var(--u)); }
  /* People away sit before the outdoor temperature, mirroring the floor rows. */
  .status-line .people.away { margin-left: 0; margin-right: calc(2.4 * var(--u)); }
  .aq { display: flex; gap: calc(1 * var(--u)); }

  .appointments { display: flex; flex-direction: column; gap: calc(.4 * var(--u)); align-items: flex-start; }
  /* More than 24 hours away: day shown, plus a visual cue (placeholder). */
  .appt.later { opacity: .55; }
  /* Ongoing or within the hour: "breathes in", brightening on each breath
     at the same 6 s pace as the nobody-away frame. */
  .appt.soon { opacity: .7; animation: breathe-in 6s ease-in-out infinite; }
  @keyframes breathe-in {
    0%, 100% { opacity: .7; }
    50%      { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) { .appt.soon { animation: none; opacity: 1; } }
  .appt-error .ico { color: var(--coral); }   /* calendar error (calendar-alert icon) */

  /* Each appointment: icon, then its lines (the title, and the location
     when it's soon). Each later day steps in by one indent, following the
     diagonal. */
  .appt { display: flex; align-items: baseline; margin-left: calc(var(--indent, 0) * var(--t2)); }   /* one step = the medium line */
  .appt .lines { display: flex; flex-direction: column; min-width: 0; }
  /* Width is set per line by _capAppointments(): each line stops one gap
     short of the split, at its own height, and is cut off with "…". Only
     the soonest appointment may wrap to a second line first. */
  .appt .text, .appt .where {
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
  /* One rounded square per person: their HA picture, or initials. */
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
  /* Linked people together: one outline around the group. */
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
  /* Nobody away: one empty frame that slowly "breathes". */
  .person.empty { animation: breathe 6s ease-in-out infinite; }
  @keyframes breathe {
    0%, 100% { opacity: .25; }
    50%      { opacity: .8; }
  }
  @media (prefers-reduced-motion: reduce) { .person.empty { animation: none; opacity: .5; } }
`;


// Markup. Values marked data-live are filled in by the glance.
const TEMPLATE = `
  <div class="stage">
    <div class="sky"></div>

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

    <!-- One cluster per indoor floor, built from discovery. -->
    <section class="side indoor" aria-label="Indoor"></section>

  </div>
`;


class SinnesroGlance extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;
    this._measure = document.createElement('canvas').getContext('2d');
    this._stage = this.shadowRoot.querySelector('.stage');
    this.addEventListener('haag-alert', () => this._relayout());
    // Off screen: animations pause.
    this.addEventListener('haag-visible', () => this._stage.classList.toggle('paused', !this._haag.visible));
  }

  // ----- Glance API (docs/glances.md) -----

  setConfig(settings) {
    this._settings = settings;
  }

  set haag(haag) {
    this._haag = haag;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._tick();
      this._setup();
    } else {
      this._render();
      if (this._calendars && this._calendarStamp !== this._calendarStates()) this._refreshEvents();
    }
  }

  // Build from what Håg discovered.
  _setup() {
    const p = this._haag.providers;
    this._slots = p.outdoor;
    this._floors = p.floors;
    this._calendars = p.calendars;
    this._buildFloors();
    this._render(true);
    this._refreshEvents();
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

  // Space may have grown (alert hidden, bigger screen, new events): go back to
  // the full appointment count; _layout() trims it again if it doesn't fit.
  _resetApptLimit() {
    if ((this._apptLimit ?? APPT_COUNT) === APPT_COUNT) return;
    this._apptLimit = APPT_COUNT;
    this._apptKey = null;
    this._renderAppointments();
  }

  _relayout() {
    this._resetApptLimit();
    this._layout();
  }

  // ----- Lifecycle -----

  connectedCallback() {
    const root = this.shadowRoot;
    this._out = [...root.querySelectorAll('.outdoor .cluster')];
    this._in ??= [];   // filled by _buildFloors()
    this._live = Object.fromEntries([...root.querySelectorAll('[data-live]')].map(el => [el.dataset.live, el]));
    this._tick();
    if (this._slots) this._render(true);   // set up before it was on the page

    this._resize = new ResizeObserver(() => this._relayout());
    this._resize.observe(this._stage);
    // Layout measures text, so lay out again once the typeface has loaded.
    document.fonts.ready.then(() => { if (this.isConnected) this._relayout(); });
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

    // 12-hour clock with a separate AM/PM label.
    const parts = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).formatToParts(now);
    const pick = type => parts.find(p => p.type === type)?.value ?? '';
    this._live.time.textContent = `${pick('hour')}:${pick('minute')}`;
    this._live.ampm.textContent = pick('dayPeriod').toUpperCase();

    // Long-form date above the time.
    this._live.date.textContent = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }).format(now);

    this._renderAppointments();   // relative labels (within 24 h, soon) move with the clock
    this._layout();
    this._timer = setTimeout(() => this._tick(), 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  }

  // Next appointments, soonest at the bottom (nearest the center).
  // Within 24 hours: time only. Later: day and time, with the "later" cue.
  // Soon (see below): the breathing, and the location under the title.
  // None, or the calendars failed: an error line.
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
      rows = [{ cls: 'appt-error err', icon: APPT_ICONS.err, text: 'Err' }];          // calendars failed
    } else if (!upcoming.length) {
      rows = [{ cls: 'appt-empty', icon: APPT_ICONS.empty, text: APPT_EMPTY[this._haag.daylight ? 'day' : 'night'] }];   // nothing in the window
    } else {
      // Soon: starts within the hour, or started within the last 2 hours and
      // is still on. All-day events covering today are soon only when no
      // timed event is.
      const timedSoon = e => !e.allDay &&
        (e.startAt > now ? e.startAt - now <= SOON_AHEAD : now - e.startAt <= SOON_SINCE);
      const anyTimedSoon = this._events.some(e => e.endAt > now && timedSoon(e));
      const isSoon = e => timedSoon(e) || (e.allDay && e.startAt <= now && !anyTimedSoon);
      // Indent level = how many distinct days come before this one's day.
      const days = [...new Set(upcoming.map(e => dateKey(e.startAt)))];
      rows = upcoming.map(e => {
        const later = e.startAt - now > DAY;
        const soon = isSoon(e);
        const where = soon ? e.location.split(/[,(]/)[0].trim() : '';   // up to the first comma or "("
        let when;
        if (e.allDay) when = dateKey(e.startAt) === dateKey(now) ? 'Today' : day(e.startAt);
        else when = later ? `${day(e.startAt)} ${time(e.startAt)}` : time(e.startAt);
        return {
          // The soonest may wrap, unless its location takes the second line.
          cls: `appt${later ? ' later' : ''}${soon ? ' soon' : ''}${e === upcoming[0] && !where ? ' wrap' : ''}`,
          icon: later ? APPT_ICONS.later : APPT_ICONS.soon,
          text: `${when} ${e.summary}`,
          where,
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
      div.innerHTML = '<span class="ico"></span><span class="lines"><span class="text"></span></span>';
      this._haag.icon(div.firstElementChild, r.icon);
      // Event text is never parsed as HTML.
      div.querySelector('.text').textContent = r.text;
      if (r.where) {
        const where = document.createElement('span');
        where.className = 'where';
        where.textContent = r.where;
        div.lastElementChild.append(where);
      }
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
    const p = this._haag.providers;
    const root = this.shadowRoot;
    const q = name => root.querySelector(`[data-slot="${name}"]`);
    let changed = force;

    // A slot's icon: its own, or the alert icon when its value is bad.
    // Icons don't change any size, so they never need a re-layout.
    const icon = (slot, value, name) => this._haag.icon(slot.querySelector('.ico'), value === 'Err' ? ERR_ICON : name);
    const tempUnit = ref => p.unit(ref) || hass.config?.unit_system?.temperature || '';

    // Outdoor
    const { temperature, humidity, aqi } = this._slots;
    const outTemp = p.value(temperature);
    const outHum = p.value(humidity);
    const outAqi = p.value(aqi);
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
      const temp = p.value(f.slots.temp);
      changed = this._fill(fs('temp'), temp, v => `${v}°`) || changed;
      for (const k of f.aq) {
        const ref = f.slots[k];
        const value = p.value(ref);
        const fmt = k === 'hum' ? v => `${v}%` : v => `${v} ${p.unit(ref)}`.trim();
        changed = this._fill(fs(k), value, fmt) || changed;
        icon(fs(k), value, READING_ICONS[k]);
      }

      // The temperature's icon shows the HVAC status, or the
      // error icon when the temperature itself is bad. A floor with
      // no thermostat shows a thermometer.
      const box = fs('temp').querySelector('.ico');
      const status = temp === 'Err' ? 'err' : (p.hvac(f.climate) || '');
      if (box.dataset.status !== status) {
        box.className = `ico ${status}`;
        box.dataset.status = status;
      }
      this._haag.icon(box, status ? HVAC_ICONS[status] : thermometerIcon(temp, tempUnit(f.slots.temp)));
    });

    changed = this._renderPeople() || changed;

    if (changed) this._layout();
  }

  // Put each person's icon on their floor's row or before the outdoor
  // temperature (away). Rebuilds a spot only when who's in it changes.
  _renderPeople() {
    if (!this._floors) return false;
    const hass = this._hass;
    const where = this._haag.providers.locate();
    const groups = this._haag.providers.people.groups;
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
        (groups[a] - groups[b]) ||
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
        while (j < ids.length && groups[ids[j]] === groups[ids[i]]) j++;
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
  // relative to its top, so every gap looks the same.
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
          // toward the clock).
          const share = parseFloat(el.dataset.descender) || 0;
          bottom = Math.max(bottom, this._baselineY(el, true) + share * this._descent(el));
        }
        walk(el);
      }
    };
    walk(cluster);
    return { top: top - base, bottom: bottom - base };
  }

  // Before placing the appointments: let the soonest wrap only if its title
  // doesn't fit on one line. The block's left edge goes at `left` and its
  // visible bottom on `bottom`, which wrapping doesn't move;
  // `room(top, bottom)` is the furthest right a line may reach.
  _wrapSoonest(cluster, left, bottom, room) {
    const t = cluster.querySelector('.appt.wrap .text');
    if (!t) return;
    Object.assign(t.style, { maxWidth: 'none', whiteSpace: 'nowrap', display: 'inline-block' });
    const r = t.getBoundingClientRect(), base = cluster.getBoundingClientRect();
    const boxBottom = bottom + (r.bottom - base.top) - this._opticalEdges(cluster).bottom;
    const max = room(boxBottom - r.height, boxBottom) - (left + r.left - base.left);
    t.style.display = '';
    if (r.width > max) {                       // too long: wrap at the room it has
      t.style.whiteSpace = '';
      t.style.maxWidth = `${Math.max(0, max)}px`;
    }
  }

  // Each appointment line runs until it would come within one gap of the
  // split, at its own height, and is cut off there with "…". The block's
  // top-left is at (tx, ty).
  _capAppointments(cluster, tx, ty, room) {
    const base = cluster.getBoundingClientRect();
    for (const t of cluster.querySelectorAll('.appt .text, .appt .where')) {
      const r = t.getBoundingClientRect();
      const max = room(ty + r.top - base.top, ty + r.bottom - base.top) - (tx + r.left - base.left);
      t.style.maxWidth = `${Math.max(0, max)}px`;
    }
  }

  // Make person icons exactly as tall as the medium digits (cap top to
  // baseline, border included), and sit each row of them inside its
  // temperature's digits, so a row with people is no taller than one
  // without.
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
  // (cap top to baseline), so the two line up across the divide. The
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
    at s = +gap. Positions are clamped to the screen.
  */
  _layout() {
    const stage = this._stage;
    if (!stage || !stage.clientWidth || !this._haag) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    const cx = W / 2, cy = H / 2;
    const a = this._haag.layout.angle * Math.PI / 180, sa = Math.sin(a), ca = Math.cos(a);
    const gap = this._px('--gap'), cgap = this._px('--cluster-gap');
    const edge = Math.min(W, H) * 0.02;
    // With the alert row shown, clusters clear it by one gap. Without it, the
    // innermost block on each side (the time; the top floor) is centered on
    // the middle, so the two sit side by side across the line, and slide
    // past each other as the alert row opens.
    const alert = this._haag.alert;
    const alertOn = alert.showing;
    const half = alertOn ? (alert.bottom - alert.top) / 2 : 0;

    this._fitPortraits();
    this._fitTime();
    this._alignAmPm();

    // Horizontal position for a cluster at height ty, with its nearest
    // visible corner at signed distance `target` from the line. `clamped` is
    // true when the screen's edge stops it short, i.e. it would cross the line.
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
      const { tx } = solveX(el, ty, target, pick);
      el.style.transform = `translate(${tx}px, ${ty}px)`;
      return tx;
    };
    // The furthest right a line spanning top..bottom may reach on the
    // outdoor side and still stay one gap from the split.
    const room = (top, bottom) => Math.min(W - edge,
      ...[top, bottom].map(Y => cx + (-gap - ca * (Y - cy)) / sa));

    // Visible bottom of the first outdoor cluster, and visible top of the
    // first indoor cluster.
    let outStart = cy - half - cgap;
    let inStart = cy + half + cgap;
    if (!alertOn && this._out[0] && this._in[0]) {
      // No alert: the time and the top floor sit side by side at the same
      // height, centered on the middle if they fit there. If the
      // clock is too wide to clear the line that low, or to keep at least
      // PAIR_LEFT_MARGIN from the screen's left edge, the pair slides up only
      // as far as needed. If no height works, fall back to stacking from
      // the center.
      const ot = this._opticalEdges(this._out[0]);
      const it = this._in[0] && this._opticalEdges(this._in[0]);
      const tH = ot.bottom - ot.top, fH = it.bottom - it.top;
      const step = Math.min(W, H) * 0.005;
      // Slide the pair up the line until the clock clears the left margin.
      // The margin is a preference: if the top floor would hit the right edge
      // first, keep the furthest slide where both still sit on the line
      // (side by side wins over the margin, for square displays).
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
    let anchor = edge;                         // where appointment lines start
    for (const el of this._out) {
      // Appointments start at the first reading's left edge, rather than
      // following the line; each of their lines is cut at the split instead.
      const appts = !!el.querySelector('.appointments');
      if (appts) this._wrapSoonest(el, anchor, y, room);
      const o = this._opticalEdges(el);
      const ty = y - o.bottom;
      let tx;
      if (appts) {
        tx = anchor;
        el.style.transform = `translate(${tx}px, ${ty}px)`;
        this._capAppointments(el, tx, ty, room);
      } else {
        tx = place(el, ty, -gap, Math.max);
      }
      // Measured relative to the cluster, so a running transition doesn't skew it.
      const base = el.getBoundingClientRect();
      const inkTop = Math.min(...this._inkParts(el).map(p => p.getBoundingClientRect().top - base.top));
      outTop = Math.min(outTop, ty + inkTop);
      const reading = el.querySelector('.status-line .line > [data-slot]:not([hidden])');
      if (reading) anchor = tx + reading.getBoundingClientRect().left - base.left;
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
    // and lay out again.
    const shown = this.shadowRoot.querySelectorAll('.appointments > .appt').length;
    if (outTop < edge && shown > 1) {
      this._apptLimit = shown - 1;
      this._apptKey = null;
      this._renderAppointments();   // re-renders and calls _layout() again
    }
  }
}

if (!customElements.get('haag-sinnesro')) {
  customElements.define('haag-sinnesro', SinnesroGlance);
}
