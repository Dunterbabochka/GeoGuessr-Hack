/*
 * Content script for GeoGuessr.
 * Handles all game modes: regular games, challenges, Duels, Battle Royale.
 *
 * For Duels/BR the round coordinates are NOT available via /api/v3/games/.
 * Instead we use two strategies:
 *   1. Inject a MAIN-world script that intercepts Google Maps GetMetadata
 *      API responses — these always contain the panorama lat/lng.
 *   2. Try game-server.geoguessr.com/api/duels/ (or /battle-royale/) endpoints
 *      as a fallback.
 */

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

function isUsefulGameId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,}$/.test(id) && !["streak", "infinity"].includes(id);
}

function canFetchGameEndpoint(id) {
  // 24-char hex values are GeoGuessr document/page ids in the new UI. Calling
  // /api/v3/games/{thatId} returns HTTP 400, so only use real game tokens here.
  return isUsefulGameId(id) && !OBJECT_ID_RE.test(id);
}

function save(coords, source) {
  if (!coords) return;
  chrome.storage.local.set({
    lastCoords: {
      lat: coords.lat,
      lng: coords.lng,
      source,
      host: location.hostname,
      url: location.href,
      ts: Date.now(),
    },
  });
}

function pickGameContainer(data) {
  if (data && Array.isArray(data.rounds)) return data;
  if (data?.game && Array.isArray(data.game.rounds)) return data.game;
  if (data?.data?.game && Array.isArray(data.data.game.rounds)) return data.data.game;
  if (data?.props?.pageProps?.game && Array.isArray(data.props.pageProps.game.rounds)) return data.props.pageProps.game;
  if (data?.pageProps?.game && Array.isArray(data.pageProps.game.rounds)) return data.pageProps.game;
  return null;
}

function getRoundFromGameData(data) {
  const game = pickGameContainer(data);
  const rounds = game && Array.isArray(game.rounds) ? game.rounds : [];
  if (!rounds.length) return null;

  const guessed = Array.isArray(game.player?.guesses) ? game.player.guesses.length : null;
  const roundFromApi = Number.isFinite(game.round) ? game.round - 1 : null;
  const idx = Math.max(0, Math.min(guessed ?? roundFromApi ?? 0, rounds.length - 1));
  const r = rounds[idx];
  if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return null;
  return { lat: r.lat, lng: r.lng, roundIndex: idx, total: rounds.length };
}

function extractGameToken(data, depth = 0, seen = new WeakSet()) {
  if (!data || typeof data !== "object" || depth > 6 || seen.has(data)) return null;
  seen.add(data);

  const direct = data.gameToken || data.gameIdOrToken || data.game?.token || data.data?.game?.token;
  if (canFetchGameEndpoint(direct)) return direct;
  if (Array.isArray(data.rounds) && canFetchGameEndpoint(data.token)) return data.token;

  for (const [key, value] of Object.entries(data)) {
    if (/gameToken|gameIdOrToken/i.test(key) && canFetchGameEndpoint(value)) return value;
    if (value && typeof value === "object") {
      const nested = extractGameToken(value, depth + 1, seen);
      if (nested) return nested;
    }
  }
  return null;
}

function findGameData(data, depth = 0, seen = new WeakSet()) {
  if (!data || typeof data !== "object" || depth > 8 || seen.has(data)) return null;
  seen.add(data);

  const game = pickGameContainer(data);
  if (game) return game;

  for (const value of Object.values(data)) {
    if (value && typeof value === "object") {
      const nested = findGameData(value, depth + 1, seen);
      if (nested) return nested;
    }
  }
  return null;
}

function parseJsonText(text) {
  if (!text || text.length > 5_000_000) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getPageJsonPayloads() {
  const payloads = [];
  const nextData = document.getElementById("__NEXT_DATA__");
  const nextJson = parseJsonText(nextData?.textContent);
  if (nextJson) payloads.push(nextJson);

  document.querySelectorAll('script[type="application/json"]').forEach((script) => {
    const data = parseJsonText(script.textContent);
    if (data) payloads.push(data);
  });

  for (const storage of [localStorage, sessionStorage]) {
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        const data = parseJsonText(key ? storage.getItem(key) : null);
        if (data) payloads.push(data);
      }
    } catch {
      /* storage may be unavailable in restricted browser modes */
    }
  }

  return payloads;
}

function getPageGameData() {
  for (const payload of getPageJsonPayloads()) {
    const game = findGameData(payload);
    if (game) return game;
  }
  return null;
}

function getPageGameToken() {
  for (const payload of getPageJsonPayloads()) {
    const token = extractGameToken(payload);
    if (token) return token;
  }

  const html = document.documentElement?.innerHTML || "";
  const apiUrl = html.match(/\/api\/v3\/(?:games|challenges)\/([A-Za-z0-9_-]{8,})/);
  if (apiUrl && canFetchGameEndpoint(apiUrl[1])) return apiUrl[1];

  const namedToken = html.match(/(?:gameToken|gameIdOrToken|token)\\?["']\s*:\s*\\?["']([A-Za-z0-9_-]{8,})/);
  if (namedToken && canFetchGameEndpoint(namedToken[1])) return namedToken[1];

  return null;
}

function getGameInfo() {
  // Match game/challenge/duels in any segment of the path (handles /results/, /round/N, locale prefixes, etc.)
  const m = location.pathname.match(/\/(game|challenge|duels|live-challenge|battle-royale|play)\/([A-Za-z0-9_-]+)/);
  if (m && isUsefulGameId(m[2])) return { kind: m[1] === "play" ? "game" : m[1], id: m[2] };

  // GeoGuessr sometimes keeps the visible URL as /game while the token only appears in API calls.
  const resource = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .find((name) => /\/api\/v3\/(games|challenges)\/[A-Za-z0-9_-]+/.test(name));
  if (resource) {
    const api = resource.match(/\/api\/v3\/(games|challenges)\/([A-Za-z0-9_-]+)/);
    if (api && isUsefulGameId(api[2])) return { kind: api[1] === "challenges" ? "challenge" : "game", id: api[2] };
  }

  const pageToken = document.documentElement?.innerHTML.match(/(?:gameToken|token|gameIdOrToken)["':\s]+([A-Za-z0-9_-]{8,})/);
  if (pageToken && canFetchGameEndpoint(pageToken[1])) {
    return { kind: "game", id: pageToken[1] };
  }

  const scriptToken = getPageGameToken();
  if (scriptToken) return { kind: "game", id: scriptToken };

  // Fallback: look for a GeoGuessr-style token (long base62 string or UUID) anywhere in the URL.
  const t = (location.pathname + location.search).match(/([A-Za-z0-9_-]{16,})/);
  if (t && canFetchGameEndpoint(t[1])) return { kind: "game", id: t[1] };

  return null;
}

/* ------------------------------------------------------------------ */
/*  MAIN-world injection for Street View coordinate interception      */
/* ------------------------------------------------------------------ */

let interceptedCoords = null;

function injectMainWorldScript() {
  // Only inject once per page
  if (document.getElementById("__geohack_injected")) return;

  const script = document.createElement("script");
  script.id = "__geohack_injected";
  script.src = chrome.runtime.getURL("injected.js");
  (document.head || document.documentElement).appendChild(script);

  // Listen for coords broadcast from the MAIN world script
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "__GEOHACK_SV_COORDS__") {
      interceptedCoords = {
        lat: event.data.lat,
        lng: event.data.lng,
        ts: event.data.ts,
      };
    }
  });
}

// Inject as early as possible
injectMainWorldScript();

/**
 * Returns the most recently intercepted Street View coordinates,
 * or null if none are available or they are too old (> 60s).
 */
function getInterceptedCoords() {
  if (!interceptedCoords) return null;
  const age = Date.now() - interceptedCoords.ts;
  if (age > 120_000) return null; // stale after 2 minutes
  return { lat: interceptedCoords.lat, lng: interceptedCoords.lng };
}

/**
 * Wait for intercepted coordinates with progressive retries.
 * Returns coords or null after all retries exhausted.
 */
async function waitForInterceptedCoords(maxRetries = 6, intervalMs = 500) {
  for (let i = 0; i < maxRetries; i++) {
    const coords = getInterceptedCoords();
    if (coords) return coords;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return getInterceptedCoords();
}

/* ------------------------------------------------------------------ */
/*  Duels / Battle Royale API support                                 */
/* ------------------------------------------------------------------ */

/**
 * Try to extract round coordinates from a Duels API response.
 * The response from game-server.geoguessr.com/api/duels/{id} has a
 * different structure than /api/v3/games/{id}.
 */
function extractDuelsCoords(data) {
  if (!data || typeof data !== "object") return null;

  // Try direct rounds array
  const rounds = data.rounds || data.currentGame?.rounds || data.game?.rounds;
  const currentRound = data.currentRoundNumber || data.currentGame?.currentRoundNumber || data.round;

  if (Array.isArray(rounds) && rounds.length > 0) {
    const idx = Number.isFinite(currentRound) ? Math.max(0, currentRound - 1) : rounds.length - 1;
    const r = rounds[Math.min(idx, rounds.length - 1)];
    if (r) {
      // Check various possible coordinate locations within round data
      const lat = r.lat ?? r.panorama?.lat ?? r.location?.lat ?? r.startLocation?.lat;
      const lng = r.lng ?? r.panorama?.lng ?? r.location?.lng ?? r.startLocation?.lng;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng, roundIndex: idx, total: rounds.length };
      }
    }
  }

  // Try nested team/player guesses for coordinate hints
  const teams = data.teams || data.currentGame?.teams;
  if (Array.isArray(teams)) {
    for (const team of teams) {
      const players = team.players || (team.player ? [team.player] : []);
      for (const player of players) {
        const guesses = player.guesses || player.rounds;
        if (Array.isArray(guesses)) {
          for (const g of guesses) {
            const lat = g.lat ?? g.location?.lat ?? g.panorama?.lat;
            const lng = g.lng ?? g.location?.lng ?? g.panorama?.lng;
            if (Number.isFinite(lat) && Number.isFinite(lng) && (Math.abs(lat) > 0.01 || Math.abs(lng) > 0.01)) {
              // This gives us the round location (answer), not the player's guess
              const answerLat = g.correctLocation?.lat ?? g.answer?.lat ?? g.panorama?.lat;
              const answerLng = g.correctLocation?.lng ?? g.answer?.lng ?? g.panorama?.lng;
              if (Number.isFinite(answerLat) && Number.isFinite(answerLng)) {
                return { lat: answerLat, lng: answerLng, roundIndex: 0, total: 1 };
              }
            }
          }
        }
      }
    }
  }

  // Deep search for any object with lat/lng that looks like round data
  return deepSearchCoords(data);
}

/**
 * Deep-search for lat/lng in a nested object (max depth 8).
 */
function deepSearchCoords(obj, depth = 0, seen = new WeakSet()) {
  if (!obj || typeof obj !== "object" || depth > 8 || seen.has(obj)) return null;
  seen.add(obj);

  // Check if this object itself has lat/lng (but skip if it's a guess/player position)
  if (
    Number.isFinite(obj.lat) && Number.isFinite(obj.lng) &&
    (Math.abs(obj.lat) > 0.001 || Math.abs(obj.lng) > 0.001) &&
    !obj.oddsOfCorrectCountry // skip player guess objects
  ) {
    return { lat: obj.lat, lng: obj.lng, roundIndex: 0, total: 1 };
  }

  // Check panorama sub-object
  if (obj.panorama && Number.isFinite(obj.panorama.lat) && Number.isFinite(obj.panorama.lng)) {
    return { lat: obj.panorama.lat, lng: obj.panorama.lng, roundIndex: 0, total: 1 };
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const result = deepSearchCoords(value, depth + 1, seen);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Scan performance resource entries for game-server URLs and try to
 * identify duels/BR game IDs.
 */
function getGameServerIds() {
  const ids = [];
  try {
    const entries = performance.getEntriesByType("resource");
    for (const entry of entries) {
      // Match game-server.geoguessr.com/api/duels/{id} or /api/battle-royale/{id}
      const m = entry.name.match(
        /game-server\.geoguessr\.com\/api\/(duels|battle-royale)\/([A-Za-z0-9_-]+)/
      );
      if (m && m[2]) {
        ids.push({ kind: m[1], id: m[2] });
      }
    }
  } catch {
    /* performance API may not be available */
  }
  return ids;
}

/* ------------------------------------------------------------------ */

function requestPageSnapshot() {
  // Intentionally left as a no-op: patching the page's MAIN world can break
  // GeoGuessr's app bootstrap in some browsers.
}

async function tryFetch(url) {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return { err: new Error(`${url} -> HTTP ${res.status}`) };
    return { data: await res.json() };
  } catch (e) {
    return { err: e };
  }
}

function extractCoords(payload) {
  const captured = payload?.capturedRound;
  if (captured && Number.isFinite(captured.lat) && Number.isFinite(captured.lng)) {
    return {
      lat: captured.lat,
      lng: captured.lng,
      roundIndex: Number.isFinite(captured.roundIndex) ? captured.roundIndex : 0,
      total: Number.isFinite(captured.total) ? captured.total : 1,
    };
  }

  const round = getRoundFromGameData(payload?.gameData);
  if (round) return round;

  throw new Error("no_round_data");
}

async function fetchCurrentRound() {
  requestPageSnapshot();

  const pageGameData = getPageGameData();
  const info = getGameInfo();
  const ids = [];
  let data = null;
  let lastErr = null;

  const addGameId = (id) => {
    if (canFetchGameEndpoint(id) && !ids.includes(id)) ids.push(id);
  };

  addGameId(extractGameToken(pageGameData));
  addGameId(getPageGameToken());

  /* ---- Duels / Battle Royale ---- */
  const isDuelsOrBR = info?.kind === "duels" || info?.kind === "battle-royale" || info?.kind === "live-challenge";

  if (isDuelsOrBR) {
    // Strategy 1: Use intercepted Street View coordinates (most reliable)
    // Wait with retries since the StreetViewPanorama hook may need a moment
    const svCoords = await waitForInterceptedCoords(4, 400);
    if (svCoords) {
      return { lat: svCoords.lat, lng: svCoords.lng, roundIndex: 0, total: 1 };
    }

    // Strategy 2: Try game-server.geoguessr.com API
    const duelsEndpoints = [];
    const apiKind = info.kind === "battle-royale" ? "battle-royale" : "duels";

    // Add the ID from the URL
    if (info.id) {
      duelsEndpoints.push(`https://game-server.geoguessr.com/api/${apiKind}/${info.id}`);
    }

    // Also check performance entries for game-server URLs
    const gsIds = getGameServerIds();
    for (const gs of gsIds) {
      const url = `https://game-server.geoguessr.com/api/${gs.kind}/${gs.id}`;
      if (!duelsEndpoints.includes(url)) duelsEndpoints.push(url);
    }

    for (const endpoint of duelsEndpoints) {
      const r = await tryFetch(endpoint);
      if (r.data) {
        const coords = extractDuelsCoords(r.data);
        if (coords) return coords;

        // The Duels API might also have a nested game token for /api/v3/games/
        const nestedToken = extractGameToken(r.data);
        addGameId(nestedToken);
      }
      if (r.err) lastErr = r.err;
    }

    // Strategy 3: Try page JSON payloads with deep search
    for (const payload of getPageJsonPayloads()) {
      const coords = extractDuelsCoords(payload);
      if (coords) return coords;
    }
  }

  /* ---- Challenge mode ---- */
  if (info?.kind === "challenge") {
    const r = await tryFetch(`/api/v3/challenges/${info.id}`);
    if (r.data) {
      addGameId(extractGameToken(r.data));
      try {
        return extractCoords({ gameData: r.data });
      } catch (e) {
        if (!/no_round_data/.test(e.message)) throw e;
      }
    } else if (r.err) {
      lastErr = r.err;
    }
  } else if (info?.kind === "game") {
    addGameId(info.id);
  }

  /* ---- Standard /api/v3/games/ fetch ---- */
  for (const id of ids) {
    const r = await tryFetch(`/api/v3/games/${id}`);
    if (r.data) { data = r.data; break; }
    if (r.err) lastErr = r.err;
  }

  if (data) {
    try {
      return extractCoords({ gameData: data });
    } catch (e) {
      if (!/no_round_data/.test(e.message)) throw e;
    }
  }

  /* ---- Last resort for Duels/BR: intercepted Street View coords ---- */
  if (isDuelsOrBR) {
    // Wait with extended retries for the SV hook to fire
    const svCoords = await waitForInterceptedCoords(8, 600);
    if (svCoords) {
      return { lat: svCoords.lat, lng: svCoords.lng, roundIndex: 0, total: 1 };
    }
  }

  /* ---- Fallback: any intercepted Street View coords for ANY mode ---- */
  const svFallback = getInterceptedCoords();
  if (svFallback) {
    return { lat: svFallback.lat, lng: svFallback.lng, roundIndex: 0, total: 1 };
  }

  if (data) {
    throw new Error("Координаты раунда недоступны (данные игры получены, но раунд не найден)");
  }

  if (pageGameData && !ids.length) {
    try {
      return extractCoords({ gameData: pageGameData });
    } catch (e) {
      if (!/no_round_data/.test(e.message)) throw e;
    }
  }

  if (lastErr && ids.length) {
    throw new Error("Не удалось прочитать данные игры. Обновите страницу GeoGuessr после загрузки раунда и попробуйте снова.");
  }

  if (isDuelsOrBR) {
    throw new Error(
      "Координаты Duels/BR пока не перехвачены. Подождите пока раунд полностью загрузится (панорама видна на экране), затем нажмите Guess снова."
    );
  }

  throw new Error("Не найден рабочий game token. Обновите страницу GeoGuessr после загрузки раунда и нажмите Guess снова.");
}


chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "FETCH_CURRENT_ROUND") {
    fetchCurrentRound()
      .then((c) => {
        const label = c.total === 1 ? "google-streetview" : `geoguessr-api (раунд ${c.roundIndex + 1}/${c.total})`;
        save({ lat: c.lat, lng: c.lng }, label);
        if (inGameGlowEnabled) {
          window.postMessage({ type: "__GEOHACK_SHOW_GLOW__", lat: c.lat, lng: c.lng, duration: glowDuration }, "*");
        }
        sendResponse({ ok: true, ...c });
      })
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  
  if (msg && msg.type === "AUTO_GUESS") {
    console.log("[GeoHack CONTENT] Получена команда AUTO_GUESS. Отправляем в MAIN...");
    window.postMessage({ type: "__GEOHACK_PLACE_GUESS__", lat: msg.lat, lng: msg.lng }, "*");
    
    if (msg.autoSubmit === false) {
      console.log("[GeoHack CONTENT] Auto-submit отключен. Маркер поставлен.");
      sendResponse({ ok: true });
      return true;
    }

    setTimeout(() => {
      console.log("[GeoHack CONTENT] Прошло 800мс. Ищем кнопку Guess...");
      let btn = document.querySelector('[data-qa="perform-guess"]');
      if (!btn) {
        console.log("[GeoHack CONTENT] Кнопка по data-qa не найдена, ищем по тексту...");
        const buttons = Array.from(document.querySelectorAll("button"));
        btn = buttons.find(b => {
          if (b.disabled) return false;
          const text = b.textContent || "";
          const cls = b.className || "";
          if (cls.includes("guess-map__guess-button")) return true;
          if (/guess|сделать выбор/i.test(text)) return true;
          if (b.querySelector('img[src*="pin"]')) return true;
          return false;
        });
      }
      
      if (btn) {
        console.log("[GeoHack CONTENT] Кнопка найдена, эмулируем клик:", btn);
        btn.click();
        sendResponse({ ok: true });
      } else {
        console.warn("[GeoHack CONTENT] ОШИБКА: Кнопка Guess не найдена! Пробуем нажать Space...");
        // Fallback: try pressing Spacebar
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true }));
        document.body.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true }));
        sendResponse({ ok: false, error: "Кнопка Guess не найдена. Нажат Space." });
      }
    }, 800);
    return true;
  }
});

/* ------------------------------------------------------------------ */
/*  In-Game Overlay (Mini Map)                                        */
/* ------------------------------------------------------------------ */

let overlayWrapper = null;
let overlayIframe = null;
let inGameOverlayEnabled = true;
let inGameGlowEnabled = true;
let glowDuration = 4;
let defaultZoom = 0;
let lastCoords = null;

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=en&zoom=14`;
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
    return parts.length ? parts.join(", ") : data.display_name || null;
  } catch {
    return null;
  }
}

async function updateOverlay(data) {
  if (!data || !inGameOverlayEnabled) {
    if (overlayWrapper) overlayWrapper.style.display = 'none';
    return;
  }

  if (!overlayWrapper) {
    overlayWrapper = document.createElement('div');
    overlayWrapper.style.cssText = `
      position: fixed; z-index: 9999999; 
      top: 20px; right: 20px; 
      width: 340px; height: 260px; 
      border: 1px solid rgba(255,255,255,0.2); 
      border-radius: 10px; overflow: hidden; 
      background: #0b0820; 
      box-shadow: 0 8px 32px rgba(0,0,0,0.6); 
      resize: both; 
      min-width: 200px; min-height: 150px;
    `;
    
    overlayIframe = document.createElement('iframe');
    overlayIframe.src = chrome.runtime.getURL('overlay.html');
    overlayIframe.style.cssText = 'width: 100%; height: 100%; border: none; background: transparent;';
    
    overlayWrapper.appendChild(overlayIframe);
    document.body.appendChild(overlayWrapper);
    
    // Allow iframe to load before sending first message
    overlayIframe.onload = () => {
      sendCoordsToOverlay(data);
    };
  } else {
    overlayWrapper.style.display = 'block';
    sendCoordsToOverlay(data);
  }
}

async function sendCoordsToOverlay(data) {
  if (!overlayIframe || !overlayIframe.contentWindow) return;
  const placeName = await reverseGeocode(data.lat, data.lng);
  overlayIframe.contentWindow.postMessage({
    type: '__GEOHACK_UPDATE_LOCATION__',
    lat: data.lat,
    lng: data.lng,
    zoom: defaultZoom,
    placeName
  }, '*');
}

chrome.storage.local.get(["inGameOverlay", "defaultZoom", "lastCoords", "inGameGlow", "glowDuration"], (res) => {
  if (res.inGameOverlay !== undefined) inGameOverlayEnabled = res.inGameOverlay;
  if (res.inGameGlow !== undefined) inGameGlowEnabled = res.inGameGlow;
  if (res.glowDuration !== undefined) glowDuration = Number(res.glowDuration);
  if (res.defaultZoom !== undefined) defaultZoom = Number(res.defaultZoom);
  if (res.lastCoords) {
    lastCoords = res.lastCoords;
    if (inGameOverlayEnabled && /geoguessr\.com/.test(location.hostname)) {
      updateOverlay(lastCoords);
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  
  if (changes.inGameOverlay) {
    inGameOverlayEnabled = changes.inGameOverlay.newValue;
    if (!inGameOverlayEnabled && overlayWrapper) {
      overlayWrapper.style.display = 'none';
    } else if (inGameOverlayEnabled && lastCoords) {
      updateOverlay(lastCoords);
    }
  }
  
  if (changes.inGameGlow) {
    inGameGlowEnabled = changes.inGameGlow.newValue;
  }
  if (changes.glowDuration) {
    glowDuration = Number(changes.glowDuration.newValue) || 4;
  }
  
  if (changes.defaultZoom) {
    defaultZoom = Number(changes.defaultZoom.newValue) || 0;
  }
  
  if (changes.lastCoords) {
    lastCoords = changes.lastCoords.newValue;
    if (inGameOverlayEnabled && lastCoords) {
      updateOverlay(lastCoords);
    }
  }
});

window.addEventListener('message', (event) => {
  if (!overlayWrapper) return;
  if (event.data?.type === '__GEOHACK_CLOSE_OVERLAY__') {
    overlayWrapper.style.display = 'none';
    // Optionally update setting so it doesn't pop up again this session?
    // User can re-enable from extension popup.
  } else if (event.data?.type === '__GEOHACK_DRAG_OVERLAY__') {
    const rect = overlayWrapper.getBoundingClientRect();
    let newTop = rect.top + event.data.dy;
    let newLeft = rect.left + event.data.dx;
    // Keep mostly on screen
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - 50));
    newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - 50));
    overlayWrapper.style.top = newTop + 'px';
    overlayWrapper.style.left = newLeft + 'px';
    overlayWrapper.style.right = 'auto'; // Disable right anchoring
  }
});

