# Glances

> **Pre-release.** Built in 0.1.2, ahead of 0.2. ◇ marks what's still a proposal.

Håg is its own glanceable dashboard framework, built as a Home Assistant dashboard strategy. Everything it shows is a glance.

- **The default glance** shows when nothing else needs the screen. Håg's is `sinnesro`, shown as Overview Glance: the time, the weather, indoors and outdoors.
- **Other glances** are off until turned on. Once on, they run in the background and ask for the screen when they have something to show.
- **Taking turns:** when several glances want the screen, they take turns every 30 seconds. Rules for priority and cooldown come with the second glance.

Håg's main file is the core. It draws the alert row and provides what glances share: discovery, the typeface, day and night colors, icons and the diagonal layout.

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
  cycle: 30             # seconds per turn when several glances want the screen
  glances:
    laundry:            # listed first, so it goes first
      enabled: true
      # …the glance's own settings
    printer:
      enabled: true
```

- One entry per glance, under its name. ◇ Entry order is the order glances take turns.
- A glance with no entry, or with `enabled: false`, is off and isn't loaded. Built-in glances too.
- `default` names any installed glance. The default glance is on unless its entry says `enabled: false`.
- ◇ `cycle` sets the seconds per turn (30 if left out). It's set in YAML only.

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

## Notices

Until real alerts arrive in 0.3, notices go to the browser console. Håg gives one when:

- two glances share a name;
- settings name a glance that isn't installed;
- a glance fails to load;
- a glance's format is one this version of Håg doesn't know.

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
| `version` | The glance's version, shown in notices. |

Fields for the glance's settings (defaults, labels for the 0.6 editor) come later.

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

Switching between glances is a crossfade until transitions arrive in 0.4.

### What Håg provides

| | |
|---|---|
| `haag.providers` | Discovery results (`outdoor`, `floors`, `people`, `calendars`), with settings applied, and readers for their current state: `value(ref)`, `unit(ref)`, `hvac(climate)`, `locate()`. |
| `haag.daylight` | Whether day colors are showing: the `theme` setting, or the sun when it's `auto`. |
| `haag.layout` | The shared geometry: the split's `angle` (the line runs through the center). Helpers for placing content along it move here with the second glance (0.4). |
| `haag.icon(element, name)` | Draws a Home Assistant icon. |
| `haag.alert` | Whether the alert row shows, and where. |

Inherited through CSS: the typeface, the size unit `cqmin` (1% of the shorter side), and the palette:

| Color | Use |
|---|---|
| `--sky`, `--horizon` | The outdoor side and its glow near the split. |
| `--home` | The indoor side. |
| `--text`, `--text-2` | Text and secondary text. `--text-2-out` is secondary text on the sky. |
| `--coral`, `--seaglass` | Accents: heating and alerts, cooling. |
| `--band`, `--mist` | The alert row's wash, and haze. |

Each mixes a night and a day value (`--n-sky`, `--d-sky`, …) by `--haag-daylight`, 0 at night and 1 by day, which switches over 2.5 seconds.

### Alert row

Håg draws it above every glance, by the same rules for every glance:

- **When and where:** Håg decides. A full-width band through the middle.
- **What the glance is told:** `haag.alert` gives `showing`, and the band's `top` and `bottom` in pixels. A `haag-alert` event on the glance says when it changes.
- **What the glance does:** keeps its content out of the band, or moves it aside as the default glance's center blocks do.
- **Touch:** only the row takes touches. What touching an alert does comes in 0.3.

## Not decided yet

- **Behavior rules and cooldown,** drafted with the second glance (0.4): priority, how long a glance keeps the screen after it's done, and a limit for one that never lets go.
