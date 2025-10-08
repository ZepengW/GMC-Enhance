const seekStepEl = document.getElementById('seekStep');
const speedStepEl = document.getElementById('speedStep');
const volumeStepEl = document.getElementById('volumeStep');
const saveBtn = document.getElementById('save');
chrome.storage.sync.get({ seekStep: 15, speedStep: 0.5, volumeStep: 0.1 }, (cfg) => {
  seekStepEl.value = cfg.seekStep;
  speedStepEl.value = cfg.speedStep;
  if (volumeStepEl) volumeStepEl.value = cfg.volumeStep;
});
saveBtn.addEventListener('click', () => {
  const seekStep = Math.max(1, Number(seekStepEl.value) || 15);
  const speedStep = Math.max(0.05, Number(speedStepEl.value) || 0.5);
  let volumeStep = Number(volumeStepEl && volumeStepEl.value);
  if (!isFinite(volumeStep)) volumeStep = 0.1;
  volumeStep = Math.min(0.5, Math.max(0.01, volumeStep));
  chrome.storage.sync.set({ seekStep, speedStep, volumeStep }, () => {
    saveBtn.textContent = '已保存';
    setTimeout(() => (saveBtn.textContent = '保存'), 1200);
  });
});