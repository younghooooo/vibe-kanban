// widgets/card-detail/index.js
import { state, persist } from '../../app/state.js';
import { escapeHtml, autoresizeTextarea, computeDiff, nowHMS, renderLogEntries } from '../../shared/lib/utils.js';
import { getLabelColor } from '../../shared/config/index.js';
import { showToast, toast, __toastContainer } from '../../shared/ui/toast.js';
import {
  getLabel, getLabelPaths, currentLabelFilter, setCurrentLabelFilter,
  createLabel, updateLabel, deleteLabel, addLabelPath, removeLabelPath,
} from '../../entities/label/index.js';
import { currentCategoryId } from '../../entities/category/index.js';
import { getCategoriesInTreeOrder } from '../../entities/folder/index.js';
import { uid } from '../../entities/card/index.js';
import { runCard, runCurrent, doCompact, pushLog, startElapsedTicker } from '../../features/ai-run/index.js';
import { exportCurrentMd } from '../../features/export/index.js';
import { _globalSearchOpen } from '../../features/search/index.js';

// ===== LABEL MANAGER UI (moved from labels.js) =====

export let __pendingNewLabelPaths = [];

function _shortPath(p) {
  return p.length > 30 ? '…' + p.slice(-30) : p;
}

export function renderLabelEditor() {
  const listEl = document.getElementById('labelList');
  if (!listEl) return;

  listEl.innerHTML = state.labels.map(l => {
    const c = getLabelColor(l.id);
    const paths = getLabelPaths(l);
    const pathChips = paths.map((p, i) => `
      <span class="label-path-chip" title="${escapeHtml(p)}">
        <span class="label-path-chip-text">${escapeHtml(_shortPath(p))}</span>
        <button class="label-path-chip-remove" type="button" data-label-id="${l.id}" data-idx="${i}">×</button>
      </span>`).join('');
    return `
    <li class="label-row label-row-multi" data-label-id="${l.id}">
      <div class="label-row-main">
        <span class="label-dot" style="background-color: ${c.fg}; flex-shrink:0;"></span>
        <span class="label-name" data-label-rename="${l.id}" tabindex="0" role="button">${escapeHtml(l.name)}</span>
        <div class="label-row-actions">
          <button class="btn btn-ghost btn-sm label-path-add-btn" type="button" data-label-id="${l.id}">+ 경로</button>
          <button class="btn btn-icon btn-sm label-delete" type="button" data-label-del="${l.id}" title="삭제">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>
      ${paths.length > 0 ? `<div class="label-paths-row">${pathChips}</div>` : ''}
    </li>`;
  }).join('');

  listEl.querySelectorAll('button[data-label-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-label-del');
      const l = getLabel(id);
      if (!l) return;
      if (!confirm(`"${l.name}" 라벨을 삭제할까요? 이 라벨이 붙은 카드는 라벨이 해제됩니다.`)) return;
      deleteLabel(id);
      renderLabelEditor();
      if (typeof window.renderDetail === 'function' && state.view === 'detail') window.renderDetail();
      if (typeof window.renderColumns === 'function') window.renderColumns();
    });
  });

  listEl.querySelectorAll('button.label-path-add-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-label-id');
      const l = getLabel(id);
      if (!l) return;
      const paths = getLabelPaths(l);
      const picked = await window.api.pickDirectory(paths[paths.length - 1] || undefined);
      if (picked) {
        addLabelPath(id, picked);
        renderLabelEditor();
      }
    });
  });

  listEl.querySelectorAll('button.label-path-chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-label-id');
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      removeLabelPath(id, idx);
      renderLabelEditor();
    });
  });

  listEl.querySelectorAll('[data-label-rename]').forEach(el => {
    el.addEventListener('click', () => startRenameLabel(el));
  });
}

export function bindLabelEditorActions(listEl) {
  // Already bound inside renderLabelEditor — kept for API compatibility
}

export function startRenameLabel(spanEl) {
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

export function initLabelAddUI() {
  const addBtn = document.getElementById('newLabelAdd');
  const pickBtn = document.getElementById('newLabelPick');
  const nameInput = document.getElementById('newLabelName');
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.addEventListener('click', () => {
      const name = (nameInput && nameInput.value || '').trim();
      if (!name) { nameInput && nameInput.focus(); return; }
      createLabel({ name, paths: [...__pendingNewLabelPaths] });
      if (nameInput) nameInput.value = '';
      __pendingNewLabelPaths = [];
      if (pickBtn) pickBtn.textContent = '경로 선택';
      renderLabelEditor();
      if (typeof window.renderDetail === 'function' && state.view === 'detail') window.renderDetail();
    });
    addBtn.dataset.bound = '1';
  }
  if (pickBtn && !pickBtn.dataset.bound) {
    pickBtn.addEventListener('click', async () => {
      const last = __pendingNewLabelPaths[__pendingNewLabelPaths.length - 1];
      const picked = await window.api.pickDirectory(last || undefined);
      if (picked && !__pendingNewLabelPaths.includes(picked)) {
        __pendingNewLabelPaths.push(picked);
        const n = __pendingNewLabelPaths.length;
        pickBtn.textContent = n === 1 ? _shortPath(__pendingNewLabelPaths[0]) : `경로 ${n}개`;
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

export function openLabelManager() {
  renderLabelEditor();
  initLabelAddUI();
  const m = document.getElementById('labelModal');
  if (m) m.showModal();
}

export function closeLabelModal() {
  const m = document.getElementById('labelModal');
  if (m) m.close();
}

// ===== DETAIL VIEW =====

export async function renderDetail() {
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
        persist();
      }
    } catch (e) {}
  }

  const titleEl = document.getElementById('d-title');
  const descEl = document.getElementById('d-desc');
  const catEl = document.getElementById('d-category');
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
  if (descEl && document.activeElement !== descEl) {
    descEl.value = card.desc || '';
    requestAnimationFrame(() => autoresizeTextarea(descEl));
  }
  const taskTypeGroup = document.getElementById('d-taskType-group');
  if (taskTypeGroup) {
    taskTypeGroup.querySelectorAll('.chip-btn').forEach(btn =>
      btn.classList.toggle('is-selected', btn.dataset.value === (card.taskType || 'feature'))
    );
  }
  const prioGroup = document.getElementById('d-priority-group');
  if (prioGroup) {
    prioGroup.querySelectorAll('.chip-btn').forEach(btn =>
      btn.classList.toggle('is-selected', btn.dataset.value === (card.priority || 'med'))
    );
  }
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
    elapsedEl.textContent = ' · ' + sec + '초';
  } else if (elapsedEl) {
    elapsedEl.textContent = '';
  }

  // 모델 chip 동적 생성
  const dModelGroup = document.getElementById('d-model-group');
  const sideModel = document.getElementById('modelSelect');
  if (dModelGroup && sideModel) {
    const models = Array.from(sideModel.options).map(o => ({ value: o.value, label: o.textContent }));
    const selectedModel = card.model || sideModel.value || 'claude-sonnet-4-6';
    dModelGroup.innerHTML = models.map(m =>
      `<button type="button" class="chip-btn${m.value === selectedModel ? ' is-selected' : ''}" data-value="${escapeHtml(m.value)}">${escapeHtml(m.label)}</button>`
    ).join('');
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

  // 추가 참조 경로 렌더링
  const refPathsList = document.getElementById('d-refPaths-list');
  if (refPathsList) {
    const paths = Array.isArray(card.refPaths) ? card.refPaths.filter(Boolean) : [];
    refPathsList.innerHTML = paths.map((p, i) => `
      <span class="ref-path-chip" title="${escapeHtml(p)}">
        <span class="ref-path-chip-text">${escapeHtml(p.length > 36 ? '…' + p.slice(-36) : p)}</span>
        <button class="ref-path-chip-remove" type="button" data-idx="${i}" aria-label="삭제">×</button>
      </span>`).join('');
    refPathsList.querySelectorAll('.ref-path-chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const c = state.cards.find(x => x.id === state.detailCardId);
        if (!c) return;
        c.refPaths = (c.refPaths || []).filter((_, i) => i !== idx);
        persist();
        renderDetail();
      });
    });
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

export function showBoard() {
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
        persist();
      } else {
        // Has content or log — promote draft to real card and save
        delete card._draft;
        persist();
      }
    }
  }
  state.view = 'board';
  state.detailCardId = null;
  persist();
  const bv = document.getElementById('boardView');
  const dv = document.getElementById('detailView');
  const sv = document.getElementById('statsView');
  if (bv) bv.hidden = false;
  if (dv) dv.hidden = true;
  if (sv) sv.hidden = true;
  if (typeof window.renderColumns === 'function') window.renderColumns();
  if (typeof window.renderCategories === 'function') window.renderCategories();
  if (typeof window.renderStats === 'function') window.renderStats();
}

export function showDetail(cardId) {
  state.view = 'detail';
  state.detailCardId = cardId;
  const bv = document.getElementById('boardView');
  const dv = document.getElementById('detailView');
  if (bv) bv.hidden = true;
  if (dv) {
    dv.hidden = false;
    applyDetailWidthPref(dv);
  }
  renderDetail();
}

const DETAIL_WIDE_KEY = 'vibe-kanban.detailWide';

function applyDetailWidthPref(dv) {
  const wide = localStorage.getItem(DETAIL_WIDE_KEY) === '1';
  dv.classList.toggle('is-wide', wide);
  const btn = document.getElementById('detailWidthToggle');
  if (btn) btn.title = wide ? '좁게 보기' : '넓게 보기';
}

export function saveDetailField(field, value) {
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
  if (typeof window.renderStats === 'function') window.renderStats();
}

export function initDetailView() {
  const back = document.getElementById('detailBack');
  const del = document.getElementById('detailDelete');
  const exp = document.getElementById('detailExport');
  const run = document.getElementById('detailRun');
  const title = document.getElementById('d-title');
  const desc = document.getElementById('d-desc');
  const cat = document.getElementById('d-category');
  const status = document.getElementById('d-status');

  if (back) back.addEventListener('click', showBoard);
  if (del) del.addEventListener('click', deleteCurrent);
  if (exp) exp.addEventListener('click', exportCurrentMd);
  if (run) run.addEventListener('click', runCurrent);

  const widthBtn = document.getElementById('detailWidthToggle');
  const dv = document.getElementById('detailView');
  if (dv) applyDetailWidthPref(dv);
  if (widthBtn && dv) widthBtn.addEventListener('click', () => {
    const nextWide = !dv.classList.contains('is-wide');
    localStorage.setItem(DETAIL_WIDE_KEY, nextWide ? '1' : '0');
    applyDetailWidthPref(dv);
  });

  // Autoresize for AI command textarea
  if (desc) {
    desc.addEventListener('input', () => autoresizeTextarea(desc));
    desc.addEventListener('focus', () => autoresizeTextarea(desc));
  }

  // Enter = 실행, Shift+Enter = 줄바꿈
  const descEl2 = document.getElementById('d-desc');
  if (descEl2 && !descEl2.dataset.runHotkeyBound) {
    descEl2.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.isComposing) return;  // skip IME composition
      if (e.shiftKey) {
        // Shift+Enter → insert newline
        e.preventDefault();
        const start = descEl2.selectionStart;
        const end = descEl2.selectionEnd;
        descEl2.value = descEl2.value.slice(0, start) + '\n' + descEl2.value.slice(end);
        descEl2.selectionStart = descEl2.selectionEnd = start + 1;
        autoresizeTextarea(descEl2);
        return;
      }
      // plain Enter → submit
      e.preventDefault();
      if (state.detailCardId) {
        saveDetailField('desc', descEl2.value);
        const card = state.cards.find(c => c.id === state.detailCardId);
        if (card && !card.running) {
          runCard(card);
        }
      }
    });
    descEl2.dataset.runHotkeyBound = '1';
  }

  // Auto-save on blur/change
  if (title) title.addEventListener('blur', () => saveDetailField('title', title.value));
  if (desc) desc.addEventListener('blur', () => saveDetailField('desc', desc.value));
  if (cat) cat.addEventListener('change', () => saveDetailField('category', cat.value));
  if (status) status.addEventListener('change', () => saveDetailField('status', status.value));

  const taskTypeGroup = document.getElementById('d-taskType-group');
  if (taskTypeGroup) {
    taskTypeGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-btn');
      if (!btn) return;
      taskTypeGroup.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      saveDetailField('taskType', btn.dataset.value);
    });
  }

  const prioGroup = document.getElementById('d-priority-group');
  if (prioGroup) {
    prioGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-btn');
      if (!btn) return;
      prioGroup.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      saveDetailField('priority', btn.dataset.value);
    });
  }

  // ESC to return to board (only when not focused on input/textarea/select)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _globalSearchOpen) return; // global search handles its own ESC
    if (state.view === 'detail' && e.key === 'Escape') {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
      showBoard();
    }
  });

  const cwdPick = document.getElementById('d-cwd-pick');
  const cwdClear = document.getElementById('d-cwd-clear');
  const dAuto = document.getElementById('d-autoRun');
  const dAutoLabel = document.getElementById('d-autoRun-label');
  const dSkillsToggle = document.getElementById('d-useSkills');
  const dSkillsLabelToggle = document.getElementById('d-useSkills-label');
  const terminalBtn = document.getElementById('detailTerminal');

  const dModelGroup = document.getElementById('d-model-group');
  if (dModelGroup) {
    dModelGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-btn');
      if (!btn) return;
      dModelGroup.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      saveDetailField('model', btn.dataset.value);
    });
  }

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

  const refPathAdd = document.getElementById('d-refPath-add');
  if (refPathAdd) refPathAdd.addEventListener('click', async () => {
    if (!state.detailCardId) return;
    const card = state.cards.find(c => c.id === state.detailCardId);
    if (!card) return;
    const existing = Array.isArray(card.refPaths) ? card.refPaths : [];
    const picked = await window.api.pickDirectory(existing[existing.length - 1] || card.cwd || undefined);
    if (picked && !existing.includes(picked)) {
      card.refPaths = [...existing, picked];
      persist();
      renderDetail();
    }
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

  if (compactBtn) compactBtn.addEventListener('click', () => doCompact());

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
    persist();
    renderDetail();
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
      // 라벨 선택 시 cwd + refPaths 자동 채움
      if (newLabelId) {
        const label = getLabel(newLabelId);
        const paths = getLabelPaths(label);
        if (paths.length > 0) card.cwd = paths[0];
        card.refPaths = paths.slice(1);
      } else {
        card.refPaths = [];
      }
      persist();
      renderDetail();
      if (typeof window.renderColumns === 'function') window.renderColumns();
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

      persist();
      if (state.view === 'detail' && state.detailCardId === cardId) renderDetail();
      if (typeof window.renderColumns === 'function') window.renderColumns();
    });
  }

  // ai:session — session_id from stream-json result event
  if (window.api && window.api.onAiSession) {
    window.api.onAiSession(({ cardId, sessionId }) => {
      const card = state.cards.find(c => c.id === cardId);
      if (!card) return;
      card.sessionId = sessionId;
      persist();
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
      persist();
      if (state.view === 'detail' && state.detailCardId === cardId) renderDetail();
      if (typeof window.renderColumns === 'function') window.renderColumns();
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
      persist();
      if (state.view === 'detail' && state.detailCardId === cardId) renderDetail();
      if (typeof window.renderColumns === 'function') window.renderColumns();

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
      persist();

      // Dismiss the pending toast for this card
      const container = __toastContainer();
      if (container) {
        const t = container.querySelector(`[data-toast-id="pending-${cardId}"]`);
        if (t) t.remove();
      }

      // If approved and rerun requested, immediately rerun with skip-permissions
      if (accepted && rerun) {
        if (state.view === 'detail' && state.detailCardId === cardId) renderDetail();
        if (typeof window.renderColumns === 'function') window.renderColumns();
        runCard(card, { skipPermissions: true });
        return;
      }
      if (state.view === 'detail' && state.detailCardId === cardId) renderDetail();
      if (typeof window.renderColumns === 'function') window.renderColumns();
    });
  }
}

export function openCard(id) {
  showDetail(id);
}

export function openNewCard(status = 'todo') {
  const id = uid();
  const card = {
    id,
    title: '',
    desc: '',
    category: (currentCategoryId !== 'all' ? currentCategoryId : null)
              || (state.categories[0] && state.categories[0].id) || '',
    priority: 'med',
    taskType: 'feature',
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

export function closeModal() {
  /* legacy no-op — card modal removed */
}

export function saveCard() { /* legacy no-op — detail view uses auto-save */ }

function _cardSnapshot(card) {
  let cost = 0;
  let runs = 0;
  if (Array.isArray(card.log)) {
    for (const e of card.log) {
      if (e?.type === 'usage' && typeof e.meta?.cost === 'number') cost += e.meta.cost;
      if (e?.type === 'start') runs++;
    }
  }
  return {
    id: card.id,
    createdAt: card.createdAt || 0,
    tokens: card.tokens || 0,
    cost,
    runs,
    categoryId: card.category || null,
    labelId: card.labelId || null,
  };
}

export async function deleteCurrent() {
  if (!state.detailCardId) return;
  if (!confirm('이 작업을 삭제할까요?')) return;
  const idx = state.cards.findIndex(c => c.id === state.detailCardId);
  if (idx >= 0) {
    if (!Array.isArray(state.deletedCardSnapshots)) state.deletedCardSnapshots = [];
    state.deletedCardSnapshots.push(_cardSnapshot(state.cards[idx]));
    state.cards.splice(idx, 1);
  }
  await persist();
  showBoard();
  toast('삭제됨');
}

export async function deleteCard(id) {
  if (!confirm('이 작업을 삭제할까요?')) return;
  const card = state.cards.find(c => c.id === id);
  if (card) {
    if (!Array.isArray(state.deletedCardSnapshots)) state.deletedCardSnapshots = [];
    state.deletedCardSnapshots.push(_cardSnapshot(card));
  }
  state.cards = state.cards.filter(c => c.id !== id);
  await persist();
  if (typeof window.render === 'function') window.render();
}
