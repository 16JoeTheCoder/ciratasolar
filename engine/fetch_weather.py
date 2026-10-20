"""Download NASA POWER (one file per year) and PVGIS (one file) hourly weather into the site's weather folder.
Usage: python fetch_weather.py [first_year] [last_year]"""
import json
import sys
import time
import urllib.request
from pathlib import Path

CFG_DIR = Path(__file__).parents[1] / "config/cirata"
POWER = ("https://power.larc.nasa.gov/api/temporal/hourly/point?parameters=ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DNI,"
         "ALLSKY_SFC_SW_DIFF,T2M,WS10M&community=RE&longitude={lon}&latitude={lat}&start={y}0101&end={y}1231"
         "&format=JSON&time-standard=UTC")
PVGIS = ("https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?lat={lat}&lon={lon}&startyear=2005&endyear=2023"
         "&angle=0&aspect=0&components=1&outputformat=json")


def get(url, path):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                path.write_bytes(r.read())
            return
        except OSError as e:
            print(f"retry {attempt + 1}: {e}")
            time.sleep(2 ** (attempt + 1))
    raise SystemExit(f"failed: {url}")


def main(y0=2001, y1=2025):
    site = json.loads((CFG_DIR / "config.json").read_text())["site"]
    out = CFG_DIR / json.loads((CFG_DIR / "config.json").read_text())["weather"]["dir"]
    for y in range(int(y0), int(y1) + 1):
        f = out / f"power_{y}.json"
        if not f.exists():
            get(POWER.format(lat=site["latitude"], lon=site["longitude"], y=y), f)
            print("wrote", f.name)
    f = out / "pvgis_2005_2023.json"
    if not f.exists():
        get(PVGIS.format(lat=site["latitude"], lon=site["longitude"]), f)
        print("wrote", f.name)


if __name__ == "__main__":
    main(*sys.argv[1:])
