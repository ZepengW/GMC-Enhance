
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
    card.innerHTML = `
      <div class="media-header">
        <span class="media-type">${info.type === 'video' ? '🎬 视频' : '🎵 音频'}</span>
        <span class="media-state">${info.paused ? '⏸ 暂停' : '▶ 播放'}</span>
      </div>
      <div class="media-title" title="${tab.title}">${formatTabTitle(tab)}</div>
      <div class="media-progress">
        <span class="media-time">${info.currentTime}</span> / <span class="media-duration">${info.duration}</span>
      </div>
      <input type="range" class="seek-bar" min="0" max="${info.rawDuration}" value="${info.rawCurrentTime}" step="0.01" ${!isFinite(info.rawDuration) ? 'disabled' : ''}>
    `;
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

document.addEventListener('DOMContentLoaded', async () => {
  const mediaList = await getAllMediaInfo();
  renderMediaList(mediaList);
});
