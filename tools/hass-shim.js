/*
  Håg dev tooling: a minimal stand-in for the `hass` object.

  Inside Home Assistant, the frontend hands every card and strategy a `hass`
  object. Outside HA (on the local test page), this module builds a small
  version of it from a live WebSocket connection, using HA's official client
  library (vendored in tools/vendor/).

  Only what Håg uses is provided. Anything Håg starts relying on must be
  added here too, so the test page keeps matching real HA.

    hass.states      live entity states, keyed by entity_id
    hass.config      HA core config (units, time zone, location, version)
    hass.user        the logged-in user (name, is_admin)
    hass.callWS()    send a WebSocket command, get a promise of the result
    hass.hassUrl()   turn an HA-relative path into a full URL
    hass.connection  the underlying connection

  Not part of the plugin install.
*/

import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  subscribeConfig,
  getUser,
} from './vendor/home-assistant-js-websocket/index.js';

/**
 * Connect to Home Assistant and keep a live `hass` object up to date.
 * @param {string} url    HA base URL, e.g. http://homeassistant.local:8123
 * @param {string} token  long-lived access token
 * @param {(hass: object) => void} onUpdate  called with a fresh hass object
 *                                           whenever states or config change
 * @returns {Promise<{hass: object, close: () => void}>}
 */
export async function connectHass(url, token, onUpdate) {
  const base = url.replace(/\/+$/, '');
  const auth = createLongLivedTokenAuth(base, token);
  const connection = await createConnection({ auth });
  const user = await getUser(connection);

  let states = {};
  let config = null;

  // A new object on every change, like the real frontend does, so cards can
  // compare old and new hass to see whether anything changed.
  const build = () => ({
    states,
    config,
    user,
    connection,
    callWS: msg => connection.sendMessagePromise(msg),
    hassUrl: (path = '') => `${base}${path}`,   // absolute URL for HA-relative paths (e.g. pictures)
  });

  // Wait for the first states and config before handing hass out.
  await new Promise(resolve => {
    let gotStates = false, gotConfig = false;
    const ready = () => { if (gotStates && gotConfig) resolve(); };
    subscribeEntities(connection, s => {
      states = s;
      if (!gotStates) { gotStates = true; ready(); } else onUpdate?.(build());
    });
    subscribeConfig(connection, c => {
      config = c;
      if (!gotConfig) { gotConfig = true; ready(); } else onUpdate?.(build());
    });
  });

  const hass = build();
  onUpdate?.(hass);
  return { hass, close: () => connection.close() };
}
