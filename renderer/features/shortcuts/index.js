// features/shortcuts/index.js
import { _safeGet, _safeSet } from '../../shared/lib/utils.js';
import { toggleGrayscale } from '../../shared/lib/theme.js';

const ACTIONS = [
  { id: 'grayscale', label: '흑백 모드 전환' },
  { id: 'goBack',    label: '뒤로가기' },
  { id: 'newCard',   label: '새 티켓 생성' },
];

const DEFAULTS = {
  grayscale: { key: 'B',         shift: true,  alt: false, ctrlOrMeta: false },
  goBack:    { key: 'ArrowLeft', shift: false, alt: true,  ctrlOrMeta: false },
  newCard:   { key: 'n',         shift: false, alt: false, ctrlOrMeta: true  },
};

let _shortcuts = {};
let _recording = null;
let _panelOpen = false;

function _isMac() {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
}

function _formatKey(sc) {
  const parts = [];
  if (sc.ctrlOrMeta) parts.push(_isMac() ? '⌘' : 'Ctrl');
  if (sc.alt) parts.push(_isMac() ? '⌥' : 'Alt');
  if (sc.shift) parts.push('⇧');
  const kmap = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    ' ': 'Space', Escape: 'Esc', Backspace: '⌫', Delete: 'Del', Enter: '↵',
  };
  parts.push(kmap[sc.key] || (sc.key.length === 1 ? sc.key.toUpperCase() : sc.key));
  return parts.join('+');
}

function _matchShortcut(e, sc) {
  return e.key === sc.key &&
    !!e.shiftKey === !!sc.shift &&
    !!e.altKey === !!sc.alt &&
    (!!e.ctrlKey || !!e.metaKey) === !!sc.ctrlOrMeta;
}

function _handleKeydown(e) {
  if (_recording) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      _recording = null;
      renderShortcutsPanel();
      return;
    }
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    _shortcuts[_recording] = {
      key: e.key,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrlOrMeta: e.ctrlKey || e.metaKey,
    };
    _safeSet('vk:shortcuts', JSON.stringify(_shortcuts));
    _recording = null;
    renderShortcutsPanel();
    return;
  }

  if (_matchShortcut(e, _shortcuts.grayscale)) {
    e.preventDefault();
    toggleGrayscale();
    return;
  }

  if (_matchShortcut(e, _shortcuts.goBack)) {
    e.preventDefault();
    if (typeof window.showBoard === 'function') window.showBoard();
    return;
  }

  if (_matchShortcut(e, _shortcuts.newCard)) {
    e.preventDefault();
    if (typeof window.openNewCard === 'function') window.openNewCard();
    return;
  }
}

export function initShortcuts() {
  const saved = _safeGet('vk:shortcuts');
  if (saved) {
    try { Object.assign(_shortcuts, JSON.parse(saved)); } catch {}
  }
  for (const id of Object.keys(DEFAULTS)) {
    if (!_shortcuts[id]) _shortcuts[id] = { ...DEFAULTS[id] };
  }
  document.addEventListener('keydown', _handleKeydown, true);
}

export function renderShortcutsPanel() {
  const list = document.getElementById('shortcutsList');
  if (!list) return;

  list.innerHTML = ACTIONS.map(({ id, label }) => {
    const sc = _shortcuts[id];
    const isRec = _recording === id;
    return `
      <div class="shortcut-row">
        <span class="shortcut-row-label">${label}</span>
        <button type="button" class="shortcut-key-btn${isRec ? ' recording' : ''}" data-record="${id}">
          ${isRec ? '…' : _formatKey(sc)}
        </button>
      </div>`;
  }).join('') + `
    <button type="button" class="shortcut-reset-btn" id="shortcutResetBtn">기본값으로 초기화</button>`;

  list.querySelectorAll('button[data-record]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-record');
      _recording = _recording === id ? null : id;
      renderShortcutsPanel();
    });
  });

  document.getElementById('shortcutResetBtn')?.addEventListener('click', () => {
    for (const id of Object.keys(DEFAULTS)) _shortcuts[id] = { ...DEFAULTS[id] };
    _safeSet('vk:shortcuts', JSON.stringify(_shortcuts));
    _recording = null;
    renderShortcutsPanel();
  });
}

export function openShortcutsPanel() {
  _panelOpen = true;
  const section = document.getElementById('shortcutsSection');
  if (section) section.hidden = false;
  const toggle = document.getElementById('shortcutsPanelToggle');
  if (toggle) toggle.classList.add('active');
  renderShortcutsPanel();
}

export function closeShortcutsPanel() {
  _panelOpen = false;
  _recording = null;
  const section = document.getElementById('shortcutsSection');
  if (section) section.hidden = true;
  const toggle = document.getElementById('shortcutsPanelToggle');
  if (toggle) toggle.classList.remove('active');
}

export function toggleShortcutsPanel() {
  _panelOpen ? closeShortcutsPanel() : openShortcutsPanel();
}
