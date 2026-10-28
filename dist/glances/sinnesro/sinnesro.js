// Overview Glance: Håg's default glance. Its code loads only when it's on.
const manifest = {
  format: 'haag-glance/v1',
  name: 'sinnesro',
  element: 'haag-sinnesro',
  title: 'Overview Glance',
  version: '0.1.1',
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
