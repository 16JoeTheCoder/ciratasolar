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
python fetch_weather.py                        # NASA POWER 2001-2025 + PVGIS 2005-2023 into config/cirata/weather (about 41 MB, not committed)
python build.py                                # writes ../site/data/*.json; fails if the mean profile does not peak at 11-12 WIB
python -m pytest -q                            # 7 tests: night zero, 153.1/145 MW clipping, peak hour, pvlib/SPA reference, source markers
python brief.py                                # writes ../site/brief.pdf from the same JSON
npm install && node make_dots.mjs              # only if you change the map; dots.json is committed
cd ../site && python -m http.server 8000       # preview at http://localhost:8000
```

Deploy: drag the `site/` folder onto https://app.netlify.com/drop.

## Weather

NASA POWER hourly (2001-2025, UTC) is the weather for every modelled year, so each reporting period is also run with its
own actual weather. PVGIS-ERA5 (2005-2023) runs the same model as a cross-check; the two disagree by about 9%, which is
shown on the site. With no weather files present the build falls back to a labelled synthetic series and the site shows
a red warning.

## Method in one paragraph

Hourly, in UTC: NREL SPA sun position, Hay-Davies transposition with pvlib's infinite-sheds model (row shading,
constant water/float albedo), PVsyst cell temperature with a floating-PV heat-loss coefficient, PVWatts DC, soiling,
mismatch, Jinko first-year degradation, a rear-side bifacial gain, PVWatts inverter clipping at 153.1 MW (49 inverters),
AC losses, the 145 MW export cap and availability. Every assumed parameter has low/mid/high values; low and high set them all to
their pessimistic/optimistic ends at once, so the envelope is deliberately wide. Reported output is compared, never
fitted: each report's exact WIB date window is re-run over every weather year. Energy is grouped on WIB dates because a
UTC day starts at 07:00 WIB; all other conversion to local time happens in the page. Curtailment is not modelled.
