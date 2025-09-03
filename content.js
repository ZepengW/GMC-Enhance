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
    fineOverlayEl: null
  };
  chrome.storage.sync.get({ seekStep: 5, speedStep: 0.25 }, (cfg) => {
    STATE.seekStep = Number(cfg.seekStep) || 5;
    STATE.speedStep = Number(cfg.speedStep) || 0.25;
  });
  function collectVideos() {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 60 && rect.height > 60 && !!(el.offsetParent || rect.top >= 0);
    };
    const medias = Array.from(document.querySelectorAll('video, audio')).filter(isVisible).filter(el => {
      if (!(el instanceof HTMLMediaElement)) return false;
      if (el.readyState < 1) return false; // 允许更早加载
      if (el.ended) return false;
      return true;
    });
    // 排序：大尺寸视频优先，其次音频/小视频
    medias.sort((a,b) => {
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
    // 回退原逻辑（保持兼容）
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 60 && rect.height > 60 && !!(el.offsetParent || rect.top >= 0);
    };
    // 过滤掉典型预览视频和无效视频
    const isValidMedia = (el) => {
      if (!(el instanceof HTMLVideoElement || el instanceof HTMLAudioElement)) return false;
      // src 为空或 blob:about:blank
      // if (!el.src || el.src === 'about:blank' || el.src.startsWith('blob:')) return false;
      // readyState < 2 表示未加载
      if (el.readyState < 2) return false;
      // 已播放结束
      if (el.ended) return false;
      // 页面非活跃时不显示（可选）
      // if (document.visibilityState && document.visibilityState !== 'visible') return false;
      // 典型预览视频
      if (el instanceof HTMLVideoElement) {
        const ct = el.currentTime || 0;
        const isMuted = el.muted || el.volume === 0;
        const isPaused = el.paused;
        const small = el.videoWidth < 120 || el.videoHeight < 90 || el.clientWidth < 120 || el.clientHeight < 90;
        if (isMuted && isPaused && ct < 1.5 && small) return false;
      }
      return true;
    };
    let videos = Array.from(document.querySelectorAll('video')).filter(isVisible).filter(isValidMedia);
    if (videos.length) {
      videos.sort((a,b) => (b.clientWidth*b.clientHeight) - (a.clientWidth*a.clientHeight));
      return videos[0];
    }
    const audios = Array.from(document.querySelectorAll('audio')).filter(isVisible).filter(isValidMedia);
    return audios[0] || null;
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
  function formatTime(t) {
    if (!isFinite(t)) return '--:--';
    t = Math.floor(t);
    const s = t % 60, m = Math.floor((t / 60) % 60), h = Math.floor(t / 3600);
    if (h) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }
  function seekBy(deltaSec) {
    const media = getActiveMedia();
    if (!media) return showHUD('未找到媒体');
    try {
      const next = media.currentTime + deltaSec;
      media.currentTime = Math.max(0, Math.min(isFinite(media.duration) ? media.duration : next, next));
      showHUD(`${deltaSec>=0? '快进':'快退'} ${Math.abs(deltaSec)}s → ${formatTime(media.currentTime)}`);
    } catch { showHUD('无法快进/快退'); }
  }
  function setRate(rate) {
    const media = getActiveMedia();
    if (!media) return showHUD('未找到媒体');
    rate = Math.max(0.06, Math.min(16, rate));
    media.playbackRate = rate;
    showHUD(`速度 ${rate.toFixed(2)}×`);
  }
  function adjustRate(delta) {
    const media = getActiveMedia();
    if (!media) return showHUD('未找到媒体');
    const newRate = Math.max(0.06, Math.min(16, (media.playbackRate || 1) + delta));
    media.playbackRate = newRate;
    showHUD(`速度 ${newRate.toFixed(2)}×`);
  }
  function togglePlay() {
    const media = getActiveMedia();
    if (!media) return showHUD('未找到媒体');
    if (media.paused) { media.play?.(); showHUD('▶ 播放'); }
    else { media.pause?.(); showHUD('⏸ 暂停'); }
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
    showHUD(`速度 ${next.toFixed(2)}×`);
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
    const right = document.createElement('span');
    label.appendChild(left); label.appendChild(center); label.appendChild(right);
    barOuter.appendChild(barFill);
    wrap.appendChild(label);
    wrap.appendChild(barOuter);
    document.documentElement.appendChild(wrap);
    STATE.fineOverlayEl = { wrap, barFill, left, center, right };
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
  }
  function hideFineOverlay() {
    if (!STATE.fineOverlayEl) return;
    STATE.fineOverlayEl.wrap.style.opacity = '0';
  }

  window.addEventListener('keydown', (e) => {
    const t = e.target, editable = t && (t.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(t.tagName));
    if (editable) return;
    if (e.altKey && e.shiftKey) {
      switch (e.code) {
        case 'ArrowRight': seekBy(STATE.seekStep); e.preventDefault(); break;
        case 'ArrowLeft':  seekBy(-STATE.seekStep); e.preventDefault(); break;
        case 'ArrowUp':    adjustRate(STATE.speedStep); e.preventDefault(); break;
        case 'ArrowDown':  adjustRate(-STATE.speedStep); e.preventDefault(); break;
        case 'KeyK':       togglePlay(); e.preventDefault(); break;
        case 'KeyL':       seekBy(STATE.seekStep); e.preventDefault(); break;
        case 'KeyJ':       seekBy(-STATE.seekStep); e.preventDefault(); break;
        case 'KeyI':       adjustRate(STATE.speedStep); e.preventDefault(); break;
        case 'KeyU':       adjustRate(-STATE.speedStep); e.preventDefault(); break;
        case 'KeyO': { // 改为循环倍速
          const m = getActiveMedia();
          cycleSpeed(m);
          e.preventDefault();
          break;
        }
        case 'KeyS':       screenshotVideo(); e.preventDefault(); break;
        case 'KeyM': { // 备用：与 cycle-video 命令一致
          cycleSelectedMedia();
          e.preventDefault();
          break;
        }
      }
    }
    // 无修饰键时的线性微调：按住 A / D (或 H / L) 实现连续微调
    if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.code === 'KeyD' || e.code === 'ArrowRight') { startFineSeek(1); }
      else if (e.code === 'KeyA' || e.code === 'ArrowLeft') { startFineSeek(-1); }
    }
  }, true);

  window.addEventListener('keyup', (e) => {
    if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.code === 'KeyD' || e.code === 'ArrowRight') stopFineSeek(1);
      else if (e.code === 'KeyA' || e.code === 'ArrowLeft') stopFineSeek(-1);
    }
  });
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 新增：支持 popup.js 控制消息
    if (msg?.type === 'gmcx-command') {
      if (msg.command === 'cycle-video') {
        cycleSelectedMedia();
        sendResponse?.({ ok: true });
        return true;
      }
      if (msg.command === 'toggle-play-pause') {
        togglePlay();
        sendResponse?.({ ok: true });
        return true;
      }
      if (msg.command === 'seek-forward') {
        seekBy(STATE.seekStep);
        sendResponse?.({ ok: true });
        return true;
      }
      if (msg.command === 'seek-back') {
        seekBy(-STATE.seekStep);
        sendResponse?.({ ok: true });
        return true;
      }
    }
    if (msg?.type === 'gmcx-global-overlay') {
      if (msg.action === 'update') {
        const p = msg.payload || {};
        const el = ensureFineOverlay(); // 复用 fine overlay 容器结构以减少样式重复
        el.wrap.style.opacity = '1';
        // 标题 & 模式
        el.center.textContent = p.title ? (p.title.slice(0,60)) : '全局控制';
        // 时间显示逻辑：如果是预览（seek 预估），currentTime 显示预估秒；否则显示真实
        const leftLabel = p.preview && typeof p.previewSeconds === 'number' ? formatTime(p.previewSeconds) : (p.currentTime || '--:--');
        el.left.textContent = leftLabel;
        el.right.textContent = p.duration || '--:--';
        const percent = Math.max(0, Math.min(100, p.percent || 0));
        el.barFill.style.width = percent.toFixed(3) + '%';
        if (p.preview) {
          el.barFill.style.background = 'linear-gradient(90deg,#ffb347,#ffcc33)';
        } else {
          el.barFill.style.background = 'linear-gradient(90deg,#4facfe,#00f2fe)';
        }
        return true;
      }
    }
    if (msg?.type === 'gmcx-play-media') {
      const media = getActiveMedia();
      if (media && media.paused) media.play?.();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'gmcx-pause-media') {
      const media = getActiveMedia();
      if (media && !media.paused) media.pause?.();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'gmcx-seek-media') {
      const media = getActiveMedia();
      if (media && isFinite(media.duration)) {
        media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + Number(msg.value)));
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'gmcx-set-media-speed') {
      const media = getActiveMedia();
      if (media) media.playbackRate = Number(msg.value);
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'gmcx-reset-media') {
      const media = getActiveMedia();
      if (media) {
        media.currentTime = 0;
        media.playbackRate = 1.0;
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'gmcx-get-media-info') {
      // 黑名单页面过滤（严格匹配）
      const blacklist = [
        // 规避主页打开视频，主页不关闭，显示两个视频卡片的问题
        'https://www.bilibili.com/',
        // 可继续添加其他页面
      ];
      if (blacklist.includes(window.location.href)) {
        sendResponse({ ok: false });
        return;
      }
      // 仅顶层页面返回媒体信息，避免 iframe 重复
      if (window.top !== window.self) {
        sendResponse({ ok: false });
        return;
      }
      const media = getActiveMedia();
      if (!media) {
        sendResponse({ ok: false });
        return;
      }
      // 再次过滤典型预览视频，防止误报
      if (
        media instanceof HTMLVideoElement &&
        (media.muted || media.volume === 0) &&
        media.paused &&
        (media.currentTime || 0) < 1.5 &&
        (media.videoWidth < 120 || media.videoHeight < 90 || media.clientWidth < 120 || media.clientHeight < 90)
      ) {
        sendResponse({ ok: false });
        return;
      }
      const type = media instanceof HTMLVideoElement ? 'video' : 'audio';
      const paused = !!media.paused;
      const currentTime = formatTime(media.currentTime);
      const duration = formatTime(media.duration);
      // 获取视频 poster 作为缩略图
      let thumbnail = '';
      if (type === 'video') {
        thumbnail = media.poster || '';
      }
      sendResponse({
        ok: true,
        type,
        paused,
        currentTime,
        duration,
        rawCurrentTime: media.currentTime,
        rawDuration: media.duration,
        playbackRate: media.playbackRate,
        thumbnail
      });
      return;
    }
    if (msg?.type === 'gmcx-set-media-currentTime') {
      const media = getActiveMedia();
      if (media && isFinite(media.duration)) {
        media.currentTime = Math.max(0, Math.min(media.duration, Number(msg.value)));
      }
      sendResponse({ ok: true });
      return;
    }
  });
})();