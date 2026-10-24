# Vendored: Material Design Icons (extract)

Used by the dev test page in `tools/` only, as path data for a stand-in `ha-icon`. Not part of the Håg plugin install: inside Home Assistant, HA supplies the icons itself (D17).

- Package: `@mdi/js` 7.4.47 (Pictogrammers' Material Design Icons, path data as JS)
- Source: https://registry.npmjs.org/@mdi/js/-/js-7.4.47.tgz
- Integrity (verified against the npm registry): `sha512-KPnNOtm5i2pMabqZxpUz7iQf+mfrYZyKCZ8QNz85czgEt7cuHcGorWfdzUMWYA0SD+a6Hn4FmJ+YhzzzjkTZrQ==`
- Files:
  - `icons.js`: an extract of the package's `mdi.js`. Only the icons Håg uses are kept, and each `export var` line is copied unmodified. A header notes the change, as Apache-2.0 section 4(b) requires.
  - `LICENSE`: the package's own license file (Pictogrammers Free License), unmodified.
  - `LICENSE-Apache-2.0.md`: the Apache License 2.0 text, which the Pictogrammers license refers to. Copied from `../home-assistant-js-websocket/LICENSE.md`.
- The package has no NOTICE file.
- License: icons Apache-2.0 (the Brand / Logos category is excluded, and none of these icons are in it). Apache-2.0 can be included in GPL-3.0 projects ([ASF](https://www.apache.org/licenses/GPL-compatibility.html)).
- Upstream: https://github.com/Templarian/MaterialDesign-JS · https://pictogrammers.com/docs/general/license/

Icons kept (D83–D88): fire, snowflake, fan, thermostat, power-off, alert, thermometer, thermometer-low, thermometer-high, water-percent, sprout, molecule, radioactive, molecule-co, leaf, calendar-clock, calendar-arrow-right, calendar-alert, party-popper, information, alert-octagon.

To add an icon or update: download a package version, verify its integrity hash, copy the needed `export var mdi…` lines from its `mdi.js` unchanged, and update the version, hash and icon list here.
