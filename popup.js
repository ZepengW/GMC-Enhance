
function sendToTab(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, resolve);
  });
}

// 时间格式化，与 content.js 保持一致（必要时可抽取共用）
function formatTimeLocal(t) {
  if (!isFinite(t)) return '--:--';
  t = Math.floor(t);
  const s = t % 60, m = Math.floor((t / 60) % 60), h = Math.floor(t / 3600);
  if (h) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

async function getAllMediaInfo() {
  return new Promise((resolve) => {
    chrome.tabs.query({}, async (tabs) => {
      const results = [];
      for (const tab of tabs) {
        const info = await sendToTab(tab.id, {type: 'gmcx-get-media-info'});
        if (info && info.ok) {
          results.push({tab, info});
        }
      }
      resolve(results);
    });
  });
}

function formatTabTitle(tab) {
  let title = tab.title || tab.url;
  if (title.length > 32) title = title.slice(0, 32) + '...';
  return title;
}

// 正在被用户拖动进度条的 tabId 集合（锁）
const seekLocks = new Set();
// 快进/快退点击累积：记录 { tabId: { pending:number, timer:TimeoutID, base:number } }
const seekAccum = new Map();
// 累积提交延迟（毫秒）——在此时间内继续点击会继续累加，不会真正发送 seek
const SEEK_ACCUM_DEBOUNCE = 480; // 可按需调整

function renderMediaList(mediaList) {
  const container = document.getElementById('media-list');
  container.innerHTML = '';
  if (!mediaList.length) {
    container.innerHTML = '<div id="no-media">未检测到任何标签页的音视频</div>';
    return;
  }
  for (const {tab, info} of mediaList) {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.dataset.tabId = tab.id; // 用于后续刷新时定位
    // 缩略图（仅视频）
    let thumbHtml = '';
    if (info.type === 'video') {
      // 优先 info.thumbnail，其次尝试 poster，无则不显示
      let thumbSrc = info.thumbnail || info.poster || '';
      if (thumbSrc) {
        thumbHtml = `<img class="media-thumb" src="${thumbSrc}" alt="缩略图" onerror="this.style.display='none'">`;
      } else {
        thumbHtml = '';
      }
    }
    // 控件区
    card.innerHTML = `
      <div class="media-header">
        ${thumbHtml}
        <span class="media-type">${info.type === 'video' ? '🎬 视频' : '🎵 音频'}</span>
        <span class="media-state">${info.paused ? '⏸ 暂停' : '▶ 播放'}</span>
      </div>
      <div class="media-title" title="${tab.title}">${formatTabTitle(tab)}</div>
      <div class="media-controls">
        <button class="media-btn media-play">${info.paused ? '▶' : '⏸'}</button>
        <button class="media-btn media-back">⏪</button>
        <button class="media-btn media-forward">⏩</button>
        <select class="media-speed">
          <option value="0.5">0.5x</option>
          <option value="0.75">0.75x</option>
          <option value="1" selected>1x</option>
          <option value="1.25">1.25x</option>
          <option value="1.5">1.5x</option>
          <option value="2">2x</option>
          <option value="custom">自定义</option>
        </select>
        <input class="media-speed-custom" type="number" min="0.1" max="10" step="0.05" style="width:50px;display:none;" placeholder="倍速" />
  <button class="media-btn media-reset" title="重置为1倍速">1x</button>
      </div>
      <div class="media-progress">
        <span class="media-time">${info.currentTime}</span> / <span class="media-duration">${info.duration}</span>
      </div>
      <input type="range" class="seek-bar" min="0" max="${info.rawDuration}" value="${info.rawCurrentTime}" step="0.01" ${!isFinite(info.rawDuration) ? 'disabled' : ''}>
    `;
    // 控件事件
    // 播放/暂停
    card.querySelector('.media-play').addEventListener('click', async () => {
      // 重新获取最新状态，确保切换正确
      const updated = await sendToTab(tab.id, {type: 'gmcx-get-media-info'});
      if (updated && updated.ok) {
        if (updated.paused) {
          await sendToTab(tab.id, {type: 'gmcx-play-media'});
        } else {
          await sendToTab(tab.id, {type: 'gmcx-pause-media'});
        }
        refreshMediaList();
      }
    });
    // 前进/后退（点击累积逻辑）
  const backBtn = card.querySelector('.media-back');
  const fwdBtn = card.querySelector('.media-forward');
  const getSeekBar = () => card.querySelector('.seek-bar');
  const getTimeEl = () => card.querySelector('.media-time');

    function scheduleSeekCommit(tabId) {
      const entry = seekAccum.get(tabId);
      if (!entry) return;
      clearTimeout(entry.timer);
      entry.timer = setTimeout(async () => {
        // 提交阶段：上锁，发送最终 seek，然后刷新
        const delta = entry.pending;
        seekAccum.delete(tabId);
        if (delta === 0) return;
        // 发送 seek（使用 gmcx-seek-media 增量跳转）
        await sendToTab(tabId, {type: 'gmcx-seek-media', value: delta});
        // 解锁预览，刷新真实信息
        refreshMediaList(false);
      }, SEEK_ACCUM_DEBOUNCE);
    }

    function accumulateSeek(tabId, delta) {
      // 如果正在拖动进度条，则直接忽略按钮操作（避免逻辑冲突）
      if (seekLocks.has(String(tabId))) return;
      let entry = seekAccum.get(tabId);
      if (!entry) {
        // 以当前渲染时的 rawCurrentTime 作为基准
        const currentRaw = Number(card.querySelector('.seek-bar')?.value || 0);
        entry = { pending: 0, timer: null, base: currentRaw };
        seekAccum.set(tabId, entry);
      }
      entry.pending += delta;
      // 预览：本地更新 seekBar 与时间（不发送消息）
  const sb = getSeekBar();
      if (sb) {
        const duration = Number(sb.max) || entry.base + entry.pending; // 防止 NaN
        let preview = entry.base + entry.pending;
        if (isFinite(duration)) preview = Math.min(Math.max(0, preview), duration);
        sb.value = preview;
  const tEl = getTimeEl();
        if (tEl) tEl.textContent = formatTimeLocal(preview);
      }
      scheduleSeekCommit(tabId);
    }

    backBtn.addEventListener('click', () => accumulateSeek(tab.id, -10));
    fwdBtn.addEventListener('click', () => accumulateSeek(tab.id, 10));
    // 倍速选择
    const speedSelect = card.querySelector('.media-speed');
    const speedCustom = card.querySelector('.media-speed-custom');
    // 判断是否为自定义倍速
    if ([0.5,0.75,1,1.25,1.5,2].includes(info.playbackRate)) {
      speedSelect.value = String(info.playbackRate);
      speedSelect.style.display = '';
      speedCustom.style.display = 'none';
    } else {
      // 隐藏下拉栏，仅显示自定义倍速输入框（只读）
      speedSelect.style.display = 'none';
      speedCustom.style.display = '';
      speedCustom.value = info.playbackRate?.toFixed(2) || '';
      speedCustom.readOnly = true;
    }
    speedSelect.addEventListener('change', async (e) => {
      if (e.target.value === 'custom') {
        // 隐藏下拉栏，显示自定义输入框（可编辑）
        speedSelect.style.display = 'none';
        speedCustom.style.display = '';
        speedCustom.value = info.playbackRate || '';
        speedCustom.readOnly = false;
        speedCustom.focus();
      } else {
        speedCustom.style.display = 'none';
        speedSelect.style.display = '';
        await sendToTab(tab.id, {type: 'gmcx-set-media-speed', value: Number(e.target.value)});
        refreshMediaList();
      }
    });
    speedCustom.addEventListener('change', async (e) => {
      const val = Number(e.target.value);
      if (val >= 0.1 && val <= 10) {
        await sendToTab(tab.id, {type: 'gmcx-set-media-speed', value: val});
        // 设置完毕后，仅显示自定义倍速输入框（只读）
        speedCustom.style.display = '';
        speedCustom.value = val.toFixed(2);
        speedCustom.readOnly = true;
        speedSelect.style.display = 'none';
        refreshMediaList();
      }
    });
    // 重置
    card.querySelector('.media-reset').addEventListener('click', async () => {
      // 只重置倍速为1倍速
      await sendToTab(tab.id, {type: 'gmcx-set-media-speed', value: 1.0});
      // 下拉栏恢复显示，自定义输入框消失
      speedCustom.style.display = 'none';
      speedSelect.style.display = '';
      speedSelect.value = '1';
      let customOption = speedSelect.querySelector('option[value="custom"]');
      if (customOption) customOption.textContent = '自定义';
      refreshMediaList();
    });
    // 进度条（增加拖动锁逻辑）
    const seekBar = card.querySelector('.seek-bar');
    const timeEl = card.querySelector('.media-time');

    let dragging = false; // 仅在该组件生命周期内的局部状态

    const startDrag = () => {
      dragging = true;
      seekLocks.add(String(tab.id));
    };
    const endDrag = async (finalVal) => {
      if (!dragging) return;
      try {
        await sendToTab(tab.id, {type: 'gmcx-set-media-currentTime', value: finalVal});
        // 松开后立即获取一次最新状态（精确同步）
        const updated = await sendToTab(tab.id, {type: 'gmcx-get-media-info'});
        if (updated && updated.ok) {
          timeEl.textContent = updated.currentTime;
          seekBar.value = updated.rawCurrentTime;
        }
      } finally {
        dragging = false;
        seekLocks.delete(String(tab.id));
        // 释放锁后刷新整个列表该卡片其余状态（避免拖动期间错过的暂停/播放变化）
        refreshMediaList(false);
      }
    };

    // PC 鼠标事件
    seekBar.addEventListener('mousedown', () => startDrag());
    // 拖动中仅本地更新显示，不发送消息
    seekBar.addEventListener('input', (e) => {
      if (dragging) {
        const val = Number(e.target.value);
        timeEl.textContent = formatTimeLocal(val);
      }
    });
    // mouseup 可能发生在窗口内或外，绑定 window 以确保释放
    const mouseupHandler = (e) => {
      if (!dragging) return;
      // 最终值
      const finalVal = Number(seekBar.value);
      endDrag(finalVal);
    };
    window.addEventListener('mouseup', mouseupHandler);
    // Touch 事件（预防触摸设备）
    seekBar.addEventListener('touchstart', () => startDrag(), {passive: true});
    seekBar.addEventListener('touchmove', (e) => {
      if (dragging) {
        const val = Number(seekBar.value);
        timeEl.textContent = formatTimeLocal(val);
      }
    }, {passive: true});
    seekBar.addEventListener('touchend', () => {
      if (dragging) {
        const finalVal = Number(seekBar.value);
        endDrag(finalVal);
      }
    });
    // 在卡片被移除时清理事件（自动随 DOM 移除，但保险处理 window 事件）
    const observer = new MutationObserver(() => {
      if (!document.contains(card)) {
        window.removeEventListener('mouseup', mouseupHandler);
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, {childList: true, subtree: true});
    container.appendChild(card);
  }
}

let lastMediaList = [];
let refreshTimer = null;

function shallowEqualMediaList(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].tab.id !== b[i].tab.id) return false;
  }
  return true;
}

async function refreshMediaList(full = false) {
  const mediaList = await getAllMediaInfo();
  if (full || !shallowEqualMediaList(mediaList, lastMediaList)) {
    renderMediaList(mediaList);
    lastMediaList = mediaList;
  } else {
    const container = document.getElementById('media-list');
    const cards = Array.from(container.querySelectorAll('.media-card'));
    mediaList.forEach(({tab, info}) => {
      const card = cards.find(c => c.dataset.tabId === String(tab.id));
      if (!card) return;
      const locked = seekLocks.has(String(tab.id));
      // 若该卡片在拖动锁中，跳过时间与进度条更新，避免冲突
      if (!locked) {
        card.querySelector('.media-time').textContent = info.currentTime;
        card.querySelector('.media-duration').textContent = info.duration;
        const seekBar = card.querySelector('.seek-bar');
        if (seekBar) seekBar.value = info.rawCurrentTime;
      }
      // 播放状态仍可更新（不影响拖动体验）
      const playBtn = card.querySelector('.media-play');
      if (playBtn) playBtn.textContent = info.paused ? '▶' : '⏸';
      const stateEl = card.querySelector('.media-state');
      if (stateEl) stateEl.textContent = info.paused ? '⏸ 暂停' : '▶ 播放';
      // 倍速显示
      const speedSelect = card.querySelector('.media-speed');
      if (speedSelect) {
        if ([0.5,0.75,1,1.25,1.5,2].includes(info.playbackRate)) {
          speedSelect.value = String(info.playbackRate);
        } else {
          speedSelect.value = 'custom';
          const speedCustom = card.querySelector('.media-speed-custom');
            if (speedCustom) speedCustom.value = info.playbackRate;
        }
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  refreshMediaList(true);
  refreshTimer = setInterval(() => refreshMediaList(false), 1000);
});

window.addEventListener('unload', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});
