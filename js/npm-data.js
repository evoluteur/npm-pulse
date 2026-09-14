/*
  npm-pulse - shared data layer
  https://evoluteur.github.io/npm-pulse/
  (c) 2026 Olivier Giulieri
*/

// --- config options ---------------------------------------------------
const DEFAULT_USER = "evoluteur"; // npm maintainer whose packages are shown
let user = DEFAULT_USER;
let ghUser = DEFAULT_USER; // GitHub user (for stars and forks), edited together with user
const cacheMinutes = 360; // npm recomputes its stats once a day, no need to refetch often
// ----------------------------------------------------------------------

const npmURL = "https://www.npmjs.com/package/";
const ghURL = `https://github.com/${ghUser}`;
const cacheKey = "npm-pulse-data";

let packages = []; // all packages, enriched with downloads and GitHub stats
let totals = {};

// the periods offered by every time period dropdown of npm-pulse.
// days is how far back a total goes, months how the charts bucket it.
const durations = [
  { id: "7d", label: "week", days: 7 },
  { id: "30d", label: "month", days: 30 },
  { id: "3m", label: "3 months", days: 91, months: 3 },
  { id: "6m", label: "6 months", days: 182, months: 6 },
  { id: "12m", label: "12 months", days: 365, months: 12 },
  { id: "5y", label: "5 years", days: 1825, months: 60, years: 5 },
];

const durationById = (id, fallback) =>
  durations.find((d) => d.id === id) ||
  durations.find((d) => d.id === fallback);

const storedDuration = (key, fallback) => {
  let id;
  try {
    id = localStorage.getItem(key);
  } catch (e) {
    id = null;
  }
  return durationById(id, fallback);
};

const storeDuration = (key, duration) => {
  try {
    localStorage.setItem(key, duration.id);
  } catch (e) {
    // private browsing, the choice just does not stick
  }
};

// downloads of one package over the picked period
const periodDownloads = (pkg, dur) => sumDays(pkg.days, -dur.days);

const durationOptionsHTML = (current) =>
  durations
    .map(
      (d) =>
        `<option value="${d.id}"${
          d.id === current.id ? " selected" : ""
        }>${d.label}</option>`,
    )
    .join("");

// --- formatting -------------------------------------------------------

const numFormat = new Intl.NumberFormat();
const fNum = (n) => numFormat.format(n || 0);

const fDate = (d) => (d ? new Date(d).toDateString().substring(4) : "");

// "2026-09-07" -> "Sep 7"
const fDay = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
  });
};

const fMonth = (ym) => {
  const [y, m] = ym.split("-");
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short" });
};

// "2024-01" -> "Jan 24", for periods spanning more than a year
const fMonthYear = (ym) => {
  const [y, m] = ym.split("-");
  return new Date(y, m - 1, 1).toLocaleString(undefined, {
    month: "short",
    year: "2-digit",
  });
};

const escapeHtml = (txt) =>
  String(txt)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// GitHub's own language colors, same list as github-projects-cards
const LANGUAGE_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  HTML: "#e34c26",
  CSS: "#563d7c",
  SCSS: "#c6538c",
  Python: "#3572A5",
  Java: "#b07219",
  "C#": "#178600",
  "C++": "#f34b7d",
  C: "#555555",
  Go: "#00ADD8",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Shell: "#89e051",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Rust: "#dea584",
  Dart: "#00B4AB",
  Vue: "#41b883",
  "Visual Basic .NET": "#945db7",
};

const langColor = (lang) => LANGUAGE_COLORS[lang] || "#ededed";

const langHTML = (lang) =>
  lang
    ? `<span class="lang"><span class="lang-dot" style="background-color:${langColor(
        lang,
      )}"></span>${escapeHtml(lang)}</span>`
    : "";

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
    `https://registry.npmjs.org/-/v1/search?text=maintainer:${user}&size=250`,
  );
  return (data.objects || []).map((o) => o.package);
};

// daily downloads, in bulk (the API takes up to 128 packages and 365 days
// per call); range is "last-year" or "YYYY-MM-DD:YYYY-MM-DD"
const fetchDownloads = async (names, range = "last-year") => {
  const chunks = [];
  for (let i = 0; i < names.length; i += 100) {
    chunks.push(names.slice(i, i + 100));
  }
  const answers = await Promise.all(
    chunks.map((chunk) =>
      fetchJSON(
        `https://api.npmjs.org/downloads/range/${range}/${chunk.join(",")}`,
      ).catch(() => null),
    ),
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
      `https://api.github.com/users/${ghUser}/repos?per_page=100`,
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

// --- older history, fetched only when the charts ask for it -----------

// years of daily downloads currently in memory (npm-pulse starts with one)
let historyYears = 1;

const dayString = (date) => date.toISOString().substring(0, 10);

// npm answers at most 365 days per bulk call, so older years are fetched
// one year at a time and prepended to the daily downloads of each package
const loadHistory = async (years) => {
  if (years <= historyYears || !packages.length) {
    return;
  }
  const names = packages.map((p) => p.name);
  const older = {};
  for (let y = historyYears; y < years; y++) {
    const to = new Date();
    to.setDate(to.getDate() - 1 - y * 365);
    const from = new Date(to);
    from.setDate(from.getDate() - 364);
    const part = await fetchDownloads(
      names,
      `${dayString(from)}:${dayString(to)}`,
    );
    names.forEach((name) => {
      older[name] = (part[name] || []).concat(older[name] || []);
    });
  }
  packages.forEach((p) => {
    p.days = (older[p.name] || []).concat(p.days);
  });
  historyYears = years;
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
// downloads per day, across every package, for the last `count` days
const dailyTotals = (count) => {
  const days = {};
  packages.forEach((p) =>
    p.days.slice(-count).forEach((d) => {
      days[d.day] = (days[d.day] || 0) + (d.downloads || 0);
    }),
  );
  return Object.keys(days)
    .sort()
    .slice(-count)
    .map((day) => ({ day, downloads: days[day] }));
};

const monthlyTotals = () => {
  const months = {};
  packages.forEach((p) =>
    p.days.forEach((d) => {
      const month = d.day.substring(0, 7);
      months[month] = (months[month] || 0) + (d.downloads || 0);
    }),
  );
  const keys = Object.keys(months).sort();
  // the first month is only partially covered by a "last-year" range
  keys.shift();
  return keys.map((month) => ({ month, downloads: months[month] }));
};

// --- page helpers shared by the packages page and the charts page ------

const focusUserInput = () => {
  const input = document.getElementById("userInput");
  input.focus();
  input.select();
};

// the username, editable in place with a pencil, on every page
const userEditHTML = () => `<span class="user-edit">
    <input
      type="text"
      id="userInput"
      class="user-input"
      value="${escapeHtml(user)}"
      size="${Math.max(user.length, 4)}"
      onchange="changeUser(this.value)"
      aria-label="npm username"
    />
    <button
      type="button"
      class="edit-icon"
      onclick="focusUserInput()"
      aria-label="Edit npm username"
    >${icoPencil}</button>
  </span>`;

const setPageMetaTitle = () => {
  document.title = chartsPage
    ? `npm Pulse Charts for ${user}`
    : `npm Pulse for ${user}`;
};

const updateBookmarkableUrl = () => {
  const url = new URL(window.location);
  url.searchParams.set("user", user);
  history.replaceState(null, "", url);
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
    localStorage.setItem(
      cacheKey,
      JSON.stringify({ user, time: Date.now(), data }),
    );
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
  historyYears = 1; // the older years are not cached, they are fetched again
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

// header icons: GitHub's own mark, the rest from Material Design Icons.
// Same markup in npm-pulse and github-projects-cards so both sites match.
const icoGitHub = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="24" width="24" aria-hidden="true"><path d="M12,2A10,10 0 0,0 2,12C2,16.42 4.87,20.17 8.84,21.5C9.34,21.58 9.5,21.27 9.5,21C9.5,20.77 9.5,20.14 9.5,19.31C6.73,19.91 6.14,17.97 6.14,17.97C5.68,16.81 5.03,16.5 5.03,16.5C4.12,15.88 5.1,15.9 5.1,15.9C6.1,15.97 6.63,16.93 6.63,16.93C7.5,18.45 8.97,18 9.54,17.76C9.63,17.11 9.89,16.67 10.17,16.42C7.95,16.17 5.62,15.31 5.62,11.5C5.62,10.39 6,9.5 6.65,8.79C6.55,8.54 6.2,7.5 6.75,6.15C6.75,6.15 7.59,5.88 9.5,7.17C10.29,6.95 11.15,6.84 12,6.84C12.85,6.84 13.71,6.95 14.5,7.17C16.41,5.88 17.25,6.15 17.25,6.15C17.8,7.5 17.45,8.54 17.35,8.79C18,9.5 18.38,10.39 18.38,11.5C18.38,15.32 16.04,16.16 13.81,16.41C14.17,16.72 14.5,17.33 14.5,18.26C14.5,19.6 14.5,20.68 14.5,21C14.5,21.27 14.66,21.59 15.17,21.5C19.14,20.16 22,16.42 22,12A10,10 0 0,0 12,2Z" /></svg>`;

const icoChart = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="24" width="24" aria-hidden="true"><path d="M22,21H2V3H4V19H6V10H10V19H12V6H16V19H18V14H22V21Z" /></svg>`;

const icoCards = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="24" width="24" aria-hidden="true"><path d="M3,11H11V3H3M3,21H11V13H3M13,21H21V13H13M13,3V11H21V3" /></svg>`;

const icoMTF = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="24" width="24" aria-hidden="true"><path d="M7.2,11.2C8.97,11.2 10.4,12.63 10.4,14.4C10.4,16.17 8.97,17.6 7.2,17.6C5.43,17.6 4,16.17 4,14.4C4,12.63 5.43,11.2 7.2,11.2M14.8,16A2,2 0 0,1 16.8,18A2,2 0 0,1 14.8,20A2,2 0 0,1 12.8,18A2,2 0 0,1 14.8,16M15.2,4A4.8,4.8 0 0,1 20,8.8C20,11.45 17.85,13.6 15.2,13.6A4.8,4.8 0 0,1 10.4,8.8C10.4,6.15 12.55,4 15.2,4Z" /></svg>`;

const gpcSiteURL = "https://evoluteur.github.io/github-projects-cards/";
const pulseSiteURL = "https://evoluteur.github.io/npm-pulse/";
const fansSiteURL = "https://evoluteur.github.io/meet-the-fans";

// the same five links at the right of the page title on every page,
// the icon of the current page shown dimmed instead of linked.
// current is one of: gh-cards, gh-charts, npm, npm-charts, fans
// the charts pages set this, so the picker lands on the charts of the other site
let chartsPage = false;

// the same user seen on GitHub (GitHub-Projects-Cards) or on npm
const goToSite = (id) => {
  const gh = encodeURIComponent(ghUser);
  if (id === "github") {
    window.location.href = chartsPage
      ? `${gpcSiteURL}dashboard.html?user=${gh}`
      : `${gpcSiteURL}?user=${gh}`;
  }
};

const sitePickerHTML = () => `<select
    class="site-picker"
    onchange="goToSite(this.value)"
    aria-label="Show this user on another site"
    title="Show this user on another site"
  >
    <option value="github">GitHub</option>
    <option value="npm" selected>npm</option>
  </select>`;

// Meet-the-Fans sits next to the site picker, not with the page icons
const fansLinkHTML = () =>
  `<a class="icon-link fans-link" href="${fansSiteURL}?user=${encodeURIComponent(
    ghUser,
  )}" target="_blank" title="Meet the Fans" aria-label="Meet the Fans">${icoMTF}</a>`;

const headerLinkHTML = (link, current) =>
  link.id === current
    ? `<span class="icon-link current" title="${link.title}" aria-label="${link.title}">${link.icon}</span>`
    : `<a class="icon-link" href="${link.href}"${
        link.external ? ' target="_blank"' : ""
      } title="${link.title}" aria-label="${link.title}">${link.icon}</a>`;

const headerLinksHTML = (current) => {
  const links = headerLinks();
  return `<span class="header-links">${links
    .map((l) => headerLinkHTML(l, current))
    .join("")}</span>`;
};

const headerLinks = () => {
  const u = encodeURIComponent(user);
  return [
    {
      id: "npm",
      icon: icoCards,
      title: "npm packages",
      href: `index.html?user=${u}`,
    },
    {
      id: "npm-charts",
      icon: icoChart,
      title: "npm charts",
      href: `dashboard.html?user=${u}`,
    },
  ];
};

const icoPencil = `<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758ZM12.5 2.487a.25.25 0 0 0-.354 0L11.263 3.36l1.377 1.378.873-.873a.25.25 0 0 0 0-.354Zm-1.586 2.79L9.537 3.9l-6.19 6.19-.929 3.25 3.25-.929Z"></path></svg>`;
