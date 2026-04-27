// features/auth/index.js
import { escapeHtml, resolveEffectiveAuth } from '../../shared/lib/utils.js';
import { toast } from '../../shared/ui/toast.js';

export let cliStatus = { found: false };
export let currentAuthMode = 'auto';

export async function refreshAuthStatus() {
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

export async function openAuthModal() {
  await refreshAuthStatus();
  document.getElementById('authModal').showModal();
}

export function closeAuthModal() {
  document.getElementById('authModal').close();
}

export async function recheckCLI() {
  toast('감지 중...');
  await refreshAuthStatus();
  if (cliStatus.found) toast('CLI 감지 성공', 'success');
  else toast('CLI 못 찾음. 터미널에서 claude --version 확인', 'error');
}

export async function selectAuthMode(mode) {
  const hasKey = await window.api.hasKey();
  if (mode === 'cli' && !cliStatus.found) { toast('CLI가 설치되어 있지 않아요', 'error'); return; }
  if (mode === 'api' && !hasKey) { toast('API 키를 먼저 입력하세요', 'error'); return; }
  if (mode === 'auto' && !cliStatus.found && !hasKey) { toast('CLI도 없고 키도 없어요', 'error'); return; }
  await window.api.setAuthMode(mode);
  currentAuthMode = mode;
  toast('인증 모드 변경됨', 'success');
  await refreshAuthStatus();
}

export async function clearApiKey() {
  if (!confirm('저장된 API 키를 삭제할까요?')) return;
  await window.api.clearKey();
  await refreshAuthStatus();
  toast('API 키 삭제됨');
}

export async function openClaudeInstall() { await window.api.openClaudeInstall(); }
export async function openApiKeys() { await window.api.openApiKeys(); }

export function renderAuthModal(hasKey) {
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
