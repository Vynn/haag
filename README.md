# Håg

**Home Assistant at a Glance.** *Håg* is Swedish for *mind*.

A calm, glanceable dashboard for a wall display that answers one question: *what do I need to know right now?* Håg builds itself from your Home Assistant setup, so there are no entity IDs to type.

> **Status: alpha.** Version 0.5 is the current release. Every 0.x build is a pre-release: not ready for everyday use, and anything may change. See the [roadmap](ROADMAP.md).
>
> Håg is developed and tested on one Home Assistant install. Features for other regions, such as weather alerts and air-quality scales, follow each region's published standards but involve some guesswork. Feedback and corrections are welcome as [issues](https://github.com/Vynn/haag/issues).

## What it shows

Håg shows *glances*. The default one, Overview, is the idle screen, split diagonally into outdoors and indoors:

- **Outdoors:** the time and date; temperature, humidity and air quality over an animated scene of the current weather; who's away from home; and the next few appointments.
- **Indoors:** one row per floor with its heating or cooling status, temperature, humidity, air quality, and who's on that floor.
- **Alert row:** a full-width band through the middle for what needs attention now: smoke, carbon monoxide and gas alarms, water leaks, doors, windows and locks left open, air quality, weather alerts, and alerts from glances. See [alerts](docs/alerts.md).

**Appliances**, off until turned on, shows washers, dryers, washer-dryers and dishwashers while they run: one drum shared by up to three machines, each with its contents, progress and time left, and the clock at its center. After a cycle ends, a machine stays for a while with an alert, until its door opens or the alert is dismissed. It reads [seven appliance integrations](#appliances), core and custom.

**Workshop**, off until turned on, shows 3D printers while they print, one at a time, up to three taking turns: the printer's camera or the print's picture, its state, the print's name, layer, time left and end, the temperatures and fans, and progress along the split in the loaded filament's color. After a print ends or fails, the printer stays for a while, until its door opens. It reads [Bambu Lab printers](#3d-printers) for now.

Håg is designed square-first and works in portrait and landscape, from a Raspberry Pi kiosk to a tablet or a 4K screen. Colors follow day and night.

### Weather alerts

Håg shows weather alerts from one of these Home Assistant integrations, whichever it finds first. Each was built from the integration's own code; most are tested only with sample data so far. Reports from real alerts are welcome as [issues](https://github.com/Vynn/haag/issues).

| Source | Integration | Tested |
|---|---|---|
| NINA | Core | Sample data only |
| Environment Canada | Core | Sample data only |
| DWD | Core | Sample data only |
| MeteoAlarm | Core | Sample data only |
| CAP Alerts | Custom | Sample data only |
| NWS Alerts | Custom | Sample data only |
| Weather Alerts | Custom | Partially verified |

### Appliances

The Appliances glance reads machines from these Home Assistant integrations. Each was built from the integration's own code; most aren't tested yet. Reports are welcome as [issues](https://github.com/Vynn/haag/issues).

| Source | Integration | Machines | Tested |
|---|---|---|---|
| SmartThings | Core | Washers, dryers, washer-dryers, dishwashers | Not yet |
| Whirlpool Appliances | Core | Washers, dryers | Not yet |
| Home Connect | Core | Washers, dryers, dishwashers; washer-dryers by name | Not yet |
| Miele | Core | Washers, dryers, washer-dryers, dishwashers | Not yet |
| LG ThinQ | Core | Washers, dryers, washer-dryers, dishwashers | Not yet |
| SmartThinQ LGE Sensors | Custom | Washers, dryers, dishwashers | Verified |
| Sub-Zero | Custom | Dishwashers | Verified |

### 3D printers

The Workshop glance reads printers from these Home Assistant integrations. More are planned. Reports are welcome as [issues](https://github.com/Vynn/haag/issues).

| Source | Integration | Printers | Tested |
|---|---|---|---|
| Bambu Lab | Custom | One- and two-nozzle printers | Not yet |

## Requirements

- Home Assistant 2026.10 or later.
- Floors and areas set up in Home Assistant, with your devices assigned to them.
- Outdoor sensors on a floor named *Exterior*, *Outdoor* or *Outside*.
- Optional: Home Assistant's Moon integration, for the moon's phase.

## Install

Håg is a dashboard plugin. From Home Assistant 2026.11 it installs through the Marketplace, which replaces HACS; on 2026.10, through HACS. Until it's in the default catalog, add it from its link, which opens whichever you have:

[![Open your Home Assistant instance and open Håg in the Marketplace or HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Vynn&repository=haag&category=plugin)

Or add it by hand:

- **Marketplace (2026.11 and later):** in Settings → Marketplace, choose *Add from link* and enter `https://github.com/Vynn/haag`. Adding from a link needs a GitHub sign-in, which reads only public information. Then open Håg and choose *Install*.
- **HACS (2026.10):** open the ⋮ menu, choose *Custom repositories*, add `https://github.com/Vynn/haag` with the type *Dashboard*, then find Håg and choose *Download*.

Either way, the dashboard resource is added for you. Reload the browser afterwards.

Until 1.0, every Håg build is a pre-release. To get them, turn on pre-releases for Håg: the *Pre-release* switch in the Marketplace, or beta versions in HACS. Without it, the Marketplace installs the latest commit, which may be unfinished.

## Set up

Create a new dashboard, open its raw configuration editor, and replace the contents with:

```yaml
strategy:
  type: custom:haag
```

Håg finds everything else. To change what it picks, open the dashboard's editor (⋮ → *Edit dashboard*), or see [configuration](docs/configuration.md).

Until 1.0 the settings format stays `haag/v1`, even when settings change. If a change breaks existing settings, clear or update them by hand. We aim to note each such change in the [changelog](CHANGELOG.md), under *Breaking*.

## Documentation

- [Configuration](docs/configuration.md): every setting.
- [Alerts](docs/alerts.md): what the alert row shows, and how anything sends to it.
- [Glances](docs/glances.md): how Håg's glances work, and how to make one.
- [Discovery](docs/discovery.md): how Håg finds your sensors, people and calendars.
- [Design](docs/design.md): the visual language.
- [Development](docs/development.md): working on Håg locally.
- [Changelog](CHANGELOG.md)

## License

[GPL-3.0](LICENSE). Bundled third-party files keep their own licenses, listed next to them.
