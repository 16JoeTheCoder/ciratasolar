import json
from pathlib import Path

import numpy as np
import pandas as pd
import pvlib
import pytest

import pvsim
import weather

CFG = json.loads((Path(__file__).parents[1] / "config/cirata/config.json").read_text())
SITE, WS = CFG["site"], CFG["weather"]["water_surface"]
LIMIT = SITE["ac_limit_kw"]


@pytest.fixture(scope="module")
def wx():
    cfg = {**CFG, "weather": {**CFG["weather"], "synthetic_years": 1}}
    return weather.synthetic(cfg)


def test_spa_reference_case():
    # Reda & Andreas (2004), NREL SPA paper reference case.
    t = pd.DatetimeIndex(["2003-10-17 19:30:30"], tz="UTC")
    sp = pvlib.solarposition.spa_python(t, 39.742476, -105.1786, altitude=1830.14,
                                        pressure=82000, temperature=11, delta_t=67)
    assert sp.apparent_zenith.iloc[0] == pytest.approx(50.11162, abs=1e-4)
    assert sp.azimuth.iloc[0] == pytest.approx(194.34024, abs=1e-4)


def test_night_output_is_zero(wx):
    for s in pvsim.SCENARIOS:
        r = pvsim.simulate(wx, SITE, pvsim.scenario(CFG, s), WS)
        assert (r.ac_kw[r.elevation < 0] == 0).all()
        assert (r.ac_kw >= 0).all()


def test_never_exceeds_ac_limit(wx):
    hot = wx.assign(ghi=wx.ghi * 1.4, dni=wx.dni * 1.4, dhi=wx.dhi * 1.4, temp_air=15.0)
    for s in pvsim.SCENARIOS:
        p = pvsim.scenario(CFG, s)
        ac = pvsim.simulate(hot, SITE, p, WS).ac_kw
        assert ac.max() <= LIMIT
        # Clipping is exercised; outages scale down the whole plant, inverters included.
        assert ac.max() == pytest.approx(LIMIT * p["availability"])


def test_front_poa_matches_pvlib_transposition(wx):
    p = pvsim.scenario(CFG, "mid", gcr=0.01, bifaciality=0.0, float_cover=0.0)
    r = pvsim.simulate(wx, SITE, p, WS)
    loc = pvlib.location.Location(SITE["latitude"], SITE["longitude"], altitude=SITE["altitude_m"])
    sp = loc.get_solarposition(wx.index, temperature=wx.temp_air)
    alb = pvlib.albedo.inland_water_dvoracek(sp.elevation, surface_condition=WS)
    ref = pvlib.irradiance.get_total_irradiance(
        p["tilt_deg"], p["azimuth_deg"], sp.apparent_zenith, sp.azimuth, wx.dni, wx.ghi, wx.dhi,
        dni_extra=pvlib.irradiance.get_extra_radiation(wx.index), albedo=alb, model="haydavies")
    iam = pvlib.iam.physical(pvlib.irradiance.aoi(p["tilt_deg"], p["azimuth_deg"], sp.apparent_zenith, sp.azimuth))
    ref_poa = (ref.poa_direct * iam + ref.poa_diffuse).fillna(0)
    day = sp.elevation > 10
    assert r.poa[day].sum() == pytest.approx(ref_poa[day].sum(), rel=0.01)


def test_chain_matches_hand_calculation(wx):
    p = pvsim.scenario(CFG, "mid", bifaciality=0.0, soiling=0.0, mismatch_wiring=0.0, lid_nameplate=0.0,
                       degradation=0.0, humidity_degradation=0.0, availability=1.0, ac_loss=0.0)
    r = pvsim.simulate(wx, SITE, p, WS)
    i = r.poa.idxmax()
    tcell = wx.temp_air[i] + r.poa[i] * 0.9 * 0.8 / p["u_value"]
    dc = SITE["dc_kwp"] * r.poa[i] / 1000 * (1 + p["temp_coeff"] * (tcell - 25))
    ac = pvlib.inverter.pvwatts(dc, LIMIT / p["inverter_eff"], eta_inv_nom=p["inverter_eff"])
    assert r.tcell[i] == pytest.approx(tcell, rel=1e-9)
    assert r.ac_kw[i] == pytest.approx(min(ac, LIMIT), rel=1e-9)
