/*
  npm-pulse - charts
  https://evoluteur.github.io/npm-pulse/
  (c) 2026 Olivier Giulieri
*/

const topCount = 12; // number of packages in the ranking
const chartDurationKey = "npm-pulse-chart-period";

let duration = storedDuration(chartDurationKey, "12m"); // period of the charts

const durationPickerHTML = () => `<select
    class="duration-picker"
    onchange="setDuration(this.value)"
    aria-label="Period covered by the charts"
    title="Period covered by the charts"
  >${durationOptionsHTML(duration)}</select>`;

const setDuration = async (value) => {
  duration = durationById(value, duration.id);
  storeDuration(chartDurationKey, duration);
  await loadDuration();
  renderCharts();
};

// the longer periods need years of daily downloads npm-pulse does not load
// upfront, so they are fetched the first time they are picked
const loadDuration = async () => {
  if (!duration.years || duration.years <= historyYears) {
    return;
  }
  chartsMessage("Loading the full history...");
  try {
    await loadHistory(duration.years);
  } catch (e) {
    chartsMessage(`Could not reach the npm registry: ${escapeHtml(e.message)}`);
  }
};

// downloads of one package since the first day covered by the charts
const downloadsSince = (pkg, firstDay) =>
  pkg.days.reduce(
    (total, d) => (d.day >= firstDay ? total + (d.downloads || 0) : total),
    0,
  );

// round a maximum up to a readable value (1200 -> 2000, 43 -> 50)
const niceMax = (value) => {
  if (value <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  const step = steps.find((s) => value <= s * power) || 10;
  return step * power;
};

const gridHTML = (max, x0, x1, y0, y1, ticks) => {
  let html = "";
  for (let i = 0; i <= ticks; i++) {
    const y = y1 - ((y1 - y0) * i) / ticks;
    html += `<line class="grid" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"></line>
      <text class="axis value" x="${x0 - 10}" y="${
        y + 4
      }" text-anchor="end">${fNum(Math.round((max * i) / ticks))}</text>`;
  }
  return html;
};

// downloads per bucket (a month or a day), across every package
const barsChart = (points, partialLast, label) => {
  const w = 900;
  const h = 272; // 20% shorter than the 340 it used to be
  const left = 90;
  const right = 20;
  const top = 20;
  const bottom = 50;
  const max = niceMax(Math.max(...points.map((p) => p.downloads), 1));
  const iw = w - left - right;
  const step = iw / points.length;
  const barW = Math.min(step * 0.62, 60);
  // with many bars only every nth one is labelled, to keep the axis readable
  const labelEvery = Math.ceil(points.length / 12);
  const bars = points
    .map((p, i) => {
      const height = ((h - top - bottom) * p.downloads) / max;
      const x = left + i * step + (step - barW) / 2;
      const y = h - bottom - height;
      const partial = partialLast && i === points.length - 1;
      const showLabel = (points.length - 1 - i) % labelEvery === 0;
      return `<rect class="bar${partial ? " partial" : ""}" x="${x.toFixed(
        1,
      )}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(
        1,
      )}"><title>${p.key}: ${fNum(p.downloads)} downloads${
        partial ? " so far" : ""
      }</title></rect>
      ${
        showLabel
          ? `<text class="axis" x="${(x + barW / 2).toFixed(1)}" y="${
              h - bottom + 20
            }" text-anchor="middle">${p.label}</text>`
          : ""
      }`;
    })
    .join("");
  return `<svg class="chart period-chart" viewBox="0 0 ${w} ${h}" role="img"
    aria-label="${label}">
    ${gridHTML(max, left, w - right, top, h - bottom, 4)}
    ${bars}
  </svg>`;
};

// Tableau 10, one color per package, shared by the panels so a package
// keeps its color from one chart to the next
const PIE_COLORS = [
  "#4e79a7",
  "#f28e2b",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
  "#9c755f",
  "#bab0ac",
];

// one panel per series (stars, forks, downloads), each shown as bars, as a
// pie or as a table, like the cards of github-projects-cards
const SERIES = [
  { id: "downloads", label: "Downloads", field: "period", unit: "downloads" },
  { id: "stars", label: "Stars", field: "stars", unit: "stars" },
  { id: "forks", label: "Forks", field: "forks", unit: "forks" },
];

const seriesViews = ["bars", "pie", "table"];

const seriesViewKey = (id) => `npm-pulse-view-${id}`;

const storedSeriesView = (id) => {
  try {
    const stored = localStorage.getItem(seriesViewKey(id));
    return seriesViews.includes(stored) ? stored : "pie";
  } catch (e) {
    return "pie";
  }
};

const seriesView = {};
SERIES.forEach((s) => {
  seriesView[s.id] = storedSeriesView(s.id);
});

const setSeriesView = (id, view) => {
  const previous = seriesView[id];
  if (previous === view) {
    return;
  }
  seriesView[id] = view;
  try {
    localStorage.setItem(seriesViewKey(id), view);
  } catch (e) {
    // private browsing, the choice just does not stick
  }
  const morphing = previous !== "table" && view !== "table";
  if (morphing) {
    // the same boxes stay on the page and morph into the other shape
    const panel = document
      .getElementById(`morph-${id}`)
      .closest(".chart-block");
    panel.querySelector(".chart-toggle").outerHTML = seriesToggleHTML(id);
    applyMorphLayout(id);
  } else {
    renderCharts();
  }
};

const icoBars = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22,21H2V3H4V19H6V10H10V19H12V6H16V19H18V14H22V21Z" /></svg>`;
const icoPie = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11,2V22C5.9,21.5 2,17.2 2,12C2,6.8 5.9,2.5 11,2M13,2V11H22C21.5,6.2 17.8,2.5 13,2M13,13V22C17.7,21.5 21.5,17.8 22,13H13Z" /></svg>`;
const icoTable = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4,3H20A2,2 0 0,1 22,5V19A2,2 0 0,1 20,21H4A2,2 0 0,1 2,19V5A2,2 0 0,1 4,3M4,7V11H8V7H4M10,7V11H14V7H10M20,11V7H16V11H20M4,13V17H8V13H4M10,13V17H14V13H10M16,13V17H20V13H16Z" /></svg>`;
const viewIcons = { bars: icoBars, pie: icoPie, table: icoTable };
const viewTitles = {
  bars: "Bar chart",
  pie: "Pie chart",
  table: "Data as a table",
};

const seriesToggleHTML = (id) =>
  `<span class="chart-toggle">${seriesViews
    .map(
      (view) =>
        `<button type="button" class="${
          seriesView[id] === view ? "selected" : ""
        }" onclick="setSeriesView('${id}', '${view}')" title="${
          viewTitles[view]
        }" aria-label="${viewTitles[view]}">${viewIcons[view]}</button>`,
    )
    .join("")}</span>`;

// --- morphing bars <-> pie ---------------------------------------------
// Ported from react-morph-charts (https://github.com/evoluteur/react-morph-charts):
// every package is a positioned box, the pie wedge is a clip-path on it, and
// the change of shape is a plain CSS transition of transform/size/clip-path.

const MORPH = {
  barGap: 8,
  barMaxWidth: 64,
  barMinHeight: 24,
  stageHeight: 230,
  pieMaxRadius: 115,
  clipSteps: 48,
  pieHoverOffset: 12,
};

const morphItems = {}; // series id -> Map(package -> element)
const morphLayout = {}; // series id -> Map(package -> placement)

// dark text on a light box, light text on a dark one
const textOn = (color) => {
  const hex = color.replace("#", "");
  const rgb =
    hex.length === 3
      ? hex.split("").map((c) => parseInt(c + c, 16))
      : [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance > 0.6 ? "#1a1a1a" : "#ffffff";
};

const barsLayout = (width, entries) => {
  const placements = new Map();
  const count = Math.max(entries.length, 1);
  const barWidth = Math.min(
    MORPH.barMaxWidth,
    (width - MORPH.barGap * (count - 1)) / count,
  );
  const totalWidth = barWidth * count + MORPH.barGap * (count - 1);
  const offsetX = Math.max((width - totalWidth) / 2, 0);
  const max = Math.max(...entries.map((e) => e.value), 1);
  entries.forEach((entry, i) => {
    const h =
      MORPH.barMinHeight +
      (entry.value / max) * (MORPH.stageHeight - MORPH.barMinHeight);
    placements.set(entry.name, {
      x: offsetX + i * (barWidth + MORPH.barGap),
      y: MORPH.stageHeight - h,
      w: barWidth,
      h,
    });
  });
  return placements;
};

const pieLayout = (width, entries) => {
  const placements = new Map();
  const total = entries.reduce((t, e) => t + e.value, 0) || 1;
  const r = Math.max(
    Math.min(MORPH.pieMaxRadius, width / 2 - 6, MORPH.stageHeight / 2),
    50,
  );
  let angle = 0;
  entries.forEach((entry) => {
    const sweep = (entry.value / total) * 360;
    placements.set(entry.name, {
      x: width / 2 - r,
      y: MORPH.stageHeight / 2 - r,
      w: r * 2,
      h: r * 2,
      startAngle: angle,
      endAngle: angle + sweep,
    });
    angle += sweep;
  });
  return placements;
};

// a point of the item's box (a square for the pie, the bar for the bars)
// at the given angle, in percent of the box
const pointOnShape = (shape, angleDeg) => {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  if (shape === "rect") {
    const scale = 50 / Math.max(Math.abs(dx), Math.abs(dy), 0.0001);
    return [50 + dx * scale, 50 + dy * scale];
  }
  return [50 + dx * 50, 50 + dy * 50];
};

const clipPathFor = (shape, startAngle, endAngle, centerAnchor) => {
  const points = [];
  if (centerAnchor) {
    points.push("50% 50%");
  } else {
    const [ax, ay] = pointOnShape(shape, startAngle);
    points.push(`${ax}% ${ay}%`);
  }
  for (let i = 0; i <= MORPH.clipSteps; i++) {
    const angle = startAngle + ((endAngle - startAngle) * i) / MORPH.clipSteps;
    const [x, y] = pointOnShape(shape, angle);
    points.push(`${x}% ${y}%`);
  }
  return `polygon(${points.join(",")})`;
};

const pieCenterOffset = (p, distance) => {
  if (p.startAngle === undefined) {
    return { dx: 0, dy: 0 };
  }
  const mid = (p.startAngle + p.endAngle) / 2;
  const rad = (mid * Math.PI) / 180;
  return { dx: Math.sin(rad) * distance, dy: -Math.cos(rad) * distance };
};

const applyMorphLayout = (id) => {
  const stage = document.getElementById(`morph-${id}`);
  const items = morphItems[id];
  if (!stage || !items) {
    return;
  }
  const pie = seriesView[id] === "pie";
  const width = stage.clientWidth || 320;
  const entries = [...items.keys()].map((name) => ({
    name,
    value: Number(items.get(name).dataset.value),
  }));
  const placements = pie
    ? pieLayout(width, entries)
    : barsLayout(width, entries);
  morphLayout[id] = placements;
  stage.style.height = `${MORPH.stageHeight}px`;
  items.forEach((el, name) => {
    const p = placements.get(name);
    el.style.width = `${p.w}px`;
    el.style.height = `${p.h}px`;
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.style.clipPath = clipPathFor(
      pie ? "circle" : "rect",
      p.startAngle ?? 0,
      p.endAngle ?? 360,
      pie,
    );
    const sweep = pie ? p.endAngle - p.startAngle : 0;
    el.classList.toggle("pie", pie);
    el.classList.toggle("narrow", pie ? sweep < 34 : p.w < 46);
    el.classList.toggle("tiny", pie && sweep < 15);
    const label = el.querySelector(".morph-label");
    if (pie) {
      const mid = (p.startAngle + p.endAngle) / 2;
      const rad = (mid * Math.PI) / 180;
      const r = p.w / 2;
      label.style.transform = `translate(${(Math.sin(rad) * r * 0.62).toFixed(
        1,
      )}px, ${(-Math.cos(rad) * r * 0.62).toFixed(1)}px)`;
    } else {
      label.style.transform = "translate(0px, 0px)";
    }
  });
};

// hovering lifts a bar or pulls a slice out of the pie, like in the library
const morphHover = (id, name, on) => {
  const el = morphItems[id]?.get(name);
  const p = morphLayout[id]?.get(name);
  if (!el || !p) {
    return;
  }
  if (!on) {
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.style.zIndex = "";
    return;
  }
  el.style.zIndex = "5";
  if (seriesView[id] === "pie") {
    const { dx, dy } = pieCenterOffset(p, MORPH.pieHoverOffset);
    el.style.transform = `translate(${p.x + dx}px, ${p.y + dy}px)`;
  } else {
    const scale = 1.1;
    el.style.transform = `translate(${p.x}px, ${
      p.y - (p.h * (scale - 1)) / 2
    }px) scale(${scale})`;
  }
};

// the boxes are built once per data set, then only their style changes, so
// switching bars <-> pie morphs the same boxes instead of redrawing them
const buildMorphPanel = (series, items) => {
  const stage = document.getElementById(`morph-${series.id}`);
  if (!stage) {
    return;
  }
  stage.replaceChildren();
  stage.classList.add("no-transition");
  const map = new Map();
  items.forEach((item) => {
    const el = document.createElement("div");
    el.className = "morph-item";
    el.style.backgroundColor = item.color;
    el.style.color = textOn(item.color);
    el.dataset.value = item.value;
    el.dataset.tipName = item.name;
    el.dataset.tipValue = fNum(item.value);
    el.dataset.tipLabel = series.unit;
    el.dataset.tipShare = `${(
      (item.value / (items.reduce((t, i) => t + i.value, 0) || 1)) *
      100
    ).toFixed(1)}%`;
    const label = document.createElement("div");
    label.className = "morph-label";
    const name = document.createElement("span");
    name.className = "morph-name";
    name.textContent = item.name;
    const value = document.createElement("span");
    value.className = "morph-value";
    value.textContent = fNum(item.value);
    label.append(name, value);
    el.append(label);
    el.addEventListener("mouseenter", () =>
      morphHover(series.id, item.name, true),
    );
    el.addEventListener("mouseleave", () =>
      morphHover(series.id, item.name, false),
    );
    stage.append(el);
    map.set(item.name, el);
  });
  morphItems[series.id] = map;
  applyMorphLayout(series.id);
  // let the first layout land before transitions are allowed
  requestAnimationFrame(() =>
    requestAnimationFrame(() => stage.classList.remove("no-transition")),
  );
};

// the stage is sized in pixels, so the layout is redone when it changes
window.addEventListener("resize", () =>
  SERIES.forEach((series) => applyMorphLayout(series.id)),
);

const seriesTableHTML = (items, label) => `<table class="data-table">
  <thead><tr><th>Package</th><th>${label}</th></tr></thead>
  <tbody>
    ${items
      .map(
        (i) =>
          `<tr><td>${escapeHtml(i.name)}</td><td>${fNum(i.value)}</td></tr>`,
      )
      .join("")}
  </tbody>
</table>`;

// the packages keep the same color in the three panels
const packageColors = (rows) => {
  const colors = new Map();
  rows.forEach((p, i) => colors.set(p.name, PIE_COLORS[i % PIE_COLORS.length]));
  return colors;
};

const seriesItems = (series, rows, colors) =>
  rows
    .map((p) => ({
      name: p.name,
      value: p[series.field] || 0,
      color: colors.get(p.name),
      unit: series.unit,
    }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value);

const seriesPanelHTML = (series, rows, colors) => {
  const items = seriesItems(series, rows, colors);
  const view = seriesView[series.id];
  const content = !items.length
    ? `<p class="chart-note">No ${series.unit} yet.</p>`
    : view === "table"
      ? seriesTableHTML(items, series.label)
      : `<div class="morph" id="morph-${series.id}"></div>`;
  return `<div class="chart-block series-panel">
    <div class="chart-head">
      <h2>${series.label}</h2>
      ${seriesToggleHTML(series.id)}
    </div>
    ${content}
  </div>`;
};

const packagesLegendHTML = (items) =>
  `<div class="pie-legend">${items
    .map(
      (i) =>
        `<span class="pie-key"><span class="swatch" style="background-color:${
          i.color
        }"></span>${escapeHtml(i.name)}</span>`,
    )
    .join("")}</div>`;

// gainers and losers, drawn on both sides of a zero line
const trendChart = (rows) => {
  const rowH = 32;
  const w = 900;
  const left = 230;
  const right = 90;
  const h = rows.length * rowH + 10;
  const zero = left + (w - left - right) / 2;
  const maxBar = (w - left - right) / 2 - 55; // room for the value at the end
  const max = Math.max(...rows.map((p) => Math.abs(p.trend)), 1);
  const bars = rows
    .map((p, i) => {
      const y = i * rowH + 5;
      const up = p.trend >= 0;
      const barW = (maxBar * Math.abs(p.trend)) / max;
      const x = up ? zero : zero - barW;
      const textX = up ? zero + barW + 10 : zero - barW - 10;
      return `<text class="bar-label" x="${left - 12}" y="${
        y + rowH / 2
      }" text-anchor="end" dominant-baseline="middle">${escapeHtml(
        p.name,
      )}</text>
      <rect class="bar ${up ? "up" : "down"}" x="${x.toFixed(
        1,
      )}" y="${y + 4}" width="${barW.toFixed(1)}" height="${
        rowH - 12
      }" rx="3"><title>${escapeHtml(p.name)}: ${up ? "up" : "down"} ${Math.abs(
        p.trend,
      )}% over the previous 30 days</title></rect>
      <text class="axis value" x="${textX.toFixed(1)}" y="${
        y + rowH / 2
      }" text-anchor="${
        up ? "start" : "end"
      }" dominant-baseline="middle">${up ? "▲" : "▼"} ${Math.abs(
        p.trend,
      )}%</text>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img"
    aria-label="Packages by download trend over the last 30 days">
    <line class="zero" x1="${zero}" y1="0" x2="${zero}" y2="${h}"></line>
    ${bars}
  </svg>`;
};

// points (days or months) covered by a duration, oldest first
const periodPoints = (dur) => {
  const byDay = !dur.months;
  const points = byDay
    ? dailyTotals(dur.days).map((d) => ({
        key: d.day,
        label: fDay(d.day),
        downloads: d.downloads,
      }))
    : monthlyTotals()
        .slice(-dur.months)
        .map((m) => ({
          key: m.month,
          // over a year the month alone is ambiguous, so the year is shown
          label: dur.months > 12 ? fMonthYear(m.month) : fMonth(m.month),
          downloads: m.downloads,
        }));
  return { byDay, points };
};

// total downloads across every package over a duration, shared by the
// header totals badge and the main downloads chart
const chartsPeriodTotal = (dur) => {
  const { points } = periodPoints(dur);
  return points.reduce((t, p) => t + p.downloads, 0);
};

// keeps the downloads figure in the header totals badge in sync with
// whichever duration is currently charted
const updateTotalsDownloads = (value) => {
  const el = document.getElementById("totals-downloads");
  if (!el) {
    return;
  }
  el.title = `downloads over the last ${duration.label}`;
  el.innerHTML = `${icoDownload} ${fNum(value)}`;
};

const renderCharts = () => {
  // nothing published under that name, or nothing downloaded yet
  if (!packages.length) {
    updateTotalsDownloads(0);
    chartsMessage(`No packages found on npm for "${escapeHtml(user)}".`);
    return;
  }
  // a week or a month is drawn day by day, longer periods month by month
  const { byDay, points } = periodPoints(duration);
  if (!points.length) {
    updateTotalsDownloads(0);
    chartsMessage(
      `No downloads reported yet for the ${totals.packages} package${
        totals.packages === 1 ? "" : "s"
      } of "${escapeHtml(user)}".`,
    );
    return;
  }
  const firstDay = byDay ? points[0].key : `${points[0].key}-01`;
  const periodTotal = points.reduce((t, p) => t + p.downloads, 0);
  updateTotalsDownloads(periodTotal);

  const withPeriod = packages.map((p) => ({
    ...p,
    period: downloadsSince(p, firstDay),
  }));

  // packages with a GitHub repository, most starred first
  const starred = withPeriod
    .filter((p) => p.stars)
    .sort((a, b) => b.stars - a.stars)
    .slice(0, topCount);

  // packages moving up or down, best and worst when there are too many
  const movers = packages
    .filter((p) => p.trend !== null && p.last30)
    .sort((a, b) => b.trend - a.trend);
  const halfCount = Math.floor(topCount / 2);
  const trends =
    movers.length > topCount
      ? movers.slice(0, halfCount).concat(movers.slice(-halfCount))
      : movers;

  document.getElementById("charts").innerHTML = `
    <div class="chart-block">
      <h2>${fNum(periodTotal)} downloads over the last
        ${durationPickerHTML()}</h2>
      <p class="chart-note">
        All ${totals.packages} packages together, ${
          byDay
            ? "day by day, up to yesterday"
            : "month by month. The last bar covers the current month only up to yesterday"
        }.
      </p>
      ${barsChart(
        points,
        !byDay,
        `Total npm downloads over the last ${duration.label}`,
      )}
    </div>
    ${
      starred.length
        ? `<p class="chart-note panels-note">
        Packages with a GitHub repository${
          starred.length === topCount ? `, top ${topCount} by stars` : ""
        }, with their downloads over the last ${duration.label}.
      </p>
      <div class="chart-row">
        ${SERIES.map((series) =>
          seriesPanelHTML(series, starred, packageColors(starred)),
        ).join("")}
      </div>
      ${packagesLegendHTML(
        starred.map((p) => ({
          name: p.name,
          color: packageColors(starred).get(p.name),
        })),
      )}`
        : ""
    }
    ${
      trends.length
        ? `<div class="chart-block">
      <h2>Trending up and down</h2>
      <p class="chart-note">
        Downloads of the last 30 days against the 30 days before${
          movers.length > topCount
            ? `, the ${halfCount} best and the ${halfCount} worst`
            : ""
        }.
      </p>
      ${trendChart(trends)}
    </div>`
        : ""
    }`;

  const colors = packageColors(starred);
  SERIES.forEach((series) => {
    if (seriesView[series.id] !== "table") {
      buildMorphPanel(series, seriesItems(series, starred, colors));
    }
  });
};

// a small tooltip following the pointer over the pie slices
const tooltipElem = () => {
  let tip = document.getElementById("chart-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "chart-tooltip";
    tip.className = "chart-tooltip";
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
};

const setupTooltip = () => {
  const charts = document.getElementById("charts");
  const tip = tooltipElem();
  const place = (event) => {
    const pad = 16;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + tip.offsetWidth > window.innerWidth - 8) {
      x = event.clientX - pad - tip.offsetWidth;
    }
    if (y + tip.offsetHeight > window.innerHeight - 8) {
      y = event.clientY - pad - tip.offsetHeight;
    }
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  charts.addEventListener("mouseover", (event) => {
    const slice = event.target.closest("[data-tip-name]");
    if (!slice) {
      return;
    }
    const name = document.createElement("b");
    name.textContent = slice.dataset.tipName;
    const detail = document.createElement("span");
    detail.textContent = `${slice.dataset.tipValue} ${slice.dataset.tipLabel} - ${slice.dataset.tipShare}`;
    tip.replaceChildren(name, detail);
    tip.hidden = false;
    place(event);
  });
  charts.addEventListener("mousemove", (event) => {
    if (!tip.hidden) {
      place(event);
    }
  });
  charts.addEventListener("mouseout", (event) => {
    if (event.target.closest("[data-tip-name]")) {
      tip.hidden = true;
    }
  });
};

const chartsTitleHTML = () => `<span id="title-main">
    ${userEditHTML()} ${sitePickerHTML()} ${fansLinkHTML()}
    <span class="totals">
      <span title="packages">${icoBox} ${totals.packages}</span>
      <span title="downloads over the last ${duration.label}" id="totals-downloads">${icoDownload} ${fNum(
        chartsPeriodTotal(duration),
      )}</span>
      ${totals.stars ? `<span title="stars on GitHub">${icoStar} ${totals.stars}</span>` : ""}
    </span>
  </span>
  ${headerLinksHTML("npm-charts")}`;

// a message in place of the charts: an API error, or no data to draw
const chartsMessage = (html) =>
  (document.getElementById("charts").innerHTML =
    `<div class="noresults">${html}</div>`);

// the username is edited in the title, like on the packages page
const changeUser = async (newUser) => {
  const trimmed = (newUser || "").trim();
  if (!trimmed || trimmed === user) {
    return;
  }
  const previousUser = user;
  const previousGhUser = ghUser;
  user = ghUser = trimmed;
  chartsMessage("Loading...");
  try {
    await loadData();
    updateBookmarkableUrl();
    setPageMetaTitle();
    document.getElementById("title").innerHTML = chartsTitleHTML();
    await loadDuration();
    renderCharts();
  } catch (e) {
    user = previousUser;
    ghUser = previousGhUser;
    document.getElementById("title").innerHTML = chartsTitleHTML();
    await loadData();
    renderCharts();
    chartsMessage(`Could not find npm user "${escapeHtml(trimmed)}".`);
  }
};

const setupChartPage = async () => {
  chartsPage = true;
  const userParam = new URLSearchParams(window.location.search).get("user");
  if (userParam) {
    user = ghUser = userParam.trim() || user;
  }
  try {
    await loadData();
  } catch (e) {
    document.getElementById("title").innerHTML = "npm";
    chartsMessage(`Could not reach the npm registry: ${escapeHtml(e.message)}`);
    return;
  }
  updateBookmarkableUrl();
  setPageMetaTitle();
  document.getElementById("title").innerHTML = chartsTitleHTML();
  await loadDuration();
  renderCharts();
  setupTooltip();
};
