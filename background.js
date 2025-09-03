chrome.runtime.onInstalled.addListener(() => {});
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "gmcx-command", command });
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "gmcx-capture-visible-tab") {
    chrome.tabs.captureVisibleTab({ format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true;
  }
});