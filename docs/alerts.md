# Alerts

> **Pre-release.** Built in 0.3.

The alert row is a full-width band through the middle of the screen, above every glance. It shows what needs attention now, and hides when nothing does.

Every alert reaches the row the same way, whoever sends it: Håg's own household alerts, weather alerts and notices, the default glance, and any other glance. They all use one API, run by Håg's core, so they look and behave alike.

## Severity

| Severity | Looks | For example |
|---|---|---|
| Information | The band's own wash, in the text color | A door left open, an upcoming storm watch |
| Warning | Yellow, with dark text | A water leak, high CO₂, a jammed lock |
| Critical | Red, with white text | Smoke, carbon monoxide or gas; extreme weather |

Each severity has its own icon. The yellow and red are used for alerts only. The colors are in [design](design.md#alerts).

## Taking turns

- Only the highest severity present shows. Lower ones wait, unmarked, until those clear.
- Alerts at that severity take turns every 8 seconds, newest first.
- A new alert goes next. A more severe one cuts in at once.
- Some critical alerts hold the row: smoke, carbon monoxide and gas alarms, and extreme weather. They take turns among themselves while other critical alerts wait.
- Håg's own startup alert shows alone, with its notices taking turns beside it (see [glances](glances.md#starting-up)).
- A turn slides the old alert out to the left as the band's color changes. With reduced motion, they crossfade.
- Each alert is one line. Long text shrinks to fit, down to 70% of its size, and past that its end is cut, so what matters goes first.
- Touching an alert, and snoozing it, come in 0.5.

## The alerts API

Each source of alerts has its own alerts object. A glance gets its own as `haag.alerts`; Håg's household alerts, weather alerts and notices use the same object inside the core.

```js
// Show an alert, or update it
haag.alerts.set('door', { level: 'warning', text: 'Dryer door open' });

// Remove it
haag.alerts.delete('door');

// Remove all of this glance's alerts
haag.alerts.clear();
```

| Call | |
|---|---|
| `set(key, { level, text })` | Shows an alert, or updates the one with that key. `level` is `info`, `warning` or `critical` (`info` if it's anything else). `text` is one line: subject, then state, in sentence case. |
| `delete(key)` | Removes one alert. |
| `clear()` | Removes all of this source's alerts. |

- **Keys** belong to their source: two glances can both use `door`.
- **Updates** change an alert in place. Setting it again unchanged does nothing.
- **Each alert counts on its own** in the turns.
- **The icon** comes from the severity. The core picks it.
- **A glance's alerts show even while the glance has the screen,** so they work the same wherever the glance is.
- **A glance's alerts are cleared** when it stops or fails to load.
- **Holding the row and showing alone** are for Håg's own alerts only. A glance's alerts always take turns.

## Household alerts

Built-in alerts for things no glance covers. Their sensors are found by device class, wherever they are. Each is off until it's turned on in [settings](configuration.md#alerts).

| Alert | Sensors | Shows |
|---|---|---|
| Smoke, carbon monoxide, gas | Binary sensors of class `smoke`, `carbon_monoxide`, `gas` | Critical at once, and holds the row. "Smoke Alert in Kitchen", "Carbon Monoxide (CO) Alert in Basement · 85 ppm" (the area's CO reading, when it has one) |
| Water leaks | Binary sensors of class `moisture` | A warning when wet, critical after 15 minutes. "Water Leak in Basement · 20 min" |
| Doors, windows and other openings | Binary sensors of class `door`, `window`, `opening`; covers of class `door`, `window` | Information after 5 minutes open; a warning when set to escalate (below). "Hallway door open", "Skylight open" |
| Garage doors and gates | Binary sensors of class `garage_door`; covers of class `garage`, `gate` | As doors. "Garage door open", "Driveway gate open · 2 h" |
| Locks | Lock entities | Unlocked: as doors. Jammed: a warning at once. "Hallway unlocked", "Hallway lock jammed" |
| Indoor air | Sensors of class `carbon_dioxide`, `pm25`, `radon`, `carbon_monoxide`, not on the outdoor floor | A warning once a reading has been past its limit for 15 minutes, cleared as soon as it's back under. "Bedroom CO₂ high · 1,450 ppm" |
| Outdoor air | The air quality index Overview shows; Airly's or GIOŚ's index when there's none | A warning past the scale's limit for 15 minutes. "Outdoor air moderate · AQI 62" |

- **Who's named:** the sensor's area, or its device's name when it has no area. Openings use their own name. An area that repeats the type is dropped ("Garage door open").
- **One alert per type:** "Hallway and Office doors open" when the names fit the row, otherwise "3 doors open". Indoor air drops the values when it names several areas.
- **Escalation:** something left open or unlocked can turn into a warning once it's been open a set time, or while it's still open in set hours (from a time of day until another, or until sunrise). The warning adds the longest time open ("· 2 h"). Off until set; see [configuration](configuration.md#alerts).
- **Waits** for doors, locks and leaks count from Home Assistant's last change, so a door left open before a reload shows straight away. Air readings count from when Håg first sees them past the limit, so their 15 minutes restart when the display reloads.
- **Numbers** follow Home Assistant's number format.

### Indoor air limits

Each limit converts to the sensor's own unit.

| Reading | Limit | Basis |
|---|---|---|
| CO₂ | 1,000 ppm | The German Environment Agency's guide value for airing a room |
| PM2.5 | 35.5 µg/m³ | Where the US AQI reaches "Unhealthy for Sensitive Groups" |
| Radon | 100 Bq/m³ (2.7 pCi/L) | The WHO reference level. A monitor's long-term average is used where it has one, then its 1-day average, then its current reading |
| Carbon monoxide | 30 ppm | The level at which home CO alarms (UL 2034) must stay silent; the alarms themselves raise the critical alert |

### Outdoor air scales

Home Assistant doesn't say which scale an air quality index uses, so Håg goes by the integration. Each scale warns from its first band that names people at risk or tells them to cut back, or, where a scale gives no advice, from its band named moderate. The warning uses the scale's own band name, with the value labeled "AQI".

| Scale | From | Warns from |
|---|---|---|
| US AQI | AirNow, WAQI, AirVisual and Tomorrow.io (outside China), and integrations not listed here | 51, moderate |
| China AQI | AirVisual and Tomorrow.io, when Home Assistant's country is China | 51, moderate (as aqicn names it) |
| AQHI (Canada) | Environment Canada | 4, moderate risk |
| DAQI (UK) | Google Air Quality's local index | 4, moderate |
| OpenWeatherMap's index | OpenWeatherMap | 3, moderate |
| CAQI | Airly, or Google Air Quality's local index | 50, medium |
| UAQI | Google Air Quality, where it has no local index | below 60, moderate (higher is cleaner) |
| GIOŚ's index | GIOŚ | moderate (no number) |

PurpleAir's VOC index isn't an air quality index, and isn't used. China's and GIOŚ's advice come from secondary sources.

## Weather alerts

Read from one of Home Assistant's weather alert integrations, found automatically, one source at a time. If several are installed, the first in this order is used:

| Source | Integration |
|---|---|
| NINA | Core |
| Environment Canada | Core |
| DWD | Core |
| MeteoAlarm | Core |
| CAP Alerts | Custom |
| NWS Alerts | Custom |
| Weather Alerts | Custom |

The [README](../README.md#weather-alerts) says which sources are tested.

- **Severity** follows the alert's own (CAP) severity: Extreme is critical and holds the row, Severe is a warning, and Moderate is information. Minor and Unknown aren't shown.
- **DWD** uses its warning levels: 4 is critical and holds the row, 3 a warning, 2 information; 1 isn't shown.
- **Environment Canada** uses its alert colours: red is critical and holds the row, orange a warning, yellow information. Statements, endings and alerts without a colour aren't shown.
- **Upcoming alerts** show as information from a day before they start ("Winter Storm Watch from 6:00 PM"), then at their own severity.
- **Not shown:** alerts that have ended, cancelled ones, and ones marked past, test or exercise.
- **Wording:** the event's name as issued, then its end ("Tornado Warning until 4:00 PM"). A time on another day takes the weekday ("until Sat 4:00 PM"); with no end given, the name stands alone. DWD shows its event name; NINA drops a leading "Amtliche … WARNUNG vor" from its headline, so the time fits.
- **Times** follow Home Assistant's time format, 12 or 24 hours, in Home Assistant's time zone.
- **Each alert takes its own turn,** even two with the same name.
- **If the source can't be read,** a notice says so.
- The weather scene doesn't change with alerts.

## Notices

Håg's own messages about its setup. They take turns in the row at their severity, and go to the browser console with any detail (file names, errors, allowed values). Each is given once.

| Severity | Notice |
|---|---|
| Information | "Theme setting not recognized · using auto" |
| | "Cycle setting isn't a number · using 30 s" |
| | "Typeface didn't load · using the system font" |
| | "Couldn't read weather alerts from NINA" |
| Warning | "2 glances named "laundry" · the built-in one runs" (or "· neither runs") |
| | "Glance name not valid: "Laundry!"" |
| | "Glance "laundry" isn't installed" |
| | "Laundry Glance didn't load" |
| | "Laundry Glance needs a newer Håg" |
| | "Couldn't read Home Assistant's setup" |

Information notices leave the row after 5 minutes. Warnings stay until the display reloads. When nothing can show at all, Håg's startup alert turns critical instead (see [glances](glances.md#starting-up)).

## Settings

Which alerts are on, sensors to leave out, timings, limits and escalation, the turn length and the weather source are all settings, in the editor's Alerts section or as YAML. See [configuration](configuration.md#alerts).

## Known issues

Sensors that Home Assistant classes like the real thing raise alerts: a rain sensor as a water leak, a remote lockout as a lock, an appliance door as a door. Leave them out with the alert's `exclude` setting (see [configuration](configuration.md#alerts)).
