# Design

Håg is meant to be read from across a room in a second or two, then left alone.

## Principles

- **Relevance over completeness.** Show what matters now; hide what doesn't exist on a given setup.
- **Show existing data only.** Håg displays what Home Assistant already knows; it doesn't create new data.
- **Errors are visible.** Missing or bad data shows "Err" rather than silently disappearing.
- **Calm by default.** Motion is slow and gentle, and it stops when the system asks for reduced motion.

## Layout

- Designed square-first, and laid out for portrait and landscape too.
- A diagonal line splits the screen: outdoors in the top left, indoors in the bottom right.
- Content sits in small blocks, each lined up against the diagonal, with the most important nearest the center.
- One unit of size (a share of the screen's shorter side) scales everything together, so proportions hold on any display.
- Three text sizes: the clock, a medium size and a small size.
- One typeface for every glance: Open Sans, bundled with Håg, so no font service is needed.

## Weather

The outdoor side carries an illustrated weather background for each of Home Assistant's 15 weather conditions. It's cel-shaded: flat colors with hard-edged highlights and shadows, light from the upper left, no gradients or blur.

- One shared set of elements (sun, moon, stars, clouds, rain, snow, hail, fog, wind and more) makes up every condition, so a change in the weather moves smoothly from one scene to the next.
- The sun and moon follow their real arcs across the day, and the moon shows its real phase.
- Wind sets the direction clouds, rain and snow travel.
- The weather stays behind the text, except for a few deliberate touches, such as snow settling on the alert row.

## Alerts

The alert row is a band across the middle. For information it's near-white with dark text, by day and by night, so it's read first. Warnings turn it yellow with dark text, critical alerts red with white text, by day and by night; those two colors appear nowhere else. Each severity has its own icon, sized to the text. Alerts take turns by sliding left, and the band's color fades between severities. See [alerts](alerts.md).

| | Night | Day |
|---|---|---|
| Information | `#FFFFFF` at 90%, with the day text color | The same |
| Warning | `#C99A3A`, with the night sky's color as text | `#F6D365`, with the day text color |
| Critical | `#C9433E`, white text | `#B42318`, white text |

## Day and night

Two palettes, a dark night and a bright day, switch at sunrise and sunset with a short transition. The target for all text is a contrast of at least 4.5:1 against the sky in every condition.

## People and calendars

People and calendars carry a color: on a person's icon border and initials, and on an appointment's icon and time. Any color keeps its hue and shifts in lightness until it reaches 4.5:1 on what it's drawn on, by day and by night, so it can carry text. Those without a color of their own take one of six, in turn, each 4.5:1 or better on the sky, its glow and indoors:

| | Night | Day |
|---|---|---|
| Ember | `#ED914C` | `#7A3C00` |
| Fern | `#8DBC58` | `#365501` |
| Lagoon | `#10C4BC` | `#025653` |
| Azure | `#54B3FD` | `#025081` |
| Violet | `#B298F9` | `#5B369E` |
| Orchid | `#E486C6` | `#87216E` |

Day values are deep because the day sky is much darker than the indoor side. Six keep them distinct; anyone can set their own.

## Design studies

The `design/` folder holds the working studies (open them in a browser):

- `wireframe-idle.html`: the idle screen layout.
- `palette-day-night.html`: the day and night palettes.
- `palette-people.html`: colors for people and calendars, and how calendar colors shift by day and night.
- `weather-study.html`: every weather condition, with controls for time, moon phase, wind and season.
