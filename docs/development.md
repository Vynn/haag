# Development

Håg has no build step. The plugin is plain JavaScript, CSS and HTML in `dist/`, readable and editable as published.

## Layout

| Folder | Contents | Installed? |
|---|---|---|
| `dist/` | The plugin: `haag.js` and its assets | Yes |
| `design/` | Design studies | No |
| `tools/` | Local development tools | No |
| `docs/` | Documentation | No |

## Local test page

The test page shows the live card against your Home Assistant, outside Home Assistant itself.

1. Start the local server (Python 3, standard library only):

   ```sh
   python3 tools/dev-server.py
   ```

2. Open `http://127.0.0.1:8117/tools/`.
3. Enter your Home Assistant URL and a long-lived access token, and connect.

The URL and token are stored only in that browser, and **Forget** removes them. The server listens on this machine only and never caches, so a reload shows the latest code.

The test page can preview square, portrait and landscape shapes, toggle the alert row, and try settings as JSON.

## Third-party code

Development tools vendor two packages. Each has its source, version, integrity hash and license next to it:

- `tools/vendor/home-assistant-js-websocket/`: Home Assistant's WebSocket client (Apache-2.0).
- `tools/vendor/mdi/`: the Material Design Icons Håg uses, for a stand-in `ha-icon` (Apache-2.0).

Neither is part of the installed plugin. Inside Home Assistant, Håg uses Home Assistant's own icons.
