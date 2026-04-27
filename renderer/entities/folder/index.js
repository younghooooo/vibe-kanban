// entities/folder/index.js
import { state, persist } from '../../app/state.js';
import { escapeHtml } from '../../shared/lib/utils.js';

export function getFolder(id) {
  return state.folders.find(f => f.id === id) || null;
}

export function getCategoriesByFolder(folderId) {
  return state.categories.filter(c => (c.folderId || null) === (folderId || null));
}

export function getAllCategoriesOrdered() {
  const result = [];
  for (const f of state.folders) {
    getCategoriesByFolder(f.id).forEach(c => result.push(c));
  }
  getCategoriesByFolder(null).forEach(c => result.push(c));
  return result;
}

export function getCategoriesInTreeOrder() {
  const result = [];
  for (const f of state.folders) {
    getCategoriesByFolder(f.id).forEach(c => result.push({ cat: c, depth: 0 }));
  }
  getCategoriesByFolder(null).forEach(c => result.push({ cat: c, depth: 0 }));
  return result;
}

export function toggleFolderCollapse(folderId) {
  const f = getFolder(folderId);
  if (!f) return;
  f.collapsed = !f.collapsed;
  persist();
  if (typeof window.renderCategories === 'function') window.renderCategories();
}

export function createFolder(name) {
  const folder = {
    id: 'f_' + Math.random().toString(36).slice(2, 10),
    name: name.trim() || '새 폴더',
    collapsed: false,
    createdAt: Date.now(),
  };
  state.folders.push(folder);
  persist();
  return folder;
}

export function deleteFolder(folderId) {
  // Move categories inside folder to top-level
  state.categories.forEach(c => {
    if (c.folderId === folderId) c.folderId = null;
  });
  state.folders = state.folders.filter(f => f.id !== folderId);
  persist();
}

export function renameFolder(folderId, newName) {
  const f = getFolder(folderId);
  if (!f) return;
  f.name = newName.trim() || f.name;
  persist();
}

export function promptCreateFolder() {
  const name = prompt('새 폴더 이름');
  if (!name || !name.trim()) return;
  createFolder(name);
  if (typeof window.renderCategories === 'function') window.renderCategories();
}
