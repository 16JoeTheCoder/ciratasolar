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


def main(site_dir, out_dir):
    site_dir, out = Path(site_dir), Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    cfg = json.loads((site_dir / "config.json").read_text())
    site, ws = cfg["site"], cfg["weather"]["water_surface"]
    wx, wmeta = weather.load(site_dir, cfg)

    sims = {s: pvsim.simulate(wx, site, pvsim.scenario(cfg, s), ws) for s in pvsim.SCENARIOS}
    # Reports use local calendar dates, and a UTC day boundary falls at 07:00 WIB, so energy
    # is grouped on WIB dates. Timestamps themselves stay UTC.
    local = wx.index.tz_convert(None) + pd.Timedelta(hours=site["utc_offset_h"])
    energy = {s: pd.Series(r.ac_kw.to_numpy(), index=local) for s, r in sims.items()}  # kWh per hourly step

    counts = energy["mid"].groupby(local.year).size()
    years = [int(y) for y, n in counts.items() if n >= 8760]
    annual = {s: [e[e.index.year == y].sum() / GWH for y in years] for s, e in energy.items()}
    mid = np.array(annual["mid"])
    median_year = years[int(np.argmin(np.abs(mid - np.median(mid))))]

    monthly = {s: {str(y): (e[e.index.year == y].groupby(lambda t: t.month).sum() / GWH).round(3).tolist()
                   for y in years} for s, e in energy.items()}
    daily = {str(y): (energy["mid"][energy["mid"].index.year == y].resample("D").sum() / 1e3).round(1).tolist()
             for y in years}

    typ = sims["mid"].ac_kw[wx.index.year == median_year]
    typ = typ[~((typ.index.month == 2) & (typ.index.day == 29))]

    m = sims["mid"].ac_kw
    grp = m.groupby([m.index.month, m.index.hour])
    month_hour = {k: (grp.quantile(q) / 1e3).round(1).unstack().to_numpy().tolist()
                  for k, q in (("p10", 0.1), ("p50", 0.5), ("p90", 0.9))}
    month_hour["mean"] = (grp.mean() / 1e3).round(1).unstack().to_numpy().tolist()
    loc = pvlib.location.Location(site["latitude"], site["longitude"], altitude=site["altitude_m"])
    sun_t = pd.DatetimeIndex([pd.Timestamp(2024, mo, 15, h, 30, tz="UTC") for mo in range(1, 13) for h in range(24)])
    sun = loc.get_solarposition(sun_t)
    month_hour["sun_elevation"] = sun.apparent_elevation.round(1).to_numpy().reshape(12, 24).tolist()
    month_hour["sun_azimuth"] = sun.azimuth.round(1).to_numpy().reshape(12, 24).tolist()

    poa_year = sims["mid"].poa[local.year.isin(years)].sum() / 1e3 / len(years)  # kWh/m2/yr
    stats = statistics(cfg, annual, poa_year)
    result = {
        "meta": {"generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 "pvlib": pvlib.__version__, "weather": wmeta, "years": years, "median_year": median_year,
                 "years_since_cod": 0.5,
                 "scenario_note": "low/high set every assumed parameter to its pessimistic/optimistic end at once: "
                                  "a deliberately wide envelope, not a probability interval."},
        "site": site,
        "stats": stats,
        "annual": {"years": years, **{s: np.round(v, 2).tolist() for s, v in annual.items()}},
        "monthly": monthly,
        "month_hour_utc": month_hour,
        "scoreboard": scoreboard(cfg, energy, years, annual),
        "sensitivity": sensitivity(cfg, wx[wx.index.year == median_year], site, ws, annual["mid"][years.index(median_year)]),
    }
    write(out / "results.json", result)
    write(out / "typical_hourly.json", {"year": median_year, "start_utc": str(typ.index[0]), "step": "1h",
                                        "mw": (typ / 1e3).round(1).tolist()})
    write(out / "daily.json", {"unit": "MWh per WIB day, mid scenario", "years": daily})
    write(out / "assumptions.json", assumptions(cfg, stats))
    write(out / "sources.json", sources(site_dir, wmeta))
    print(f"{wmeta['source']}: years {years[0]}-{years[-1]}, median-year mid {annual['mid'][years.index(median_year)]:.1f} GWh")


def pct(a, q):
    return round(float(np.percentile(a, q)), 2)


def statistics(cfg, annual, poa_year):
    e, s = cfg["economics"], cfg["site"]
    lo, mid, hi = (pct(annual[k], 50) for k in pvsim.SCENARIOS)
    kwh = {k: v * GWH for k, v in (("low", lo), ("mid", mid), ("high", hi))}
    return {
        "annual_gwh": {"p50": mid, "p90": pct(annual["mid"], 10), "p10": pct(annual["mid"], 90),
                       "low": lo, "high": hi, "min": round(min(annual["low"]), 2), "max": round(max(annual["high"]), 2)},
        "capacity_factor_ac": {k: round(v / (s["ac_limit_kw"] * 8760), 4) for k, v in kwh.items()},
        "specific_yield_kwh_kwp": {k: round(v / s["dc_kwp"]) for k, v in kwh.items()},
        "performance_ratio_mid": round(kwh["mid"] / (poa_year * s["dc_kwp"]), 3),
        "poa_kwh_m2_mid": round(poa_year),
        "revenue_musd": {"low": round(kwh["low"] * e["tariff_usd_kwh"]["low"] / 1e6, 1),
                         "mid": round(kwh["mid"] * e["tariff_usd_kwh"]["mid"] / 1e6, 1),
                         "high": round(kwh["high"] * e["tariff_usd_kwh"]["high"] / 1e6, 1)},
        "capex_musd": {k: e["capex_musd"][k] for k in pvsim.SCENARIOS},
        "homes": {k: round(kwh[k] / e["household_kwh_yr"][k], -3) for k in pvsim.SCENARIOS},
        "avoided_kt_co2": {k: round(kwh[k] / 1e3 * e["grid_ef_t_mwh"][k] / 1e3) for k in pvsim.SCENARIOS},
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


def scoreboard(cfg, energy, years, annual):
    rows = []
    for r in cfg["reported"]:
        w = {s: window_sums(energy[s], r["start"], r["end"]) for s in pvsim.SCENARIOS}
        mid = np.array(list(w["mid"].values()))
        allv = [v for s in w for v in w[s].values()]
        lo, hi = min(allv), max(allv)
        actual_year = pd.Timestamp(r["start"]).year
        rank = float((mid < r["gwh"]).mean()) if len(mid) else None
        rows.append({**r,
                     "modelled": {"min": round(lo, 1), "max": round(hi, 1), "mid_p10": pct(mid, 10),
                                  "mid_p50": pct(mid, 50), "mid_p90": pct(mid, 90), "n_weather_years": len(mid)},
                     "same_period_weather": {s: round(w[s][actual_year], 1) for s in pvsim.SCENARIOS if actual_year in w[s]} or None,
                     "position": "below envelope" if r["gwh"] < lo else "above envelope" if r["gwh"] > hi else "inside envelope",
                     "share_of_mid_years_below_report": rank,
                     "ratio_to_mid_p50": round(r["gwh"] / pct(mid, 50), 3)})
    c = cfg["claimed_annual_gwh"]
    rows.append({"id": "claims", "label": "Claimed annual yield", "gwh_range": [c["low"], c["high"]], "source": c["source"],
                 "reliability": c["reliability"], "kind": "claim", "note": c["note"],
                 "modelled": {"min": round(min(annual["low"]), 1), "max": round(max(annual["high"]), 1),
                              "mid_p10": pct(annual["mid"], 10), "mid_p50": pct(annual["mid"], 50),
                              "mid_p90": pct(annual["mid"], 90), "n_weather_years": len(years)}})
    return rows


def sensitivity(cfg, wx_year, site, ws, base):
    out = []
    for tilt in (5, 15):
        e = pvsim.simulate(wx_year, site, pvsim.scenario(cfg, "mid", tilt_deg=tilt), ws).ac_kw.sum() / GWH
        out.append({"param": "tilt_deg", "value": tilt, "gwh": round(e, 2), "change_pct": round((e / base - 1) * 100, 2)})
    return out


def assumptions(cfg, stats):
    rows = [{"key": k, "group": g, **v} for g in ("params", "economics") for k, v in cfg[g].items()]
    s = cfg["site"]
    rows += [{"key": "dc_kwp", "group": "site", "label": "DC capacity", "unit": "kWp", "mid": s["dc_kwp"], "tag": "reported", "basis": "plant_facts"},
             {"key": "ac_limit_kw", "group": "site", "label": "AC capacity (export limit)", "unit": "kW", "mid": s["ac_limit_kw"], "tag": "reported", "basis": "plant_facts"},
             {"key": "location", "group": "site", "label": "Location (dam point)", "unit": "deg", "mid": f"{s['latitude']}, {s['longitude']}", "tag": "reported", "basis": s["location_note"]},
             {"key": "altitude_m", "group": "site", "label": "Altitude", "unit": "m", "mid": s["altitude_m"], "tag": "assumed", "basis": s["altitude_note"]},
             {"key": "water_surface", "group": "params", "label": "Water surface type for albedo", "unit": "-", "mid": cfg["weather"]["water_surface"], "tag": "assumed", "basis": "Reservoir assumed greenish with small ripples (Dvoracek & Hannabas 1990 categories)."}]
    rows += [{"key": r["id"], "group": "reported", "label": r["label"], "unit": "GWh", "mid": r["gwh"], "tag": "reported",
              "basis": f"{r['source']} ({r['reliability']} reliability). {r['note']}"} for r in cfg["reported"]]
    rows += [{"key": k, "group": "outputs", "label": k.replace("_", " "), "mid": v if not isinstance(v, dict) else v.get("mid", v.get("p50")),
              "tag": "modelled", "basis": "Engine output, mid scenario"} for k, v in stats.items()]
    return rows


def sources(site_dir, wmeta):
    src = json.loads((site_dir / "sources.json").read_text())
    src.append({"id": "weather", "title": wmeta["source"], "type": "synthetic placeholder" if wmeta["synthetic"] else "weather dataset",
                "url": None, "note": "Files: " + (", ".join(wmeta["files"]) or "none; generated in engine/weather.py")})
    return src


def write(path, obj):
    path.write_text(json.dumps(obj, separators=(",", ":")))


if __name__ == "__main__":
    here = Path(__file__).parent
    main(*(sys.argv[1:] or [here.parent / "config/cirata", here.parent / "site/data"]))
