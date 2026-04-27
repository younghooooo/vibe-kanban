// widgets/sidebar/index.js
import { state, persist } from '../../app/state.js';
import { escapeHtml } from '../../shared/lib/utils.js';
import { toast } from '../../shared/ui/toast.js';
import { currentCategoryId, addCategory, deleteCategory, startRenameCategory } from '../../entities/category/index.js';
import {
  getFolder, getCategoriesByFolder, getAllCategoriesOrdered, getCategoriesInTreeOrder,
  deleteFolder, renameFolder, createFolder, toggleFolderCollapse, promptCreateFolder,
} from '../../entities/folder/index.js';

// draggedCatId lives here (moved from entities/folder)
export let draggedCatId = null;
export function setDraggedCatId(val) { draggedCatId = val; }

export function renderCategories() {
  const list = document.getElementById('catList');
  if (!list) return;
  let html = '';

  // O(n) pre-compute: card count per category
  const countMap = {};
  state.cards.forEach(c => { countMap[c.category] = (countMap[c.category] || 0) + 1; });

  // Folder loop
  for (const f of state.folders) {
    const cats = getCategoriesByFolder(f.id);
    const folderCardCount = cats.reduce((sum, c) => sum + (countMap[c.id] || 0), 0);
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
        const count = countMap[c.id] || 0;
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
    const count = countMap[c.id] || 0;
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

export function bindCategoryListDnD(listEl) {
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
          persist();
          renderCategories();
        }
      });
      return;
    }

    // Regular category: drag source + card drop target
    item.addEventListener('dragstart', e => {
      setDraggedCatId(id);
      item.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    });
    item.addEventListener('dragend', () => {
      setDraggedCatId(null);
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
          persist();
          renderCategories();
          if (typeof window.renderColumns === 'function') window.renderColumns();
          if (typeof window.showToast === 'function') {
            const catName = (state.categories.find(c => c.id === id) || {}).name || '';
            window.showToast({
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
        persist();
        renderCategories();
      }
    });
  });
}

export function bindFolderActions(listEl) {
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

export function startRenameFolder(folderId, spanEl) {
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

export function openCategoryEditor() {
  renderCategoryEditor();
  document.getElementById('categoryModal').showModal();
}

export function closeCategoryModal() {
  document.getElementById('categoryModal').close();
}

export function renderCategoryEditor() {
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
      setDraggedCatId(id);
      row.classList.add('is-dragging');
      document.body.classList.add('cat-modal--dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    });
    row.addEventListener('dragend', () => {
      setDraggedCatId(null);
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
      persist();
      renderCategoryEditor();
      renderCategories();
    });
  }
}
