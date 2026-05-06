// shared/lib/github-pat.js
// PAT storage in localStorage. Never persisted to disk via app state.

const KEY = 'vibe-kanban.github-pat';

export function getPAT() {
  return localStorage.getItem(KEY) || '';
}

export function setPAT(pat) {
  const v = (pat || '').trim();
  if (v) localStorage.setItem(KEY, v);
  else localStorage.removeItem(KEY);
}

export function hasPAT() {
  return !!getPAT();
}
