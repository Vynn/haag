# Håg

**Home Assistant at a Glance.** *Håg* is Swedish for *mind*.

A calm, glanceable dashboard for a wall display that answers one question: *what do I need to know right now?* Håg builds itself from your Home Assistant setup, so there are no entity IDs to type.

> **Status: pre-alpha.** Version 0.2 is the current release. Every 0.x build is a pre-release: not ready for everyday use, and anything may change. The first alpha is 0.4, with the configuration editor. See the [roadmap](ROADMAP.md).

## What it shows

Håg shows *glances*. The default one, Overview Glance, is the idle screen, split diagonally into outdoors and indoors:

- **Outdoors:** the time and date; temperature, humidity and air quality over an animated scene of the current weather; who's away from home; and the next few appointments.
- **Indoors:** one row per floor with its heating or cooling status, temperature, humidity, air quality, and who's on that floor.
- **Alert row:** a full-width band through the middle. Real alerts arrive in 0.3.

It's designed square-first and also works in portrait and landscape, from a Raspberry Pi kiosk to a tablet or a 4K screen. Colors follow day and night.

## Requirements

- Home Assistant 2026.10 or later.
- Floors and areas set up in Home Assistant, with your devices assigned to them.
- Outdoor sensors on a floor named *Exterior*, *Outdoor* or *Outside*.
- Optional: Home Assistant's Moon integration, for the moon's phase.

## Install

Håg is a dashboard plugin for HACS, and for the Home Assistant Marketplace from 2026.11. Until it's listed in the default catalog, add it as a custom repository: in HACS, open the ⋮ menu, choose *Custom repositories*, add `https://github.com/Vynn/haag` with the type *Dashboard*, then find Håg and download it. HACS adds the dashboard resource for you.

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
