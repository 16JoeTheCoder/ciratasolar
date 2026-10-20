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


def pvwatts_unclipped(pdc, pdc0, eta_nom, eta_ref=0.9637):
    """PVWatts inverter efficiency curve without the output limit (pvlib.inverter.pvwatts before clipping)."""
    zeta = np.where(pdc > 0, pdc / pdc0, 1.0)
    eta = eta_nom / eta_ref * (-0.0162 * zeta - 0.0059 / zeta + 0.9858)
    return np.where(pdc > 0, eta * pdc, 0.0)


def degradation_factor(p, years_since_cod):
    return (1 - p["first_year_degradation"]) * (1 - p["degradation"] - p["humidity_degradation"]) ** max(0.0, years_since_cod - 1)


def simulate(weather, site, p, years_since_cod=0.5, stages=False):
    """weather: UTC-indexed DataFrame with ghi, dni, dhi, temp_air, wind_speed (W/m2, degC, m/s).
    Returns DataFrame with ac_kw (export, after both clipping stages), poa, tcell, elevation; with stages=True
    also the power after each loss step (kW) for the loss waterfall."""
    loc = pvlib.location.Location(site["latitude"], site["longitude"], altitude=site["altitude_m"])
    sp = loc.get_solarposition(weather.index, temperature=weather.temp_air)
    zen, azi = sp.apparent_zenith, sp.azimuth
    aoi = pvlib.irradiance.aoi(p["tilt_deg"], p["azimuth_deg"], zen, azi)
    irr = infinite_sheds.get_irradiance(
        p["tilt_deg"], p["azimuth_deg"], zen, azi, p["gcr"], p["height_m"], p["row_width_m"] / p["gcr"],
        weather.ghi, weather.dhi, weather.dni, p["albedo"], model="haydavies",
        dni_extra=pvlib.irradiance.get_extra_radiation(weather.index),
        iam_front=pvlib.iam.physical(aoi), bifaciality=0.0)
    day = zen < 90
    poa = irr["poa_front"].fillna(0).where(day, 0.0)
    tcell = pvlib.temperature.pvsyst_cell(poa, weather.temp_air, weather.wind_speed,
                                          u_c=p["u_value"], u_v=0.0, module_efficiency=0.2)
    s = {"poa_stc": poa / 1000 * site["dc_kwp"]}
    s["temperature"] = pvlib.pvsystem.pvwatts_dc(poa, tcell, site["dc_kwp"], p["temp_coeff"])
    s["soiling"] = s["temperature"] * (1 - p["soiling"])
    s["dc_other"] = s["soiling"] * (1 - p["mismatch_wiring"]) * degradation_factor(p, years_since_cod)
    s["bifacial"] = s["dc_other"] * (1 + p["bifacial_gain"])
    inv_pdc0 = site["inverter_ac_kw"] / p["inverter_eff"]
    inv = pd.Series(pvwatts_unclipped(s["bifacial"].to_numpy(), inv_pdc0, p["inverter_eff"]), index=weather.index)
    s["inverter_eff"] = inv * (1 - p["ac_loss"])
    s["inverter_clip"] = inv.clip(upper=site["inverter_ac_kw"]) * (1 - p["ac_loss"])
    s["export_cap"] = s["inverter_clip"].clip(upper=site["ac_limit_kw"])
    s["availability"] = s["export_cap"] * p["availability"]
    ac = s["availability"].clip(0, site["ac_limit_kw"]).where(day, 0.0)
    out = pd.DataFrame({"ac_kw": ac, "poa": poa, "tcell": tcell, "elevation": sp.elevation})
    if stages:
        out = out.join(pd.DataFrame(s).add_prefix("stage_"))
    return out
