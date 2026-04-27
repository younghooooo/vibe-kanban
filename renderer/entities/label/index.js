// entities/label/index.js
import { state, persist } from '../../app/state.js';
import { getLabelColor } from '../../shared/config/index.js';
import { toast } from '../../shared/ui/toast.js';

// Re-export getLabelColor from config for convenience
export { getLabelColor } from '../../shared/config/index.js';

export let currentLabelFilter = null;

export function setCurrentLabelFilter(val) {
  currentLabelFilter = val;
}

export function getLabel(id) {
  return state.labels.find(l => l.id === id) || null;
}

export function getLabelPaths(label) {
  if (!label) return [];
  const paths = Array.isArray(label.paths) ? label.paths.filter(Boolean) : [];
  // 마이그레이션 전 데이터 방어: paths가 비어있는데 path가 남아있으면 포함
  if (paths.length === 0 && label.path) return [label.path];
  return paths;
}

export function createLabel({ name, paths }) {
  const label = {
    id: 'l_' + Math.random().toString(36).slice(2, 10),
    name: (name || '').trim() || '새 라벨',
    paths: Array.isArray(paths) ? paths.filter(Boolean) : [],
    createdAt: Date.now(),
  };
  state.labels.push(label);
  persist();
  return label;
}

export function updateLabel(id, patch) {
  const l = getLabel(id);
  if (!l) return;
  if ('name' in patch) l.name = (patch.name || '').trim() || l.name;
  if ('paths' in patch) l.paths = Array.isArray(patch.paths) ? patch.paths.filter(Boolean) : [];
  persist();
}

export function addLabelPath(id, path) {
  const l = getLabel(id);
  if (!l || !path) return;
  if (!Array.isArray(l.paths)) l.paths = [];
  if (!l.paths.includes(path)) l.paths.push(path);
  persist();
}

export function removeLabelPath(id, index) {
  const l = getLabel(id);
  if (!l || !Array.isArray(l.paths)) return;
  l.paths.splice(index, 1);
  persist();
}

export function deleteLabel(id) {
  state.labels = state.labels.filter(l => l.id !== id);
  state.cards.forEach(c => { if (c.labelId === id) c.labelId = null; });
  persist();
}
