// widgets/card-detail/template.js
export function getDetailViewHTML() {
  return `
<div id="detailView" class="detail-view" hidden>
  <div class="detail-topbar">
    <button type="button" id="detailBack" class="btn btn-ghost detail-back-btn" aria-label="Back to board">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
      <span>보드</span>
    </button>
    <span id="detailRunningIndicator" class="detail-running-indicator" hidden style="display:none;">
      <span id="detailRunningElapsed" hidden></span>
    </span>
    <div class="detail-topbar-actions">
      <button type="button" id="detailWidthToggle" class="btn btn-ghost detail-width-toggle" aria-label="너비 전환" title="넓게 보기">
        <svg class="icon-expand" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
        <svg class="icon-compress" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
      </button>
      <button type="button" id="detailGhRegister" class="btn btn-ghost" hidden onclick="openGhRegisterModal()">+ GitHub 이슈로 등록</button>
      <button type="button" id="detailExport" class="btn btn-ghost" hidden>.md 저장</button>
      <button type="button" id="detailDelete" class="btn btn-ghost btn-danger">삭제</button>
    </div>
  </div>

  <div class="detail-body">
    <div class="detail-main-pane">
      <input type="text" id="d-title" class="detail-title input-title" placeholder="제목 없음" autocomplete="off" />

      <button type="button" id="detailMetaToggle" class="detail-meta-toggle" aria-expanded="true" aria-controls="detailMeta">
        <svg class="meta-twistie" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="8 6 16 12 8 18"></polygon></svg>
        <span>카테고리 · 모델 · 경로 · 옵션</span>
      </button>
      <div class="detail-meta" id="detailMeta">
        <div class="meta-row">
          <span class="meta-label">카테고리</span>
          <select id="d-category" class="select-inline"></select>
        </div>
        <div class="meta-row meta-row-wrap">
          <span class="meta-label">작업 종류</span>
          <div class="chip-group" id="d-taskType-group">
            <button type="button" class="chip-btn" data-value="">미분류</button>
            <button type="button" class="chip-btn" data-value="feature">기능</button>
            <button type="button" class="chip-btn" data-value="uiux">UI/UX</button>
            <button type="button" class="chip-btn" data-value="refactor">리팩토링</button>
            <button type="button" class="chip-btn" data-value="bug">버그</button>
          </div>
        </div>
        <div class="meta-row">
          <span class="meta-label">우선순위</span>
          <div class="chip-group" id="d-priority-group">
            <button type="button" class="chip-btn chip-prio-low" data-value="low">낮음</button>
            <button type="button" class="chip-btn chip-prio-med" data-value="med">보통</button>
            <button type="button" class="chip-btn chip-prio-high" data-value="high">높음</button>
          </div>
        </div>
        <div class="meta-row">
          <span class="meta-label">상태</span>
          <select id="d-status" class="select-inline">
            <option value="todo">할 일</option>
            <option value="doing">진행 중</option>
            <option value="review">검토</option>
            <option value="document">문서</option>
            <option value="done">완료</option>
          </select>
        </div>
        <div class="meta-row">
          <span class="meta-label">라벨</span>
          <div class="meta-value">
            <span id="d-label-dot" class="label-dot" hidden></span>
            <select id="d-label" class="select-inline">
              <option value="">없음</option>
            </select>
            <button type="button" id="d-label-manage" class="btn-link" title="라벨 관리">관리</button>
          </div>
        </div>
        <div class="meta-row meta-row-wrap">
          <span class="meta-label">모델</span>
          <div class="chip-group" id="d-model-group"></div>
        </div>
        <div class="meta-row">
          <span class="meta-label">작업 경로</span>
          <div class="meta-value meta-cwd">
            <span id="d-cwd-display" class="meta-cwd-text">기본 경로 사용</span>
            <button type="button" id="d-cwd-pick" class="btn btn-ghost btn-sm">변경</button>
            <button type="button" id="d-cwd-clear" class="btn btn-ghost btn-sm">초기화</button>
          </div>
        </div>
        <div class="meta-row" style="align-items:flex-start; padding-top:4px;">
          <span class="meta-label" style="padding-top:4px;">참조 경로</span>
          <div class="meta-value" style="display:flex; flex-direction:column; gap:4px; min-width:0;">
            <div id="d-refPaths-list" class="ref-paths-list"></div>
            <button type="button" id="d-refPath-add" class="btn btn-ghost btn-sm ref-path-add-btn">+ 경로 추가</button>
          </div>
        </div>
        <div class="meta-row">
          <span class="meta-label">자동 진행</span>
          <div class="meta-value">
            <label class="toggle-switch">
              <input type="checkbox" id="d-autoRun" />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-text" id="d-autoRun-label">확인 받으며 진행</span>
            </label>
          </div>
        </div>
        <div class="meta-row" style="align-items:flex-start; padding-top:6px;">
          <span class="meta-label" style="padding-top:2px;">스킬 사용</span>
          <div class="meta-value" style="display:flex; flex-direction:column; gap:3px;">
            <label class="toggle-switch">
              <input type="checkbox" id="d-useSkills" />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-text" id="d-useSkills-label">기본 모드</span>
            </label>
            <span class="meta-hint">체크 시 /plan, /brainstorming 같은 Agmo 스킬 사용 가능 (~5-10k 토큰 추가)</span>
          </div>
        </div>
      </div>

      <div class="detail-section doc-section" id="d-docSection">
        <div class="doc-toolbar-floating">
          <button type="button" id="d-docMode" class="doc-mini-btn" data-mode="edit" title="MD 원본 / 에디터 전환">
            <span class="doc-mini-icon">&lt;&gt;</span>
            <span class="doc-mini-label">md</span>
          </button>
        </div>
        <div id="d-doc" class="doc-editor"></div>
        <div id="d-docRaw" class="doc-raw" contenteditable="plaintext-only" spellcheck="false" data-placeholder="# Markdown 원본" hidden></div>
      </div>

      <div class="detail-section pending-section" id="pendingSection" hidden>
        <div class="section-header-row">
          <span class="section-label pending-label">
            <span class="pending-pulse"></span>
            컨펌 필요
          </span>
          <span class="section-meta" id="pendingSummary"></span>
        </div>
        <div class="pending-body">
          <div class="pending-meta" id="pendingMeta"></div>
          <div class="diff-view" id="pendingDiff"></div>
          <div class="pending-actions">
            <button type="button" id="pendingReject" class="btn btn-ghost btn-danger">거부</button>
            <button type="button" id="pendingApprove" class="btn btn-primary">승인</button>
          </div>
        </div>
      </div>
    </div>

    <div class="detail-splitter" id="detailSplitter" role="separator" aria-orientation="vertical" tabindex="0" aria-label="대화창 너비 조절"></div>

    <aside class="detail-side-pane">
      <div class="detail-section" id="d-logSection">
        <div class="section-header-row log-toolbar">
          <label class="detail-debug-toggle" title="INFO·USAGE·START·AUTO-COMPACT 표시 토글">
            <input type="checkbox" id="detailDebugToggle" />
            <span class="debug-track"><span class="debug-thumb"></span></span>
            <span class="debug-label">Debug</span>
          </label>
        </div>
        <div id="d-logBox" class="log-box">아직 실행되지 않았습니다.</div>
      </div>

      <div class="detail-section detail-input-section">
        <div class="prompt-row">
          <textarea id="d-desc" class="prompt-textarea" rows="3" placeholder="메시지를 입력하세요..." autocomplete="off"></textarea>
          <button type="button" id="detailRun" class="btn btn-primary prompt-send-btn" title="전송 (Enter)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
            <span>전송</span>
          </button>
        </div>
        <div class="detail-run-bar">
          <button type="button" id="detailTerminal" class="btn btn-ghost" title="터미널 열기">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
          </button>
          <button type="button" id="detailEditor" class="btn btn-ghost" title="에디터에서 열기 (Cursor / VSCode)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="16 18 22 12 16 6"></polyline>
              <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
          </button>
          <button type="button" id="detailCompact" class="btn btn-ghost" title="/compact — 세션 대화 요약">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
          </button>
          <button type="button" id="detailResetSession" class="btn btn-ghost" title="이 카드의 대화 세션을 초기화합니다">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          </button>
          <span class="detail-session-hint" id="detailSessionHint" hidden></span>
          <span class="detail-run-meta" id="d-tokens"></span>
        </div>
        <div id="compactProgress" class="compact-progress" hidden>
          <div class="compact-progress-bar"><div class="compact-progress-fill"></div></div>
          <span class="compact-progress-text" id="compactProgressText">대화 압축 중…</span>
        </div>
      </div>
    </aside>
  </div>
</div>`;
}
