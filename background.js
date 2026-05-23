async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }
}

async function triggerGuess() {
  const tabs = await chrome.tabs.query({ url: "*://*.geoguessr.com/*" });
  const tab = tabs.find((t) => t.active) || tabs[0];
  if (!tab) return;
  await sendToTab(tab.id, { type: "FETCH_CURRENT_ROUND" });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "trigger-guess") triggerGuess();
});

// Allow popup windows (incl. OBS mode) to request a guess too.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "TRIGGER_GUESS") {
    triggerGuess().then(() => sendResponse({ ok: true }));
    return true;
  }
});
