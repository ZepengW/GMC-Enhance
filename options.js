const seekStepEl = document.getElementById('seekStep');
const speedStepEl = document.getElementById('speedStep');
const saveBtn = document.getElementById('save');
chrome.storage.sync.get({ seekStep: 5, speedStep: 0.25 }, (cfg) => {
  seekStepEl.value = cfg.seekStep;
  speedStepEl.value = cfg.speedStep;
});
saveBtn.addEventListener('click', () => {
  const seekStep = Math.max(1, Number(seekStepEl.value) || 5);
  const speedStep = Math.max(0.05, Number(speedStepEl.value) || 0.25);
  chrome.storage.sync.set({ seekStep, speedStep }, () => {
    saveBtn.textContent = '已保存';
    setTimeout(() => (saveBtn.textContent = '保存'), 1200);
  });
});