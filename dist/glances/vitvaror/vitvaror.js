// Appliance Glance: washers, dryers, washer-dryers and dishwashers while
// they run, and for a while after a cycle ends. Its code loads only when
// it's on.
const manifest = {
  format: 'haag-glance/v1',
  name: 'vitvaror',
  element: 'haag-vitvaror',
  title: 'Appliance Glance',
  version: '0.5.0',
  settings: [
    { key: 'rest', type: 'seconds', default: 7200, min: 60, max: 86400, label: 'Rest',
      help: 'How long a machine stays after its cycle ends, unless its door opens or the alert is dismissed' },
    { key: 'easter_eggs', type: 'boolean', default: true, label: 'Easter eggs' },
    // A machine's entity → a contact sensor on its door.
    { key: 'doors', type: 'links', gui: false, label: 'Doors' },
  ],
  alerts: [
    { key: 'ended', label: 'Cycle ended', dismiss: true },
    { key: 'error', label: 'Errors', snooze: 900 },
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
