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

The test page can preview square, portrait and landscape shapes, toggle the alert row, pick a weather condition (on the test page only), and try settings as JSON.

It also loads Test Glance (`tools/glances/test/`), a stand-in second glance that isn't shipped. Turned on, it asks for the screen for 5 seconds, then lets go for 25.

## Third-party code

The plugin bundles one third-party file:

- `dist/assets/open-sans.ttf`: Open Sans, variable weight (300–800) and width (75–100%), unmodified. Source: [googlefonts/opensans](https://github.com/googlefonts/opensans) at commit `bd7e376`, `fonts/variable/OpenSans[wdth,wght].ttf`, renamed. SHA-256 `36643644f318a812aab2d2ed3bb98f8cf0872527f835fe9398d95fe6b9adb878`. License: SIL Open Font License 1.1, in `dist/assets/OFL.txt`.

Development tools vendor two packages. Each has its source, version, integrity hash and license next to it:

- `tools/vendor/home-assistant-js-websocket/`: Home Assistant's WebSocket client (Apache-2.0).
- `tools/vendor/mdi/`: the Material Design Icons Håg uses, for a stand-in `ha-icon` (Apache-2.0).

Neither is part of the installed plugin. Inside Home Assistant, Håg uses Home Assistant's own icons.
