# Roadmap

Håg grows one milestone at a time. Each milestone is a minor version (0.2, 0.3, …) until 1.0, which is feature complete. Bug fixes are patch versions (0.1.1, …).

The criteria under each milestone are a working list. They'll be refined as each milestone is worked on, and this file is kept in step with the GitHub milestones and issues.

## 0.1 · The idle screen (pre-alpha) · in progress

The default screen when nothing else needs attention.

- [x] Dashboard strategy: one line of YAML creates the whole dashboard
- [x] Discovery from Home Assistant's registries, with no entity IDs in the code
- [x] Square-first layout with a diagonal split that also works in portrait and landscape
- [x] Clock and date
- [x] Outdoor conditions: temperature, humidity, air quality
- [x] One row per indoor floor: heating and cooling status, temperature, humidity, air quality, and who is on that floor
- [x] People away from home, and the next appointments from Home Assistant calendars
- [x] Icons from Home Assistant's built-in icon set
- [ ] Animated weather background for all 15 Home Assistant weather conditions
- [ ] Day and night colors, switching at sunrise and sunset
- [ ] Bundled typeface
- [ ] Installs through HACS (and the Home Assistant Marketplace from 2026.11)

## 0.2 · Alerts and notices

- [ ] The alert row shows real alerts, with clear severity (information, warning, critical)
- [ ] Notices for doors and garage doors left open, low batteries, water leaks and available updates
- [ ] Priority and rotation when several notices are active

## 0.3 · Laundry card

The first card, which also sets up how every card works.

- [ ] Card architecture: how cards are added, documented
- [ ] Cards appear only when relevant and give way to the idle screen afterwards
- [ ] Transitions between the idle screen and cards
- [ ] Touch to move between cards or pause
- [ ] Shows while the washer or dryer is running, and when a load is done
- [ ] Cycle progress, time remaining and finish time
- [ ] Current phase (wash, rinse, spin, dry) where available
- [ ] Washer and dryer together when both are running
- [ ] A finished load waiting to be emptied (until the door opens, where a door sensor exists)
- [ ] Errors shown clearly

## 0.4 · 3D printer card

- [ ] Shows while a print is running, and for a while after it finishes or fails
- [ ] Progress, time remaining and estimated finish time
- [ ] State at a glance: heating, printing, paused, finished, error
- [ ] Print name, and a model preview or camera image where available
- [ ] Nozzle and bed temperatures
- [ ] More than one printer

## 0.5 · Configuration editor

- [ ] A visual settings editor in Home Assistant's dashboard editor, matching the YAML
- [ ] Settings for people and calendars, including colors and linked people
- [ ] Settings for each card
- [ ] Versioned settings format, with import and export

## 0.6 · Irrigation card

- [ ] Shows while watering, and shortly before a scheduled run
- [ ] Active zone and time remaining
- [ ] Next scheduled run
- [ ] Skipped or delayed runs (rain, wind, freeze) with the reason
- [ ] Controller offline or in error

## 0.7 · EV charging card

- [ ] Shows while a car is plugged in or charging
- [ ] Charging power, and energy added this session
- [ ] Time plugged in, and when charging finished
- [ ] Car battery level and range, where a car integration provides them
- [ ] More than one charger
- [ ] Charger faults shown clearly

## 0.8 · Doorbell and deliveries card

- [ ] Shows when someone is at the door, with a camera snapshot
- [ ] A package detected at the door, until it's picked up
- [ ] Which door
- [ ] Only people, packages and rings, not routine motion
- [ ] Snapshots only, nothing stored, and each camera can be turned off

## 0.9 · Display care

- [ ] Night dimming
- [ ] Burn-in protection
- [ ] Light theme option
- [ ] Settings per display

## 0.10 · Reach

- [ ] 24-hour time and translations
- [ ] Accessibility review (contrast, motion, readability at a distance)
- [ ] Supported browsers defined and tested
- [ ] Tested on other people's Home Assistant setups

## 1.0 · Feature complete

- [ ] Cards and notices share one priority order
- [ ] Stable settings format
- [ ] Complete documentation
- [ ] Listed in the default HACS and Home Assistant Marketplace catalog

## Candidates (not scheduled)

- **Now playing** (after 1.0): what's playing in which room, with artwork.
- **Robot vacuum** (after 1.0): cleaning now and where, the map, stuck or in error, the dock needing attention.
- **Dishwasher** (to decide): running, finish time, clean dishes waiting to be emptied.
