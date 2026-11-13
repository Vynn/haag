// Overview glance: Håg's default glance. Its code loads only when it's on.
const manifest = {
  format: 'haag-glance/v1',
  name: 'sinnesro',
  element: 'haag-sinnesro',
  title: 'Overview',
  version: '0.7.0',
  settings: [
    { key: 'appointments', type: 'number', default: 4, min: 1, step: 1, label: 'Appointments',
      help: 'The most shown; the furthest go first when space runs short' },
    { key: 'days', type: 'number', default: 30, min: 1, step: 1, unit: 'days', label: 'Days ahead',
      help: 'How far ahead appointments come from' },
    { key: 'easter_eggs', type: 'boolean', default: true, label: 'Easter eggs',
      help: "What's caught in a tornado, the spider, the dragon, and odd things on the wind; off here even when they're on overall" },
  ],
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
