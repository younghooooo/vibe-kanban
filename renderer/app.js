// app.js

// ============ CONSTANTS ============
const DEFAULT_CATEGORIES = [
  { id: 'personal', name: '사생활',   folderId: null },
  { id: 'project',  name: '프로젝트', folderId: null },
  { id: 'study',    name: '공부',     folderId: null },
];

const LABEL_COLORS = [
  { bg: 'rgba(239, 68, 68, 0.15)',  fg: '#b91c1c', fgDark: '#f87171' },   // red
  { bg: 'rgba(249, 115, 22, 0.15)', fg: '#c2410c', fgDark: '#fb923c' },   // orange
  { bg: 'rgba(245, 158, 11, 0.15)', fg: '#b45309', fgDark: '#fbbf24' },   // amber
  { bg: 'rgba(234, 179, 8, 0.15)',  fg: '#a16207', fgDark: '#facc15' },   // yellow
  { bg: 'rgba(132, 204, 22, 0.15)', fg: '#4d7c0f', fgDark: '#a3e635' },   // lime
  { bg: 'rgba(34, 197, 94, 0.15)',  fg: '#15803d', fgDark: '#4ade80' },   // green
  { bg: 'rgba(16, 185, 129, 0.15)', fg: '#047857', fgDark: '#34d399' },   // emerald
  { bg: 'rgba(20, 184, 166, 0.15)', fg: '#0f766e', fgDark: '#2dd4bf' },   // teal
  { bg: 'rgba(6, 182, 212, 0.15)',  fg: '#0e7490', fgDark: '#22d3ee' },   // cyan
  { bg: 'rgba(14, 165, 233, 0.15)', fg: '#0369a1', fgDark: '#38bdf8' },   // sky
  { bg: 'rgba(59, 130, 246, 0.15)', fg: '#1d4ed8', fgDark: '#60a5fa' },   // blue
  { bg: 'rgba(99, 102, 241, 0.15)', fg: '#4338ca', fgDark: '#818cf8' },   // indigo
  { bg: 'rgba(139, 92, 246, 0.15)', fg: '#6d28d9', fgDark: '#a78bfa' },   // violet
  { bg: 'rgba(217, 70, 239, 0.15)', fg: '#a21caf', fgDark: '#e879f9' },   // fuchsia
  { bg: 'rgba(236, 72, 153, 0.15)', fg: '#be185d', fgDark: '#f472b6' },   // pink
  { bg: 'rgba(244, 63, 94, 0.15)',  fg: '#be123c', fgDark: '#fb7185' },   // rose
];

function hashLabelId(id) {
  const s = String(id || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function getLabelColor(labelId) {
  const idx = hashLabelId(labelId) % LABEL_COLORS.length;
  return LABEL_COLORS[idx];
}

const MODEL_PRICES = {
  'claude-opus-4-7':   { in: 15, out: 75, label: 'Opus 4.7' },
  'claude-opus-4-5':   { in: 15, out: 75, label: 'Opus 4.5' },
  'claude-sonnet-4-6': { in: 3,  out: 15, label: 'Sonnet 4.6' },
  'claude-sonnet-4-5': { in: 3,  out: 15, label: 'Sonnet 4.5' },
  'claude-haiku-4-5':  { in: 1,  out: 5,  label: 'Haiku 4.5' },
};

// Auto-compact thresholds
// 20 turns: each user turn appends one type:'user' log entry; beyond 20 the context
// grows large enough that compaction pays for itself.
const AUTO_COMPACT_TURN_THRESHOLD = 20;
// 30 min idle: Anthropic prompt cache TTL is 5 min, so 30 min guarantees a full
// cache miss. Compacting before a cold resume avoids re-uploading stale history.
const AUTO_COMPACT_IDLE_MS = 30 * 60 * 1000;

// ============ STATE ============
let state = {
  folders: [],
  categories: DEFAULT_CATEGORIES,
  cards: [],
  labels: [],
  totals: { tokens: 0, runs: 0, cost: 0 }
};
// Runtime routing state (not persisted)
state.view = 'board';
state.detailCardId = null;
// Set is not JSON-serializable — runtime only, not persisted
state.collapsedCategories = new Set();

let currentCardId = null;
let currentCategoryId = 'all';
// 라벨 ID | '__none__' | null
let currentLabelFilter = null;
let currentSearchQuery = '';
let cliStatus = { found: false };
let currentAuthMode = 'auto';
let draggedCatId = null;

function uid() { return 'c_' + Math.random().toString(36).slice(2, 9); }
function catUid() { return 'cat_' + Math.random().toString(36).slice(2, 7); }

function sampleCards() {
  return [
    {
      id: uid(), title: '이번 주 운동 계획 짜기',
      desc: '주 5회, 유산소 2 + 근력 3. 기구 없이 집에서. 요일별 30분 내외 루틴.',
      category: 'personal', priority: 'med', status: 'todo',
      progress: 0, tokens: 0, log: [], createdAt: Date.now()
    },
    {
      id: uid(), title: 'MVP 기능 명세 정리',
      desc: '현재 아이디어를 기능 단위로 쪼개고, 핵심/부가 기능으로 분류.',
      category: 'project', priority: 'high', status: 'todo',
      progress: 0, tokens: 0, log: [], createdAt: Date.now()
    },
    {
      id: uid(), title: 'React Hook 핵심 정리',
      desc: 'useState, useEffect, useMemo, useCallback, useRef의 쓰임과 흔한 실수.',
      category: 'study', priority: 'med', status: 'todo',
      progress: 0, tokens: 0, log: [], createdAt: Date.now()
    },
  ];
}

async function loadFromDisk() {
  const data = await window.api.loadData();
  if (data && data.cards) {
    state = {
      folders: data.folders || [],
      categories: data.categories || DEFAULT_CATEGORIES,
      cards: data.cards || [],
      labels: data.labels || [],
      totals: data.totals || { tokens: 0, runs: 0, cost: 0 }
    };
  } else {
    state = {
      folders: [],
      categories: DEFAULT_CATEGORIES,
      cards: sampleCards(),
      totals: { tokens: 0, runs: 0, cost: 0 }
    };
    await persist();
  }
  // Runtime state reset after re-assignment
  state.view = (data && data.view) || 'board';
  state.detailCardId = (data && data.detailCardId) || null;
  state.collapsedCategories = new Set();
  migrateCategories();
  migrateCategoriesToFolders();
  migrateLabels();
  await clearStaleRuntimeFields();
}
async function persist() { await window.api.saveData(state); }

// ============ CATEGORY / FOLDER HELPERS ============

function migrateCategories() {
  if (!Array.isArray(state.categories)) return;
  let changed = false;
  state.categories.forEach(c => {
    if (typeof c.folderId === 'undefined') { c.folderId = null; changed = true; }
  });
  if (changed) persist();
}

function migrateCategoriesToFolders() {
  if (!Array.isArray(state.folders)) state.folders = [];
  if (Array.isArray(state.categories)) {
    state.categories.forEach(c => {
      // Remove legacy parentId — category-in-category no longer supported
      if ('parentId' in c) delete c.parentId;
      if (typeof c.folderId === 'undefined') c.folderId = null;
    });
  }
}

function migrateLabels() {
  if (!Array.isArray(state.labels)) state.labels = [];
  if (Array.isArray(state.cards)) {
    state.cards.forEach(c => {
      if (typeof c.labelId === 'undefined') c.labelId = null;
    });
  }
}

// ============ LABEL HELPERS ============
function getLabel(id) {
  return state.labels.find(l => l.id === id) || null;
}
function createLabel({ name, path }) {
  const label = {
    id: 'l_' + Math.random().toString(36).slice(2, 10),
    name: (name || '').trim() || '새 라벨',
    path: (path || '').trim(),
    createdAt: Date.now(),
  };
  state.labels.push(label);
  if (typeof persist === 'function') persist();
  return label;
}
function updateLabel(id, patch) {
  const l = getLabel(id);
  if (!l) return;
  if ('name' in patch) l.name = (patch.name || '').trim() || l.name;
  if ('path' in patch) l.path = (patch.path || '').trim();
  if (typeof persist === 'function') persist();
}
function deleteLabel(id) {
  state.labels = state.labels.filter(l => l.id !== id);
  state.cards.forEach(c => { if (c.labelId === id) c.labelId = null; });
  if (typeof persist === 'function') persist();
}

function getFolder(id) {
  return state.folders.find(f => f.id === id) || null;
}

function getCategoriesByFolder(folderId) {
  return state.categories.filter(c => (c.folderId || null) === (folderId || null));
}

function getAllCategoriesOrdered() {
  const result = [];
  for (const f of state.folders) {
    getCategoriesByFolder(f.id).forEach(c => result.push(c));
  }
  getCategoriesByFolder(null).forEach(c => result.push(c));
  return result;
}

function toggleFolderCollapse(folderId) {
  const f = getFolder(folderId);
  if (!f) return;
  f.collapsed = !f.collapsed;
  if (typeof persist === 'function') persist();
  if (typeof renderCategories === 'function') renderCategories();
}

function createFolder(name) {
  const folder = {
    id: 'f_' + Math.random().toString(36).slice(2, 10),
    name: name.trim() || '새 폴더',
    collapsed: false,
    createdAt: Date.now(),
  };
  state.folders.push(folder);
  if (typeof persist === 'function') persist();
  return folder;
}

function deleteFolder(folderId) {
  // Move categories inside folder to top-level
  state.categories.forEach(c => {
    if (c.folderId === folderId) c.folderId = null;
  });
  state.folders = state.folders.filter(f => f.id !== folderId);
  if (typeof persist === 'function') persist();
}

function renameFolder(folderId, newName) {
  const f = getFolder(folderId);
  if (!f) return;
  f.name = newName.trim() || f.name;
  if (typeof persist === 'function') persist();
}

function promptCreateFolder() {
  const name = prompt('새 폴더 이름');
  if (!name || !name.trim()) return;
  createFolder(name);
  renderCategories();
}

async function clearStaleRuntimeFields() {
  if (!Array.isArray(state.cards)) return;
  let changed = false;
  for (const c of state.cards) {
    if (!c.running) continue;
    // Check with main process whether the child is actually running
    let actuallyRunning = false;
    try {
      if (window.api && window.api.isCardRunning) {
        actuallyRunning = await window.api.isCardRunning(c.id);
      }
    } catch (e) {}
    if (!actuallyRunning) {
      c.running = false;
      c.runStartedAt = null;
      if (c.progress && c.progress !== 100) c.progress = 0;
      if (c.pendingConfirmation) c.pendingConfirmation = null;
      changed = true;
    }
    // Card is actually running — leave running/runStartedAt/progress untouched
  }
  if (changed && typeof persist === 'function') persist();
  // Start elapsed ticker for cards that are still running after verification
  const anyStillRunning = state.cards.some(c => c.running);
  if (anyStillRunning && typeof startElapsedTicker === 'function') {
    startElapsedTicker();
  }
}

async function verifyRunningCards() {
  if (!Array.isArray(state.cards)) return;
  if (!window.api || !window.api.isCardRunning) return;
  const runningCards = state.cards.filter(c => c.running);
  if (runningCards.length === 0) return;
  let changed = false;
  for (const c of runningCards) {
    try {
      const actual = await window.api.isCardRunning(c.id);
      if (!actual) { c.running = false; changed = true; }
    } catch (e) {}
  }
  if (changed) {
    if (typeof persist === 'function') persist();
    if (typeof renderColumns === 'function') renderColumns();
    if (state.view === 'detail' && typeof renderDetail === 'function') renderDetail();
  }
}

// Return categories in flat order (folder categories first, then top-level)
function getCategoriesInTreeOrder() {
  const result = [];
  for (const f of state.folders) {
    getCategoriesByFolder(f.id).forEach(c => result.push({ cat: c, depth: 0 }));
  }
  getCategoriesByFolder(null).forEach(c => result.push({ cat: c, depth: 0 }));
  return result;
}

// ============ RENDER ============
function render() {
  renderCategories();
  renderColumns();
  renderStats();
  renderLabelFilterBar();
  renderModelHint();
}

function renderCategories() {
  const list = document.getElementById('catList');
  if (!list) return;
  const allCount = state.cards.length;
  let html = '';

  // Top "전체" entry (hidden for now)
  // html += `<li class="cat-item${currentCategoryId === 'all' ? ' active' : ''}" data-cat="all">
  //   <span class="cat-twistie cat-twistie-empty"></span>
  //   <a class="cat-label" onclick="selectCategory('all')">전체</a>
  //   ${allCount > 0 ? `<span class="cat-count">${allCount}</span>` : ''}
  // </li>`;

  // Folder loop
  for (const f of state.folders) {
    const cats = getCategoriesByFolder(f.id);
    const folderCardCount = cats.reduce((sum, c) => {
      return sum + state.cards.filter(card => card.category === c.id).length;
    }, 0);
    const collapsed = !!f.collapsed;
    html += `<li class="folder-item" data-folder="${f.id}" draggable="true">
      <button class="cat-twistie folder-toggle" type="button" onclick="toggleFolderCollapse('${f.id}')" aria-label="Toggle folder">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" class="twistie-icon ${collapsed ? 'collapsed' : ''}"><polygon points="8 6 16 12 8 18"></polygon></svg>
      </button>
      <span class="folder-name" data-folder-rename="${f.id}" tabindex="0" role="button">${escapeHtml(f.name)}</span>
      ${folderCardCount > 0 ? `<span class="cat-count">${folderCardCount}</span>` : ''}
      <button class="btn btn-icon btn-sm folder-delete item-action" type="button" data-folder-del="${f.id}" aria-label="Delete folder" title="폴더 삭제"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
    </li>`;
    if (!collapsed) {
      for (const c of cats) {
        const count = state.cards.filter(card => card.category === c.id).length;
        html += `<li class="cat-item cat-in-folder${currentCategoryId === c.id ? ' active' : ''}" data-cat="${c.id}" draggable="true">
          <span class="cat-twistie cat-twistie-empty"></span>
          <a class="cat-label" onclick="selectCategory('${c.id}')">${escapeHtml(c.name)}</a>
          ${count > 0 ? `<span class="cat-count">${count}</span>` : ''}
        </li>`;
      }
    }
  }

  // Top-level (no folder) categories
  for (const c of getCategoriesByFolder(null)) {
    const count = state.cards.filter(card => card.category === c.id).length;
    html += `<li class="cat-item${currentCategoryId === c.id ? ' active' : ''}" data-cat="${c.id}" draggable="true">
      <span class="cat-twistie cat-twistie-empty"></span>
      <a class="cat-label" onclick="selectCategory('${c.id}')">${escapeHtml(c.name)}</a>
      ${count > 0 ? `<span class="cat-count">${count}</span>` : ''}
    </li>`;
  }

  list.innerHTML = html;

  bindCategoryListDnD(list);
  bindFolderActions(list);
}

function bindCategoryListDnD(listEl) {
  listEl.querySelectorAll('.cat-item[data-cat]').forEach(item => {
    const id = item.getAttribute('data-cat');
    if (!id) return;

    // "전체" is a drop target — dropping here moves category to top-level
    if (id === 'all') {
      item.setAttribute('draggable', 'false');
      item.addEventListener('dragover', e => {
        if (!draggedCatId) return;
        e.preventDefault();
        item.classList.add('drop-over');
      });
      item.addEventListener('dragleave', () => item.classList.remove('drop-over'));
      item.addEventListener('drop', e => {
        e.preventDefault();
        item.classList.remove('drop-over');
        if (!draggedCatId) return;
        const cat = state.categories.find(c => c.id === draggedCatId);
        if (cat) {
          cat.folderId = null;
          if (typeof persist === 'function') persist();
          renderCategories();
        }
      });
      return;
    }

    // Regular category: drag source + card drop target
    item.addEventListener('dragstart', e => {
      draggedCatId = id;
      item.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    });
    item.addEventListener('dragend', () => {
      draggedCatId = null;
      item.classList.remove('is-dragging');
      document.querySelectorAll('.drop-over').forEach(el => el.classList.remove('drop-over'));
    });

    // Card drop target: allow card to be dropped onto a category item
    item.addEventListener('dragover', e => {
      if (draggedCatId) {
        // Category-to-category drag — not handled here (no folder target)
        return;
      }
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('card-id')) {
        e.preventDefault();
        item.classList.add('card-drop-over');
      }
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('card-drop-over');
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('drop-over');
      item.classList.remove('card-drop-over');

      const cardId = e.dataTransfer.getData('card-id');
      if (cardId) {
        // Card category move
        const card = state.cards.find(c => c.id === cardId);
        if (card && card.category !== id) {
          card.category = id;
          if (typeof persist === 'function') persist();
          renderCategories();
          if (typeof renderColumns === 'function') renderColumns();
          if (typeof showToast === 'function') {
            const catName = (state.categories.find(c => c.id === id) || {}).name || '';
            showToast({
              kind: 'success',
              title: '카테고리 이동됨',
              body: `"${card.title || '제목 없음'}" → ${catName}`,
              duration: 2500,
            });
          }
        }
        return;
      }

      // Category-to-category drop (future use — no-op for now)
    });
  });

  // Folder items as drop targets
  listEl.querySelectorAll('.folder-item[data-folder]').forEach(item => {
    const folderId = item.getAttribute('data-folder');
    item.addEventListener('dragover', e => {
      if (!draggedCatId) return;
      e.preventDefault();
      item.classList.add('drop-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-over'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('drop-over');
      if (!draggedCatId) return;
      const cat = state.categories.find(c => c.id === draggedCatId);
      if (cat) {
        cat.folderId = folderId;
        if (typeof persist === 'function') persist();
        renderCategories();
      }
    });
  });
}

function bindFolderActions(listEl) {
  // Folder delete button
  listEl.querySelectorAll('button[data-folder-del]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const fid = btn.getAttribute('data-folder-del');
      const f = getFolder(fid);
      if (!f) return;
      if (!confirm(`"${f.name}" 폴더를 삭제할까요? 안에 있는 카테고리는 top-level 로 이동됩니다.`)) return;
      deleteFolder(fid);
      renderCategories();
    });
  });
  // Folder rename on double-click
  listEl.querySelectorAll('[data-folder-rename]').forEach(el => {
    const fid = el.getAttribute('data-folder-rename');
    el.addEventListener('dblclick', () => startRenameFolder(fid, el));
  });
}

function startRenameFolder(folderId, spanEl) {
  const f = getFolder(folderId);
  if (!f) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'folder-name-input input-inline';
  input.value = f.name;
  spanEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  function commit(save) {
    if (done) return;
    done = true;
    const newName = input.value.trim();
    if (save && newName && newName !== f.name) {
      renameFolder(folderId, newName);
    }
    renderCategories();
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
}

function selectCategory(id) {
  currentCategoryId = id;
  localStorage.setItem('lastCategoryId', id);
  if (id === 'all') {
    document.getElementById('boardTitle').textContent = '전체';
    document.getElementById('boardMeta').textContent = '';
  } else {
    const cat = state.categories.find(c => c.id === id);
    if (cat) {
      document.getElementById('boardTitle').textContent = cat.name;
      const count = state.cards.filter(c => c.category === id).length;
      document.getElementById('boardMeta').textContent = `${count}개 작업`;
    }
  }
  // Return to board view if currently on detail page
  if (state.view === 'detail') {
    showBoard(); // showBoard calls renderColumns, renderCategories, renderStats internally
  } else {
    render();
  }
}

function filteredCards() {
  let cards = (!currentCategoryId || currentCategoryId === 'all')
    ? state.cards
    : state.cards.filter(c => c.category === currentCategoryId);

  if (currentLabelFilter === '__none__') cards = cards.filter(c => !c.labelId);
  else if (currentLabelFilter !== null) cards = cards.filter(c => c.labelId === currentLabelFilter);

  if (currentSearchQuery) {
    const q = currentSearchQuery;
    cards = cards.filter(c =>
      c.title.toLowerCase().includes(q) ||
      (c.desc || '').toLowerCase().includes(q)
    );
  }

  return cards;
}

function renderColumns() {
  const statuses = ['todo','doing','review','done'];
  statuses.forEach(status => {
    const col = document.getElementById('col-' + status);
    const cards = filteredCards().filter(c => c.status === status);
    document.getElementById('cnt-' + status).textContent = cards.length;

    let html = cards.map(renderCard).join('');
    if (cards.length === 0) html = `<div class="empty-col">${currentSearchQuery ? '검색 결과 없음' : '비어있음'}</div>`;
    html += `<button class="add-card-btn" data-status="${status}">+ 작업 추가</button>`;
    col.innerHTML = html;
  });

  // Update board-level running summary badge
  const runningSummary = document.getElementById('boardRunningSummary');
  const runningCountEl = document.getElementById('boardRunningCount');
  if (runningSummary && runningCountEl) {
    const runningCount = state.cards ? state.cards.filter(c => c.running).length : 0;
    runningCountEl.textContent = runningCount;
    runningSummary.hidden = runningCount === 0;
  }

  document.querySelectorAll('.card-item').forEach(el => {
    const id = el.dataset.id;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.run-btn') || e.target.closest('.icon-btn')) return;
      openCard(id);
    });
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('card-id', id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
      document.body.classList.add('card-dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.body.classList.remove('card-dragging');
      document.querySelectorAll('.cat-item.card-drop-over').forEach(el => el.classList.remove('card-drop-over'));
    });
  });

  document.querySelectorAll('.run-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); quickRun(btn.dataset.id); });
  });
  document.querySelectorAll('.icon-btn[data-delete]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteCard(btn.dataset.delete); });
  });
  document.querySelectorAll('.add-card-btn').forEach(btn => {
    btn.addEventListener('click', () => openNewCard(btn.dataset.status));
  });

  document.querySelectorAll('.column-wrap').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const cardId = e.dataTransfer.getData('card-id');
      const newStatus = col.dataset.status;
      const card = state.cards.find(c => c.id === cardId);
      if (card && card.status !== newStatus) {
        card.status = newStatus;
        if (newStatus === 'done' && card.progress < 100) card.progress = 100;
        await persist();
        render();
      }
    });
  });
}

function renderCard(card) {
  const cat = state.categories.find(c => c.id === card.category);
  const prioClass = 'prio-' + card.priority;
  const prioLabel = { low: '낮음', med: '보통', high: '높음' }[card.priority] || '보통';
  const cardClasses = ['card-item'];
  if (card.running) cardClasses.push('is-running');
  const progress = card.progress || 0;
  const catName = cat ? cat.name : '기타';

  // Label badge
  const label = card.labelId ? getLabel(card.labelId) : null;
  let labelBadgeHtml = '';
  if (label) {
    const c = getLabelColor(label.id);
    const style = `background-color: ${c.bg}; color: ${c.fg}; --label-fg-dark: ${c.fgDark};`;
    labelBadgeHtml = `<span class="card-label-badge" style="${style}">${escapeHtml(label.name)}</span>`;
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
      <div class="card-actions">
        <button class="icon-btn" data-delete="${card.id}" title="삭제">✕</button>
      </div>
      <div class="card-head">
        <span class="card-tag tag">${escapeHtml(catName)}</span>
        <span class="card-prio ${prioClass}">${prioLabel}</span>
        ${labelBadgeHtml}
      </div>
      <div class="card-title">${escapeHtml(card.title)}</div>
      ${card.pendingConfirmation ? `<span class="card-badge-confirm"><span class="card-badge-confirm-dot"></span>컨펌 필요</span>` : ''}
      ${card.running ? `<span class="card-badge-running"><span class="spinner is-small"></span>실행 중</span>` : ''}
      ${card.desc ? `<div class="card-desc">${escapeHtml(card.desc)}</div>` : ''}
      ${progress > 0 && progress < 100 ? `
        <div class="progress-wrap">
          <div class="progress-label">
            <span>진행률</span><span>${Math.round(progress)}%</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
        </div>` : ''}
      ${logPreviewHtml}
      <div class="card-foot">
        <span class="card-tokens">${(card.tokens || 0).toLocaleString()} tokens</span>
        <button class="run-btn" data-id="${card.id}" ${card.running ? 'disabled' : ''}>
          ${card.running
            ? '실행 중...'
            : `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> 실행`}
        </button>
      </div>
    </article>`;
}

function renderStats() {
  // Header metrics removed; state.totals is still maintained for persistence.
}

// ============ STATS VIEW ============
let currentStatsPeriod = 'month';

function getCardCost(card) {
  if (!Array.isArray(card.log)) return 0;
  let cost = 0;
  for (const entry of card.log) {
    if (entry && typeof entry === 'object' && entry.type === 'usage' && entry.meta && typeof entry.meta.cost === 'number') {
      cost += entry.meta.cost;
    }
  }
  return cost;
}

function getCardRunCount(card) {
  if (!Array.isArray(card.log)) return 0;
  return card.log.filter(e => e && typeof e === 'object' && e.type === 'start').length;
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function formatCost(usd) {
  if (usd === 0) return '$0';
  if (usd < 0.01) return '$' + usd.toFixed(4);
  return '$' + usd.toFixed(2);
}

function computeTimeline(period) {
  const now = new Date();
  const buckets = [];

  if (period === 'week') {
    for (let i = 7; i >= 0; i--) {
      const ref = new Date(now);
      ref.setDate(ref.getDate() - i * 7);
      const weekStart = getWeekStart(ref);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const label = i === 0 ? '이번 주' : `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
      buckets.push({ label, start: weekStart.getTime(), end: weekEnd.getTime(), tokens: 0, cost: 0, runs: 0, isCurrent: i === 0 });
    }
  } else if (period === 'month') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const label = i === 0 ? '이번 달' : `${d.getMonth() + 1}월`;
      buckets.push({ label, start: d.getTime(), end: end.getTime(), tokens: 0, cost: 0, runs: 0, isCurrent: i === 0 });
    }
  } else {
    const startYear = now.getFullYear() - 4;
    for (let y = startYear; y <= now.getFullYear(); y++) {
      const label = y === now.getFullYear() ? '올해' : `${y}`;
      buckets.push({ label, start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime(), tokens: 0, cost: 0, runs: 0, isCurrent: y === now.getFullYear() });
    }
  }

  for (const card of state.cards) {
    const ts = card.createdAt || 0;
    const bucket = buckets.find(b => ts >= b.start && ts < b.end);
    if (bucket) {
      bucket.tokens += card.tokens || 0;
      bucket.cost += getCardCost(card);
      bucket.runs += getCardRunCount(card);
    }
  }
  return buckets;
}

function computeByCategory() {
  return state.categories
    .map(cat => {
      const cards = state.cards.filter(c => c.category === cat.id);
      return {
        id: cat.id, name: cat.name,
        tokens: cards.reduce((s, c) => s + (c.tokens || 0), 0),
        cost: cards.reduce((s, c) => s + getCardCost(c), 0),
        runs: cards.reduce((s, c) => s + getCardRunCount(c), 0),
        cardCount: cards.length,
      };
    })
    .filter(r => r.tokens > 0 || r.cardCount > 0)
    .sort((a, b) => b.tokens - a.tokens);
}

function computeByLabel() {
  return state.labels
    .map(label => {
      const cards = state.cards.filter(c => c.labelId === label.id);
      return {
        id: label.id, name: label.name,
        color: getLabelColor(label.id),
        tokens: cards.reduce((s, c) => s + (c.tokens || 0), 0),
        cost: cards.reduce((s, c) => s + getCardCost(c), 0),
        runs: cards.reduce((s, c) => s + getCardRunCount(c), 0),
        cardCount: cards.length,
      };
    })
    .filter(r => r.tokens > 0 || r.cardCount > 0)
    .sort((a, b) => b.tokens - a.tokens);
}

function showStats() {
  const bv = document.getElementById('boardView');
  const dv = document.getElementById('detailView');
  const sv = document.getElementById('statsView');
  if (bv) bv.hidden = true;
  if (dv) dv.hidden = true;
  if (sv) sv.hidden = false;
  renderStatsView();
}

function setStatsPeriod(period) {
  currentStatsPeriod = period;
  renderStatsView();
}

function renderStatsView() {
  const sv = document.getElementById('statsView');
  if (!sv) return;

  const totalTokens = state.totals.tokens || 0;
  const totalRuns = state.totals.runs || 0;
  const totalCards = state.cards.length;
  const totalCost = state.cards.reduce((s, c) => s + getCardCost(c), 0);

  const timeline = computeTimeline(currentStatsPeriod);
  const byCategory = computeByCategory();
  const byLabel = computeByLabel();

  const maxTL = Math.max(...timeline.map(b => b.tokens), 1);
  const maxCat = Math.max(...byCategory.map(r => r.tokens), 1);
  const maxLbl = Math.max(...byLabel.map(r => r.tokens), 1);

  const periodLabel = currentStatsPeriod === 'week' ? '주간' : currentStatsPeriod === 'month' ? '월간' : '연간';

  sv.innerHTML = `
    <div class="stats-page">
      <div class="stats-header">
        <button onclick="showBoard()" class="btn btn-ghost detail-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          <span>보드</span>
        </button>
        <h1 class="stats-title">토큰 사용량 통계</h1>
      </div>

      <div class="stats-overview-grid">
        <div class="stats-card">
          <div class="stats-card-value">${formatTokens(totalTokens)}</div>
          <div class="stats-card-label">총 토큰</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-value">${formatCost(totalCost)}</div>
          <div class="stats-card-label">총 비용 (USD)</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-value">${totalRuns.toLocaleString()}</div>
          <div class="stats-card-label">총 실행 횟수</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-value">${totalCards.toLocaleString()}</div>
          <div class="stats-card-label">전체 작업 수</div>
        </div>
      </div>

      <div class="stats-period-tabs">
        <button onclick="setStatsPeriod('week')" class="stats-tab ${currentStatsPeriod === 'week' ? 'is-active' : ''}">주간</button>
        <button onclick="setStatsPeriod('month')" class="stats-tab ${currentStatsPeriod === 'month' ? 'is-active' : ''}">월간</button>
        <button onclick="setStatsPeriod('year')" class="stats-tab ${currentStatsPeriod === 'year' ? 'is-active' : ''}">연간</button>
      </div>

      <div class="stats-section">
        <div class="stats-section-header">
          <span class="stats-section-title">${periodLabel} 토큰 추이</span>
          <span class="stats-section-note">카드 생성일 기준</span>
        </div>
        <div class="stats-timeline">
          ${timeline.map(b => {
            const pct = (b.tokens / maxTL * 100).toFixed(1);
            return `<div class="stats-timeline-row${b.isCurrent ? ' is-current' : ''}">
              <span class="stats-timeline-label">${escapeHtml(b.label)}</span>
              <div class="stats-bar-wrap"><div class="stats-bar" style="width:${pct}%"></div></div>
              <span class="stats-timeline-value">${formatTokens(b.tokens)}</span>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="stats-breakdown-grid">
        <div class="stats-section">
          <div class="stats-section-header">
            <span class="stats-section-title">카테고리별</span>
          </div>
          ${byCategory.length === 0
            ? '<div class="stats-empty">데이터 없음</div>'
            : `<div class="stats-breakdown-list">${byCategory.map(r => `
              <div class="stats-breakdown-row">
                <div class="stats-breakdown-meta">
                  <span class="stats-breakdown-name">${escapeHtml(r.name)}</span>
                  <span class="stats-breakdown-sub">${r.cardCount}개 · ${formatCost(r.cost)}</span>
                </div>
                <div class="stats-bar-wrap"><div class="stats-bar stats-bar--cat" style="width:${(r.tokens / maxCat * 100).toFixed(1)}%"></div></div>
                <span class="stats-breakdown-value">${formatTokens(r.tokens)}</span>
              </div>`).join('')}</div>`
          }
        </div>

        <div class="stats-section">
          <div class="stats-section-header">
            <span class="stats-section-title">라벨별</span>
          </div>
          ${byLabel.length === 0
            ? '<div class="stats-empty">데이터 없음</div>'
            : `<div class="stats-breakdown-list">${byLabel.map(r => `
              <div class="stats-breakdown-row">
                <div class="stats-breakdown-meta">
                  <span class="stats-breakdown-dot" style="background:${r.color.fg}"></span>
                  <span class="stats-breakdown-name">${escapeHtml(r.name)}</span>
                  <span class="stats-breakdown-sub">${r.cardCount}개 · ${formatCost(r.cost)}</span>
                </div>
                <div class="stats-bar-wrap"><div class="stats-bar" style="width:${(r.tokens / maxLbl * 100).toFixed(1)}%;background:${r.color.fg}"></div></div>
                <span class="stats-breakdown-value">${formatTokens(r.tokens)}</span>
              </div>`).join('')}</div>`
          }
        </div>
      </div>
    </div>
  `;
}

function renderLabelFilterBar() {
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
    btn.textContent = label.name;
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
      currentLabelFilter = (currentLabelFilter === id) ? null : id;
      renderColumns();
      renderLabelFilterBar();
    });
  });
}

function initCardSearch() {
  const input = document.getElementById('cardSearchInput');
  const clearBtn = document.getElementById('cardSearchClear');
  if (!input || !clearBtn) return;

  input.addEventListener('input', (e) => {
    currentSearchQuery = e.target.value.trim().toLowerCase();
    clearBtn.hidden = !currentSearchQuery;
    renderColumns();
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    currentSearchQuery = '';
    clearBtn.hidden = true;
    input.focus();
    renderColumns();
  });
}

function renderModelHint() {
  // modelPrice element removed — no-op kept for call-site compatibility
}

// ============ CATEGORY EDITOR ============
function openCategoryEditor() {
  renderCategoryEditor();
  document.getElementById('categoryModal').showModal();
}
function closeCategoryModal() {
  document.getElementById('categoryModal').close();
}

function renderCategoryEditor() {
  const list = document.getElementById('catEditList');
  if (state.categories.length === 0) {
    list.innerHTML = `<li class="text-xs text-center py-4">카테고리가 없어요. 아래에서 추가하세요.</li>`;
    return;
  }

  // Render in flat order (folder categories first, then top-level)
  const ordered = getCategoriesInTreeOrder();
  list.innerHTML = ordered.map(({ cat }) => {
    const count = state.cards.filter(c => c.category === cat.id).length;
    const disabledAttr = state.categories.length <= 1 ? 'disabled title="최소 1개는 남아야 해요"' : 'title="삭제"';

    return `
      <li class="category-row" data-cat-id="${cat.id}" draggable="true">
        <span class="category-name" data-rename="${cat.id}" tabindex="0" role="button">${escapeHtml(cat.name)}</span>
        <span class="category-meta">
          ${count > 0 ? `<span class="category-count item-action">${count}개</span>` : ''}
          <button class="btn btn-icon btn-sm category-delete item-action" data-del="${cat.id}" ${disabledAttr} aria-label="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </span>
      </li>`;
  }).join('');

  // Inline rename on span click
  list.querySelectorAll('span[data-rename]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      startRenameCategory(el);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startRenameCategory(el);
      }
    });
  });

  // Delete
  list.querySelectorAll('button[data-del]').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.currentTarget.dataset.del;
      deleteCategory(id);
    });
  });

  // Drag-and-drop for category rows
  list.querySelectorAll('.category-row').forEach(row => {
    const id = row.getAttribute('data-cat-id');
    row.addEventListener('dragstart', (e) => {
      draggedCatId = id;
      row.classList.add('is-dragging');
      document.body.classList.add('cat-modal--dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    });
    row.addEventListener('dragend', () => {
      draggedCatId = null;
      row.classList.remove('is-dragging');
      document.body.classList.remove('cat-modal--dragging');
      document.querySelectorAll('.category-row.drop-over, .category-root-dropzone.drop-over')
        .forEach(el => el.classList.remove('drop-over'));
    });
  });

  // Root dropzone — move category to top-level (no folder)
  const rootZone = document.getElementById('catRootDropzone');
  if (rootZone) {
    rootZone.addEventListener('dragover', (e) => {
      if (!draggedCatId) return;
      e.preventDefault();
      rootZone.classList.add('drop-over');
    });
    rootZone.addEventListener('dragleave', () => rootZone.classList.remove('drop-over'));
    rootZone.addEventListener('drop', (e) => {
      e.preventDefault();
      rootZone.classList.remove('drop-over');
      if (!draggedCatId) return;
      const cat = state.categories.find(c => c.id === draggedCatId);
      if (!cat) return;
      cat.folderId = null;
      if (typeof persist === 'function') persist();
      renderCategoryEditor();
      renderCategories();
    });
  }
}

function startRenameCategory(spanEl) {
  const id = spanEl.getAttribute('data-rename');
  const row = spanEl.closest('.category-row');
  if (!row || row.classList.contains('is-editing')) return;
  const cat = state.categories.find(c => c.id === id);
  if (!cat) return;

  row.classList.add('is-editing');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'category-name-input input-inline';
  input.value = cat.name;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', '카테고리 이름');

  spanEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  function commit(save) {
    if (done) return;
    done = true;
    const newName = input.value.trim();
    const shouldSave = save && newName && newName !== cat.name;
    if (shouldSave) {
      cat.name = newName;
      persist();
    }
    renderCategoryEditor();
    renderCategories();
    render();
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      commit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      commit(false);
    }
  });
  input.addEventListener('blur', () => commit(true));
}

async function addCategory() {
  const input = document.getElementById('newCatName');
  const name = input.value.trim();
  if (!name) { toast('이름을 입력해주세요', 'error'); return; }
  if (state.categories.some(c => c.name === name)) {
    toast('같은 이름이 이미 있어요', 'error'); return;
  }
  state.categories.push({
    id: catUid(),
    name,
    folderId: null,
    createdAt: Date.now(),
  });
  await persist();
  input.value = '';
  renderCategoryEditor();
  render();
  toast('카테고리 추가됨', 'success');
}

function deleteCategory(id) {
  const cat = state.categories.find(c => c.id === id);
  if (!cat) return;
  if (state.categories.length <= 1) { alert('최소 1개의 카테고리는 남아있어야 합니다.'); return; }
  if (!confirm(`"${cat.name}" 카테고리를 삭제할까요?`)) return;

  // Move cards referencing this category to fallback
  const fallback = (state.categories.find(c => c.id !== id) || { id: '' }).id;
  state.cards.forEach(card => { if (card.category === id) card.category = fallback; });
  // Remove category
  const idx = state.categories.findIndex(c => c.id === id);
  if (idx >= 0) state.categories.splice(idx, 1);
  if (currentCategoryId === id) currentCategoryId = 'all';
  persist();
  renderCategoryEditor();
  renderCategories();
  if (typeof renderColumns === 'function') renderColumns();
  toast('삭제됨', 'success');
}

// ============ ROUTING — BOARD / DETAIL ============
function showBoard() {
  // Remove draft card if user navigates back without entering any content
  const currentId = state.detailCardId;
  if (currentId) {
    const card = state.cards.find(c => c.id === currentId);
    if (card && card._draft) {
      const titleEmpty = !card.title || !card.title.trim();
      const descEmpty = !card.desc || !card.desc.trim();
      const noLog = !Array.isArray(card.log) || card.log.length === 0;
      if (titleEmpty && descEmpty && noLog) {
        const idx = state.cards.findIndex(c => c.id === currentId);
        if (idx >= 0) state.cards.splice(idx, 1);
        // Persist only if the draft was already saved before (should not be, but guard)
        if (typeof persist === 'function') persist();
      } else {
        // Has content or log — promote draft to real card and save
        delete card._draft;
        if (typeof persist === 'function') persist();
      }
    }
  }
  state.view = 'board';
  state.detailCardId = null;
  if (typeof persist === 'function') persist();
  const bv = document.getElementById('boardView');
  const dv = document.getElementById('detailView');
  const sv = document.getElementById('statsView');
  if (bv) bv.hidden = false;
  if (dv) dv.hidden = true;
  if (sv) sv.hidden = true;
  renderColumns();
  renderCategories();
  if (typeof renderStats === 'function') renderStats();
}

function showDetail(cardId) {
  state.view = 'detail';
  state.detailCardId = cardId;
  const bv = document.getElementById('boardView');
  const dv = document.getElementById('detailView');
  if (bv) bv.hidden = true;
  if (dv) dv.hidden = false;
  renderDetail();
}

async function renderDetail() {
  const card = state.cards.find(c => c.id === state.detailCardId);
  if (!card) { showBoard(); return; }

  // 다른 카드로 이동 시 압축 progress 초기화
  if (state.compactingCardId && state.compactingCardId !== card.id) {
    const cp = document.getElementById('compactProgress');
    if (cp) { cp.hidden = true; cp.classList.remove('is-indeterminate'); }
  }

  // stuck running 자동 복구: card.running이 true인데 실제 프로세스가 없으면 즉시 false로 복구
  if (card.running && window.api && window.api.isCardRunning) {
    try {
      const actuallyRunning = await window.api.isCardRunning(card.id);
      if (!actuallyRunning) {
        card.running = false;
        if (typeof persist === 'function') persist();
      }
    } catch (e) {}
  }

  const titleEl = document.getElementById('d-title');
  const descEl = document.getElementById('d-desc');
  const catEl = document.getElementById('d-category');
  const prioEl = document.getElementById('d-priority');
  const statusEl = document.getElementById('d-status');
  const logBox = document.getElementById('d-logBox');
  const tokensEl = document.getElementById('d-tokens');
  const runBtn = document.getElementById('detailRun');
  const exportBtn = document.getElementById('detailExport');

  // Fill category options in flat order
  if (catEl) {
    const ordered = getCategoriesInTreeOrder();
    catEl.innerHTML = ordered.map(({ cat: c }) =>
      `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
    ).join('');
    catEl.value = card.category || (state.categories[0] && state.categories[0].id) || '';
  }
  if (titleEl) titleEl.value = card.title || '';
  if (descEl) {
    descEl.value = card.desc || '';
    requestAnimationFrame(() => autoresizeTextarea(descEl));
  }
  if (prioEl) prioEl.value = card.priority || 'med';
  if (statusEl) statusEl.value = card.status || 'todo';

  // Execution log
  const hasLog = Array.isArray(card.log) && card.log.length > 0;
  if (logBox) {
    if (hasLog) {
      logBox.innerHTML = renderLogEntries(card.log);
    } else {
      logBox.innerHTML = `<div class="log-empty">아직 실행되지 않았습니다.</div>`;
    }
  }
  if (tokensEl) {
    const parts = [];
    if (card.tokens) parts.push(`토큰 ${card.tokens.toLocaleString()}`);
    if (card.cost) parts.push(`$${card.cost.toFixed(4)}`);
    tokensEl.textContent = parts.join(' · ');
  }
  if (exportBtn) exportBtn.hidden = !hasLog;

  // Disable run button while running; show spinner when active
  if (runBtn) {
    const isRunning = !!card.running;
    runBtn.disabled = isRunning;
    if (isRunning) {
      runBtn.innerHTML = `<span class="spinner is-small" style="border-color: rgba(255,255,255,0.35); border-top-color: #fff;"></span><span>실행 중…</span>`;
    } else {
      runBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg><span>AI로 실행</span>`;
    }
  }

  // Toggle detail page running indicator
  const runningIndicator = document.getElementById('detailRunningIndicator');
  if (runningIndicator) runningIndicator.hidden = !card.running;
  const elapsedEl = document.getElementById('detailRunningElapsed');
  if (elapsedEl && card.running && card.runStartedAt) {
    const sec = Math.max(0, Math.round((Date.now() - card.runStartedAt) / 1000));
    elapsedEl.textContent = ' \u00b7 ' + sec + '\ucd08';
  } else if (elapsedEl) {
    elapsedEl.textContent = '';
  }

  // 모델 옵션 동기화 (사이드바 modelSelect의 option을 그대로 복사)
  const dModel = document.getElementById('d-model');
  const sideModel = document.getElementById('modelSelect');
  if (dModel && sideModel) {
    const keepDefault = '<option value="">기본 모델</option>';
    const sideOpts = Array.from(sideModel.options).map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.textContent)}</option>`).join('');
    dModel.innerHTML = keepDefault + sideOpts;
    dModel.value = card.model || '';
  }

  // 작업 경로
  const cwdText = document.getElementById('d-cwd-display');
  const cwdClear = document.getElementById('d-cwd-clear');
  if (cwdText) {
    if (card.cwd) {
      cwdText.textContent = card.cwd;
      cwdText.classList.remove('is-default');
      cwdText.title = card.cwd;
      if (cwdClear) cwdClear.hidden = false;
    } else {
      cwdText.textContent = '기본 경로 사용';
      cwdText.classList.add('is-default');
      cwdText.removeAttribute('title');
      if (cwdClear) cwdClear.hidden = true;
    }
  }

  // 라벨 select 채우기
  const dLabel = document.getElementById('d-label');
  if (dLabel) {
    const opts = ['<option value="">없음</option>'];
    for (const l of state.labels) {
      opts.push(`<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`);
    }
    dLabel.innerHTML = opts.join('');
    dLabel.value = card.labelId || '';
  }

  // 라벨 색상 점 표시
  const dLabelDot = document.getElementById('d-label-dot');
  if (dLabelDot) {
    if (card.labelId) {
      const c = getLabelColor(card.labelId);
      dLabelDot.style.backgroundColor = c.fg;
      dLabelDot.hidden = false;
    } else {
      dLabelDot.hidden = true;
    }
  }

  // 자동 진행
  const dAuto = document.getElementById('d-autoRun');
  const dAutoLabel = document.getElementById('d-autoRun-label');
  if (dAuto) {
    dAuto.checked = !!card.autoRun;
  }
  if (dAutoLabel) {
    dAutoLabel.textContent = card.autoRun ? '자동으로 진행' : '확인 받으며 진행';
  }

  // 스킬 사용
  const dSkills = document.getElementById('d-useSkills');
  const dSkillsLabel = document.getElementById('d-useSkills-label');
  if (dSkills) {
    dSkills.checked = !!card.useSkills;
  }
  if (dSkillsLabel) {
    dSkillsLabel.textContent = card.useSkills ? 'Agmo 스킬 활성화' : '기본 모드';
  }

  // 세션 힌트
  const sessionHint = document.getElementById('detailSessionHint');
  if (sessionHint) {
    const parts = [];
    if (card.sessionId) parts.push(`세션 ${card.sessionId.slice(0, 8)}…`);
    if (card.summary) parts.push('압축됨');
    sessionHint.textContent = parts.join(' · ');
    sessionHint.hidden = parts.length === 0;
  }

  // 컨펌 패널
  const pendingSection = document.getElementById('pendingSection');
  const pendingMeta = document.getElementById('pendingMeta');
  const pendingDiff = document.getElementById('pendingDiff');
  const pendingSummary = document.getElementById('pendingSummary');

  if (pendingSection) {
    const p = card.pendingConfirmation;
    if (!p) {
      pendingSection.hidden = true;
    } else {
      pendingSection.hidden = false;
      if (pendingSummary) pendingSummary.textContent = p.summary || '';
      if (pendingMeta) {
        let metaText = p.toolName || '';
        if (p.filePath) metaText += ' · ' + p.filePath;
        pendingMeta.textContent = metaText;
      }
      if (pendingDiff) {
        const lines = computeDiff(p.before, p.after);
        if (!lines.length && p.command) {
          pendingDiff.innerHTML = `<div class="diff-empty">${escapeHtml(p.command)}</div>`;
        } else if (!lines.length) {
          pendingDiff.innerHTML = `<div class="diff-empty">변경 내용이 없습니다.</div>`;
        } else {
          pendingDiff.innerHTML = lines.map(l => {
            const sign = l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' ';
            return `<div class="diff-line ${l.type}"><span class="sign">${sign}</span><span>${escapeHtml(l.text)}</span></div>`;
          }).join('');
        }
      }
    }
  }
}

function saveDetailField(field, value) {
  const card = state.cards.find(c => c.id === state.detailCardId);
  if (!card) return;
  card[field] = value;
  // Clear draft flag when user enters any meaningful content
  if (card._draft) {
    const hasContent =
      (card.title && card.title.trim()) ||
      (card.desc && card.desc.trim());
    if (hasContent) delete card._draft;
  }
  persist();
  if (typeof renderStats === 'function') renderStats();
}

function autoresizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function initDetailView() {
  const back = document.getElementById('detailBack');
  const del = document.getElementById('detailDelete');
  const exp = document.getElementById('detailExport');
  const run = document.getElementById('detailRun');
  const title = document.getElementById('d-title');
  const desc = document.getElementById('d-desc');
  const cat = document.getElementById('d-category');
  const prio = document.getElementById('d-priority');
  const status = document.getElementById('d-status');

  if (back) back.addEventListener('click', showBoard);
  if (del) del.addEventListener('click', deleteCurrent);
  if (exp) exp.addEventListener('click', exportCurrentMd);
  if (run) run.addEventListener('click', runCurrent);

  // Autoresize for AI command textarea
  if (desc) {
    desc.addEventListener('input', () => autoresizeTextarea(desc));
    desc.addEventListener('focus', () => autoresizeTextarea(desc));
  }

  // Cmd+Enter / Ctrl+Enter hotkey for AI command textarea
  const descEl2 = document.getElementById('d-desc');
  if (descEl2 && !descEl2.dataset.runHotkeyBound) {
    descEl2.addEventListener('keydown', (e) => {
      // Cmd+Enter (mac) or Ctrl+Enter
      const isSubmit = (e.metaKey || e.ctrlKey) && e.key === 'Enter';
      if (!isSubmit) return;
      if (e.isComposing) return;  // skip IME composition
      e.preventDefault();
      // Save desc immediately, then run if not already running
      if (state.detailCardId) {
        if (typeof saveDetailField === 'function') saveDetailField('desc', descEl2.value);
        const card = state.cards.find(c => c.id === state.detailCardId);
        if (card && !card.running) {
          if (typeof runCard === 'function') runCard(card);
          else if (typeof runCurrent === 'function') runCurrent();
        }
      }
    });
    descEl2.dataset.runHotkeyBound = '1';
  }

  // Auto-save on blur/change
  if (title) title.addEventListener('blur', () => saveDetailField('title', title.value));
  if (desc) desc.addEventListener('blur', () => saveDetailField('desc', desc.value));
  if (cat) cat.addEventListener('change', () => saveDetailField('category', cat.value));
  if (prio) prio.addEventListener('change', () => saveDetailField('priority', prio.value));
  if (status) status.addEventListener('change', () => saveDetailField('status', status.value));

  // ESC to return to board (only when not focused on input/textarea/select)
  document.addEventListener('keydown', function (e) {
    if (state.view === 'detail' && e.key === 'Escape') {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
      showBoard();
    }
  });

  const dModel = document.getElementById('d-model');
  const cwdPick = document.getElementById('d-cwd-pick');
  const cwdClear = document.getElementById('d-cwd-clear');
  const dAuto = document.getElementById('d-autoRun');
  const dAutoLabel = document.getElementById('d-autoRun-label');
  const dSkillsToggle = document.getElementById('d-useSkills');
  const dSkillsLabelToggle = document.getElementById('d-useSkills-label');
  const terminalBtn = document.getElementById('detailTerminal');

  if (dModel) dModel.addEventListener('change', () => saveDetailField('model', dModel.value));

  if (cwdPick) cwdPick.addEventListener('click', async () => {
    if (!state.detailCardId) return;
    const card = state.cards.find(c => c.id === state.detailCardId);
    const current = card && card.cwd ? card.cwd : undefined;
    const picked = await window.api.pickDirectory(current);
    if (picked) {
      saveDetailField('cwd', picked);
      renderDetail();
    }
  });

  if (cwdClear) cwdClear.addEventListener('click', () => {
    saveDetailField('cwd', '');
    renderDetail();
  });

  if (dAuto) dAuto.addEventListener('change', () => {
    saveDetailField('autoRun', dAuto.checked);
    if (dAutoLabel) dAutoLabel.textContent = dAuto.checked ? '자동으로 진행' : '확인 받으며 진행';
  });

  if (dSkillsToggle) dSkillsToggle.addEventListener('change', () => {
    saveDetailField('useSkills', dSkillsToggle.checked);
    if (dSkillsLabelToggle) dSkillsLabelToggle.textContent = dSkillsToggle.checked ? 'Agmo 스킬 활성화' : '기본 모드';
  });

  if (terminalBtn) terminalBtn.addEventListener('click', async () => {
    if (!state.detailCardId) return;
    const card = state.cards.find(c => c.id === state.detailCardId);
    const cwd = card && card.cwd ? card.cwd : undefined;
    try { await window.api.openTerminal(cwd); }
    catch (e) { console.warn('openTerminal failed', e); }
  });

  const editorBtn = document.getElementById('detailEditor');
  if (editorBtn) editorBtn.addEventListener('click', async () => {
    if (!state.detailCardId) return;
    const card = state.cards.find(c => c.id === state.detailCardId);
    const cwd = card && card.cwd ? card.cwd : undefined;
    try { await window.api.openEditor(cwd); }
    catch (e) { console.warn('openEditor failed', e); }
  });

  const compactBtn = document.getElementById('detailCompact');
  const compactProgress = document.getElementById('compactProgress');
  const compactText = document.getElementById('compactProgressText');

  // doCompact: can be called with an explicit card (auto-compact path) or without
  // (manual button click, falls back to detailCardId).
  async function doCompact(targetCard) {
    const card = targetCard || (state.detailCardId && state.cards.find(c => c.id === state.detailCardId));
    if (!card) return;

    const isManual = !targetCard; // button-click path shows UI chrome

    if (!card.sessionId) {
      if (isManual) {
        if (compactText) compactText.textContent = '압축할 세션이 없어요.';
        if (compactProgress) { compactProgress.hidden = false; compactProgress.classList.remove('is-indeterminate'); setTimeout(() => { if (compactProgress) compactProgress.hidden = true; }, 3000); }
      }
      return;
    }

    state.compactingCardId = card.id;
    if (isManual) {
      if (compactProgress) {
        compactProgress.hidden = false;
        compactProgress.classList.add('is-indeterminate');
      }
      if (compactBtn) compactBtn.disabled = true;
      if (compactText) compactText.textContent = '대화 요약 중…';
    }

    try {
      const res = await window.api.compactSession(card.id, card.sessionId, card.cwd || '', !!card.useSkills);
      if (!res || !res.ok) {
        if (isManual && compactText) compactText.textContent = '압축 실패: ' + (res && res.error ? res.error : '알 수 없음');
        return;
      }
      const summary = res.summary || '';
      card.summary = summary;
      card.sessionId = null;  // fresh 세션으로 재시작 유도
      card.log = card.log || [];
      const preview = summary.length > 80 ? summary.slice(0, 80) + '…' : summary;
      card.log.push({
        type: 'info',
        time: nowHMS(),
        text: `대화 압축됨 — ${preview}`,
      });
      if (typeof persist === 'function') persist();
      if (state.view === 'detail' && state.detailCardId === card.id) renderDetail();
      if (isManual && compactText) compactText.textContent = '압축 완료';
    } catch (e) {
      if (isManual && compactText) compactText.textContent = '요청 실패';
    } finally {
      state.compactingCardId = null;
      if (isManual) {
        if (compactBtn) compactBtn.disabled = false;
        if (compactProgress) compactProgress.classList.remove('is-indeterminate');
        setTimeout(() => { if (compactProgress) compactProgress.hidden = true; }, 4000);
      }
    }
  }

  if (compactBtn) compactBtn.addEventListener('click', doCompact);

  // Delegate click on .log-diff-open buttons inside the log box (one-time setup)
  const logBoxEl = document.getElementById('d-logBox');
  if (logBoxEl && !logBoxEl.dataset.diffDelegate) {
    logBoxEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('.log-diff-open');
      if (!btn) return;
      const entry = btn.closest('.log-entry-diff');
      if (!entry) return;
      const b64 = entry.getAttribute('data-diff');
      if (!b64) return;
      try {
        const payload = JSON.parse(decodeURIComponent(escape(atob(b64))));
        await window.api.showDiff(payload);
      } catch (err) {
        console.warn('showDiff failed', err);
      }
    });
    logBoxEl.dataset.diffDelegate = '1';
  }

  const resetBtn = document.getElementById('detailResetSession');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (!state.detailCardId) return;
    const card = state.cards.find(c => c.id === state.detailCardId);
    if (!card) return;
    if (!confirm('이 카드의 대화 세션을 초기화할까요? 다음 실행부터 새 대화로 시작합니다.')) return;
    card.sessionId = null;
    card.log = card.log || [];
    card.log.push({ type: 'info', time: nowHMS(), text: '새 대화로 초기화됨. 다음 실행부터 새 세션.' });
    if (typeof persist === 'function') persist();
    if (typeof renderDetail === 'function') renderDetail();
  });

  // 라벨 select 이벤트 바인딩
  const dLabelEl = document.getElementById('d-label');
  if (dLabelEl) {
    dLabelEl.addEventListener('change', () => {
      if (!state.detailCardId) return;
      const card = state.cards.find(c => c.id === state.detailCardId);
      if (!card) return;
      const newLabelId = dLabelEl.value || null;
      card.labelId = newLabelId;
      // 라벨 선택 시 cwd 자동 채움
      if (newLabelId) {
        const label = getLabel(newLabelId);
        if (label && label.path) {
          card.cwd = label.path;
        }
      }
      if (typeof persist === 'function') persist();
      if (typeof renderDetail === 'function') renderDetail();
      if (typeof renderColumns === 'function') renderColumns();
    });
  }

  const manageBtn = document.getElementById('d-label-manage');
  if (manageBtn) manageBtn.addEventListener('click', openLabelManager);

  // ai:log — real-time stdout line from Claude CLI
  if (window.api && window.api.onAiLog) {
    window.api.onAiLog(({ cardId, line, type, meta }) => {
      const card = state.cards.find(c => c.id === cardId);
      if (!card) return;
      card.log = card.log || [];
      const entry = {
        type: type || 'info',
        time: nowHMS(),
        text: String(line || '')
      };
      card.log.push(entry);
      // Clear draft flag when execution produces log entries
      if (card._draft) delete card._draft;

      // Accumulate tokens and cost from usage entries
      if (type === 'usage' && meta) {
        const inTok = Number(meta.inputTokens || 0);
        const outTok = Number(meta.outputTokens || 0);
        const cost = Number(meta.cost || 0);
        card.tokens = (Number(card.tokens) || 0) + inTok + outTok;
        card.cost = (Number(card.cost) || 0) + cost;
        card.cacheTokens = (Number(card.cacheTokens) || 0) + Number(meta.cacheReadTokens || 0) + Number(meta.cacheCreationTokens || 0);
      }

      if (typeof persist === 'function') persist();
      if (state.view === 'detail' && state.detailCardId === cardId && typeof renderDetail === 'function') renderDetail();
      if (typeof renderColumns === 'function') renderColumns();
    });
  }

  // ai:session — session_id from stream-json result event
  if (window.api && window.api.onAiSession) {
    window.api.onAiSession(({ cardId, sessionId }) => {
      const card = state.cards.find(c => c.id === cardId);
      if (!card) return;
      card.sessionId = sessionId;
      if (typeof persist === 'function') persist();
    });
  }

  // ai:done — CLI process finished
  if (window.api && window.api.onAiDone) {
    window.api.onAiDone(({ cardId, code, error, empty }) => {
      const card = state.cards.find(c => c.id === cardId);
      if (!card) return;
      card.log = card.log || [];
      if (error && code !== 0) {
        card.log.push({ type: 'error', time: nowHMS(), text: `오류: ${error}` });
        showToast({
          kind: 'error',
          title: `실행 실패 · ${card.title || '이름 없음'}`,
          body: String(error).slice(0, 160),
          duration: 6000,
          onToastClick: () => showDetail(cardId),
          actions: [{ label: '카드 열기', onClick: () => showDetail(cardId) }],
        });
      } else if (code !== 0) {
        card.log.push({ type: 'error', time: nowHMS(), text: `종료 코드 ${code} (비정상 종료)` });
        showToast({
          kind: 'error',
          title: `실행 실패 · ${card.title || '이름 없음'}`,
          body: `종료 코드 ${code}`,
          duration: 6000,
          onToastClick: () => showDetail(cardId),
          actions: [{ label: '카드 열기', onClick: () => showDetail(cardId) }],
        });
      } else if (empty) {
        card.log.push({ type: 'warn', time: nowHMS(), text: 'Claude가 빈 응답을 반환했습니다.' });
        showToast({
          kind: 'info',
          title: `빈 응답 · ${card.title || '이름 없음'}`,
          duration: 4500,
          onToastClick: () => showDetail(cardId),
        });
      } else {
        // Success
        showToast({
          kind: 'success',
          title: `작업 완료 · ${card.title || '이름 없음'}`,
          body: card.desc || '',
          duration: 4500,
          onToastClick: () => showDetail(cardId),
          actions: [{ label: '열기', primary: true, onClick: () => showDetail(cardId) }],
        });
      }
      if (typeof persist === 'function') persist();
      if (state.view === 'detail' && state.detailCardId === cardId && typeof renderDetail === 'function') renderDetail();
      if (typeof renderColumns === 'function') renderColumns();
    });
  }

  // 승인/거부 버튼 바인딩 — 실제 상태 전환은 onPendingResolved 이벤트에서 처리
  const approveBtn = document.getElementById('pendingApprove');
  const rejectBtn = document.getElementById('pendingReject');
  if (approveBtn) approveBtn.addEventListener('click', async () => {
    const card = state.cards.find(c => c.id === state.detailCardId);
    if (!card || !card.pendingConfirmation) return;
    approveBtn.disabled = true;
    if (rejectBtn) rejectBtn.disabled = true;
    await window.api.approvePending(card.id, card.pendingConfirmation.id);
    // State update and rerun are handled by onPendingResolved listener
    approveBtn.disabled = false;
    if (rejectBtn) rejectBtn.disabled = false;
  });
  if (rejectBtn) rejectBtn.addEventListener('click', async () => {
    const card = state.cards.find(c => c.id === state.detailCardId);
    if (!card || !card.pendingConfirmation) return;
    if (approveBtn) approveBtn.disabled = true;
    rejectBtn.disabled = true;
    await window.api.rejectPending(card.id, card.pendingConfirmation.id);
    // State update is handled by onPendingResolved listener
    if (approveBtn) approveBtn.disabled = false;
    rejectBtn.disabled = false;
  });

  // IPC 구독 — main → renderer pending 이벤트
  if (window.api && window.api.onPending) {
    window.api.onPending(({ cardId, pending }) => {
      const card = state.cards.find(c => c.id === cardId);
      if (!card) return;
      card.pendingConfirmation = pending;
      if (typeof persist === 'function') persist();
      if (state.view === 'detail' && state.detailCardId === cardId) renderDetail();
      if (typeof renderColumns === 'function') renderColumns();

      // Global toast — visible even when not on the detail view
      const title = `컨펌 필요 · ${card.title || '이름 없음'}`;
      const body = (pending.summary || pending.command || '').slice(0, 120);
      showToast({
        kind: 'pending',
        title,
        body,
        id: `pending-${cardId}`,
        duration: 0,   // stays until user acts
        onToastClick: () => showDetail(cardId),
        actions: [
          {
            label: '에디터로 보기',
            onClick: async () => {
              const recentDiff = (card.log || []).slice().reverse().find(e => e.type === 'diff');
              if (recentDiff) {
                try {
                  const payload = JSON.parse(recentDiff.text);
                  await window.api.showDiff(payload);
                } catch (e) {}
              } else {
                try { await window.api.openEditor(card.cwd || ''); } catch (e) {}
              }
            },
          },
          {
            label: '카드 열기',
            onClick: () => {
              showDetail(cardId);
            },
          },
          {
            label: '승인',
            primary: true,
            onClick: async () => {
              try {
                await window.api.approvePending(cardId, pending.id);
              } catch (e) {}
            },
          },
        ],
      });
    });
    window.api.onPendingResolved(({ cardId, id, accepted, rerun }) => {
      const card = state.cards.find(c => c.id === cardId);
      if (!card) return;
      if (card.pendingConfirmation && card.pendingConfirmation.id === id) {
        card.pendingConfirmation = null;
      }
      card.log = card.log || [];
      card.log.push({
        type: accepted ? 'info' : 'warn',
        time: nowHMS(),
        text: accepted ? '사용자가 승인했습니다. 재실행합니다.' : '사용자가 거부했습니다.'
      });
      if (typeof persist === 'function') persist();

      // Dismiss the pending toast for this card
      const container = __toastContainer();
      if (container) {
        const t = container.querySelector(`[data-toast-id="pending-${cardId}"]`);
        if (t) t.remove();
      }

      // If approved and rerun requested, immediately rerun with skip-permissions
      if (accepted && rerun) {
        if (state.view === 'detail' && state.detailCardId === cardId) renderDetail();
        if (typeof renderColumns === 'function') renderColumns();
        runCard(card, { skipPermissions: true });
        return;
      }
      if (state.view === 'detail' && state.detailCardId === cardId) renderDetail();
      if (typeof renderColumns === 'function') renderColumns();
    });
  }
}

// ============ CARD OPEN / CREATE ============
function openCard(id) {
  showDetail(id);
}

function openNewCard(status = 'todo') {
  const id = uid();
  const card = {
    id,
    title: '',
    desc: '',
    category: (currentCategoryId !== 'all' ? currentCategoryId : null)
              || (state.categories[0] && state.categories[0].id) || '',
    priority: 'med',
    status: status,
    progress: 0,
    tokens: 0,
    log: [],
    createdAt: Date.now(),
    model: '',
    cwd: '',
    autoRun: false,
    useSkills: false,
    _draft: true,    // Mark as draft until user enters any content
  };
  state.cards.push(card);
  // Do not persist yet — draft card is memory-only until content is entered
  showDetail(id);
}

function fillCategorySelect(selected) {
  // Legacy no-op — category select is now filled via renderDetail()
}

function closeModal() {
  /* legacy no-op — card modal removed */
}

function saveCard() { /* legacy no-op — detail view uses auto-save */ }

async function deleteCurrent() {
  if (!state.detailCardId) return;
  if (!confirm('이 작업을 삭제할까요?')) return;
  const idx = state.cards.findIndex(c => c.id === state.detailCardId);
  if (idx >= 0) state.cards.splice(idx, 1);
  await persist();
  showBoard();
  toast('삭제됨');
}

async function deleteCard(id) {
  if (!confirm('이 작업을 삭제할까요?')) return;
  state.cards = state.cards.filter(c => c.id !== id);
  await persist(); render();
}

function renderMarkdown(text) {
  if (!text) return '';
  let src = String(text).replace(/\r\n/g, '\n');

  // 1. Extract fenced code blocks first (replace with placeholders to avoid rule interference)
  const codeBlocks = [];
  src = src.replace(/```([a-zA-Z0-9+\-_]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: (lang || '').trim(), code });
    return `\u0000CODEBLOCK${idx}\u0000`;
  });

  // 2. Extract inline code (replace with placeholders)
  const inlineCodes = [];
  src = src.replace(/`([^`\n]+?)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(code);
    return `\u0000INLINE${idx}\u0000`;
  });

  // 3. Escape HTML on the remaining source
  src = escapeHtml(src);

  // 4. Headers (#### must come before ### etc.)
  src = src.replace(/^####\s+(.+)$/gm, '<h4 class="md-h">$1</h4>');
  src = src.replace(/^###\s+(.+)$/gm, '<h3 class="md-h">$1</h3>');
  src = src.replace(/^##\s+(.+)$/gm, '<h2 class="md-h">$1</h2>');
  src = src.replace(/^#\s+(.+)$/gm, '<h1 class="md-h">$1</h1>');

  // 5. Horizontal rule
  src = src.replace(/^[\s]*---+[\s]*$/gm, '<hr class="md-hr" />');

  // 6. Blockquote (&gt; because escapeHtml already ran)
  src = src.replace(/^&gt;\s?(.+)$/gm, '<blockquote class="md-quote">$1</blockquote>');

  // 7. Unordered lists — wrap consecutive - or * lines in <ul>
  src = src.replace(/(?:^(?:[-*])\s+.+(?:\n|$))+/gm, (block) => {
    const items = block.trim().split(/\n/).map(l => l.replace(/^[-*]\s+/, ''));
    return '<ul class="md-list">' + items.map(it => `<li>${it}</li>`).join('') + '</ul>';
  });

  // 8. Ordered lists — wrap consecutive N. lines in <ol>
  src = src.replace(/(?:^\d+\.\s+.+(?:\n|$))+/gm, (block) => {
    const items = block.trim().split(/\n/).map(l => l.replace(/^\d+\.\s+/, ''));
    return '<ol class="md-list">' + items.map(it => `<li>${it}</li>`).join('') + '</ol>';
  });

  // 9. Bold & italic (bold before italic to avoid ** being treated as italic)
  src = src.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  src = src.replace(/(?<!\*)\*(?!\*)([^\n*]+?)\*(?!\*)/g, '<em>$1</em>');
  src = src.replace(/(?<!_)_(?!_)([^\n_]+?)_(?!_)/g, '<em>$1</em>');

  // 10. Links (http/https scheme whitelist only)
  src = src.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // 11. Paragraphs — split on blank lines; wrap plain blocks in <p>
  const blocks = src.split(/\n\n+/).map(b => {
    const trimmed = b.trim();
    if (!trimmed) return '';
    // Already a block-level element
    if (/^<(h[1-6]|ul|ol|blockquote|pre|hr)/.test(trimmed)) return trimmed;
    // Lone code block placeholder
    if (/^\u0000CODEBLOCK\d+\u0000$/.test(trimmed)) return trimmed;
    return '<p class="md-p">' + trimmed.replace(/\n/g, '<br>') + '</p>';
  });
  src = blocks.join('');

  // 12. Restore placeholders
  src = src.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_, i) => {
    const { lang, code } = codeBlocks[Number(i)];
    const safeCode = escapeHtml(code);
    const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
    return `<pre class="md-code"${langAttr}><code>${safeCode}</code></pre>`;
  });
  src = src.replace(/\u0000INLINE(\d+)\u0000/g, (_, i) => {
    const code = inlineCodes[Number(i)];
    return `<code class="md-inline">${escapeHtml(code)}</code>`;
  });

  return src;
}

function renderLogEntries(log) {
  if (!Array.isArray(log) || log.length === 0) return '';

  // STREAM skip indices: hide STREAM entries when their time matches a RESULT entry's time
  const skipIndices = new Set();
  const getEntryType = (e) => ((e && (e.type || e.label)) || '').toLowerCase();
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    if (entry && getEntryType(entry) === 'result' && entry.time) {
      for (let j = 0; j < log.length; j++) {
        const other = log[j];
        if (j !== i && other && getEntryType(other) === 'stream' && other.time === entry.time) {
          skipIndices.add(j);
        }
      }
    }
  }

  const reversed = log.slice().reverse();  // copy then reverse — newest first
  return reversed.map((entry, reversedIdx) => {
    const originalIdx = log.length - 1 - reversedIdx;
    if (skipIndices.has(originalIdx)) return '';
    let type = 'info', time = '', text = '';
    if (typeof entry === 'string') {
      const m = /^\[?(START|ERROR|RESULT|USAGE|INFO|WARN)\]?\s*(\d{1,2}[:]\d{1,2}[:]\d{1,2})?\s*(.*)$/is.exec(entry);
      if (m) { type = m[1].toLowerCase(); time = m[2] || ''; text = m[3] || ''; }
      else { text = entry; }
    } else if (entry && typeof entry === 'object') {
      type = (entry.label || entry.type || 'info').toLowerCase();
      time = entry.time || entry.at || '';
      text = entry.body || entry.text || entry.message || entry.line || '';
    }

    // DIFF entry — parse and render as diff viewer
    if (type === 'diff') {
      let payload = null;
      try { payload = JSON.parse(text); } catch (e) {}
      if (!payload) return '';
      const before = payload.before || '';
      const after = payload.after || '';
      const filePath = payload.filePath || '';
      const lines = computeDiff(before, after);
      const diffHtml = lines.length === 0
        ? `<div class="diff-empty">변경 없음</div>`
        : lines.map(l => {
            const sign = l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' ';
            return `<div class="diff-line ${l.type}"><span class="sign">${sign}</span><span>${escapeHtml(l.text)}</span></div>`;
          }).join('');
      // base64 encode payload for safe attribute storage
      const payloadB64 = btoa(unescape(encodeURIComponent(JSON.stringify({ filePath, before, after }))));
      return `<div class="log-entry log-entry-diff" data-diff="${payloadB64}">
        <span class="log-badge log-badge-diff">DIFF</span>
        ${time ? `<span class="log-time">${escapeHtml(time)}</span>` : ''}
        <div class="log-diff-body">
          <div class="log-diff-path">
            ${escapeHtml(filePath)}
            <button class="log-diff-open" type="button" title="에디터에서 Diff 보기">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
              에디터
            </button>
          </div>
          <div class="diff-view">${diffHtml}</div>
        </div>
      </div>`;
    }

    const badgeClass = `log-badge log-badge-${type}`;
    const labelMap = {
      stream: 'STREAM',
      tool: 'TOOL',
      toolresult: 'TOOL',
      user: 'USER',
    };
    const badgeLabel = labelMap[type] || type.toUpperCase();
    // RESULT and STREAM entries render inline with markdown content as a flex item
    if (type === 'result' || type === 'stream') {
      return `<div class="log-entry">
        <span class="${badgeClass}">${badgeLabel}</span>
        ${time ? `<span class="log-time">${escapeHtml(time)}</span>` : ''}
        <div class="log-text log-markdown">${renderMarkdown(text)}</div>
      </div>`;
    }
    // All other types stay as plain inline text
    return `<div class="log-entry">
      <span class="${badgeClass}">${badgeLabel}</span>
      ${time ? `<span class="log-time">${escapeHtml(time)}</span>` : ''}
      <span class="log-text">${escapeHtml(text)}</span>
    </div>`;
  }).filter(Boolean).join('');
}

function renderLogs(card) {
  const section = document.getElementById('logSection');
  const box = document.getElementById('logBox');
  const tokensLabel = document.getElementById('logTokens');
  if (!card.log || card.log.length === 0) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  tokensLabel.textContent = `${(card.tokens||0).toLocaleString()} tokens`;
  box.innerHTML = renderLogEntries(card.log);
}

// ============ AUTH ============
async function refreshAuthStatus() {
  cliStatus = await window.api.detectClaudeCLI();
  const hasKey = await window.api.hasKey();
  currentAuthMode = await window.api.getAuthMode();

  const chip = document.getElementById('authChip');
  const label = document.getElementById('authLabel');

  if (chip && label) {
    const effective = resolveEffectiveAuth(currentAuthMode, cliStatus.found, hasKey);
    chip.classList.toggle('connected', !!effective);
    chip.classList.toggle('disconnected', !effective);
    if (effective) {
      const provider = effective === 'cli' ? 'Claude CLI' : 'API 키';
      label.textContent = `연결됨 · ${provider}`;
    } else {
      label.textContent = '연결하기';
    }
  }

  renderAuthModal(hasKey);
}

function resolveEffectiveAuth(mode, cliOk, hasKey) {
  if (mode === 'cli') return cliOk ? 'cli' : null;
  if (mode === 'api') return hasKey ? 'api' : null;
  if (mode === 'auto') {
    if (cliOk) return 'cli';
    if (hasKey) return 'api';
    return null;
  }
  return null;
}

function renderAuthModal(hasKey) {
  const cliBadge = document.getElementById('cliBadge');
  const cliStep = document.getElementById('cliStep');
  const useCliBtn = document.getElementById('useCliBtn');
  const apiBadge = document.getElementById('apiBadge');
  const useApiBtn = document.getElementById('useApiBtn');
  const clearKeyBtn = document.getElementById('clearKeyBtn');
  const apiInput = document.getElementById('apiKeyInput');

  if (cliStatus.found) {
    cliBadge.textContent = currentAuthMode === 'cli' ? '사용 중' : '설치됨';
    cliBadge.className = 'badge badge-sm ' + (currentAuthMode === 'cli' ? 'active' : 'ok');
    cliStep.innerHTML = `<div class="flex items-center gap-2"><span>✓</span><span>Claude CLI 감지 완료</span></div>
      <div class="text-xs mt-1 font-mono">${escapeHtml(cliStatus.path)} · ${escapeHtml(cliStatus.version || '')}</div>`;
    useCliBtn.disabled = false;
  } else {
    cliBadge.textContent = '미설치';
    cliBadge.className = 'badge badge-sm warn';
    cliStep.innerHTML = `<div>Claude CLI가 감지되지 않았어요. 설치 후 "다시 감지"를 눌러주세요.</div>`;
    useCliBtn.disabled = true;
  }

  if (hasKey) {
    apiBadge.textContent = currentAuthMode === 'api' ? '사용 중' : '저장됨';
    apiBadge.className = 'badge badge-sm ' + (currentAuthMode === 'api' ? 'active' : 'ok');
    apiInput.value = '••••••••••••';
    clearKeyBtn.classList.remove('hidden');
    useApiBtn.disabled = false;
  } else {
    apiBadge.textContent = '미설정';
    apiBadge.className = 'badge badge-sm';
    apiInput.value = '';
    clearKeyBtn.classList.add('hidden');
    useApiBtn.disabled = true;
  }

  const modeLabels = {
    auto: '자동 (CLI 우선)',
    cli: 'Claude CLI 전용',
    api: 'API 키 전용',
  };
  document.getElementById('authCurrent').innerHTML =
    `현재 모드: <span class="font-semibold">${modeLabels[currentAuthMode] || currentAuthMode}</span>`;
}

async function openAuthModal() {
  await refreshAuthStatus();
  document.getElementById('authModal').showModal();
}
function closeAuthModal() {
  document.getElementById('authModal').close();
}
async function recheckCLI() {
  toast('감지 중...');
  await refreshAuthStatus();
  if (cliStatus.found) toast('CLI 감지 성공', 'success');
  else toast('CLI 못 찾음. 터미널에서 claude --version 확인', 'error');
}
async function selectAuthMode(mode) {
  const hasKey = await window.api.hasKey();
  if (mode === 'cli' && !cliStatus.found) { toast('CLI가 설치되어 있지 않아요', 'error'); return; }
  if (mode === 'api' && !hasKey) { toast('API 키를 먼저 입력하세요', 'error'); return; }
  if (mode === 'auto' && !cliStatus.found && !hasKey) { toast('CLI도 없고 키도 없어요', 'error'); return; }
  await window.api.setAuthMode(mode);
  currentAuthMode = mode;
  toast(`인증 모드 변경됨`, 'success');
  await refreshAuthStatus();
}
async function clearApiKey() {
  if (!confirm('저장된 API 키를 삭제할까요?')) return;
  await window.api.clearKey();
  await refreshAuthStatus();
  toast('API 키 삭제됨');
}
async function openClaudeInstall() { await window.api.openClaudeInstall(); }
async function openApiKeys() { await window.api.openApiKeys(); }

// ============ ELAPSED TICKER ============
let __elapsedTimer = null;
function startElapsedTicker() {
  if (__elapsedTimer) return;
  __elapsedTimer = setInterval(() => {
    const anyRunning = state.cards && state.cards.some(c => c.running);
    if (!anyRunning) {
      clearInterval(__elapsedTimer);
      __elapsedTimer = null;
      return;
    }
    // Update elapsed time in detail view
    if (state.view === 'detail') {
      const el = document.getElementById('detailRunningElapsed');
      const card = state.cards.find(c => c.id === state.detailCardId);
      if (el && card && card.running && card.runStartedAt) {
        const sec = Math.max(0, Math.round((Date.now() - card.runStartedAt) / 1000));
        el.textContent = ' \u00b7 ' + sec + '\ucd08';
      }
    }
    // Refresh card previews in board view
    if (typeof renderColumns === 'function') renderColumns();
  }, 1000);
}

// ============ AI RUN ============
function ensureCardTitle(card) {
  if (card.title && card.title.trim()) return;
  let newTitle = '';
  if (card.desc && card.desc.trim()) {
    const firstLine = card.desc.trim().split(/\r?\n/)[0].trim();
    newTitle = firstLine.length > 40 ? firstLine.slice(0, 40).trim() + '…' : firstLine;
  }
  if (!newTitle) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    newTitle = `새 작업 · ${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  card.title = newTitle;
  // Auto-generated title counts as real content — clear draft flag
  if (card._draft) delete card._draft;
  if (typeof persist === 'function') persist();
  if (typeof renderDetail === 'function' && state.detailCardId === card.id) renderDetail();
  if (typeof renderBoard === 'function') renderBoard();
}

async function quickRun(cardId) {
  const card = state.cards.find(c => c.id === cardId);
  if (!card) return;
  await runCard(card);
}
async function runCurrent() {
  if (!state.detailCardId) { toast('카드를 열어주세요', 'error'); return; }
  const card = state.cards.find(c => c.id === state.detailCardId);
  if (!card) return;
  await runCard(card);
}

async function runCard(card, opts = {}) {
  const hasKey = await window.api.hasKey();
  const effective = resolveEffectiveAuth(currentAuthMode, cliStatus.found, hasKey);
  if (!effective) {
    toast('인증이 설정되지 않았어요', 'error');
    openAuthModal();
    return;
  }
  if (card.running) return;

  // Auto-compact: trigger before running if turn count or idle time exceeds threshold.
  // Skip when: no sessionId (fresh session), already compacting, or retry path.
  if (card.sessionId && !opts._retriedWithoutSession) {
    const userTurns = (card.log || []).filter(e => e.type === 'user').length;
    const idleMs = card.lastRunAt ? (Date.now() - card.lastRunAt) : 0;
    const needsCompact = userTurns >= AUTO_COMPACT_TURN_THRESHOLD || idleMs >= AUTO_COMPACT_IDLE_MS;
    if (needsCompact) {
      pushLog(card, 'AUTO-COMPACT', `자동 compact 수행 중… (turns=${userTurns}, idle=${Math.round(idleMs/60000)}min)`);
      if (state.view === 'detail' && state.detailCardId === card.id && typeof renderDetail === 'function') renderDetail();
      try {
        await doCompact(card);
      } catch (e) {
        // compact failure is non-fatal — continue with normal runCard flow
        pushLog(card, 'AUTO-COMPACT', `compact 실패, 계속 진행: ${e}`);
      }
    }
  }

  // Capture prompt before clearing
  const promptText = (card.desc || '').trim();
  if (!promptText && !opts.skipPermissions) { if (typeof alert === 'function') alert('명령을 입력해주세요.'); return; }

  // Push USER log entry so the prompt appears in the log
  card.log = card.log || [];
  card.log.push({ type: 'user', time: nowHMS(), text: promptText });

  // Clear textarea immediately so the user can type the next prompt
  card.desc = '';
  const descEl = document.getElementById('d-desc');
  if (descEl) {
    descEl.value = '';
    if (typeof autoresizeTextarea === 'function') autoresizeTextarea(descEl);
  }

  // Inline title generation using captured promptText (card.desc is now empty)
  if (!card.title || !card.title.trim()) {
    const firstLine = promptText.split(/\r?\n/)[0].trim();
    card.title = firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine;
    if (!card.title) card.title = '새 작업 · ' + nowHMS();
    if (card._draft) delete card._draft;
  }

  // Running counts as real usage — clear draft flag to preserve the card
  if (card._draft) delete card._draft;

  const sidebarModel = document.getElementById('modelSelect').value;
  const model = card.model || sidebarModel;
  const cardId = card.id;

  // Helper: update state then refresh UI without coupling to DOM directly
  function syncUI() {
    renderColumns();
    if (state.view === 'detail' && state.detailCardId === cardId) {
      renderDetail();
    }
  }

  card.pendingConfirmation = null;
  card.running = true;
  card.runStartedAt = Date.now();
  card.status = 'doing';
  card.progress = 10;
  pushLog(card, 'START', `model=${model} · via=${effective} · 실행 시작`);
  await persist();
  syncUI();
  startElapsedTicker();

  // Gradually advance progress bar via state only — no direct DOM manipulation
  const progressTimer = setInterval(() => {
    // Re-lookup card by id in case state was reloaded
    const c = state.cards.find(x => x.id === cardId);
    if (!c || !c.running) {
      clearInterval(progressTimer);
      return;
    }
    if (c.progress < 95) {
      c.progress = Math.min(95, c.progress + Math.random() * 8);
      renderColumns();
      // Only update detail view if still viewing this card
      if (state.view === 'detail' && state.detailCardId === cardId) {
        renderDetail();
      }
    }
  }, 600);

  // 세션 없고 summary 있으면 요약을 context 로 prepend
  let effectivePrompt = promptText;
  if (!card.sessionId && card.summary && card.summary.trim()) {
    effectivePrompt = `[이전 대화 요약]\n${card.summary}\n\n---\n\n${promptText}`;
  }
  const systemPrompt = buildSystemPrompt(card);
  const userPrompt = buildUserPrompt(card, effectivePrompt);
  let result;
  try {
    result = await window.api.run({ model, prompt: userPrompt, systemPrompt, maxTokens: 2048, cwd: card.cwd || undefined, autoRun: !!card.autoRun, useSkills: !!card.useSkills, cardId, skipPermissions: !!opts.skipPermissions, sessionId: card.sessionId || null });
  } catch (err) {
    result = { ok: false, error: String(err) };
  } finally {
    clearInterval(progressTimer);
  }

  // Re-lookup card after await in case something changed during execution
  const c = state.cards.find(x => x.id === cardId);
  if (!c) return; // card was deleted while running

  // Session expired — clear sessionId and retry once with a fresh session
  if (result && result.sessionExpired && !opts._retriedWithoutSession && c.sessionId) {
    c.sessionId = null;
    if (typeof persist === 'function') persist();
    return runCard(c, { ...opts, _retriedWithoutSession: true });
  }

  if (!result.ok) {
    c.running = false;
    c.runStartedAt = null;
    c.progress = 0;
    pushLog(c, 'ERROR', result.error);
    await persist();
    syncUI();
    toast('실패: ' + result.error, 'error');
    return;
  }

  // Persist new session_id returned from CLI
  if (result.sessionId) {
    c.sessionId = result.sessionId;
  }

  const usage = result.usage || { input_tokens: 0, output_tokens: 0 };
  const totalTok = (usage.input_tokens || 0) + (usage.output_tokens || 0);
  const price = MODEL_PRICES[model] || MODEL_PRICES['claude-sonnet-4-5'];
  const cost = (usage.input_tokens * price.in + usage.output_tokens * price.out) / 1_000_000;

  c.tokens = (c.tokens || 0) + totalTok;
  c.progress = 100;
  c.running = false;
  c.runStartedAt = null;
  c.lastRunAt = Date.now(); // used by auto-compact idle check
  c.status = 'review';
  // stream-json 모드에서는 result.text 가 비어있음 — ai:log 이벤트에서 이미 RESULT 수신됨
  if (result.text && result.text.trim()) pushLog(c, 'RESULT', result.text);
  const viaLabel = result.via === 'claude-cli' ? 'Claude CLI' : 'API';
  const fallbackNote = result.fallbackFrom ? ` (fallback from ${result.fallbackFrom})` : '';
  pushLog(c, 'USAGE', `via=${viaLabel}${fallbackNote} · in=${usage.input_tokens} · out=${usage.output_tokens} · $${cost.toFixed(5)}`);

  state.totals.tokens += totalTok;
  state.totals.runs += 1;
  state.totals.cost += cost;

  await persist();
  syncUI();
  toast(`완료 (+${totalTok} tokens)`, 'success');
}

function buildSystemPrompt(card) {
  const cat = state.categories.find(c => c.id === card.category);
  return `당신은 개인 작업 보조 AI입니다. 아래 작업을 수행해주세요.

[카테고리] ${cat ? cat.name : '-'}
[작업 제목] ${card.title}

한국어로 깔끔하게 답변하세요. 불필요한 서론 없이 바로 본론으로.`;
}

function buildUserPrompt(card, promptOverride) {
  return promptOverride || card.desc || '(요청 내용 없음. 제목만 보고 적절한 결과를 만들어주세요.)';
}

function buildPrompt(card, promptOverride) {
  const cat = state.categories.find(c => c.id === card.category);
  const descText = promptOverride || card.desc || '(요청 내용 없음. 제목만 보고 적절한 결과를 만들어주세요.)';
  return `당신은 개인 작업 보조 AI입니다. 아래 작업을 수행해주세요.

[카테고리] ${cat ? cat.name : '-'}
[작업 제목] ${card.title}
[요청 내용]
${descText}

한국어로 깔끔하게 답변하세요. 불필요한 서론 없이 바로 본론으로.`;
}

function pushLog(card, label, body) {
  card.log = card.log || [];
  card.log.push({
    time: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
    label, body
  });
}

// ============ EXPORT ============
async function exportCurrentMd() {
  if (!state.detailCardId) return;
  const card = state.cards.find(c => c.id === state.detailCardId);
  if (!card) return;
  const r = await window.api.exportMarkdown(card);
  if (r.ok) toast('마크다운 저장됨', 'success');
  else toast('저장 실패: ' + r.error, 'error');
}
async function openExports() { await window.api.openExportFolder(); }
async function backupJson() {
  const r = await window.api.backupJson();
  if (r.ok) toast('백업 저장됨', 'success');
  else if (!r.canceled) toast('백업 실패: ' + r.error, 'error');
}
async function resetAll() {
  if (!confirm('모든 카드와 기록을 지울까요? (카테고리와 인증은 유지)')) return;
  state.cards = sampleCards();
  state.totals = { tokens: 0, runs: 0, cost: 0 };
  await persist(); render();
  toast('초기화됨');
}
async function openExternal(url) { await window.api.openExternal(url); }

// ===== Theme & Sidebar Toggle =====
function _safeGet(key) {
  try { return localStorage.getItem(key); } catch (e) { console.warn('localStorage unavailable', e); return null; }
}
function _safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { console.warn('localStorage unavailable', e); }
}

function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
}

function toggleTheme() {
  var isDark = document.documentElement.classList.contains('dark');
  var next = isDark ? 'light' : 'dark';
  applyTheme(next);
  _safeSet('vk:theme', next);
}

function applySidebar(state) {
  var s = state === 'closed' ? 'closed' : 'open';
  document.body.setAttribute('data-sidebar', s);
  document.documentElement.setAttribute('data-sidebar', s);
}

function toggleSidebar() {
  var current = document.body.getAttribute('data-sidebar') || document.documentElement.getAttribute('data-sidebar') || 'open';
  var next = current === 'open' ? 'closed' : 'open';
  // console.log('[toggleSidebar]', current, '->', next);  // debug
  applySidebar(next);
  _safeSet('vk:sidebar', next);
}

function initMoreMenu() {
  var wrap = document.getElementById('moreMenu');
  var btn = document.getElementById('moreMenuBtn');
  if (!wrap || !btn) return;
  function close() { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
  function open() { wrap.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (wrap.classList.contains('open')) close(); else open();
  });
  document.addEventListener('click', function (e) {
    if (!wrap.contains(e.target)) close();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  // close on menu item click
  wrap.querySelectorAll('.dropdown-content a, .dropdown-content button').forEach(function (el) {
    el.addEventListener('click', close);
  });
}

function initThemeAndSidebar() {
  // initial theme (FOUC script may have already set it, fallback if not stored)
  var storedTheme = _safeGet('vk:theme');
  if (!storedTheme) {
    var prefersDark = false;
    try { prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) {}
    storedTheme = prefersDark ? 'dark' : 'light';
    _safeSet('vk:theme', storedTheme);
  }
  applyTheme(storedTheme);

  // initial sidebar: sync documentElement -> body
  var storedSidebar = _safeGet('vk:sidebar') || document.documentElement.getAttribute('data-sidebar') || 'open';
  applySidebar(storedSidebar);

  // button event binding
  var sbBtn = document.getElementById('sidebar-toggle');
  if (sbBtn && !sbBtn.dataset.bound) {
    sbBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleSidebar();
    });
    sbBtn.dataset.bound = '1';
  }

  var thBtn = document.getElementById('theme-toggle');
  if (thBtn && !thBtn.dataset.bound) {
    thBtn.addEventListener('click', toggleTheme);
    thBtn.dataset.bound = '1';
  }
}

// ============ DIFF UTIL ============
function computeDiff(before, after) {
  if (before == null && after == null) return [];
  const a = (before || '').split(/\r?\n/);
  const b = (after || '').split(/\r?\n/);
  const result = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) {
      if (typeof a[i] !== 'undefined') result.push({ type: 'ctx', text: a[i] });
    } else {
      if (typeof a[i] !== 'undefined') result.push({ type: 'del', text: a[i] });
      if (typeof b[i] !== 'undefined') result.push({ type: 'add', text: b[i] });
    }
  }
  return result;
}

// ============ STRING UTIL ============
function truncate(s, max) {
  s = String(s || '');
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '\u2026';
}

// ============ TIME UTIL ============
function nowHMS() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}시 ${pad(d.getMinutes())}분 ${pad(d.getSeconds())}초`;
}

function parseStreamLine(line, type) {
  const s = String(line || '');
  return { type: type || 'info', time: nowHMS(), text: s };
}

// ============ UTIL ============
function toast(msg, type='') {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'alert ' + (type === 'success' ? 'alert-success' : type === 'error' ? 'alert-error' : '');
  el.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============ GLOBAL TOAST SYSTEM ============
const __toastContainer = () => document.getElementById('toastContainer');

function showToast({ kind = 'info', title, body = '', actions = [], duration = 4500, id = null, onToastClick = null }) {
  const container = __toastContainer();
  if (!container) return;

  // Prevent duplicates: replace existing toast with same id
  if (id) {
    const existing = container.querySelector(`[data-toast-id="${id}"]`);
    if (existing) existing.remove();
  }

  const toastEl = document.createElement('div');
  toastEl.className = `toast toast-${kind}`;
  if (id) toastEl.setAttribute('data-toast-id', id);

  toastEl.innerHTML = `
    <div class="toast-left">
      <div class="toast-title">${escapeHtml(title || '')}</div>
      ${body ? `<div class="toast-body">${escapeHtml(body)}</div>` : ''}
    </div>
    ${actions.length ? `<div class="toast-actions"></div>` : ''}
  `;

  function dismiss() {
    toastEl.classList.add('is-leaving');
    setTimeout(() => toastEl.remove(), 220);
  }

  toastEl.addEventListener('click', (e) => {
    if (!e.target.closest('.toast-action-btn')) {
      if (onToastClick) onToastClick();
      dismiss();
    }
  });

  if (actions.length) {
    const actionsEl = toastEl.querySelector('.toast-actions');
    const primary = actions.find(a => a.primary) || actions[0];
    const btn = document.createElement('button');
    btn.className = 'toast-action-btn';
    btn.type = 'button';
    btn.textContent = primary.label;
    btn.addEventListener('click', () => {
      try { primary.onClick && primary.onClick(); } catch (e) {}
      dismiss();
    });
    actionsEl.appendChild(btn);
  }

  container.appendChild(toastEl);

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }

  return { el: toastEl, dismiss };
}

// ============ INPUT HANDLERS ============
document.getElementById('apiKeyInput').addEventListener('change', async (e) => {
  const v = e.target.value.trim();
  if (v.startsWith('sk-ant-')) {
    const r = await window.api.saveKey(v);
    if (r.ok) { toast(r.encrypted ? 'API 키 저장 (암호화)' : 'API 키 저장', 'success'); await refreshAuthStatus(); }
    else toast('저장 실패: ' + r.error, 'error');
  } else if (v === '' || v.startsWith('••')) {
    // ignore
  } else {
    toast('sk-ant- 로 시작하는 키가 필요해요', 'error');
  }
});

document.getElementById('modelSelect').addEventListener('change', async (e) => {
  await window.api.setModel(e.target.value);
  renderModelHint();
});

(function bindNewCatEnter() {
  const el = document.getElementById('newCatName');
  if (!el || el.dataset.bound) return;
  el.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (typeof addCategory === 'function') addCategory();
    }
  });
  el.dataset.bound = '1';
})();

// ============ LABEL MANAGER ============
function openLabelManager() {
  renderLabelEditor();
  initLabelAddUI();
  const m = document.getElementById('labelModal');
  if (m) m.showModal();
}
function closeLabelModal() {
  const m = document.getElementById('labelModal');
  if (m) m.close();
}

let __pendingNewLabelPath = '';

function renderLabelEditor() {
  const listEl = document.getElementById('labelList');
  if (!listEl) return;
  listEl.innerHTML = state.labels.map(l => {
    const c = getLabelColor(l.id);
    return `
    <li class="label-row" data-label-id="${l.id}">
      <span class="label-dot" style="background-color: ${c.fg}"></span>
      <span class="label-name" data-label-rename="${l.id}" tabindex="0" role="button">${escapeHtml(l.name)}</span>
      <span class="label-path-text" data-label-path-edit="${l.id}" title="${escapeHtml(l.path || '경로 미설정')}">${escapeHtml(l.path || '(경로 미설정)')}</span>
      <button class="btn btn-icon btn-sm label-path-pick" type="button" data-label-path-pick="${l.id}" title="경로 변경">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h5l2-2h11v13H3z"></path></svg>
      </button>
      <button class="btn btn-icon btn-sm label-delete item-action" type="button" data-label-del="${l.id}" title="삭제">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </li>
  `;
  }).join('');

  // 이벤트 바인딩
  listEl.querySelectorAll('button[data-label-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-label-del');
      const l = getLabel(id);
      if (!l) return;
      if (!confirm(`"${l.name}" 라벨을 삭제할까요? 이 라벨이 붙은 카드는 라벨이 해제됩니다.`)) return;
      deleteLabel(id);
      renderLabelEditor();
      if (typeof renderDetail === 'function' && state.view === 'detail') renderDetail();
      if (typeof renderColumns === 'function') renderColumns();
    });
  });

  listEl.querySelectorAll('button[data-label-path-pick]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-label-path-pick');
      const l = getLabel(id);
      if (!l) return;
      const picked = await window.api.pickDirectory(l.path || undefined);
      if (picked) {
        updateLabel(id, { path: picked });
        renderLabelEditor();
      }
    });
  });

  listEl.querySelectorAll('[data-label-rename]').forEach(el => {
    el.addEventListener('click', () => startRenameLabel(el));
  });

  listEl.querySelectorAll('[data-label-path-edit]').forEach(el => {
    el.addEventListener('click', async (e) => {
      const id = el.getAttribute('data-label-path-edit');
      const l = getLabel(id);
      if (!l) return;
      const picked = await window.api.pickDirectory(l.path || undefined);
      if (picked) {
        updateLabel(id, { path: picked });
        renderLabelEditor();
      }
    });
  });
}

function startRenameLabel(spanEl) {
  const id = spanEl.getAttribute('data-label-rename');
  const l = getLabel(id);
  if (!l) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input-inline';
  input.value = l.name;
  spanEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  function commit(save) {
    if (done) return;
    done = true;
    const newName = input.value.trim();
    if (save && newName && newName !== l.name) updateLabel(id, { name: newName });
    renderLabelEditor();
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
}

function initLabelAddUI() {
  const addBtn = document.getElementById('newLabelAdd');
  const pickBtn = document.getElementById('newLabelPick');
  const nameInput = document.getElementById('newLabelName');
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.addEventListener('click', async () => {
      const name = (nameInput && nameInput.value || '').trim();
      if (!name) { nameInput && nameInput.focus(); return; }
      createLabel({ name, path: __pendingNewLabelPath });
      if (nameInput) nameInput.value = '';
      __pendingNewLabelPath = '';
      if (pickBtn) pickBtn.textContent = '경로 선택';
      renderLabelEditor();
      if (typeof renderDetail === 'function' && state.view === 'detail') renderDetail();
    });
    addBtn.dataset.bound = '1';
  }
  if (pickBtn && !pickBtn.dataset.bound) {
    pickBtn.addEventListener('click', async () => {
      const picked = await window.api.pickDirectory(__pendingNewLabelPath || undefined);
      if (picked) {
        __pendingNewLabelPath = picked;
        if (pickBtn) pickBtn.textContent = '경로: ' + (picked.length > 20 ? '\u2026' + picked.slice(-20) : picked);
      }
    });
    pickBtn.dataset.bound = '1';
  }
  if (nameInput && !nameInput.dataset.bound) {
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addBtn && addBtn.click(); }
    });
    nameInput.dataset.bound = '1';
  }
}

// ============ DEBUG HELPER ============
window.__mockPending = function(cardId) {
  const card = state.cards.find(c => c.id === (cardId || state.detailCardId));
  if (!card) { console.warn('__mockPending: card not found', cardId || state.detailCardId); return; }
  card.pendingConfirmation = {
    id: 'mock_' + Date.now(),
    toolName: 'Edit',
    filePath: 'src/sample.ts',
    before: "function hello() {\n  console.log('hi');\n}",
    after: "function hello() {\n  console.log('hello, world');\n}",
    command: null,
    summary: 'Edit src/sample.ts',
    createdAt: Date.now(),
  };
  if (state.view === 'detail' && state.detailCardId === card.id) renderDetail();
  if (typeof renderColumns === 'function') renderColumns();
};

// 전역 노출
Object.assign(window, {
  openNewCard, openCard, closeModal, saveCard, deleteCurrent, runCurrent,
  exportCurrentMd, openExports, backupJson, resetAll, openExternal,
  openAuthModal, closeAuthModal, recheckCLI, selectAuthMode, clearApiKey,
  openClaudeInstall, openApiKeys,
  openCategoryEditor, closeCategoryModal, addCategory, deleteCategory,
  selectCategory, toggleFolderCollapse, promptCreateFolder,
  showBoard, showDetail, renderDetail, saveDetailField,
  showStats, setStatsPeriod,
  showToast,
  openLabelManager, closeLabelModal,
  createLabel, updateLabel, deleteLabel, getLabel,
});

// ============ INIT ============
(async () => {
  try { initThemeAndSidebar(); } catch (e) { console.error('initThemeAndSidebar failed', e); }
  try { initMoreMenu(); } catch (e) { console.error('initMoreMenu failed', e); }
  try { initDetailView(); } catch (e) { console.error('initDetailView failed', e); }
  try { initCardSearch(); } catch (e) { console.error('initCardSearch failed', e); }
  const savedModel = await window.api.getModel();
  if (savedModel) document.getElementById('modelSelect').value = savedModel;
  await loadFromDisk();
  // Restore last selected category from localStorage, fallback to first category
  const _savedCatId = localStorage.getItem('lastCategoryId');
  if (_savedCatId && state.categories.find(c => c.id === _savedCatId)) {
    currentCategoryId = _savedCatId;
  } else if (currentCategoryId === 'all' || !state.categories.find(c => c.id === currentCategoryId)) {
    const ordered = getAllCategoriesOrdered();
    if (ordered.length > 0) {
      currentCategoryId = ordered[0].id;
    }
  }
  await refreshAuthStatus();
  render();
  if (state.view === 'detail' && state.detailCardId) {
    showDetail(state.detailCardId);
  }

  const hasKey = await window.api.hasKey();
  if (!cliStatus.found && !hasKey) {
    setTimeout(() => openAuthModal(), 600);
  }
})();
