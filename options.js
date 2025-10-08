const DEFAULT_KEYMAP = {
  cycleVideo: 'Alt+Shift+KeyV',
  togglePlayPause: 'Alt+Shift+KeyK',
  seekBack: 'Alt+Shift+KeyJ',
  seekForward: 'Alt+Shift+KeyL',
  volumeDown: 'Alt+Shift+Comma',
  volumeUp: 'Alt+Shift+Period',
  toggleMute: 'Alt+Shift+KeyM',
  speedDown: 'Alt+Shift+KeyU',
  speedUp: 'Alt+Shift+KeyO',
  speedReset: 'Alt+Shift+KeyI',
  speedCycle: 'Alt+Shift+KeyP',
  screenshot: 'Alt+Shift+KeyS'
};

const KEY_ACTIONS = [
  { id: 'cycleVideo', label: '切换控制视频', description: '在检测到的音视频之间循环选择' },
  { id: 'togglePlayPause', label: '播放/暂停', description: '切换当前选中媒体的播放状态' },
  { id: 'seekBack', label: '快退', description: '按设置的步长回退进度' },
  { id: 'seekForward', label: '快进', description: '按设置的步长快进进度' },
  { id: 'volumeDown', label: '音量降低', description: '按设置的百分比降低音量' },
  { id: 'volumeUp', label: '音量提高', description: '按设置的百分比提高音量' },
  { id: 'toggleMute', label: '静音/取消静音', description: '切换当前媒体的静音状态' },
  { id: 'speedDown', label: '减速播放', description: '按设置的步长降低播放速度' },
  { id: 'speedUp', label: '加速播放', description: '按设置的步长提升播放速度' },
  { id: 'speedReset', label: '重置速度', description: '将播放速度恢复为 1×' },
  { id: 'speedCycle', label: '循环预设速度', description: '在倍速预设之间轮换' },
  { id: 'screenshot', label: '截图当前视频', description: '捕获当前选中视频的一帧' }
];

const MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Meta'];
const MODIFIER_PROP = { Control: 'ctrlKey', Alt: 'altKey', Shift: 'shiftKey', Meta: 'metaKey' };
const MODIFIER_CODE_SET = new Set(['ShiftLeft','ShiftRight','AltLeft','AltRight','ControlLeft','ControlRight','MetaLeft','MetaRight']);
const CODE_DISPLAY_MAP = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: '\'',
  Backquote: '`',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter'
};

const seekStepEl = document.getElementById('seekStep');
const speedStepEl = document.getElementById('speedStep');
const volumeStepEl = document.getElementById('volumeStep');
const saveBtn = document.getElementById('save');
const keymapTableBody = document.getElementById('keymap-tbody');
const resetKeymapBtn = document.getElementById('resetKeymap');
const keymapInputs = {};

renderKeymapTable();

chrome.storage.sync.get({ seekStep: 15, speedStep: 0.5, volumeStep: 0.1, keymap: {} }, (cfg) => {
  seekStepEl.value = cfg.seekStep;
  speedStepEl.value = cfg.speedStep;
  if (volumeStepEl) volumeStepEl.value = cfg.volumeStep;
  applyKeymapToInputs(cfg.keymap);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.keymap) {
    applyKeymapToInputs(changes.keymap.newValue || {});
  }
});

saveBtn.addEventListener('click', () => {
  const seekStep = Math.max(1, Number(seekStepEl.value) || 15);
  const speedStep = Math.max(0.05, Number(speedStepEl.value) || 0.5);
  let volumeStep = Number(volumeStepEl && volumeStepEl.value);
  if (!isFinite(volumeStep)) volumeStep = 0.1;
  volumeStep = Math.min(0.5, Math.max(0.01, volumeStep));

  KEY_ACTIONS.forEach(({ id }) => keymapInputs[id].classList.remove('key-conflict'));
  const seen = new Map();
  let conflict = false;
  KEY_ACTIONS.forEach(({ id }) => {
    const combo = keymapInputs[id].dataset.combo;
    if (!combo) return;
    if (seen.has(combo)) {
      conflict = true;
      keymapInputs[id].classList.add('key-conflict');
      keymapInputs[seen.get(combo)].classList.add('key-conflict');
    } else {
      seen.set(combo, id);
    }
  });
  if (conflict) {
    saveBtn.textContent = '存在冲突';
    setTimeout(() => (saveBtn.textContent = '保存'), 1600);
    return;
  }

  const keymapToSave = {};
  KEY_ACTIONS.forEach(({ id }) => {
    const combo = keymapInputs[id].dataset.combo;
    if (combo) keymapToSave[id] = combo;
  });

  chrome.storage.sync.set({ seekStep, speedStep, volumeStep, keymap: keymapToSave }, () => {
    saveBtn.textContent = '已保存';
    setTimeout(() => (saveBtn.textContent = '保存'), 1200);
  });
});

if (resetKeymapBtn) {
  resetKeymapBtn.addEventListener('click', () => {
    applyKeymapToInputs({});
    chrome.storage.sync.remove('keymap', () => {
      resetKeymapBtn.textContent = '已恢复默认';
      setTimeout(() => (resetKeymapBtn.textContent = '恢复默认快捷键'), 1200);
    });
  });
}

function renderKeymapTable() {
  if (!keymapTableBody) return;
  KEY_ACTIONS.forEach((action) => {
    const row = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = action.label;
    row.appendChild(nameTd);

    const inputTd = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.className = 'key-input';
    input.placeholder = '按下组合键';
    input.dataset.action = action.id;
    input.addEventListener('focus', onKeyInputFocus);
    input.addEventListener('blur', onKeyInputBlur);
    input.addEventListener('keydown', (event) => handleKeyInputKeydown(action.id, event));
    inputTd.appendChild(input);
    row.appendChild(inputTd);

    const descTd = document.createElement('td');
    descTd.textContent = action.description;
    row.appendChild(descTd);

    keymapTableBody.appendChild(row);
    keymapInputs[action.id] = input;
    setInputCombo(action.id, '');
  });
}

function onKeyInputFocus(event) {
  const input = event.target;
  input.dataset.original = input.dataset.combo || '';
  input.value = '';
  input.placeholder = '按下组合键…（Esc 取消）';
  input.classList.remove('key-conflict');
}

function onKeyInputBlur(event) {
  const input = event.target;
  input.placeholder = '按下组合键';
  const actionId = input.dataset.action;
  if (!actionId) return;
  const combo = input.dataset.combo || '';
  setInputCombo(actionId, combo);
}

function handleKeyInputKeydown(actionId, event) {
  if (event.key === 'Tab') return;
  event.preventDefault();
  if (event.key === 'Escape') {
    const original = event.target.dataset.original || '';
    setInputCombo(actionId, original);
    event.target.blur();
    return;
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    setInputCombo(actionId, '');
    return;
  }
  const combo = comboFromEvent(event);
  if (!combo) return;
  setInputCombo(actionId, combo);
}

function setInputCombo(actionId, combo) {
  const input = keymapInputs[actionId];
  if (!input) return;
  const trimmed = typeof combo === 'string' ? combo.trim() : '';
  input.dataset.combo = trimmed;
  input.classList.remove('key-conflict');
  const effective = trimmed || DEFAULT_KEYMAP[actionId];
  const label = formatCombo(effective);
  input.value = trimmed ? label : `默认 ${label}`;
}

function applyKeymapToInputs(storedMap) {
  const map = storedMap && typeof storedMap === 'object' ? storedMap : {};
  KEY_ACTIONS.forEach(({ id }) => {
    const combo = typeof map[id] === 'string' ? map[id] : '';
    setInputCombo(id, combo);
  });
}

function comboFromEvent(event) {
  const parts = [];
  for (const mod of MODIFIER_ORDER) {
    if (event[MODIFIER_PROP[mod]]) parts.push(mod);
  }
  const code = event.code;
  if (!code) return parts.length ? parts.join('+') : '';
  if (MODIFIER_CODE_SET.has(code)) {
    return parts.length ? parts.join('+') : '';
  }
  parts.push(code);
  return parts.join('+');
}

function formatCombo(combo) {
  if (!combo) return '';
  const parts = combo.split('+');
  if (!parts.length) return '';
  const keyCode = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map((mod) => (mod === 'Control' ? 'Ctrl' : mod));
  const keyLabel = displayKeyFromCode(keyCode);
  return [...mods, keyLabel].join('+');
}

function displayKeyFromCode(code) {
  if (CODE_DISPLAY_MAP[code]) return CODE_DISPLAY_MAP[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num${code.slice(6)}`;
  return code;
}