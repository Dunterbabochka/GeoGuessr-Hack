const map = L.map("map", {
    zoomControl: true,
    attributionControl: false,
    worldCopyJump: true,
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
}

chrome.storage.local.get(["mapStyle"], ({ mapStyle }) => {
  setMapStyle(mapStyle && TILE_STYLES[mapStyle] ? mapStyle : "voyager");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.mapStyle) {
    setMapStyle(changes.mapStyle.newValue && TILE_STYLES[changes.mapStyle.newValue] ? changes.mapStyle.newValue : "voyager");
  }
});

const pulseIcon = L.divIcon({
    className: "",
    html: '<div style="width:14px;height:14px;background:#ff5cb8;border:2px solid #fff;border-radius:50%;box-shadow:0 0 8px #ff5cb8; position:absolute; top:-9px; left:-9px;"></div>',
    iconSize: [0, 0],
});

let marker = null;

document.getElementById('close-btn').addEventListener('click', () => {
    window.parent.postMessage({ type: '__GEOHACK_CLOSE_OVERLAY__' }, '*');
});

// Dragging logic - communicate with parent to move the iframe wrapper
let isDragging = false;
let startX, startY;

document.getElementById('header').addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.screenX;
    startY = e.screenY;
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.screenX - startX;
    const dy = e.screenY - startY;
    startX = e.screenX;
    startY = e.screenY;
    window.parent.postMessage({ type: '__GEOHACK_DRAG_OVERLAY__', dx, dy }, '*');
});

window.addEventListener('mouseup', () => {
    isDragging = false;
});

window.addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.type === '__GEOHACK_UPDATE_LOCATION__') {
        const latlng = [data.lat, data.lng];
        if (marker) marker.setLatLng(latlng);
        else marker = L.marker(latlng, { icon: pulseIcon }).addTo(map);

        if (data.zoom && data.zoom > 0) {
            map.setView(latlng, data.zoom, { animate: false });
        } else {
            map.panTo(latlng, { animate: false });
        }
        
        if (data.placeName) {
            document.getElementById('title').textContent = data.placeName;
        } else {
            document.getElementById('title').textContent = `${data.lat.toFixed(4)}, ${data.lng.toFixed(4)}`;
        }
    }
});
