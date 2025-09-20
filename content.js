(() => {
  const STATE = {
    seekStep: 5,
    speedStep: 0.25,
    hudEl: null,
    hudTimer: null,
    selectHudEl: null,
  videosCache: [],
    selectedIndex: 0,
    speedCycleList: [0.75, 1, 1.25, 1.5, 2],
    speedCyclePos: 1, // 指向 speedCycleList 中的当前速率索引（默认 1x）
    fineSeekActive: false,
    fineSeekDir: 0,
    fineSeekTimer: null,
    fineSeekStep: 0.2, // 无级细微拖动步长（秒）
    lastMediaWeak: null,
    fineOverlayEl: null,
    overlayHideTimer: null,
    overlayHideDelay: 3000 // 毫秒
    , lastMediaScanTs: 0,
    // 进度条实时刷新
    overlayVisible: false,
    progressRafId: 0,
    seekPreviewActive: false
  };
  // ====== EQ 状态 ======
  const EQ = {
    ctx: null,
    sourceMap: new WeakMap(), // media -> {source, filters:[], gains:[]}
    freqs: [60,170,400,1000,2500,6000,15000],
    ranges: { min: -24, max: 24 },
    builtinPresets: [
      { name: '原始', gains: [0,0,0,0,0,0,0] },
      { name: '低音增强', gains: [8,6,4,1,0,-2,-4] },
      { name: '人声增强', gains: [-2,0,2,4,3,1,0] },
      { name: '高音增强', gains: [-4,-2,0,1,2,4,6] },
      { name: '影院', gains: [6,4,2,0,1,3,5] }
    ],
    customPresets: [],
    loadedCustom: false
  };
  // ====== EQ 记忆（按页面） ======
  const EQMEM = { applied: false };
  function normalizePageKey() {
    try {
      const u = new URL(window.location.href);
      // 忽略查询与锚点，按 origin+pathname 记忆
      return `${u.origin}${u.pathname}`;
    } catch { return window.location.origin + window.location.pathname; }
  }
  function getEQMemKey() { return 'eqMem:' + normalizePageKey(); }
  function saveEQForPage(gains) {
    if (!Array.isArray(gains) || gains.length !== EQ.freqs.length) return;
    const key = getEQMemKey();
    try { chrome.storage.local.set({ [key]: { gains, ts: Date.now() } }); } catch {}
  }
  function loadEQForPage(cb) {
    const key = getEQMemKey();
    try {
      chrome.storage.local.get([key], (obj) => {
        cb && cb(obj && obj[key] && Array.isArray(obj[key].gains) ? obj[key].gains : null);
      });
    } catch { cb && cb(null); }
  }
  function clearEQForPage(cb) {
    const key = getEQMemKey();
    try { chrome.storage.local.remove([key], () => cb && cb()); } catch { cb && cb(); }
  }
  function ensureEQContext() {
    if (!EQ.ctx) {
      try { EQ.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { EQ.ctx = null; }
    }
    return EQ.ctx;
  }
  function ensureMediaEQ(media) {
    const ctx = ensureEQContext();
    if (!ctx) return null;
    let entry = EQ.sourceMap.get(media);
    if (entry) return entry;
    try {
      const source = ctx.createMediaElementSource(media);
      const filters = EQ.freqs.map((f, idx) => {
        const biquad = ctx.createBiquadFilter();
        biquad.type = 'peaking';
        biquad.frequency.value = f;
        biquad.Q.value = 1.05;
        biquad.gain.value = 0;
        return biquad;
      });
      // 串联
      filters.reduce((prev, cur) => { prev.connect(cur); return cur; }, source).connect(ctx.destination);
      entry = { source, filters };
      EQ.sourceMap.set(media, entry);
      return entry;
    } catch { return null; }
  }
  function applyGains(media, gains) {
    const entry = ensureMediaEQ(media);
    if (!entry) return false;
    entry.filters.forEach((f, i) => {
      if (typeof gains[i] === 'number') {
        const g = Math.max(EQ.ranges.min, Math.min(EQ.ranges.max, gains[i]));
        f.gain.value = g;
      }
    });
      // 通知后台当前页面 EQ 是否为非原始（有任一增益非0）
      try {
        const modified = Array.isArray(gains) && gains.some(v => Math.abs(Number(v)||0) > 0.0001);
        chrome.runtime.sendMessage({ type: 'gmcx-eq-modified-state', modified });
      } catch {}
    return true;
  }
  // 尝试在页面加载后自动应用已记忆的 EQ 设置
  (function autoApplySavedEQ() {
    let tries = 0, timer = null;
    const loop = () => {
      if (EQMEM.applied) { if (timer) clearInterval(timer); return; }
      if (tries++ > 20) { if (timer) clearInterval(timer); return; } // 最长尝试 ~20 次
      loadEQForPage((gains) => {
        if (!gains) return; // 没有记忆
        const media = getActiveMedia();
        if (!media) return; // 还未检测到媒体
        if (applyGains(media, gains)) {
          EQMEM.applied = true;
        }
      });
    };
    // 初始延时后再开始轮询，给页面媒体一些加载时间
    setTimeout(() => { loop(); timer = setInterval(loop, 800); }, 600);
  })();
  function loadCustomPresets(cb) {
    if (EQ.loadedCustom) { cb && cb(); return; }
    chrome.storage.sync.get({ eqCustomPresets: [] }, (cfg) => {
      if (Array.isArray(cfg.eqCustomPresets)) EQ.customPresets = cfg.eqCustomPresets.filter(p => Array.isArray(p.gains) && p.gains.length === EQ.freqs.length);
      EQ.loadedCustom = true;
      cb && cb();
    });
  }
  function saveCustomPresets() {
    chrome.storage.sync.set({ eqCustomPresets: EQ.customPresets.slice(0,40) });
  }
  chrome.storage.sync.get({ seekStep: 5, speedStep: 0.25 }, (cfg) => {
    STATE.seekStep = Number(cfg.seekStep) || 5;
    STATE.speedStep = Number(cfg.speedStep) || 0.25;
  });
  function collectVideos() {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportMid = viewportHeight / 2;
    const MIN_VW = 160, MIN_VH = 120; // 更接近官方 GMC 的可视阈值
    const isVisibleEnough = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > MIN_VW && rect.height > MIN_VH && rect.bottom > 0 && rect.top < viewportHeight;
    };
    const isMiniPreview = (el) => {
      if (!(el instanceof HTMLVideoElement)) return false;
      const rect = el.getBoundingClientRect();
      const smallByClient = rect.width < 240 || rect.height < 180;
      const smallByVideo = (el.videoWidth || 0) < 240 || (el.videoHeight || 0) < 180;
      const tiny = rect.width < 160 || rect.height < 120 || (el.videoWidth || 0) < 160 || (el.videoHeight || 0) < 120;
      const mutedPreview = (el.muted || el.volume === 0);
      const coldStart = (el.currentTime || 0) < 3;
      // 小窗 + 静音 + 初始/预览状态 → 视为主页推荐/小窗预览，排除
      return (tiny || smallByClient || smallByVideo) && mutedPreview && coldStart;
    };
    const isCandidateMedia = (el) => {
      if (!(el instanceof HTMLMediaElement)) return false;
      if (el.ended) return false;
      // 需要有部分数据（更严格，避免空白/壳元素）
      if (el.readyState < 2) return false; // HAVE_CURRENT_DATA
      if (el instanceof HTMLVideoElement) {
        if (isMiniPreview(el)) return false;
      }
      return true;
    };
    const medias = Array.from(document.querySelectorAll('video, audio'))
      .filter(isVisibleEnough)
      .filter(isCandidateMedia);
    // 排序策略：
    // 1. 正在播放的优先 (paused=false)
    // 2. 与视口中线距离更小
    // 3. 面积更大
    medias.sort((a,b) => {
      const aPlaying = a.paused ? 0 : 1;
      const bPlaying = b.paused ? 0 : 1;
      if (bPlaying - aPlaying) return bPlaying - aPlaying;
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      const aCenterDist = Math.abs((rectA.top + rectA.height/2) - viewportMid);
      const bCenterDist = Math.abs((rectB.top + rectB.height/2) - viewportMid);
      if (aCenterDist !== bCenterDist) return aCenterDist - bCenterDist; // 距离越小越靠前
      const areaA = (a instanceof HTMLVideoElement) ? (a.videoWidth * a.videoHeight) : 0;
      const areaB = (b instanceof HTMLVideoElement) ? (b.videoWidth * b.videoHeight) : 0;
      return areaB - areaA;
    });
    return medias;
  }

  function ensureSelectionHud() {
    if (STATE.selectHudEl) return STATE.selectHudEl;
    const el = document.createElement('div');
    el.id = 'gmcx-select-hud';
    el.style.cssText = `position:fixed;left:50%;bottom:6%;transform:translateX(-50%);
      background:rgba(20,22,26,.72);color:#fff;padding:10px 16px;border-radius:14px;
      font-size:14px;z-index:2147483647;box-shadow:0 6px 24px rgba(0,0,0,.35);
      pointer-events:none;opacity:0;transition:opacity .15s ease;backdrop-filter:blur(8px) saturate(140%);`;
    document.documentElement.appendChild(el);
    STATE.selectHudEl = el;
    return el;
  }
  function showSelectHUD(text, ms = 1400) {
    const el = ensureSelectionHud();
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.opacity = '0'; }, ms);
  }

  function resolveSelectedMedia() {
    // 优先使用当前缓存与 selectedIndex
    if (!STATE.videosCache.length) {
      STATE.videosCache = collectVideos();
      STATE.selectedIndex = 0;
    }
    if (STATE.selectedIndex >= STATE.videosCache.length) STATE.selectedIndex = 0;
    const el = STATE.videosCache[STATE.selectedIndex];
    if (el && document.contains(el)) return el;
    // 若元素已被移除，清空缓存重建
    STATE.videosCache = collectVideos();
    if (!STATE.videosCache.length) return null;
    STATE.selectedIndex = 0;
    return STATE.videosCache[0] || null;
  }

  function getMediaName(m) {
    if (!m) return '';
    // 常见站点策略：尝试上层包含标题的节点
    const attrs = ['aria-label','title','data-title'];
    for (const a of attrs) {
      if (m.getAttribute && m.getAttribute(a)) return m.getAttribute(a).slice(0,60);
    }
    // B站等：尝试最近的带有标题的父节点
    let p = m.parentElement, depth = 0;
    while (p && depth < 5) {
      for (const a of attrs) {
        if (p.getAttribute && p.getAttribute(a)) return p.getAttribute(a).slice(0,60);
      }
      p = p.parentElement; depth++;
    }
    // fallback: 根据类型和分辨率
    if (m instanceof HTMLVideoElement) return `视频 ${m.videoWidth}x${m.videoHeight}`;
    return '音频';
  }
  function cycleSelectedMedia() {
    STATE.videosCache = collectVideos();
    if (!STATE.videosCache.length) {
      showSelectHUD('未找到可切换媒体');
      return;
    }
    STATE.selectedIndex = (STATE.selectedIndex + 1) % STATE.videosCache.length;
    const media = STATE.videosCache[STATE.selectedIndex];
    const name = getMediaName(media);
    showSelectHUD(`切换 (${STATE.selectedIndex+1}/${STATE.videosCache.length}) ${name}`);
  }

  function getActiveMedia() {
    const selected = resolveSelectedMedia();
    if (selected) return selected;
    // 更严格的回退：与 collectVideos 同一套筛选
    const list = collectVideos();
    return list[0] || null;
  }
  function ensureHud() {
    if (STATE.hudEl) return STATE.hudEl;
    const el = document.createElement('div');
    el.id = 'gmcx-hud';
    el.style.cssText = `position: fixed; top: 10%; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,.6); color: #fff; padding: 10px 14px; border-radius: 12px;
      font-size: 14px; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      z-index: 2147483647; box-shadow: 0 6px 20px rgba(0,0,0,.3); pointer-events: none;
      opacity: 0; transition: opacity .12s ease; backdrop-filter: saturate(140%) blur(6px);`;
    document.documentElement.appendChild(el);
    STATE.hudEl = el;
    return el;
  }
  function showHUD(text, ms = 1200) {
    const el = ensureHud();
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(STATE.hudTimer);
    STATE.hudTimer = setTimeout(() => { el.style.opacity = '0'; }, ms);
  }
  // 统一：本地控制也使用底部 fine overlay，而不再使用顶部 HUD 文本
  function updateLocalOverlay(extra = {}) {
    const media = getActiveMedia();
    if (!media) return;
    const el = ensureFineOverlay();
    el.wrap.style.opacity = '1';
    STATE.overlayVisible = true;
    const cur = media.currentTime || 0;
    const durRaw = isFinite(media.duration) ? media.duration : cur + 1;
    const pct = durRaw ? (cur / durRaw) * 100 : 0;
    el.barFill.style.width = pct.toFixed(3) + '%';
    el.barFill.style.background = 'linear-gradient(90deg,#4facfe,#00f2fe)';
    el.left.textContent = formatTime(cur);
    el.right.textContent = isFinite(media.duration) ? formatTime(media.duration) : '--:--';
    // 统一使用“富卡片”布局：标题行 + 状态行
    while (el.center.firstChild) el.center.removeChild(el.center.firstChild);
    el.center.style.display = 'flex';
    el.center.style.flexDirection = 'column';
    el.center.style.alignItems = 'stretch';
    el.center.style.justifyContent = 'flex-start';
    el.center.style.width = '100%';
    const titleLine = document.createElement('div');
    titleLine.style.cssText = 'display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;font-size:12px;text-align:left;';
    const icon = document.createElement('span');
    icon.textContent = media.paused ? '▶️' : '⏸️';
    icon.style.flex = 'none';
    titleLine.appendChild(icon);
    const titleSpan = document.createElement('span');
    const indexPrefix = '';
    const name = getMediaName(media) || document.title || '本页媒体';
    const actionAffix = extra.actionLabel ? ` · ${extra.actionLabel}` : '';
    const fullTitle = (indexPrefix + name + actionAffix).slice(0, 120);
    titleSpan.textContent = fullTitle;
    titleSpan.title = fullTitle;
    titleSpan.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;';
    titleLine.appendChild(titleSpan);
    el.center.appendChild(titleLine);
    const statusLine = document.createElement('div');
    statusLine.style.cssText = 'margin-top:4px;display:flex;align-items:center;gap:14px;font-variant-numeric:tabular-nums;font-size:11px;opacity:.9;';
    const rateSpan = document.createElement('span');
    rateSpan.textContent = (media.playbackRate ? media.playbackRate.toFixed(2) : '1.00') + 'x';
    const volSpan = document.createElement('span');
    if (media.muted || media.volume === 0) volSpan.textContent = '🔇';
    else {
      const v = Math.round(media.volume * 100);
      if (v > 66) volSpan.textContent = '🔊 ' + v + '%';
      else if (v > 33) volSpan.textContent = '🔉 ' + v + '%';
      else volSpan.textContent = '🔈 ' + v + '%';
    }
    statusLine.appendChild(rateSpan);
    statusLine.appendChild(volSpan);
    el.center.appendChild(statusLine);
    if (el.prev) { el.prev.textContent = ''; el.prev.style.display = 'none'; }
    if (el.next) { el.next.textContent = ''; el.next.style.display = 'none'; }
    resetOverlayAutoHide();
    // 本地触发时不处于预览，开启进度条实时刷新
    STATE.seekPreviewActive = false;
    ensureProgressTick();
  }
  function formatTime(t) {
    if (!isFinite(t)) return '--:--';
    t = Math.floor(t);
    const s = t % 60, m = Math.floor((t / 60) % 60), h = Math.floor(t / 3600);
    if (h) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }
  function seekBy(deltaSec) {
    const media = getActiveMedia();
    if (!media) { showHUD('未找到媒体'); return; }
    try {
      const next = media.currentTime + deltaSec;
      media.currentTime = Math.max(0, Math.min(isFinite(media.duration) ? media.duration : next, next));
      updateLocalOverlay({actionLabel: `${deltaSec>=0? '快进':'快退'} ${Math.abs(deltaSec)}s`});
    } catch { showHUD('无法快进/快退'); }
  }
  function setRate(rate) {
    const media = getActiveMedia();
    if (!media) { showHUD('未找到媒体'); return; }
    rate = Math.max(0.06, Math.min(16, rate));
    media.playbackRate = rate;
    updateLocalOverlay({actionLabel: `速度 ${rate.toFixed(2)}×`});
  }
  function adjustRate(delta) {
    const media = getActiveMedia();
    if (!media) { showHUD('未找到媒体'); return; }
    const newRate = Math.max(0.06, Math.min(16, (media.playbackRate || 1) + delta));
    media.playbackRate = newRate;
    updateLocalOverlay({actionLabel: `速度 ${newRate.toFixed(2)}×`});
  }
  function togglePlay() {
    const media = getActiveMedia();
    if (!media) { showHUD('未找到媒体'); return; }
    if (media.paused) { media.play?.(); }
    else { media.pause?.(); }
    updateLocalOverlay({actionLabel: media.paused ? '暂停' : '播放'});
  }
  // 统一为后台消息调用封装一个操作后展示覆盖层的辅助
  function showOverlayForMedia(media, label) {
    if (!media) return;
    updateLocalOverlay({ actionLabel: label });
  }
  async function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
  }
  async function screenshotVideo() {
    const video = getActiveMedia();
    if (!(video instanceof HTMLVideoElement)) return showHUD('未找到可截图的视频');
    const ts = new Date();
    const fname = `gmcx_${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}_${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}${String(ts.getSeconds()).padStart(2,'0')}.png`;
    try {
      const w = Math.max(1, video.videoWidth || video.clientWidth);
      const h = Math.max(1, video.videoHeight || video.clientHeight);
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
      await saveBlob(blob, fname); showHUD(`已截图 (原始分辨率 ${w}×${h})`); return;
    } catch (e) { console.debug('Direct video frame grab failed, fallback:', e); }
    const rect = video.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    chrome.runtime.sendMessage({ type: 'gmcx-capture-visible-tab' }, async (resp) => {
      if (!resp?.ok) return showHUD('截图失败（无法捕获标签页）');
      const img = new Image();
      img.onload = async () => {
        try {
          const sx = Math.max(0, Math.floor(rect.left * dpr));
          const sy = Math.max(0, Math.floor(rect.top * dpr));
          const sw = Math.max(1, Math.floor(rect.width * dpr));
          const sh = Math.max(1, Math.floor(rect.height * dpr));
          const canvas = document.createElement('canvas'); canvas.width = sw; canvas.height = sh;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
          const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
          await saveBlob(blob, fname); showHUD(`已截图 (可见区域裁剪 ${sw}×${sh})`);
        } catch { showHUD('截图失败（裁剪异常）'); }
      };
      img.onerror = () => showHUD('截图失败（解码错误）');
      img.src = resp.dataUrl;
    });
  }
  function cycleSpeed(media) {
    if (!media) return showHUD('未找到媒体');
    // 如果当前速率不在 cycleList 中，先插入
    let idx = STATE.speedCycleList.indexOf(Number(media.playbackRate) || 1);
    if (idx === -1) {
      // 将其插入并排序
      const nr = Number(media.playbackRate) || 1;
      STATE.speedCycleList.push(nr);
      STATE.speedCycleList.sort((a,b) => a-b);
      idx = STATE.speedCycleList.indexOf(nr);
    }
    idx = (idx + 1) % STATE.speedCycleList.length;
    const next = STATE.speedCycleList[idx];
    media.playbackRate = next;
    updateLocalOverlay({actionLabel: `速度 ${next.toFixed(2)}×`});
  }

  function startFineSeek(dir) {
    if (STATE.fineSeekActive && STATE.fineSeekDir === dir) return;
    STATE.fineSeekActive = true;
    STATE.fineSeekDir = dir;
    const stepOnce = () => {
      const media = getActiveMedia();
      if (!media) return;
      try {
        let target = media.currentTime + dir * STATE.fineSeekStep;
        if (isFinite(media.duration)) target = Math.min(Math.max(0, target), media.duration);
        media.currentTime = target;
        updateFineOverlay(media);
      } catch {}
    };
    stepOnce();
    STATE.fineSeekTimer = setInterval(stepOnce, 90);
  }
  function stopFineSeek(dir) {
    if (!STATE.fineSeekActive) return;
    if (dir && dir !== STATE.fineSeekDir) return;
    clearInterval(STATE.fineSeekTimer);
    STATE.fineSeekActive = false;
    STATE.fineSeekDir = 0;
    hideFineOverlay();
  }

  function ensureFineOverlay() {
    if (STATE.fineOverlayEl) return STATE.fineOverlayEl;
    const wrap = document.createElement('div');
    wrap.id = 'gmcx-fine-overlay';
    wrap.style.cssText = `position:fixed;left:50%;bottom:4%;transform:translateX(-50%);width:60%;max-width:760px;z-index:2147483647;
      background:rgba(18,20,24,.72);padding:10px 14px 14px;border-radius:16px;box-shadow:0 6px 26px rgba(0,0,0,.4);color:#fff;
      font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;backdrop-filter:blur(10px) saturate(150%);opacity:0;transition:opacity .18s ease;`;
    const barOuter = document.createElement('div');
    barOuter.style.cssText = 'position:relative;width:100%;height:8px;background:rgba(255,255,255,.18);border-radius:6px;overflow:hidden;margin-top:4px;';
    const barFill = document.createElement('div');
    barFill.style.cssText = 'position:absolute;left:0;top:0;height:100%;width:0;background:linear-gradient(90deg,#4facfe,#00f2fe);transition:width .08s;';
    const label = document.createElement('div');
    label.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-top:4px;font-weight:500;';
    const left = document.createElement('span');
    const center = document.createElement('span');
    center.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;padding:0 6px;';
    const right = document.createElement('span');
    label.appendChild(left); label.appendChild(center); label.appendChild(right);
    // 侧向轮播预览容器
    const carousel = document.createElement('div');
    carousel.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:6px;opacity:.85;font-size:11px;gap:12px;';
    const prev = document.createElement('div');
    const next = document.createElement('div');
    prev.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.45;text-align:left;min-height:16px;';
    next.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.45;text-align:right;min-height:16px;';
    carousel.appendChild(prev); carousel.appendChild(next);
    barOuter.appendChild(barFill);
    wrap.appendChild(label);
    wrap.appendChild(barOuter);
    wrap.appendChild(carousel);
    document.documentElement.appendChild(wrap);
    STATE.fineOverlayEl = { wrap, barFill, left, center, right, prev, next };
    return STATE.fineOverlayEl;
  }
  function updateFineOverlay(media) {
    const el = ensureFineOverlay();
    el.wrap.style.opacity = '1';
    const cur = media.currentTime || 0;
    const dur = isFinite(media.duration) ? media.duration : cur + 1;
    const pct = dur ? (cur / dur) * 100 : 0;
    el.barFill.style.width = pct.toFixed(3) + '%';
    el.left.textContent = formatTime(cur);
    el.right.textContent = isFinite(media.duration) ? formatTime(media.duration) : '--:--';
    el.center.textContent = `微调 ${STATE.fineSeekDir>0?'+':'-'}${STATE.fineSeekStep.toFixed(2)}s`; // 中间显示步长方向
    resetOverlayAutoHide();
  }
  function hideFineOverlay() {
    if (!STATE.fineOverlayEl) return;
    STATE.fineOverlayEl.wrap.style.opacity = '0';
    STATE.overlayVisible = false;
    stopProgressTick();
    // 通知后台覆盖层已隐藏，用于恢复到本页优先控制
    try { chrome.runtime.sendMessage({type:'gmcx-overlay-hidden'}); } catch {}
  }
  function resetOverlayAutoHide() {
    clearTimeout(STATE.overlayHideTimer);
    STATE.overlayHideTimer = setTimeout(() => {
      // 若正在微调，不隐藏（可选策略：即使微调也隐藏；当前保留）
      if (STATE.fineSeekActive) return;
      hideFineOverlay();
    }, STATE.overlayHideDelay);
  }

  // ===== 覆盖层进度条实时刷新（绑定当前活动媒体） =====
  function progressTick() {
    STATE.progressRafId = 0;
    if (!STATE.overlayVisible) return;
    try {
      if (!STATE.seekPreviewActive) {
        const media = getActiveMedia();
        if (media) {
          const el = ensureFineOverlay();
          const cur = media.currentTime || 0;
          const dur = isFinite(media.duration) ? media.duration : cur + 1;
          const pct = dur ? (cur / dur) * 100 : 0;
          el.barFill.style.width = pct.toFixed(3) + '%';
          el.left.textContent = formatTime(cur);
          el.right.textContent = isFinite(media.duration) ? formatTime(media.duration) : '--:--';
        }
      }
    } catch {}
    STATE.progressRafId = requestAnimationFrame(progressTick);
  }
  function ensureProgressTick() {
    if (!STATE.overlayVisible) return;
    if (STATE.progressRafId) return;
    STATE.progressRafId = requestAnimationFrame(progressTick);
  }
  function stopProgressTick() {
    if (STATE.progressRafId) {
      cancelAnimationFrame(STATE.progressRafId);
      STATE.progressRafId = 0;
    }
  }

  window.addEventListener('keydown', (e) => {
    const t = e.target, editable = t && (t.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(t.tagName));
    if (editable) return;
    if (e.altKey && e.shiftKey) {
      let handled = false;
      switch (e.code) {
        // 将 V/J/K/L 转发给后台统一处理（即使 chrome.commands 不可用也可工作）
        case 'KeyV': {
          try { chrome.runtime.sendMessage({ type: 'gmcx-command', command: 'cycle-video' }); } catch {}
          handled = true; e.preventDefault(); break; }
        case 'KeyJ': {
          // 先本地立即显示覆盖层，提升反馈速度
          updateLocalOverlay({actionLabel: `快退 ${Math.abs(STATE.seekStep)}s`});
          try { chrome.runtime.sendMessage({ type: 'gmcx-command', command: 'seek-back' }); } catch {}
          handled = true; e.preventDefault(); break; }
        case 'KeyK': {
          // 先本地立即显示覆盖层（不改变状态，仅提示）
          try {
            const m = getActiveMedia();
            if (m) updateLocalOverlay({actionLabel: m.paused ? '播放' : '暂停'});
          } catch {}
          try { chrome.runtime.sendMessage({ type: 'gmcx-command', command: 'toggle-play-pause' }); } catch {}
          handled = true; e.preventDefault(); break; }
        case 'KeyL': {
          // 先本地立即显示覆盖层，提升反馈速度
          updateLocalOverlay({actionLabel: `快进 ${Math.abs(STATE.seekStep)}s`});
          try { chrome.runtime.sendMessage({ type: 'gmcx-command', command: 'seek-forward' }); } catch {}
          handled = true; e.preventDefault(); break; }
        // 其他按键保留原处理
        case 'Comma': { // Alt+Shift+< 音量降低
          chrome.runtime.sendMessage({type:'gmcx-global-volume', action:'down'});
          handled = true; e.preventDefault(); break; }
        case 'Period': { // Alt+Shift+> 音量增加
          chrome.runtime.sendMessage({type:'gmcx-global-volume', action:'up'});
          handled = true; e.preventDefault(); break; }
        case 'KeyM': { // 静音/取消静音（后台会基于全局/当前活动自动定位）
          try {
            chrome.runtime.sendMessage({ type: 'gmcx-toggle-mute' }, (resp) => {
              if (!resp || !resp.ok) {
                const media = getActiveMedia();
                if (media) {
                  media.muted = !media.muted;
                  updateLocalOverlay({actionLabel: media.muted ? '静音' : '取消静音'});
                }
              }
            });
          } catch {
            const media = getActiveMedia();
            if (media) {
              media.muted = !media.muted;
              updateLocalOverlay({actionLabel: media.muted ? '静音' : '取消静音'});
            }
          }
          handled = true; e.preventDefault(); break;
        }
        case 'KeyU': { // 全局加速
          chrome.runtime.sendMessage({type:'gmcx-global-speed', action:'up'});
          handled = true; e.preventDefault(); break; }
        case 'KeyO': { // 全局减速
          chrome.runtime.sendMessage({type:'gmcx-global-speed', action:'down'});
          handled = true; e.preventDefault(); break; }
        case 'KeyI': { // 重置 1x
          chrome.runtime.sendMessage({type:'gmcx-global-speed', action:'reset'});
          handled = true; e.preventDefault(); break; }
        case 'KeyP': { // 循环预设
          chrome.runtime.sendMessage({type:'gmcx-global-speed', action:'cycle'});
          handled = true; e.preventDefault(); break; }
        case 'KeyS': { // 截图（本地行为，不影响全局）
          screenshotVideo();
          handled = true; e.preventDefault(); break; }
        default:
          // 其余 Alt+Shift 组合不在内容脚本处理，交给浏览器命令（如 V/J/K/L）
          break;
      }
      // 仅当确实由我们处理时，才阻止事件冒泡，避免影响 chrome.commands
      if (handled) e.stopImmediatePropagation();
    }
  }, true);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 最近渲染的全局覆盖层序号，防止旧消息覆盖新状态
    if (typeof STATE.lastOverlaySeq !== 'number') STATE.lastOverlaySeq = 0;
    // 1) popup/其他来源的统一命令（仅用于当前页面本地控制）
    if (msg?.type === 'gmcx-command') {
      if (msg.command === 'cycle-video') { cycleSelectedMedia(); sendResponse?.({ ok: true }); return true; }
      if (msg.command === 'toggle-play-pause') { togglePlay(); sendResponse?.({ ok: true }); return true; }
      if (msg.command === 'seek-forward') { seekBy(STATE.seekStep); sendResponse?.({ ok: true }); return true; }
      if (msg.command === 'seek-back') { seekBy(-STATE.seekStep); sendResponse?.({ ok: true }); return true; }
    }
    // 2) 后台统一全局覆盖层更新
    if (msg?.type === 'gmcx-global-overlay' && msg.action === 'update') {
      const p = msg.payload || {};
      if (typeof p.seq === 'number' && p.seq < STATE.lastOverlaySeq) {
        // 旧的消息，忽略，避免回退
        return true;
      }
      if (typeof p.seq === 'number') STATE.lastOverlaySeq = p.seq;
      // 对 seek 流程附加 opId 检查：仅渲染最近一次 seek 会话
      if (typeof p.opId === 'number') {
        if (typeof STATE.lastSeekOpId !== 'number') STATE.lastSeekOpId = -1;
        if (p.mode === 'seek-preview') {
          // 预览阶段提升 opId
          if (p.opId < STATE.lastSeekOpId) return true; // 旧预览
          STATE.lastSeekOpId = p.opId;
        } else if (p.mode === 'final' || p.mode === 'sync') {
          // 仅接受与当前 opId 相同或更大的提交/同步
          if (p.opId < STATE.lastSeekOpId) return true;
          STATE.lastSeekOpId = p.opId;
        }
      }
  const el = ensureFineOverlay();
  el.wrap.style.opacity = '1';
  STATE.overlayVisible = true;
      while (el.center.firstChild) el.center.removeChild(el.center.firstChild);
      el.center.style.display = 'flex';
      el.center.style.flexDirection = 'column';
      el.center.style.alignItems = 'stretch';
      el.center.style.justifyContent = 'flex-start';
      el.center.style.width = '100%';
      const titleLine = document.createElement('div');
      titleLine.style.cssText = 'display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;font-size:12px;text-align:left;';
      if (typeof p.paused === 'boolean') {
        const icon = document.createElement('span');
        icon.textContent = p.paused ? '▶️' : '⏸️';
        icon.style.flex = 'none';
        titleLine.appendChild(icon);
      }
      const titleSpan = document.createElement('span');
      let indexPrefix = '';
      if (typeof p.index === 'number' && typeof p.total === 'number' && p.total > 0) {
        indexPrefix = `[${p.index}/${p.total}] `;
      } else {
        try {
          const current = resolveSelectedMedia();
          const total = STATE.videosCache.length;
          if (current && total) indexPrefix = `[${Math.min(STATE.selectedIndex + 1, total)}/${total}] `;
        } catch {}
      }
      const baseTitle = p.title || '全局控制';
      const fullTitle = indexPrefix + baseTitle;
      titleSpan.textContent = fullTitle;
      titleSpan.title = fullTitle;
      titleSpan.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;';
      titleLine.appendChild(titleSpan);
      if (p.isLive) {
        const liveBadge = document.createElement('span');
        liveBadge.textContent = 'LIVE';
        liveBadge.style.cssText = 'flex:none;margin-left:8px;color:#e53935;font-weight:700;font-size:11px;letter-spacing:.5px;';
        titleLine.appendChild(liveBadge);
      }
      el.center.appendChild(titleLine);
      const statusLine = document.createElement('div');
      statusLine.style.cssText = 'margin-top:4px;display:flex;align-items:center;gap:14px;font-variant-numeric:tabular-nums;font-size:11px;opacity:.9;';
      const rateSpan = document.createElement('span');
      rateSpan.textContent = (typeof p.playbackRate === 'number' ? p.playbackRate.toFixed(2) : '1.00') + 'x';
      const volSpan = document.createElement('span');
      if (typeof p.volume === 'number') {
        let volIcon = '🔊';
        if (p.muted || p.volume === 0) volIcon = '🔇';
        else if (p.volume < 0.33) volIcon = '🔈';
        else if (p.volume < 0.66) volIcon = '🔉';
        volSpan.textContent = `${volIcon} ${Math.round(p.volume*100)}%`;
      } else if (p.muted) {
        volSpan.textContent = '🔇';
      } else {
        volSpan.textContent = '—';
      }
      statusLine.appendChild(rateSpan);
      statusLine.appendChild(volSpan);
      el.center.appendChild(statusLine);
      // Live 流：不显示预览偏移，左侧只显示当前；点播：预览显示目标
      // 预览态下不让 RAF 覆盖进度；提交/同步后恢复 RAF
      STATE.seekPreviewActive = !!p.preview;
      const leftLabel = (p.isLive ? (p.currentTime || '--:--') : (p.preview && typeof p.previewSeconds === 'number' ? formatTime(p.previewSeconds) : (p.currentTime || '--:--')));
      el.left.textContent = leftLabel;
      el.right.textContent = (p.isLive ? '直播' : (p.duration || '--:--'));
      const percent = Math.max(0, Math.min(100, p.percent || 0));
      el.barFill.style.width = percent.toFixed(3) + '%';
      // live 使用红色风格
      el.barFill.style.background = p.isLive ? 'linear-gradient(90deg,#ff5252,#ff1744)' : (p.preview ? 'linear-gradient(90deg,#ffb347,#ffcc33)' : 'linear-gradient(90deg,#4facfe,#00f2fe)');
      // 预览阶段：在下方左右区显示原位/目标标签
      if (p.preview && !p.isLive) {
        if (el.prev) { el.prev.textContent = `原位 ${p.currentTime || '--:--'}`; el.prev.style.display='block'; }
        if (el.next) {
          const delta = (typeof p.previewSeconds === 'number' && typeof p.currentTime === 'string') ? '' : '';
          el.next.textContent = `目标 ${formatTime(p.previewSeconds || 0)}`;
          el.next.style.display='block';
        }
      } else {
        if (el.prev) { el.prev.textContent=''; el.prev.style.display='none'; }
        if (el.next) { el.next.textContent=''; el.next.style.display='none'; }
      }
      resetOverlayAutoHide();
      ensureProgressTick();
      return true;
    }
    // 3) 本地媒体控制（支持 silent 抑制本地覆盖层，避免与全局覆盖层重叠）
    if (msg?.type === 'gmcx-play-media') { const media = getActiveMedia(); if (media && media.paused) media.play?.(); if (!msg.silent) showOverlayForMedia(media, '播放'); sendResponse({ ok: true }); return; }
    if (msg?.type === 'gmcx-pause-media') { const media = getActiveMedia(); if (media && !media.paused) media.pause?.(); if (!msg.silent) showOverlayForMedia(media, '暂停'); sendResponse({ ok: true }); return; }
    if (msg?.type === 'gmcx-mute-media') { const media = getActiveMedia(); if (media) { media.muted = true; if (!msg.silent) showOverlayForMedia(media, '静音'); } sendResponse({ok:true}); return; }
    if (msg?.type === 'gmcx-unmute-media') { const media = getActiveMedia(); if (media) { media.muted = false; if (!msg.silent) showOverlayForMedia(media, '取消静音'); } sendResponse({ok:true}); return; }
    if (msg?.type === 'gmcx-set-media-volume') { const media = getActiveMedia(); if (media) { const vol = Math.min(1, Math.max(0, Number(msg.value))); media.volume = vol; if (vol > 0 && media.muted) media.muted = false; if (!msg.silent) showOverlayForMedia(media, `音量 ${(vol*100).toFixed(0)}%`);} sendResponse({ok:true}); return; }
    if (msg?.type === 'gmcx-seek-media') { const media = getActiveMedia(); if (media && isFinite(media.duration)) { const delta = Number(msg.value) || 0; media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + delta)); if (!msg.silent) showOverlayForMedia(media, `${delta>=0? '快进':'快退'} ${Math.abs(delta)}s`);} sendResponse({ ok: true }); return; }
    if (msg?.type === 'gmcx-set-media-speed') { const media = getActiveMedia(); if (media) { media.playbackRate = Number(msg.value); if (!msg.silent) showOverlayForMedia(media, `速度 ${media.playbackRate.toFixed(2)}×`);} sendResponse({ ok: true }); return; }
    if (msg?.type === 'gmcx-reset-media') { const media = getActiveMedia(); if (media) { media.currentTime = 0; media.playbackRate = 1.0; if (!msg.silent) showOverlayForMedia(media, '重置'); } sendResponse({ ok: true }); return; }
    if (msg?.type === 'gmcx-set-media-currentTime') { const media = getActiveMedia(); if (media && isFinite(media.duration)) { const target = Math.max(0, Math.min(media.duration, Number(msg.value))); media.currentTime = target; if (!msg.silent) showOverlayForMedia(media, `跳转 ${formatTime(target)}`); } sendResponse({ ok: true }); return; }
    // 4) EQ 消息处理
    if (msg?.type === 'gmcx-eq-init') { loadCustomPresets(() => { const media = getActiveMedia(); if (!media) { sendResponse({ok:false}); return; } ensureMediaEQ(media); const gains = (EQ.sourceMap.get(media)?.filters || []).map(f => f.gain.value); sendResponse({ok:true, freqs: EQ.freqs, gains, builtin: EQ.builtinPresets, custom: EQ.customPresets}); }); return true; }
    if (msg?.type === 'gmcx-eq-get-state') { const media = getActiveMedia(); if (!media) { sendResponse({ok:false}); return; } const entry = ensureMediaEQ(media); const gains = entry ? entry.filters.map(f => f.gain.value) : EQ.freqs.map(()=>0); sendResponse({ok:true, gains}); try { const modified = gains.some(v => Math.abs(Number(v)||0) > 0.0001); chrome.runtime.sendMessage({ type: 'gmcx-eq-modified-state', modified }); } catch {} return; }
    if (msg?.type === 'gmcx-eq-set-band') { const media = getActiveMedia(); if (!media) { sendResponse({ok:false}); return; } const entry = ensureMediaEQ(media); if (!entry) { sendResponse({ok:false}); return; } const { index, value } = msg; if (typeof index === 'number' && entry.filters[index]) { const v = Math.max(EQ.ranges.min, Math.min(EQ.ranges.max, Number(value))); entry.filters[index].gain.value = v; const gainsNow = entry.filters.map(f => f.gain.value); saveEQForPage(gainsNow); try { const modified = gainsNow.some(x => Math.abs(Number(x)||0) > 0.0001); chrome.runtime.sendMessage({ type: 'gmcx-eq-modified-state', modified }); } catch {} } sendResponse({ok:true}); return; }
    if (msg?.type === 'gmcx-eq-apply-preset') { const media = getActiveMedia(); if (!media) { sendResponse({ok:false}); return; } const name = msg.name; loadCustomPresets(() => { const preset = [...EQ.builtinPresets, ...EQ.customPresets].find(p => p.name === name); if (!preset) { sendResponse({ok:false}); return; } applyGains(media, preset.gains); saveEQForPage(preset.gains); try { const modified = preset.gains.some(v => Math.abs(Number(v)||0) > 0.0001); chrome.runtime.sendMessage({ type: 'gmcx-eq-modified-state', modified }); } catch {} sendResponse({ok:true}); }); return true; }
    if (msg?.type === 'gmcx-eq-reset') { const media = getActiveMedia(); if (!media) { sendResponse({ok:false}); return; } const zero = EQ.freqs.map(()=>0); if (applyGains(media, zero)) { saveEQForPage(zero); try { chrome.runtime.sendMessage({ type: 'gmcx-eq-modified-state', modified: false }); } catch {} sendResponse({ok:true}); } else { sendResponse({ok:false}); } return; }
    if (msg?.type === 'gmcx-eq-clear-page') { clearEQForPage(() => sendResponse({ok:true})); return true; }
    if (msg?.type === 'gmcx-eq-save-preset') { const media = getActiveMedia(); if (!media) { sendResponse({ok:false}); return; } const entry = ensureMediaEQ(media); if (!entry) { sendResponse({ok:false}); return; } const gains = entry.filters.map(f => f.gain.value); loadCustomPresets(() => { const name = String(msg.name || '').trim().slice(0,40) || ('Preset'+Date.now()); const existIdx = EQ.customPresets.findIndex(p => p.name === name); if (existIdx >= 0) EQ.customPresets[existIdx] = {name, gains}; else EQ.customPresets.push({name, gains}); saveCustomPresets(); sendResponse({ok:true, name}); }); return true; }
    if (msg?.type === 'gmcx-eq-delete-preset') { loadCustomPresets(() => { const name = msg.name; const before = EQ.customPresets.length; EQ.customPresets = EQ.customPresets.filter(p => p.name !== name); if (EQ.customPresets.length !== before) saveCustomPresets(); sendResponse({ok:true}); }); return true; }
    // 5) 全局媒体探测（供后台扫描使用）
  if (msg?.type === 'gmcx-get-media-info') {
      const blacklist = ['https://www.bilibili.com/','https://www.douyu.com/'];
      if (blacklist.includes(window.location.href)) { sendResponse({ ok: false }); return; }
      if (window.top !== window.self) { sendResponse({ ok: false }); return; }
      const candidates = collectVideos();
      const media = candidates[0] || null;
      if (!media) { sendResponse({ ok: false }); return; }
      if (media instanceof HTMLVideoElement && ((media.muted || media.volume === 0) && (media.currentTime || 0) < 3) && (media.videoWidth < 240 || media.videoHeight < 180 || media.clientWidth < 240 || media.clientHeight < 180)) {
        sendResponse({ ok: false }); return;
      }
  const type = media instanceof HTMLVideoElement ? 'video' : 'audio';
  const isLive = !isFinite(media.duration);
      const paused = !!media.paused;
      const currentTime = formatTime(media.currentTime);
      const duration = formatTime(media.duration);
      let thumbnail = '';
      if (type === 'video') { thumbnail = media.poster || ''; }
      sendResponse({ ok: true, type, isLive, paused, currentTime, duration, rawCurrentTime: media.currentTime, rawDuration: media.duration, playbackRate: media.playbackRate, thumbnail, muted: media.muted, volume: media.volume });
      return;
    }
  });
})();