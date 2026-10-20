Drop downloaded weather files here, then rerun `python engine/build.py`.
With no files here, the build uses a SYNTHETIC fallback and the site says so in red.

PVGIS (used first if present). Name the file `pvgis_<anything>.json`:
https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?lat=-6.70056&lon=107.36694&startyear=2005&endyear=2023&angle=0&aspect=0&components=1&outputformat=json

NASA POWER (used only if no PVGIS file is present; covers 2024, which enables the same-period check).
Name each file `power_<year>.json`. If a multi-year request is refused, download one year per file:
https://power.larc.nasa.gov/api/temporal/hourly/point?parameters=ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DNI,ALLSKY_SFC_SW_DIFF,T2M,WS10M&community=RE&longitude=107.36694&latitude=-6.70056&start=20010101&end=20241231&format=JSON&time-standard=UTC
