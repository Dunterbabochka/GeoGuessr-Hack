<div align="center">

<img src="icon128.png" alt="GeoGuessr Hack Logo" width="100"/>

# 🌍 GeoGuessr Hack / Helper

**A powerful Chrome extension to assist you in GeoGuessr**

[![License](https://img.shields.io/badge/License-MIT-D32F2F?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![React](https://img.shields.io/badge/React-Fiber_Hooks-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)

> ⚡ *Automatically extracts exact coordinates of the current round and allows you to place a marker on the map in one click (or automatically).*

</div>

---
<div align="center">
STATUS:

[![Status](https://img.shields.io/badge/25.05.26-Working-4CAF50?style=for-the-badge)](https://github.com/Dunterbabochka/GeoGuessr-Hack)

</div>

---
## 🧠 What is this?

**GeoGuessr Hack** is an advanced Chrome extension that integrates into GeoGuessr's internal API and React state. It allows you to obtain the exact location coordinates (latitude and longitude) and automatically make a guess on the in-game map.

The extension works by:
- 🔍 **Intercepting** API responses in standard and challenge modes.
- 💉 **Injecting** scripts into the `MAIN` world (hooking `google.maps.StreetViewPanorama`) for Battle Royale and Duels modes.
- 🎛️ **Interacting** directly with React Fiber nodes (`__reactFiber$...`) to manipulate the map instances (Google Maps and Leaflet).

---

## ✨ Key Features

| Feature | Description |
|---|---|
| 📍 **Coordinate Extraction** | Gets the exact latitude and longitude directly from GeoGuessr's API and React state. |
| 🎯 **Auto-Guess** | Automatically places a marker on the map and (optionally) clicks the "Guess" button. |
| 🎲 **Adjustable Inaccuracy** | Offsets your guess by up to 2500 km in a random direction so you don't look suspicious (avoiding exactly 5000 points every game). |
| 🎥 **OBS Mode** | Opens a separate detached helper window for safe streaming (Twitch/YouTube) without showing coordinates to viewers. |
| 🗺️ **Mini-Map Customization** | Changes the mini-map style (Light, Dark, Satellite) and toggles country borders. |
| 🌐 **Location Info** | Shows the country flag and the exact real-world address (using OpenStreetMap reverse geocoding). |

---

## 🚀 Installation & Setup

Since this extension is not available on the Chrome Web Store, you need to install it manually:

### Installing the Extension in Chrome

1. Download or clone this repository to your computer:
   ```bash
   git clone https://github.com/Dunterbabochka/GeoGuessr-Hack
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle switch in the top right corner).
4. Click **Load unpacked** and select the folder containing the extension (`GeoGuessr-Hack`).
5. The extension is now installed! Pin it to your toolbar for easy access.

---

## 🎮 How to Use

1. Start a game on [GeoGuessr](https://www.geoguessr.com/).
2. Open the extension's popup menu.
3. Click **Guess** (📷) to reveal the location of the current round. The map will center on the correct answer.
4. Click **Auto-Guess** (🎯) to automatically place your marker on the in-game map.
   - *By default, Auto-Guess will also click the "Make Guess" button. You can disable this in the settings.*

---

## ⚙️ Settings & Automation

Click the Gear icon (⚙) in the top right corner of the extension to open settings:

- **Auto-Detect:** Automatically fetches coordinates as soon as a new round loads.
- **Auto-Submit:** Toggles whether Auto-Guess should automatically confirm your guess or just place the marker.
- **Random Inaccuracy:** A slider to set the maximum offset (up to 2500 km) for Auto-Guess. If set to 500 km, the script will place the marker in a random spot between 150 and 500 km away from the exact location.
- **OBS Mode:** Opens the helper in a separate window for safe streaming.
- **In-Game Overlay**
- **In-Game Glow**
- **Default Map Zoom**

---

## 📋 Changelog

<details>
<summary><b>v1.0.0 — First release</b></summary>

[![GitHub tag (latest by date)](https://img.shields.io/badge/release-v1.0.0-blue?style=flat-square)](https://github.com/Dunterbabochka/GeoGuessr-Hack/releases/tag/v1.0.0)
[![Git Commit](https://img.shields.io/badge/commit-220cd08-orange?style=flat-square)](https://github.com/Dunterbabochka/GeoGuessr-Hack/commit/220cd08)

- Basic functionality
- "Auto-Guess" system
- Anti-Ban system for "Auto-Guess" (Случайная погрешность)
- OBS MODE for streamers
- And much more...

</details>

<details>
<summary><b>v1.1.0 — Fixes and comfort</b></summary>

[![GitHub tag (latest by date)](https://img.shields.io/badge/release-v1.1.0-blue?style=flat-square)](https://github.com/Dunterbabochka/GeoGuessr-Hack/releases/tag/v1.1.0)
[![Git Commit](https://img.shields.io/badge/commit-556e517-orange?style=flat-square)](https://github.com/Dunterbabochka/GeoGuessr-Hack/commit/556e517)

### What's New:

- **In-Game Overlay:**
   - A floating interactive mini-map with Drag-and-Drop, resizing, and theme sync.
- **In-Game Glow:**
   - A temporary glowing marker upon clicking "Guess" (supports Leaflet & Google Maps) with an adjustable fade-out timer.
- **Default Map Zoom:**
   - Added a slider (0–18) to set a preferred default zoom level when pinpointing.
### Bug Fixes:

* Fixed the settings panel scrolling behavior (the background page no longer scrolls).
</details>

---

## 🛠️ Tech Stack

| Layer | Technology | Usage |
|---|---|---|
| 🌐 **Browser Extension** | Chrome MV3 / MV2 | Page interaction and Popup UI |
| ⚛️ **React Manipulation** | React Fiber | Access to internal state of GeoGuessr components |
| 🗺️ **Maps API** | Google Maps & Leaflet API | Placing markers on the in-game map |
| 📡 **Network Interception** | `fetch` / `XMLHttpRequest` | Intercepting API responses to get coordinates |

---

## ⚠️ Important Notes

> [!WARNING]
> The extension uses invasive methods to interact with React Fiber and the game's API. Updates to the GeoGuessr website may temporarily break its functionality.

> [!CAUTION]
> Please use the **Random Inaccuracy** feature. Scoring exactly 5000 points in every round (especially in competitive modes) can lead to account bans for suspicious activity.

---

## 📄 License

This project is distributed under the free **MIT** license. See the [LICENSE](LICENSE) file for details.

---

<div align="center">

Сделано на похуй

*BY Dunter*

</div>
