/*
  Test Glance: placeholder text on a plain fill. It asks for the screen for
  5 seconds, then lets go for 25, so turns show on the test page.
  License: GPL-3.0
*/

const ON = 5;    // seconds asking
const OFF = 25;  // seconds letting go

const STYLE = `
  :host { display: block; background: #c8c8c8; }
  /* Upper half, clear of the alert row. */
  p { position: absolute; inset: 0 0 50%; display: grid; place-items: center; margin: 0; font-size: calc(8 * var(--u)); }
`;

class TestGlance extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `<style>${STYLE}</style><p>Test Glance</p>`;
  }

  setConfig() {}
  set hass(hass) {}
  set haag(haag) { this._haag = haag; }

  connectedCallback() { this._ask(); }
  disconnectedCallback() { clearTimeout(this._timer); }

  _ask() {
    this._haag.request();
    this._timer = setTimeout(() => this._letGo(), ON * 1000);
  }

  _letGo() {
    this._haag.release();
    this._timer = setTimeout(() => this._ask(), OFF * 1000);
  }
}

customElements.define('haag-test', TestGlance);
