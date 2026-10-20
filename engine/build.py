"""Run every weather year x scenario and write the static JSON the site reads.
Usage: python build.py ../config/cirata ../site/data"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pvlib

import pvsim
import weather

GWH = 1e6  # kWh per GWh
WATERFALL = [("poa_stc", "Sunlight on panels at rated efficiency"), ("temperature", "Temperature loss"),
             ("soiling", "Soiling"), ("dc_other", "Mismatch, wiring, degradation"), ("bifacial", "Bifacial gain"),
             ("inverter_eff", "Inverter efficiency and AC losses"), ("inverter_clip", "Inverter clipping at 153.1 MW"),
             ("export_cap", "Export cap at 145 MW"), ("availability", "Availability")]
LAB_TILT, LAB_UC = [5, 7.5, 10, 12.5, 15], [35, 37, 40, 45, 50]
LAB_WINDOWS = {"cy2024": ("2024-01-01", "2024-12-31"), "pln_158": ("2023-11-09", "2024-06-30")}


def main(site_dir, out_dir):
    site_dir, out = Path(site_dir), Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    cfg = json.loads((site_dir / "config.json").read_text())
    site = cfg["site"]
    wx, wmeta = weather.load(site_dir, cfg)

    sims = {s: pvsim.simulate(wx, site, pvsim.scenario(cfg, s), stages=s == "mid") for s in pvsim.SCENARIOS}
    # Reports use local calendar dates, and a UTC day boundary falls at 07:00 WIB, so energy
    # is grouped on WIB dates. Timestamps themselves stay UTC.
    wib = pd.Timedelta(hours=site["utc_offset_h"])
    local = wx.index.tz_convert(None) + wib
    energy = {s: pd.Series(r.ac_kw.to_numpy(), index=local) for s, r in sims.items()}  # kWh per hourly step
    check_energy(energy["mid"], site)
    peak = check_peak_hour(energy["mid"])

    counts = energy["mid"].groupby(local.year).size()
    years = [int(y) for y, n in counts.items() if n >= 8760]
    annual = {s: [e[e.index.year == y].sum() / GWH for y in years] for s, e in energy.items()}
    mid = np.array(annual["mid"])
    median_year = years[int(np.argmin(np.abs(mid - np.median(mid))))]
    in_median = local.year == median_year

    monthly = {s: {str(y): (e[e.index.year == y].groupby(lambda t: t.month).sum() / GWH).round(3).tolist()
                   for y in years} for s, e in energy.items()}
    daily = {str(y): (energy["mid"][energy["mid"].index.year == y].resample("D").sum() / 1e3).round(1).tolist()
             for y in years}

    typ = sims["mid"].ac_kw[wx.index.year == median_year]
    typ = typ[~((typ.index.month == 2) & (typ.index.day == 29))]

    m = sims["mid"].ac_kw
    grp = m.groupby([m.index.month, m.index.hour])
    month_hour = {k: (grp.quantile(q) / 1e3).round(1).unstack().to_numpy().tolist() for k, q in (("p10", 0.1), ("p90", 0.9))}
    for s, r in sims.items():
        month_hour[f"mean_{s}"] = (r.ac_kw.groupby([m.index.month, m.index.hour]).mean() / 1e3).round(1).unstack().to_numpy().tolist()
    loc = pvlib.location.Location(site["latitude"], site["longitude"], altitude=site["altitude_m"])
    sun_t = pd.DatetimeIndex([pd.Timestamp(2024, mo, 15, h, 30, tz="UTC") for mo in range(1, 13) for h in range(24)])
    sun = loc.get_solarposition(sun_t)
    month_hour["sun_elevation"] = sun.apparent_elevation.round(1).to_numpy().reshape(12, 24).tolist()
    month_hour["sun_azimuth"] = sun.azimuth.round(1).to_numpy().reshape(12, 24).tolist()

    poa_year = sims["mid"].poa[local.year.isin(years)].sum() / 1e3 / len(years)  # kWh/m2/yr
    stats = statistics(cfg, annual, poa_year)
    wy = wx[wx.index.year == median_year]
    base = sims["mid"].ac_kw[in_median].sum() / GWH
    per_year_src = {str(y): ("synthetic" if wmeta["synthetic"] else wmeta["source"]) for y in years}
    result = {
        "meta": {"generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "version": cfg["version"],
                 "sources_as_of": cfg["sources_as_of"], "pvlib": pvlib.__version__, "weather": wmeta,
                 "years": years, "per_year_source": per_year_src, "median_year": median_year, "years_since_cod": 0.5,
                 "mean_profile_peak_wib": peak,
                 "scenario_note": "low/high set every assumed parameter to its pessimistic/optimistic end at once: "
                                  "a deliberately wide envelope, not a probability interval."},
        "site": site,
        "stats": stats,
        "stats_src": {k: (["model", wmeta["src"]] if wmeta["src"] else ["model"]) for k in stats},
        "annual": {"years": years, **{s: np.round(v, 2).tolist() for s, v in annual.items()}},
        "monthly": monthly,
        "month_hour_utc": month_hour,
        "scoreboard": scoreboard(cfg, energy),
        "claims": cfg["claims"],
        "waterfall": {"year": median_year, "steps": [{"key": k, "label": lab, "gwh": round(sims["mid"][f"stage_{k}"][in_median].sum() / GWH, 2)}
                                                     for k, lab in WATERFALL]},
        "tornado": tornado(cfg, wy, site, base, annual["mid"]),
        "lab": lab(cfg, wx, site, local),
        "defaults": pvsim.scenario(cfg, "mid"),
        "crosscheck": crosscheck(cfg, site_dir, site, years, annual["mid"]),
        "checks": period_checks(cfg, sims["mid"], energy["mid"], local),
        "facts": {k: cfg[k] for k in ("economics", "expansion", "area_ha", "water_area_ha", "reservoir_ha", "ugm_claim",
                                      "seasonality_inference", "poa_check", "hydro", "hardware_facts", "contradictions", "not_public")},
    }
    write(out / "results.json", result)
    write(out / "typical_hourly.json", {"year": median_year, "start_utc": str(typ.index[0]), "step": "1h",
                                        "mw": (typ / 1e3).round(1).tolist()})
    write(out / "daily.json", {"unit": "MWh per WIB day, mid scenario", "years": daily})
    write(out / "assumptions.json", assumptions(cfg))
    write(out / "sources.json", sources(site_dir, cfg, wmeta))
    print(f"{wmeta['source']}: years {years[0]}-{years[-1]}, P50 mid {stats['annual_gwh']['p50']:.1f} GWh, profile peak {peak}:00 WIB")


def check_energy(e, site):
    """(b) Instantaneous AC never above the export limit; annual energy never above limit x hours."""
    assert e.max() <= site["ac_limit_kw"], "AC power above export limit"
    by_year = e.groupby(e.index.year)
    assert (by_year.sum() <= site["ac_limit_kw"] * by_year.size()).all(), "annual energy above limit x hours"


def check_peak_hour(e):
    """(a) Mean daily profile must peak in the 11:00-12:59 WIB bins, else time zones are mixed up."""
    peak = int(e.groupby(e.index.hour).mean().idxmax())
    if peak not in (11, 12):
        raise SystemExit(f"Mean daily PV profile peaks at {peak}:00 WIB, outside 11-12: time-zone error in weather data")
    return peak


def pct(a, q):
    return round(float(np.percentile(a, q)), 2)


def statistics(cfg, annual, poa_year):
    s, tariff = cfg["site"], cfg["economics"]["tariff_usd_mwh"]
    lo, mid, hi = (pct(annual[k], 50) for k in pvsim.SCENARIOS)
    kwh = {k: v * GWH for k, v in (("low", lo), ("mid", mid), ("high", hi))}
    return {
        "annual_gwh": {"p50": mid, "p90": pct(annual["mid"], 10), "p10": pct(annual["mid"], 90),
                       "low": lo, "high": hi, "min": round(min(annual["low"]), 2), "max": round(max(annual["high"]), 2)},
        "capacity_factor_ac": {k: round(v / (s["ac_limit_kw"] * 8760), 4) for k, v in kwh.items()},
        "specific_yield_kwh_kwp": {k: round(v / s["dc_kwp"]) for k, v in kwh.items()},
        "performance_ratio_mid": round(kwh["mid"] / (poa_year * s["dc_kwp"]), 3),
        "poa_kwh_m2_mid": round(poa_year),
        "revenue_musd": {k: round(v / 1e3 * tariff / 1e6, 2) for k, v in kwh.items()},
    }


def window_sums(series, start, end):
    """Energy (GWh) in [start, end] WIB dates, shifted to every weather year that fully covers it."""
    start, end = pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(days=1)
    span = end.year - start.year
    out = {}
    for y in range(series.index.year.min(), series.index.year.max() + 1):
        a, b = start.replace(year=y), end.replace(year=y + span)
        sel = series[(series.index >= a) & (series.index < b)]
        if len(sel) >= (b - a) / pd.Timedelta(hours=1) * 0.999:
            out[y] = sel.sum() / GWH
    return out


def scoreboard(cfg, energy):
    rows = []
    for r in cfg["reported"]:
        w = {s: window_sums(energy[s], r["start"], r["end"]) for s in pvsim.SCENARIOS}
        mid = np.array(list(w["mid"].values()))
        allv = [v for s in w for v in w[s].values()]
        lo, hi = min(allv), max(allv)
        actual_year = pd.Timestamp(r["start"]).year
        rows.append({**r,
                     "modelled": {"min": round(lo, 1), "max": round(hi, 1), "mid_p10": pct(mid, 10),
                                  "mid_p50": pct(mid, 50), "mid_p90": pct(mid, 90), "n_weather_years": len(mid)},
                     "same_period_weather": {s: round(w[s][actual_year], 1) for s in pvsim.SCENARIOS if actual_year in w[s]} or None,
                     "position": "below envelope" if r["gwh"] < lo else "above envelope" if r["gwh"] > hi else "inside envelope",
                     "share_of_mid_years_below_report": float((mid < r["gwh"]).mean()),
                     "ratio_to_mid_p50": round(r["gwh"] / pct(mid, 50), 3)})
    return rows


def tornado(cfg, wy, site, base, mid_annual):
    rows = []
    for k, v in cfg["params"].items():
        if "tornado" not in v:
            continue
        g = [pvsim.simulate(wy, site, pvsim.scenario(cfg, "mid", **{k: x})).ac_kw.sum() / GWH for x in v["tornado"]]
        rows.append({"key": k, "label": v["label"], "values": v["tornado"], "unit": v["unit"],
                     "gwh": [round(x, 2) for x in g], "src": v["src"]})
    rows.append({"key": "weather", "label": "Weather year (10th-90th percentile)", "values": ["P10 year", "P90 year"], "unit": "",
                 "gwh": [pct(mid_annual, 10), pct(mid_annual, 90)], "src": ["model"]})
    rows.sort(key=lambda r: -abs(r["gwh"][1] - r["gwh"][0]))
    return {"base_gwh": round(base, 2), "rows": rows}


def lab(cfg, wx, site, local):
    """Calibration Lab: hourly DC power after temperature loss (before soiling and every later step), binned to 1 MW,
    for each tilt x Uc grid point and each reporting window. The page applies the remaining steps exactly."""
    sel = (local >= pd.Timestamp("2023-11-09")) & (local < pd.Timestamp("2025-01-01"))
    if wx.index[sel].size < 8000:
        return None
    w, loc_sel = wx[sel], local[sel]
    p = pvsim.scenario(cfg, "mid")
    grid = {}
    for t in LAB_TILT:
        for u in LAB_UC:
            dc = pvsim.simulate(w, site, pvsim.scenario(cfg, "mid", tilt_deg=t, u_value=u), stages=True)["stage_temperature"].to_numpy()
            grid[f"{t}|{u}"] = {k: np.bincount(np.round(dc[(loc_sel >= pd.Timestamp(a)) & (loc_sel < pd.Timestamp(b) + pd.Timedelta(days=1))] / 1e3)
                                               .astype(int), minlength=1).tolist() for k, (a, b) in LAB_WINDOWS.items()}
    const = {"mismatch_wiring": p["mismatch_wiring"], "degradation_factor": pvsim.degradation_factor(p, 0.5),
             "inverter_eff": p["inverter_eff"], "ac_loss": p["ac_loss"], "inverter_ac_mw": site["inverter_ac_kw"] / 1e3,
             "ac_limit_mw": site["ac_limit_kw"] / 1e3}
    full = pvsim.simulate(w, site, p).ac_kw.to_numpy()
    for k, (a, b) in LAB_WINDOWS.items():  # binned shortcut must reproduce the full model
        exact = full[(loc_sel >= pd.Timestamp(a)) & (loc_sel < pd.Timestamp(b) + pd.Timedelta(days=1))].sum() / GWH
        approx = lab_energy(grid[f"{p['tilt_deg']}|{p['u_value']}"][k], const, p) / 1e3
        assert abs(approx / exact - 1) < 0.005, f"lab bins off for {k}: {approx} vs {exact}"
    return {"tilt": LAB_TILT, "uc": LAB_UC, "windows": LAB_WINDOWS, "const": const, "grid": grid}


def lab_energy(bins, c, p):
    """MWh from binned DC (MW); mirrors app.js labEnergy."""
    dc = np.arange(len(bins)) * (1 - p["soiling"]) * (1 - c["mismatch_wiring"]) * c["degradation_factor"] * (1 + p["bifacial_gain"])
    inv = pvsim.pvwatts_unclipped(dc, c["inverter_ac_mw"] / c["inverter_eff"], c["inverter_eff"])
    ac = np.minimum(np.minimum(inv, c["inverter_ac_mw"]) * (1 - c["ac_loss"]), c["ac_limit_mw"]) * p["availability"]
    return float((np.maximum(ac, 0) * np.array(bins)).sum())


def crosscheck(cfg, site_dir, site, years, power_mid):
    pg = weather.crosscheck(site_dir, cfg)
    if pg is None:
        return None
    local = pg.index.tz_convert(None) + pd.Timedelta(hours=site["utc_offset_h"])
    e = pd.Series(pvsim.simulate(pg, site, pvsim.scenario(cfg, "mid")).ac_kw.to_numpy(), index=local)
    pg_years = [y for y in sorted(set(local.year)) if (local.year == y).sum() >= 8760]
    pg_annual = {y: e[e.index.year == y].sum() / GWH for y in pg_years}
    both = [y for y in pg_years if y in years]
    ratio = np.mean([power_mid[years.index(y)] / pg_annual[y] for y in both])
    return {"source": "PVGIS-ERA5", "years": pg_years, "mid_gwh": [round(pg_annual[y], 2) for y in pg_years],
            "p50": pct(list(pg_annual.values()), 50), "overlap_years": [both[0], both[-1]],
            "power_over_pvgis": round(float(ratio), 3), "src": ["pvgis_data"]}


def period_checks(cfg, sim, e, local):
    """Plausibility of 2024 POA vs the window implied by 279 GWh, and modelled 2024 halves vs the seasonality inference."""
    y24 = local.year == 2024
    if not y24.any():
        return None
    poa24 = sim.poa[y24].sum() / 1e3
    h1 = e[(e.index.year == 2024) & (e.index.month <= 6)].sum() / GWH
    h2 = e[(e.index.year == 2024) & (e.index.month > 6)].sum() / GWH
    pc = cfg["poa_check"]
    return {"poa_2024_kwh_m2": round(poa24), "poa_window": [round(pc["specific_yield"] / p) for p in reversed(pc["pr"])],
            "h1_2024_gwh": round(h1, 1), "h2_2024_gwh": round(h2, 1)}


def assumptions(cfg):
    rows = [{"key": k, "group": "params", **v} for k, v in cfg["params"].items()]
    s, e = cfg["site"], cfg["economics"]
    rows += [{"key": "dc_kwp", "group": "site", "label": "DC capacity", "unit": "kWp", "mid": s["dc_kwp"], "class": "FIXED", "src": ["pmse", "masdar_proj"], "basis": "Reported"},
             {"key": "inverter_ac_kw", "group": "site", "label": "Inverter AC capacity (49 x 3,125 kW)", "unit": "kW", "mid": s["inverter_ac_kw"], "class": "FIXED", "src": ["dossier_unattributed"], "basis": "First clipping stage"},
             {"key": "ac_limit_kw", "group": "site", "label": "Export limit", "unit": "kW", "mid": s["ac_limit_kw"], "class": "FIXED", "src": ["masdar_proj", "taiyang"], "basis": "Second clipping stage"},
             {"key": "location", "group": "site", "label": "Location", "unit": "deg", "mid": f"{s['latitude']}, {s['longitude']}", "class": "ASSUMED", "src": ["enwiki_dam", "assumption"], "basis": s["location_note"]},
             {"key": "altitude_m", "group": "site", "label": "Altitude", "unit": "m", "mid": s["altitude_m"], "class": "FIXED", "src": ["pvgis_data", "pupr"], "basis": s["altitude_note"]},
             {"key": "tariff", "group": "economics", "label": "PPA tariff", "unit": "US$/MWh", "mid": e["tariff_usd_mwh"], "class": "FIXED", "src": e["tariff_src"], "basis": "Secondary; indexation and deemed dispatch not public"},
             {"key": "capex", "group": "economics", "label": "Capital cost", "unit": "US$ million", "low": e["capex_musd"][0], "high": e["capex_musd"][1], "mid": "129-143", "class": "FIXED", "src": e["capex_src"], "basis": e["capex_note"]},
             {"key": "household", "group": "economics", "label": "Household use (ESDM-derived)", "unit": "kWh/yr", "mid": e["household_kwh"], "class": "FIXED", "src": e["household_src"], "basis": "Inference from primary: " + e["household_note"]}]
    return rows


def sources(site_dir, cfg, wmeta):
    src = json.loads((site_dir / "sources.json").read_text())
    for s in src:
        s["accessed"] = cfg["sources_as_of"]
        s["used_weather"] = s["id"] == wmeta["src"]
    return src


def write(path, obj):
    path.write_text(json.dumps(obj, separators=(",", ":")))


if __name__ == "__main__":
    here = Path(__file__).parent
    main(*(sys.argv[1:] or [here.parent / "config/cirata", here.parent / "site/data"]))
