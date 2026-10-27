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
- One typeface for every card: Open Sans, bundled with Håg, so no font service is needed.

## Weather

The outdoor side carries an illustrated weather background for each of Home Assistant's 15 weather conditions. It's cel-shaded: flat colors with hard-edged highlights and shadows, light from the upper left, no gradients or blur.

- One shared set of elements (sun, moon, stars, clouds, rain, snow, hail, fog, wind and more) makes up every condition, so a change in the weather moves smoothly from one scene to the next.
- The sun and moon follow their real arcs across the day, and the moon shows its real phase.
- Wind sets the direction clouds, rain and snow travel.
- The weather stays behind the text, except for a few deliberate touches, such as snow settling on the alert row.

## Day and night

Two palettes, a dark night and a bright day, switch at sunrise and sunset with a short transition. The target for all text is a contrast of at least 4.5:1 against the sky in every condition.

## Design studies

The `design/` folder holds the working studies (open them in a browser):

- `wireframe-idle.html`: the idle screen layout.
- `palette-day-night.html`: the day and night palettes.
- `weather-study.html`: every weather condition, with controls for time, moon phase, wind and season.
