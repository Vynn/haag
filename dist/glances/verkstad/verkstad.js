// Workshop glance: 3D printers while they print, and for a while after a
// print ends, one printer at a time, with an alert when one finishes,
// fails or needs attention. Its code loads only when it's on.
const manifest = {
  format: 'haag-glance/v1',
  name: 'verkstad',
  element: 'haag-verkstad',
  instances: { element: 'haag-verkstad-printer', max: 3 },
  title: 'Workshop',
  version: '0.6.4',
  settings: [
    { key: 'rest', type: 'seconds', default: 7200, min: 60, max: 86400, label: 'Rest',
      help: 'How long a printer stays after its print ends, unless its door opens or the alert is dismissed' },
    { key: 'camera', type: 'choice', default: 'snapshots', choices: ['snapshots', 'live'],
      labels: { snapshots: 'Snapshots', live: 'Live' }, label: 'Camera',
      help: 'A snapshot every 10 seconds, or live at a frame a second' },
  ],
  alerts: [
    { key: 'finished', label: 'Print finished', dismiss: true },
    { key: 'failed', label: 'Print failed', dismiss: true },
    { key: 'error', label: 'Printer needs attention', snooze: 900 },
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
