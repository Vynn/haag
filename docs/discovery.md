# Discovery

Håg reads Home Assistant's floors, areas, devices and entities, and decides what to show from them. Nothing is hardcoded, so it adapts to any setup. When a guess is wrong, [configuration](configuration.md) overrides it.

## Floors

- The floor named *Exterior*, *Outdoor* or *Outside* holds the outdoor sensors. Every other floor is indoors.
- Indoor floors are shown from the center outward: the ground floor first (the lowest floor at level 0 or above), then the floors above it going up, then the floors below it going down.
- A floor with nothing to show is left out.

## Choosing between sources

When several entities could supply the same reading, Håg prefers, in order:

1. Local integrations over cloud ones, and push updates over polling.
2. Plain readings over derived ones (temperature over dew point or "feels like", for example).
3. More precise readings (more decimal places).

## Indoor readings

- **Air-quality monitors** are devices on the floor with a CO₂, PM2.5, radon or carbon monoxide sensor. Their order follows your settings, then the rules above, then device name.
- **Temperature and humidity** come from the monitors, or from the floor's thermostat when there's no monitor.
- **Air quality** shows up to three readings: humidity, CO₂ and PM2.5 first, then radon and carbon monoxide when those are missing.
- **Heating and cooling status** comes from the floor's thermostat.

## People

- People are Home Assistant's `person` entities.
- Someone at home appears on a floor when one of their trackers reports a floor name, an area on that floor, or a room name that contains a floor name.
- Someone away appears with the people away from home.
- Someone without a location of their own can follow a linked person (see [configuration](configuration.md)).
- People at home whose floor isn't known aren't shown.

## Appointments

- Appointments come from every calendar Home Assistant shows, unless you list calendars in the settings.
- Håg shows the next four within 30 days, refreshed every five minutes. If space runs short, the furthest ones are dropped first.
- Anything more than 24 hours away also shows its day.
