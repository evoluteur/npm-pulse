/*
  npm-pulse - package cards
  https://evoluteur.github.io/npm-pulse/
  (c) 2026 Olivier Giulieri
*/

let selection = [];
let period = localStorage.getItem("npm-pulse-period") || "last30";
let sortField = localStorage.getItem("npm-pulse-sort") || "downloads";
let searchString = "";

// --- sparkline --------------------------------------------------------

// 52 weeks of downloads drawn as an area and a line, no library, no axis
const sparkHTML = (pkg) => {
  const weeks = pkg.weeks;
  if (weeks.length < 2 || !pkg.last365) {
    return `<div class="spark-empty">no downloads reported yet</div>`;
  }
  const w = 300;
  const h = 46;
  const max = Math.max(...weeks, 1);
  const points = weeks.map((v, i) => {
    const x = (i / (weeks.length - 1)) * w;
    const y = h - 3 - (v / max) * (h - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const peak = weeks.indexOf(max);
  const peakX = ((peak / (weeks.length - 1)) * w).toFixed(1);
  const peakY = (h - 3 - (h - 8)).toFixed(1);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"
    role="img" aria-label="Weekly downloads over the last 12 months, peak of ${fNum(
      max
    )}">
    <polygon points="0,${h} ${points.join(" ")} ${w},${h}"></polygon>
    <polyline points="${points.join(" ")}"></polyline>
    <circle cx="${peakX}" cy="${peakY}" r="2.5"></circle>
  </svg>`;
};

// --- cards ------------------------------------------------------------

const trendHTML = (pkg) => {
  if (pkg.trend === null || !pkg.last30) return "";
  const up = pkg.trend >= 0;
  return `<span class="trend ${up ? "up" : "down"}" title="${
    up ? "up" : "down"
  } ${Math.abs(pkg.trend)}% over the previous 30 days">${up ? "▲" : "▼"} ${Math.abs(
    pkg.trend
  )}%</span>`;
};

const linksHTML = (pkg) => {
  const n = pkg.name;
  const links = [`<a href="${npmURL}${n}" target="npm-${n}">npm</a>`];
  if (pkg.repo) {
    links.push(`<a href="${ghURL}/${pkg.repo}" target="code-${n}">Code</a>`);
  }
  if (pkg.homepage) {
    links.push(`<a href="${pkg.homepage}" target="demo-${n}">Demo</a>`);
  }
  links.push(
    `<a href="https://npm-stat.com/charts.html?package=${n}" target="stat-${n}">Charts</a>`
  );
  const lang = pkg.language
    ? `<span class="lang">${escapeHtml(pkg.language)}</span>`
    : "";
  return lang + links.join(" - ");
};

const statsHTML = (pkg) => {
  const bits = [];
  if (pkg.stars) {
    bits.push(
      `<a href="${ghURL}/${pkg.repo}/stargazers" target="stars-${pkg.name}" aria-label="stars">${icoStar} ${pkg.stars}</a>`
    );
  }
  return bits.join(" ");
};

const cardHTML = (pkg) => `<div class="project-card">
  <div>
    <h2 class="pcard-title">
      <span><a href="${npmURL}${pkg.name}" target="npm-${pkg.name}">${escapeHtml(
  pkg.name
)}</a></span>
      <span class="dls" title="downloads ${periods[period]}">${icoDownload} ${fNum(
  pkg[period]
)}</span>
    </h2>
    ${sparkHTML(pkg)}
    <div class="desc">${escapeHtml(pkg.description || pkg.name)}</div>
    <div class="p-links">${linksHTML(pkg)}</div>
  </div>
  <div class="pcard-foot">
    <span>v${escapeHtml(pkg.version)} - ${fDate(pkg.date)}</span>
    <span class="stats">${trendHTML(pkg)} ${statsHTML(pkg)}</span>
  </div>
</div>`;

// --- filtering and sorting --------------------------------------------

const applySort = () => {
  const field = sortField === "downloads" ? period : sortField;
  const alpha = field === "name";
  const way = alpha ? 1 : -1;
  selection.sort((a, b) => {
    const av = a[field] === null ? -Infinity : a[field];
    const bv = b[field] === null ? -Infinity : b[field];
    if (av === bv) return a.name > b.name ? 1 : -1;
    return way * (av > bv ? 1 : -1);
  });
};

const applyFilter = () => {
  const s = searchString.toLowerCase();
  selection = s
    ? packages.filter(
        (p) =>
          p.name.toLowerCase().includes(s) ||
          p.description.toLowerCase().includes(s)
      )
    : packages.slice();
};

const refresh = () => {
  applyFilter();
  applySort();
  const html = selection.map(cardHTML).join("");
  document.getElementById("packages").innerHTML =
    html ||
    `<div class="noresults">No results. The search criteria is too restrictive.</div>`;
  const shown = selection.length;
  const downloads = selection.reduce((t, p) => t + p[period], 0);
  document.getElementById("summary").innerHTML = `${shown} package${
    shown === 1 ? "" : "s"
  } - ${fNum(downloads)} downloads ${periods[period]}`;
};

const filter = (value) => {
  searchString = value;
  refresh();
};

const sort = (value) => {
  sortField = value;
  localStorage.setItem("npm-pulse-sort", value);
  refresh();
};

const setPeriod = (value) => {
  period = value;
  localStorage.setItem("npm-pulse-period", value);
  refresh();
};

// --- page -------------------------------------------------------------

const titleHTML = () => `<a href="https://www.npmjs.com/~${user}" target="npm-user">${escapeHtml(
  user
)}</a> on npm
  <span class="totals">
    <span title="packages">${icoBox} ${totals.packages}</span>
    <span title="downloads in the last 12 months">${icoDownload} ${fNum(
  totals.last365
)}</span>
    ${totals.stars ? `<span title="stars on GitHub">${icoStar} ${totals.stars}</span>` : ""}
  </span>`;

const setupPulsePage = async () => {
  document.getElementById("sortPicker").value = sortField;
  document.getElementById("periodPicker").value = period;
  try {
    await loadData();
  } catch (e) {
    document.getElementById("title").innerHTML = "npm";
    document.getElementById(
      "packages"
    ).innerHTML = `<div class="noresults">Could not reach the npm registry: ${escapeHtml(
      e.message
    )}</div>`;
    return;
  }
  document.getElementById("title").innerHTML = titleHTML();
  refresh();
};
