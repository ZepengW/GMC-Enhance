chrome.runtime.onInstalled.addListener(() => {});

// =============================
// 统一说明（2025-09 调整）：
// 之前存在两套概念：
//  A: 可在多个标签之间切换的“全局”悬浮控制卡片
//  B: 当前页面（活动标签）本地视频的控制卡片
// 需求：合并成单一界面逻辑 A，同时在“未显式全局切换”时，默认聚焦当前活动标签页上的媒体，
//      只有用户使用 cycle-video（快捷键/命令）之后才进入强制全局循环模式 (forceGlobal=true)。
// 本文件的改动实现：
//  1) 添加 ensureActiveSelection：在非强制全局模式下刷新媒体列表后，会把 selectedIndex 自动指向当前活动标签页媒体。
//  2) chrome.commands 里 seek / play / pause 等命令不再区分“本地”与“全局”两套分支，统一走 GLOBAL_MEDIA 列表。
//  3) toggle mute 消息同样统一逻辑。
//  4) 覆盖层展示（由 content.js 复用 fine overlay 结构）保持一致，不再出现两种卡片风格。
// =============================

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
  pendingRefreshAfterSwitch: false,
  speedStep: 0.25,
  speedPresets: [0.75, 1, 1.25, 1.5, 2],
  speedPresetIndex: 1,
  forceGlobal: false // 在用户使用 cycle-video 后强制使用全局控制；未 force 时默认聚焦当前活动标签媒体
};

/**
 * 在未进入强制全局模式 (forceGlobal=false) 时，尝试把当前活动标签页内的媒体
 * 设置为 GLOBAL_MEDIA.selectedIndex ，以实现“同一套界面逻辑 A 默认聚焦当前页面媒体”。
 * 若当前活动页没有媒体，则保持之前的选择（如果有）。
 */
async function ensureActiveSelection(activeTabId) {
  if (GLOBAL_MEDIA.forceGlobal) return; // 用户显式全局循环后不再自动跳回
  if (!GLOBAL_MEDIA.mediaList.length) return;
  if (GLOBAL_MEDIA.selectedIndex >= 0) {
    const cur = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
    if (cur && cur.tab && cur.tab.id === activeTabId) return; // 已是当前活动标签
  }
  const idx = GLOBAL_MEDIA.mediaList.findIndex(e => e.tab && e.tab.id === activeTabId);
  if (idx >= 0) {
    GLOBAL_MEDIA.selectedIndex = idx;
    GLOBAL_MEDIA.baseTime = null; // 重新同步基准
  }
}

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
  // 立即尝试获取最新状态（而不是使用占位），提升直观性
  try {
    const fresh = await sendToTab(tab.id, {type:'gmcx-get-media-info'});
    if (fresh && fresh.ok) {
      overlayUpdateOnActive({
        mode:'select',
        index: GLOBAL_MEDIA.selectedIndex + 1,
        total: list.length,
        title: (tab.title || tab.url || '').slice(0,80),
        paused: fresh.paused,
        duration: fresh.duration,
        currentTime: fresh.currentTime,
        percent: fresh.rawDuration ? (fresh.rawCurrentTime / fresh.rawDuration) * 100 : 0,
        preview: false,
        playbackRate: fresh.playbackRate
      });
      GLOBAL_MEDIA.baseTime = fresh.rawCurrentTime; // 直接设置基准
    } else {
      overlayUpdateOnActive({
        mode:'select',
        index: GLOBAL_MEDIA.selectedIndex + 1,
        total: list.length,
        title: (tab.title || tab.url || '').slice(0,80),
        paused: info.paused,
        duration: info.duration,
        currentTime: '--:--',
        percent: 0,
        preview: true
      });
    }
  } catch {
    overlayUpdateOnActive({
      mode:'select',
      index: GLOBAL_MEDIA.selectedIndex + 1,
      total: list.length,
      title: (tab.title || tab.url || '').slice(0,80),
      paused: info.paused,
      duration: info.duration,
      currentTime: '--:--',
      percent: 0,
      preview: true
    });
  }
  GLOBAL_MEDIA.forceGlobal = true; // 用户显式切换后进入全局优先模式
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
      preview: false,
      playbackRate: updated.playbackRate
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
          preview: false,
          playbackRate: updated.playbackRate
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
        preview: false,
        playbackRate: after.playbackRate
      });
    }
  }
}

async function toggleMuteGlobal() {
  if (GLOBAL_MEDIA.selectedIndex < 0) return;
  const entry = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
  if (!entry) return;
  const state = await sendToTab(entry.tab.id, {type:'gmcx-get-media-info'});
  if (!state || !state.ok) return;
  if (state.muted) {
    await sendToTab(entry.tab.id, {type:'gmcx-unmute-media'});
  } else {
    await sendToTab(entry.tab.id, {type:'gmcx-mute-media'});
  }
  const after = await sendToTab(entry.tab.id, {type:'gmcx-get-media-info'});
  if (after && after.ok) {
    overlayUpdateOnActive({
      mode:'mute-toggle',
      index: GLOBAL_MEDIA.selectedIndex + 1,
      total: GLOBAL_MEDIA.mediaList.length,
      title: (entry.tab.title || entry.tab.url || '').slice(0,80),
      paused: after.paused,
      duration: after.duration,
      currentTime: after.currentTime,
      percent: after.rawDuration ? (after.rawCurrentTime / after.rawDuration) * 100 : 0,
      preview: false,
      playbackRate: after.playbackRate
    });
  }
}

async function applyPlaybackRate(rate) {
  if (GLOBAL_MEDIA.selectedIndex < 0) return;
  const entry = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
  if (!entry) return;
  await sendToTab(entry.tab.id, {type:'gmcx-set-media-speed', value: rate});
  const after = await sendToTab(entry.tab.id, {type:'gmcx-get-media-info'});
  if (after && after.ok) {
    overlayUpdateOnActive({
      mode:'speed-set',
      index: GLOBAL_MEDIA.selectedIndex + 1,
      total: GLOBAL_MEDIA.mediaList.length,
      title: (entry.tab.title || entry.tab.url || '').slice(0,80),
      paused: after.paused,
      duration: after.duration,
      currentTime: after.currentTime,
      percent: after.rawDuration ? (after.rawCurrentTime / after.rawDuration) * 100 : 0,
      preview: false,
      playbackRate: after.playbackRate
    });
  }
}

async function adjustPlaybackRate(delta) {
  if (GLOBAL_MEDIA.selectedIndex < 0) return;
  const entry = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
  if (!entry) return;
  const info = await sendToTab(entry.tab.id, {type:'gmcx-get-media-info'});
  if (!info || !info.ok) return;
  let next = (info.playbackRate || 1) + delta;
  next = Math.min(16, Math.max(0.06, Number(next.toFixed(2))));
  await applyPlaybackRate(next);
}

async function cyclePlaybackPreset() {
  if (GLOBAL_MEDIA.selectedIndex < 0) return;
  GLOBAL_MEDIA.speedPresetIndex = (GLOBAL_MEDIA.speedPresetIndex + 1) % GLOBAL_MEDIA.speedPresets.length;
  const target = GLOBAL_MEDIA.speedPresets[GLOBAL_MEDIA.speedPresetIndex];
  await applyPlaybackRate(target);
}

function loadSpeedSettings() {
  chrome.storage.sync.get({ speedStep: 0.25 }, (cfg) => {
    const step = Number(cfg.speedStep);
    if (step && step > 0) GLOBAL_MEDIA.speedStep = step;
  });
}
loadSpeedSettings();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.speedStep) {
    const nv = Number(changes.speedStep.newValue);
    if (nv && nv > 0) GLOBAL_MEDIA.speedStep = nv;
  }
});
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;
  // 统一逻辑：所有命令先刷新媒体列表，再根据 forceGlobal / 当前活动页自动聚焦，使用同一套 A 覆盖层
  if (command === 'cycle-video') {
    await scanMediaAcrossTabs(true);
    await cycleGlobalSelection(); // cycle 会设置 forceGlobal=true
    return;
  }
  if (['seek-forward','seek-back','toggle-play-pause'].includes(command)) {
    await scanMediaAcrossTabs();
    await ensureActiveSelection(tab.id); // 在非全局模式下优先当前活动标签媒体
    if (GLOBAL_MEDIA.selectedIndex < 0) return; // 没有媒体则直接忽略
    if (command === 'toggle-play-pause') { await togglePlayGlobal(); return; }
    if (command === 'seek-forward') { await accumulateSeek(+5); return; }
    if (command === 'seek-back') { await accumulateSeek(-5); return; }
  }
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
  if (msg?.type === 'gmcx-global-speed') {
    (async () => {
      await scanMediaAcrossTabs();
      if (GLOBAL_MEDIA.selectedIndex < 0) { sendResponse({ok:false}); return; }
      if (msg.action === 'up') { await adjustPlaybackRate(+GLOBAL_MEDIA.speedStep); sendResponse({ok:true}); return; }
      if (msg.action === 'down') { await adjustPlaybackRate(-GLOBAL_MEDIA.speedStep); sendResponse({ok:true}); return; }
      if (msg.action === 'reset') { await applyPlaybackRate(1); sendResponse({ok:true}); return; }
      if (msg.action === 'cycle') { await cyclePlaybackPreset(); sendResponse({ok:true}); return; }
      sendResponse({ok:false});
    })();
    return true;
  }
  if (msg?.type === 'gmcx-overlay-hidden') {
    // 覆盖层隐藏后恢复为本地优先模式
    GLOBAL_MEDIA.forceGlobal = false;
    sendResponse && sendResponse({ok:true});
    return; // 不需要异步
  }
  if (msg?.type === 'gmcx-toggle-mute') {
    (async () => {
      const activeTab = await getActiveTab();
      if (!activeTab || !activeTab.id) { sendResponse({ok:false}); return; }
      // 统一：刷新并自动聚焦到当前活动标签的媒体（若未 forceGlobal ）
      await scanMediaAcrossTabs();
      await ensureActiveSelection(activeTab.id);
      if (GLOBAL_MEDIA.selectedIndex < 0) { sendResponse({ok:false}); return; }
      await toggleMuteGlobal();
      sendResponse({ok:true, scope: GLOBAL_MEDIA.forceGlobal ? 'global' : 'active-auto'});
    })();
    return true; // async
  }
});