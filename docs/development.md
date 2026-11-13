# Development

Håg has no build step. The plugin is plain JavaScript, CSS and HTML in `dist/`, readable and editable as published.

## Layout

| Folder | Contents | Installed? |
|---|---|---|
| `dist/` | The plugin: `haag.js`, its glances and assets | Yes |
| `design/` | Design studies | No |
| `tools/` | Local development tools | No |
| `docs/` | Documentation | No |

## Local test page

The test page shows Håg live against your Home Assistant, outside Home Assistant itself.

1. Start the local server (Python 3, standard library only):

   ```sh
   python3 tools/dev-server.py
   ```

2. Open `http://127.0.0.1:8117/tools/`.
3. Enter your Home Assistant URL and a long-lived access token, and connect.

The URL and token are stored only in that browser, and **Forget** removes them. The server listens on this machine only and never caches, so a reload shows the latest code.

The test page can preview square, portrait and landscape shapes, show a sample alert, pick a weather condition, pick sample weather alerts in each supported source's shape, and try settings as JSON. The weather and alert picks apply on the test page only. Håg's version shows small at the bottom center, for testing.

It also loads the Test glance (`tools/glances/test/`), a stand-in second glance that isn't shipped. Turned on, it asks for the screen for 5 seconds, then lets go for 25.

## Readings check

The readings check runs Håg on a stand-in Home Assistant kept in the page: a small house, one machine for each appliance integration and one printer for each printer integration. It steps their states through a few cycles and compares what Håg shows, raises and keeps after each step with `tools/readings.json`.

1. Start the local server, as above.
2. Open `http://127.0.0.1:8117/tools/readings.html`. After about 15 seconds it says whether every reading matches, and lists those that don't.

- It reaches no real Home Assistant, runs at one fixed moment, and keeps Håg's browser storage to itself.
- After an intended change, look over the new readings (the box at the bottom of the page) and save them as `tools/readings.json`.
- For layout work, `?size=450x800` runs it at another size, and `window.placements` holds where every block was put at each step, to compare before and after a change. Placements depend on the machine's fonts, so none are kept.

It checks readings and wording, not drawing: look at the test page for that.

## Third-party code

The plugin bundles one third-party file:

- `dist/assets/open-sans.ttf`: Open Sans, variable weight (300–800) and width (75–100%), unmodified. Source: [googlefonts/opensans](https://github.com/googlefonts/opensans) at commit `bd7e376`, `fonts/variable/OpenSans[wdth,wght].ttf`, renamed. SHA-256 `36643644f318a812aab2d2ed3bb98f8cf0872527f835fe9398d95fe6b9adb878`. License: SIL Open Font License 1.1, in `dist/assets/OFL.txt`.

Development tools vendor two packages. Each has its source, version, integrity hash and license next to it:

- `tools/vendor/home-assistant-js-websocket/`: Home Assistant's WebSocket client (Apache-2.0).
- `tools/vendor/mdi/`: the Material Design Icons Håg uses, for a stand-in `ha-icon` (Apache-2.0).

Neither is part of the installed plugin. Inside Home Assistant, Håg uses Home Assistant's own icons.
