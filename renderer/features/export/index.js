// features/export/index.js
import { state, persist } from '../../app/state.js';
import { sampleCards } from '../../entities/card/index.js';
import { toast } from '../../shared/ui/toast.js';

export async function exportCurrentMd() {
  if (!state.detailCardId) return;
  const card = state.cards.find(c => c.id === state.detailCardId);
  if (!card) return;
  const r = await window.api.exportMarkdown(card);
  if (r.ok) toast('마크다운 저장됨', 'success');
  else toast('저장 실패: ' + r.error, 'error');
}

export async function openExports() { await window.api.openExportFolder(); }

export async function backupJson() {
  const r = await window.api.backupJson();
  if (r.ok) toast('백업 저장됨', 'success');
  else if (!r.canceled) toast('백업 실패: ' + r.error, 'error');
}

export async function resetAll() {
  if (!confirm('모든 카드와 기록을 지울까요? (카테고리와 인증은 유지)')) return;
  state.cards = sampleCards();
  state.totals = { tokens: 0, runs: 0, cost: 0 };
  await persist();
  if (typeof window.render === 'function') window.render();
  toast('초기화됨');
}

export async function openExternal(url) { await window.api.openExternal(url); }
