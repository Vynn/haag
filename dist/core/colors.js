/*
  Håg core: people and calendar colors.
  A part of the core in a file of its own. It imports nothing, and
  haag.js loads it with a tag of its own: raise that tag when this file
  changes (docs/development.md#file-tags).
  License: GPL-3.0

  Each person and calendar has a color: one set in settings
  (`providers.people.colors: { entity_id: "#hex" }`), else its calendar's
  from HA, else one from Håg's palette. A person and their calendar
  share: either's setting, then the calendar's own.
  People match calendars by name (person.alex ↔ calendar.alex), or by
  `providers.people.calendars: { person_id: calendar_id }`; false there
  gives them none.
  Drawn colors keep their hue and shift in lightness until they reach
  4.5:1 on what they're drawn on, by day and by night, so text can take
  them too.
*/

// Backgrounds by night and day: the outdoor sky and its glow, and the
// indoor base. The stage's palette uses them; colors are checked on them.
export const GROUNDS = {
  sky:     { night: '#10162A', day: '#7CC8F2' },
  horizon: { night: '#1D3442', day: '#FFD6E7' },
  home:    { night: '#1E2433', day: '#F6FAFF' },
};
export const ON = { sky: ['sky', 'horizon'], home: ['home'] };

// For people and calendars without a color, in turn: each value is
// 4.5:1 or better on every ground (design/palette-people.html).
export const PEOPLE_PALETTE = [
  { night: '#ED914C', day: '#7A3C00' },   // ember
  { night: '#8DBC58', day: '#365501' },   // fern
  { night: '#10C4BC', day: '#025653' },   // lagoon
  { night: '#54B3FD', day: '#025081' },   // azure
  { night: '#B298F9', day: '#5B369E' },   // violet
  { night: '#E486C6', day: '#87216E' },   // orchid
];
export const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const READABLE = 4.5;

// Colors as linear sRGB, OKLab, and WCAG contrast.
const toLinear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toGamma = c => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const rgbOf = hex => {
  const h = hex.length === 4 ? hex.replace(/\w/g, '$&$&') : hex;
  return [1, 3, 5].map(i => toLinear(parseInt(h.slice(i, i + 2), 16) / 255));
};
const hexOf = rgb => '#' + rgb.map(c => Math.round(255 * toGamma(Math.min(1, Math.max(0, c)))).toString(16).padStart(2, '0')).join('');
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function linearOf([L, a, b]) {   // may fall outside sRGB
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}

// A color stepped in lightness, away from the grounds, until it's
// readable on all of them. The hue stays; chroma eases off only where
// the hue runs out of sRGB.
function readableOn(hex, grounds) {
  const passes = rgb => grounds.every(g => contrast(rgb, g) >= READABLE);
  if (passes(rgbOf(hex))) return hex;
  const [L0, a, b] = oklab(rgbOf(hex));
  const step = luminance(grounds[0]) > 0.18 ? -0.005 : 0.005;
  for (let L = L0 + step; L > 0 && L < 1; L += step) {
    for (let k = 1; k >= 0; k -= 0.05) {
      const c = linearOf([L, a * k, b * k]);
      if (!c.every(v => v > -1e-4 && v < 1 + 1e-4)) continue;
      const out = hexOf(c);
      if (passes(rgbOf(out))) return out;
      break;
    }
  }
  return step < 0 ? '#000000' : '#ffffff';
}

// What a person or calendar looks like on the sky or indoors: its day
// and night values, mixed with the rest of the palette.
export function tint(color, on = 'home') {
  const at = time => readableOn(color, ON[on].map(k => rgbOf(GROUNDS[k][time])));
  const { day, night } = typeof color === 'number' ? PEOPLE_PALETTE[color] : { day: at('day'), night: at('night') };
  return `color-mix(in oklab, ${day} var(--day-mix), ${night})`;
}

/**
 * Each person's calendar, and every person's and calendar's color:
 * { calendars: { person_id: calendar_id }, colors: { entity_id: hex |
 * palette index } }. Palette colors go in turn, people first; a person
 * and their calendar share one.
 */
export function discoverColors(hass, reg, people, calendars, settings = {}) {
  const set = settings.colors || {};
  const name = id => (hass.states[id]?.attributes?.friendly_name || '').trim().toLowerCase();
  const all = Object.keys(hass.states).filter(id => id.startsWith('calendar.'));
  const cal = {};
  for (const p of people.ids) {
    // A calendar set for them, false for none, else one matching by name.
    const c = settings.calendars?.[p]
      ?? all.find(c => c.split('.')[1] === p.split('.')[1])
      ?? all.find(c => name(c) && name(c) === name(p));
    if (c) cal[p] = c;
  }
  const fromHa = id => reg.entities.find(e => e.entity_id === id)?.options?.calendar?.color;
  // A calendar's own color in settings, else its person's (the first, if
  // several share it), else HA's.
  const owner = c => Object.keys(cal).sort().map(p => cal[p] === c && set[p]).find(Boolean);
  const calendarColor = c => set[c] ?? owner(c) ?? (HEX.test(fromHa(c) ?? '') ? fromHa(c) : null);
  const slots = new Map();
  const slot = key => {
    if (!slots.has(key)) slots.set(key, slots.size % PEOPLE_PALETTE.length);
    return slots.get(key);
  };
  const colors = {};
  for (const p of [...people.ids].sort()) colors[p] = set[p] ?? (cal[p] && calendarColor(cal[p])) ?? slot(cal[p] ?? p);
  for (const c of [...new Set([...calendars, ...Object.values(cal)])].sort()) colors[c] = calendarColor(c) ?? slot(c);
  return { calendars: cal, colors };
}
