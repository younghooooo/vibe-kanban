// features/search/index.js
import { state } from '../../app/state.js';
import { escapeHtml } from '../../shared/lib/utils.js';

export let _globalSearchOpen = false;
export let _globalSearchSelectedIdx = -1;

export function openGlobalSearch() {
  const overlay = document.getElementById('globalSearchOverlay');
  if (!overlay) return;
  overlay.hidden = false;
  _globalSearchOpen = true;
  _globalSearchSelectedIdx = -1;
  const input = document.getElementById('globalSearchInput');
  if (input) {
    input.value = '';
    input.focus();
  }
  _renderGlobalSearchResults('');
}

export function closeGlobalSearch() {
  const overlay = document.getElementById('globalSearchOverlay');
  if (!overlay) return;
  overlay.hidden = true;
  _globalSearchOpen = false;
  _globalSearchSelectedIdx = -1;
}

export function _renderGlobalSearchResults(query) {
  const container = document.getElementById('globalSearchResults');
  if (!container) return;

  const q = query.toLowerCase().trim();
  let cards = state.cards ? [...state.cards] : [];

  if (q) {
    cards = cards.filter(c =>
      (c.title || '').toLowerCase().includes(q) ||
      (c.desc || '').toLowerCase().includes(q) ||
      (c.doc || '').toLowerCase().includes(q)
    );
  }

  cards.sort((a, b) => {
    if (a.running && !b.running) return -1;
    if (!a.running && b.running) return 1;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });

  cards = cards.slice(0, 12);

  if (cards.length === 0) {
    container.innerHTML = `<div class="global-search-empty">${q ? '검색 결과 없음' : '카드가 없습니다'}</div>`;
    _globalSearchSelectedIdx = -1;
    return;
  }

  const STATUS_LABELS = { todo: '할 일', doing: '진행 중', review: '검토', document: '문서', done: '완료' };

  function highlightMatch(text, q) {
    if (!q) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQ = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(escapedQ, 'gi'), m => `<mark>${m}</mark>`);
  }

  container.innerHTML = cards.map((card, i) => {
    const cat = state.categories ? state.categories.find(c => c.id === card.category) : null;
    const catName = cat ? cat.name : '';
    const statusLabel = STATUS_LABELS[card.status] || card.status;
    const titleHtml = highlightMatch(card.title || '제목 없음', q);

    return `<div class="global-search-item${i === 0 ? ' is-active' : ''}" data-id="${card.id}" data-idx="${i}">
      <div class="global-search-item-title">${titleHtml}</div>
      <div class="global-search-item-meta">
        ${catName ? `<span class="global-search-badge">${escapeHtml(catName)}</span>` : ''}
        <span class="global-search-badge global-search-status-${card.status}">${statusLabel}</span>
        ${card.running ? '<span class="global-search-badge global-search-running">실행 중</span>' : ''}
      </div>
    </div>`;
  }).join('');

  _globalSearchSelectedIdx = 0;
}

function _globalSearchMove(dir) {
  const container = document.getElementById('globalSearchResults');
  if (!container) return;
  const items = [...container.querySelectorAll('.global-search-item')];
  if (!items.length) return;

  items.forEach(el => el.classList.remove('is-active'));
  _globalSearchSelectedIdx = Math.max(0, Math.min(items.length - 1, _globalSearchSelectedIdx + dir));
  const target = items[_globalSearchSelectedIdx];
  if (target) {
    target.classList.add('is-active');
    target.scrollIntoView({ block: 'nearest' });
  }
}

function _globalSearchConfirm() {
  const container = document.getElementById('globalSearchResults');
  if (!container) return;
  const active = container.querySelector('.global-search-item.is-active');
  if (active) {
    const cardId = active.dataset.id;
    closeGlobalSearch();
    if (typeof window.openCard === 'function') window.openCard(cardId);
  }
}

export function initGlobalSearch() {
  const overlay = document.getElementById('globalSearchOverlay');
  const input = document.getElementById('globalSearchInput');
  const results = document.getElementById('globalSearchResults');
  if (!overlay || !input || !results) return;

  // Cmd+K / Ctrl+K 단축키
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      _globalSearchOpen ? closeGlobalSearch() : openGlobalSearch();
    }
  }, true);

  // 검색 입력
  input.addEventListener('input', () => {
    _globalSearchSelectedIdx = 0;
    _renderGlobalSearchResults(input.value);
  });

  // 키보드 네비게이션
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); _globalSearchMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _globalSearchMove(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); _globalSearchConfirm(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeGlobalSearch(); }
  });

  // 클릭으로 카드 열기
  results.addEventListener('click', (e) => {
    const item = e.target.closest('.global-search-item');
    if (item) { closeGlobalSearch(); if (typeof window.openCard === 'function') window.openCard(item.dataset.id); }
  });

  // 오버레이 바깥 클릭 시 닫기
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeGlobalSearch();
  });
}
