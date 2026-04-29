// features/github-sync/index.js — GitHub Projects v2 binding
import { state, persist } from '../../app/state.js';
import { getPAT, setPAT } from '../../shared/lib/github-pat.js';
import {
  getCurrentUser,
  listProjectsForOwner, getProjectMeta,
  listProjectItemsForAssignee, updateProjectItemStatus,
  updateIssueState, createIssue, addProjectV2Item, listUserRepos,
} from '../../shared/lib/github-api.js';
import {
  findCardByProjectItem,
  buildCardFromProjectItem,
} from '../../entities/card/index.js';
import {
  currentCategoryId,
  getCategoryProject, setCategoryProject, clearCategoryProject,
} from '../../entities/category/index.js';
import { showToast, toast } from '../../shared/ui/toast.js';
import { escapeHtml } from '../../shared/lib/utils.js';
import { statusNameToColumn, COLUMN_LABELS } from '../../shared/config/index.js';

// ===== 동기화 =====

export async function syncCategory(catId) {
  const pat = getPAT();
  if (!pat) return { skipped: true, reason: 'no-pat' };

  const project = getCategoryProject(catId);
  if (!project || !project.id) return { ok: true, fetched: 0, created: 0, updated: 0 };

  const me = await getCurrentUser(pat);

  let items;
  try {
    items = await listProjectItemsForAssignee(pat, project.id, me);
  } catch (err) {
    showToast({ kind: 'error', title: 'GitHub fetch 실패', body: err.message });
    return { ok: false, error: err.message };
  }

  let fetched = 0, created = 0, updated = 0;
  for (const item of items) {
    fetched++;
    const existing = findCardByProjectItem(project.id, item.itemId);
    if (!existing) {
      state.cards.push(buildCardFromProjectItem(item, catId, project.id));
      created++;
    } else {
      // remote wins
      existing.title = item.issue.title;
      existing.desc = item.issue.body || existing.desc;
      existing.github = existing.github || {};
      existing.github.statusName = item.statusName;
      existing.github.statusOptionId = item.statusOptionId;
      existing.github.state = item.issue.state;
      existing.github.htmlUrl = item.issue.url;
      existing.github.updatedAt = item.issue.updatedAt;
      const newCol = statusNameToColumn(item.statusName);
      existing.status = newCol;
      existing.progress = newCol === 'done' ? 100 : existing.progress;
      updated++;
    }
  }

  await persist();
  if (typeof window.renderColumns === 'function') window.renderColumns();
  return { ok: true, fetched, created, updated };
}

// 사용자 확인 후 실제 API 호출. 카드 status 변경시 모달이 무조건 떠야 한다.
let _pendingPush = null; // { card, prevStatus, desiredOption, project }

export function pushCardChange(card, { prevStatus } = {}) {
  if (!card || !card.github || !card.github.projectId || !card.github.projectItemId) return;
  if (!getPAT()) return;
  if (card.status === prevStatus) return;

  const cat = state.categories.find(c => c.id === card.category);
  const project = cat?.project;
  if (!project || !project.statusFieldId || !project.statusOptions) return;

  const targetCol = card.status;
  const desiredOption = project.statusOptions.find(opt => statusNameToColumn(opt.name) === targetCol);
  if (!desiredOption) {
    showToast({ kind: 'error', title: '매핑 없음', body: `컬럼 "${targetCol}"에 매칭되는 Project Status가 없습니다` });
    revertCardStatus(card, prevStatus);
    return;
  }

  _pendingPush = { card, prevStatus, desiredOption, project };
  const dlg = document.getElementById('ghPushConfirmModal');
  const msg = document.getElementById('ghPushConfirmMsg');
  if (msg) {
    const colLabel = COLUMN_LABELS[targetCol] || targetCol;
    msg.textContent = `이 카드는 GitHub Issue #${card.github.issueNumber} 와 연결되어 있습니다. Project Status를 "${desiredOption.name}" (${colLabel})로 변경할까요?`;
  }
  if (dlg) dlg.showModal();
}

function revertCardStatus(card, prevStatus) {
  card.status = prevStatus;
  persist();
  if (typeof window.renderColumns === 'function') window.renderColumns();
  if (typeof window.renderDetail === 'function' && state.view === 'detail') window.renderDetail();
}

export function rejectGhPush() {
  const dlg = document.getElementById('ghPushConfirmModal');
  if (dlg) dlg.close();
  if (!_pendingPush) return;
  const { card, prevStatus } = _pendingPush;
  _pendingPush = null;
  revertCardStatus(card, prevStatus);
  toast('변경 취소됨', 'info');
}

export async function approveGhPush() {
  const dlg = document.getElementById('ghPushConfirmModal');
  if (dlg) dlg.close();
  if (!_pendingPush) return;
  const { card, prevStatus, desiredOption, project } = _pendingPush;
  _pendingPush = null;

  try {
    await updateProjectItemStatus(getPAT(), project.id, card.github.projectItemId, project.statusFieldId, desiredOption.id);
    card.github.statusName = desiredOption.name;
    card.github.statusOptionId = desiredOption.id;

    const targetCol = card.status;
    if (targetCol === 'done' && card.github.owner && card.github.repo && card.github.issueNumber) {
      try { await updateIssueState(getPAT(), card.github.owner, card.github.repo, card.github.issueNumber, 'closed'); card.github.state = 'closed'; } catch (_) {}
    } else if (prevStatus === 'done' && card.github.state === 'closed' && card.github.owner && card.github.repo && card.github.issueNumber) {
      try { await updateIssueState(getPAT(), card.github.owner, card.github.repo, card.github.issueNumber, 'open'); card.github.state = 'open'; } catch (_) {}
    }
    await persist();
    toast('GitHub 이슈 갱신됨', 'success');
  } catch (err) {
    showToast({ kind: 'error', title: 'GitHub 동기화 실패', body: err.message });
    revertCardStatus(card, prevStatus);
  }
}

// ===== 보드 헤더 인라인 버튼 =====

export function updateGhButtons() {
  const refreshBtn = document.getElementById('ghRefreshBtn');
  const connectBtn = document.getElementById('ghConnectBtn');
  const iconEl = document.getElementById('ghConnectBtnIcon');
  const labelEl = document.getElementById('ghConnectBtnLabel');
  if (!refreshBtn || !connectBtn) return;

  const catId = currentCategoryId;
  if (!catId || catId === 'all') {
    refreshBtn.hidden = true;
    connectBtn.hidden = true;
    return;
  }

  const project = getCategoryProject(catId);
  const connected = !!(project && project.id);

  connectBtn.hidden = false;
  refreshBtn.hidden = !connected;

  if (iconEl && labelEl) {
    iconEl.textContent = connected ? '✓' : '+';
    labelEl.textContent = '깃허브';
    connectBtn.title = connected ? `연결됨 — ${project.title || ''}` : 'GitHub Project 연결';
    connectBtn.classList.toggle('is-connected', connected);
  }
}

// ===== 연결 모달 =====

let _availableProjects = [];
let _ownerForConnect = '';

export function confirmGhProjectConnect() {
  return connectGhProject(_ownerForConnect);
}

export function openGhConnectModal() {
  const dlg = document.getElementById('ghConnectModal');
  if (!dlg) return;
  const catId = currentCategoryId;
  if (!catId || catId === 'all') {
    toast('카테고리를 먼저 선택하세요', 'error');
    return;
  }
  const cat = state.categories.find(c => c.id === catId);
  const nameEl = document.getElementById('ghConnectCatName');
  if (nameEl) nameEl.textContent = cat ? `· ${cat.name}` : '';

  const patInput = document.getElementById('ghConnectPatInput');
  const patStatus = document.getElementById('ghConnectPatStatus');
  const patLink = document.getElementById('ghConnectPatLink');
  const ownerRow = document.getElementById('ghConnectOwnerRow');
  const projectRow = document.getElementById('ghConnectProjectRow');
  const cur = getPAT();

  if (patInput) {
    patInput.value = '';
    patInput.placeholder = cur ? '••••' + cur.slice(-4) + ' (변경하려면 입력)' : 'ghp_...';
  }
  if (patStatus) {
    patStatus.hidden = !cur;
    patStatus.textContent = cur ? '저장된 PAT 사용 중. 확인을 누르면 진행합니다.' : '';
  }
  if (patLink) {
    patLink.onclick = (e) => {
      e.preventDefault();
      if (window.openExternal) window.openExternal('https://github.com/settings/tokens');
    };
  }
  if (ownerRow) ownerRow.hidden = !cur;
  if (projectRow) projectRow.hidden = true;

  _availableProjects = [];
  renderConnectedProject();
  dlg.showModal();
}

export function closeGhConnectModal() {
  const dlg = document.getElementById('ghConnectModal');
  if (dlg) dlg.close();
}

function renderConnectedProject() {
  const list = document.getElementById('ghConnectRepoList');
  if (!list) return;
  const project = getCategoryProject(currentCategoryId);
  if (!project) {
    list.innerHTML = `<li class="opacity-50 text-xs" style="font-family:inherit;">아직 연결된 Project가 없습니다.</li>`;
    return;
  }
  list.innerHTML = `
    <li class="gh-repo-badge inline-flex items-center gap-1.5 px-2 py-1 rounded-full border" style="background:rgba(0,0,0,0.04);">
      <span>${escapeHtml(project.ownerLogin || '')} / #${project.number} ${escapeHtml(project.title || '')}</span>
      <button type="button" class="btn-icon" data-disconnect-project title="연결 해제" style="opacity:0.6; font-size:11px;">✕</button>
    </li>`;
  const btn = list.querySelector('[data-disconnect-project]');
  if (btn) btn.addEventListener('click', () => disconnectGhProject());
}

export async function confirmGhPat() {
  const patInput = document.getElementById('ghConnectPatInput');
  const patStatus = document.getElementById('ghConnectPatStatus');
  const ownerRow = document.getElementById('ghConnectOwnerRow');
  const newVal = (patInput?.value || '').trim();

  if (newVal) {
    setPAT(newVal);
    if (patInput) patInput.value = '';
  }
  if (!getPAT()) {
    toast('PAT를 입력하세요', 'error');
    if (patInput) patInput.focus();
    return;
  }

  if (patStatus) {
    patStatus.hidden = false;
    patStatus.textContent = '확인 중…';
  }
  try {
    const login = await getCurrentUser(getPAT());
    if (patStatus) patStatus.textContent = `✓ ${login} 로 인증됨`;
    if (patInput) patInput.placeholder = '••••' + getPAT().slice(-4) + ' (변경하려면 입력)';
    if (ownerRow) ownerRow.hidden = false;
  } catch (err) {
    if (patStatus) patStatus.textContent = '인증 실패: ' + err.message;
    toast('PAT 인증 실패: ' + err.message, 'error');
  }
}

export async function loadProjectsForOwner() {
  const ownerInput = document.getElementById('ghConnectOwnerInput');
  const projectSelect = document.getElementById('ghConnectProjectSelect');
  const projectRow = document.getElementById('ghConnectProjectRow');
  const owner = (ownerInput?.value || '').trim();
  if (!owner) {
    toast('owner(사용자/조직 login)를 입력하세요', 'error');
    return;
  }
  if (projectSelect) projectSelect.innerHTML = `<option value="">불러오는 중…</option>`;
  if (projectRow) projectRow.hidden = false;
  try {
    _availableProjects = await listProjectsForOwner(getPAT(), owner);
    if (!_availableProjects.length) {
      if (projectSelect) projectSelect.innerHTML = `<option value="">${escapeHtml(owner)} 의 Project가 없습니다</option>`;
      return;
    }
    if (projectSelect) {
      projectSelect.innerHTML = `<option value="">Project를 선택하세요</option>` +
        _availableProjects.map(p => `<option value="${p.id}">#${p.number} ${escapeHtml(p.title || '')}</option>`).join('');
      _ownerForConnect = owner;
    }
  } catch (err) {
    if (projectSelect) projectSelect.innerHTML = `<option value="">불러오기 실패: ${escapeHtml(err.message)}</option>`;
    toast('Project 목록 불러오기 실패: ' + err.message, 'error');
  }
}

async function connectGhProject(ownerLogin) {
  const catId = currentCategoryId;
  if (!catId || catId === 'all') {
    toast('카테고리가 선택되지 않았습니다', 'error');
    return;
  }
  const sel = document.getElementById('ghConnectProjectSelect');
  const projectId = sel?.value || '';
  if (!projectId) {
    toast('Project가 선택되지 않았습니다', 'error');
    return;
  }
  if (sel) sel.value = '';

  let meta;
  try {
    meta = await getProjectMeta(getPAT(), projectId);
  } catch (err) {
    toast('Project 메타 조회 실패: ' + err.message, 'error');
    console.error('getProjectMeta failed', err);
    return;
  }

  const ok = setCategoryProject(catId, {
    ownerLogin,
    id: meta.id,
    number: meta.number,
    title: meta.title,
    statusFieldId: meta.statusFieldId,
    statusOptions: meta.statusOptions,
  });
  if (!ok) {
    toast('카테고리를 찾을 수 없습니다 (id=' + catId + ')', 'error');
    return;
  }
  console.log('[gh] connected project', meta.title, 'to category', catId);
  toast(`Project "${meta.title}" 연결됨 — 동기화 중…`, 'success');
  renderConnectedProject();
  updateGhButtons();
  if (typeof window.renderColumns === 'function') window.renderColumns();
  try {
    const res = await syncCategory(catId);
    if (res && res.ok) {
      toast(`동기화 완료 (이슈 ${res.fetched}, 신규 ${res.created})`, 'success');
    }
  } catch (err) {
    toast('동기화 실패: ' + err.message, 'error');
  }
}

export function disconnectGhProject() {
  const catId = currentCategoryId;
  if (!catId) return;
  clearCategoryProject(catId);
  toast('Project 연결 해제됨', 'success');
  renderConnectedProject();
  updateGhButtons();
}

export async function syncCurrentCategory() {
  const catId = currentCategoryId;
  if (!catId || catId === 'all') return;
  if (!getPAT()) {
    toast('PAT가 설정되어 있지 않습니다', 'error');
    return;
  }
  const project = getCategoryProject(catId);
  if (!project) {
    toast('연결된 Project가 없습니다', 'error');
    return;
  }
  const btn = document.getElementById('ghRefreshBtn');
  if (btn) btn.classList.add('is-syncing');
  try {
    const res = await syncCategory(catId);
    if (res && res.ok) {
      showToast({
        kind: 'success',
        title: 'GitHub 동기화 완료',
        body: `${res.fetched}개 이슈 (신규 ${res.created}, 갱신 ${res.updated})`,
      });
    }
  } finally {
    if (btn) btn.classList.remove('is-syncing');
  }
}

export async function syncAll() {
  const pat = getPAT();
  if (!pat) return;

  let total = 0, created = 0, updated = 0;
  for (const cat of state.categories) {
    if (!cat.project?.id) continue;
    const res = await syncCategory(cat.id);
    if (res && res.ok) {
      total += res.fetched;
      created += res.created;
      updated += res.updated;
    }
  }
  if (total > 0) {
    showToast({
      kind: 'success',
      title: 'GitHub 동기화 완료',
      body: `${total}개 이슈 (신규 ${created}, 갱신 ${updated})`,
    });
  }
}

// ===== 카드 → GitHub 이슈 등록 =====

let _registerCardId = null;

export async function openGhRegisterModal() {
  const card = state.cards.find(c => c.id === state.detailCardId);
  if (!card) return;
  if (card.github && card.github.projectItemId) {
    toast('이미 GitHub과 연결된 카드입니다', 'info');
    return;
  }
  const cat = state.categories.find(c => c.id === card.category);
  const project = cat?.project;
  if (!project || !project.id) {
    toast('카테고리에 GitHub Project가 연결되어 있지 않습니다', 'error');
    return;
  }
  if (!getPAT()) {
    toast('PAT가 설정되어 있지 않습니다', 'error');
    return;
  }

  _registerCardId = card.id;
  const dlg = document.getElementById('ghRegisterModal');
  const sel = document.getElementById('ghRegisterRepoSelect');
  if (sel) sel.innerHTML = `<option value="">불러오는 중…</option>`;
  if (dlg) dlg.showModal();

  try {
    const repos = await listUserRepos(getPAT());
    // Project owner 우선 정렬
    const ownerLogin = project.ownerLogin || '';
    repos.sort((a, b) => {
      const ax = a.owner === ownerLogin ? 0 : 1;
      const bx = b.owner === ownerLogin ? 0 : 1;
      return ax - bx || a.fullName.localeCompare(b.fullName);
    });
    if (sel) {
      sel.innerHTML = `<option value="">저장소를 선택하세요</option>` +
        repos.map(r => `<option value="${escapeHtml(r.fullName)}">${r.private ? '🔒 ' : ''}${escapeHtml(r.fullName)}</option>`).join('');
    }
  } catch (err) {
    if (sel) sel.innerHTML = `<option value="">불러오기 실패: ${escapeHtml(err.message)}</option>`;
  }
}

export function closeGhRegisterModal() {
  const dlg = document.getElementById('ghRegisterModal');
  if (dlg) dlg.close();
  _registerCardId = null;
}

export async function confirmGhRegister() {
  const sel = document.getElementById('ghRegisterRepoSelect');
  const fullName = sel?.value || '';
  if (!fullName) { toast('저장소를 선택하세요', 'error'); return; }
  const card = state.cards.find(c => c.id === _registerCardId);
  if (!card) { closeGhRegisterModal(); return; }
  const cat = state.categories.find(c => c.id === card.category);
  const project = cat?.project;
  if (!project) { toast('Project 정보 누락', 'error'); return; }

  const [owner, repo] = fullName.split('/');
  const pat = getPAT();
  try {
    const me = await getCurrentUser(pat);
    const issue = await createIssue(pat, owner, repo, {
      title: card.title || '(제목 없음)',
      body: card.desc || '',
      assignee: me,
    });
    const itemId = await addProjectV2Item(pat, project.id, issue.node_id);
    if (!itemId) throw new Error('Project item 생성 실패');

    // 현재 카드 status에 매칭되는 option으로 status 설정
    const desiredOption = project.statusOptions.find(opt => statusNameToColumn(opt.name) === card.status);
    if (desiredOption) {
      try {
        await updateProjectItemStatus(pat, project.id, itemId, project.statusFieldId, desiredOption.id);
      } catch (_) {}
    }

    card.github = {
      projectId: project.id,
      projectItemId: itemId,
      statusName: desiredOption?.name || '',
      statusOptionId: desiredOption?.id || '',
      issueNumber: issue.number,
      owner, repo,
      state: 'open',
      htmlUrl: issue.html_url,
      updatedAt: issue.updated_at,
    };
    await persist();
    closeGhRegisterModal();
    toast(`Issue #${issue.number} 등록 완료`, 'success');
    if (typeof window.renderColumns === 'function') window.renderColumns();
    if (typeof window.renderDetail === 'function' && state.view === 'detail') window.renderDetail();
  } catch (err) {
    showToast({ kind: 'error', title: '등록 실패', body: err.message });
  }
}

// reference COLUMN_LABELS for tree-shaker
export const _COLUMN_LABELS_REF = COLUMN_LABELS;
