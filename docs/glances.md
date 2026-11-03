# Glances

> **Pre-release.** Built in 0.1.2. ◇ marks what's still a proposal.

Håg is its own glanceable dashboard framework, built as a Home Assistant dashboard strategy. Everything it shows is a glance.

- **The default glance** shows when nothing else needs the screen. Håg's is `sinnesro`, shown as Overview Glance: the time, the weather, indoors and outdoors.
- **Other glances** are off until turned on. Once on, they run in the background and ask for the screen when they have something to show.
- **Taking turns:** glances with something to show take turns with the default glance, 30 seconds each. All are equal: none cuts in, and alerts bring up only the alert row.

Håg's main file is the core. It draws the alert row and provides what glances share: discovery, alerts, the typeface, day and night colors, icons and the diagonal layout.

Håg is open source, and every glance, built in or not, follows this one contract.

## Glances aren't cards

A glance isn't a Home Assistant card, and the difference is deliberate:

- You don't place glances on a dashboard. Håg shows each one when it's relevant.
- Håg owns the screen. Layout, colors, typeface and the alert row are the same for every glance.
- A glance works only inside Håg.
- Underneath, Håg fills its dashboard with a single Home Assistant card that hosts the glances.

For authors, a glance is still a web component, and it gets Home Assistant's state the way a card does.

## Install, turn on, configure

Built-in glances come with Håg. Other glances install like any dashboard plugin, through HACS or the Home Assistant Marketplace. Either way, turn them on in settings:

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

- One entry per glance, under its name. Entry order is the order glances take turns, after the default glance.
- A glance with no entry, or with `enabled: false`, is off and isn't loaded. Built-in glances too.
- `default` names any installed glance. The default glance is on unless its entry says `enabled: false`.
- `cycle` sets the seconds per turn, 10 to 60 (30 if left out), in YAML or the editor's General section.

Shared settings are in [configuration](configuration.md).

## Names

- Unique, starting with a letter, and made of lowercase letters, digits, `_` and `-`.
- A clash with a built-in glance: the built-in runs, the other is ignored.
- Two other glances with one name: neither runs.
- Either way, a notice names the glances and their files.
- Display names follow one pattern: *Subject* Glance, such as Laundry Glance.

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
  title: 'My Glance',
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
| `title` | The name people see: *Subject* Glance. |
| `version` | The glance's version. |
| `settings` | Optional: the glance's settings, below. |

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
| `key` | The setting's name in the entry. Not `enabled`, which is Håg's. |
| `type` | `text`, `number`, `seconds`, `time` (`"22:00"`), `choice`, `boolean`, `entity` or `entities`. |
| `default` | The value when it's left out, or can't be used. |
| `label`, `help` | What the editor shows. |
| `min`, `max`, `step`, `unit` | For `number`: its range, step, and unit as shown. |
| `choices`, `labels` | For `choice`: the values, and a name for each in the editor. |
| `filter` | For `entity` and `entities`: which entities to offer, as Home Assistant's entity selector takes it (e.g. `{ domain: 'sensor' }`). |

Settings for a glance's alerts (`alerts.<name>`) come with the first glance that raises alerts (0.5).

### The glance

`glance.js` defines a web component under the manifest's `element`:

```js
// glance.js
class MyGlance extends HTMLElement {
  setConfig(settings) {}   // its entry from settings
  set hass(hass) {}        // Home Assistant's state, on every change
  set haag(haag) {}        // what Håg provides, below
}
customElements.define('my-glance', MyGlance);
```

`setConfig` and `hass` work as in Home Assistant's own cards. If the tag is already taken, the glance fails to load and Håg gives a notice.

Every glance fills its screen with at least a background color. It can use Håg's colors or a palette of its own.

### Asking for the screen

The default glance never asks. Other glances:

- `haag.request()`: something to show.
- `haag.release()`: done.
- `haag.visible`: whether the glance is on screen. A `haag-visible` event on the glance says when it changes; the glance pauses animation while hidden.

Håg runs the turns:

- **Order:** the default glance, then the glances asking, in entry order, `cycle` seconds each. With nothing else asking, the default glance shows alone.
- **Joining:** a glance that asks joins once the glance on screen has had a full turn.
- **Leaving:** a glance that releases leaves at once, and the next one gets a full turn.
- **Timing is Håg's:** a glance only says whether it has something to show.
- **Alerts don't change the turns.** A glance can show an alert's state in its own content, but it keeps its place.
- **Touch:** a tap on the right half of the screen goes to the next glance, and on the left half to the one before; that glance gets a full turn. Taps just above and below the alert row do nothing, and taps on it are the alert's (see [alerts](alerts.md#touching-an-alert)).

Switching between glances is a crossfade until transitions arrive in 0.5.1.

### What Håg provides

| | |
|---|---|
| `haag.providers` | Discovery results (`outdoor`, `floors`, `people` with each person's `calendars`, `calendars`), with settings applied, and readers for their current state: `value(ref)`, `unit(ref)`, `hvac(climate)`, `locate()`. |
| `haag.colorOf(entity_id, on)` | A person's or calendar's color, as a CSS color readable at 4.5:1 on `'sky'` or `'home'` (the default), by day and by night. It follows the switch between them on its own. `null` for anything else. |
| `haag.daylight` | Whether day colors are showing: the `theme` setting, or the sun when it's `auto`. |
| `haag.easterEggs` | Whether easter eggs are on overall (the `easter_eggs` setting). A glance with easter eggs shows them only when this is on; its own setting can turn them off just for it. |
| `haag.layout` | The shared geometry: the split's `angle` (the line runs through the center). Helpers for placing content along it move here with the second glance (0.5). |
| `haag.icon(element, name)` | Draws a Home Assistant icon, filling the element. Fitting it to the text is up to the glance. |
| `haag.alerts` | This glance's alerts: `set`, `delete` and `clear`. See [alerts](alerts.md#the-alerts-api). |
| `haag.alertrow` | Whether the alert row shows, and where. |

Inherited through CSS: the typeface, the size unit `cqmin` (1% of the shorter side), and the palette:

| Color | Use |
|---|---|
| `--sky`, `--horizon` | The outdoor side and its glow near the split. |
| `--home` | The indoor side. |
| `--text`, `--text-2` | Text and secondary text. `--text-2-out` is secondary text on the sky. |
| `--coral`, `--seaglass` | Accents: heating and errors, cooling. |
| `--band`, `--mist` | The alert row's information wash (near-white, by day and by night), and haze. |

Each mixes a night and a day value (`--n-sky`, `--d-sky`, …) by `--haag-daylight`, 0 at night and 1 by day, which switches over 2.5 seconds.

### Alert row

Håg draws it above every glance, by the same rules for every glance:

- **When and where:** Håg decides. A full-width band through the middle.
- **What the glance is told:** `haag.alertrow` gives `showing`, and the band's `top` and `bottom` in pixels. A `haag-alertrow` event on the glance says when it changes.
- **What the glance does:** keeps its content out of the band, or moves it aside as the default glance's center blocks do.
- **Sending alerts:** `haag.alerts`, the same API Håg's own alerts use. See [alerts](alerts.md).
- **Touch:** a tap on an alert shows its glance; the next tap snoozes it. See [alerts](alerts.md#touching-an-alert).

## Not decided yet

- **Transitions** (0.5.1): Håg will run them the same way for every glance, so each glance will describe its parts to Håg. How is still to come.
