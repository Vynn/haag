# Configuration

Håg needs no settings: it finds what to show on its own (see [discovery](discovery.md)). Settings are for when it picks the wrong thing, or for things it can't know.

All settings go in the dashboard's `strategy` block. Edit them in Home Assistant's dashboard editor (⋮ → *Edit dashboard*), or as YAML in its code editor; both edit the same settings. A few settings are YAML-only, marked below. Dashboards kept in YAML mode can only be edited as YAML.

Durations are in seconds. A setting Håg can't use gives a notice and falls back to its default.

```yaml
strategy:
  type: custom:haag
  providers:
    outdoor:
      temperature: sensor.backyard_temperature
      humidity: sensor.backyard_humidity
      aqi: sensor.city_air_quality_index
      weather: weather.home
      moon: sensor.moon_phase
    floors:
      first_floor:                    # a floor ID from Home Assistant
        monitors:                     # air-quality devices, most trusted first
          - 0123456789abcdef0123456789abcdef
        climate: climate.hallway
    people:
      exclude:
        - person.guest
      links:
        person.child: person.parent
    calendar:
      calendars:
        - calendar.family
        - calendar.school
```

## Glances

What shows, and when. See [glances](glances.md).

```yaml
strategy:
  type: custom:haag
  default: sinnesro
  cycle: 30
  glances:
    laundry:
      enabled: true
```

| Setting | Value |
|---|---|
| `default` | The glance shown when nothing else needs the screen. Overview Glance (`sinnesro`) if left out. |
| `cycle` | Seconds per turn when several glances want the screen. 30 if left out. |
| `glances.<name>.enabled` | `true` turns a glance on. Entry order is the order glances take turns. |

## Day and night

```yaml
strategy:
  type: custom:haag
  theme: auto
```

| Setting | Value |
|---|---|
| `theme` | `auto` follows the sun: day colors from sunrise to sunset, or 6:00 to 18:00 without Home Assistant's sun entity. `dark` or `light` keeps one. `auto` if left out. |

## Alerts

What each alert does is in [alerts](alerts.md). Settings are grouped by source: `core` for household alerts, `weather`, and each glance by its name.

```yaml
strategy:
  type: custom:haag
  alerts:
    turn: 8
    core:
      leak:
        enabled: true
        exclude:
          - binary_sensor.rain
      doors:
        enabled: true
        after: 600
      co2:
        enabled: true
        limit: 1200
    weather:
      source: nina
```

| Setting | Value |
|---|---|
| `alerts.turn` | Seconds per alert when several take turns. 8 if left out. |
| `alerts.core.<alert>.enabled` | `true` turns a household alert on. All are off until turned on. |
| `alerts.core.<alert>.exclude` | Sensors to leave out, such as a rain sensor that reads as a leak. |
| `alerts.core.<alert>.after` | Seconds something stays open or unlocked before the alert shows. |
| `alerts.core.leak.critical_after` | Seconds before a leak turns critical. 900 if left out. |
| `alerts.core.<alert>.hold` | Seconds a reading stays past its limit before the alert shows. 900 if left out. |
| `alerts.core.<alert>.limit` | The reading's limit, in the unit below. Converted to each sensor's own unit. |
| `alerts.weather.enabled` | `false` turns weather alerts off. On if left out. |
| `alerts.weather.source` | The weather alert integration to use, when more than one is installed: `nina`, `environment_canada`, `dwd_weather_warnings`, `meteoalarm`, `cap_alerts`, `nws_alerts` or `weatheralerts`. Found automatically if left out. |

The household alerts (`<alert>`), with their timings and limits when left out:

| Alert | Covers | Timing | Limit |
|---|---|---|---|
| `smoke`, `co`, `gas` | Smoke, carbon monoxide and gas alarms | At once | |
| `leak` | Water leaks | `critical_after: 900` | |
| `doors`, `windows`, `openings`, `garage_doors`, `gates` | Things left open | `after: 300` | |
| `locks` | Locks left unlocked, and jammed ones | `after: 300` | |
| `co2` | Indoor CO₂ | `hold: 900` | 1000 ppm |
| `pm25` | Indoor PM2.5 | `hold: 900` | 35.5 µg/m³ |
| `radon` | Indoor radon | `hold: 900` | 100 Bq/m³ |
| `co_level` | Indoor carbon monoxide readings | `hold: 900` | 30 ppm |
| `outdoor_air` | Outdoor air quality, by its scale | `hold: 900` | |

The dashboard editor's section for alerts comes in a later build; until then, alert settings are edited as YAML.

## Time and numbers

Times follow the time format in your Home Assistant profile (12 or 24 hours, or your language's own), in Home Assistant's time zone. Numbers follow the profile's number format.

## Outdoor

`providers.outdoor` picks the entity for each outdoor reading. Any you leave out are found automatically.

| Setting | Entity |
|---|---|
| `temperature` | A temperature sensor |
| `humidity` | A humidity sensor |
| `aqi` | An air quality index sensor |
| `weather` | A weather entity (its condition and wind drive the background) |
| `moon` | The Moon integration's phase sensor (the moon's shape at night) |

## Floors

`providers.floors.<floor_id>` adjusts one indoor floor.

| Setting | Value |
|---|---|
| `monitors` | Device IDs of the floor's air-quality monitors, most trusted first. The first one with a reading is used, and the others only fill readings it lacks. |
| `climate` | The thermostat whose heating and cooling status the floor shows. |

## People

`providers.people` chooses who appears.

| Setting | Value |
|---|---|
| `exclude` | People not to show, such as guests. |
| `include` | Show only these people. |
| `links` | `person: other_person`. When someone has no location of their own (no phone, for example), they follow the other person's. YAML only for now. |

## Calendar

`providers.calendar.calendars` lists the calendars appointments come from. Without it, every calendar Home Assistant shows is used.
