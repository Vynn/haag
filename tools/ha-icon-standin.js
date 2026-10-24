/*
  Håg dev tooling: a stand-in for Home Assistant's `ha-icon` element.

  Inside HA, Håg draws its icons with HA's own `ha-icon` (D17), which loads
  Material Design Icons on demand. The test page runs outside HA, so this
  defines a small `ha-icon` that draws the same icons from the vendored
  extract in vendor/mdi/. It is only defined when HA's isn't.

  Mirrors HA's element as far as Håg relies on it:
    icon attribute   "mdi:<name>"; an unknown name draws nothing
    size             --mdc-icon-size (default 24px), on an inline-flex box
    color            the current text color

  Not part of the plugin install.
*/

import * as mdi from './vendor/mdi/icons.js';

// "mdi:calendar-arrow-right" → the export mdiCalendarArrowRight.
const pathFor = name => {
  const [prefix, id] = String(name || '').split(':');
  if (prefix !== 'mdi' || !id) return null;
  return mdi['mdi' + id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('')] || null;
};

class HaIconStandin extends HTMLElement {
  static observedAttributes = ['icon'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { fill: currentcolor; }
        .box {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          position: relative;
          vertical-align: middle;
          width: var(--mdc-icon-size, 24px);
          height: var(--mdc-icon-size, 24px);
        }
        svg { width: 100%; height: 100%; display: block; pointer-events: none; }
      </style>
      <span class="box"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true"><path></path></svg></span>`;
  }

  get icon() { return this.getAttribute('icon') || ''; }
  set icon(name) { this.setAttribute('icon', name); }

  attributeChangedCallback() {
    const d = pathFor(this.icon);
    const path = this.shadowRoot.querySelector('path');
    if (d) path.setAttribute('d', d);
    else path.removeAttribute('d');
    if (!d && this.icon) console.warn(`ha-icon stand-in: ${this.icon} isn't in tools/vendor/mdi/icons.js`);
  }
}

if (!customElements.get('ha-icon')) customElements.define('ha-icon', HaIconStandin);
