# Håg

**Home Assistant at a Glance.** *Håg* is Swedish for *mind*.

A calm, glanceable dashboard for a wall display that answers one question: *what do I need to know right now?* Håg builds itself from your Home Assistant setup, so there are no entity IDs to type.

> **Status: pre-alpha.** Version 0.1 is the first release. It isn't ready for everyday use yet, and anything may change. See the [roadmap](ROADMAP.md).

## What it shows

Version 0.1 is the idle screen, split diagonally into outdoors and indoors:

- **Outdoors:** the time and date, temperature, humidity and air quality, who's away from home, and the next few appointments.
- **Indoors:** one row per floor with its heating or cooling status, temperature, humidity, air quality, and who's on that floor.
- **Alert row:** a full-width band through the middle. Real alerts arrive in 0.3.

It's designed square-first and also works in portrait and landscape, from a Raspberry Pi kiosk to a tablet or a 4K screen. Day and night colors arrived in 0.1.2; the illustrated weather backgrounds arrive in 0.2.

## Requirements

- Home Assistant 2026.10 or later.
- Floors and areas set up in Home Assistant, with your devices assigned to them.
- Outdoor sensors on a floor named *Exterior*, *Outdoor* or *Outside*.

## Install

Håg is a dashboard plugin for HACS, and for the Home Assistant Marketplace from 2026.11. Until it's listed in the default catalog, add this repository as a custom repository (type *Dashboard*) and install it. Detailed steps will be confirmed with the first release.

## Set up

Create a new dashboard, open its raw configuration editor, and replace the contents with:

```yaml
strategy:
  type: custom:haag
```

Håg finds everything else. To change what it picks, see [configuration](docs/configuration.md).

## Documentation

- [Configuration](docs/configuration.md): every setting.
- [Glances](docs/glances.md): how Håg's glances work, and how to make one.
- [Discovery](docs/discovery.md): how Håg finds your sensors, people and calendars.
- [Design](docs/design.md): the visual language.
- [Development](docs/development.md): working on Håg locally.
- [Changelog](CHANGELOG.md)

## License

[GPL-3.0](LICENSE). Bundled third-party files keep their own licenses, listed next to them.
