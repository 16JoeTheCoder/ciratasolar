Weather files live here (not committed). Run `python engine/fetch_weather.py` to download:

- NASA POWER hourly, one file per year (`power_<year>.json`), time-standard UTC: primary weather.
- PVGIS 5.3 hourly (`pvgis_2005_2023.json`), angle 0, components 1: cross-check only.

With no files here, the build uses a SYNTHETIC fallback and the site says so in red.
