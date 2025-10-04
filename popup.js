
function sendToTab(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, resolve);
  });
}

// 配置：从 options 继承快进/快退步长
let SEEK_STEP = 5;
chrome.storage.sync.get({ seekStep: 5 }, (cfg) => {
  const v = Number(cfg.seekStep);
  if (v && v > 0) SEEK_STEP = v;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.seekStep) {
    const v = Number(changes.seekStep.newValue);
    if (v && v > 0) {
      SEEK_STEP = v;
      // 更新已有卡片的提示
      try {
        document.querySelectorAll('.media-card').forEach((card) => {
          const backBtn = card.querySelector('.media-back');
          const fwdBtn = card.querySelector('.media-forward');
          if (backBtn) backBtn.title = `快退 ${SEEK_STEP}s`;
          if (fwdBtn) fwdBtn.title = `快进 ${SEEK_STEP}s`;
        });
      } catch {}
    }
  }
});

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
// 在提交 seek 或拖动松开后，短暂冻结整表重渲染，避免列表短暂空缺导致卡片闪烁
let REFRESH_FREEZE_UNTIL = 0;
const FREEZE_MS = 1000;

function renderMediaList(mediaList) {
  const container = document.getElementById('media-list');
  container.innerHTML = '';
  if (!mediaList.length) {
    container.innerHTML = '<div id="no-media">未检测到任何标签页的音视频</div>';
    container.classList.remove('preload-hidden');
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
    const isLive = !!info.isLive;
  const pipSupported = info.type === 'video' && info.pictureInPictureEnabled;
  const pipActive = !!info.inPictureInPicture;
  const pipButtonTitle = pipSupported ? (pipActive ? '退出小窗播放' : '开启小窗播放') : '当前媒体不支持小窗';
  const pipLabel = pipActive ? '🪟' : '📺';
    card.innerHTML = `
      <div class="media-header">
        ${thumbHtml}
        <span class="media-type">${info.type === 'video' ? '🎬 视频' : '🎵 音频'}</span>
        ${isLive ? '<span class="media-live">LIVE</span>' : ''}
        <span class="media-state">${info.paused ? '⏸ 暂停' : '▶ 播放'}</span>
        <button class="media-btn media-pip${pipActive ? ' pip-active' : ''}" title="${pipButtonTitle}" ${pipSupported ? '' : 'disabled'}>${pipLabel}</button>
        <button class="media-btn media-jump" title="切换到该标签页">↗️</button>
      </div>
      <div class="media-title" title="${tab.title}">${formatTabTitle(tab)}</div>
  <div class="media-controls media-controls-row1">
          <button class="media-btn media-play">${info.paused ? '▶' : '⏸'}</button>
          <button class="media-btn media-back" ${isLive ? 'disabled title="直播不可快退"' : ''}>⏪</button>
          <button class="media-btn media-forward" ${isLive ? 'disabled title="直播不可快进"' : ''}>⏩</button>
          <select class="media-speed">
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1" selected>1x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
            <option value="custom">自定义</option>
          </select>
          <input class="media-speed-custom" type="number" min="0.1" max="10" step="0.05" style="width:60px;display:none;height:32px;box-sizing:border-box;padding:4px 6px;" placeholder="倍速" />
          <button class="media-btn media-reset" title="重置为1倍速">1x</button>
        </div>
        
      </div>
      <div class="media-controls media-controls-row2" style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
        <div class="media-audio-group" style="display:flex;align-items:center;gap:4px;">
          <span class="vol-icon" title="静音/恢复" data-muted="${info.muted? '1':'0'}">${info.muted ? '🔇' : '🔊'}</span>
          <input class="media-volume" type="range" min="0" max="1" step="0.01" value="${info.volume != null ? info.volume : 1}">
        </div>
        <button class="media-btn media-eq-toggle" title="音效均衡(EQ)">🎶</button>
      </div>
      <div class="media-progress">
        <span class="media-time">${info.currentTime}</span> / <span class="media-duration">${isLive ? '直播' : info.duration}</span>
      </div>
      <input type="range" class="seek-bar" min="0" max="${info.rawDuration}" value="${info.rawCurrentTime}" step="0.01" ${isLive || !isFinite(info.rawDuration) ? 'disabled' : ''}>
      <div class="eq-panel" style="display:none;margin-top:10px;border-top:1px solid #eee;padding-top:8px;">
        <div class="eq-presets" style="display:flex;align-items:center;gap:4px;margin-bottom:6px;flex-wrap:wrap;">
          <select class="eq-preset-select" style="flex:1;min-width:120px;font-size:12px;padding:3px 4px;"></select>
          <input class="eq-save-name" type="text" placeholder="名称" style="width:110px;font-size:12px;padding:3px 4px;">
          <button class="media-btn eq-save" style="font-size:11px;padding:3px 6px;">保存</button>
          <button class="media-btn eq-del" style="font-size:11px;padding:3px 6px;display:none;">删</button>
          <button class="media-btn eq-reset" style="font-size:11px;padding:3px 6px;">原始</button>
          <button class="media-btn eq-spectrum-toggle" title="显示/隐藏频谱图" style="font-size:11px;padding:3px 6px;">🌈</button>
        </div>
        <div class="eq-bands" style="display:flex;gap:4px;justify-content:space-between;">
        </div>
  <!-- Removed standalone gain curve canvas (merged into unified graph) -->
        <div class="eq-graph-controls" style="display:none;align-items:center;gap:10px;margin-top:6px;font-size:12px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:4px;"><input type="checkbox" class="eq-show-pre" checked> 原始频谱</label>
          <label style="display:flex;align-items:center;gap:4px;"><input type="checkbox" class="eq-show-post" checked> 调整后频谱</label>
          <label style="display:flex;align-items:center;gap:4px;"><input type="checkbox" class="eq-show-curve" checked> 增益曲线</label>
          <label style="display:flex;align-items:center;gap:4px;"><input type="checkbox" class="eq-show-hist" checked> 历史范围</label>
          <span class="eq-legend" style="display:flex;align-items:center;gap:10px;margin-left:auto;">
            <span style="display:flex;align-items:center;gap:4px;font-size:11px;opacity:.85;">
              <span style="width:11px;height:11px;background:#7aa7ff;border-radius:2px;opacity:.55;"></span><span>原始</span>
            </span>
            <span style="display:flex;align-items:center;gap:4px;font-size:11px;opacity:.9;">
              <span style="width:11px;height:11px;background:#3f78ff;border-radius:2px;"></span><span>调整后</span>
            </span>
            <span style="display:flex;align-items:center;gap:4px;font-size:11px;opacity:.95;">
              <span style="width:14px;height:2px;background:#e24a4a;border-radius:1px;"></span><span>增益</span>
            </span>
          </span>
        </div>
        <canvas class="eq-graph" width="320" height="160" style="display:none;width:100%;height:160px;background:#fbfcff;border:1px solid #e8ecf5;border-radius:8px;margin-top:6px;"></canvas>
        <div class="eq-spectrum" style="display:none;margin-top:10px;padding:6px 4px;background:#fafbff;border:1px solid #e8ecf5;border-radius:8px;">
          <div class="eq-spectrum-bars" style="display:flex;align-items:flex-end;gap:6px;height:64px;">
          </div>
          <div class="eq-spectrum-labels" style="display:flex;justify-content:space-between;gap:6px;font-size:10px;color:#666;margin-top:4px;"></div>
        </div>
      </div>
    `;
    // 初始根据存储标记 EQ 修改状态（无需打开面板）
    (function markEqModifiedBadge() {
      try {
        const url = tab.url || '';
        const u = new URL(url);
        const key = 'eqMem:' + u.origin + u.pathname;
        chrome.storage.local.get([key], (obj) => {
          const val = obj[key];
          const gains = val && Array.isArray(val.gains) ? val.gains : null;
          const modified = !!(gains && gains.some(v => Math.abs(Number(v)||0) > 0.0001));
          const toggleBtn = card.querySelector('.media-eq-toggle');
          if (toggleBtn) {
            if (modified) toggleBtn.classList.add('eq-modified');
            else toggleBtn.classList.remove('eq-modified');
          }
        });
      } catch {}
    })();
    // 控件事件
    // 播放/暂停
    card.querySelector('.media-play').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'gmcx-control', action: 'play-toggle', tabId: tab.id });
      refreshMediaList(false);
    });
    // 跳转到对应标签页
    const jumpBtn = card.querySelector('.media-jump');
    if (jumpBtn) {
      jumpBtn.addEventListener('click', async () => {
        try {
          if (typeof tab.windowId === 'number') {
            await chrome.windows.update(tab.windowId, { focused: true });
          }
          await chrome.tabs.update(tab.id, { active: true });
          window.close();
        } catch {}
      });
    }
    // 前进/后退（点击累积逻辑）
  const backBtn = card.querySelector('.media-back');
  const fwdBtn = card.querySelector('.media-forward');
  if (backBtn) backBtn.title = `快退 ${SEEK_STEP}s`;
  if (fwdBtn) fwdBtn.title = `快进 ${SEEK_STEP}s`;
  const getSeekBar = () => card.querySelector('.seek-bar');
  const getTimeEl = () => card.querySelector('.media-time');

    function scheduleSeekCommit(tabId) {
      const entry = seekAccum.get(tabId);
      if (!entry) return;
      clearTimeout(entry.timer);
      entry.timer = setTimeout(async () => {
        // 提交阶段：上锁，发送最终 seek，然后刷新
        REFRESH_FREEZE_UNTIL = Date.now() + FREEZE_MS;
        const delta = entry.pending;
        seekAccum.delete(tabId);
        if (delta === 0) return;
        // 发送 seek（后台统一触发，抑制本地覆盖层，展示统一覆盖层A）
        await chrome.runtime.sendMessage({ type: 'gmcx-control', action: 'seek-delta', tabId, value: delta });
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

  if (!isLive) {
    backBtn.addEventListener('click', () => accumulateSeek(tab.id, -SEEK_STEP));
    fwdBtn.addEventListener('click', () => accumulateSeek(tab.id, +SEEK_STEP));
  }
    // 静音切换
    // 音量与静音
  const volIcon = card.querySelector('.vol-icon');
  const volSlider = card.querySelector('.media-volume');
  const pipBtn = card.querySelector('.media-pip');
  if (pipBtn) pipBtn.dataset.busy = pipBtn.dataset.busy || '0';
    if (volIcon) {
      volIcon.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'gmcx-control', action: 'toggle-mute', tabId: tab.id });
        refreshMediaList(false);
      });
    }
    if (volSlider) {
      let volTimer = null;
      volSlider.addEventListener('input', (e) => {
        const v = Number(e.target.value);
        clearTimeout(volTimer);
        volTimer = setTimeout(async () => {
          await chrome.runtime.sendMessage({ type: 'gmcx-control', action: 'set-volume', tabId: tab.id, value: v });
          refreshMediaList(false);
        }, 120);
      });
    }
    if (pipBtn) {
      pipBtn.addEventListener('click', async () => {
        if (pipBtn.dataset.busy === '1') return;
        pipBtn.dataset.busy = '1';
        pipBtn.disabled = true;
        try {
          await chrome.runtime.sendMessage({ type: 'gmcx-control', action: 'toggle-pip', tabId: tab.id });
        } finally {
          pipBtn.dataset.busy = '0';
          pipBtn.disabled = false;
          refreshMediaList(false);
        }
      });
    }
    // EQ 面板逻辑
    const eqToggle = card.querySelector('.media-eq-toggle');
    const eqPanel = card.querySelector('.eq-panel');
    const eqPresetSelect = card.querySelector('.eq-preset-select');
    const eqBandsWrap = card.querySelector('.eq-bands');
    const eqSaveName = card.querySelector('.eq-save-name');
    const eqSaveBtn = card.querySelector('.eq-save');
    const eqDelBtn = card.querySelector('.eq-del');
  const eqResetBtn = card.querySelector('.eq-reset');
  const eqSpectrumToggle = card.querySelector('.eq-spectrum-toggle');
  const eqSpectrumWrap = card.querySelector('.eq-spectrum');
  const eqSpectrumBars = card.querySelector('.eq-spectrum-bars');
  const eqSpectrumLabels = card.querySelector('.eq-spectrum-labels');
  // standalone curve removed
  const eqGraphControls = card.querySelector('.eq-graph-controls');
  const eqShowPre = card.querySelector('.eq-show-pre');
  const eqShowPost = card.querySelector('.eq-show-post');
  const eqShowCurve = card.querySelector('.eq-show-curve');
  const eqShowHist = card.querySelector('.eq-show-hist');
  const eqGraphCanvas = card.querySelector('.eq-graph');
  const eqGraphCtx = eqGraphCanvas ? eqGraphCanvas.getContext('2d') : null;
    let eqGains = [];
    let eqFreqs = [];
    let eqBuiltin = [];
    let eqCustom = [];
    const approxEqual = (a,b,eps=0.1) => Array.isArray(a) && Array.isArray(b) && a.length===b.length && a.every((v,i)=>Math.abs((+v)-(+b[i]))<=eps);
    const PH_VAL = '__current_custom__';
    function setEqButtonTint(isModified) {
      if (isModified) {
        eqToggle.classList.add('eq-modified');
      } else {
        eqToggle.classList.remove('eq-modified');
      }
    }
    function ensureCustomPlaceholder() {
      let opt = eqPresetSelect.querySelector(`option[value="${PH_VAL}"]`);
      if (!opt) {
        opt = document.createElement('option');
        opt.value = PH_VAL;
        opt.textContent = '自定义';
        eqPresetSelect.insertBefore(opt, eqPresetSelect.firstChild || null);
      }
      return opt;
    }
    function removeCustomPlaceholder() {
      const opt = eqPresetSelect.querySelector(`option[value="${PH_VAL}"]`);
      if (opt) opt.remove();
    }
    function renderBands() {
      eqBandsWrap.innerHTML = '';
      eqFreqs.forEach((f, idx) => {
        const g = eqGains[idx] || 0;
  const col = document.createElement('div');
  col.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;min-width:26px;';
        const lab = document.createElement('div'); lab.textContent = f>=1000 ? (f/1000)+'k' : f; lab.style.cssText='font-size:11px;margin-bottom:4px;color:#555;';
        const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '-24'; slider.max = '24'; slider.step = '0.5'; slider.value = g;
  slider.style.cssText='writing-mode:bt-lr;appearance:slider-vertical;height:78px;width:24px;';
  const val = document.createElement('div'); val.textContent = g.toFixed(0)+'dB'; val.style.cssText='font-size:10px;margin-top:2px;color:#333;';
        slider.addEventListener('input', (e)=>{ val.textContent = Number(e.target.value).toFixed(0)+'dB'; });
        let debounceTimer=null;
        slider.addEventListener('change', (e)=>{
          const v = Number(e.target.value);
          eqGains[idx]=v;
          clearTimeout(debounceTimer);
          debounceTimer=setTimeout(()=>{
            sendToTab(tab.id,{type:'gmcx-eq-set-band', index: idx, value: v});
            resetPostHistory();
          },120);
          // 更新选择与保存按钮可见性
          const allPresets = [...eqBuiltin, ...eqCustom];
          const matched = allPresets.find(p => approxEqual(eqGains, p.gains));
          if (matched) {
            eqPresetSelect.value = matched.name;
            const isCustom = eqCustom.some(p => p.name === matched.name);
            eqDelBtn.style.display = isCustom ? 'inline-block' : 'none';
            eqSaveBtn.style.display = 'none';
            // 有匹配则移除占位
            removeCustomPlaceholder();
            setEqButtonTint(matched.name !== '原始');
            // 选中自定义预设时，保存名默认填充为该预设名，便于覆盖
            eqSaveName.value = isCustom ? matched.name : '';
          } else {
            // 无匹配则确保占位项存在并选中
            ensureCustomPlaceholder();
            eqPresetSelect.value = PH_VAL;
            eqDelBtn.style.display = 'none';
            eqSaveBtn.style.display = 'inline-block';
            setEqButtonTint(true);
          }
          // 曲线已合并至统一图，仅触发统一重绘
          drawUnifiedGraph && drawUnifiedGraph();
        });
        col.appendChild(lab); col.appendChild(slider); col.appendChild(val);
        eqBandsWrap.appendChild(col);
      });
  drawUnifiedGraph && drawUnifiedGraph();
    }
      function renderSpectrumLabels() {
        if (!eqSpectrumLabels) return;
        eqSpectrumLabels.innerHTML = '';
        eqFreqs.forEach((f) => {
          const lab = document.createElement('div');
          lab.style.cssText = 'flex:1;text-align:center;';
          lab.textContent = f>=1000 ? (f/1000).toFixed(f>=10000?0:1)+'k' : f;
          eqSpectrumLabels.appendChild(lab);
        });
      }
      function ensureSpectrumBars() {
        if (!eqSpectrumBars) return;
        if (eqSpectrumBars.childElementCount === eqFreqs.length) return;
        eqSpectrumBars.innerHTML = '';
        eqFreqs.forEach(() => {
          const bar = document.createElement('div');
          bar.style.cssText = 'flex:1;min-width:8px;background:linear-gradient(180deg,#4facfe,#00f2fe);border-radius:4px 4px 0 0;height:6px;transition:height .08s ease, filter .12s ease';
          eqSpectrumBars.appendChild(bar);
        });
      }
      let spectrumTimer = null;
      let spectrumEmaPre = [];
      let spectrumEmaPost = [];
      async function spectrumTick() {
        try {
          const sample = await sendToTab(tab.id, { type: 'gmcx-eq-spectrum-sample' });
          if (!sample || !sample.ok) return;
          const bands = Array.isArray(sample.post) ? sample.post : (Array.isArray(sample.pre) ? sample.pre : null);
          if (!bands) return;
          ensureSpectrumBars();
          const bars = Array.from(eqSpectrumBars.children);
          const alpha = 0.35;
          bands.forEach((v, i) => {
            const prev = typeof spectrumEmaPost[i] === 'number' ? spectrumEmaPost[i] : v;
            const vv = alpha * v + (1 - alpha) * prev;
            spectrumEmaPost[i] = vv;
            const h = Math.max(4, Math.min(62, Math.round(vv * 62))); // 0..1 -> px
            const el = bars[i];
            if (el) el.style.height = h + 'px';
          });
        } finally {
          spectrumTimer = setTimeout(spectrumTick, 80);
        }
      }

      // ===== 统一绘图：原始/调整后频谱 + 真实增益曲线 =====
      let graphTimer = null;
      let lastCurve = null;
      let lastCurveTs = 0;
      const CURVE_REFRESH_MS = 380;
      let emaPre = [];
      let emaPost = [];
      // 历史最值（仅针对 post 频谱）
      let histPostMin = [];
      let histPostMax = [];
      function resetPostHistory() {
        histPostMin = [];
        histPostMax = [];
      }
      function resizeEqGraphCanvas() {
        if (!eqGraphCanvas) return;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(eqGraphCanvas.clientWidth * dpr);
        const h = Math.floor(160 * dpr);
        if (eqGraphCanvas.width !== w || eqGraphCanvas.height !== h) {
          eqGraphCanvas.width = w; eqGraphCanvas.height = h;
        }
      }
      function drawUnifiedGraph() {
        if (!eqGraphCtx || !eqGraphCanvas) return;
        resizeEqGraphCanvas();
        const W = eqGraphCanvas.width, H = eqGraphCanvas.height;
        eqGraphCtx.clearRect(0,0,W,H);
        const AXIS_HEIGHT = Math.floor(18 * (window.devicePixelRatio||1));
        const plotH = H - AXIS_HEIGHT; // 留出底部横坐标区域
        // 背景淡填充
        eqGraphCtx.fillStyle = '#ffffff';
        eqGraphCtx.fillRect(0,0,W,H);
        // 水平参考线 (-12 / 0 / +12 dB)
        eqGraphCtx.strokeStyle = '#eef2f9'; eqGraphCtx.lineWidth = 1;
        [ -12, 0, 12 ].forEach(dB => {
          const y = plotH - ((dB + 24) / 48) * plotH;
          eqGraphCtx.beginPath(); eqGraphCtx.moveTo(0,y); eqGraphCtx.lineTo(W,y); eqGraphCtx.stroke();
          if (dB === 0) {
            eqGraphCtx.fillStyle = '#9aa3b1';
            eqGraphCtx.font = `${10*(window.devicePixelRatio||1)}px sans-serif`;
            eqGraphCtx.fillText('0dB', 4, Math.max(10, y-2));
          }
        });
        if (!Array.isArray(eqFreqs) || !eqFreqs.length) return;
        const xs = eqFreqs.map(f => Math.log10(f));
        const minX = xs[0], maxX = xs[xs.length-1];
        const xAtF = (f) => {
          const lx = Math.log10(f);
          const t = (lx - minX) / (maxX - minX);
          return (t * (W-12) + 6);
        };
        const yFromRatio = (r) => plotH - (r * plotH); // r: 0..1 (幅度映射)
        const drawGroupedBars = () => {
          const showPre = !!(eqShowPre?.checked && emaPre.length);
          const showPost = !!(eqShowPost?.checked && emaPost.length);
          if (!showPre && !showPost) return;
          const n = eqFreqs.length;
          for (let i=0;i<n;i++) {
            const f = eqFreqs[i];
            const fn = eqFreqs[Math.min(i+1, n-1)];
            const x0 = xAtF(f);
            const x1 = xAtF(fn);
            const slotW = (x1 - x0)*0.88; // 可利用宽度
            const cx = x0 + (x1-x0)/2;
            let bars = [];
            if (showPre) bars.push({ type:'pre', v: emaPre[i]||0 });
            if (showPost) bars.push({ type:'post', v: emaPost[i]||0 });
            const count = bars.length;
            const gap = 2 * (window.devicePixelRatio||1);
            let barW = slotW;
            if (count>1) barW = (slotW - gap*(count-1))/count;
            barW = Math.max(4, Math.min(30, barW));
            let startX = cx - ( (count*barW + (count-1)*gap) /2 );
            bars.forEach(b => {
              const h = Math.max(2, Math.min(plotH-2, b.v * plotH));
              const x = Math.round(startX);
              eqGraphCtx.fillStyle = b.type==='pre' ? '#7aa7ff' : '#3f78ff';
              eqGraphCtx.globalAlpha = b.type==='pre'?0.5:0.9;
              eqGraphCtx.fillRect(x, plotH - h, barW, h);
              startX += barW + gap;
            });
          }
          // 恢复默认 alpha
          eqGraphCtx.globalAlpha = 1;
        };
        drawGroupedBars();
        // （已移除旧 drawBars 残留代码）
  if (eqShowPost?.checked && eqShowHist?.checked && histPostMin.length === emaPost.length) {
          eqGraphCtx.save();
          // 改为画每个频段的垂直“最值范围”线，顶=历史最大 底=历史最小
          for (let i=0;i<eqFreqs.length;i++) {
            const f = eqFreqs[i];
            const fn = eqFreqs[Math.min(i+1, eqFreqs.length-1)];
            const x0 = xAtF(f);
            const x1 = xAtF(fn);
            const cx = x0 + (x1-x0)/2;
            const vMin = histPostMin[i];
            const vMax = histPostMax[i];
            if (typeof vMin !== 'number' || typeof vMax !== 'number') continue;
            const yMin = yFromRatio(vMin);
            const yMax = yFromRatio(vMax);
            eqGraphCtx.strokeStyle = 'rgba(63,120,255,0.45)';
            eqGraphCtx.lineWidth = 1;
            eqGraphCtx.setLineDash([4,4]);
            eqGraphCtx.beginPath();
            eqGraphCtx.moveTo(cx, yMax);
            eqGraphCtx.lineTo(cx, yMin);
            eqGraphCtx.stroke();
            // 小端帽
            eqGraphCtx.setLineDash([]);
            eqGraphCtx.beginPath();
            eqGraphCtx.moveTo(cx-4, yMax);
            eqGraphCtx.lineTo(cx+4, yMax);
            eqGraphCtx.moveTo(cx-4, yMin);
            eqGraphCtx.lineTo(cx+4, yMin);
            eqGraphCtx.stroke();
            eqGraphCtx.setLineDash([4,4]);
          }
          eqGraphCtx.restore();
        }
        if (eqShowCurve?.checked && lastCurve && Array.isArray(lastCurve.freqs)) {
          eqGraphCtx.beginPath(); eqGraphCtx.strokeStyle = '#e24a4a'; eqGraphCtx.lineWidth = 2;
          const n = Math.min(lastCurve.freqs.length, lastCurve.magsDb.length);
          for (let i=0;i<n;i++) {
            const x = xAtF(lastCurve.freqs[i]);
            const y = plotH - ((lastCurve.magsDb[i] + 24) / 48) * plotH;
            if (i===0) eqGraphCtx.moveTo(x,y); else eqGraphCtx.lineTo(x,y);
          }
          eqGraphCtx.stroke();
        }
        // 横坐标（频率）——均匀抽取若干点（所有 band + 边界）
        eqGraphCtx.save();
        eqGraphCtx.font = `${10*(window.devicePixelRatio||1)}px sans-serif`;
        eqGraphCtx.fillStyle = '#5a6270';
        eqGraphCtx.textAlign = 'center';
        const labelFreqs = [...eqFreqs];
        // 避免太密，若>10个则每隔1个取一个
        let pick = labelFreqs;
        if (labelFreqs.length > 10) pick = labelFreqs.filter((_,i)=> i%2===0);
        pick.forEach(f => {
          const x = xAtF(f);
          const lab = f >= 1000 ? (f/1000).toFixed(f>=10000?0:1)+'k' : String(f);
          eqGraphCtx.fillText(lab, x, H-4);
        });
        eqGraphCtx.restore();
      }
      async function unifiedGraphTick() {
        try {
          const sample = await sendToTab(tab.id, { type: 'gmcx-eq-spectrum-sample' });
          if (sample && sample.ok) {
            const alpha = 0.35;
            if (Array.isArray(sample.pre)) {
              sample.pre.forEach((v,i)=>{
                const p = typeof emaPre[i]==='number'?emaPre[i]:v; emaPre[i]=alpha*v+(1-alpha)*p;
              });
            }
            if (Array.isArray(sample.post)) {
              sample.post.forEach((v,i)=>{
                const p = typeof emaPost[i]==='number'?emaPost[i]:v; const vv = alpha*v+(1-alpha)*p; emaPost[i]=vv;
                if (typeof histPostMin[i] !== 'number') { histPostMin[i] = vv; histPostMax[i] = vv; }
                else {
                  if (vv < histPostMin[i]) histPostMin[i] = vv;
                  if (vv > histPostMax[i]) histPostMax[i] = vv;
                }
              });
            }
            if (!eqFreqs.length && Array.isArray(sample.freqs)) eqFreqs = sample.freqs;
          }
          const now = Date.now();
          if (!lastCurve || (now - lastCurveTs) > CURVE_REFRESH_MS) {
            const resp = await sendToTab(tab.id, { type: 'gmcx-eq-get-response', points: 256 });
            if (resp && resp.ok) { lastCurve = { freqs: resp.freqs, magsDb: resp.magsDb }; lastCurveTs = now; }
          }
          drawUnifiedGraph();
        } finally {
          graphTimer = setTimeout(unifiedGraphTick, 120);
        }
      }
    async function loadEQ() {
      const resp = await sendToTab(tab.id, {type:'gmcx-eq-init'});
      if (!resp || !resp.ok) return;
      eqFreqs = resp.freqs; eqGains = resp.gains;
      eqBuiltin = Array.isArray(resp.builtin) ? resp.builtin : [];
      eqCustom = Array.isArray(resp.custom) ? resp.custom : [];
      // 预设
      eqPresetSelect.innerHTML='';
      const groupBuiltin = document.createElement('optgroup'); groupBuiltin.label='内置';
      resp.builtin.forEach(p=>{ const o=document.createElement('option'); o.value=p.name; o.textContent=p.name; groupBuiltin.appendChild(o); });
      const groupCustom = document.createElement('optgroup'); groupCustom.label='自定义';
      resp.custom.forEach(p=>{ const o=document.createElement('option'); o.value=p.name; o.textContent=p.name; groupCustom.appendChild(o); });
      // 匹配当前 gains 到某个预设，按需决定是否渲染占位项
      const allPresets = [...resp.builtin, ...resp.custom];
      const matched = allPresets.find(p => approxEqual(eqGains, p.gains));
      if (matched) {
        // 不渲染占位项
        eqPresetSelect.appendChild(groupBuiltin);
        eqPresetSelect.appendChild(groupCustom);
        eqPresetSelect.value = matched.name;
        // 自定义匹配则显示删除按钮
        const isCustom = resp.custom.some(p => p.name === matched.name);
        eqDelBtn.style.display = isCustom ? 'inline-block' : 'none';
        eqSaveBtn.style.display = 'none';
        setEqButtonTint(matched.name !== '原始');
        // 若为自定义预设，右侧保存名默认填充为该预设名
        eqSaveName.value = isCustom ? matched.name : '';
      } else {
        // 渲染占位项（显示为“自定义”），仅在不匹配时
        const placeholder = document.createElement('option');
        placeholder.value = PH_VAL;
        placeholder.textContent = '自定义';
        eqPresetSelect.appendChild(placeholder);
        eqPresetSelect.appendChild(groupBuiltin);
        eqPresetSelect.appendChild(groupCustom);
        eqPresetSelect.value = PH_VAL;
        eqDelBtn.style.display='none';
        eqSaveBtn.style.display = 'inline-block';
        setEqButtonTint(true);
        eqSaveName.value = '';
      }
      renderBands();
      // 初始化频谱标签（不自动显示）
      renderSpectrumLabels();
    }
    eqToggle.addEventListener('click', async ()=>{
  if (eqPanel.style.display==='none') { eqPanel.style.display='block'; await loadEQ(); resetPostHistory(); }
      else { eqPanel.style.display='none'; }
    });
    eqPresetSelect.addEventListener('change', async (e)=>{
      const name = e.target.value;
      if (!name || name === PH_VAL) return; // 忽略占位
      await sendToTab(tab.id, {type:'gmcx-eq-apply-preset', name});
      // 重新获取当前状态
      const st = await sendToTab(tab.id, {type:'gmcx-eq-get-state'});
  if (st && st.ok) { eqGains = st.gains; renderBands(); drawUnifiedGraph && drawUnifiedGraph(); resetPostHistory(); }
      // 判断删除按钮是否显示（自定义）
      const isCustomSelected = Array.from((e.target.querySelector('optgroup[label="自定义"]')||[]).children).some(o=>o.value===name);
      eqDelBtn.style.display = isCustomSelected ? 'inline-block' : 'none';
      // 选择了预设 -> 隐藏保存按钮
      eqSaveBtn.style.display = 'none';
      // 选择预设后，若占位项存在则移除
      removeCustomPlaceholder();
      setEqButtonTint(name !== '原始');
      // 若为自定义预设，右侧保存名默认填充为该预设名，便于随后覆盖保存
      eqSaveName.value = isCustomSelected ? name : '';
      // 请求后台刷新图标
      chrome.runtime.sendMessage({ type: 'gmcx-update-icon-for-tab', tabId: tab.id });
    });
    eqSaveBtn.addEventListener('click', async ()=>{
      // 默认覆盖：若当前选择的是某个自定义预设且未输入新名称，则覆盖该名称
      let name = eqSaveName.value.trim();
      if (!name) {
        const currentSel = eqPresetSelect.value;
        // 判断当前是否为自定义预设
        const isCustomSelected = (() => {
          const customGroup = eqPresetSelect.querySelector('optgroup[label="自定义"]');
          return !!(customGroup && Array.from(customGroup.children).some(o => o.value === currentSel));
        })();
        if (isCustomSelected && currentSel && currentSel !== '__current_custom__') {
          name = currentSel; // 覆盖当前自定义预设
        }
      }
      const st = await sendToTab(tab.id,{type:'gmcx-eq-save-preset', name});
      if (st && st.ok) {
        await loadEQ();
        // 保存成功后匹配到该自定义预设，移除占位项（若存在）
        removeCustomPlaceholder();
        eqPresetSelect.value = st.name;
        eqDelBtn.style.display='inline-block';
        eqSaveBtn.style.display='none';
        setEqButtonTint(true);
      }
    });
    eqDelBtn.addEventListener('click', async ()=>{
      const name = eqPresetSelect.value; if (!name) return;
      await sendToTab(tab.id,{type:'gmcx-eq-delete-preset', name});
      // 删除后切回“原始”音效
      await sendToTab(tab.id, { type: 'gmcx-eq-apply-preset', name: '原始' });
      await loadEQ();
      eqPresetSelect.value = '原始';
      // 请求后台刷新图标
      chrome.runtime.sendMessage({ type: 'gmcx-update-icon-for-tab', tabId: tab.id });
    });
    if (eqResetBtn) {
      eqResetBtn.addEventListener('click', async ()=>{
        await sendToTab(tab.id, { type: 'gmcx-eq-reset' });
        // 重载当前状态以同步滑块和选择状态
        await loadEQ();
        // 立即清除按钮红点
        setEqButtonTint(false);
        // 请求后台刷新图标
        chrome.runtime.sendMessage({ type: 'gmcx-update-icon-for-tab', tabId: tab.id });
      });
    }
    if (eqSpectrumToggle) {
      eqSpectrumToggle.addEventListener('click', async () => {
        const showing = eqGraphCanvas && eqGraphCanvas.style.display !== 'none';
        if (!showing) {
          // 尝试初始化分析器
          const ok = await sendToTab(tab.id, { type: 'gmcx-eq-spectrum-init' });
          if (!ok || !ok.ok) return;
          if (eqGraphControls) eqGraphControls.style.display = 'flex';
          if (eqGraphCanvas) eqGraphCanvas.style.display = 'block';
          if (eqSpectrumWrap) eqSpectrumWrap.style.display = 'none';
          clearTimeout(graphTimer); graphTimer = null;
          await unifiedGraphTick();
          eqSpectrumToggle.textContent = '🌈 频谱';
        } else {
          if (eqGraphControls) eqGraphControls.style.display = 'none';
          if (eqGraphCanvas) eqGraphCanvas.style.display = 'none';
          clearTimeout(graphTimer); graphTimer = null;
          eqSpectrumToggle.textContent = '🌈 频谱';
        }
      });
    }
    // 复选框变化立即重绘
  [eqShowPre, eqShowPost, eqShowCurve, eqShowHist].forEach(cb => cb && cb.addEventListener('change', ()=> drawUnifiedGraph && drawUnifiedGraph()));
    // 倍速选择
    const speedSelect = card.querySelector('.media-speed');
    const speedCustom = card.querySelector('.media-speed-custom');
    // 判断是否为自定义倍速
    if (isLive) {
      // 直播：禁用倍速，显示当前但不可修改
      speedSelect.disabled = true;
      speedCustom.style.display = 'none';
      speedSelect.style.display = '';
      let v = Number(info.playbackRate) || 1;
      if ([0.5,0.75,1,1.25,1.5,2].includes(v)) speedSelect.value = String(v);
      else speedSelect.value = '1';
    } else if ([0.5,0.75,1,1.25,1.5,2].includes(info.playbackRate)) {
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
      if (isLive) { return; }
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
        await chrome.runtime.sendMessage({ type: 'gmcx-control', action: 'set-speed', tabId: tab.id, value: Number(e.target.value) });
        refreshMediaList();
      }
    });
    speedCustom.addEventListener('change', async (e) => {
      if (isLive) { return; }
      const val = Number(e.target.value);
      if (val >= 0.1 && val <= 10) {
        await chrome.runtime.sendMessage({ type: 'gmcx-control', action: 'set-speed', tabId: tab.id, value: val });
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
        REFRESH_FREEZE_UNTIL = Date.now() + FREEZE_MS;
        await chrome.runtime.sendMessage({ type: 'gmcx-control', action: 'set-currentTime', tabId: tab.id, value: finalVal });
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
  if (!isLive) seekBar.addEventListener('mousedown', () => startDrag());
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
  if (!isLive) seekBar.addEventListener('touchstart', () => startDrag(), {passive: true});
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
  // 首次完整渲染后淡入
  container.classList.remove('preload-hidden');
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
  const now = Date.now();
  const freeze = now < REFRESH_FREEZE_UNTIL;
  if (!freeze && (full || !shallowEqualMediaList(mediaList, lastMediaList))) {
    renderMediaList(mediaList);
    lastMediaList = mediaList;
  } else {
    const container = document.getElementById('media-list');
    const cards = Array.from(container.querySelectorAll('.media-card'));
    mediaList.forEach(({tab, info}) => {
      const card = cards.find(c => c.dataset.tabId === String(tab.id));
      if (!card) return;
      const locked = seekLocks.has(String(tab.id)) || seekAccum.has(tab.id);
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
      const pipBtn = card.querySelector('.media-pip');
      if (pipBtn) {
        const supported = info.type === 'video' && info.pictureInPictureEnabled;
        pipBtn.disabled = !supported;
        pipBtn.title = supported ? (info.inPictureInPicture ? '退出小窗播放' : '开启小窗播放') : '当前媒体不支持小窗';
        pipBtn.classList.toggle('pip-active', !!info.inPictureInPicture);
        pipBtn.textContent = info.inPictureInPicture ?  '🪟' : '📺';
        pipBtn.dataset.busy = '0';
      }
      const volIcon = card.querySelector('.vol-icon');
      const volSlider = card.querySelector('.media-volume');
      if (volIcon) volIcon.textContent = info.muted ? '🔇' : '🔊';
      if (volSlider && !seekLocks.has(String(tab.id))) volSlider.value = info.volume != null ? info.volume : 1;
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
      // 刷新时同步 EQ 修改徽标
      try {
        const url = tab.url || '';
        const u = new URL(url);
        const key = 'eqMem:' + u.origin + u.pathname;
        chrome.storage.local.get([key], (obj) => {
          const val = obj[key];
          const gains = val && Array.isArray(val.gains) ? val.gains : null;
          const modified = !!(gains && gains.some(v => Math.abs(Number(v)||0) > 0.0001));
          const toggleBtn = card.querySelector('.media-eq-toggle');
          if (toggleBtn) {
            if (modified) toggleBtn.classList.add('eq-modified');
            else toggleBtn.classList.remove('eq-modified');
          }
        });
      } catch {}
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // 提前请求，渲染后移除隐藏状态
  refreshMediaList(true);
  refreshTimer = setInterval(() => refreshMediaList(false), 1000);
  // 在冻结窗口内，跳过一次列表重建，避免闪烁
  setInterval(() => {
    if (Date.now() < REFRESH_FREEZE_UNTIL) {
      // 轻量增量刷新（不重建）
      refreshMediaList(false);
    }
  }, 300);
});

window.addEventListener('unload', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});
