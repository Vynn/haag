// Appliance Glance: washers, dryers and dishwashers while they run, and
// loads waiting to be emptied. Its code loads only when it's on.
const manifest = {
  format: 'haag-glance/v1',
  name: 'vitvaror',
  element: 'haag-vitvaror',
  title: 'Appliance Glance',
  version: '0.5.0-dev',
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
