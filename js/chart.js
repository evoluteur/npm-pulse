/*
  npm-pulse - charts
  https://evoluteur.github.io/npm-pulse/
  (c) 2026 Olivier Giulieri
*/

const topCount = 12; // number of packages in the ranking

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

// downloads per month, across every package
const monthsChart = (months) => {
  const w = 900;
  const h = 340;
  const left = 90;
  const right = 20;
  const top = 20;
  const bottom = 50;
  const max = niceMax(Math.max(...months.map((m) => m.downloads), 1));
  const iw = w - left - right;
  const step = iw / months.length;
  const barW = Math.min(step * 0.62, 60);
  const bars = months
    .map((m, i) => {
      const height = ((h - top - bottom) * m.downloads) / max;
      const x = left + i * step + (step - barW) / 2;
      const y = h - bottom - height;
      const partial = i === months.length - 1;
      return `<rect class="bar${partial ? " partial" : ""}" x="${x.toFixed(
        1
      )}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(
        1
      )}"><title>${m.month}: ${fNum(m.downloads)} downloads${
        partial ? " so far" : ""
      }</title></rect>
      <text class="axis" x="${(x + barW / 2).toFixed(1)}" y="${
        h - bottom + 20
      }" text-anchor="middle">${fMonth(m.month)}</text>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img"
    aria-label="Total npm downloads per month over the last year">
    ${gridHTML(max, left, w - right, top, h - bottom, 4)}
    ${bars}
  </svg>`;
};

// the most downloaded packages of the last 12 months
const topChart = (top) => {
  const rowH = 32;
  const w = 900;
  const left = 230;
  const right = 90;
  const h = top.length * rowH + 10;
  const max = Math.max(...top.map((p) => p.last365), 1);
  const iw = w - left - right;
  const rows = top
    .map((p, i) => {
      const y = i * rowH + 5;
      const barW = (iw * p.last365) / max;
      return `<text class="bar-label" x="${left - 12}" y="${
        y + rowH / 2
      }" text-anchor="end" dominant-baseline="middle">${escapeHtml(
        p.name
      )}</text>
      <rect class="bar" x="${left}" y="${y + 4}" width="${barW.toFixed(
        1
      )}" height="${rowH - 12}" rx="3"><title>${escapeHtml(p.name)}: ${fNum(
        p.last365
      )} downloads</title></rect>
      <text class="axis value" x="${(left + barW + 10).toFixed(1)}" y="${
        y + rowH / 2
      }" dominant-baseline="middle">${fNum(p.last365)}</text>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img"
    aria-label="Most downloaded packages over the last 12 months">${rows}</svg>`;
};

const setupChartPage = async () => {
  try {
    await loadData();
  } catch (e) {
    document.getElementById("title").innerHTML = "npm";
    document.getElementById("charts").innerHTML =
      `<div class="noresults">Could not reach the npm registry: ${escapeHtml(
        e.message
      )}</div>`;
    return;
  }
  document.getElementById("title").innerHTML = `<a href="https://www.npmjs.com/~${user}"
    target="npm-user">${escapeHtml(user)}</a> downloads`;

  const months = monthlyTotals();
  const top = packages
    .slice()
    .sort((a, b) => b.last365 - a.last365)
    .slice(0, topCount)
    .filter((p) => p.last365);

  document.getElementById("charts").innerHTML = `
    <div class="chart-block">
      <h2>${fNum(totals.last365)} downloads over the last 12 months</h2>
      <p class="chart-note">
        All ${totals.packages} packages together, month by month. The last bar
        covers the current month only up to yesterday.
      </p>
      ${monthsChart(months)}
    </div>
    <div class="chart-block">
      <h2>Most downloaded packages</h2>
      <p class="chart-note">Downloads over the last 12 months.</p>
      ${topChart(top)}
    </div>`;
};
