// features/ai-run/index.js
import { state, persist } from '../../app/state.js';
import { nowHMS, autoresizeTextarea, resolveEffectiveAuth } from '../../shared/lib/utils.js';
import { toast, showToast } from '../../shared/ui/toast.js';
import { cliStatus, currentAuthMode, openAuthModal } from '../auth/index.js';
import { MODEL_PRICES, AUTO_COMPACT_TURN_THRESHOLD, AUTO_COMPACT_IDLE_MS } from '../../shared/config/index.js';
import { getLabelPaths } from '../../entities/label/index.js';

export function pushLog(card, label, body) {
  card.log = card.log || [];
  card.log.push({
    time: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
    label, body
  });
}

export function ensureCardTitle(card) {
  if (card.title && card.title.trim()) return;
  let newTitle = '';
  if (card.desc && card.desc.trim()) {
    const firstLine = card.desc.trim().split(/\r?\n/)[0].trim();
    newTitle = firstLine.length > 40 ? firstLine.slice(0, 40).trim() + '…' : firstLine;
  }
  if (!newTitle) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    newTitle = `새 작업 · ${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  card.title = newTitle;
  // Auto-generated title counts as real content — clear draft flag
  if (card._draft) delete card._draft;
  persist();
  if (typeof window.renderDetail === 'function' && state.detailCardId === card.id) window.renderDetail();
}

export function buildSystemPrompt(card) {
  const cat = state.categories.find(c => c.id === card.category);
  const cardPaths = Array.isArray(card.refPaths) ? card.refPaths.filter(Boolean) : [];
  const label = card.labelId ? state.labels.find(l => l.id === card.labelId) : null;
  const allRefPaths = [...new Set([...getLabelPaths(label), ...cardPaths])];
  const refSection = allRefPaths.length > 0
    ? `\n[추가 참조 경로]\n${allRefPaths.map(p => `- ${p}`).join('\n')}\n`
    : '';
  return `당신은 개인 작업 보조 AI입니다. 아래 작업을 수행해주세요.

[카테고리] ${cat ? cat.name : '-'}
[작업 제목] ${card.title}
${refSection}
한국어로 깔끔하게 답변하세요. 불필요한 서론 없이 바로 본론으로.`;
}

export function buildUserPrompt(card, promptOverride) {
  return promptOverride || card.desc || '(요청 내용 없음. 제목만 보고 적절한 결과를 만들어주세요.)';
}

export function buildPrompt(card, promptOverride) {
  const cat = state.categories.find(c => c.id === card.category);
  const descText = promptOverride || card.desc || '(요청 내용 없음. 제목만 보고 적절한 결과를 만들어주세요.)';
  return `당신은 개인 작업 보조 AI입니다. 아래 작업을 수행해주세요.

[카테고리] ${cat ? cat.name : '-'}
[작업 제목] ${card.title}
[요청 내용]
${descText}

한국어로 깔끔하게 답변하세요. 불필요한 서론 없이 바로 본론으로.`;
}

let __elapsedTimer = null;

export function startElapsedTicker() {
  if (__elapsedTimer) return;
  __elapsedTimer = setInterval(() => {
    const anyRunning = state.cards && state.cards.some(c => c.running);
    if (!anyRunning) {
      clearInterval(__elapsedTimer);
      __elapsedTimer = null;
      return;
    }
    // Update elapsed time in detail view
    if (state.view === 'detail') {
      const el = document.getElementById('detailRunningElapsed');
      const card = state.cards.find(c => c.id === state.detailCardId);
      if (el && card && card.running && card.runStartedAt) {
        const sec = Math.max(0, Math.round((Date.now() - card.runStartedAt) / 1000));
        el.textContent = ' · ' + sec + '초';
      }
    }
    // Refresh card previews in board view
    if (typeof window.renderColumns === 'function') window.renderColumns();
  }, 1000);
}

export async function doCompact(targetCard) {
  const compactBtn = document.getElementById('detailCompact');
  const compactProgress = document.getElementById('compactProgress');
  const compactText = document.getElementById('compactProgressText');

  const card = targetCard || (state.detailCardId && state.cards.find(c => c.id === state.detailCardId));
  if (!card) return;

  const isManual = !targetCard; // button-click path shows UI chrome

  if (!card.sessionId) {
    if (isManual) {
      if (compactText) compactText.textContent = '압축할 세션이 없어요.';
      if (compactProgress) { compactProgress.hidden = false; compactProgress.classList.remove('is-indeterminate'); setTimeout(() => { if (compactProgress) compactProgress.hidden = true; }, 3000); }
    }
    return;
  }

  state.compactingCardId = card.id;
  if (isManual) {
    if (compactProgress) {
      compactProgress.hidden = false;
      compactProgress.classList.add('is-indeterminate');
    }
    if (compactBtn) compactBtn.disabled = true;
    if (compactText) compactText.textContent = '대화 요약 중…';
  }

  try {
    const res = await window.api.compactSession(card.id, card.sessionId, card.cwd || '', !!card.useSkills);
    if (!res || !res.ok) {
      if (isManual && compactText) compactText.textContent = '압축 실패: ' + (res && res.error ? res.error : '알 수 없음');
      return;
    }
    const summary = res.summary || '';
    card.summary = summary;
    card.sessionId = null;  // fresh 세션으로 재시작 유도
    card.log = card.log || [];
    const preview = summary.length > 80 ? summary.slice(0, 80) + '…' : summary;
    card.log.push({
      type: 'info',
      time: nowHMS(),
      text: `대화 압축됨 — ${preview}`,
    });
    // Mark boundary so userTurns counter resets after compact
    card.compactedAtIndex = card.log.length;
    persist();
    if (state.view === 'detail' && state.detailCardId === card.id && typeof window.renderDetail === 'function') window.renderDetail();
    if (isManual && compactText) compactText.textContent = '압축 완료';
  } catch (e) {
    if (isManual && compactText) compactText.textContent = '요청 실패';
  } finally {
    state.compactingCardId = null;
    if (isManual) {
      if (compactBtn) compactBtn.disabled = false;
      if (compactProgress) compactProgress.classList.remove('is-indeterminate');
      setTimeout(() => { if (compactProgress) compactProgress.hidden = true; }, 4000);
    }
  }
}

export async function quickRun(cardId) {
  const card = state.cards.find(c => c.id === cardId);
  if (!card) return;
  await runCard(card);
}

export async function runCurrent() {
  if (!state.detailCardId) { toast('카드를 열어주세요', 'error'); return; }
  const card = state.cards.find(c => c.id === state.detailCardId);
  if (!card) return;
  await runCard(card);
}

export async function runCard(card, opts = {}) {
  const hasKey = await window.api.hasKey();
  const effective = resolveEffectiveAuth(currentAuthMode, cliStatus.found, hasKey);
  if (!effective) {
    toast('인증이 설정되지 않았어요', 'error');
    openAuthModal();
    return;
  }
  if (card.running) return;

  // Auto-compact: trigger before running if turn count or idle time exceeds threshold.
  // Skip when: no sessionId (fresh session), already compacting, or retry path.
  if (card.sessionId && !opts._retriedWithoutSession) {
    const startIdx = card.compactedAtIndex || 0;
    const userTurns = (card.log || []).slice(startIdx).filter(e => e.type === 'user').length;
    const idleMs = card.lastRunAt ? (Date.now() - card.lastRunAt) : 0;
    const needsCompact = userTurns >= AUTO_COMPACT_TURN_THRESHOLD || idleMs >= AUTO_COMPACT_IDLE_MS;
    if (needsCompact) {
      pushLog(card, 'AUTO-COMPACT', `자동 compact 수행 중… (turns=${userTurns}, idle=${Math.round(idleMs/60000)}min)`);
      if (state.view === 'detail' && state.detailCardId === card.id && typeof window.renderDetail === 'function') window.renderDetail();
      try {
        await doCompact(card);
      } catch (e) {
        // compact failure is non-fatal — continue with normal runCard flow
        pushLog(card, 'AUTO-COMPACT', `compact 실패, 계속 진행: ${e}`);
      }
    }
  }

  // Capture prompt before clearing
  const promptText = (card.desc || '').trim();
  if (!promptText && !opts.skipPermissions) { if (typeof alert === 'function') alert('명령을 입력해주세요.'); return; }

  // Push USER log entry so the prompt appears in the log
  card.log = card.log || [];
  card.log.push({ type: 'user', time: nowHMS(), text: promptText });

  // Clear textarea immediately so the user can type the next prompt
  card.desc = '';
  const descEl = document.getElementById('d-desc');
  if (descEl) {
    descEl.value = '';
    autoresizeTextarea(descEl);
  }

  // Inline title generation using captured promptText (card.desc is now empty)
  if (!card.title || !card.title.trim()) {
    const firstLine = promptText.split(/\r?\n/)[0].trim();
    card.title = firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine;
    if (!card.title) card.title = '새 작업 · ' + nowHMS();
    if (card._draft) delete card._draft;
  }

  // Running counts as real usage — clear draft flag to preserve the card
  if (card._draft) delete card._draft;

  const sidebarModel = document.getElementById('modelSelect').value;
  const model = card.model || sidebarModel;
  const cardId = card.id;

  // Helper: update state then refresh UI without coupling to DOM directly
  function syncUI() {
    if (typeof window.renderColumns === 'function') window.renderColumns();
    if (state.view === 'detail' && state.detailCardId === cardId) {
      if (typeof window.renderDetail === 'function') window.renderDetail();
    }
  }

  card.pendingConfirmation = null;
  card.running = true;
  card.runStartedAt = Date.now();
  card.status = 'doing';
  card.progress = 10;
  pushLog(card, 'START', `model=${model} · via=${effective} · 실행 시작`);
  await persist();
  syncUI();
  startElapsedTicker();

  // Gradually advance progress bar via state only — no direct DOM manipulation
  const progressTimer = setInterval(() => {
    // Re-lookup card by id in case state was reloaded
    const c = state.cards.find(x => x.id === cardId);
    if (!c || !c.running) {
      clearInterval(progressTimer);
      return;
    }
    if (c.progress < 95) {
      c.progress = Math.min(95, c.progress + Math.random() * 8);
      if (typeof window.renderColumns === 'function') window.renderColumns();
      // Only update detail view if still viewing this card
      if (state.view === 'detail' && state.detailCardId === cardId) {
        if (typeof window.renderDetail === 'function') window.renderDetail();
      }
    }
  }, 600);

  // 세션 없고 summary 있으면 요약을 context 로 prepend
  let effectivePrompt = promptText;
  if (!card.sessionId && card.summary && card.summary.trim()) {
    effectivePrompt = `[이전 대화 요약]\n${card.summary}\n\n---\n\n${promptText}`;
  }
  const systemPrompt = buildSystemPrompt(card);
  const userPrompt = buildUserPrompt(card, effectivePrompt);
  let result;
  try {
    const cardPaths = Array.isArray(card.refPaths) ? card.refPaths.filter(Boolean) : [];
    const label = card.labelId ? state.labels.find(l => l.id === card.labelId) : null;
    const labelPaths = getLabelPaths(label);
    const refPaths = [...new Set([...labelPaths, ...cardPaths])];
    result = await window.api.run({ model, prompt: userPrompt, systemPrompt, maxTokens: 2048, cwd: card.cwd || undefined, refPaths, autoRun: !!card.autoRun, useSkills: !!card.useSkills, cardId, skipPermissions: !!opts.skipPermissions, sessionId: card.sessionId || null });
  } catch (err) {
    result = { ok: false, error: String(err) };
  } finally {
    clearInterval(progressTimer);
  }

  // Re-lookup card after await in case something changed during execution
  const c = state.cards.find(x => x.id === cardId);
  if (!c) return; // card was deleted while running

  // Session expired — clear sessionId and retry once with a fresh session
  if (result && result.sessionExpired && !opts._retriedWithoutSession && c.sessionId) {
    c.sessionId = null;
    persist();
    return runCard(c, { ...opts, _retriedWithoutSession: true });
  }

  if (!result.ok) {
    c.running = false;
    c.runStartedAt = null;
    c.progress = 0;
    pushLog(c, 'ERROR', result.error);
    await persist();
    syncUI();
    toast('실패: ' + result.error, 'error');
    return;
  }

  // Persist new session_id returned from CLI
  if (result.sessionId) {
    c.sessionId = result.sessionId;
  }

  const usage = result.usage || { input_tokens: 0, output_tokens: 0 };
  const totalTok = (usage.input_tokens || 0) + (usage.output_tokens || 0);
  const price = MODEL_PRICES[model] || MODEL_PRICES['claude-sonnet-4-5'];
  const cost = (usage.input_tokens * price.in + usage.output_tokens * price.out) / 1_000_000;

  c.tokens = (c.tokens || 0) + totalTok;
  c.progress = 100;
  c.running = false;
  c.runStartedAt = null;
  c.lastRunAt = Date.now(); // used by auto-compact idle check
  c.status = 'review';
  // stream-json 모드에서는 result.text 가 비어있음 — ai:log 이벤트에서 이미 RESULT 수신됨
  if (result.text && result.text.trim()) pushLog(c, 'RESULT', result.text);
  const viaLabel = result.via === 'claude-cli' ? 'Claude CLI' : 'API';
  const fallbackNote = result.fallbackFrom ? ` (fallback from ${result.fallbackFrom})` : '';
  pushLog(c, 'USAGE', `via=${viaLabel}${fallbackNote} · in=${usage.input_tokens} · out=${usage.output_tokens} · $${cost.toFixed(5)}`);

  state.totals.tokens += totalTok;
  state.totals.runs += 1;
  state.totals.cost += cost;

  await persist();
  syncUI();
  toast(`완료 (+${totalTok} tokens)`, 'success');
}
