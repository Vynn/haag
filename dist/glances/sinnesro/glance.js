/*
  Overview glance: the time and date, outdoor conditions, one row per
  indoor floor, people, and the next appointments. Håg's default glance.
  License: GPL-3.0
*/

// The weather background, loaded with this file's cache tag (a relative
// import would drop it). If it fails, the glance shows a plain sky.
let weather = null;
try {
  const url = new URL('./weather.js', import.meta.url);
  url.search = new URL(import.meta.url).search;
  weather = await import(url.href);
} catch (err) {
  console.error('Håg: the weather background failed to load', err);
}

const ERR_ICON = 'mdi:alert';
// Idle has no icon of its own: it shows the thermometer.
const HVAC_ICONS = {
  heat: 'mdi:fire', cool: 'mdi:snowflake', fan: 'mdi:fan',
  off: 'mdi:power-off', err: ERR_ICON,
};
const READING_ICONS = {
  hum: 'mdi:water-percent', co2: 'mdi:sprout', pm25: 'mdi:molecule',
  radon: 'mdi:radioactive', co: 'mdi:molecule-co', aqi: 'mdi:leaf',
};
const APPT_ICONS = {
  soon: 'mdi:calendar-clock', later: 'mdi:calendar-arrow-right',
  err: 'mdi:calendar-alert', empty: 'mdi:party-popper',
};

// Each icon's drawn top and bottom in MDI's 24-unit grid, measured from
// @mdi/js 7.4.47. Re-measure if HA's icons change.
const ICON_INK = {
  'mdi:alert': [2, 21], 'mdi:fire': [3, 21], 'mdi:snowflake': [2, 22],
  'mdi:fan': [2, 22], 'mdi:power-off': [3, 21],
  'mdi:thermometer': [2, 22], 'mdi:thermometer-low': [2, 22], 'mdi:thermometer-high': [2, 22],
  'mdi:water-percent': [3.26, 20], 'mdi:sprout': [3.94, 22], 'mdi:molecule': [3, 21],
  'mdi:radioactive': [2.3, 20.9], 'mdi:molecule-co': [7, 17], 'mdi:leaf': [3, 22],
  'mdi:calendar-clock': [1, 23], 'mdi:calendar-arrow-right': [1, 21],
  'mdi:calendar-alert': [1, 21], 'mdi:party-popper': [1.45, 22],
};
const FIGURE = .719 * 30;   // Open Sans digit height, in grid units (1em = 30)

// Fit an icon to the digits: its drawn part runs from the baseline to the
// digit tops. The icon fills its 24-unit box, with the baseline 22.5 units
// down, and scales about its center; the box itself, which layout
// measures, never changes. Unlisted icons draw as they are.
function fitIcon(box, name) {
  const icon = box.firstElementChild, ink = ICON_INK[name];
  if (!icon) return;
  if (!ink) { icon.style.scale = icon.style.translate = ''; return; }
  const [top, bottom] = ink;
  const s = FIGURE / (bottom - top);
  icon.style.scale = s.toFixed(3);
  icon.style.translate = `0 ${((10.5 - s * (bottom - 12)) / 24 * 100).toFixed(2)}%`;
}

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
// (fraction of the screen's shorter side), so wide times (10:00–12:59, or any
// two-digit hour on 24 hours) don't press against the edge.
const PAIR_LEFT_MARGIN = 0.028;

const APPT_COUNT = 4;                 // appointments shown (setting `appointments`)
const APPT_REFRESH = 5 * 60 * 1000;   // refetch every 5 minutes
const APPT_DAYS = 30;                 // look-ahead window (setting `days`)
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

// Times follow HA's time format setting: 12 or 24 hours, or the locale's
// own (the browser's, for "system").
const timeLocale = hass => hass?.locale?.time_format === 'system' ? undefined : hass?.language || navigator.language;
const hours = hass => ({ 12: { hour12: true }, 24: { hourCycle: 'h23' } })[hass?.locale?.time_format];   // h23: 0:00, not 24:00

/**
 * Upcoming events across the given calendars, soonest first, including ones
 * in progress, over the next `days` days.
 */
async function fetchEvents(hass, calendars, days = APPT_DAYS) {
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
  const events = await get(days);
  return events.filter(e => e.endAt > now).sort((a, b) => a.startAt - b.startAt);
}

const STYLE = `
  /* Size unit, typeface and color come from Håg. */
  :host {
    display: block;
    width: 100%;
    height: 100%;
    container-type: size;
  }

  /* Colors come from Håg's palette. */
  .stage {
    --line: var(--text-2);
    --cluster-gap: calc(2.7 * var(--u));  /* visible gap between clusters (haag.layout edges); the split's gap is Håg's */
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
  /* Between glances Håg paints the sky and home colors; the glow stays here. */
  :host([between]) .stage { background: none; }
  :host([between]) .sky { background: radial-gradient(120% 90% at 30% 85%, var(--horizon), transparent 60%); }

  /* Outdoor side: sky with a soft horizon glow, cut at the split. The
     weather draws over it. */
  .sky {
    position: absolute;
    inset: 0;
    background: radial-gradient(120% 90% at 30% 85%, var(--horizon), transparent 60%), var(--sky);
    -webkit-mask-image: linear-gradient(var(--haag-split), #000 50%, transparent 50%);
            mask-image: linear-gradient(var(--haag-split), #000 50%, transparent 50%);
  }

  /* Clusters: positioned by _layout(). Content inside is left-aligned; the
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

  /* Clock: Håg draws it. This stands in for layout to measure, then Håg's
     takes its place: tight box around the numerals; AM/PM hangs outside it,
     top-aligned by _alignAmPm(), so _layout() can tuck it toward the line. */
  .time { position: relative; line-height: .8; visibility: hidden; }
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

  /* Icon box: a fixed .8em square holding HA's ha-icon, its bottom .05em
     below the baseline. The box sets the spacing, so icons never change the
     layout; fitIcon() fits the icon inside to the digits (scale, translate),
     and motion runs on it too (transform). */
  .ico {
    display: inline-block;
    width: .8em;
    height: .8em;
    margin-right: .2em;
    vertical-align: -.05em;
  }
  /* In a flex row the box's bottom lands on the baseline; lower it to match. */
  .appt > .ico { position: relative; top: .05em; }
  .ico > ha-icon { display: flex; width: 100%; height: 100%; --mdc-icon-size: 100%; }
  /* HVAC status on the floor's temperature icon. */
  .ico.heat { color: var(--coral); }
  .ico.cool { color: var(--seaglass); }
  .ico.fan  { color: var(--text-2); }
  .ico.off  { color: var(--text-2); opacity: .35; }
  .ico.err  { color: var(--coral); }
  /* HVAC motion: slow and gentle. Heat flickers from its base, cool
     turns very slowly, fan spins slowly. The flicker scales about its base
     by translating (40% = center to 90%), not by transform-origin, which
     would move the fit's scale too. */
  .ico.heat > ha-icon { animation: flicker 4s ease-in-out infinite; }
  .ico.cool > ha-icon { animation: turn 40s linear infinite; }
  .ico.fan  > ha-icon { animation: turn 12s linear infinite; }
  @keyframes flicker {
    0%, 100% { transform: translateY(40%) scale(1, 1)     translateY(-40%); opacity: 1; }
    35%      { transform: translateY(40%) scale(.97, .92) translateY(-40%); opacity: .85; }
    60%      { transform: translateY(40%) scale(1, .97)   translateY(-40%); opacity: .95; }
  }
  @keyframes turn { to { transform: rotate(1turn); } }
  @media (prefers-reduced-motion: reduce) { .ico > ha-icon { animation: none; } }
  /* Slot with no entity on this install: hidden, not labeled. */
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
  /* The calendar's color on the icon and the time. */
  .appt > .ico, .appt .when { color: var(--tint, currentColor); }

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
    /* The clip reaches below the tight line for descenders ("g"), short of
       a third line's ascenders; the margin keeps the layout as it was. */
    padding-bottom: .12em;
    margin-bottom: -.12em;
  }
  .appt.wrap .text {
    white-space: normal;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .people { display: flex; gap: calc(.8 * var(--u)); align-items: center; }
  /* One rounded square per person: their HA picture, or initials. Border
     and initials in their color. */
  .person {
    width: var(--portrait);   /* border-box: the border is inside this size */
    aspect-ratio: 1;
    border: calc(.35 * var(--u)) solid var(--tint, var(--line));
    color: var(--tint, currentColor);
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
    <svg class="wx wx-under" aria-hidden="true"></svg>

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

    <slot name="clock"></slot>

    <!-- Weather that crosses the text: fog over the clock, snow on the alert row. -->
    <svg class="wx wx-over" aria-hidden="true"></svg>

  </div>
`;


class SinnesroGlance extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}${weather?.WEATHER_STYLE ?? ''}</style>${TEMPLATE}`;
    this._stage = root.querySelector('.stage');
    if (weather) this._wx = new weather.Weather(this._stage, root.querySelector('.wx-under'), root.querySelector('.wx-over'));
    this._wx?.setEggs(this._eggs());
    this.addEventListener('haag-alertrow', () => this._relayout());
    // Off screen: animations pause.
    this.addEventListener('haag-visible', () => {
      this._stage.classList.toggle('paused', !this._haag.visible);
      this._wx?.setVisible(this._haag.visible);
    });
  }

  // ----- Glance API (docs/glances.md) -----

  setConfig(settings) {
    this._settings = settings;
    this._wx?.setEggs(this._eggs());
  }

  // For Håg's transitions: the two grounds, the weather, and the text but the clock.
  parts() {
    const a = this._haag.layout.angle, root = this.shadowRoot;
    return {
      wedges: [{ from: 180 - a, to: 360 - a, color: 'var(--sky)' }, { from: 360 - a, to: 540 - a, color: 'var(--home)' }],
      scene: [...root.querySelectorAll('.sky, .wx')],
      text: [...this._out, ...this._in].filter(el => !el.querySelector('.time')).map(el => [...el.children]),
      done: () => {
        if (this._layoutOwed) this._relayout();
      },
    };
  }

  // On overall (haag.easterEggs) and not turned off here.
  _eggs() {
    return this._haag?.easterEggs !== false && this._settings?.easter_eggs !== false;
  }

  // How many appointments at most (setting `appointments`).
  _count() {
    return Math.max(1, Math.round(this._settings?.appointments ?? APPT_COUNT));
  }

  set haag(haag) {
    this._haag = haag;
    this._wx?.setVisible(haag.visible);
  }

  _icon(box, name) {
    this._haag.icon(box, name);
    fitIcon(box, name);
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
    this._updateWeather();
  }

  // The weather background: condition, wind, moon, hemisphere, day colors,
  // and where the sun and moon are.
  _updateWeather() {
    const wx = this._wx, hass = this._hass;
    if (!wx || !hass || !this._slots) return;
    const w = hass.states[this._slots.weather];
    wx.setCondition(w?.state);                  // unknown or unavailable: plain sky
    wx.setWind(w?.attributes.wind_bearing);
    wx.setPhase(hass.states[this._slots.moon]?.state);
    wx.setSouth((hass.config?.latitude ?? 0) < 0);
    wx.setDaylight(!!this._haag.daylight);
    wx.setSky(this._skyHours());
  }

  // Hours of the day in HA's time zone: now, and sunrise, solar noon,
  // sunset and solar midnight from sun.sun (6:00–18:00 without it).
  _skyHours() {
    const tz = this._hass.config?.time_zone;
    this._hourFmt ??= new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: tz });
    const hourOf = d => {
      const parts = this._hourFmt.formatToParts(d), v = t => Number(parts.find(p => p.type === t).value);
      return v('hour') + v('minute') / 60;
    };
    const a = this._hass.states['sun.sun']?.attributes || {};
    const [rise, noon, set, midnight] = ['next_rising', 'next_noon', 'next_setting', 'next_midnight']
      .map(k => a[k] ? hourOf(new Date(a[k])) : null);
    const sun = rise != null && noon != null && set != null ? [rise, noon, set] : [6, 12, 18];
    return { now: hourOf(new Date()), sun, midnight: midnight ?? (sun[1] + 12) % 24 };
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
      this._events = await fetchEvents(this._hass, this._calendars, this._settings?.days ?? APPT_DAYS);
      this._apptLimit = this._count();   // new events: start from the full count
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
    if ((this._apptLimit ?? this._count()) === this._count()) return;
    this._apptLimit = this._count();
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
    this._wx?.setVisible(false);
  }

  // ----- Live content -----

  // Update the clock, then wake up again at the start of the next minute.
  _tick() {
    clearTimeout(this._timer);
    if (!this._live) return;
    const now = new Date();
    const tz = this._hass?.config?.time_zone;   // HA's time zone, not the browser's
    const locale = this._hass?.language || navigator.language;

    // The clock's stand-in, with AM/PM in a separate label (none on 24 hours).
    this._live.time.textContent = this._haag.clock.time;
    this._live.ampm.textContent = this._haag.clock.period;

    // Long-form date above the time.
    this._live.date.textContent = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }).format(now);

    this._renderAppointments();   // relative labels (within 24 h, soon) move with the clock
    this._layout();
    this._updateWeather();        // the sun and moon move with the clock
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
    const time = d => new Intl.DateTimeFormat(timeLocale(hass), { hour: 'numeric', minute: '2-digit', ...hours(hass), timeZone: tz }).format(d);
    const day = d => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: tz }).format(d);
    const dateKey = d => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);   // YYYY-MM-DD
    const now = new Date();

    let rows;
    const upcoming = this._events === 'Err' ? [] : this._events.filter(e => e.endAt > now).slice(0, this._apptLimit ?? this._count());
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
          when,
          text: e.summary,
          tint: this._haag.colorOf(e.calendar, 'sky'),
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
      this._icon(div.firstElementChild, r.icon);
      if (r.tint) div.style.setProperty('--tint', r.tint);
      // Event text is never parsed as HTML.
      const text = div.querySelector('.text');
      if (r.when) {
        const when = document.createElement('span');
        when.className = 'when';
        when.textContent = r.when;
        text.append(when, ` ${r.text}`);
      } else text.textContent = r.text;
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
    const icon = (slot, value, name) => this._icon(slot.querySelector('.ico'), value === 'Err' ? ERR_ICON : name);
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
      // error icon when the temperature itself is bad. Idle, or a floor
      // with no thermostat, shows a thermometer.
      const box = fs('temp').querySelector('.ico');
      const status = temp === 'Err' ? 'err' : (p.hvac(f.climate) || '');
      if (box.dataset.status !== status) {
        box.className = `ico ${status}`;
        box.dataset.status = status;
      }
      this._icon(box, HVAC_ICONS[status] || thermometerIcon(temp, tempUnit(f.slots.temp)));
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
    const fill = (spot, ids, emptyFrame, on) => {
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
        const tint = this._haag.colorOf(id, on);
        if (tint) el.style.setProperty('--tint', tint);
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
    for (const [floor, spot] of spots) fill(spot, at[floor] || [], false, 'home');
    fill(away, at.__away || [], true, 'sky');   // nobody away: the breathing frame
    return changed;
  }

  // ----- Layout engine (ported from design/wireframe-idle.html) -----
  // Measuring and placing along the split are Håg's (haag.layout.on).

  get _lay() {
    return this._layoutHelpers ??= this._haag.layout.on(this._stage, { graphics: '.ico, .person' });
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
    const boxBottom = bottom + (r.bottom - base.top) - this._lay.edges(cluster).bottom;
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
    const l = this._lay;
    const stage = this.shadowRoot.querySelector('.stage');
    const rows = [...this.shadowRoot.querySelectorAll('.status-line')];
    const digits = row => [...row.querySelectorAll('.t2[data-slot] > :last-child')]
      .find(el => el.getClientRects().length && el.textContent.trim());
    const ref = rows.map(digits).find(Boolean);
    if (!ref) return;                           // nothing to measure yet
    stage.style.setProperty('--portrait', `${l.capHeight(ref)}px`);
    for (const row of rows) {
      const people = row.querySelector('.people');
      const text = digits(row);
      if (!people) continue;
      people.style.transform = '';
      if (!text || !people.getClientRects().length) continue;   // no temperature: stay centered
      const capTop = l.baseline(text) - l.capHeight(text);
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
    const t = this._lay.edges(this._out[0]);
    const f = this._lay.edges(top);
    const current = t.bottom - t.top, target = f.bottom - f.top;
    if (current > 0 && target > 0) {
      time.style.fontSize = `${parseFloat(getComputedStyle(time).fontSize) * target / current}px`;
    }
  }

  // Top-align AM/PM with the clock numerals by measured cap height.
  _alignAmPm() {
    const l = this._lay;
    for (const am of this.shadowRoot.querySelectorAll('.ampm')) {
      const clock = am.parentElement;
      const delta = (l.baseline(clock) - l.capHeight(clock)) - (l.baseline(am) - l.capHeight(am));
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
    Justify every cluster to the split line: outdoor clusters stack upward
    from the alert row with their nearest visible corner one gap above the
    line; indoor clusters stack downward one gap below it. Positions are
    clamped to the screen.
  */
  _layout() {
    const stage = this._stage;
    if (!stage || !stage.clientWidth || !this._haag) return;
    // Between glances the text is moving and scaled, so it can't be measured:
    // lay out when that's over (parts' done).
    this._layoutOwed = this.hasAttribute('between');
    if (this._layoutOwed) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    const cy = H / 2;
    const l = this._lay;
    const gap = l.gap, cgap = this._px('--cluster-gap');
    const edge = Math.min(W, H) * 0.02;
    // With the alert row shown, clusters clear it by one gap. Without it, the
    // innermost block on each side (the time; the top floor) is centered on
    // the middle, so the two sit side by side across the line, and slide
    // past each other as the alert row opens.
    const alert = this._haag.alertrow;
    const alertOn = alert.showing;
    const half = alertOn ? (alert.bottom - alert.top) / 2 : 0;

    this._fitPortraits();
    this._fitTime();
    this._alignAmPm();

    const place = (el, ty, target) => {
      const { x } = l.toSplit(el, ty, target);
      el.style.transform = `translate(${x}px, ${ty}px)`;
      return x;
    };
    // The furthest right a line spanning top..bottom may reach on the
    // outdoor side and still stay one gap from the split.
    const room = (top, bottom) => l.room(top, bottom, -gap);

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
      const ot = l.edges(this._out[0]), it = l.edges(this._in[0]);
      const at = l.pair(this._out[0], this._in[0]);
      const step = Math.min(W, H) * 0.005;
      // Slide the pair up the line until the clock clears the left margin.
      // The margin is a preference: if the top floor would hit the right edge
      // first, keep the furthest slide where both still sit on the line
      // (side by side wins over the margin, for square displays).
      let best = null;
      for (let shift = 0; shift <= H / 2; shift += step) {
        const { upper: t, lower: f } = at(shift);
        if (t.clamped || f.clamped) continue;
        if (!best || t.left > best.left) best = { left: t.left, tBottom: t.y + ot.bottom, fTop: f.y + it.top };
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
    let clock = null;                          // the clock numerals' baseline
    for (const el of this._out) {
      // Appointments start at the first reading's left edge, rather than
      // following the line; each of their lines is cut at the split instead.
      const appts = !!el.querySelector('.appointments');
      if (appts) this._wrapSoonest(el, anchor, y, room);
      const o = l.edges(el);
      const ty = y - o.bottom;
      let tx;
      if (appts) {
        tx = anchor;
        el.style.transform = `translate(${tx}px, ${ty}px)`;
        this._capAppointments(el, tx, ty, room);
      } else {
        tx = place(el, ty, -gap);
      }
      // Measured relative to the cluster, so a running transition doesn't skew it.
      const base = el.getBoundingClientRect();
      outTop = Math.min(outTop, ty + Math.min(...l.corners(el).map(c => c[1])));
      const reading = el.querySelector('.status-line .line > [data-slot]:not([hidden])');
      if (reading) anchor = tx + reading.getBoundingClientRect().left - base.left;
      const time = el.querySelector('.time');
      if (time) {
        clock = ty + l.baseline(time) - base.top;
        const r = time.getBoundingClientRect();
        this._haag.clock.place({ x: tx + r.left - base.left, y: ty + r.top - base.top,
          size: parseFloat(getComputedStyle(time).fontSize), ampm: this._px('--t2'), color: 'var(--text)' });
      }
      y = ty + o.top - cgap;
    }

    // The weather follows the screen, the clock and the alert row.
    this._wx?.resize(W, H);
    this._wx?.place({ band: alertOn ? alert.top : null, clock });

    y = inStart;                               // visible top of next indoor cluster
    for (const el of this._in) {
      const o = l.edges(el);
      const ty = y - o.top;
      place(el, ty, gap);
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
