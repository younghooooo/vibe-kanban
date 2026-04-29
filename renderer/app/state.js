// app/state.js
import { DEFAULT_CATEGORIES } from '../shared/config/index.js';
import { sampleCards } from '../entities/card/index.js';

export const state = {
  folders: [],
  categories: DEFAULT_CATEGORIES,
  cards: [],
  labels: [],
  totals: { tokens: 0, runs: 0, cost: 0 },
  deletedCardSnapshots: [],
  // Runtime routing state (not persisted)
  view: 'board',
  detailCardId: null,
  // Set is not JSON-serializable — runtime only, not persisted
  collapsedCategories: new Set(),
};

export async function persist() {
  await window.api.saveData(state);
}

export function migrateCategories() {
  if (!Array.isArray(state.categories)) return;
  let changed = false;
  state.categories.forEach(c => {
    if (typeof c.folderId === 'undefined') { c.folderId = null; changed = true; }
  });
  if (changed) persist();
}

export function migrateCategoriesToFolders() {
  if (!Array.isArray(state.folders)) state.folders = [];
  if (Array.isArray(state.categories)) {
    state.categories.forEach(c => {
      // Remove legacy parentId — category-in-category no longer supported
      if ('parentId' in c) delete c.parentId;
      if (typeof c.folderId === 'undefined') c.folderId = null;
    });
  }
}

export function migrateLabels() {
  if (!Array.isArray(state.labels)) state.labels = [];
  state.labels.forEach(l => {
    if (!Array.isArray(l.paths)) {
      l.paths = l.path ? [l.path] : [];
    } else if (l.paths.length === 0 && l.path) {
      // paths가 빈 배열로 잘못 초기화됐지만 path가 남아있는 경우 복구
      l.paths = [l.path];
    }
    delete l.path;
  });
  if (Array.isArray(state.cards)) {
    state.cards.forEach(c => {
      if (typeof c.labelId === 'undefined') c.labelId = null;
      if (!Array.isArray(c.refPaths)) c.refPaths = [];
    });
  }
}

export async function clearStaleRuntimeFields() {
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
  if (changed) persist();
  // startElapsedTicker is called in app/index.js after loadFromDisk
}

export async function verifyRunningCards() {
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
    persist();
    if (typeof window.renderColumns === 'function') window.renderColumns();
    if (state.view === 'detail' && typeof window.renderDetail === 'function') window.renderDetail();
  }
}

export async function loadFromDisk() {
  const data = await window.api.loadData();
  if (data && data.cards) {
    // Use Object.assign to mutate the existing state object so all module references remain valid
    Object.assign(state, {
      folders: data.folders || [],
      categories: data.categories || DEFAULT_CATEGORIES,
      cards: data.cards || [],
      labels: data.labels || [],
      totals: data.totals || { tokens: 0, runs: 0, cost: 0 },
      deletedCardSnapshots: data.deletedCardSnapshots || [],
    });
  } else {
    Object.assign(state, {
      folders: [],
      categories: DEFAULT_CATEGORIES,
      cards: sampleCards(),
      labels: [],
      totals: { tokens: 0, runs: 0, cost: 0 },
    });
    await persist();
  }
  // Runtime state reset after re-assignment
  state.view = (data && data.view) || 'board';
  state.detailCardId = (data && data.detailCardId) || null;
  state.collapsedCategories = new Set();
  migrateCategories();
  migrateCategoriesToFolders();
  migrateLabels();
  migrateCardDocs();
  await clearStaleRuntimeFields();
}

export function migrateCardDocs() {
  if (!Array.isArray(state.cards)) return;
  let changed = false;
  state.cards.forEach(c => {
    if (typeof c.doc !== 'string') { c.doc = ''; changed = true; }
    if (typeof c.docUpdatedAt !== 'number') { c.docUpdatedAt = 0; changed = true; }
    if (typeof c.docUpdatedBy !== 'string') { c.docUpdatedBy = 'user'; changed = true; }
    if (!Array.isArray(c.docHistory)) { c.docHistory = []; changed = true; }
  });
  if (changed) persist();
}
