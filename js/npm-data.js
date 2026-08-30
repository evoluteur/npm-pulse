/*
  npm-pulse - shared data layer
  https://evoluteur.github.io/npm-pulse/
  (c) 2026 Olivier Giulieri
*/

// --- config options ---------------------------------------------------
const user = "evoluteur"; // npm maintainer whose packages are shown
const ghUser = "evoluteur"; // GitHub user (for stars and forks)
const cacheMinutes = 360; // npm recomputes its stats once a day, no need to refetch often
// ----------------------------------------------------------------------

const npmURL = "https://www.npmjs.com/package/";
const ghURL = `https://github.com/${ghUser}`;
const cacheKey = "npm-pulse-data";

let packages = []; // all packages, enriched with downloads and GitHub stats
let totals = {};

const periods = {
  last7: "last 7 days",
  last30: "last 30 days",
  last365: "last 12 months",
};

// --- formatting -------------------------------------------------------

const numFormat = new Intl.NumberFormat();
const fNum = (n) => numFormat.format(n || 0);

const fDate = (d) => (d ? new Date(d).toDateString().substring(4) : "");

const fMonth = (ym) => {
  const [y, m] = ym.split("-");
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short" });
};

const escapeHtml = (txt) =>
  String(txt)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// --- fetching ---------------------------------------------------------

const fetchJSON = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} on ${url}`);
  }
  return response.json();
};

// all packages published by the maintainer
const fetchPackages = async () => {
  const data = await fetchJSON(
    `https://registry.npmjs.org/-/v1/search?text=maintainer:${user}&size=250`
  );
  return (data.objects || []).map((o) => o.package);
};

// a year of daily downloads, in bulk (the API takes up to 128 packages per call)
const fetchDownloads = async (names) => {
  const chunks = [];
  for (let i = 0; i < names.length; i += 100) {
    chunks.push(names.slice(i, i + 100));
  }
  const answers = await Promise.all(
    chunks.map((chunk) =>
      fetchJSON(
        `https://api.npmjs.org/downloads/range/last-year/${chunk.join(",")}`
      ).catch(() => null)
    )
  );
  const all = {};
  answers.forEach((answer) => {
    if (!answer) return;
    // asking for a single package answers with one object rather than a map
    const map = answer.package ? { [answer.package]: answer } : answer;
    Object.keys(map).forEach((name) => {
      if (map[name]) {
        all[name] = map[name].downloads || [];
      }
    });
  });
  return all;
};

// stars and forks are a bonus: GitHub throttles anonymous calls at 60/hour
const fetchRepos = async () => {
  try {
    const list = await fetchJSON(
      `https://api.github.com/users/${ghUser}/repos?per_page=100`
    );
    const map = {};
    list.forEach((r) => {
      map[r.name.toLowerCase()] = {
        name: r.name,
        stars: r.stargazers_count,
        forks: r.forks_count,
        language: r.language,
        homepage: r.homepage,
      };
    });
    return map;
  } catch (e) {
    return {};
  }
};

// --- deriving ---------------------------------------------------------

// "git+https://github.com/evoluteur/healing-frequencies.git" -> "healing-frequencies"
const repoOf = (pkg) => {
  const url = (pkg.links || {}).repository;
  if (!url) return "";
  const match = url
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  return match ? match[2] : "";
};

const sumDays = (days, from, to) =>
  days.slice(from, to).reduce((total, d) => total + (d.downloads || 0), 0);

// 52 weekly buckets, oldest first, for the sparklines
const weeklyBuckets = (days) => {
  const weeks = [];
  const year = days.slice(-364);
  for (let i = 0; i < year.length; i += 7) {
    weeks.push(sumDays(year, i, i + 7));
  }
  return weeks;
};

const build = (pkgs, downloads, repos) => {
  packages = pkgs.map((pkg) => {
    const days = downloads[pkg.name] || [];
    const repoName = repoOf(pkg);
    const repo = repos[repoName.toLowerCase()];
    const last30 = sumDays(days, -30);
    const previous30 = sumDays(days, -60, -30);
    return {
      name: pkg.name,
      version: pkg.version || "",
      description: pkg.description || "",
      date: pkg.date,
      repo: repoName,
      homepage: (pkg.links || {}).homepage || (repo && repo.homepage) || "",
      language: repo ? repo.language : "",
      stars: repo ? repo.stars : 0,
      forks: repo ? repo.forks : 0,
      days,
      weeks: weeklyBuckets(days),
      last7: sumDays(days, -7),
      last30,
      last365: sumDays(days, -365),
      // growth of the last 30 days over the 30 days before them
      trend: previous30
        ? Math.round(((last30 - previous30) / previous30) * 100)
        : null,
    };
  });
  const add = (field) => packages.reduce((t, p) => t + p[field], 0);
  totals = {
    packages: packages.length,
    last7: add("last7"),
    last30: add("last30"),
    last365: add("last365"),
    stars: add("stars"),
    forks: add("forks"),
  };
  return packages;
};

// total downloads per month, across all packages, oldest first
const monthlyTotals = () => {
  const months = {};
  packages.forEach((p) =>
    p.days.forEach((d) => {
      const month = d.day.substring(0, 7);
      months[month] = (months[month] || 0) + (d.downloads || 0);
    })
  );
  const keys = Object.keys(months).sort();
  // the first month is only partially covered by a "last-year" range
  keys.shift();
  return keys.map((month) => ({ month, downloads: months[month] }));
};

// --- caching ----------------------------------------------------------

const readCache = () => {
  try {
    const cache = JSON.parse(localStorage.getItem(cacheKey));
    if (!cache || cache.user !== user) return null;
    if (Date.now() - cache.time > cacheMinutes * 60000) return null;
    return cache.data;
  } catch (e) {
    return null;
  }
};

const writeCache = (data) => {
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ user, time: Date.now(), data }));
  } catch (e) {
    // a year of daily downloads can outgrow the quota, the page works without the cache
  }
};

const clearCache = () => {
  try {
    localStorage.removeItem(cacheKey);
  } catch (e) {}
  location.reload();
};

// --- entry point ------------------------------------------------------

const loadData = async () => {
  const cached = readCache();
  if (cached) {
    build(cached.pkgs, cached.downloads, cached.repos);
    return { cached: true, time: cached.time };
  }
  const pkgs = await fetchPackages();
  const names = pkgs.map((p) => p.name);
  const [downloads, repos] = await Promise.all([
    fetchDownloads(names),
    fetchRepos(),
  ]);
  build(pkgs, downloads, repos);
  writeCache({ pkgs, downloads, repos, time: Date.now() });
  return { cached: false, time: Date.now() };
};

// --- icons ------------------------------------------------------------

const icoStar = `<span class="crud-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12,15.39L8.24,17.66L9.23,13.38L5.91,10.5L10.29,10.13L12,6.09L13.71,10.13L18.09,10.5L14.77,13.38L15.76,17.66M22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.45,13.97L5.82,21L12,17.27L18.18,21L16.54,13.97L22,9.24Z"></path></svg></span>`;

const icoDownload = `<span class="crud-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"></path></svg></span>`;

const icoBox = `<span class="crud-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12,2L2,7V17L12,22L22,17V7L12,2M12,4.2L19.2,7.8L12,11.4L4.8,7.8L12,4.2M4,9.4L11,12.9V19.6L4,16.1V9.4M13,19.6V12.9L20,9.4V16.1L13,19.6Z"></path></svg></span>`;

const icoChart = `<span class="crud-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22,21H2V3H4V19H6V10H10V19H12V6H16V19H18V14H22V21Z"></path></svg></span>`;
