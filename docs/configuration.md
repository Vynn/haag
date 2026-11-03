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
      calendars:
        person.parent: calendar.work
      colors:
        person.child: "#7a3c00"       # quoted: YAML reads # as a comment
        calendar.family: "#16a765"
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
| `easter_eggs` | `false` turns off the easter eggs in every glance. On if left out; a glance's own `easter_eggs` can still turn them off just for it. |
| `glances.<name>.enabled` | `true` turns a glance on. Entry order is the order glances take turns. |
| `glances.<name>.<setting>` | A glance's own settings. Each glance lists its own; in the editor, each glance has a section with its switch in the header. |

Overview Glance (`glances.sinnesro`):

| Setting | Value |
|---|---|
| `appointments` | The most appointments shown. 4 if left out. When space runs short, the furthest are dropped first. |
| `days` | How many days ahead appointments come from. 30 if left out. |
| `easter_eggs` | `false` leaves out Overview's easter eggs: what's caught in a tornado (cows, a dinosaur and junk), the giant spider, the dragon, and the odd things that blow through on a gust. The tornado, wind, space station and shooting stars stay. On if left out, unless the overall `easter_eggs` is off. |

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
      garage_doors:
        enabled: true
        warning_at: "21:00"           # still open from 9 PM: a warning
        warning_until: "07:00"
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
| `alerts.core.<alert>.warning_after` | For things left open or unlocked: seconds before the alert turns into a warning. Off if left out. |
| `alerts.core.<alert>.warning_at` | For things left open or unlocked: a time of day, like `"21:00"`. Anything still open from then is a warning. Off if left out. |
| `alerts.core.<alert>.warning_until` | When `warning_at`'s warnings end. Sunrise if left out, or 6:00 without Home Assistant's sun entity. |
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
| `doors`, `windows`, `openings`, `garage_doors`, `gates` | Things left open | `after: 300`, and the warning settings | |
| `locks` | Locks left unlocked, and jammed ones | `after: 300`, and the warning settings | |
| `co2` | Indoor CO₂ | `hold: 900` | 1000 ppm |
| `pm25` | Indoor PM2.5 | `hold: 900` | 35.5 µg/m³ |
| `radon` | Indoor radon | `hold: 900` | 100 Bq/m³ |
| `co_level` | Indoor carbon monoxide readings | `hold: 900` | 30 ppm |
| `outdoor_air` | Outdoor air quality, by its scale | `hold: 900` | |

Times of day are in Home Assistant's time zone. Quote them: unquoted, YAML can read `21:00` as a number.

In the editor, the Alerts section lists the household alerts, then weather. Turning an alert on shows the sensors Håg found for it, all ticked: untick any that aren't really that thing, and they're saved under `exclude`. Sensors found later are watched without being ticked first. Its timings, limit and warning settings follow.

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

`providers.people` chooses who appears, which calendar is whose, and their colors.

| Setting | Value |
|---|---|
| `exclude` | People not to show, such as guests. |
| `include` | Show only these people. |
| `links` | `person: other_person`. When someone has no location of their own (no phone, for example), they follow the other person's. |
| `calendars` | `person: calendar`. Håg matches people to calendars by name on its own (`person.alex` and `calendar.alex`, or the same friendly name); this is for the ones it can't. |
| `colors` | `person or calendar: "#hex"`. Quote the color: unquoted, YAML reads `#` as the start of a comment. |

Each person and calendar has a color: the one set here, else the calendar's color in Home Assistant (Google Calendar sets one, for example), else one of Håg's six, in turn. A person and their calendar share it. The color shows on a person's icon and on their appointments. Any color keeps its hue and shifts in lightness until it's readable where it's drawn, by day and by night, so a pale yellow, for example, turns darker by day.

In the editor, each person has their calendar, color and who they follow, followed by a color for each calendar that's no one's. A color picker can't be cleared there: to go back to the color Håg finds, remove it in the code editor. A calendar that's someone's takes their color; giving it a different one is YAML only.

## Calendar

`providers.calendar.calendars` lists the calendars appointments come from. Without it, every calendar Home Assistant shows is used.

## Setup warnings

Håg checks Home Assistant's setup for what it shows, and says what's missing and what follows from it. Fixing it is up to you, in Home Assistant. The warnings show at the top of the dashboard editor; the first three also show for five minutes in the alert row when the dashboard loads, with a link to the settings.

| Check | Key | What follows |
|---|---|---|
| Sensors with no area (on the entity or its device): indoor readings, thermostats, and the sensors of household alerts that are on | `area` | They're on no floor, so their readings don't show, and alerts name the device instead of the room. |
| Areas with no floor that hold such sensors | `floor` | Their sensors are on no floor. |
| People with no trackers who don't follow anyone | `person` | They're never shown. |
| No floor named Exterior, Outdoor or Outside (and no outdoor temperature set) | `exterior` | Outdoor temperature, humidity and air quality aren't found. |
| Indoor readings in a unit Håg doesn't read, for alerts that are on | `units` | They aren't watched for alerts. |
| No sun entity | `sun` | Day and night switch at 6:00 and 18:00. |
| No Moon integration | `moon` | The moon is always drawn waxing gibbous. |

For power users, `warnings.ignore` (YAML only) leaves things out: entity, area or person IDs, or a check's key to leave out the whole check.

```yaml
strategy:
  type: custom:haag
  warnings:
    ignore:
      - sensor.workshop_co2      # an entity
      - storage                  # an area ID
      - moon                     # a whole check
```
