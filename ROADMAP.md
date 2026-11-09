# Roadmap

Håg grows one milestone at a time. Each milestone is a minor version (0.2, 0.3, …) until 1.0, which is feature complete. Until then every build is a pre-release, and builds between milestones are patch versions (0.1.1, 0.1.2, …). From 1.0, pre-releases are marked as such and patch versions are bug fixes.

The criteria under each milestone are a working list. They'll be refined as each milestone is worked on, and this file is kept in step with the GitHub milestones and issues.

## 0.1 · The idle screen (pre-alpha) · released

The default screen when nothing else needs attention.

- [x] Dashboard strategy: one line of YAML creates the whole dashboard
- [x] Discovery from Home Assistant's registries, with no entity IDs in the code
- [x] Square-first layout with a diagonal split that also works in portrait and landscape
- [x] Clock and date
- [x] Outdoor conditions: temperature, humidity, air quality
- [x] One row per indoor floor: heating and cooling status, temperature, humidity, air quality, and who is on that floor
- [x] People away from home, and the next appointments from Home Assistant calendars
- [x] Icons from Home Assistant's built-in icon set
- [x] Installs through HACS

## 0.2 · Weather and color · released

The idle screen's illustrated look, and how glances work.

- [x] Glance architecture: how glances are installed, turned on and configured, documented (shipped in 0.1.2)
- [x] Glances appear only when relevant and give way to the default glance (Overview Glance) afterwards (shipped in 0.1.2)
- [x] Several glances take turns on a 30-second timer, adjustable in YAML (shipped in 0.1.2)
- [x] Animated weather background for all 15 Home Assistant weather conditions
- [x] Day and night colors, switching at sunrise and sunset (shipped in 0.1.2)
- [x] Bundled typeface (shipped in 0.1.1)
- [x] Icon refinements to suit the new backgrounds

## 0.3 · Alerts and notices · released

- [x] The alert row shows real alerts, with clear severity (information, warning, critical)
- [x] Alerts for water leaks; smoke, CO and gas; doors, windows, garage doors and gates left open; locks; and air quality
- [x] Weather alerts from MeteoAlarm, DWD, Environment Canada, NINA, NWS Alerts, Weather Alerts and CAP Alerts
- [x] Glances can send alerts to the alert row
- [x] Håg's own notices shown in the alert row
- [x] Priority and rotation when several notices are active

## 0.4 · Configuration editor (alpha) · released

- [x] A visual settings editor in Home Assistant's dashboard editor, matching the YAML
- [x] Settings for people and calendars, including colors and linked people
- [x] Settings for each glance
- [x] Settings for alerts: which are on, their sensors, thresholds and timings
- [x] Warnings for entities missing an area or other fields Håg uses

## 0.5 · Appliance glance · released

The first glance after Overview Glance: washers, dryers, washer-dryers and dishwashers.

- [x] Glances take turns, the default glance among them, with no priority or cooldown
- [x] Transitions between glances (0.5.1)
- [x] Touch to move between glances
- [x] Snoozing alerts by touch
- [x] Shows while a machine is running, and for a while after its cycle ends
- [x] Cycle progress, time remaining and finish time
- [x] Current phase (wash, rinse, spin, dry) where available
- [x] Up to three machines together
- [x] A finished load waiting to be emptied (until the door opens, where a door sensor exists)
- [x] Errors shown clearly
- [x] Alert settings for each glance
- [x] An overall easter eggs setting
- [x] Layout helpers for glance authors
- [x] Installs through the Home Assistant Marketplace, with the first build after the Marketplace's stable release (0.5.1)

## 0.6 · Glance instances

- [ ] A glance can show up to three instances (a printer each, say), sharing its turn
- [ ] A clock wipe between instances, made to be reused
- [ ] Taps step through instances without restarting the turn

## 0.6.1 · 3D printer glance

- [ ] Bambu Lab printers
- [ ] Shows while a print is running, and for a while after it finishes or fails
- [ ] Progress, time remaining and estimated finish time
- [ ] State at a glance: preparing, heating, printing, paused, finished, failed
- [ ] Print name, and a model preview or camera image where available
- [ ] Camera as snapshots, or live at up to one frame a second
- [ ] Nozzle, bed and chamber temperatures, and fans
- [ ] Two-nozzle printers, with tool changers planned
- [ ] Progress in the loaded filament's color
- [ ] More than one printer: up to three take turns, most urgent first, with a count of the rest

## 0.6.2 · 3D printer alerts

- [ ] Alerts for a finished print and a failed print, with settings

## 0.6.3 · More 3D printers

- [ ] OctoPrint, PrusaLink, Moonraker (Klipper), Dremel and Repetier

## 0.7 · Irrigation glance

- [ ] Shows while watering, and shortly before a scheduled run
- [ ] Active zone and time remaining
- [ ] Next scheduled run
- [ ] Skipped or delayed runs (rain, wind, freeze) with the reason
- [ ] Controller offline or in error

## 0.8 · EV charging glance

- [ ] Shows while a car is plugged in or charging
- [ ] Charging power, and energy added this session
- [ ] Time plugged in, and when charging finished
- [ ] Car battery level and range, where a car integration provides them
- [ ] More than one charger
- [ ] Charger faults shown clearly

## 0.9 · Doorbell and deliveries glance

- [ ] Shows when someone is at the door, with a camera snapshot
- [ ] A package detected at the door, until it's picked up
- [ ] Which door
- [ ] Only people, packages and rings, not routine motion
- [ ] Snapshots only, nothing stored, and each camera can be turned off

## 0.10 · Display care

- [ ] Night dimming
- [ ] Burn-in protection
- [ ] Light theme option
- [ ] Settings per display

## 0.11 · Reach

- [ ] Translations (24-hour time came in 0.3)
- [ ] Accessibility review (contrast, motion, readability at a distance)
- [ ] Supported browsers defined and tested
- [ ] Tested on other people's Home Assistant setups

## 1.0 · Feature complete

- [x] One rotation: active glances take equal turns in the order they ask, the default first; no priority. Alerts only bring up the row.
- [ ] Stable settings format
- [ ] Complete documentation
- [ ] Listed in the default HACS and Home Assistant Marketplace catalog

## Candidates (not scheduled)

- **Now playing** (after 1.0): what's playing in which room, with artwork.
- **Robot vacuum** (after 1.0): cleaning now and where, the map, stuck or in error, the dock needing attention.
- **Settings import and export** (revisit at 1.0): worth it if it lets glances be bundled with their settings. Home Assistant's code editor already copies settings out and in.
