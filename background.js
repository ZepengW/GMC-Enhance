chrome.runtime.onInstalled.addListener(() => {});

// 全局跨标签媒体控制状态
const GLOBAL_MEDIA = {
  mediaList: [], // [{tab, info}]
  selectedIndex: -1,
  lastScan: 0,
  scanTTL: 4000, // 毫秒内重复使用缓存
  seekAccumDelta: 0,
  seekAccumTimer: null,
  seekDebounce: 550,
  baseTime: null, // 最近一次实际 currentTime 基准
  pendingRefreshAfterSwitch: false
};

function sendToContent(tabId, msg) {
  if (typeof tabId !== 'number') return;
  chrome.tabs.sendMessage(tabId, msg, () => chrome.runtime.lastError); // 忽略错误
}

function overlayUpdateOnActive(payload) {
  chrome.tabs.query({active:true, currentWindow:true}, ([tab]) => {
    if (!tab) return;
    sendToContent(tab.id, {type:'gmcx-global-overlay', action:'update', payload});
  });
}

async function sendToTab(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => resolve(resp));
  });
}

async function scanMediaAcrossTabs(force = false) {
  const now = Date.now();
  if (!force && GLOBAL_MEDIA.mediaList.length && (now - GLOBAL_MEDIA.lastScan) < GLOBAL_MEDIA.scanTTL) {
    return GLOBAL_MEDIA.mediaList;
  }
  const tabs = await chrome.tabs.query({});
  const list = [];
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const info = await sendToTab(tab.id, {type:'gmcx-get-media-info'});
      if (info && info.ok) {
        list.push({tab, info});
      }
    } catch {}
  }
  GLOBAL_MEDIA.mediaList = list;
  GLOBAL_MEDIA.lastScan = Date.now();
  // 修正 selectedIndex
  if (list.length === 0) {
    GLOBAL_MEDIA.selectedIndex = -1;
  } else if (GLOBAL_MEDIA.selectedIndex >= list.length || GLOBAL_MEDIA.selectedIndex < 0) {
    GLOBAL_MEDIA.selectedIndex = 0;
  }
  return list;
}

async function cycleGlobalSelection() {
  const list = await scanMediaAcrossTabs(true);
  if (!list.length) {
    GLOBAL_MEDIA.selectedIndex = -1;
    overlayUpdateOnActive({empty:true, message:'未找到可控制的视频/音频'});
    return;
  }
  GLOBAL_MEDIA.selectedIndex = (GLOBAL_MEDIA.selectedIndex + 1) % list.length;
  const {tab, info} = list[GLOBAL_MEDIA.selectedIndex];
  GLOBAL_MEDIA.seekAccumDelta = 0;
  GLOBAL_MEDIA.baseTime = null; // 切换后延后获取
  GLOBAL_MEDIA.pendingRefreshAfterSwitch = true;
  overlayUpdateOnActive({
    mode:'select',
    index: GLOBAL_MEDIA.selectedIndex + 1,
    total: list.length,
    title: (tab.title || tab.url || '').slice(0,80),
    paused: info.paused,
    duration: info.duration,
    currentTime: '--:--', // 切换时不即时获取
    percent: 0,
    preview: true
  });
}

async function ensureBaseTime() {
  if (GLOBAL_MEDIA.baseTime != null) return;
  const entry = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
  if (!entry) return;
  const {tab} = entry;
  const updated = await sendToTab(tab.id, {type:'gmcx-get-media-info'});
  if (updated && updated.ok) {
    GLOBAL_MEDIA.baseTime = updated.rawCurrentTime;
    overlayUpdateOnActive({
      mode:'sync',
      index: GLOBAL_MEDIA.selectedIndex + 1,
      total: GLOBAL_MEDIA.mediaList.length,
      title: (tab.title || tab.url || '').slice(0,80),
      paused: updated.paused,
      duration: updated.duration,
      currentTime: updated.currentTime,
      percent: updated.rawDuration ? (updated.rawCurrentTime / updated.rawDuration) * 100 : 0,
      preview: false
    });
  }
}

function scheduleSeekCommit() {
  clearTimeout(GLOBAL_MEDIA.seekAccumTimer);
  GLOBAL_MEDIA.seekAccumTimer = setTimeout(async () => {
    if (!GLOBAL_MEDIA.seekAccumDelta) return;
    const entry = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
    if (!entry) { GLOBAL_MEDIA.seekAccumDelta = 0; return; }
    try {
      await sendToTab(entry.tab.id, {type:'gmcx-seek-media', value: GLOBAL_MEDIA.seekAccumDelta});
      const updated = await sendToTab(entry.tab.id, {type:'gmcx-get-media-info'});
      if (updated && updated.ok) {
        GLOBAL_MEDIA.baseTime = updated.rawCurrentTime;
        overlayUpdateOnActive({
          mode:'final',
          index: GLOBAL_MEDIA.selectedIndex + 1,
          total: GLOBAL_MEDIA.mediaList.length,
            title: (entry.tab.title || entry.tab.url || '').slice(0,80),
          paused: updated.paused,
          duration: updated.duration,
          currentTime: updated.currentTime,
          percent: updated.rawDuration ? (updated.rawCurrentTime / updated.rawDuration) * 100 : 0,
          preview: false
        });
      }
    } finally {
      GLOBAL_MEDIA.seekAccumDelta = 0;
    }
  }, GLOBAL_MEDIA.seekDebounce);
}

async function accumulateSeek(delta) {
  if (GLOBAL_MEDIA.selectedIndex < 0) return;
  await ensureBaseTime();
  const entry = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
  if (!entry) return;
  GLOBAL_MEDIA.seekAccumDelta += delta;
  const {tab, info} = entry;
  const list = GLOBAL_MEDIA.mediaList;
  const updatedDurRaw = info.rawDuration; // Might be stale; acceptable for preview
  const base = GLOBAL_MEDIA.baseTime != null ? GLOBAL_MEDIA.baseTime : info.rawCurrentTime;
  const previewTime = Math.max(0, base + GLOBAL_MEDIA.seekAccumDelta);
  const percent = updatedDurRaw ? (previewTime / updatedDurRaw) * 100 : 0;
  overlayUpdateOnActive({
    mode:'seek-preview',
    index: GLOBAL_MEDIA.selectedIndex + 1,
    total: list.length,
    title: (tab.title || tab.url || '').slice(0,80),
    paused: info.paused,
    duration: info.duration,
    currentTime: '--:--', // 预览阶段不格式化真实时间
    previewSeconds: previewTime,
    percent,
    preview: true
  });
  scheduleSeekCommit();
}

async function togglePlayGlobal() {
  if (GLOBAL_MEDIA.selectedIndex < 0) return;
  const entry = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
  if (!entry) return;
  const state = await sendToTab(entry.tab.id, {type:'gmcx-get-media-info'});
  if (state && state.ok) {
    if (state.paused) await sendToTab(entry.tab.id, {type:'gmcx-play-media'}); else await sendToTab(entry.tab.id, {type:'gmcx-pause-media'});
    const after = await sendToTab(entry.tab.id, {type:'gmcx-get-media-info'});
    if (after && after.ok) {
      overlayUpdateOnActive({
        mode:'play-toggle',
        index: GLOBAL_MEDIA.selectedIndex + 1,
        total: GLOBAL_MEDIA.mediaList.length,
        title: (entry.tab.title || entry.tab.url || '').slice(0,80),
        paused: after.paused,
        duration: after.duration,
        currentTime: after.currentTime,
        percent: after.rawDuration ? (after.rawCurrentTime / after.rawDuration) * 100 : 0,
        preview: false
      });
    }
  }
}
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;
  // 优先处理全局控制逻辑
  if (command === 'cycle-video') {
    await scanMediaAcrossTabs(true);
    await cycleGlobalSelection();
    return;
  }
  if (['seek-forward','seek-back','toggle-play-pause'].includes(command)) {
    // 确保媒体列表存在（懒加载）
    await scanMediaAcrossTabs();
    if (GLOBAL_MEDIA.selectedIndex >= 0) {
      if (command === 'toggle-play-pause') {
        await togglePlayGlobal();
        return;
      } else if (command === 'seek-forward') {
        await accumulateSeek(+5); // 使用默认 5s，可改为用户配置
        return;
      } else if (command === 'seek-back') {
        await accumulateSeek(-5);
        return;
      }
    }
  }
  // 回落到本页局部控制
  chrome.tabs.sendMessage(tab.id, { type: 'gmcx-command', command });
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