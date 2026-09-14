/*
  Theme picker - the themes of OMG Themes (light, dark, evol-blue)
  https://evoluteur.github.io/omg-themes/
  (c) 2026 Olivier Giulieri
*/

const themes = ["light", "dark", "evol-blue"]; // order of the picker
const themeColors = {
  "evol-blue": "#0288d1",
  dark: "#1a212d",
  light: "#fdfdff",
};
const defaultTheme = "evol-blue";

const storedTheme = () => {
  try {
    return localStorage.getItem("omg-theme") || defaultTheme;
  } catch (e) {
    return defaultTheme;
  }
};

// pages that draw with a charting library redefine this to pick up the
// colors of the new theme (the plain SVG charts follow the CSS on their own)
const themeChanged = () => {
  if (typeof window.onThemeChanged === "function") {
    window.onThemeChanged();
  }
};

const setTheme = (id) => {
  if (!themes.includes(id)) {
    return;
  }
  const link = document.getElementById("omg-theme-css");
  if (link) {
    link.onload = themeChanged;
    link.setAttribute("href", `css/themes/${id}/${id}.css`);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", themeColors[id]);
  }
  try {
    localStorage.setItem("omg-theme", id);
  } catch (e) {
    // private browsing, the theme just does not stick
  }
  renderThemePicker(id);
};

const renderThemePicker = (id) => {
  const elem = document.getElementById("omg-theme-picker");
  if (elem) {
    elem.innerHTML = themes
      .map(
        (t) =>
          `<a class="${id === t ? "selected" : ""}" style="background-color:${
            themeColors[t]
          }" href="javascript:setTheme('${t}')" title="${t} theme" aria-label="${t} theme"></a>`,
      )
      .join("");
  }
};

// applied while the page is parsed, so there is no flash of the default theme
setTheme(storedTheme());
document.addEventListener("DOMContentLoaded", () =>
  renderThemePicker(storedTheme()),
);
