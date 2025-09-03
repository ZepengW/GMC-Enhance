
function sendToTab(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, resolve);
  });
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
    // 前进/后退
    card.querySelector('.media-back').addEventListener('click', async () => {
      await sendToTab(tab.id, {type: 'gmcx-seek-media', value: -10}); // 后退10秒
      refreshMediaList();
    });
    card.querySelector('.media-forward').addEventListener('click', async () => {
      await sendToTab(tab.id, {type: 'gmcx-seek-media', value: 10}); // 前进10秒
      refreshMediaList();
    });
    // 倍速选择
    const speedSelect = card.querySelector('.media-speed');
    const speedCustom = card.querySelector('.media-speed-custom');
    speedSelect.value = info.playbackRate && [0.5,0.75,1,1.25,1.5,2].includes(info.playbackRate) ? String(info.playbackRate) : '1';
    speedSelect.addEventListener('change', async (e) => {
      if (e.target.value === 'custom') {
        speedCustom.style.display = '';
        speedCustom.value = info.playbackRate || '';
        speedCustom.focus();
      } else {
        speedCustom.style.display = 'none';
        await sendToTab(tab.id, {type: 'gmcx-set-media-speed', value: Number(e.target.value)});
        refreshMediaList();
      }
    });
    speedCustom.addEventListener('change', async (e) => {
      const val = Number(e.target.value);
      if (val >= 0.1 && val <= 10) {
        await sendToTab(tab.id, {type: 'gmcx-set-media-speed', value: val});
        refreshMediaList();
      }
    });
    // 重置
    card.querySelector('.media-reset').addEventListener('click', async () => {
      // 只重置倍速为1倍速
      await sendToTab(tab.id, {type: 'gmcx-set-media-speed', value: 1.0});
      refreshMediaList();
    });
    // 进度条
    card.querySelector('.seek-bar').addEventListener('input', async (e) => {
      const val = Number(e.target.value);
      await sendToTab(tab.id, {type: 'gmcx-set-media-currentTime', value: val});
      // 刷新当前卡片进度
      const updated = await sendToTab(tab.id, {type: 'gmcx-get-media-info'});
      if (updated && updated.ok) {
        card.querySelector('.media-time').textContent = updated.currentTime;
        card.querySelector('.media-duration').textContent = updated.duration;
        card.querySelector('.seek-bar').value = updated.rawCurrentTime;
      }
    });
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
    const cards = container.querySelectorAll('.media-card');
    mediaList.forEach(({info}, i) => {
      const card = cards[i];
      if (!card) return;
      card.querySelector('.media-time').textContent = info.currentTime;
      card.querySelector('.media-duration').textContent = info.duration;
      card.querySelector('.seek-bar').value = info.rawCurrentTime;
      card.querySelector('.media-play').textContent = info.paused ? '▶' : '⏸';
      card.querySelector('.media-state').textContent = info.paused ? '⏸ 暂停' : '▶ 播放';
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
