# Configuration

Håg needs no settings: it finds what to show on its own (see [discovery](discovery.md)). Settings are for when it picks the wrong thing, or for things it can't know.

All settings go in the dashboard's `strategy` block. A visual editor is planned for 0.6.

```yaml
strategy:
  type: custom:haag
  providers:
    outdoor:
      temperature: sensor.backyard_temperature
      humidity: sensor.backyard_humidity
      aqi: sensor.city_air_quality_index
      weather: weather.home
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

## Outdoor

`providers.outdoor` picks the entity for each outdoor reading. Any you leave out are found automatically.

| Setting | Entity |
|---|---|
| `temperature` | A temperature sensor |
| `humidity` | A humidity sensor |
| `aqi` | An air quality index sensor |
| `weather` | A weather entity (its condition drives the background) |

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
| `links` | `person: other_person`. When someone has no location of their own (no phone, for example), they follow the other person's. |

## Calendar

`providers.calendar.calendars` lists the calendars appointments come from. Without it, every calendar Home Assistant shows is used.
