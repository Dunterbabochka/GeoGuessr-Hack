/*
 * MAIN-world script injected by the content script.
 * Hooks into the Google Maps StreetViewPanorama API to extract
 * the actual panorama coordinates. Works for ALL game modes
 * including Duels and Battle Royale.
 *
 * Communicates coordinates back to the content script via
 * window.postMessage.
 */
(function () {
  "use strict";

  const CHANNEL = "__GEOHACK_SV_COORDS__";

  // Avoid double-injection
  if (window.__geohackInjected) return;
  window.__geohackInjected = true;

  /* ---------- Broadcasting ---------- */

  let lastBroadcast = { lat: 0, lng: 0, ts: 0 };

  function broadcast(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    // Skip (0, 0) — not a real location
    if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) return;
    // Deduplicate (same coords within 2 seconds)
    if (
      lat === lastBroadcast.lat &&
      lng === lastBroadcast.lng &&
      Date.now() - lastBroadcast.ts < 2000
    ) {
      return;
    }
    lastBroadcast = { lat, lng, ts: Date.now() };
    window.postMessage({ type: CHANNEL, lat, lng, ts: Date.now() }, "*");
  }

  /* ---------- Extract position from a panorama instance ---------- */

  function readPosition(pano) {
    try {
      const pos = pano.getPosition();
      if (!pos) return null;
      const lat = typeof pos.lat === "function" ? pos.lat() : pos.lat;
      const lng = typeof pos.lng === "function" ? pos.lng() : pos.lng;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    } catch (_) {
      /* panorama may not be fully initialized yet */
    }
    return null;
  }

  function broadcastFromPano(pano) {
    const pos = readPosition(pano);
    if (pos) broadcast(pos.lat, pos.lng);
  }

  /* ---------- Track panorama instances ---------- */

  const trackedPanoramas = new Set();

  function trackPanorama(pano) {
    if (!pano || trackedPanoramas.has(pano)) return;
    trackedPanoramas.add(pano);

    // Read current position if already set
    broadcastFromPano(pano);

    // Listen for position changes (most reliable)
    try {
      pano.addListener("position_changed", function () {
        broadcastFromPano(pano);
      });
    } catch (_) {}

    // Also listen for pano ID changes (position updates after pano loads)
    try {
      pano.addListener("pano_changed", function () {
        // Position is set slightly after pano change
        setTimeout(function () {
          broadcastFromPano(pano);
        }, 300);
      });
    } catch (_) {}
  }

  /* ---------- Hook google.maps.StreetViewPanorama ---------- */

  let hooked = false;

  function hookStreetViewPanorama() {
    if (hooked) return true;
    if (!window.google || !window.google.maps || !window.google.maps.StreetViewPanorama) {
      return false;
    }

    const SVP = google.maps.StreetViewPanorama;

    // --- 1. Wrap the constructor to catch new instances ---
    const OrigSVP = SVP;
    function HookedSVP() {
      // Use Reflect.construct to properly call the original constructor
      const instance = Reflect.construct(OrigSVP, arguments, OrigSVP);
      trackPanorama(instance);
      return instance;
    }

    // Preserve prototype chain so instanceof checks still work
    HookedSVP.prototype = OrigSVP.prototype;
    HookedSVP.prototype.constructor = HookedSVP;

    // Copy static properties (e.g. ControlPosition, etc.)
    for (const key of Object.getOwnPropertyNames(OrigSVP)) {
      if (key !== "prototype" && key !== "length" && key !== "name") {
        try {
          HookedSVP[key] = OrigSVP[key];
        } catch (_) {}
      }
    }

    google.maps.StreetViewPanorama = HookedSVP;

    // --- 2. Patch setPosition on the prototype ---
    const origSetPosition = OrigSVP.prototype.setPosition;
    if (typeof origSetPosition === "function") {
      OrigSVP.prototype.setPosition = function (latLng) {
        const result = origSetPosition.call(this, latLng);
        if (latLng) {
          const lat = typeof latLng.lat === "function" ? latLng.lat() : latLng.lat;
          const lng = typeof latLng.lng === "function" ? latLng.lng() : latLng.lng;
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            broadcast(lat, lng);
          }
        }
        // Also track this instance if not already tracked
        trackPanorama(this);
        return result;
      };
    }

    // --- 3. Patch setPano on the prototype ---
    const origSetPano = OrigSVP.prototype.setPano;
    if (typeof origSetPano === "function") {
      OrigSVP.prototype.setPano = function (panoId) {
        const result = origSetPano.call(this, panoId);
        // Position updates asynchronously after setPano
        const self = this;
        setTimeout(function () {
          broadcastFromPano(self);
        }, 500);
        trackPanorama(this);
        return result;
      };
    }

    hooked = true;
    return true;
  }

  /* ---------- Polling: retry hook + poll existing panoramas ---------- */

  // Keep trying to hook until google.maps loads
  let hookAttempts = 0;
  const hookTimer = setInterval(function () {
    hookAttempts++;
    if (hookStreetViewPanorama()) {
      clearInterval(hookTimer);
    }
    // Stop trying after ~3 minutes
    if (hookAttempts > 900) {
      clearInterval(hookTimer);
    }
  }, 200);

  // Also try immediately
  hookStreetViewPanorama();

  // Periodically poll all tracked panorama instances for position changes.
  // This catches cases where position is set via internal methods we didn't hook.
  setInterval(function () {
    for (const pano of trackedPanoramas) {
      broadcastFromPano(pano);
    }
  }, 2000);

})();
