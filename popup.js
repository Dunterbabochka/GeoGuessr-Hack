/* global L */
const refreshBtn = document.getElementById("refresh");
const autoGuessBtn = document.getElementById("auto-guess-btn");
const gmapsLinkBtn = document.getElementById("gmaps-link");
const statusEl = document.getElementById("status");
const placeEl = document.getElementById("place");
const flagEl = document.getElementById("flag");
const coordsEl = document.getElementById("coords");
const guessesBadge = document.getElementById("guesses-badge");

// Settings panel
const settingsBtn = document.getElementById("settings-btn");
const panel = document.getElementById("panel");
const panelClose = document.getElementById("panel-close");

const map = L.map("map", {
  zoomControl: true,
  attributionControl: true,
  worldCopyJump: true,
  zoomSnap: 0.5,
}).setView([20, 0], 2);

const TILE_STYLES = {
  voyager: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    options: { maxZoom: 19, subdomains: "abcd", attribution: "© OSM © CARTO" },
    bg: "#e8eef5",
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    options: { maxZoom: 19, subdomains: "abcd", attribution: "© OSM © CARTO" },
    bg: "#0d0a24",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    options: { maxZoom: 19, attribution: "© Esri" },
    bg: "#0a0a0a",
  },
};

let currentTileLayer = null;
function setMapStyle(name) {
  const style = TILE_STYLES[name] || TILE_STYLES.voyager;
  if (currentTileLayer) map.removeLayer(currentTileLayer);
  currentTileLayer = L.tileLayer(style.url, style.options).addTo(map);
  const mapEl = document.getElementById("map");
  if (mapEl) mapEl.style.background = style.bg;
  document.querySelectorAll("#map-style-switcher button").forEach((b) => {
    b.classList.toggle("active", b.dataset.style === name);
  });
  try { chrome.storage.local.set({ mapStyle: name }); } catch (_) {}
}

chrome.storage.local.get(["mapStyle"], ({ mapStyle }) => {
  setMapStyle(mapStyle && TILE_STYLES[mapStyle] ? mapStyle : "voyager");
});

document.querySelectorAll("#map-style-switcher button[data-style]").forEach((btn) => {
  btn.addEventListener("click", () => setMapStyle(btn.dataset.style));
});

// Country borders overlay (Natural Earth admin-0 boundary lines - only borders, no labels)
let bordersLayer = null;
let bordersLoading = null;
function loadBordersLayer() {
  if (bordersLayer) return Promise.resolve(bordersLayer);
  if (bordersLoading) return bordersLoading;
  const url = chrome.runtime.getURL("vendor/borders/ne_110m_admin_0_boundary_lines_land.geojson");
  bordersLoading = fetch(url)
    .then((r) => r.json())
    .then((geo) => {
      // Two layers: dark halo + bright stroke = visible on light & dark maps
      const halo = L.geoJSON(geo, {
        style: { color: "#000", weight: 4, opacity: 0.55, lineCap: "round", lineJoin: "round", interactive: false },
      });
      const line = L.geoJSON(geo, {
        style: { color: "#ffd000", weight: 2, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false },
      });
      bordersLayer = L.layerGroup([halo, line]);
      return bordersLayer;
    })
    .catch((e) => { console.warn("borders load failed", e); bordersLoading = null; return null; });
  return bordersLoading;
}
function setBorders(on) {
  const btn = document.getElementById("borders-toggle");
  if (on) {
    loadBordersLayer().then((layer) => {
      if (!layer) return;
      layer.addTo(map);
      btn?.classList.add("active");
    });
  } else {
    if (bordersLayer && map.hasLayer(bordersLayer)) map.removeLayer(bordersLayer);
    btn?.classList.remove("active");
  }
  try { chrome.storage.local.set({ bordersOn: !!on }); } catch (_) {}
}
chrome.storage.local.get(["bordersOn"], ({ bordersOn }) => setBorders(!!bordersOn));
document.getElementById("borders-toggle")?.addEventListener("click", () => {
  const on = !(bordersLayer && map.hasLayer(bordersLayer));
  setBorders(on);
});

const pulseIcon = L.divIcon({
  className: "",
  html: '<div class="pulse-marker"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

let marker = null;
let last = null;

function setStatus(text) {
  if (!text) { statusEl.classList.remove("show"); return; }
  statusEl.textContent = text;
  statusEl.classList.add("show");
}

function setLoading(on) {
  refreshBtn.classList.toggle("loading", !!on);
  refreshBtn.querySelector(".label").textContent = on ? I18N.t("loading") : I18N.t("guess");
  refreshBtn.disabled = !!on;
}

function setFlag(cc) {
  if (!cc) { flagEl.classList.add("hidden"); return; }
  flagEl.src = `https://flagcdn.com/w40/${cc.toLowerCase()}.png`;
  flagEl.classList.remove("hidden");
}

function updateGuessesBadge() {
  guessesBadge.classList.add("unlimited");
  guessesBadge.innerHTML = "<b>local mode</b> - no login";
}

async function reverseGeocode(lat, lng) {
  try {
    const lang = (I18N.getLang && I18N.getLang()) || "en";
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=${lang}&zoom=14`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    const parts = [
      a.suburb || a.neighbourhood || a.hamlet,
      a.village || a.town || a.city,
      a.county,
      a.state || a.region,
      a.country,
    ].filter(Boolean);
    return {
      label: parts.length ? parts.join(", ") : data.display_name || null,
      cc: a.country_code || null,
    };
  } catch {
    return null;
  }
}

async function show(data) {
  if (!data || !Number.isFinite(data.lat) || !Number.isFinite(data.lng)) {
    placeEl.textContent = I18N.t("open_round");
    setFlag(null);
    coordsEl.textContent = "-";
    coordsEl.classList.add("empty");
    gmapsLinkBtn.disabled = true;
    if (autoGuessBtn) autoGuessBtn.disabled = true;
    return;
  }
  last = data;
  gmapsLinkBtn.disabled = false;
  if (autoGuessBtn) autoGuessBtn.disabled = false;

  const latlng = [data.lat, data.lng];
  if (marker) marker.setLatLng(latlng);
  else marker = L.marker(latlng, { icon: pulseIcon }).addTo(map);

  if (window.defaultZoom && window.defaultZoom > 0) {
    map.setView(latlng, window.defaultZoom, { animate: false });
  } else {
    map.panTo(latlng, { animate: false });
  }

  coordsEl.textContent = `${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}`;
  coordsEl.classList.remove("empty");

  placeEl.textContent = I18N.t("detecting");
  setFlag(null);

  const geo = await reverseGeocode(data.lat, data.lng);
  if (geo && geo.label) {
    placeEl.textContent = geo.label;
    setFlag(geo.cc);
  } else {
    placeEl.textContent = I18N.t("no_address");
  }
}

const IS_OBS = new URLSearchParams(location.search).get("obs") === "1";

async function getActiveTab() {
  if (IS_OBS) {
    const tabs = await chrome.tabs.query({ url: "*://*.geoguessr.com/*" });
    return tabs.find((t) => t.active) || tabs[0] || null;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tabId, msg);
  }
}

async function refresh() {
  setStatus("");

  setLoading(true);
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.url || !/geoguessr\.com/.test(tab.url)) {
      setStatus(I18N.t("open_geoguessr"));
      return;
    }
    const resp = await sendToTab(tab.id, { type: "FETCH_CURRENT_ROUND" });
    if (!resp || !resp.ok) {
      setStatus(resp?.error || I18N.t("coords_fail"));
      return;
    }
  } catch (e) {
    setStatus(I18N.t("error") + (e?.message || e));
  } finally {
    setLoading(false);
  }
}

function openGoogleMaps() {
  if (!last) return;
  chrome.tabs.create({
    url: `https://www.google.com/maps/search/?api=1&query=${last.lat},${last.lng}`,
  });
}

async function autoGuess() {
  if (!last) return;
  const tab = await getActiveTab();
  if (!tab) return;
  
  if (autoGuessBtn) {
    autoGuessBtn.disabled = true;
    const originalText = autoGuessBtn.querySelector(".label").textContent;
    autoGuessBtn.querySelector(".label").textContent = "Wait...";
    setTimeout(() => {
      autoGuessBtn.disabled = false;
      autoGuessBtn.querySelector(".label").textContent = originalText;
    }, 1500);
  }

  let finalLat = last.lat;
  let finalLng = last.lng;

  if (autoGuessAccuracy > 0) {
    // Random distance from 0 to max configured (in km)
    // To make it noticeably off, we can do between half and max, or just 0 to max.
    // The user asked for "like 100-300km if slider is 300", so let's use:
    const dist = (0.3 + 0.7 * Math.random()) * autoGuessAccuracy; 
    const angle = Math.random() * 2 * Math.PI;
    
    // 1 deg latitude ~= 111.32 km
    const deltaLat = (dist * Math.cos(angle)) / 111.32;
    // 1 deg longitude ~= 111.32 km * cos(lat)
    const deltaLng = (dist * Math.sin(angle)) / (111.32 * Math.cos(last.lat * Math.PI / 180));
    
    finalLat += deltaLat;
    finalLng += deltaLng;
    
    // Clamp coordinates
    finalLat = Math.max(-90, Math.min(90, finalLat));
    finalLng = ((finalLng + 180) % 360 + 360) % 360 - 180;
  }

  const resp = await sendToTab(tab.id, { type: "AUTO_GUESS", lat: finalLat, lng: finalLng, autoSubmit: autoSubmitGuess });
  if (!resp) {
    setStatus("Обновите страницу игры (F5)!");
  } else if (!resp.ok) {
    setStatus(resp.error || "Ошибка Auto-Guess");
  } else {
    setStatus(""); // Clear status on success
  }
}

// ---------- Settings panel ----------
async function renderPanel() {
  const automationEl = document.getElementById("section-automation");
  const streamingEl = document.getElementById("section-streaming");
  if (automationEl) automationEl.style.display = "block";
  if (streamingEl) streamingEl.style.display = "block";
}

function openPanel() {
  renderPanel();
  panel.classList.add("show");
}

function closePanel() {
  panel.classList.remove("show");
}

settingsBtn.addEventListener("click", openPanel);
panelClose.addEventListener("click", closePanel);

refreshBtn.addEventListener("click", refresh);
if (autoGuessBtn) autoGuessBtn.addEventListener("click", autoGuess);
gmapsLinkBtn.addEventListener("click", openGoogleMaps);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lastCoords) show(changes.lastCoords.newValue);
});

chrome.storage.local.get(["lastCoords"], ({ lastCoords }) => show(lastCoords));
updateGuessesBadge();
setTimeout(() => map.invalidateSize(), 120);

// ---------- OBS MODE ----------
const obsBtn = document.getElementById("obs-mode-btn");
if (obsBtn) {
  obsBtn.addEventListener("click", async () => {
    const url = chrome.runtime.getURL("popup.html?obs=1");
    await chrome.windows.create({
      url,
      type: "popup",
      width: 460,
      height: 760,
      focused: true,
    });
    closePanel();
  });
}

if (IS_OBS) {
  document.title = "GeoHack - OBS";
  if (settingsBtn) settingsBtn.style.display = "none";
}

// ---------- AUTO-DETECT ----------
const AUTO_DETECT_INTERVAL_MS = 6000;
const autoDetectToggle = document.getElementById("auto-detect-toggle");
let autoDetectTimer = null;

async function autoDetectTick() {
  if (refreshBtn.disabled) return;
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.url || !/geoguessr\.com/.test(tab.url)) return;
    await sendToTab(tab.id, { type: "FETCH_CURRENT_ROUND" });
  } catch {
    /* silent in auto mode */
  }
}

function startAutoDetect() {
  if (autoDetectTimer) return;
  autoDetectTick();
  autoDetectTimer = setInterval(autoDetectTick, AUTO_DETECT_INTERVAL_MS);
}

function stopAutoDetect() {
  if (autoDetectTimer) { clearInterval(autoDetectTimer); autoDetectTimer = null; }
}

if (autoDetectToggle) {
  chrome.storage.local.get(["autoDetect"], async ({ autoDetect }) => {
    autoDetectToggle.checked = !!autoDetect;
    if (autoDetect) startAutoDetect();
  });
  autoDetectToggle.addEventListener("change", async () => {
    const on = autoDetectToggle.checked;
    await chrome.storage.local.set({ autoDetect: on });
    if (on) startAutoDetect(); else stopAutoDetect();
  });
}

// ---------- AUTO-SUBMIT ----------
let autoSubmitGuess = true;
const autoSubmitToggle = document.getElementById("auto-submit-toggle");
if (autoSubmitToggle) {
  chrome.storage.local.get(["autoSubmit"], ({ autoSubmit }) => {
    autoSubmitGuess = autoSubmit !== false; // Default to true
    autoSubmitToggle.checked = autoSubmitGuess;
  });
  autoSubmitToggle.addEventListener("change", async () => {
    autoSubmitGuess = autoSubmitToggle.checked;
    await chrome.storage.local.set({ autoSubmit: autoSubmitGuess });
  });
}

// ---------- AUTO-GUESS ACCURACY ----------
let autoGuessAccuracy = 0;
const accuracySlider = document.getElementById("accuracy-slider");
const accuracyValue = document.getElementById("accuracy-value");

if (accuracySlider) {
  chrome.storage.local.get(["autoGuessAccuracy"], ({ autoGuessAccuracy: val }) => {
    autoGuessAccuracy = Number(val) || 0;
    accuracySlider.value = autoGuessAccuracy;
    if (accuracyValue) accuracyValue.textContent = autoGuessAccuracy + " км";
  });

  accuracySlider.addEventListener("input", () => {
    autoGuessAccuracy = Number(accuracySlider.value);
    if (accuracyValue) accuracyValue.textContent = autoGuessAccuracy + " км";
  });

  accuracySlider.addEventListener("change", async () => {
    await chrome.storage.local.set({ autoGuessAccuracy });
  });
}

// ---------- DEFAULT ZOOM ----------
window.defaultZoom = 0;
const zoomSlider = document.getElementById("zoom-slider");
const zoomValue = document.getElementById("zoom-value");
if (zoomSlider) {
  chrome.storage.local.get(["defaultZoom"], ({ defaultZoom: val }) => {
    window.defaultZoom = Number(val) || 0;
    zoomSlider.value = window.defaultZoom;
    if (zoomValue) zoomValue.textContent = window.defaultZoom === 0 ? "Авто" : window.defaultZoom;
  });

  zoomSlider.addEventListener("input", () => {
    window.defaultZoom = Number(zoomSlider.value);
    if (zoomValue) zoomValue.textContent = window.defaultZoom === 0 ? "Авто" : window.defaultZoom;
  });

  zoomSlider.addEventListener("change", async () => {
    await chrome.storage.local.set({ defaultZoom: window.defaultZoom });
  });
}

// ---------- IN-GAME OVERLAY ----------
const inGameOverlayToggle = document.getElementById("in-game-overlay-toggle");
if (inGameOverlayToggle) {
  chrome.storage.local.get(["inGameOverlay"], ({ inGameOverlay }) => {
    inGameOverlayToggle.checked = inGameOverlay !== false; // Default to true
  });
  inGameOverlayToggle.addEventListener("change", async () => {
    await chrome.storage.local.set({ inGameOverlay: inGameOverlayToggle.checked });
  });
}

// ---------- IN-GAME GLOW ----------
const inGameGlowToggle = document.getElementById("in-game-glow-toggle");
if (inGameGlowToggle) {
  chrome.storage.local.get(["inGameGlow"], ({ inGameGlow }) => {
    inGameGlowToggle.checked = inGameGlow !== false; // Default to true
  });
  inGameGlowToggle.addEventListener("change", async () => {
    await chrome.storage.local.set({ inGameGlow: inGameGlowToggle.checked });
  });
}

let glowDuration = 4;
const glowDurationSlider = document.getElementById("glow-duration-slider");
const glowDurationValue = document.getElementById("glow-duration-value");

if (glowDurationSlider) {
  chrome.storage.local.get(["glowDuration"], ({ glowDuration: val }) => {
    glowDuration = Number(val) || 4;
    glowDurationSlider.value = glowDuration;
    if (glowDurationValue) glowDurationValue.textContent = glowDuration + " сек";
  });

  glowDurationSlider.addEventListener("input", () => {
    glowDuration = Number(glowDurationSlider.value);
    if (glowDurationValue) glowDurationValue.textContent = glowDuration + " сек";
  });

  glowDurationSlider.addEventListener("change", async () => {
    await chrome.storage.local.set({ glowDuration });
  });
}

// ---------- I18N ----------
(async function initI18n() {
  await I18N.load();
  const langSelect = document.getElementById("lang-select");
  if (langSelect) {
    langSelect.innerHTML = "";
    I18N.LANGS.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l.code;
      opt.textContent = l.label;
      if (l.code === I18N.getLang()) opt.selected = true;
      langSelect.appendChild(opt);
    });
    langSelect.addEventListener("change", async () => {
      await I18N.setLang(langSelect.value);
    });
  }
  // Re-render dynamic strings whenever the language changes.
  I18N.onChange(async () => {
    refreshBtn.querySelector(".label").textContent = I18N.t("guess");
    if (!last) placeEl.textContent = I18N.t("open_round");
    updateGuessesBadge();
  });
})();
