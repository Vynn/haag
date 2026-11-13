# Glances

> **Pre-release.** Built in 0.1.2. ◇ marks what's still a proposal.

Håg is its own glanceable dashboard framework, built as a Home Assistant dashboard strategy. Everything it shows is a glance.

- **The default glance** shows when nothing else needs the screen. Håg's is `sinnesro`, shown as Overview: the time, the weather, indoors and outdoors.
- **Appliances** (`vitvaror`) also comes with Håg: washers, dryers, washer-dryers and dishwashers while they run, and for a while after a cycle ends.
- **Workshop** (`verkstad`) also comes with Håg: 3D printers while they print, and for a while after a print ends, one at a time as [instances](#instances).
- **Other glances** are off until turned on. Once on, they run in the background and ask for the screen when they have something to show.
- **Taking turns:** glances with something to show take turns with the default glance, 30 seconds each. All are equal: none cuts in, and alerts bring up only the alert row.

Håg's main file is the core. It draws the alert row and provides what glances share: discovery, alerts, the typeface, day and night colors, icons and the diagonal layout.

Håg is open source, and every glance, built in or not, follows this one contract.

## Glances aren't cards

A glance isn't a Home Assistant card, and the difference is deliberate:

- You don't place glances on a dashboard. Håg shows each one when it's relevant.
- Håg owns the screen. Layout, colors, typeface, the clock and the alert row are the same for every glance.
- A glance works only inside Håg.
- Underneath, Håg fills its dashboard with a single Home Assistant card that hosts the glances.

For authors, a glance is still a web component, and it gets Home Assistant's state the way a card does.

## Install, turn on, configure

Built-in glances come with Håg. Other glances install like any dashboard plugin: through the Home Assistant Marketplace from 2026.11 (*Install*), or HACS on 2026.10 (*Download*). Either way, turn them on in settings:

```yaml
strategy:
  type: custom:haag
  default: sinnesro     # shown when nothing else needs the screen
  cycle: 30             # seconds per turn, 10 to 60
  glances:
    laundry:            # listed first, so it goes first
      enabled: true
      # …the glance's own settings
    printer:
      enabled: true
```

- One entry per glance, under its name. Glances take turns in the order they ask, after the default glance.
- A glance with no entry, or with `enabled: false`, is off and isn't loaded. Built-in glances too.
- `default` names any installed glance. The default glance is on unless its entry says `enabled: false`.
- `cycle` sets the seconds per turn, 10 to 60 (30 if left out), in YAML or the editor's General section.

Shared settings are in [configuration](configuration.md).

## Names

- Unique, starting with a letter, and made of lowercase letters, digits, `_` and `-`.
- A clash with a built-in glance: the built-in runs, the other is ignored.
- Two other glances with one name: neither runs.
- Either way, a notice names the glances and their files.
- Display names are just the name, such as Laundry. *Glance* is the kind of thing, lowercase: the Laundry glance.

## Starting up

At startup, the alert row shows an information alert: Håg is starting up, with a countdown in seconds so it doesn't look frozen.

If after 60 seconds the default glance is still missing, off or failing to load, and no other glance has the screen, the alert turns critical. It says what's wrong, with links to settings (edit mode, for administrators) and to this page.

The startup alert shows alone, apart from Håg's notices, which take turns beside it to say why.

## Notices

Håg gives a notice, in the alert row and the browser console, when:

- two glances share a name, or a name isn't valid;
- settings name a glance that isn't installed;
- a glance fails to load;
- a glance's format is one this version of Håg doesn't know.

The wording and severities are in [alerts](alerts.md#notices).

## Making a glance

### Files

```
my-glance/
  my-glance.js    bootstrap: manifest and registration
  glance.js       the glance, loaded only when it's on
```

- The bootstrap is the dashboard resource HACS or the Marketplace adds. It loads on every dashboard, so keep it small.
- Built-in glances use the same layout, in `dist/glances/<name>/`.

### Bootstrap

```js
// my-glance.js
const manifest = {
  format: 'haag-glance/v1',
  name: 'my_glance',
  element: 'my-glance',
  title: 'Laundry',
  version: '1.0.0',
};

(window.haagGlances ||= []).push({
  manifest,
  url: import.meta.url,
  // Load with this file's cache tag, so an update refreshes both files.
  load() {
    const url = new URL('./glance.js', import.meta.url);
    url.search = new URL(import.meta.url).search;
    return import(url);
  },
});
```

- **The bootstrap loads the glance** because only it knows its cache tag; relative imports drop it.
- **Registration goes through a shared list,** so Håg and its glances can load in any order. `url` lets notices name the file.
- **Glances never import Håg.** A different address would load a second copy; Håg passes glances what they need.

### Manifest

| Field | Value |
|---|---|
| `format` | `haag-glance/v1`, this contract's version. |
| `name` | The name used in settings. |
| `element` | The web component's tag, defined by `glance.js`. |
| `title` | The name people see, such as Laundry: just the name, without "glance". |
| `version` | The glance's version. |
| `settings` | Optional: the glance's settings, below. |
| `alerts` | Optional: the alerts it raises, below. |
| `instances` | Optional: `{ element, max }` for a glance that shows several things one at a time, each its own instance. See [instances](#instances). |

#### Settings

`settings` lists what can be set in the glance's entry (`glances.<name>`). Håg checks each value, gives a notice naming the glance when one can't be used, fills in defaults, and passes the result to `setConfig`. Keys it doesn't list pass through unchecked. The dashboard editor shows each glance in its own section, with its on/off switch in the header and these settings inside.

```js
settings: [
  { key: 'days', type: 'number', default: 30, min: 1, step: 1, unit: 'days', label: 'Days ahead', help: 'How far ahead to look' },
  { key: 'easter_eggs', type: 'boolean', default: true, label: 'Easter eggs' },
],
```

| Field | Value |
|---|---|
| `key` | The setting's name in the entry. Not `enabled` or `alerts`, which are Håg's. |
| `type` | `text`, `number`, `seconds`, `time` (`"22:00"`), `choice`, `boolean`, `entity`, `entities` or `links` (entity → entity). |
| `default` | The value when it's left out, or can't be used. |
| `label`, `help` | What the editor shows. |
| `min`, `max`, `step`, `unit` | For `number`: its range, step, and unit as shown. |
| `choices`, `labels` | For `choice`: the values, and a name for each in the editor. |
| `filter` | For `entity` and `entities`: which entities to offer, as Home Assistant's entity selector takes it (e.g. `{ domain: 'sensor' }`). |
| `gui` | `false` keeps a setting out of the editor, for YAML only. `links` settings need it. |

#### Alerts

`alerts` lists the alerts the glance raises, so each can be turned off or given a snooze in settings, in the glance's entry under `alerts`: `glances.<name>.alerts.<alert>`. The editor shows them in the glance's section, in an Alerts section of their own after its settings. It starts closed, and closes when the glance is turned off.

```js
alerts: [
  { key: 'ended', label: 'Cycle ended', dismiss: true },
  { key: 'error', label: 'Errors', snooze: 900 },
],
```

| Field | Value |
|---|---|
| `key` | The alert's name: lowercase letters, digits, `_` and `-`. An alert raised with this key, or with a key that starts with it and `:` (`error:dryer`), is this alert. |
| `label` | What the editor shows. |
| `dismiss` | `true`: a tap dismisses it (see [alerts](alerts.md#the-alerts-api)), and it has no snooze setting. |
| `snooze` | Seconds a tap snoozes it for, unless set. 900 if left out. |

- Håg adds `enabled`, on if left out, and `snooze` for alerts a tap can't dismiss.
- An alert that's off isn't raised.
- Alerts the manifest doesn't list always show, and snooze for 15 minutes.
- Glances named `turn`, `core` or `weather` get no alert settings: those names are Håg's own groups under `alerts`.

### The glance

`glance.js` defines a web component under the manifest's `element`:

```js
// glance.js
class MyGlance extends HTMLElement {
  setConfig(settings) {}   // its entry from settings
  set hass(hass) {}        // Home Assistant's state, when it changes (below)
  set haag(haag) {}        // what Håg provides, below
  parts() {}               // optional, for transitions, below
}
customElements.define('my-glance', MyGlance);
```

`setConfig` and `hass` work as in Home Assistant's own cards. If the tag is already taken, the glance fails to load and Håg gives a notice.

Every glance fills its screen with at least a background color. It can use Håg's colors or a palette of its own.

### Home Assistant's state

Home Assistant reports every state change in the house, often several a second. Håg passes them on in step: the first at once, then at most one every half second, always ending with the latest.

- **Without a list,** a glance gets `hass` on every pass.
- **`haag.watch(ids)`** says which entities the glance reads. From then on it gets `hass` only when one of them changed. Call it again whenever the list changes; `haag.watch(null)` goes back to every pass.
- **It's also set** when Home Assistant's own settings change (units, time zone, language), when day turns to night or back, and once a minute while anything in the house changes.
- **The list has to be complete.** An entity that's read but not listed shows a stale reading for up to a minute. For what the glance reads through `haag.providers`, `haag.providers.entities()` gives the list.

An [instance](#instances) has a list of its own.

### Asking for the screen

The default glance never asks. Other glances:

- `haag.request()`: something to show.
- `haag.release()`: done.
- `haag.visible`: whether the glance is on screen. A `haag-visible` event on the glance says when it changes; the glance pauses animation while hidden.

Håg runs the turns:

- **Order:** the default glance, then the glances asking, in the order they asked, `cycle` seconds each. With nothing else asking, the default glance shows alone.
- **Joining:** a glance that asks joins at the back, once the glance on screen has had a full turn. Asking again while asking keeps its place.
- **Leaving:** a glance that releases leaves at once, and the next one gets a full turn.
- **Timing is Håg's:** a glance only says whether it has something to show.
- **Alerts don't change the turns.** A glance can show an alert's state in its own content, but it keeps its place.
- **Touch:** a tap on the right half of the screen goes to the next glance, and on the left half to the one before; that glance gets a full turn. A glance with [instances](#instances) is stepped through first. Taps just above and below the alert row do nothing, and taps on it are the alert's (see [alerts](alerts.md#touching-an-alert)).

Moving between glances is a [transition](#transitions).

### Instances

A glance can show several things one at a time, such as a printer each: up to three instances, sharing the glance's turn. The manifest names the element each instance is, and how many at most (3 if left out, and never more):

```js
instances: { element: 'my-printer', max: 3 },
```

- **The glance's own element coordinates.** It's never shown. It finds what to show, puts it in order, and asks for the screen as any glance does.
- **`haag.instances.set(list)`** says what to show, in order: `[{ id, data }, …]`. Ids are text, unique, without `:` or `/`. Håg makes an instance element for each new id, passes new `data` to the ones it has, and removes those left out. Past `max`, the rest are left out.
- **Each instance** gets `haag` as a glance does, with `haag.instance`: its `id` and `data`. A `haag-instance` event says when the data changes. Its clock, alerts and `haag.visible` are its own; it gets `hass` and the glance's settings, and doesn't ask for the screen.
- **Turns:** the glance's turn is cut into a slot for each instance, in order: with three, 10 seconds each of 30. A new order applies from the next slot; one that's removed while on screen gives way to the next at once. A glance with no instances doesn't show.
- **Touch:** a tap steps to the next slot (right) or the one before (left) without restarting the turn: going to the second of three leaves what the last two slots had. From the last slot, or back from the first, it goes to the neighbouring glance.
- **Alerts:** an instance's alert, tapped, shows that instance.
- **Between instances,** Håg [wipes](#transitions).

### What Håg provides

| | |
|---|---|
| `haag.providers` | Discovery results (`outdoor`, `floors`, `people` with each person's `calendars`, `calendars`), with settings applied, and readers for their current state: `value(ref)`, `unit(ref)`, `hvac(climate)`, `locate()`. `entities()` lists every entity these read, for `haag.watch`. |
| `haag.registry` | Home Assistant's registries as Håg read them at startup: `entities` (each with its own or its device's `area`, and that area's `floor`), `devices`, `areas` and `floors`. A glance doesn't fetch them again. |
| `haag.watch(ids)` | The entities the glance reads, so `hass` is set only when one changes. See [Home Assistant's state](#home-assistants-state). |
| `haag.format` | Text as Home Assistant's settings write it: `number(n, digits)`, `time(t, now)` ("4:00 PM", "16:00", with the weekday when it isn't today: "Sat 4:00 PM"), `duration(ms)` ("3 min", "2 h", "4 d", rounded down) and `cap(text)` (first letter capital). |
| `haag.draw` | Small drawing helpers: `svg(tag, attributes, parent)` makes an SVG element; `seeded(seed)` gives a random sequence that's the same on every reload, as `next(a, b)`; `smooth(points, { digits, closed })` is a smooth path through points; `lerp(a, b, t)` and `ease(t)`. |
| `haag.runs` | What the glance keeps of things that run and end. See [runs](#runs). |
| `haag.colorOf(entity_id, on)` | A person's or calendar's color, as a CSS color readable at 4.5:1 on `'sky'` or `'home'` (the default), by day and by night. It follows the switch between them on its own. `null` for anything else. |
| `haag.daylight` | Whether day colors are showing: the `theme` setting, or the sun when it's `auto`. |
| `haag.easterEggs` | Whether easter eggs are on overall (the `easter_eggs` setting). A glance with easter eggs shows them only when this is on; its own setting can turn them off just for it. |
| `haag.layout` | The shared geometry: the split's `angle` (the line runs through the center), `on(stage)`, helpers for placing content (below), and `css`, the styles for [blocks along the split](#blocks-along-the-split). |
| `haag.icon(element, name)` | Draws a Home Assistant icon, filling the element. Fitting it to the text is up to the glance. |
| `haag.alerts` | This glance's alerts: `set`, `delete` and `clear`. See [alerts](alerts.md#the-alerts-api). |
| `haag.alertrow` | Whether the alert row shows, and where. |
| `haag.clock` | Where the clock goes and how it looks. See [the clock](#the-clock). |

Inherited through CSS: the typeface, the size unit `cqmin` (1% of the shorter side), and the palette:

| Color | Use |
|---|---|
| `--sky`, `--horizon` | The outdoor side and its glow near the split. |
| `--home` | The indoor side. |
| `--text`, `--text-2` | Text and secondary text. `--text-2-out` is secondary text on the sky. |
| `--coral`, `--seaglass` | Accents: heating and errors, cooling. |
| `--band`, `--mist` | The alert row's information wash (near-white, by day and by night), and haze. |

Each mixes a night and a day value (`--n-sky`, `--d-sky`, …) by `--haag-daylight`, 0 at night and 1 by day, which switches over 2.5 seconds.

### Layout helpers

`haag.layout.on(stage, { graphics })` measures and places content on the glance's stage, the element that fills its screen. Call it once and keep the result. Positions are in pixels from the stage's top-left unless noted. What's visible of an element is its text and its graphics: `graphics` is a selector for those, `svg, img, ha-icon` if left out.

| Helper | Gives |
|---|---|
| `gap` | The space between content and the split, 2.5 units, in pixels. |
| `px(length)` | A CSS length in pixels, such as `'var(--t2)'` or `'calc(2 * var(--u))'`. Measured once for each size of the stage. |
| `capHeight(el)` | The height of a capital letter in `el`'s font. |
| `baseline(el, last)` | The first line's baseline, or with `last` the last visible line's, in the page's coordinates (like `getBoundingClientRect`). |
| `baselines(els)` | The first-line baseline of each element in a list, measured together. |
| `corners(el)` | The corners of `el`'s visible pieces, from its top-left. |
| `edges(el)` | `el`'s visible `top` and `bottom`, from its top: text from its cap height to its baseline, graphics by their box. `data-descender="0.5"` on a text counts that share of its descender. Given a list of elements, each one's, measured together. |
| `toSplit(el, y, distance)` | Where to put `el`, its top at `y`, so its nearest visible corner is `distance` from the split: negative on the upper side, positive on the lower. Kept inside the screen's margin. `{ x, left, clamped }`: `left` is its visible left edge, `clamped` that the margin stopped it short. |
| `room(top, bottom, distance)` | How far a line spanning `top` to `bottom` may reach and stay `distance` from the split: rightward on the upper side, leftward on the lower. |
| `pair(upper, lower, { stagger, clear, edges })` | Two elements side by side across the split, each a gap from it, as Overview's are. Measures once and returns `at(shift)`, giving `{ upper, lower }`, each `{ x, y, left, clamped }` with `y` its top. Centered on the middle and moved up by `shift`, `stagger` pixels apart in height; while the alert row shows, slid apart along the split to clear it by `clear` (the gap if left out). `edges`: the two's, when already measured. |

Measuring makes the browser lay the page out again, which is slow. Measure several elements in one call where a helper takes a list, and don't measure the same element twice.

#### Blocks along the split

Overview and Workshop place their content the same way: blocks in two stacks, one up from the split and one down from it, the first of each side by side across it. These helpers and styles do that for any glance.

`haag.layout.css` holds the styles: the `.stage`, a block (`.cluster`), three text sizes (`.t1`, `.t2`, `.t3`), a row on one baseline (`.line`), and the clock's stand-in (`.time`, with AM/PM as `.ampm` inside it). Add it to the glance's shadow root, before the glance's own styles.

| Helper | Does |
|---|---|
| `fitClock(time, own, block)` | Makes a clock stand-in as tall as `block` is, visible top to bottom, with AM/PM top-aligned to the numerals. `own` is the block holding the stand-in. Returns the edges of both, `[own, block]`. |
| `starts(upper, lower, { cgap, margin, edges })` | Where the two stacks start: `up`, the visible bottom of the first upper block, and `down`, the visible top of the first lower one. With the alert row showing, `cgap` clear of it. Without it, side by side across the split: centered on the middle, or slid up just far enough for the upper block to keep `margin` (a share of the screen's shorter side) on its left. `null` when no height fits both. |
| `stack(els, from, { up, above, cgap, known, stop })` | Places blocks one after another from `from`, `cgap` apart by what's visible of them: downward from their tops, or with `up` upward from their bottoms. Each goes a gap from the split, `above` it or below. `known` is a Map of edges already measured, by block. Returns each block's place (`placed`: `{ el, x, y, edges, clamped }`) and `end`, where the next would start. With `stop`, it stops at the first block the screen's margin stops short, and returns its index as `cut`. |
| `clockIn(time, own, x, y)` | A clock stand-in's place for `haag.clock.place`, when `own`, the block holding it, has its top-left at (`x`, `y`). |

These are a start, shaped by two glances, and may change as more are made.

### Runs

Some things run and end: a wash cycle, a print. `haag.runs` keeps a record of each in the browser, under the glance's name, so a reload or a restart of the display doesn't lose it.

| | |
|---|---|
| `track(id, reading)` | Takes a reading and returns the record. `reading`: `state` (kept as `last`), `active` and `ended` (what it is now), `changed` (when the state last changed), and optionally `opened` (when its door last opened, if it's open) and `fresh()` (what a new run's record starts with). |
| `get(id)` | The record, or nothing. |
| `resting(record, rest, now)` | Whether it still shows after its end: for `rest` milliseconds, unless cleared. |
| `clear(id)` | Its rest is over, as when its alert is dismissed. False if it wasn't resting. |
| `keep(ids)` | Drops every other record, and stores the rest if anything changed. Call it after tracking. |

A record holds `since` (when it started), `ended`, `cleared` (its rest is over) and `last`. The glance may add to it.

- **Seen for the first time,** the state's last change stands in for now.
- **A run first seen already over,** with no record of it (a new display, or Home Assistant restarted), isn't shown as just ended.
- **A door opened after the end** ends the rest.

### Alert row

Håg draws it above every glance, by the same rules for every glance:

- **When and where:** Håg decides. A full-width band through the middle.
- **What the glance is told:** `haag.alertrow` gives `showing`, and the band's `top` and `bottom` in pixels. A `haag-alertrow` event on the glance says when it changes.
- **What the glance does:** keeps its content out of the band, or moves it aside as the default glance's center blocks do.
- **Sending alerts:** `haag.alerts`, the same API Håg's own alerts use. See [alerts](alerts.md).
- **Touch:** a tap on an alert shows its glance; the next tap snoozes it. See [alerts](alerts.md#touching-an-alert).

### The clock

The time belongs to Håg. It draws one clock, above the glance and below the alert row, and keeps it to Home Assistant's time zone and time format. The glance says where it goes and how it looks:

```js
haag.clock.place({ x, y, size, ampm, color, align });
```

| | |
|---|---|
| `x`, `y` | The top-left of the numerals' box, in pixels from the stage's top-left. With `align: 'colon'`, `x` is where the colon's middle goes, and it stays there as the time changes. |
| `size` | The numerals' font size, in pixels. |
| `ampm` | AM/PM's font size, in pixels. If left out, in Overview's proportion to the numerals. |
| `color` | Any CSS color Håg can read: its palette or a color value, not the glance's own variables. `--text` if left out. |

- **When:** place it once it's known, also while off screen, and again when it changes. On screen, a new place slides there, a new size scaling with it, in Håg's usual move, 700 ms.
- **Measuring:** `haag.clock.measure(size, ampm)` gives its `width` with AM/PM, its `height`, and `colon`, the colon's middle from its left.
- **The text:** `haag.clock.time` and `haag.clock.period` give the time and AM/PM (empty on 24 hours), for a layout that measures its own copy. Overview does.
- **Drawing over it:** a `<slot name="clock"></slot>` in the glance's shadow root puts the clock at that level, so what comes later crosses over it, as Overview's fog does. Between glances it's above both.

A glance that doesn't place it gets the clock front and center: its colon on the screen's vertical axis, the numerals in the middle, or just above the alert row while it shows, at 14 units in `--text`. Every glance shows the clock.

### Transitions

Håg moves between glances the same way for every glance, in 1.3 seconds:

- **The rays** from the center turn from one glance's wedges to the next's: 180° between the same number, otherwise 360°, splitting or merging on the way, the colors crossfading inside them. To or from a single wedge, the rays turn as the single color grows from the center or as they open from it.
- **The scene** fades, in place.
- **Text** bursts straight out from the center, growing as it fades, and comes back in the same way.
- **The clock** slides and scales to its new place, with the rays.
- **The alert row** stays put.

With reduced motion, or when a glance gives no parts, it's a crossfade. A glance gives its parts through a method on the element, which Håg calls as a transition starts:

```js
parts() {
  return {
    wedges: [{ from: 135, to: 315, color: 'var(--sky)' }, { from: 315, to: 495, color: 'var(--home)' }],
    scene: [this._weather],
    text: [this._title, [this._label, this._value]],
    turn(spans, opacity) {},
    done() {},
  };
}
```

| | |
|---|---|
| `wedges` | Required. The background, all the way around: degrees clockwise from 3 o'clock, each with a color Håg can read. One wedge is a single color. |
| `scene` | Elements in the background to fade, such as weather. |
| `text` | Blocks of text. An array moves as one block. |
| `turn(spans, opacity)` | Optional. Called on every frame to draw a scene through the turning wedges: `spans` matches `wedges`, each with its `from` and `to` now, and `opacity` is how far the scene has faded in or out. |
| `done()` | Optional. The transition is over: draw at rest again, and lay out if you held off. |

- **The background:** Håg paints the wedges under the glances and sets the `between` attribute on both, so a glance stops painting its own: `:host([between]) .stage { background: none; }`.
- **Styles:** Håg sets `opacity` on the scene, and `translate`, `scale`, `transform-origin` and `opacity` on the text, and clears them after. Leave those to Håg on these elements.
- **Measuring:** while the `between` attribute is set, the text is moving and scaled, so `getBoundingClientRect` and the [layout helpers](#layout-helpers) give the wrong sizes. Hold off laying out, then lay out in `done()`, which Håg calls with the attribute gone and the styles cleared.
- **On screen:** both glances are during a transition, so `haag.visible` stays true for the leaving one until it ends.

Between [instances](#instances) of one glance, Håg wipes instead, in a second: the next instance sweeps in over the one showing, around the center, starting on the split, its text with it. The clock stays above both, then moves to its new place. Nothing is restyled, so there's no `between` attribute and no `parts()`; with reduced motion, it's a crossfade.
