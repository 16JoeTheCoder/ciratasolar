"""Hourly floating-PV yield model built on pvlib. All timestamps are UTC."""
import numpy as np
import pandas as pd
import pvlib
from pvlib.bifacial import infinite_sheds

SCENARIOS = ("low", "mid", "high")


def scenario(cfg, name, **override):
    p = {k: v[name] for k, v in cfg["params"].items()}
    p.update(override)
    return p


def simulate(weather, site, p, water_surface, years_since_cod=0.5):
    """weather: UTC-indexed DataFrame with ghi, dni, dhi, temp_air, wind_speed (W/m2, degC, m/s).
    Returns DataFrame with ac_kw (export, capped at the AC limit), poa, tcell, elevation."""
    loc = pvlib.location.Location(site["latitude"], site["longitude"], altitude=site["altitude_m"])
    sp = loc.get_solarposition(weather.index, temperature=weather.temp_air)
    zen, azi = sp.apparent_zenith, sp.azimuth
    water = pvlib.albedo.inland_water_dvoracek(sp.elevation, surface_condition=water_surface)
    albedo = water * (1 - p["float_cover"]) + p["float_albedo"] * p["float_cover"]
    aoi = pvlib.irradiance.aoi(p["tilt_deg"], p["azimuth_deg"], zen, azi)
    irr = infinite_sheds.get_irradiance(
        p["tilt_deg"], p["azimuth_deg"], zen, azi, p["gcr"], p["height_m"], p["row_width_m"] / p["gcr"],
        weather.ghi, weather.dhi, weather.dni, albedo, model="haydavies",
        dni_extra=pvlib.irradiance.get_extra_radiation(weather.index),
        iam_front=pvlib.iam.physical(aoi), bifaciality=p["bifaciality"])
    poa = irr["poa_global"].fillna(0)
    tcell = pvlib.temperature.pvsyst_cell(irr["poa_front"].fillna(0), weather.temp_air, weather.wind_speed,
                                          u_c=p["u_value"], u_v=0.0, module_efficiency=0.2)
    dc = pvlib.pvsystem.pvwatts_dc(poa * (1 - p["soiling"]), tcell, site["dc_kwp"], p["temp_coeff"])
    deg = (1 - p["degradation"] - p["humidity_degradation"]) ** years_since_cod
    dc = dc * (1 - p["mismatch_wiring"]) * (1 - p["lid_nameplate"]) * deg
    inv_ac_kw = site["ac_limit_kw"] / (1 - p["ac_loss"])
    ac = pvlib.inverter.pvwatts(dc, inv_ac_kw / p["inverter_eff"], eta_inv_nom=p["inverter_eff"])
    ac = pd.Series(ac, index=weather.index).fillna(0) * (1 - p["ac_loss"]) * p["availability"]
    ac = ac.clip(0, site["ac_limit_kw"]).where(zen < 90, 0.0)
    return pd.DataFrame({"ac_kw": ac, "poa": poa, "tcell": tcell, "elevation": sp.elevation})
