"""Build the print-friendly PDF brief from the same JSON the site reads.
Usage: python brief.py ../site/data ../site/brief.pdf"""
import json
import statistics
import sys
from pathlib import Path

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
INK, RED = colors.HexColor("#18211f"), colors.HexColor("#9b1c0c")


def main(data_dir, out):
    d = Path(data_dir)
    R = json.loads((d / "results.json").read_text())
    A = json.loads((d / "assumptions.json").read_text())
    S = json.loads((d / "sources.json").read_text())
    topics = list(dict.fromkeys(s["topic"] for s in S))
    S = [s for t in topics for s in S if s["topic"] == t]
    num = {s["id"]: i + 1 for i, s in enumerate(S)}
    st, s, m, F = getSampleStyleSheet(), R["stats"], R["meta"], R["facts"]
    E = F["economics"]
    body = st["BodyText"].clone("b", fontSize=9.5, leading=12.5)
    small = st["BodyText"].clone("small", fontSize=8.5, leading=11)
    h2, h3 = st["Heading2"], st["Heading3"]
    ref = lambda ids: "<super>[" + ",".join(str(num[i]) for i in ids if i) + "]</super>"
    P = lambda t, style=small: Paragraph(t, style)

    def table(rows, widths):
        t = Table([[c if not isinstance(c, str) else P(c) for c in r] for r in rows], colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
                               ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.grey)]))
        return t

    a = s["annual_gwh"]
    n50 = a["p50"] * 1e6 / E["household_kwh"]
    ef = E["emission_factors"][0]
    story = [Paragraph("Cirata Floating Solar: modelled yield brief", st["Title"]),
             P(f"192 MWp DC / 145 MWac, Cirata reservoir, West Java. {m['version']}, sources as of {m['sources_as_of']}, "
               f"built {m['generated_utc']} with pvlib {m['pvlib']}.", body)]
    if m["weather"]["synthetic"]:
        story.append(P("<b>SYNTHETIC WEATHER.</b> Every number in this brief tests the pipeline only and is not an estimate of Cirata's output.",
                       body.clone("w", textColor=RED)))
    else:
        cc = R["crosscheck"]
        story.append(P(f"Weather: {m['weather']['source']}, {m['years'][0]}-{m['years'][-1]}{ref([m['weather']['src']])}"
                       + (f"; {cc['source']} {cc['years'][0]}-{cc['years'][-1]} as a cross-check{ref(cc['src'])}." if cc else "."), body))
    story += [P("<b>What this is.</b> Cirata publishes only annual and cumulative output, so this is a forecast from a physics model "
                "checked against sparse reports. It is not a calibrated model and not live data. Reported figures never set a parameter.", body),
              Paragraph("Key figures (mid scenario unless a range is given)", h3),
              table([["Metric", "Value", "Range", "Badge"],
                     ["Annual energy, P50" + ref(R["stats_src"]["annual_gwh"]), f"{a['p50']:.0f} GWh", f"{a['low']:.0f}-{a['high']:.0f} GWh (scenarios)", "modelled"],
                     ["Weather spread (mid)", f"P90 {a['p90']:.0f} / P10 {a['p10']:.0f} GWh", f"{len(m['years'])} weather years", "modelled"],
                     ["Capacity factor (AC)", f"{s['capacity_factor_ac']['mid']:.1%}", f"{s['capacity_factor_ac']['low']:.1%}-{s['capacity_factor_ac']['high']:.1%}", "modelled"],
                     ["Specific yield", f"{s['specific_yield_kwh_kwp']['mid']} kWh/kWp", f"{s['specific_yield_kwh_kwp']['low']}-{s['specific_yield_kwh_kwp']['high']}", "modelled"],
                     ["Performance ratio", f"{s['performance_ratio_mid']:.1%}", f"POA {s['poa_kwh_m2_mid']} kWh/m2/yr", "modelled"],
                     ["Revenue per year" + ref(E["tariff_src"]), f"US${s['revenue_musd']['mid']:.1f}M", f"US${s['revenue_musd']['low']:.1f}-{s['revenue_musd']['high']:.1f}M at {E['tariff_usd_mwh']} US$/MWh", "modelled x reported tariff"],
                     ["Build cost" + ref(E["capex_src"]), f"US${E['capex_musd'][0]}-{E['capex_musd'][1]}M", "Rp1.7T; conflicting, unverified", "reported, secondary"],
                     ["Homes powered" + ref(E["household_src"]), f"~{round(n50, -3):,.0f}", f"at {E['household_kwh']:,} kWh/household (ESDM-derived); official claim {E['official_homes']:,}", "inference"],
                     ["Avoided CO2 per year" + ref(ef["src"]), f"{a['p50'] * ef['value']:.0f} kt", f"at {ef['value']} t/MWh; 0.84 and 0.80 also quoted", "inference, unverified"]],
                    [45 * mm, 38 * mm, 62 * mm, 33 * mm]),
              Paragraph("Monthly energy, mid scenario, median across weather years (GWh)", h3), monthly_chart(R),
              PageBreak(), Paragraph("Scoreboard: model vs reports (GWh)", h2),
              P("Each modelled value covers exactly the reporting period, repeated over every weather year; the envelope spans all scenarios. "
                "'Same-period' uses that period's actual weather. Curtailment is not modelled; gross or net is not stated for any report.")]
    rows = [["Reported figure", "Period", "Reported", "Same-period model (mid)", "All-years mid P50", "Envelope", "Confidence"]]
    for r in R["scoreboard"]:
        mod, sp = r["modelled"], r["same_period_weather"]
        rows.append([r["label"] + ref(r["src"]), f"{r['start']} to {r['end']}", f"{r['gwh']}", f"{sp['mid']:.1f}" if sp else "-",
                     f"{mod['mid_p50']:.1f}", f"{mod['min']:.0f}-{mod['max']:.0f}", r["reliability"]])
    story.append(table(rows, [38 * mm, 34 * mm, 18 * mm, 24 * mm, 22 * mm, 20 * mm, 22 * mm]))
    story += [Paragraph("Claims (not measurements)", h3),
              table([["Claim", "Who", "GWh/yr"]] + [[c["label"] + ref(c["src"]), c["who"],
                     f">{c['range'][0]}" if c["range"][1] is None else "-".join(str(x) for x in dict.fromkeys(c["range"]))] for c in R["claims"]],
                    [60 * mm, 80 * mm, 38 * mm]),
              Spacer(1, 3 * mm), P(F["ugm_claim"] + ref(["ugm"]))]
    ck = R["checks"]
    if ck:
        si = F["seasonality_inference"]
        story += [Paragraph("Checks (inference)", h3),
                  P(f"Plane-of-array sunlight needed for 1,453 kWh/kWp: {ck['poa_window'][1]} kWh/m2 at PR 0.85, {ck['poa_window'][0]} at PR 0.93. "
                    f"Modelled 2024: {ck['poa_2024_kwh_m2']} kWh/m2." + ref(["ecobiz", "model"])),
                  P(f"Reports imply Jan-Jun 2024 about {si['h1_gwh']} GWh and Jul-Dec about {si['h2_gwh']} GWh (assumes a flat daily rate). "
                    f"Model with 2024 weather: {ck['h1_2024_gwh']} and {ck['h2_2024_gwh']} GWh." + ref(si["src"]))]

    story += [PageBreak(), Paragraph("Methodology", h2),
              P("Hourly, in UTC: NREL SPA sun position; Hay-Davies transposition with pvlib's infinite-sheds model (row shading, "
                "constant water/float albedo); PVsyst cell temperature with a floating-PV heat-loss coefficient; PVWatts DC; "
                "soiling, mismatch and first-year degradation; rear-side bifacial gain as a separate input; PVWatts inverter "
                "efficiency with clipping at 153.1 MW (49 inverters); AC losses; export cap at 145 MW; availability. Low and high "
                "scenarios set every assumed input to its pessimistic or optimistic end at once. No input is tuned to reported output.", body),
              Paragraph("Inputs (FIXED = reported, ASSUMED = not public, TUNED = none)", h3)]
    v = lambda x: "" if x is None else str(x)
    story.append(table([["Input", "Class", "Low", "Mid", "High", "Unit"]] +
                       [[x["label"] + ref(x["src"]), x["class"], v(x.get("low")), v(x["mid"]), v(x.get("high")), x.get("unit", "")] for x in A],
                       [70 * mm, 20 * mm, 18 * mm, 30 * mm, 18 * mm, 22 * mm]))
    wf = R["waterfall"]
    story += [Paragraph(f"Loss waterfall (mid, median weather year {wf['year']}, GWh)", h3),
              table([["Step", "GWh after step", "Change"]] + [[x["label"], f"{x['gwh']:.1f}", f"{x['gwh'] - wf['steps'][i - 1]['gwh']:+.1f}" if i else ""]
                                                            for i, x in enumerate(wf["steps"])], [80 * mm, 40 * mm, 40 * mm]),
              Paragraph(f"Sensitivity (swing around {R['tornado']['base_gwh']:.1f} GWh)", h3),
              table([["Input", "Low end", "High end"]] + [[t["label"], f"{t['values'][0]}: {t['gwh'][0] - R['tornado']['base_gwh']:+.1f}",
                                                           f"{t['values'][1]}: {t['gwh'][1] - R['tornado']['base_gwh']:+.1f}"] for t in R["tornado"]["rows"]],
                    [80 * mm, 45 * mm, 45 * mm])]

    story += [PageBreak(), Paragraph("Contradictions ledger", h2),
              table([["Topic", "Values (who said it)", "Used here"]] +
                    [[c["topic"], "<br/>".join(f"{val} ({who}){ref([sid])}" for val, who, sid in c["values"]), c["used"]] for c in F["contradictions"]],
                    [32 * mm, 85 * mm, 61 * mm]),
              PageBreak(), Paragraph("Sources", h2)]
    for t in topics:
        story.append(Paragraph(t, h3))
        story += [P(f"[{num[x['id']]}] <b>{x['title']}</b>. {x['publisher']}, {x['date']}. {x['confidence']}. "
                    f"{x['url'] or 'No link recorded.'} Used for: {x['used_for']}. Listed {x['accessed']}.") for x in S if x["topic"] == t]
    story += [Paragraph("Not public", h3), P(", ".join(F["not_public"]) + "."),
              Paragraph("Licences and attribution", h3),
              P("Weather: NASA POWER (NASA Langley Research Center). Cross-check: PVGIS (c) European Union; contains modified Copernicus "
                "Climate Change Service information. Operator, supplier and news content is cited only, never reproduced. No BMKG raw data is used.")]
    SimpleDocTemplate(str(out), pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                      title="Cirata Floating Solar brief").build(story)
    print(f"wrote {out}")


def monthly_chart(R):
    vals = [statistics.median(y[i] for y in R["monthly"]["mid"].values()) for i in range(12)]
    dr = Drawing(170 * mm, 48 * mm)
    c = VerticalBarChart()
    c.x, c.y, c.width, c.height = 10 * mm, 6 * mm, 155 * mm, 38 * mm
    c.data, c.categoryAxis.categoryNames = [vals], MONTHS
    c.valueAxis.valueMin = 0
    c.bars[0].fillColor, c.bars[0].strokeColor, c.bars[0].strokeWidth = colors.white, INK, 0.8
    c.categoryAxis.labels.fontSize = c.valueAxis.labels.fontSize = 8
    dr.add(c)
    return dr


if __name__ == "__main__":
    here = Path(__file__).parent
    main(*(sys.argv[1:] or [here.parent / "site/data", here.parent / "site/brief.pdf"]))
