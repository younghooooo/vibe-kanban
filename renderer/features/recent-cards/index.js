// features/recent-cards/index.js
import { state } from '../../app/state.js';
import { escapeHtml } from '../../shared/lib/utils.js';

export let _recentCardsOpen = false;
let _selectedIdx = 0;

function _getRecentCards() {
  const cards = state.cards ? [...state.cards] : [];
  cards.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  return cards.slice(0, 20);
}

function _relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR');
}

export function openRecentCards() {
  const overlay = document.getElementById('recentCardsOverlay');
  if (!overlay) return;
  overlay.hidden = false;
  _recentCardsOpen = true;
  _selectedIdx = 0;
  _renderRecentCards();
}

export function closeRecentCards() {
  const overlay = document.getElementById('recentCardsOverlay');
  if (!overlay) return;
  overlay.hidden = true;
  _recentCardsOpen = false;
}

export function _renderRecentCards() {
  const container = document.getElementById('recentCardsList');
  if (!container) return;

  const cards = _getRecentCards();

  if (cards.length === 0) {
    container.innerHTML = `<div class="recent-cards-empty">카드가 없습니다</div>`;
    return;
  }

  const STATUS_LABELS = { todo: '할 일', doing: '진행 중', review: '검토', document: '문서', done: '완료' };

  container.innerHTML = cards.map((card, i) => {
    const cat = state.categories ? state.categories.find(c => c.id === card.category) : null;
    const catName = cat ? cat.name : '';
    const statusLabel = STATUS_LABELS[card.status] || card.status;
    const time = _relativeTime(card.updatedAt || card.createdAt);

    return `<div class="recent-cards-item${i === 0 ? ' is-active' : ''}" data-id="${card.id}" data-idx="${i}">
      <div class="recent-cards-item-main">
        <div class="recent-cards-item-title">${escapeHtml(card.title || '제목 없음')}</div>
        <div class="recent-cards-item-meta">
          ${catName ? `<span class="global-search-badge">${escapeHtml(catName)}</span>` : ''}
          <span class="global-search-badge global-search-status-${card.status}">${statusLabel}</span>
          ${card.running ? '<span class="global-search-badge global-search-running">실행 중</span>' : ''}
        </div>
      </div>
      <div class="recent-cards-item-time">${time}</div>
    </div>`;
  }).join('');

  _selectedIdx = 0;
}

function _move(dir) {
  const container = document.getElementById('recentCardsList');
  if (!container) return;
  const items = [...container.querySelectorAll('.recent-cards-item')];
  if (!items.length) return;

  items.forEach(el => el.classList.remove('is-active'));
  _selectedIdx = Math.max(0, Math.min(items.length - 1, _selectedIdx + dir));
  const target = items[_selectedIdx];
  if (target) {
    target.classList.add('is-active');
    target.scrollIntoView({ block: 'nearest' });
  }
}

function _confirm() {
  const container = document.getElementById('recentCardsList');
  if (!container) return;
  const active = container.querySelector('.recent-cards-item.is-active');
  if (active) {
    const cardId = active.dataset.id;
    closeRecentCards();
    if (typeof window.openCard === 'function') window.openCard(cardId);
  }
}

export function initRecentCards() {
  const overlay = document.getElementById('recentCardsOverlay');
  const list = document.getElementById('recentCardsList');
  if (!overlay || !list) return;

  document.addEventListener('keydown', (e) => {
    if (!_recentCardsOpen) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'ArrowDown') { _move(1); }
    else if (e.key === 'ArrowUp') { _move(-1); }
    else if (e.key === 'Enter' && !e.isComposing) { _confirm(); }
    else if (e.key === 'Escape') { closeRecentCards(); }
  }, true);

  list.addEventListener('click', (e) => {
    const item = e.target.closest('.recent-cards-item');
    if (item) { closeRecentCards(); if (typeof window.openCard === 'function') window.openCard(item.dataset.id); }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeRecentCards();
  });
}
