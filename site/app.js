"use strict";
const $ = (s) => document.querySelector(s);
const WIB = 7;
const LIMIT_MW = 145;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const get = (f) => fetch(`data/${f}.json`).then((r) => r.json());

const INFO = {
  now: "The power the model expects at this hour in this month, averaged over all weather years. Real output on any given day can be far higher or lower because of clouds. It is not a live reading.",
  energy: "Electricity sent to the grid in a year. 1 GWh (gigawatt-hour) is a million kWh: a 1,000 W kettle would need a million hours to use that much.",
  p50: "Weather changes every year. P50 is the middle year: half of the weather years give more, half give less. P90 is a cautious value that 9 out of 10 years beat.",
  cf: "Capacity factor: the energy actually produced divided by what the plant would make running at its full 145 MW grid limit every hour of the year. Solar stops at night, so around 20% is normal.",
  revenue: "Energy times the price the plant is paid per kWh. That price (the tariff) is not published, so we show a range of assumptions.",
  cost: "What it cost to build the plant. This is a reported order of magnitude, not a verified number.",
  homes: "Yearly energy divided by the electricity one household uses in a year. The household figure is assumed, so treat this as a rough picture.",
  co2: "Energy times how much CO2 the Java-Bali grid releases for each MWh it makes (assumed). It assumes each solar MWh replaces an average grid MWh.",
  yield: "Specific yield: energy per kW of solar panel capacity. It lets you compare plants of different sizes.",
  pr: "Performance ratio: energy delivered divided by what the panels would make if they turned the sunlight hitting them into power at their lab rating with no losses. Heat, dirt, wiring, inverters and the grid limit all lower it.",
  heatmap: "Each column is a day, each row an hour (WIB, midnight at the top). Brighter means more power. This is the model's median weather year, so clouds come from that year's weather.",
  scoreboard: "For each reported figure, the model is run over the same calendar period in every weather year and every scenario. If the report sits inside the bars the model is consistent with it; it does not prove the model is right.",
  monthly: "Energy per month in the mid scenario (median across weather years), with the wet and dry seasons shaded. The thin lines run from the pessimistic to the optimistic scenario.",
  tags: "Reported: published by the operator or the press. Assumed: our guess with a range, because no source was found. Modelled: calculated by this engine.",
  clipping: "Clipping: the panels (192 MW) can make more than the equipment passes. The 49 inverters stop at 153.1 MW and the grid connection at 145 MW; on bright hours the extra is thrown away.",
  mwp: "MWp (peak) is the panels' DC rating in lab sunlight. MWac is what can be sent to the grid as AC. Cirata has 192 MWp of panels but a 145 MWac connection.",
  dcac: "DC/AC ratio: panel rating divided by grid rating (192 / 145 = 1.32). A ratio above 1 makes more energy on cloudy hours at the cost of some clipping on the brightest ones.",
  waterfall: "Start with the sunlight hitting the panels, then remove each loss in turn until you reach the energy sold. Each bar is what is left after that step.",
  tornado: "Each bar shows how much the yearly total moves when one input is changed across its plausible range while everything else stays fixed. Longest bars matter most.",
};

const fmt = (v, d = 0) => {
  if (d < 0) [v, d] = [Math.round(v / 10 ** -d) * 10 ** -d, 0];
  return Number(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
};
const infoBtn = (k) => `<button class="info" data-k="${k}" aria-label="What does this mean?">i</button>`;

Promise.all(["results", "typical_hourly", "assumptions", "sources", "dots"].map(get)).then(([R, T, A, S, D]) => {
  const topics = [...new Set(S.map((s) => s.topic))];
  S = topics.flatMap((t) => S.filter((s) => s.topic === t));
  S.forEach((s, i) => { SRC[s.id] = s; SRCN[s.id] = i + 1; });
  intro(D);
  header(R);
  scene(R);
  stats(R);
  heatmap(T);
  scoreboard(R);
  methodology(A, R);
  waterfall(R);
  tornado(R);
  seasons(R);
  lab(R);
  hydro(R);
  economics(R);
  contradictions(R);
  sources(S, R);
  if (readHash().v === "detailed") setMode("detailed");
  selfCheck();
});

/* ---------- loading animation ---------- */
function intro(D) {
  const el = $("#loader");
  let seen = false;
  try { seen = sessionStorage.getItem("introSeen") === "1"; sessionStorage.setItem("introSeen", "1"); } catch (e) {}
  if (seen || matchMedia("(prefers-reduced-motion: reduce)").matches) return el.remove();
  const cv = $("#map"), ctx = cv.getContext("2d"), dpr = devicePixelRatio || 1;
  const W = (cv.width = innerWidth * dpr), H = (cv.height = innerHeight * dpr);
  const pts = (a) => Array.from({ length: a.length / 2 }, (_, i) => [a[2 * i] / 100, a[2 * i + 1] / 100, Math.random()]);
  const world = pts(D.world), java = pts(D.java);
  const target = [107.37, -6.7];
  const k0 = W / 380, k1 = Math.min(W, H * 2.5) / 9;
  const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
  let start, done = false;
  const finish = () => { if (done) return; done = true; el.classList.add("done"); setTimeout(() => el.remove(), 800); };
  $("#skip").onclick = finish;
  function frame(ts) {
    if (done) return;
    start ??= ts;
    const t = (ts - start) / 1000;
    const z = ease((t - 1.3) / 2.2);
    const k = Math.exp(Math.log(k0) + (Math.log(k1) - Math.log(k0)) * z);
    const cx = 0 + (target[0] - 0) * z, cy = 15 + (target[1] - 15) * z;
    const proj = ([lon, lat]) => [(lon - cx) * k + W / 2, -(lat - cy) * k + H / 2];
    ctx.clearRect(0, 0, W, H);
    const wa = Math.min(1, t / 1.2), worldFade = 1 - ease((z - 0.3) / 0.4);
    const rw = Math.max(1.2 * dpr, Math.min(0.7 * k, 6 * dpr));
    ctx.fillStyle = "#7fd8c6";
    for (const p of world) {
      const a = Math.min(1, Math.max(0, wa * 1.6 - p[2])) * 0.55 * worldFade;
      if (a <= 0) continue;
      const [x, y] = proj(p);
      if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
      ctx.globalAlpha = a; ctx.fillRect(x - rw / 2, y - rw / 2, rw, rw);
    }
    const ja = ease((z - 0.25) / 0.45) * 0.6, rj = Math.max(1, 0.036 * k);
    if (ja > 0) for (const p of java) {
      const [x, y] = proj(p);
      ctx.globalAlpha = ja * (0.6 + 0.4 * p[2]);
      ctx.beginPath(); ctx.arc(x, y, rj, 0, 7); ctx.fill();
    }
    if (t > 3.5) {
      const [x, y] = proj(target), ph = (t - 3.5) % 1.2;
      ctx.globalAlpha = 1 - ph / 1.2; ctx.strokeStyle = "#ffd25e"; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(x, y, (6 + ph * 30) * dpr, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = "#ffd25e"; ctx.beginPath(); ctx.arc(x, y, 4 * dpr, 0, 7); ctx.fill(); ctx.fillStyle = "#7fd8c6";
      $("#loader-label").style.opacity = 1;
    }
    ctx.globalAlpha = 1;
    if (t > 5.2) return finish();
    requestAnimationFrame(frame);
  }
  el.onclick = finish;
  requestAnimationFrame(frame);
}

/* ---------- plant scene ---------- */
function scene(R) {
  const mh = R.month_hour_utc, svg = "http://www.w3.org/2000/svg";
  const arr = $("#array"), rip = $("#ripples"), panels = [];
  for (let r = 0; r < 6; r++) {
    const y = 212 + r * r * 1.6 + r * 5, s = 0.55 + r * 0.17, n = 9 + r, w = 46 * s, gap = 6 * s;
    const x0 = 400 - (n * (w + gap)) / 2;
    const g = document.createElementNS(svg, "g");
    g.setAttribute("class", "bob"); g.style.animationDelay = `${-r * 0.6}s`;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (w + gap), h = 9 * s;
      g.insertAdjacentHTML("beforeend",
        `<rect x="${x - 1}" y="${y + h - 1}" width="${w + 2}" height="${2.5 * s}" fill="#e9eef0" opacity=".85"/>` +
        `<polygon class="panel" points="${x + 3 * s},${y} ${x + w - 3 * s},${y} ${x + w},${y + h} ${x},${y + h}"/>`);
    }
    arr.appendChild(g);
  }
  arr.querySelectorAll(".panel").forEach((p) => panels.push(p));
  for (let i = 0; i < 18; i++) {
    const x = (i * 97) % 820, y = 222 + ((i * 37) % 75);
    rip.insertAdjacentHTML("beforeend", `<line class="ripple" x1="${x}" y1="${y}" x2="${x + 22}" y2="${y}" style="animation-delay:${-i}s"/>`);
  }
  const mSel = $("#month"), hIn = $("#hour"), scen = $("#scen");
  mSel.innerHTML = MONTHS.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c) => `rgb(${c.join(",")})`;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  function draw(m, h, live) {
    const uh = (h - WIB + 24) % 24;
    const mw = mh[`mean_${scen.value}`][m][uh], el = mh.sun_elevation[m][uh], az = mh.sun_azimuth[m][uh];
    $("#now-mw").textContent = fmt(mw, 0);
    $("#now-label").textContent = `${live ? "Now: " : ""}${MONTHS[m]}, ${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:59 WIB`;
    $("#now-range").textContent = mw > 0 ? `Mid scenario, middle 80% of weather years: ${fmt(mh.p10[m][uh])}–${fmt(mh.p90[m][uh])} MW.` : "The sun is down.";
    const day = clamp((el + 4) / 14), dusk = clamp(1 - Math.abs(el - 2) / 8);
    const top = mix(mix([10, 18, 40], [64, 140, 205], day), [70, 60, 110], dusk * 0.5);
    const bot = mix(mix([20, 30, 55], [170, 214, 236], day), [246, 170, 110], dusk * 0.8);
    $("#sky0").setAttribute("stop-color", rgb(top)); $("#sky1").setAttribute("stop-color", rgb(bot));
    $("#w0").setAttribute("stop-color", rgb(mix(bot, [40, 80, 75], 0.55)));
    $("#w1").setAttribute("stop-color", rgb(mix(top, [10, 35, 35], 0.6)));
    const r = (Math.PI / 180);
    const sun = $("#sun");
    sun.setAttribute("cx", 400 + 370 * Math.sin(az * r) * Math.cos(el * r));
    sun.setAttribute("cy", 200 - 175 * Math.sin(Math.max(el, -10) * r));
    sun.style.opacity = el > -3 ? 1 : 0;
    const f = clamp(mw / LIMIT_MW);
    const pc = rgb(mix([22, 34, 60], [70, 130, 215], f));
    panels.forEach((p) => p.setAttribute("fill", pc));
  }
  function now() {
    const d = new Date(Date.now() + WIB * 3600e3);
    mSel.value = d.getUTCMonth(); hIn.value = d.getUTCHours();
    draw(d.getUTCMonth(), d.getUTCHours(), true);
  }
  mSel.onchange = hIn.oninput = scen.onchange = () => { draw(+mSel.value, +hIn.value, false); writeHash(); };
  $("#reset-now").onclick = () => { now(); writeHash(); };
  const hs = readHash();
  if (hs.m !== undefined && hs.h !== undefined) {
    mSel.value = hs.m; hIn.value = hs.h; scen.value = ["low", "mid", "high"].includes(hs.s) ? hs.s : "mid";
    draw(+mSel.value, +hIn.value, false);
  } else now();
}

/* ---------- heatmap ---------- */
const RAMP = [[11, 31, 42], [20, 92, 99], [47, 156, 127], [159, 211, 106], [246, 224, 94]];
function ramp(t) {
  const x = Math.max(0, Math.min(0.9999, t)) * (RAMP.length - 1), i = Math.floor(x), f = x - i;
  return RAMP[i].map((v, j) => Math.round(v + (RAMP[i + 1][j] - v) * f));
}
function heatmap(T) {
  const cv = $("#heat"), days = Math.floor(T.mw.length / 24);
  cv.width = days; cv.height = 24;
  const ctx = cv.getContext("2d"), img = ctx.createImageData(days, 24);
  for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++) {
    const i = d * 24 + h - WIB, v = i < 0 ? 0 : T.mw[i] ?? 0, c = ramp(v / LIMIT_MW), o = (h * days + d) * 4;
    img.data.set([...c, 255], o);
  }
  ctx.putImageData(img, 0, 0);
  $("#heat-scale").style.background = `linear-gradient(90deg, ${RAMP.map((c) => `rgb(${c})`).join(",")})`;
  $("#heat-cap").textContent = `Median weather year (${T.year}), mid scenario. Columns: 1 Jan → 31 Dec. Rows: hour of day in WIB, midnight at top.`;
}

/* ---------- header, footnotes, badges ---------- */
let SRC = {}, SRCN = {};
const CONF = { primary: 3, secondary: 2, unverified: 1 };
function fn(ids) {
  ids = [].concat(ids || []).filter(Boolean);
  return `<sup class="fn">${ids.map((id) => `<a href="#src-${id}" data-src="${id}">${SRCN[id] ?? "?"}</a>`).join(",")}</sup>`;
}
function conf(ids) {
  const c = [].concat(ids || []).map((i) => SRC[i]?.confidence).filter((x) => x in CONF);
  return c.length ? c.reduce((a, b) => (CONF[a] <= CONF[b] ? a : b)) : "";
}
const tag = (kind, ids) => {
  const c = kind === "reported" || kind === "inference" ? conf(ids) : "";
  return `<span class="tag ${kind}">${kind}${c ? " · " + c : ""}</span>`;
};

function header(R) {
  const m = R.meta, w = m.weather, yrs = `${m.years[0]}–${m.years.at(-1)}`;
  document.body.classList.toggle("synthetic", w.synthetic);
  $("#synthetic").hidden = !w.synthetic;
  $("#version").innerHTML = `${m.version} · sources as of ${m.sources_as_of} · weather: ${w.synthetic ? "synthetic" : w.source} ${yrs}`;
  if (!w.synthetic) {
    const cc = R.crosscheck;
    $("#wx-line").hidden = false;
    $("#wx-line").innerHTML = `Weather: ${w.source}, ${yrs} (${m.years.length} years)${fn([w.src])}` +
      (cc ? `; ${cc.source} ${cc.years[0]}–${cc.years.at(-1)} as a cross-check${fn(cc.src)}.` : ".");
  }
}

/* ---------- statistics ---------- */
const state = { homes: "esdm", ef: 0 };
function stats(R) {
  const s = R.stats, a = s.annual_gwh, E = R.facts.economics, src = R.stats_src;
  const card = (title, key, value, range, badge, ids, detail, extra = "") =>
    `<div class="stat${detail ? " detail" : ""}" data-needs-src><h3>${title} ${infoBtn(key)}</h3><div class="v">${value}${fn(ids)}</div><div class="r">${range}</div>${badge}${extra}</div>`;
  const homes = () => {
    const kwh = (g) => g * 1e6;
    if (state.homes === "esdm") {
      const n = (g) => kwh(g) / E.household_kwh;
      return { v: `~${fmt(n(a.p50), -3)}`, r: `Range ${fmt(n(a.low), -3)}–${fmt(n(a.high), -3)} from scenarios`, ids: ["model", ...E.household_src],
        lines: [`${fmt(a.p50, 1)} GWh = ${fmt(kwh(a.p50))} kWh per year (modelled P50)`, `÷ ${fmt(E.household_kwh)} kWh per household per year (${E.household_note})`, `= about ${fmt(n(a.p50), -2)} homes`] };
    }
    const per = kwh(a.p50) / E.official_homes;
    return { v: fmt(E.official_homes), r: `Official claim; implies ${fmt(per)} kWh per home`, ids: E.official_homes_src,
      lines: [`Official claim: ${fmt(E.official_homes)} homes`, `${fmt(a.p50, 1)} GWh ÷ ${fmt(E.official_homes)} = ${fmt(per)} kWh per home per year`, `= ${fmt(per / E.household_kwh, 1)}× the ESDM-derived average of ${fmt(E.household_kwh)} kWh`] };
  };
  const co2 = () => {
    const f = E.emission_factors[state.ef], kt = (g) => g * 1e3 * f.value / 1e3;
    return { v: `${fmt(kt(a.p50))} kt`, r: `Range ${fmt(kt(a.low))}–${fmt(kt(a.high))} kt; factor ${f.value} t/MWh`, ids: ["model", ...f.src],
      lines: [`${fmt(a.p50, 1)} GWh = ${fmt(a.p50 * 1e3)} MWh (modelled P50)`, `× ${f.value} t CO₂ per MWh (${f.note})`, `= ${fmt(kt(a.p50) * 1e3)} t ≈ ${fmt(kt(a.p50))} kt per year`, E.emission_note] };
  };
  const toggle = (name, opts, cur) => `<div class="seg mini" data-toggle="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join("")}</div>`;
  const arith = (lines) => `<details class="arith"><summary>Show the arithmetic</summary><ol>${lines.map((l) => `<li>${l}</li>`).join("")}</ol></details>`;
  const render = () => {
    const h = homes(), c = co2();
    $("#stats").innerHTML = [
      card("Annual energy (P50)", "energy", `${fmt(a.p50, 0)} GWh`, `Scenarios ${fmt(a.low)}–${fmt(a.high)} GWh`, tag("modelled"), src.annual_gwh),
      card("Capacity factor (AC)", "cf", `${fmt(s.capacity_factor_ac.mid * 100, 1)}%`, `Range ${fmt(s.capacity_factor_ac.low * 100, 1)}–${fmt(s.capacity_factor_ac.high * 100, 1)}%`, tag("modelled"), src.capacity_factor_ac),
      card("Revenue per year", "revenue", `US$${fmt(s.revenue_musd.mid, 1)}M`, `Range US$${fmt(s.revenue_musd.low, 1)}–${fmt(s.revenue_musd.high, 1)}M at ${E.tariff_usd_mwh} US$/MWh`, tag("modelled"), [...src.revenue_musd, ...E.tariff_src]),
      card("Build cost", "cost", `US$${E.capex_musd[0]}–${E.capex_musd[1]}M`, "Rp1.7 trillion reported; conflicting, unverified", tag("reported", E.capex_src), E.capex_src),
      card("Homes powered", "homes", h.v, h.r, tag("inference", h.ids), h.ids, false, toggle("homes", [["esdm", "ESDM 1,519 kWh"], ["official", "Official 50,000"]], state.homes) + arith(h.lines)),
      card("Avoided CO₂ per year", "co2", c.v, c.r, tag("inference", c.ids), c.ids, false, toggle("ef", E.emission_factors.map((f, i) => [i, f.label]), state.ef) + arith(c.lines)),
      card("Weather spread (mid)", "p50", `P90 ${fmt(a.p90)} GWh`, `P50 ${fmt(a.p50)} · P10 ${fmt(a.p10)} GWh over ${R.annual.years.length} years`, tag("modelled"), src.annual_gwh, true),
      card("Specific yield", "yield", `${fmt(s.specific_yield_kwh_kwp.mid)} kWh/kWp`, `Range ${fmt(s.specific_yield_kwh_kwp.low)}–${fmt(s.specific_yield_kwh_kwp.high)}`, tag("modelled"), src.specific_yield_kwh_kwp, true),
      card("Performance ratio", "pr", `${fmt(s.performance_ratio_mid * 100, 1)}%`, `Front-side sunlight ${fmt(s.poa_kwh_m2_mid)} kWh/m² per year`, tag("modelled"), src.performance_ratio_mid, true),
      card("Grid limits", "clipping", "153.1 → 145 MW", "49 inverters clip at 153.1 MW, then the export cap at 145 MW", tag("reported", ["dossier_unattributed", "masdar_proj"]), ["dossier_unattributed", "masdar_proj"], true),
    ].join("");
    selfCheck();
  };
  $("#stats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-toggle] button");
    if (!b) return;
    const k = b.parentElement.dataset.toggle;
    state[k] = k === "ef" ? +b.dataset.v : b.dataset.v;
    render();
  });
  render();
}

/* ---------- scoreboard ---------- */
function bar(m, marks, lo, hi) {
  const x = (v) => `${((v - lo) / (hi - lo)) * 100}%`, w = (a, b) => `left:${x(a)};width:calc(${x(b)} - ${x(a)})`;
  return { x, html: `<div class="bar"><i class="env" style="${w(m.min, m.max)}"></i><i class="band" style="${w(m.mid_p10, m.mid_p90)}"></i><i class="p50" style="left:${x(m.mid_p50)}"></i>${marks(x, w)}</div>` };
}
function scoreboard(R) {
  const syn = R.meta.weather.synthetic;
  $("#score").innerHTML = R.scoreboard.map((r) => {
    const m = r.modelled, lo = Math.min(m.min, r.gwh) * 0.93, hi = Math.max(m.max, r.gwh) * 1.05;
    const b = bar(m, (x) => `<i class="rep" style="left:${x(r.gwh)}" title="Reported ${r.gwh} GWh"></i>`, lo, hi);
    const diff = (r.ratio_to_mid_p50 - 1) * 100, sp = r.same_period_weather;
    let verdict = `Reported ${fmt(r.gwh, 1)} GWh is ${fmt(Math.abs(diff), 1)}% ${diff < 0 ? "below" : "above"} the mid median of all weather years (${fmt(m.mid_p50, 1)}); ${r.position}.`;
    if (sp) verdict += ` With this period's actual weather the model gives ${fmt(sp.low, 1)}–${fmt(sp.high, 1)} GWh (mid ${fmt(sp.mid, 1)}, ${r.gwh >= sp.mid ? "report " + fmt((r.gwh / sp.mid - 1) * 100, 1) + "% above" : "report " + fmt((1 - r.gwh / sp.mid) * 100, 1) + "% below"}).`;
    if (syn) verdict += " Synthetic weather: this comparison is not meaningful.";
    return `<div class="row" data-needs-src><div class="lab"><b>${r.label}${fn(r.src)}</b><span class="small muted">${r.start} → ${r.end} · ${tag("reported", r.src)}</span></div>
      ${b.html}<p class="verdict">${verdict} <span class="muted">${r.note}</span></p></div>`;
  }).join("");
  const by = Object.fromEntries(R.scoreboard.map((r) => [r.id, r]));
  const d = (r) => r?.same_period_weather && r.gwh - r.same_period_weather.mid;
  const a = d(by.pln_158), b = d(by.sec_279);
  if (!syn && a && b && Math.sign(a) !== Math.sign(b)) {
    $("#flip").hidden = false;
    $("#flip").innerHTML = `<b>Flag: sign flip.</b> With each period's own weather, the model is ${a < 0 ? "above" : "below"} the report for “${by.pln_158.label}” but ${b < 0 ? "above" : "below"} it for “${by.sec_279.label}”. Possible causes: commissioning ramp-up early on, or a seasonal-shape error in the model (see Seasons). Inference, not tested.`;
  }
  const A = R.stats.annual_gwh, am = { min: A.min, max: A.max, mid_p10: A.p90, mid_p90: A.p10, mid_p50: A.p50 };
  $("#claims").innerHTML = R.claims.map((c) => {
    const top = c.range[1] ?? A.max * 1.05, lo = Math.min(A.min, c.range[0]) * 0.93, hi = Math.max(A.max, top) * 1.05;
    const b = bar(am, (x, w) => c.range[0] === top ? `<i class="rep hollow" style="left:${x(top)}"></i>` : `<i class="claim" style="${w(c.range[0], top)}"></i>`, lo, hi);
    return `<div class="row" data-needs-src><div class="lab"><b>${c.label}${fn(c.src)}</b><span class="small muted">${c.who} · ${tag("reported", c.src)} claim</span></div>${b.html}</div>`;
  }).join("") + `<p class="small muted">Bars: modelled annual output over all weather years and scenarios. Claims are expectations, not measurements.</p>`;
  $("#ugm").innerHTML = `<span class="tag inference">flagged claim</span> ${R.facts.ugm_claim}${fn(["ugm", "dorenkamper_pvmag"])}`;
}

/* ---------- methodology ---------- */
function methodology(A, R) {
  const v = (x) => (x === undefined ? "" : typeof x === "number" ? fmt(x, Math.abs(x) < 1 && x !== 0 ? 4 : 1).replace(/\.?0+$/, "") : x);
  $("#assump tbody").innerHTML = A.map((a) =>
    `<tr data-needs-src><td>${a.label}${fn(a.src)}</td><td><span class="tag ${a.class === "FIXED" ? "reported" : "assumed"}">${a.class}</span></td><td>${v(a.low)}</td><td>${v(a.mid)}${a.range ? `<br><span class="muted">range ${a.range}</span>` : ""}</td><td>${v(a.high)}</td><td>${a.unit ?? ""}</td><td>${a.basis}</td></tr>`).join("");
  $("#hardware tbody").innerHTML = R.facts.hardware_facts.map(([k, t, s]) => `<tr data-needs-src><th>${k}</th><td>${t}${fn(s)}</td></tr>`).join("");
  const m = R.meta, cc = R.crosscheck, ck = R.checks, w = m.weather;
  const srcs = [...new Set(Object.values(m.per_year_source))];
  const items = [`Weather years ${m.years[0]}–${m.years.at(-1)}, source per year: ${srcs.join(", ")}${fn(w.src ? [w.src] : ["model"])}. Timestamps are UTC; converted to WIB only in the page.`,
    `Mean daily profile peaks at ${m.mean_profile_peak_wib}:00–${m.mean_profile_peak_wib}:59 WIB (check: must be 11–12; the build fails otherwise).${fn(["model"])}`];
  if (cc) items.push(`Cross-check: the same model on ${cc.source} gives a P50 of ${fmt(cc.p50, 1)} GWh vs ${fmt(R.stats.annual_gwh.p50, 1)} on NASA POWER; over ${cc.overlap_years[0]}–${cc.overlap_years[1]} NASA POWER yields ${fmt(cc.power_over_pvgis, 3)}× PVGIS. The weather source alone moves the answer by about ${fmt(Math.abs(1 - cc.power_over_pvgis) * 100, 0)}%.${fn([...cc.src, "kim2026"])}`);
  if (ck) {
    const [lo, hi] = ck.poa_window, p = ck.poa_2024_kwh_m2, inside = p >= lo && p <= hi;
    items.push(`<span class="tag inference">inference</span> Plausibility: 279 GWh in 2024 is 1,453 kWh/kWp, which needs ${fmt(hi)} kWh/m² of plane-of-array sunlight at PR 0.85 or ${fmt(lo)} at PR 0.93. Modelled 2024 front-side sunlight: ${fmt(p)} kWh/m², ${inside ? "inside" : "outside"} that window (implied PR ${fmt(1453 / p, 2)} if the report is right).${fn(["ecobiz", "model"])}`);
  }
  $("#wx-detail").innerHTML = items.map((i) => `<li data-needs-src>${i}</li>`).join("");
}

/* ---------- loss waterfall ---------- */
function waterfall(R) {
  const st = R.waterfall.steps, top = st[0].gwh;
  $("#wf-cap").innerHTML = `Mid scenario, median weather year (${R.waterfall.year}): the same model run as the headline.${fn(["model"])}`;
  $("#waterfall").innerHTML = st.map((s, i) => {
    const d = i ? s.gwh - st[i - 1].gwh : 0;
    return `<div class="wf"><span>${s.label}</span><div class="wfbar"><i style="width:${(s.gwh / top) * 100}%"></i></div><b>${fmt(s.gwh, 1)}</b><em class="${d < 0 ? "neg" : "pos"}">${i ? (d > 0 ? "+" : "") + fmt(d, 1) : "GWh"}</em></div>`;
  }).join("");
}

/* ---------- sensitivity tornado ---------- */
function tornado(R) {
  const T = R.tornado, base = T.base_gwh, span = Math.max(...T.rows.flatMap((r) => r.gwh.map((g) => Math.abs(g - base)))) || 1;
  $("#tor-cap").innerHTML = `Swing in annual GWh around the mid case (${fmt(base, 1)} GWh, median weather year) when one input moves across its range. Albedo barely matters here because rear-side gain is its own input.${fn(["model"])}`;
  $("#tornado").innerHTML = T.rows.map((r) => {
    const seg = (g, val) => {
      const d = g - base, w = (Math.abs(d) / span) * 50;
      return `<i class="${d < 0 ? "neg" : "pos"}" style="${d < 0 ? `right:50%` : `left:50%`};width:${w}%" title="${val}: ${fmt(g, 1)} GWh"></i>`;
    };
    const lab = (val) => (typeof val !== "number" ? val : r.unit === "fraction" ? `${fmt(val * 100, 1)}%` : r.unit === "-" ? val : `${val} ${r.unit}`);
    return `<div class="tor" data-needs-src><span>${r.label}${fn(r.src)}</span><div class="torbar">${seg(r.gwh[0], r.values[0])}${seg(r.gwh[1], r.values[1])}</div><small>${lab(r.values[0])}: ${fmt(r.gwh[0] - base, 1)} · ${lab(r.values[1])}: ${fmt(r.gwh[1] - base, 1)}</small></div>`;
  }).join("");
}

/* ---------- seasons ---------- */
function seasons(R) {
  const med = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const col = (sc, i) => med(Object.values(R.monthly[sc]).map((y) => y[i]));
  const rows = MONTHS.map((_, i) => ({ lo: col("low", i), mid: col("mid", i), hi: col("high", i) }));
  const top = Math.max(...rows.map((r) => r.hi)) * 1.1, y = (v) => 210 - (v / top) * 160, X = (i) => 40 + i * 50;
  const shade = (a, b, cls, label) => `<rect class="${cls}" x="${X(a) - 8}" y="40" width="${X(b) - X(a) + 50}" height="170"/><text x="${X(a) - 4}" y="52">${label}</text>`;
  const period = (a, b, yy, label) => `<line class="period" x1="${X(a)}" x2="${X(b) + 34}" y1="${yy}" y2="${yy}"/><text x="${X(a)}" y="${yy - 4}">${label}</text>`;
  $("#monthly").innerHTML = shade(0, 3, "wet", "wet (inference)") + shade(5, 9, "dry", "dry (inference)") + shade(10, 11, "wet", "") +
    period(0, 11, 14, "279 / 273.7 GWh: calendar 2024") + period(0, 5, 30, "158 GWh: 9 Nov 2023 – 30 Jun 2024") + period(10, 11, 30, "") +
    rows.map((r, i) => `<rect x="${X(i)}" y="${y(r.mid)}" width="34" height="${210 - y(r.mid)}" rx="3" fill="var(--band)"/>` +
      `<line x1="${X(i) + 17}" x2="${X(i) + 17}" y1="${y(r.hi)}" y2="${y(r.lo)}" stroke="var(--p50)" stroke-width="1.5"/>` +
      `<text x="${X(i) + 17}" y="226" text-anchor="middle">${MONTHS[i]}</text>`).join("") + `<text x="4" y="248">GWh/month, mid median; lines = low to high scenario</text>`;
  const si = R.facts.seasonality_inference, ck = R.checks;
  $("#season-note").innerHTML = `<span class="tag inference">inference</span> ${si.note} Reports imply Jan–Jun 2024 ≈ ${si.h1_gwh} GWh and Jul–Dec ≈ ${si.h2_gwh} GWh${fn(si.src)}.` +
    (ck ? ` The model with 2024 weather gives ${fmt(ck.h1_2024_gwh, 1)} and ${fmt(ck.h2_2024_gwh, 1)} GWh: ${ck.h2_2024_gwh < si.h2_gwh ? `it under-predicts the dry-season half by ${fmt((1 - ck.h2_2024_gwh / si.h2_gwh) * 100, 0)}%` : "close in the second half"}.${fn(["model"])}` : "");
}

/* ---------- calibration lab ---------- */
function pvwattsUnclipped(pdc, pdc0, etaNom, etaRef = 0.9637) {
  if (pdc <= 0) return 0;
  const z = pdc / pdc0;
  return (etaNom / etaRef) * (-0.0162 * z - 0.0059 / z + 0.9858) * pdc;
}
function labEnergy(bins, c, p) {
  let mwh = 0;
  for (let i = 1; i < bins.length; i++) {
    if (!bins[i]) continue;
    const dc = i * (1 - p.soiling) * (1 - c.mismatch_wiring) * c.degradation_factor * (1 + p.bifacial_gain);
    const inv = Math.min(pvwattsUnclipped(dc, c.inverter_ac_mw / c.inverter_eff, c.inverter_eff), c.inverter_ac_mw);
    mwh += Math.max(0, Math.min(inv * (1 - c.ac_loss), c.ac_limit_mw) * p.availability) * bins[i];
  }
  return mwh;
}
function lab(R) {
  const L = R.lab;
  if (!L) return ($("#lab").innerHTML = `<p class="small">Not available: needs real weather for Nov 2023 – Dec 2024.</p>`);
  const P = Object.fromEntries(["tilt_deg", "u_value", "soiling", "availability", "bifacial_gain"].map((k) => [k, R.defaults[k]]));
  const sliders = [["tilt_deg", "Tilt", L.tilt, "°"], ["u_value", "Uc (cooling)", L.uc, " W/m²K"], ["soiling", "Soiling", [0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04], "%"],
    ["availability", "Availability", [0.95, 0.955, 0.96, 0.965, 0.97, 0.975, 0.98, 0.985, 0.99], "%"], ["bifacial_gain", "Bifacial gain", [0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03], "%"]];
  const show = (v, u) => (u === "%" ? `${fmt(v * 100, 1)}%` : `${v}${u}`);
  const targets = R.scoreboard.filter((r) => r.id === "sec_279" || r.id === "pln_158").map((r) => ({ key: r.id === "sec_279" ? "cy2024" : "pln_158", r }));
  $("#lab").innerHTML = sliders.map(([k, l, vals, u]) => `<label class="lab-row">${l} <input type="range" data-k="${k}" min="0" max="${vals.length - 1}" step="1" value="${vals.indexOf(P[k])}"><output>${show(P[k], u)}</output></label>`).join("") +
    `<div id="lab-out"></div><button type="button" class="link" id="lab-reset">Reset to default</button>`;
  const run = () => {
    $("#lab-out").innerHTML = targets.map(({ key, r }) => {
      const g = labEnergy(L.grid[`${P.tilt_deg}|${P.u_value}`][key], L.const, P) / 1e3, d = (g / r.gwh - 1) * 100;
      return `<p class="small" data-needs-src><b>${r.label}:</b> lab ${fmt(g, 1)} GWh vs reported ${fmt(r.gwh, 1)}${fn(r.src)} (${d > 0 ? "+" : ""}${fmt(d, 1)}%)</p>`;
    }).join("") + `<p class="small muted">Fit is non-unique: different slider combinations give the same totals.</p>`;
    selfCheck();
  };
  $("#lab").addEventListener("input", (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const [, , vals, u] = sliders.find((s) => s[0] === k);
    P[k] = vals[+e.target.value];
    e.target.nextElementSibling.textContent = show(P[k], u);
    run();
  });
  $("#lab-reset").onclick = () => lab(R);
  run();
}

/* ---------- hydro & reservoir ---------- */
function hydro(R) {
  const mh = R.month_hour_utc.mean_mid, H = R.facts.hydro;
  const prof = Array.from({ length: 24 }, (_, h) => mh.reduce((s, m) => s + m[(h - WIB + 24) % 24], 0) / 12);
  const top = LIMIT_MW, x = (h) => 40 + h * 24, y = (v) => 170 - (v / top) * 150;
  const pts = prof.map((v, h) => `${x(h + 0.5)},${y(v)}`).join(" ");
  $("#hydro").innerHTML = `<rect class="peak" x="${x(H.window[0])}" y="20" width="${x(H.window[1]) - x(H.window[0])}" height="150"/>` +
    `<text x="${x(H.window[0]) + 4}" y="34">Hydro peaking ${H.window[0]}:00–${H.window[1]}:00</text>` +
    `<polygon class="pv" points="${x(0.5)},170 ${pts} ${x(23.5)},170"/>` +
    [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<text x="${x(h)}" y="186" text-anchor="middle">${String(h).padStart(2, "0")}</text>`).join("") +
    `<text x="40" y="14">Mean modelled PV output, MW (WIB hour), all weather years</text><text x="${x(12)}" y="${y(Math.max(...prof)) - 6}" text-anchor="middle">${fmt(Math.max(...prof))} MW</text>`;
  const F = R.facts, cov = (F.area_ha / F.reservoir_ha) * 100, covw = (F.water_area_ha / F.reservoir_ha) * 100;
  const rows = [...H.facts, ...H.reservoir_facts, ["Coverage", `About ${fmt(cov, 1)}% of the ${fmt(F.reservoir_ha)} ha reservoir (${fmt(covw, 1)}% water area only); inference`, ["dossier_unattributed", "enwiki_dam"]]];
  $("#hydro-facts tbody").innerHTML = rows.map(([k, t, s]) => `<tr data-needs-src><th>${k}</th><td>${t}${fn(s)}</td></tr>`).join("");
  const clone = $("#scene").cloneNode(true);
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  clone.querySelector(".lake").insertAdjacentHTML("beforebegin", `<rect y="196" width="800" height="104" fill="#6b5a45"/>`);
  $("#res-scene").appendChild(clone);
  const lake = clone.querySelector(".lake");
  $("#level").oninput = (e) => {
    const lv = +e.target.value;
    lake.setAttribute("transform", `translate(0 ${(H.level_band_m[1] - lv) * 4})`);
    $("#level-v").textContent = `+${lv} m`;
  };
}

/* ---------- economics & expansion ---------- */
function economics(R) {
  const E = R.facts.economics, s = R.stats, rev = s.revenue_musd, [c0, c1] = E.capex_musd;
  const card = (t, v, r, b, ids) => `<div class="stat" data-needs-src><h3>${t}</h3><div class="v">${v}${fn(ids)}</div><div class="r">${r}</div>${b}</div>`;
  $("#econ").innerHTML = [
    card("Revenue (modelled P50)", `US$${fmt(rev.mid, 2)}M`, `Range ${fmt(rev.low, 2)}–${fmt(rev.high, 2)}M at ${E.tariff_usd_mwh} US$/MWh`, tag("modelled"), ["model", ...E.tariff_src]),
    card("Capex", `US$${c0}–${c1}M`, "Rp1.7 trillion; conflicting, unverified", tag("reported", E.capex_src), E.capex_src),
    card("Cost intensity", `${fmt(c0 / 192, 2)}–${fmt(c1 / 192, 2)} US$/Wp`, "Capex ÷ 192 MWp", tag("inference", E.capex_src), E.capex_src),
    card("Simple payback", `${fmt(c0 / rev.high, 1)}–${fmt(c1 / rev.low, 1)} years`, "Capex ÷ revenue, before opex, debt and tax", tag("inference", ["model", ...E.capex_src]), ["model", ...E.capex_src]),
  ].join("");
  $("#econ-note").innerHTML = `${E.ugm_bpp_note}${fn(["ugm"])} <b>Not public:</b> ${E.not_public.join(", ")}.`;
  const X = R.facts.expansion, sel = $("#expand");
  sel.innerHTML = X.map((x, i) => `<option value="${i}">${x.label}</option>`).join("");
  const dcac = R.site.dc_kwp / R.site.ac_limit_kw;
  sel.onchange = () => {
    const x = X[+sel.value], mwp = x.mwp ?? x.mwac * dcac, k = mwp / 192, area = R.facts.area_ha * k;
    $("#expand-out").innerHTML = x.id === "now" ? `Today: ${fmt(R.facts.area_ha)} ha, ${fmt((R.facts.area_ha / R.facts.reservoir_ha) * 100, 1)}% of the reservoir.${fn(["dossier_unattributed", "enwiki_dam"])}` :
      `<span class="tag inference">plan, not commitment</span> About ${fmt(mwp)} MWp${x.mwp ? "" : " (assuming today's DC/AC)"}: roughly ${fmt(s.annual_gwh.p50 * k)} GWh/yr and ${fmt(area)} ha, ${fmt((area / R.facts.reservoir_ha) * 100, 1)}% of ${fmt(R.facts.reservoir_ha)} ha. Linear scaling of today's P50 and area (inference). Fish-farmer livelihoods are the main constraint.${fn([...x.src, "antara"])}`;
    selfCheck();
  };
  sel.onchange();
}

/* ---------- contradictions ---------- */
function contradictions(R) {
  $("#contra tbody").innerHTML = R.facts.contradictions.map((c) =>
    `<tr data-needs-src><td>${c.topic}</td><td>${c.values.map(([v, who, s]) => `${v} <span class="muted">(${who})</span>${fn([s])}`).join("<br>")}</td><td>${c.used}</td></tr>`).join("");
}

/* ---------- sources registry ---------- */
function sources(S, R) {
  const topics = [...new Set(S.map((s) => s.topic))];
  $("#src-list").innerHTML = topics.map((t) => `<h3>${t}</h3><ol class="sources">${S.filter((s) => s.topic === t).map((s) =>
    `<li id="src-${s.id}" value="${SRCN[s.id]}"><b>${s.url ? `<a href="${s.url}" rel="noopener">${s.title}</a>` : s.title}</b>${s.used_weather ? ' <span class="tag reported">weather used</span>' : ""}
      <br><span class="small muted">${s.publisher} · ${s.date} · <span class="tag ${s.confidence in CONF ? "reported" : s.confidence}">${s.confidence}</span> · ${s.licence} · used for: ${s.used_for}${s.url ? "" : " · no link recorded"} · listed ${s.accessed}</span></li>`).join("")}</ol>`).join("");
  $("#not-public").textContent = R.facts.not_public.join(" · ");
  document.querySelectorAll(".asof").forEach((n) => (n.textContent = R.meta.sources_as_of));
  const m = R.meta;
  $("#meta").textContent = `Built ${m.generated_utc} with pvlib ${m.pvlib}. Degradation applied for operating year 1.`;
}

function selfCheck() {
  document.querySelectorAll("[data-needs-src]").forEach((n) => {
    if (!n.querySelector(".fn a")) console.error("number without source marker:", n.textContent.slice(0, 80));
  });
}

/* ---------- URL hash state, mode toggle, footnotes, info popover ---------- */
function readHash() {
  return Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
}
function writeHash() {
  const h = new URLSearchParams({ m: $("#month").value, h: $("#hour").value, s: $("#scen").value, v: document.body.classList.contains("detailed") ? "detailed" : "light" });
  history.replaceState(null, "", "#" + h);
}
function setMode(mode) {
  document.body.classList.toggle("detailed", mode === "detailed");
  document.querySelectorAll(".seg[aria-label] button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.mode === mode));
}
document.querySelectorAll(".seg[aria-label] button").forEach((b) => (b.onclick = () => { setMode(b.dataset.mode); writeHash(); }));
$("#method-link").onclick = (e) => {
  e.preventDefault();
  setMode("detailed"); writeHash();
  $("#method details").open = true;
  $("#method").scrollIntoView({ behavior: "smooth" });
};
const pop = $("#pop");
document.addEventListener("click", (e) => {
  const a = e.target.closest(".fn a");
  if (a) {
    e.preventDefault();
    const li = document.getElementById(`src-${a.dataset.src}`);
    $("#sources").open = true;
    li.scrollIntoView({ behavior: "smooth", block: "center" });
    li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash");
    return;
  }
  const b = e.target.closest(".info");
  if (!b) { if (!pop.contains(e.target) || e.target.tagName === "BUTTON") pop.hidden = true; return; }
  e.preventDefault();
  pop.querySelector("p").textContent = INFO[b.dataset.k];
  pop.hidden = false;
  const r = b.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 12))}px`;
  pop.style.top = `${Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 12)}px`;
});
