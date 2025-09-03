(() => {
  const STATE = { seekStep: 5, speedStep: 0.25, hudEl: null, hudTimer: null };
  chrome.storage.sync.get({ seekStep: 5, speedStep: 0.25 }, (cfg) => {
    STATE.seekStep = Number(cfg.seekStep) || 5;
    STATE.speedStep = Number(cfg.speedStep) || 0.25;
  });
  function getActiveMedia() {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 30 && rect.height > 30 && !!(el.offsetParent || rect.top >= 0);
    };
    const videos = Array.from(document.querySelectorAll('video')).filter(isVisible);
    if (videos.length) {
      videos.sort((a,b) => (b.clientWidth*b.clientHeight) - (a.clientWidth*a.clientHeight));
      return videos[0];
    }
    const audios = Array.from(document.querySelectorAll('audio'));
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
        case 'KeyO':       setRate(1.0); e.preventDefault(); break;
        case 'KeyS':       screenshotVideo(); e.preventDefault(); break;
      }
    }
  }, true);
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'gmcx-command') {
      switch (msg.command) {
        case 'toggle-play-pause': togglePlay(); break;
        case 'seek-forward': seekBy(STATE.seekStep); break;
        case 'seek-back': seekBy(-STATE.seekStep); break;
        case 'speed-up': adjustRate(STATE.speedStep); break;
        case 'speed-down': adjustRate(-STATE.speedStep); break;
        case 'speed-reset': setRate(1.0); break;
        case 'screenshot': screenshotVideo(); break;
      }
      return;
    }
    if (msg?.type === 'gmcx-get-media-info') {
      const media = getActiveMedia();
      if (!media) {
        sendResponse({ ok: false });
        return;
      }
      const type = media instanceof HTMLVideoElement ? 'video' : 'audio';
      const paused = !!media.paused;
      const currentTime = formatTime(media.currentTime);
      const duration = formatTime(media.duration);
      sendResponse({
        ok: true,
        type,
        paused,
        currentTime,
        duration,
        rawCurrentTime: media.currentTime,
        rawDuration: media.duration
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