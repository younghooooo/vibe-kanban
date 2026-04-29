// entities/category/index.js
import { state, persist } from '../../app/state.js';
import { escapeHtml } from '../../shared/lib/utils.js';
import { toast } from '../../shared/ui/toast.js';
import { catUid } from '../card/index.js';

export let currentCategoryId = 'all';
export let currentSearchQuery = '';

export function setCurrentCategoryId(val) { currentCategoryId = val; }
export function setCurrentSearchQuery(val) { currentSearchQuery = val; }

export function selectCategory(id) {
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
    if (typeof window.showBoard === 'function') window.showBoard();
  } else {
    if (typeof window.render === 'function') window.render();
  }
}

export function filteredCards(cards, { categoryId, labelFilter, searchQuery } = {}) {
  const _categoryId = categoryId !== undefined ? categoryId : currentCategoryId;
  const _labelFilter = labelFilter !== undefined ? labelFilter : null;
  const _searchQuery = searchQuery !== undefined ? searchQuery : '';

  let result = (!_categoryId || _categoryId === 'all')
    ? cards
    : cards.filter(c => c.category === _categoryId);

  if (_labelFilter === '__none__') result = result.filter(c => !c.labelId);
  else if (_labelFilter !== null) result = result.filter(c => c.labelId === _labelFilter);

  if (_searchQuery) {
    const q = _searchQuery;
    result = result.filter(c =>
      c.title.toLowerCase().includes(q) ||
      (c.desc || '').toLowerCase().includes(q) ||
      (c.doc || '').toLowerCase().includes(q)
    );
  }

  return result;
}

export async function addCategory() {
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
    repos: [],
    createdAt: Date.now(),
  });
  await persist();
  input.value = '';
  if (typeof window.renderCategoryEditor === 'function') window.renderCategoryEditor();
  if (typeof window.render === 'function') window.render();
  toast('카테고리 추가됨', 'success');
}

export function deleteCategory(id) {
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
  if (typeof window.renderCategoryEditor === 'function') window.renderCategoryEditor();
  if (typeof window.renderCategories === 'function') window.renderCategories();
  if (typeof window.renderColumns === 'function') window.renderColumns();
  toast('삭제됨', 'success');
}

export function startRenameCategory(spanEl) {
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
    if (typeof window.renderCategoryEditor === 'function') window.renderCategoryEditor();
    if (typeof window.renderCategories === 'function') window.renderCategories();
    if (typeof window.render === 'function') window.render();
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

export function getCategoryRepos(catId) {
  const cat = state.categories.find(c => c.id === catId);
  return (cat && cat.repos) || [];
}

export function addRepoToCategory(catId, owner, repo) {
  const cat = state.categories.find(c => c.id === catId);
  if (!cat) return false;
  if (!cat.repos) cat.repos = [];
  const exists = cat.repos.some(r => r.owner === owner && r.repo === repo);
  if (exists) return false;
  cat.repos.push({ owner, repo });
  persist();
  return true;
}

export function removeRepoFromCategory(catId, owner, repo) {
  const cat = state.categories.find(c => c.id === catId);
  if (!cat || !cat.repos) return false;
  const idx = cat.repos.findIndex(r => r.owner === owner && r.repo === repo);
  if (idx < 0) return false;
  cat.repos.splice(idx, 1);
  persist();
  return true;
}

// === GitHub Projects v2 binding ===

export function getCategoryProject(catId) {
  const cat = state.categories.find(c => c.id === catId);
  return (cat && cat.project) || null;
}

export function setCategoryProject(catId, project) {
  const cat = state.categories.find(c => c.id === catId);
  if (!cat) return false;
  cat.project = project; // { ownerLogin, id, number, title, statusFieldId, statusOptions: [{id, name}] }
  persist();
  return true;
}

export function clearCategoryProject(catId) {
  const cat = state.categories.find(c => c.id === catId);
  if (!cat) return false;
  delete cat.project;
  persist();
  return true;
}
