"""Build the PDF brief from the same JSON the site reads.
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
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
TEAL, RED = colors.HexColor("#0f7c6b"), colors.HexColor("#9b1c0c")


def main(data_dir, out):
    d = Path(data_dir)
    R = json.loads((d / "results.json").read_text())
    A = json.loads((d / "assumptions.json").read_text())
    S = json.loads((d / "sources.json").read_text())
    st, s, m = getSampleStyleSheet(), R["stats"], R["meta"]
    body, small = st["BodyText"], st["BodyText"].clone("small", fontSize=7.5, leading=9.5)
    warn = body.clone("warn", textColor=RED)

    def table(rows, widths, font=8):
        t = Table(rows, colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), font), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("TEXTCOLOR", (0, 0), (-1, 0), TEAL), ("LINEBELOW", (0, 0), (-1, 0), 0.5, TEAL),
                               ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.lightgrey)]))
        return t

    a = s["annual_gwh"]
    story = [Paragraph("Cirata Floating Solar: modelled yield brief", st["Title"]),
             Paragraph(f"192 MWp DC / 145 MWac, Cirata reservoir, West Java. Built {m['generated_utc']} with pvlib {m['pvlib']}.", body)]
    if m["weather"]["synthetic"]:
        story.append(Paragraph("<b>SYNTHETIC WEATHER.</b> No real weather data was available for this build. Every number "
                               "in this brief tests the pipeline only and is not an estimate of Cirata's output.", warn))
    story += [Paragraph("<b>What this is.</b> Cirata publishes only annual and cumulative output, so this is a forecast from a "
                        "physics model checked against sparse reports. It is not a calibrated model and not live data.", body),
              Spacer(1, 4 * mm), Paragraph("Key figures (mid scenario unless a range is given)", st["Heading3"]),
              table([["Metric", "Value", "Range", "Tag"],
                     ["Annual energy, P50", f"{a['p50']:.0f} GWh", f"{a['low']:.0f}-{a['high']:.0f} GWh (scenarios)", "modelled"],
                     ["Weather spread (mid)", f"P90 {a['p90']:.0f} / P10 {a['p10']:.0f} GWh", f"{len(m['years'])} weather years", "modelled"],
                     ["Capacity factor (AC)", f"{s['capacity_factor_ac']['mid']:.1%}", f"{s['capacity_factor_ac']['low']:.1%}-{s['capacity_factor_ac']['high']:.1%}", "modelled"],
                     ["Specific yield", f"{s['specific_yield_kwh_kwp']['mid']} kWh/kWp", f"{s['specific_yield_kwh_kwp']['low']}-{s['specific_yield_kwh_kwp']['high']}", "modelled"],
                     ["Performance ratio", f"{s['performance_ratio_mid']:.1%}", "", "modelled"],
                     ["Revenue per year", f"US${s['revenue_musd']['mid']:.0f}M", f"US${s['revenue_musd']['low']:.0f}-{s['revenue_musd']['high']:.0f}M", "assumed tariff"],
                     ["Build cost", "", f"US${s['capex_musd']['low']}-{s['capex_musd']['high']}M", "assumed"],
                     ["Homes powered", f"~{s['homes']['mid']:,.0f}", f"{s['homes']['low']:,.0f}-{s['homes']['high']:,.0f}", "assumed use"],
                     ["Avoided CO2 per year", f"{s['avoided_kt_co2']['mid']} kt", f"{s['avoided_kt_co2']['low']}-{s['avoided_kt_co2']['high']} kt", "assumed factor"]],
                    [45 * mm, 45 * mm, 55 * mm, 30 * mm]),
              Spacer(1, 4 * mm), Paragraph("Monthly energy, mid scenario, median across weather years (GWh)", st["Heading3"]),
              monthly_chart(R)]

    rows = [["Reported figure", "Period", "Reported", "Model mid P50", "Envelope", "Position", "Reliability"]]
    for r in R["scoreboard"]:
        mod = r["modelled"]
        rep = f"{r['gwh_range'][0]}-{r['gwh_range'][1]}" if r["kind"] == "claim" else f"{r['gwh']}"
        rows.append([Paragraph(r["label"], small), "annual" if r["kind"] == "claim" else f"{r['start']} to {r['end']}",
                     rep, f"{mod['mid_p50']:.1f}", f"{mod['min']:.0f}-{mod['max']:.0f}", r.get("position", "-"), r["reliability"]])
    story += [Paragraph("Scoreboard: model vs reports (GWh)", st["Heading3"]),
              Paragraph("Reported figures were not used to set any parameter. Each modelled value covers exactly the reporting period, "
                        "repeated over every weather year; the envelope spans all scenarios. Grid curtailment is not modelled.", small),
              table(rows, [38 * mm, 36 * mm, 18 * mm, 22 * mm, 20 * mm, 26 * mm, 18 * mm], 7.5)]

    rows = [["Assumption", "Low", "Mid", "High", "Unit", "Tag"]]
    rows += [[Paragraph(x["label"], small), str(x.get("low", "")), str(x["mid"]), str(x.get("high", "")), x.get("unit", ""), x["tag"]]
             for x in A if x["group"] in ("params", "economics", "site")]
    story += [Spacer(1, 4 * mm), Paragraph("Assumptions (low = pessimistic for yield)", st["Heading3"]),
              Paragraph(m["scenario_note"], small), table(rows, [70 * mm, 18 * mm, 30 * mm, 18 * mm, 22 * mm, 20 * mm], 7.5),
              Spacer(1, 4 * mm), Paragraph("Sources", st["Heading3"])]
    story += [Paragraph(f"<b>{x['title']}</b> ({x['type']}){' - ' + x['url'] if x['url'] else ''}. {x['note']}", small) for x in S]
    SimpleDocTemplate(str(out), pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                      title="Cirata Floating Solar brief").build(story)
    print(f"wrote {out}")


def monthly_chart(R):
    vals = [statistics.median(y[i] for y in R["monthly"]["mid"].values()) for i in range(12)]
    dr = Drawing(170 * mm, 45 * mm)
    c = VerticalBarChart()
    c.x, c.y, c.width, c.height = 10 * mm, 6 * mm, 155 * mm, 36 * mm
    c.data, c.categoryAxis.categoryNames = [vals], MONTHS
    c.valueAxis.valueMin = 0
    c.bars[0].fillColor = TEAL
    c.categoryAxis.labels.fontSize = c.valueAxis.labels.fontSize = 7
    dr.add(c)
    return dr


if __name__ == "__main__":
    here = Path(__file__).parent
    main(*(sys.argv[1:] or [here.parent / "site/data", here.parent / "site/brief.pdf"]))
