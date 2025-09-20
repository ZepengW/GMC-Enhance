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
  seekStep: 5,
  speedStep: 0.25,
  speedPresets: [0.75, 1, 1.25, 1.5, 2],
  speedPresetIndex: 1,
  forceGlobal: false, // 在用户使用 cycle-video 后强制使用全局控制；未 force 时默认聚焦当前活动标签媒体
  volumeStep: 0.05,
  overlaySeq: 0,
  seekOpId: 0,
  currentSeekOpId: 0
};
// 覆盖层可见期间推送同步（跨标签时启用）
let OVERLAY_WATCH_TIMER = null;

function stopOverlayWatch() {
  if (OVERLAY_WATCH_TIMER) {
    clearInterval(OVERLAY_WATCH_TIMER);
    OVERLAY_WATCH_TIMER = null;
  }
}
async function startOverlayWatch() {
  stopOverlayWatch();
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    const entry = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
    if (!entry || !entry.tab || !entry.tab.id) return;
    // 仅当选中的媒体不在当前活动标签页时，才由后台推送同步，避免与本页 RAF 冲突
    if (active && active.id === entry.tab.id) return;
    OVERLAY_WATCH_TIMER = setInterval(async () => {
      try {
        const info = await sendToTab(entry.tab.id, { type: 'gmcx-get-media-info' });
        if (info && info.ok) {
          overlayUpdateOnActive({
            mode: 'sync',
            index: GLOBAL_MEDIA.selectedIndex + 1,
            total: GLOBAL_MEDIA.mediaList.length,
            title: (entry.tab.title || entry.tab.url || '').slice(0,80),
            paused: info.paused,
            duration: info.duration,
            currentTime: info.currentTime,
            percent: info.rawDuration ? (info.rawCurrentTime / info.rawDuration) * 100 : 0,
            preview: false,
            playbackRate: info.playbackRate,
            volume: info.volume,
            muted: info.muted
          });
        }
      } catch {}
    }, 200);
  } catch {}
}
// 最近是否由 chrome.commands 触发，避免与内容脚本回退重复处理
let LAST_COMMAND_TS = 0;
const COMMAND_SUPPRESS_MS = 300;

// ===== 动态着色图标（代码渲染为红色） =====
const ICON_TINT_CACHE = {
  baseBlob: null,
  baseBitmap: null,
  redImageData: new Map(), // size -> ImageData
  baseImageData: new Map() // size -> ImageData (untinted)
};
async function loadBaseIconBitmap() {
  if (ICON_TINT_CACHE.baseBitmap) return ICON_TINT_CACHE.baseBitmap;
  try {
    const url = chrome.runtime.getURL('icons/icon16.png');
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch icon failed');
    const blob = await res.blob();
    ICON_TINT_CACHE.baseBlob = blob;
    const bmp = await createImageBitmap(blob);
    ICON_TINT_CACHE.baseBitmap = bmp;
    return bmp;
  } catch (e) {
    return null;
  }
}
async function getRedImageData(size) {
  if (ICON_TINT_CACHE.redImageData.has(size)) return ICON_TINT_CACHE.redImageData.get(size);
  try {
    const bmp = await loadBaseIconBitmap();
    if (!bmp) return null;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,size,size);
    // 将 16px 基础图按需缩放绘制
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bmp, 0, 0, size, size);
    // 覆盖红色着色，仅覆盖非透明像素
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = '#e53935';
    ctx.fillRect(0,0,size,size);
    ctx.globalCompositeOperation = 'source-over';
    const imgData = ctx.getImageData(0,0,size,size);
    ICON_TINT_CACHE.redImageData.set(size, imgData);
    return imgData;
  } catch {
    return null;
  }
}
async function getBaseImageData(size) {
  if (ICON_TINT_CACHE.baseImageData.has(size)) return ICON_TINT_CACHE.baseImageData.get(size);
  try {
    const bmp = await loadBaseIconBitmap();
    if (!bmp) return null;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,size,size);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bmp, 0, 0, size, size);
    const imgData = ctx.getImageData(0,0,size,size);
    ICON_TINT_CACHE.baseImageData.set(size, imgData);
    return imgData;
  } catch {
    return null;
  }
}
async function setActionIconModified(tabId, modified) {
  if (!tabId) return;
  try {
    if (modified) {
      const img16 = await getRedImageData(16);
      const img32 = await getRedImageData(32);
      if (img16) {
        const imageData = img32 ? { 16: img16, 32: img32 } : { 16: img16 };
        await chrome.action.setIcon({ tabId, imageData });
        return;
      }
      // 回退到静态红色图
      await chrome.action.setIcon({ tabId, path: { 16: 'icons/icon16_red.png' } });
      return;
    }
    // 默认图标（使用 imageData 覆盖此前的 imageData）
    const b16 = await getBaseImageData(16);
    const b32 = await getBaseImageData(32);
    if (b16) {
      const imageData = b32 ? { 16: b16, 32: b32 } : { 16: b16 };
      await chrome.action.setIcon({ tabId, imageData });
    } else {
      await chrome.action.setIcon({ tabId, path: { 16: 'icons/icon16.png' } });
    }
  } catch {
    // 出错时回退到路径设置
    chrome.action.setIcon({ tabId, path: { 16: modified ? 'icons/icon16_red.png' : 'icons/icon16.png' } });
  }
}

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
  // 为每次覆盖层更新附加递增序号，防止旧消息覆盖新状态
  const seq = ++GLOBAL_MEDIA.overlaySeq;
  chrome.tabs.query({active:true, currentWindow:true}, ([tab]) => {
    if (!tab) return;
    sendToContent(tab.id, {type:'gmcx-global-overlay', action:'update', payload: { ...payload, seq }});
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
        playbackRate: fresh.playbackRate,
        volume: fresh.volume,
        muted: fresh.muted
        // 这里暂未包含 volume/muted，后续同步点会补充
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
        preview: true,
        playbackRate: info.playbackRate,
        volume: info.volume,
        muted: info.muted
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
      preview: true,
      playbackRate: info.playbackRate,
      volume: info.volume,
      muted: info.muted
    });
  }
  GLOBAL_MEDIA.forceGlobal = true; // 用户显式切换后进入全局优先模式
}

async function ensureBaseTime(opId) {
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
      playbackRate: updated.playbackRate,
      volume: updated.volume,
      muted: updated.muted,
      opId
    });
  }
}

function scheduleSeekCommit() {
  clearTimeout(GLOBAL_MEDIA.seekAccumTimer);
  GLOBAL_MEDIA.seekAccumTimer = setTimeout(async () => {
    if (!GLOBAL_MEDIA.seekAccumDelta) return;
    const entry = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
    if (!entry) { GLOBAL_MEDIA.seekAccumDelta = 0; return; }
    const opId = GLOBAL_MEDIA.currentSeekOpId;
    try {
      // 使用绝对目标时间提交，避免在累计期间播放进度造成的偏移
      let targetSec = (GLOBAL_MEDIA.baseTime != null ? GLOBAL_MEDIA.baseTime : (entry.info?.rawCurrentTime || 0)) + GLOBAL_MEDIA.seekAccumDelta;
      targetSec = Math.max(0, Number(targetSec));
      await sendToTab(entry.tab.id, { type:'gmcx-set-media-currentTime', value: targetSec, silent: true });
      const updated = await sendToTab(entry.tab.id, {type:'gmcx-get-media-info'});
      if (updated && updated.ok) {
        GLOBAL_MEDIA.baseTime = updated.rawCurrentTime;
        // 提交后将媒体信息写回列表，减少下次使用陈旧 info 的概率
        entry.info = {
          paused: updated.paused,
          duration: updated.duration,
          currentTime: updated.currentTime,
          rawCurrentTime: updated.rawCurrentTime,
          rawDuration: updated.rawDuration,
          playbackRate: updated.playbackRate,
          volume: updated.volume,
          muted: updated.muted
        };
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
          playbackRate: updated.playbackRate,
          volume: updated.volume,
          muted: updated.muted,
          opId
        });
        // 若覆盖层仍显示在其他标签上，启动后台推送，保障实时同步
        startOverlayWatch();
      }
    } finally {
      GLOBAL_MEDIA.seekAccumDelta = 0;
    }
  }, GLOBAL_MEDIA.seekDebounce);
}

async function accumulateSeek(delta) {
  if (GLOBAL_MEDIA.selectedIndex < 0) return;
  // 新的 seek 会话：当累计量为 0 时分配操作 ID
  if (GLOBAL_MEDIA.seekAccumDelta === 0) {
    GLOBAL_MEDIA.currentSeekOpId = ++GLOBAL_MEDIA.seekOpId;
    // 强制刷新基准时间与缓存 info，避免使用过期基准
    const entry0 = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
    if (entry0) {
      try {
        const latest = await sendToTab(entry0.tab.id, { type: 'gmcx-get-media-info' });
        if (latest && latest.ok) {
          GLOBAL_MEDIA.baseTime = latest.rawCurrentTime;
          entry0.info = {
            paused: latest.paused,
            duration: latest.duration,
            currentTime: latest.currentTime,
            rawCurrentTime: latest.rawCurrentTime,
            rawDuration: latest.rawDuration,
            playbackRate: latest.playbackRate,
            volume: latest.volume,
            muted: latest.muted
          };
        } else {
          // 情况不明，置空以便 ensureBaseTime 再次获取
          GLOBAL_MEDIA.baseTime = null;
        }
      } catch {
        GLOBAL_MEDIA.baseTime = null;
      }
    }
  }
  const opId = GLOBAL_MEDIA.currentSeekOpId;
  await ensureBaseTime(opId);
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
    currentTime: info.currentTime,
    previewSeconds: previewTime,
    percent,
    preview: true,
    playbackRate: info.playbackRate,
    volume: info.volume,
    muted: info.muted,
    opId
  });
  // 预览开始时也尝试启动后台推送（跨标签情形会生效）
  startOverlayWatch();
  scheduleSeekCommit();
}

async function togglePlayGlobal() {
  if (GLOBAL_MEDIA.selectedIndex < 0) return;
  const entry = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
  if (!entry) return;
  const state = await sendToTab(entry.tab.id, {type:'gmcx-get-media-info'});
  if (state && state.ok) {
    if (state.paused) await sendToTab(entry.tab.id, {type:'gmcx-play-media', silent: true}); else await sendToTab(entry.tab.id, {type:'gmcx-pause-media', silent: true});
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
        playbackRate: after.playbackRate,
        volume: after.volume,
        muted: after.muted
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
    await sendToTab(entry.tab.id, {type:'gmcx-unmute-media', silent:true});
  } else {
    await sendToTab(entry.tab.id, {type:'gmcx-mute-media', silent:true});
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
      playbackRate: after.playbackRate,
      volume: after.volume,
      muted: after.muted
    });
  }
}

async function applyPlaybackRate(rate) {
  if (GLOBAL_MEDIA.selectedIndex < 0) return;
  const entry = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
  if (!entry) return;
    await sendToTab(entry.tab.id, {type:'gmcx-set-media-speed', value: rate, silent: true});
  // 抑制本地覆盖层，统一使用全局覆盖层
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
      playbackRate: after.playbackRate,
      volume: after.volume,
      muted: after.muted
    });
  }
}

// ===== 新增：音量控制 =====
async function applyVolume(vol) {
  if (GLOBAL_MEDIA.selectedIndex < 0) return;
  vol = Math.min(1, Math.max(0, Number(vol)));
  const entry = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
  if (!entry) return;
  await sendToTab(entry.tab.id, {type:'gmcx-set-media-volume', value: vol, silent: true});
  const after = await sendToTab(entry.tab.id, {type:'gmcx-get-media-info'});
  if (after && after.ok) {
    overlayUpdateOnActive({
      mode:'volume-set',
      index: GLOBAL_MEDIA.selectedIndex + 1,
      total: GLOBAL_MEDIA.mediaList.length,
      title: (entry.tab.title || entry.tab.url || '').slice(0,80),
      paused: after.paused,
      duration: after.duration,
      currentTime: after.currentTime,
      percent: after.rawDuration ? (after.rawCurrentTime / after.rawDuration) * 100 : 0,
      preview: false,
      playbackRate: after.playbackRate,
      volume: after.volume,
      muted: after.muted
    });
  }
}
async function adjustVolume(delta) {
  if (GLOBAL_MEDIA.selectedIndex < 0) return;
  const entry = GLOBAL_MEDIA.mediaList[GLOBAL_MEDIA.selectedIndex];
  if (!entry) return;
  const info = await sendToTab(entry.tab.id, {type:'gmcx-get-media-info'});
  if (!info || !info.ok) return;
  let next = (info.volume != null ? info.volume : 1) + delta;
  next = Math.min(1, Math.max(0, Number(next.toFixed(3))));
  await applyVolume(next);
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
  chrome.storage.sync.get({ seekStep: 5, speedStep: 0.25, volumeStep: 0.05 }, (cfg) => {
    const sstep = Number(cfg.seekStep);
    if (sstep && sstep > 0) GLOBAL_MEDIA.seekStep = sstep;
    const step = Number(cfg.speedStep);
    if (step && step > 0) GLOBAL_MEDIA.speedStep = step;
    const vstep = Number(cfg.volumeStep);
    if (vstep && vstep > 0 && vstep <= 0.5) GLOBAL_MEDIA.volumeStep = vstep;
  });
}
loadSpeedSettings();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.speedStep) {
    const nv = Number(changes.speedStep.newValue);
    if (nv && nv > 0) GLOBAL_MEDIA.speedStep = nv;
  }
  if (area === 'sync' && changes.volumeStep) {
    const nv = Number(changes.volumeStep.newValue);
    if (nv && nv > 0 && nv <= 0.5) GLOBAL_MEDIA.volumeStep = nv;
  }
  if (area === 'sync' && changes.seekStep) {
    const nv = Number(changes.seekStep.newValue);
    if (nv && nv > 0) GLOBAL_MEDIA.seekStep = nv;
  }
});
// ===== 根据页面存储的 EQ 记忆设置图标（无需依赖弹出页/点击） =====
function eqPageKeyFromUrl(url) {
  try {
    const u = new URL(url);
    return 'eqMem:' + u.origin + u.pathname;
  } catch {
    return null;
  }
}
function checkModifiedFromStored(val) {
  const gains = val && Array.isArray(val.gains) ? val.gains : null;
  if (!gains || !gains.length) return false;
  return gains.some(v => Math.abs(Number(v)||0) > 0.0001);
}
function updateIconForTabByUrl(tabId, url) {
  const key = eqPageKeyFromUrl(url);
  if (!key) { setActionIconModified(tabId, false); return; }
  chrome.storage.local.get([key], (obj) => {
    const modified = checkModifiedFromStored(obj[key]);
    setActionIconModified(tabId, modified);
  });
}
chrome.tabs.onActivated.addListener(({tabId}) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    updateIconForTabByUrl(tabId, tab.url || '');
  });
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    updateIconForTabByUrl(tabId, (tab && tab.url) || changeInfo.url || '');
  }
});
chrome.runtime.onStartup.addListener(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) updateIconForTabByUrl(tab.id, tab.url || '');
  } catch {}
});
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab && tab.id) updateIconForTabByUrl(tab.id, tab.url || '');
  } catch {}
});
// 若存储中的 EQ 记忆发生变化，尝试更新当前活动标签页的图标
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes || {});
  if (!keys.some(k => k.startsWith('eqMem:'))) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) updateIconForTabByUrl(tab.id, tab.url || '');
  } catch {}
});
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
chrome.commands.onCommand.addListener(async (command) => {
  LAST_COMMAND_TS = Date.now();
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
    if (command === 'seek-forward') { await accumulateSeek(+GLOBAL_MEDIA.seekStep); return; }
    if (command === 'seek-back') { await accumulateSeek(-GLOBAL_MEDIA.seekStep); return; }
  }
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'gmcx-control') {
    (async () => {
      const { action, tabId, value } = msg;
      await scanMediaAcrossTabs();
      const idx = GLOBAL_MEDIA.mediaList.findIndex(e => e.tab && e.tab.id === tabId);
      if (idx < 0) { sendResponse && sendResponse({ ok: false, reason: 'tab-not-found' }); return; }
      GLOBAL_MEDIA.selectedIndex = idx;
      const entry = GLOBAL_MEDIA.mediaList[idx];
      if (!entry) { sendResponse && sendResponse({ ok:false }); return; }
      const tid = entry.tab.id;
      const getInfo = async () => await sendToTab(tid, {type:'gmcx-get-media-info'});
      const pushOverlay = (info, mode) => {
        if (!info || !info.ok) return;
        overlayUpdateOnActive({
          mode: mode || 'update',
          index: GLOBAL_MEDIA.selectedIndex + 1,
          total: GLOBAL_MEDIA.mediaList.length,
          title: (entry.tab.title || entry.tab.url || '').slice(0,80),
          paused: info.paused,
          duration: info.duration,
          currentTime: info.currentTime,
          percent: info.rawDuration ? (info.rawCurrentTime / info.rawDuration) * 100 : 0,
          preview: false,
          playbackRate: info.playbackRate,
          volume: info.volume,
          muted: info.muted
        });
      };
      try {
        if (action === 'play-toggle') {
          const st = await getInfo();
          if (st && st.ok) {
            if (st.paused) await sendToTab(tid, {type:'gmcx-play-media', silent:true});
            else await sendToTab(tid, {type:'gmcx-pause-media', silent:true});
            const after = await getInfo();
            pushOverlay(after, 'play-toggle');
            sendResponse && sendResponse({ ok:true }); return;
          }
        }
        if (action === 'seek-delta') {
          await sendToTab(tid, {type:'gmcx-seek-media', value: Number(value) || 0, silent:true});
          const after = await getInfo();
          // 更新基准，避免下一次使用旧时间
          if (after && after.ok) {
            GLOBAL_MEDIA.baseTime = after.rawCurrentTime;
            entry.info = after;
          }
          pushOverlay(after, 'final');
          sendResponse && sendResponse({ ok:true }); return;
        }
        if (action === 'set-currentTime') {
          await sendToTab(tid, {type:'gmcx-set-media-currentTime', value: Number(value) || 0, silent:true});
          const after = await getInfo();
          pushOverlay(after, 'final');
          sendResponse && sendResponse({ ok:true }); return;
        }
        if (action === 'set-speed') {
          await sendToTab(tid, {type:'gmcx-set-media-speed', value: Number(value) || 1, silent:true});
          const after = await getInfo();
          pushOverlay(after, 'speed-set');
          sendResponse && sendResponse({ ok:true }); return;
        }
        if (action === 'set-volume') {
          await sendToTab(tid, {type:'gmcx-set-media-volume', value: Math.max(0, Math.min(1, Number(value) || 0)), silent:true});
          const after = await getInfo();
          pushOverlay(after, 'volume-set');
          sendResponse && sendResponse({ ok:true }); return;
        }
        if (action === 'toggle-mute') {
          const st = await getInfo();
          if (st && st.ok) {
            if (st.muted) await sendToTab(tid, {type:'gmcx-unmute-media', silent:true});
            else await sendToTab(tid, {type:'gmcx-mute-media', silent:true});
            const after = await getInfo();
            pushOverlay(after, 'mute-toggle');
            sendResponse && sendResponse({ ok:true }); return;
          }
        }
        sendResponse && sendResponse({ ok:false });
      } catch (e) {
        sendResponse && sendResponse({ ok:false, error: String(e) });
      }
    })();
    return true; // async
  }
  if (msg?.type === 'gmcx-command') {
    // 若刚刚由 chrome.commands 触发过，则忽略内容脚本的回退请求，防止重复执行
    if (Date.now() - LAST_COMMAND_TS < COMMAND_SUPPRESS_MS) { sendResponse && sendResponse({ ok: false, suppressed: true }); return; }
    (async () => {
      const tab = await getActiveTab();
      if (!tab || !tab.id) { sendResponse && sendResponse({ ok: false }); return; }
      const command = msg.command;
      if (command === 'cycle-video') {
        await scanMediaAcrossTabs(true);
        await cycleGlobalSelection();
        sendResponse && sendResponse({ ok: true });
        return;
      }
      if (['seek-forward','seek-back','toggle-play-pause'].includes(command)) {
        await scanMediaAcrossTabs();
        await ensureActiveSelection(tab.id);
        if (GLOBAL_MEDIA.selectedIndex < 0) { sendResponse && sendResponse({ ok: false }); return; }
        if (command === 'toggle-play-pause') { await togglePlayGlobal(); sendResponse && sendResponse({ ok: true }); return; }
        if (command === 'seek-forward') { await accumulateSeek(+GLOBAL_MEDIA.seekStep); sendResponse && sendResponse({ ok: true }); return; }
        if (command === 'seek-back') { await accumulateSeek(-GLOBAL_MEDIA.seekStep); sendResponse && sendResponse({ ok: true }); return; }
      }
      sendResponse && sendResponse({ ok: false });
    })();
    return true; // async
  }
  if (msg?.type === 'gmcx-eq-modified-state') {
    const tabId = sender?.tab?.id;
    if (tabId) setActionIconModified(tabId, !!msg.modified);
    sendResponse && sendResponse({ok:true});
    return; // not async
  }
  if (msg?.type === 'gmcx-update-icon-for-tab') {
    const tabId = msg.tabId;
    if (typeof tabId === 'number') {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) { sendResponse && sendResponse({ok:false}); return; }
        updateIconForTabByUrl(tabId, tab.url || '');
        sendResponse && sendResponse({ok:true});
      });
      return true; // async response
    }
    sendResponse && sendResponse({ok:false});
    return; // not async
  }
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
    // 下次开始新的 seek 时强制重新同步基准
    GLOBAL_MEDIA.baseTime = null;
    // 结束后台推送
    stopOverlayWatch();
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
  if (msg?.type === 'gmcx-global-volume') {
    (async () => {
      const activeTab = await getActiveTab();
      await scanMediaAcrossTabs();
      await ensureActiveSelection(activeTab?.id);
      if (GLOBAL_MEDIA.selectedIndex < 0) { sendResponse({ok:false}); return; }
      if (msg.action === 'up') { await adjustVolume(+GLOBAL_MEDIA.volumeStep); sendResponse({ok:true}); return; }
      if (msg.action === 'down') { await adjustVolume(-GLOBAL_MEDIA.volumeStep); sendResponse({ok:true}); return; }
      sendResponse({ok:false});
    })();
    return true;
  }
});