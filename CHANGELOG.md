# Changelog

All notable changes, by version. Versions follow the [roadmap](ROADMAP.md): a minor version per milestone, and until 1.0 patch versions for the builds between them.

## 0.5.1 · unreleased

In progress.

### Added

- Transitions between glances, in 1.3 seconds: the split turns into the machines' parts, splitting and merging on the way, while the text bursts out and in and the clock slides and scales to its new place. With reduced motion, a crossfade. For glance authors: `parts()`. See [glances](docs/glances.md#transitions).
- The clock is Håg's, and Appliance Glance now shows it: half again the size of the machines' names, its colon on the drum's axis, at the center or just above the alert row. For glance authors: `haag.clock`. See [glances](docs/glances.md#the-clock).
- Install steps for the Home Assistant Marketplace (2026.11 and later) beside HACS (2026.10), with one link that opens either, and how to get pre-releases. See the [README](README.md#install).

### Changed

- Appliance Glance: to make room for the clock, two machines' text sits out along each part's middle instead of side by side at the center, and text slides straight up and down to clear the clock and the alert row. Text shrinks to fit, so it can be smaller than before.

## 0.5.0 · 2026-11-04

The Appliance Glance, and glances taking turns, with touch. A pre-release. See [glances](docs/glances.md).

### Added

- Glances take turns with the default glance, all equal, in the order they ask, `cycle` seconds each (now 10 to 60). A glance that's done leaves at once; alerts bring up only the alert row.
- Touch: a tap on the right half of the screen shows the next glance, on the left half the one before.
- Touching an alert: the first tap shows its glance, the next snoozes it, with an undo. Snoozes are kept on the display, for each alert's `snooze` setting. Glances can make an alert dismissable instead (`dismiss: true`).
- Appliance Glance (`vitvaror`), built in and off until turned on: washers, dryers, washer-dryers and dishwashers while they run. Up to three share one drum, each with its contents, a progress ring and its time left; more wait their turn. Machines starting and stopping sweep the drum's parts to their new places, one change at a time. After a cycle ends, a machine rests on the glance with an alert until its door opens, the alert is dismissed, or `rest` runs out. Reads SmartThings, Whirlpool Appliances, Home Connect, Miele, LG ThinQ, SmartThinQ LGE Sensors and Sub-Zero. Settings: `rest`, `easter_eggs` and `doors`. See [configuration](docs/configuration.md#glances).
- Alert settings for glances: each of a glance's alerts can be turned off or given a snooze, under `alerts.<glance>.<alert>`, in YAML or the editor's Alerts section. For glance authors: the manifest's `alerts`. See [glances](docs/glances.md#alerts).
- For glance authors: `haag.layout.on(stage)`, helpers for measuring content and placing it along the split (Overview Glance's, moved to the core); glance settings of type `links`, and `gui: false` to keep a setting to YAML.
- An overall easter eggs setting (`easter_eggs`, on by default, in the editor's General section) that every glance follows; a glance's own setting can still turn them off just for it. For glance authors: `haag.easterEggs`.

### Changed

- Information alerts are near-white with dark text, by day and by night, to be read first.
- The default glance takes turns with the others instead of waiting until they're done.

### Known issues

- After Home Assistant restarts, a machine that still reports its last cycle as finished can show "Cycle ended" for up to `rest`, on a display with no record of that cycle.

## 0.4.0 · 2026-11-02

The configuration editor: the first alpha. A pre-release. See [configuration](docs/configuration.md).

### Added

- A settings editor in Home Assistant's dashboard editor (⋮ → Edit dashboard), built from Home Assistant's own form: general settings, each glance, people and calendars, outdoor sensors, floors and alerts. It edits the same settings as the YAML, writes only what changes and keeps everything else.
- Alert settings, in the editor and as YAML: which household alerts are on, sensors to leave out, timings, limits, the turn length, and the weather alert source (`alerts`). In the editor, turning an alert on lists the sensors Håg found for it, to untick any that aren't really that thing. See [configuration](docs/configuration.md#alerts).
- Settings for each glance: a glance lists its settings in its manifest; Håg checks them, fills in defaults and shows them in the editor, in a section per glance with its on/off switch in the header. See [glances](docs/glances.md#settings).
- Overview Glance settings: how many appointments (`appointments`), how many days ahead (`days`), and easter eggs on or off (`easter_eggs`).
- Setup warnings: sensors Håg uses that have no area, areas with no floor, and people who are never shown, at the top of the dashboard editor and for five minutes in the alert row; in the editor also a missing outdoor floor, readings in units Håg doesn't read, and a missing sun entity or Moon integration. Each says what follows from it. `warnings.ignore` (YAML only) leaves things out. See [configuration](docs/configuration.md#setup-warnings).
- Things left open or unlocked can turn into a warning: after a time (`warning_after`), or while still open from a time of day (`warning_at`) until another (`warning_until`, else sunrise, else 6:00). Off unless set. The warning shows the longest time open.
- People and calendar colors: a person's icon border and initials, and an appointment's icon and time, take a color. It's the one set in settings, else the calendar's from Home Assistant, else one of six from Håg's palette; a person and their calendar share it. Colors keep their hue and shift in lightness to stay readable by day and by night. See [configuration](docs/configuration.md#people).
- Settings for each person's calendar and colors (`providers.people.calendars`, `colors`). People match their calendars by name without them. In the editor, each person has their calendar, color and who they follow.
- For glance authors: `haag.colorOf(entity_id, on)`, and each person's calendar in `haag.providers.people.calendars`.

### Changed

- Household alerts are off until turned on in settings (`alerts.core.<alert>.enabled`). Weather alerts stay on.
- Every setting is checked the same way: one it can't use gives a notice and falls back to its default.
- Linked people (`providers.people.links`) can be set in the editor; they were YAML-only.

### Fixed

- Overview: the bottoms of letters such as g and y in appointments are no longer cut off.

### Known issues

- In the editor, a color can't be cleared: to go back to the color Håg finds, remove it in the code editor.
- In the editor, a calendar Håg matched to someone can be changed, but not unlinked.

## 0.3.0 · 2026-11-01

Alerts and notices. A pre-release. See [alerts](docs/alerts.md).

### Added

- Alerts in the alert row at three severities: information, warning (yellow) and critical (red), each with its own icon. Only the highest severity present shows; its alerts take turns every 8 seconds, newest first, sliding in from the right. A more severe alert cuts in at once. Long text shrinks to fit one line. The row hides when there's nothing to show.
- Household alerts, found by device class: smoke, carbon monoxide and gas alarms (critical, holding the row); water leaks (a warning, critical after 15 minutes); doors, windows, openings, garage doors and gates left open, and locks left unlocked (information after 5 minutes); jammed locks; indoor CO₂, PM2.5, radon and carbon monoxide past their limits; and outdoor air quality by the scale of the integration reporting it.
- Weather alerts from NINA, Environment Canada, DWD, MeteoAlarm, CAP Alerts, NWS Alerts and Weather Alerts, one source at a time. Extreme alerts hold the row; alerts starting within a day show beforehand.
- Håg's notices (settings it can't use, glances that didn't load, sources it can't read) show in the alert row as well as the browser console.
- Glances can send alerts through `haag.alerts`, the same API Håg's own alerts use.
- Håg's version, shown small at the bottom center for testing.
- Test page: a sample alert, and sample weather alerts in each supported source's shape.

### Changed

- For glance authors: `haag.alert` is now `haag.alertrow`, and its event `haag-alertrow`.
- Times follow Home Assistant's time format, 12 or 24 hours: in alerts, and in Overview's clock and appointments.
- Outdoor air quality skips PurpleAir's VOC index, prefers Google Air Quality's local index over its universal one, and uses AirVisual's and Tomorrow.io's China index when Home Assistant's country is China.
- The alert row no longer shows Håg's version.

### Known issues

- Sensors that Home Assistant classes like the real thing raise alerts: a rain sensor as a water leak, a remote lockout as a lock, an appliance door as a door. They can be left out once the configuration editor arrives, expected in 0.4.

## 0.2.0 · 2026-10-28

Weather and color. A pre-release.

### Added

- Weather backgrounds: an illustrated, animated scene for each of Home Assistant's 15 weather conditions, changing smoothly from one to the next. The sun and moon cross the sky with the day, the moon shows its phase, and clouds, rain and snow follow the wind.
- The moon's phase from Home Assistant's Moon integration, found automatically (`providers.outdoor.moon`).
- Appointments that are soon show their location (up to the first comma or parenthesis) under the title.

### Changed

- The weather comes from any weather entity when the Exterior floor has none.
- Appointment lines start at the outdoor temperature and each runs to the split, cut off where it would cross it, instead of being trimmed to the second-longest line.
- "Soon" (the breathing) now means starting within the hour, or started within the last two hours and still on; an all-day event today counts when nothing else does.
- Icons are sized to the digits beside them, from the baseline to the digit tops, so they no longer look uneven. Spacing is unchanged.
- An idle thermostat shows the thermometer instead of the thermostat dial.

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
