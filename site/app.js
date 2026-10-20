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
  monthly: "Energy per month in the mid scenario (median across weather years). The thin lines run from the pessimistic to the optimistic scenario.",
  tags: "Reported: published by the operator or the press. Assumed: our guess with a range, because no source was found. Modelled: calculated by this engine.",
  clipping: "The panels (192 MW) can make more than the grid connection (145 MW) accepts. On bright hours the extra is thrown away; this is called clipping.",
};

const fmt = (v, d = 0) => Number(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const infoBtn = (k) => `<button class="info" data-k="${k}" aria-label="What does this mean?">i</button>`;

Promise.all(["results", "typical_hourly", "assumptions", "sources", "dots"].map(get)).then(([R, T, A, S, D]) => {
  intro(D);
  if (R.meta.weather.synthetic) $("#synthetic").hidden = false;
  scene(R);
  stats(R);
  heatmap(T);
  scoreboard(R);
  monthly(R);
  assumptions(A, R);
  sources(S, R);
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
  const mSel = $("#month"), hIn = $("#hour");
  mSel.innerHTML = MONTHS.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c) => `rgb(${c.join(",")})`;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  function draw(m, h, live) {
    const uh = (h - WIB + 24) % 24;
    const mw = mh.mean[m][uh], el = mh.sun_elevation[m][uh], az = mh.sun_azimuth[m][uh];
    $("#now-mw").textContent = fmt(mw, 0);
    $("#now-label").textContent = `${live ? "Now: " : ""}${MONTHS[m]}, ${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:59 WIB`;
    $("#now-range").textContent = mw > 0 ? `Middle 80% of weather years: ${fmt(mh.p10[m][uh])}–${fmt(mh.p90[m][uh])} MW.` : "The sun is down.";
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
  mSel.onchange = hIn.oninput = () => draw(+mSel.value, +hIn.value, false);
  $("#reset-now").onclick = now;
  now();
}

/* ---------- statistics ---------- */
function stats(R) {
  const s = R.stats;
  const card = (title, key, value, range, tag, detail) =>
    `<div class="stat${detail ? " detail" : ""}"><h3>${title} ${infoBtn(key)}</h3><div class="v">${value}</div><div class="r">${range}</div><span class="tag ${tag}">${tag}</span></div>`;
  const a = s.annual_gwh;
  $("#stats").innerHTML = [
    card("Annual energy (P50)", "energy", `${fmt(a.p50, 0)} GWh`, `Scenarios ${fmt(a.low)}–${fmt(a.high)} GWh`, "modelled"),
    card("Capacity factor (AC)", "cf", `${fmt(s.capacity_factor_ac.mid * 100, 1)}%`, `Range ${fmt(s.capacity_factor_ac.low * 100, 1)}–${fmt(s.capacity_factor_ac.high * 100, 1)}%`, "modelled"),
    card("Revenue per year", "revenue", `US$${fmt(s.revenue_musd.mid, 0)}M`, `Range US$${fmt(s.revenue_musd.low)}–${fmt(s.revenue_musd.high)}M; tariff assumed`, "assumed"),
    card("Build cost", "cost", `US$${s.capex_musd.low}–${s.capex_musd.high}M`, "Reported order of magnitude, unverified", "assumed"),
    card("Homes powered", "homes", `~${fmt(s.homes.mid)}`, `Range ${fmt(s.homes.low)}–${fmt(s.homes.high)}; household use assumed`, "assumed"),
    card("Avoided CO₂ per year", "co2", `${fmt(s.avoided_kt_co2.mid)} kt`, `Range ${fmt(s.avoided_kt_co2.low)}–${fmt(s.avoided_kt_co2.high)} kt; grid factor assumed`, "assumed"),
    card("Weather spread (mid)", "p50", `P90 ${fmt(a.p90)} GWh`, `P50 ${fmt(a.p50)} · P10 ${fmt(a.p10)} GWh over ${R.annual.years.length} years`, "modelled", true),
    card("Specific yield", "yield", `${fmt(s.specific_yield_kwh_kwp.mid)} kWh/kWp`, `Range ${fmt(s.specific_yield_kwh_kwp.low)}–${fmt(s.specific_yield_kwh_kwp.high)}`, "modelled", true),
    card("Performance ratio", "pr", `${fmt(s.performance_ratio_mid * 100, 1)}%`, `Plane-of-array sunlight ${fmt(s.poa_kwh_m2_mid)} kWh/m² per year`, "modelled", true),
    card("Grid limit", "clipping", "145 MW", "192 MWp of panels feed a 145 MW connection (DC/AC 1.32)", "reported", true),
  ].join("");
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

/* ---------- scoreboard ---------- */
function scoreboard(R) {
  const syn = R.meta.weather.synthetic;
  $("#score").innerHTML = R.scoreboard.map((r) => {
    const m = r.modelled, isClaim = r.kind === "claim";
    const vals = [m.min, m.max, ...(isClaim ? r.gwh_range : [r.gwh])];
    const lo = Math.min(...vals) * 0.93, hi = Math.max(...vals) * 1.05, x = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
    const w = (a, b) => `left:${x(a)};width:calc(${x(b)} - ${x(a)})`;
    const marks = isClaim
      ? `<i class="claim" style="${w(...r.gwh_range)};top:80%"></i>`
      : `<i class="rep" style="left:${x(r.gwh)}" title="Reported ${r.gwh} GWh"></i>`;
    let verdict;
    if (isClaim) verdict = `Claimed ${r.gwh_range[0]}–${r.gwh_range[1]} GWh/yr vs modelled mid median ${fmt(m.mid_p50, 1)} (envelope ${fmt(m.min)}–${fmt(m.max)}).`;
    else {
      const diff = (r.ratio_to_mid_p50 - 1) * 100;
      verdict = `Reported ${fmt(r.gwh, 1)} GWh is ${fmt(Math.abs(diff), 1)}% ${diff < 0 ? "below" : "above"} the mid median (${fmt(m.mid_p50, 1)}); ${r.position}. ` +
        `${fmt(r.share_of_mid_years_below_report * m.n_weather_years)} of ${m.n_weather_years} mid weather years model less than reported.`;
      if (r.same_period_weather) verdict += ` With the actual period's weather: ${fmt(r.same_period_weather.low, 1)}–${fmt(r.same_period_weather.high, 1)} GWh (mid ${fmt(r.same_period_weather.mid, 1)}).`;
    }
    if (syn) verdict += " Synthetic weather: this comparison is not meaningful.";
    return `<div class="row"><div class="lab"><b>${r.label}</b><span class="small muted">${isClaim ? "claim" : r.start + " → " + r.end} · <span class="tag ${r.reliability === "high" ? "reported" : "assumed"}">${r.reliability} reliability</span></span></div>
      <div class="bar"><i class="env" style="${w(m.min, m.max)}"></i><i class="band" style="${w(m.mid_p10, m.mid_p90)}"></i><i class="p50" style="left:${x(m.mid_p50)}"></i>${marks}</div>
      <p class="verdict">${verdict} <span title="${r.note}">ⓘ ${r.note}</span></p></div>`;
  }).join("");
}

/* ---------- monthly bars ---------- */
function monthly(R) {
  const med = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const col = (sc, i) => med(Object.values(R.monthly[sc]).map((y) => y[i]));
  const rows = MONTHS.map((_, i) => ({ lo: col("low", i), mid: col("mid", i), hi: col("high", i) }));
  const top = Math.max(...rows.map((r) => r.hi)) * 1.1, y = (v) => 190 - (v / top) * 170;
  $("#monthly").innerHTML = rows.map((r, i) => {
    const x = 40 + i * 50;
    return `<rect x="${x}" y="${y(r.mid)}" width="34" height="${190 - y(r.mid)}" rx="3" fill="var(--band)"/>` +
      `<line x1="${x + 17}" x2="${x + 17}" y1="${y(r.hi)}" y2="${y(r.lo)}" stroke="var(--p50)" stroke-width="1.5"/>` +
      `<text x="${x + 17}" y="206" text-anchor="middle">${MONTHS[i]}</text><text x="${x + 17}" y="${y(r.hi) - 4}" text-anchor="middle">${fmt(r.mid, 1)}</text>`;
  }).join("") + `<text x="4" y="14">GWh</text>`;
}

/* ---------- assumptions & sources ---------- */
function assumptions(A, R) {
  const v = (x) => (x === undefined ? "" : typeof x === "number" ? fmt(x, Math.abs(x) < 1 && x !== 0 ? 4 : 1).replace(/\.?0+$/, "") : x);
  $("#assump tbody").innerHTML = A.filter((a) => a.group !== "outputs").map((a) =>
    `<tr><td>${a.label}</td><td>${v(a.low)}</td><td>${v(a.mid)}${a.range ? `<br><span class="muted">range ${a.range}</span>` : ""}</td><td>${v(a.high)}</td><td>${a.unit ?? ""}</td><td><span class="tag ${a.tag}">${a.tag}</span></td><td>${a.basis}</td></tr>`).join("");
  $("#sens").textContent = "Tilt sensitivity (mid scenario, median year): " +
    R.sensitivity.map((s) => `${s.value}° → ${s.change_pct > 0 ? "+" : ""}${s.change_pct}%`).join(", ") + " versus 10°. " + R.meta.scenario_note;
}
function sources(S, R) {
  $("#sources").innerHTML = S.map((s) => `<li><b>${s.title}</b> <span class="muted">(${s.type})</span>${s.url ? ` <a href="${s.url}">link</a>` : ""}<br><span class="muted small">${s.note}</span></li>`).join("");
  const m = R.meta;
  $("#meta").textContent = `Weather: ${m.weather.source}, years ${m.years[0]}–${m.years.at(-1)}. pvlib ${m.pvlib}. Built ${m.generated_utc}. Degradation applied for operating year 1.`;
}

/* ---------- mode toggle & info popover ---------- */
document.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => {
  document.body.classList.toggle("detailed", b.dataset.mode === "detailed");
  document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", x === b));
}));
const pop = $("#pop");
document.addEventListener("click", (e) => {
  const b = e.target.closest(".info");
  if (!b) { if (!pop.contains(e.target) || e.target.tagName === "BUTTON") pop.hidden = true; return; }
  pop.querySelector("p").textContent = INFO[b.dataset.k];
  pop.hidden = false;
  const r = b.getBoundingClientRect();
  pop.style.left = `${Math.min(r.left, innerWidth - pop.offsetWidth - 12)}px`;
  pop.style.top = `${Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 12)}px`;
});
