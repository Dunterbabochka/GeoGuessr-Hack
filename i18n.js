/* global chrome */
// Lightweight i18n for GeoHack extension.

(function () {
  const LANGS = [
    { code: "ru", label: "Русский" },
    { code: "en", label: "English" },
  ];

  const DICT = {
    ru: {
      title: "GeoHack",
      subtitle: "PREMIUM SOFTWARE",
      settings_btn: "Настройки",
      close: "Закрыть",
      guess: "Guess",
      loading: "Загрузка...",
      hotkey_label: "Hotkey",
      location_label: "Location",
      coords_label: "Coordinates",
      open_round: "Откройте раунд и нажмите Guess",
      detecting: "Определяем место...",
      no_address: "Не удалось определить адрес",
      gmaps_open: "Открыть в Google Maps",
      open_geoguessr: "Откройте вкладку GeoGuessr.",
      coords_fail: "Не удалось получить координаты.",
      error: "Ошибка: ",
      automation: "Automation",
      auto_detect: "Auto-detect",
      auto_detect_desc:
        "Автоматически определяет координаты нового раунда без нажатия кнопки. Расширение опрашивает активную вкладку GeoGuessr каждые 6 секунд и обновляет карту, когда раунд меняется.",
      streaming: "Streaming",
      obs_mode: "OBS MODE",
      obs_desc:
        "Открывает окно с картой, которое можно захватить в OBS.<br/>Данные продолжают браться из активной вкладки GeoGuessr.",
      language: "Язык",
      language_desc: "Выберите язык интерфейса расширения.",
    },
    en: {
      title: "GeoHack",
      subtitle: "PREMIUM SOFTWARE",
      settings_btn: "Settings",
      close: "Close",
      guess: "Guess",
      loading: "Loading...",
      hotkey_label: "Hotkey",
      location_label: "Location",
      coords_label: "Coordinates",
      open_round: "Open a round and press Guess",
      detecting: "Detecting place...",
      no_address: "Could not resolve address",
      gmaps_open: "Open in Google Maps",
      open_geoguessr: "Open a GeoGuessr tab.",
      coords_fail: "Failed to get coordinates.",
      error: "Error: ",
      automation: "Automation",
      auto_detect: "Auto-detect",
      auto_detect_desc:
        "Automatically detects a new round's coordinates without pressing the button. The extension polls the active GeoGuessr tab every 6 seconds and updates the map when the round changes.",
      streaming: "Streaming",
      obs_mode: "OBS MODE",
      obs_desc:
        "Opens a window with the map you can capture in OBS.<br/>Data is still pulled from the active GeoGuessr tab.",
      language: "Language",
      language_desc: "Choose the extension interface language.",
    },
  };

  let currentLang = "ru";
  const listeners = new Set();

  function detectDefault() {
    const nav = (navigator.language || "ru").slice(0, 2).toLowerCase();
    return DICT[nav] ? nav : "ru";
  }

  function t(key, ...args) {
    const dict = DICT[currentLang] || DICT.ru;
    const v = dict[key];
    if (typeof v === "function") return v(...args);
    if (v == null) return DICT.ru[key] || key;
    return v;
  }

  function apply(root = document) {
    document.documentElement.lang = currentLang;
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
    listeners.forEach((cb) => {
      try { cb(currentLang); } catch { /* ignore */ }
    });
  }

  async function load() {
    try {
      const { lang } = await chrome.storage.local.get(["lang"]);
      currentLang = lang && DICT[lang] ? lang : detectDefault();
    } catch {
      currentLang = detectDefault();
    }
    apply();
  }

  async function setLang(lang) {
    if (!DICT[lang]) return;
    currentLang = lang;
    try { await chrome.storage.local.set({ lang }); } catch { /* ignore */ }
    apply();
  }

  function getLang() { return currentLang; }
  function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

  window.I18N = { t, apply, load, setLang, getLang, onChange, LANGS };
})();
