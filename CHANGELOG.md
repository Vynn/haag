# Changelog

All notable changes, by version. Versions follow the [roadmap](ROADMAP.md): a minor version per milestone, patch versions for fixes.

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
