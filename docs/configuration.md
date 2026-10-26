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
