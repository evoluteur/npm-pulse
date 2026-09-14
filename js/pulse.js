/*
  npm-pulse - package cards
  https://evoluteur.github.io/npm-pulse/
  (c) 2026 Olivier Giulieri
*/

let selection = [];
const periodKey = "npm-pulse-period";
let period = storedDuration(periodKey, "30d"); // period of the download counts
let sortField = localStorage.getItem("npm-pulse-sort") || "downloads";
let searchString = "";

// --- sparkline --------------------------------------------------------

// the picked period, split into a readable number of buckets: days for a week
// or a month, weeks up to a couple of years, months beyond that
const sparkBuckets = (pkg) => {
  const days = pkg.days.slice(-period.days);
  const size = period.days <= 60 ? 1 : period.days <= 730 ? 7 : 30;
  const buckets = [];
  for (let i = 0; i < days.length; i += size) {
    buckets.push(
      days.slice(i, i + size).reduce((t, d) => t + (d.downloads || 0), 0),
    );
  }
  return buckets;
};

// downloads of the picked period drawn as an area and a line, no library
const sparkHTML = (pkg) => {
  const buckets = sparkBuckets(pkg);
  if (buckets.length < 2 || !periodDownloads(pkg, period)) {
    return `<div class="spark-empty">no downloads reported yet</div>`;
  }
  const w = 300;
  const h = 46;
  const max = Math.max(...buckets, 1);
  const points = buckets.map((v, i) => {
    const x = (i / (buckets.length - 1)) * w;
    const y = h - 3 - (v / max) * (h - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const peak = buckets.indexOf(max);
  const peakX = ((peak / (buckets.length - 1)) * w).toFixed(1);
  const peakY = (h - 3 - (h - 8)).toFixed(1);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"
    role="img" aria-label="Downloads over the last ${
      period.label
    }, peak of ${fNum(max)}">
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
    pkg.trend,
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
    `<a href="https://npm-stat.com/charts.html?package=${n}" target="stat-${n}">Charts</a>`,
  );
  return langHTML(pkg.language) + links.join(" - ");
};

const statsHTML = (pkg) => {
  const bits = [];
  if (pkg.stars) {
    bits.push(
      `<a href="${ghURL}/${pkg.repo}/stargazers" target="stars-${pkg.name}" aria-label="stars">${icoStar} ${pkg.stars}</a>`,
    );
  }
  return bits.join(" ");
};

const cardHTML = (pkg) => `<div class="project-card">
  <div>
    <h2 class="pcard-title">
      <span><a href="${npmURL}${pkg.name}" target="npm-${pkg.name}">${escapeHtml(
        pkg.name,
      )}</a></span>
      <span class="dls" title="downloads over the last ${
        period.label
      }">${icoDownload} ${fNum(periodDownloads(pkg, period))}</span>
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

const sortValue = (pkg, field) =>
  field === "downloads" ? periodDownloads(pkg, period) : pkg[field];

const applySort = () => {
  const field = sortField;
  const alpha = field === "name";
  const way = alpha ? 1 : -1;
  selection.sort((a, b) => {
    const av = sortValue(a, field) === null ? -Infinity : sortValue(a, field);
    const bv = sortValue(b, field) === null ? -Infinity : sortValue(b, field);
    if (av === bv) return a.name > b.name ? 1 : -1;
    return way * (av > bv ? 1 : -1);
  });
};

const applyFilter = () => {
  const s = searchString.toLowerCase();
  selection = s
    ? packages.filter((p) => p.name.toLowerCase().includes(s))
    : packages.slice();
};

const refresh = () => {
  applyFilter();
  applySort();
  const html = selection.map(cardHTML).join("");
  document.getElementById("packages").innerHTML =
    html ||
    `<div class="noresults">No packages found on npm for "${escapeHtml(
      user,
    )}", or the search criteria is too restrictive.</div>`;
  const shown = selection.length;
  const downloads = selection.reduce(
    (t, p) => t + periodDownloads(p, period),
    0,
  );
  document.getElementById("summary").innerHTML = `${shown} package${
    shown === 1 ? "" : "s"
  } - ${fNum(downloads)} downloads over the last ${period.label}`;
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

const setPeriod = async (value) => {
  period = durationById(value, period.id);
  storeDuration(periodKey, period);
  // the longest period needs years of daily downloads fetched on demand
  if (period.years && period.years > historyYears) {
    document.getElementById("summary").textContent =
      "Loading the full history...";
    try {
      await loadHistory(period.years);
    } catch (e) {
      // the counts just stay on the year that is already loaded
    }
  }
  document.getElementById("title").innerHTML = titleHTML();
  refresh();
};

// --- page -------------------------------------------------------------

const changeUser = async (newUser) => {
  const trimmed = (newUser || "").trim();
  if (!trimmed || trimmed === user) {
    return;
  }
  const previousUser = user;
  const previousGhUser = ghUser;
  user = ghUser = trimmed;
  const summary = document.getElementById("summary");
  summary.textContent = "Loading...";
  try {
    await loadData();
    searchString = "";
    document.getElementById("filter").value = "";
    updateBookmarkableUrl();
    setPageMetaTitle();
  } catch (e) {
    user = previousUser;
    ghUser = previousGhUser;
    summary.textContent = `Could not find npm user "${trimmed}".`;
  }
  document.getElementById("title").innerHTML = titleHTML();
  refresh();
};

// downloads of every package over the picked period, shown next to the title
const periodTotal = () =>
  packages.reduce((total, p) => total + periodDownloads(p, period), 0);

const titleHTML = () => `<span id="title-main">
  ${userEditHTML()}
  ${sitePickerHTML()}
  ${fansLinkHTML()}
  <span class="totals">
    <span title="packages">${icoBox} ${totals.packages}</span>
    <span title="downloads over the last ${period.label}">${icoDownload} ${fNum(
      periodTotal(),
    )}</span>
    ${totals.stars ? `<span title="stars on GitHub">${icoStar} ${totals.stars}</span>` : ""}
  </span>
  </span>
  ${headerLinksHTML("npm")}`;

const setupPulsePage = async () => {
  const userParam = new URLSearchParams(window.location.search).get("user");
  if (userParam) {
    user = ghUser = userParam.trim() || user;
  }
  document.getElementById("sortPicker").value = sortField;
  document.getElementById("periodPicker").innerHTML =
    durationOptionsHTML(period);
  try {
    await loadData();
  } catch (e) {
    document.getElementById("summary").textContent =
      `Could not find npm user "${user}".`;
    user = ghUser = DEFAULT_USER;
    try {
      await loadData();
    } catch (e2) {
      document.getElementById("title").innerHTML = "npm";
      document.getElementById("packages").innerHTML =
        `<div class="noresults">Could not reach the npm registry: ${escapeHtml(
          e2.message,
        )}</div>`;
      return;
    }
  }
  updateBookmarkableUrl();
  setPageMetaTitle();
  document.getElementById("title").innerHTML = titleHTML();
  refresh();
};
