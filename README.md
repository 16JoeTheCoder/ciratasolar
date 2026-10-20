# Cirata Floating Solar: yield model and static site (beta)

A pvlib model of the 192 MWp / 145 MWac Cirata floating PV plant (West Java) pre-computes JSON; `site/` is a static site that reads it.

```
config/cirata/   the only folder to edit for this site: config.json (every parameter), sources.json, weather/ (downloads)
engine/          pvsim.py (model), weather.py (loaders + synthetic fallback), build.py (JSON), brief.py (PDF), make_dots.mjs (map), tests
site/            Netlify folder: index.html, app.js, style.css, brief.pdf, data/*.json
```

## Commands

```bash
pip install pvlib pandas reportlab pytest      # tested with pvlib 0.16.1, Python 3.13
cd engine
python -m pytest -q                            # 5 tests: night zero, 145 MWac cap, pvlib/SPA reference cases
python build.py                                # writes ../site/data/*.json
python brief.py                                # writes ../site/brief.pdf from the same JSON
npm install && node make_dots.mjs              # only if you change the map; dots.json is committed
cd ../site && python -m http.server 8000       # preview at http://localhost:8000
```

Deploy: drag the `site/` folder onto https://app.netlify.com/drop.

## Real weather (required before showing anyone numbers)

The beta was built without network access to any weather API, so the committed numbers come from a synthetic
clear-sky fallback and the site and PDF carry a red warning. Download a file using the links in
`config/cirata/weather/README.md`, put it in that folder, and rerun `python build.py && python brief.py`.
The warning disappears automatically once a real file is used.

## Method in one paragraph

Hourly, in UTC: NREL SPA sun position, Hay-Davies transposition with pvlib's infinite-sheds model (row shading,
bifacial rear light, water albedo from Dvoracek & Hannabas plus a float share), PVsyst cell temperature with a
floating-PV heat-loss coefficient, PVWatts DC and inverter, DC/AC losses, availability, degradation for operating
year 1, and a hard cap at 145 MWac. Every assumed parameter has low/mid/high values; low and high set them all to
their pessimistic/optimistic ends at once, so the envelope is deliberately wide. Reported output is compared, never
fitted: each report's exact WIB date window is re-run over every weather year. Energy is grouped on WIB dates because a
UTC day starts at 07:00 WIB; all other conversion to local time happens in the page. Curtailment is not modelled.
