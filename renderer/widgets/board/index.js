// widgets/board/index.js
import { state, persist } from '../../app/state.js';
import { escapeHtml, truncate } from '../../shared/lib/utils.js';
import { getLabelColor } from '../../shared/config/index.js';
import { getLabel, currentLabelFilter, setCurrentLabelFilter } from '../../entities/label/index.js';
import { currentCategoryId, currentSearchQuery, setCurrentSearchQuery, filteredCards } from '../../entities/category/index.js';
import { pushCardChange } from '../../features/github-sync/index.js';

export function renderCard(card) {
  const cat = state.categories.find(c => c.id === card.category);
  const prioClass = 'prio-' + card.priority;
  const prioLabel = { low: '낮음', med: '보통', high: '높음' }[card.priority] || '보통';
  const cardClasses = ['card-item'];
  if (card.running) cardClasses.push('is-running');
  const catName = cat ? cat.name : '기타';

  // Task type badge
  const taskTypeMap = { feature: '기능', uiux: 'UI/UX', refactor: '리팩토링', bug: '버그' };
  const taskTypeBadgeHtml = card.taskType
    ? `<span class="card-task-type task-type-${card.taskType}">${taskTypeMap[card.taskType] || card.taskType}</span>`
    : '';

  // Label badge
  const label = card.labelId ? getLabel(card.labelId) : null;
  let labelBadgeHtml = '';
  if (label) {
    const c = getLabelColor(label.id);
    const style = `background-color: ${c.bg}; color: ${c.fg}; --label-fg-dark: ${c.fgDark};`;
    labelBadgeHtml = `<span class="card-label-badge" style="${style}"><span class="card-label-dot" style="background-color:${c.fg};--dot-dark:${c.fgDark}"></span>${escapeHtml(label.name)}</span>`;
  }

  // GitHub badge — floating top-right corner (icon-only)
  let githubCornerHtml = '';
  if (card.github) {
    const gh = card.github;
    const stateClass = gh.state === 'closed' ? 'is-closed' : 'is-open';
    githubCornerHtml = `<a class="card-gh-corner ${stateClass}" href="${escapeHtml(gh.htmlUrl || '')}" target="_blank" onclick="event.stopPropagation()" title="${escapeHtml(gh.owner)}/${escapeHtml(gh.repo)} #${gh.issueNumber} · ${escapeHtml(gh.state || '')}">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
      <span class="card-gh-corner-num">#${gh.issueNumber}</span>
    </a>`;
  }

  // Latest log preview for running cards
  const logPreviewHtml = card.running && Array.isArray(card.log) && card.log.length
    ? `<div class="card-running-preview">
        <span class="spinner is-small"></span>
        <span class="card-running-preview-text">${escapeHtml(truncate((card.log[card.log.length - 1].text || card.log[card.log.length - 1].body || ''), 60))}</span>
      </div>`
    : '';

  return `
    <article class="${cardClasses.join(' ')}" draggable="true" data-id="${card.id}" data-card-id="${card.id}">
      ${githubCornerHtml}
      <div class="card-actions">
        <button class="icon-btn" data-delete="${card.id}" title="삭제">✕</button>
      </div>
      <div class="card-head">
        <span class="card-tag tag">${escapeHtml(catName)}</span>
        ${taskTypeBadgeHtml}
        ${labelBadgeHtml}
      </div>
      <div class="card-title">${escapeHtml(card.title)}</div>
      ${card.desc ? `<div class="card-desc">${escapeHtml(card.desc)}</div>` : ''}
      ${card.pendingConfirmation ? `<span class="card-badge-confirm"><span class="card-badge-confirm-dot"></span>컨펌 필요</span>` : ''}
      ${card.running ? `<span class="card-badge-running"><span class="spinner is-small"></span>실행 중</span>` : ''}
      ${logPreviewHtml}
      <div class="card-foot">
        <span class="card-prio ${prioClass}">${prioLabel}</span>
        <span class="card-tokens">${(card.tokens || 0).toLocaleString()} tokens</span>
        <button class="run-btn" data-id="${card.id}" ${card.running ? 'disabled' : ''}>
          ${card.running
            ? `<span class="spinner is-small"></span> 실행 중`
            : `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> 실행`}
        </button>
      </div>
    </article>`;
}

// Render a single column's card list (does NOT rebind events)
export function updateColumn(status) {
  const col = document.getElementById('col-' + status);
  if (!col) return;
  const cards = filteredCards(state.cards, {
    categoryId: currentCategoryId,
    labelFilter: currentLabelFilter,
    searchQuery: currentSearchQuery,
  }).filter(c => c.status === status);
  document.getElementById('cnt-' + status).textContent = cards.length;
  let html = cards.map(renderCard).join('');
  if (cards.length === 0) html = `<div class="empty-col">${currentSearchQuery ? '검색 결과 없음' : '비어있음'}</div>`;
  html += `<button class="add-card-btn" data-status="${status}">+ 작업 추가</button>`;
  col.innerHTML = html;
}

export function renderColumns() {
  ['todo', 'doing', 'review', 'document', 'done'].forEach(updateColumn);

  const runningSummary = document.getElementById('boardRunningSummary');
  const runningCountEl = document.getElementById('boardRunningCount');
  if (runningSummary && runningCountEl) {
    const runningCount = state.cards ? state.cards.filter(c => c.running).length : 0;
    runningCountEl.textContent = runningCount;
    runningSummary.hidden = runningCount === 0;
  }
}

export function renderStats() {
  // Header metrics removed; state.totals is still maintained for persistence.
}

export function renderModelHint() {
  // modelPrice element removed — no-op kept for call-site compatibility
}

// Called once at init — uses event delegation so innerHTML swaps don't break listeners
export function initBoardEvents() {
  const grid = document.getElementById('columns');
  if (grid) {
    grid.addEventListener('click', e => {
      const delBtn = e.target.closest('.icon-btn[data-delete]');
      if (delBtn) { e.stopPropagation(); if (typeof window.deleteCard === 'function') window.deleteCard(delBtn.dataset.delete); return; }
      const runBtn = e.target.closest('.run-btn');
      if (runBtn) { e.stopPropagation(); if (typeof window.quickRun === 'function') window.quickRun(runBtn.dataset.id); return; }
      const addBtn = e.target.closest('.add-card-btn');
      if (addBtn) { if (typeof window.openNewCard === 'function') window.openNewCard(addBtn.dataset.status); return; }
      const card = e.target.closest('.card-item');
      if (card && typeof window.openCard === 'function') window.openCard(card.dataset.id);
    });
    grid.addEventListener('dragstart', e => {
      const card = e.target.closest('.card-item');
      if (!card) return;
      e.dataTransfer.setData('card-id', card.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
      document.body.classList.add('card-dragging');
    });
    grid.addEventListener('dragend', e => {
      const card = e.target.closest('.card-item');
      if (!card) return;
      card.classList.remove('dragging');
      document.body.classList.remove('card-dragging');
      document.querySelectorAll('.cat-item.card-drop-over').forEach(el => el.classList.remove('card-drop-over'));
    });
  }

  // Column drop targets are static DOM — bind once
  document.querySelectorAll('.column-wrap').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const cardId = e.dataTransfer.getData('card-id');
      const newStatus = col.dataset.status;
      const card = state.cards.find(c => c.id === cardId);
      if (card && card.status !== newStatus) {
        const oldStatus = card.status;
        card.status = newStatus;
        if (newStatus === 'done' && card.progress < 100) card.progress = 100;
        updateColumn(oldStatus);
        updateColumn(newStatus);
        persist(); // fire and forget — UI already updated
        pushCardChange(card, { prevStatus: oldStatus });
      }
    });
  });
}

export function initCardSearch() {
  const input = document.getElementById('cardSearchInput');
  const clearBtn = document.getElementById('cardSearchClear');
  if (!input || !clearBtn) return;

  input.addEventListener('input', (e) => {
    setCurrentSearchQuery(e.target.value.trim().toLowerCase());
    clearBtn.hidden = !e.target.value.trim();
    renderColumns();
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    setCurrentSearchQuery('');
    clearBtn.hidden = true;
    input.focus();
    renderColumns();
  });
}

export function renderLabelFilterBar() {
  const bar = document.getElementById('labelFilterBar');
  if (!bar) return;

  // Collect label IDs actually in use
  const usedLabelIds = new Set(state.cards.map(c => c.labelId).filter(Boolean));
  const usedLabels = state.labels.filter(l => usedLabelIds.has(l.id));
  const hasUnlabeled = state.cards.some(c => !c.labelId);

  if (usedLabels.length === 0 && !hasUnlabeled) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;

  bar.innerHTML = '';

  // Render a chip for each label in use
  usedLabels.forEach(label => {
    const color = getLabelColor(label.id);
    const btn = document.createElement('button');
    btn.className = 'label-filter-chip' + (currentLabelFilter === label.id ? ' is-active' : '');
    btn.dataset.labelId = label.id;
    btn.style.setProperty('--label-bg', color.bg);
    btn.style.setProperty('--label-fg', color.fg);
    btn.style.setProperty('--label-fg-dark', color.fgDark);
    const dot = document.createElement('span');
    dot.className = 'label-chip-dot';
    dot.style.backgroundColor = color.fg;
    dot.style.setProperty('--dot-dark', color.fgDark);
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(label.name));
    bar.appendChild(btn);
  });

  // Render "No label" chip if there are unlabeled cards
  if (hasUnlabeled) {
    const btn = document.createElement('button');
    btn.className = 'label-filter-chip' + (currentLabelFilter === '__none__' ? ' is-active' : '');
    btn.dataset.labelId = '__none__';
    btn.textContent = '라벨 없음';
    bar.appendChild(btn);
  }

  // Attach click handlers
  bar.querySelectorAll('.label-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.labelId;
      setCurrentLabelFilter(currentLabelFilter === id ? null : id);
      if (typeof window.renderColumns === 'function') window.renderColumns();
      renderLabelFilterBar();
    });
  });
}
