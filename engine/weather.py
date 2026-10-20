"""Weather loaders. Every loader returns a UTC-indexed hourly DataFrame with
ghi, dni, dhi, temp_air, wind_speed, plus a meta dict saying where it came from."""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pvlib

COLS = ["ghi", "dni", "dhi", "temp_air", "wind_speed"]


def load(site_dir, cfg):
    d = Path(site_dir) / cfg["weather"]["dir"]
    pvgis = sorted(d.glob("pvgis*"))
    power = sorted(d.glob("power*.json"))
    if pvgis:
        return _concat([_pvgis(f) for f in pvgis]), {"source": "PVGIS (JRC) hourly time series", "synthetic": False,
                                                     "files": [f.name for f in pvgis]}
    if power:
        return _concat([_power(f) for f in power]), {"source": "NASA POWER hourly (CERES/MERRA-2)", "synthetic": False,
                                                     "files": [f.name for f in power]}
    return synthetic(cfg), {"source": "SYNTHETIC clear-sky fallback (not real weather)", "synthetic": True, "files": []}


def _concat(frames):
    w = pd.concat(frames).sort_index()
    return w[~w.index.duplicated()][COLS]


def _pvgis(path):
    # Requested with angle=0 & components=1, so the "poa" components are horizontal beam and diffuse.
    data, _ = pvlib.iotools.read_pvgis_hourly(path)
    elev = data["solar_elevation"]
    beam = data["poa_direct"]
    w = pd.DataFrame({
        "dhi": data["poa_sky_diffuse"],
        "ghi": beam + data["poa_sky_diffuse"],
        "dni": (beam / np.sin(np.radians(elev))).where(elev > 2, 0.0),
        "temp_air": data["temp_air"], "wind_speed": data["wind_speed"]})
    w.index = w.index.tz_convert("UTC")
    return w


def _power(path):
    # Requested with time-standard=UTC. Values are hourly averages stamped at the hour start,
    # so shift to the interval midpoint for the sun-position calculation.
    par = json.loads(Path(path).read_text())["properties"]["parameter"]
    names = {"ALLSKY_SFC_SW_DWN": "ghi", "ALLSKY_SFC_SW_DNI": "dni", "ALLSKY_SFC_SW_DIFF": "dhi",
             "T2M": "temp_air", "WS10M": "wind_speed"}
    w = pd.DataFrame({v: pd.Series(par[k]) for k, v in names.items()})
    w.index = pd.to_datetime(w.index, format="%Y%m%d%H", utc=True) + pd.Timedelta(minutes=30)
    w = w.mask(w <= -999)
    w[["ghi", "dni", "dhi"]] = w[["ghi", "dni", "dhi"]].fillna(0).clip(lower=0)
    return w.interpolate(limit=3).dropna()


def synthetic(cfg):
    """Clear-sky irradiance scaled by random daily clearness. For testing the pipeline only."""
    s, wc = cfg["site"], cfg["weather"]
    n = wc["synthetic_years"]
    times = pd.date_range(f"{2024 - n}-01-01 00:30", f"2023-12-31 23:30", freq="h", tz="UTC")
    loc = pvlib.location.Location(s["latitude"], s["longitude"], altitude=s["altitude_m"])
    cs = loc.get_clearsky(times, model="ineichen")
    rng = np.random.default_rng(wc["synthetic_seed"])
    days = times.normalize()
    m = wc["synthetic_mean_clearness"]
    kd = pd.Series(rng.beta(8 * m, 8 * (1 - m), len(days.unique())), index=days.unique()).reindex(days).to_numpy()
    ghi = cs["ghi"].to_numpy() * np.clip(kd * (1 + 0.15 * rng.standard_normal(len(times))), 0.05, 1.0)
    zen = loc.get_solarposition(times).zenith
    sep = pvlib.irradiance.erbs(ghi, zen, times)
    local_h = (times.hour + s["utc_offset_h"]) % 24
    return pd.DataFrame({"ghi": ghi, "dni": sep["dni"], "dhi": sep["dhi"],
                         "temp_air": 26 + 4 * np.sin((local_h - 9) / 24 * 2 * np.pi), "wind_speed": 1.5},
                        index=times)
