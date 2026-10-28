# Changelog

All notable changes, by version. Versions follow the [roadmap](ROADMAP.md): a minor version per milestone, and until 1.0 patch versions for the builds between them.

## Unreleased

### Added

- Appointments that are soon show their location (up to the first comma or parenthesis) under the title.

### Changed

- Appointment lines start at the outdoor temperature and each runs to the split, cut off where it would cross it, instead of being trimmed to the second-longest line.
- "Soon" (the breathing) now means starting within the hour, or started within the last two hours and still on; an all-day event today counts when nothing else does.

## 0.1.2 · 2026-10-28

A pre-release build of work toward 0.2.

### Added

- Glances: Håg's own units of display, distinct from Home Assistant cards. Each is turned on in settings, asks for the screen when it has something to show, and takes turns with others on a 30-second cycle (`cycle`). See [glances](docs/glances.md).
- The default glance (`default`), shown when nothing else needs the screen: Overview Glance, the idle screen from 0.1.
- A startup alert with a countdown, which turns critical with troubleshooting links if nothing can show after 60 seconds.
- Day and night colors, switching over 2.5 seconds at sunrise and sunset. The `theme` setting keeps one instead (`dark` or `light`).

### Changed

- The idle screen is now Overview Glance, in its own files under `glances/`. The alert row belongs to Håg itself, above every glance.
- The wireframe greys and the placeholder weather hatch are replaced by the palette: sky with a horizon glow outdoors, a calm base indoors.
- Without Home Assistant's sun entity, night now starts at 18:00 (was 20:00).

## 0.1.1 · 2026-10-27

### Added

- Open Sans, bundled with Håg, as the typeface for all text (SIL Open Font License 1.1). No external font service is used. Where it can't load, the system font is used instead.

## 0.1.0 · 2026-10-26

The idle screen (pre-alpha). First release.

### Added

- Dashboard strategy (`custom:haag`) that creates a full-screen dashboard from Home Assistant's registries.
- Idle screen with a diagonal outdoor/indoor split, laid out for square, portrait and landscape displays.
- Clock and date.
- Outdoor conditions: temperature, humidity and air quality, with automatic source selection.
- One row per indoor floor: heating and cooling status, temperature, humidity, air quality and people.
- People away from home, with profile pictures or initials.
- Upcoming appointments from Home Assistant calendars.
- Icons from Home Assistant's built-in icon set.
- Design studies for the layout, the day and night palettes, and the weather backgrounds.
