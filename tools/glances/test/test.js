// Test Glance: a stand-in second glance for the test page. Not shipped.
const manifest = {
  format: 'haag-glance/v1',
  name: 'test',
  element: 'haag-test',
  title: 'Test Glance',
  version: '0.0.0',
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
