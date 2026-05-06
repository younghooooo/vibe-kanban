// widgets/sidebar/template.js
export function getSidebarHTML() {
  return `
<aside class="sidebar">
  <div class="sidebar-inner">
    <section class="mb-8">
      <div class="cat-header flex items-center justify-between mb-3">
        <span class="section-title">카테고리</span>
        <div class="cat-header-actions">
          <button type="button" class="btn-link" onclick="promptCreateFolder()">+ 폴더</button>
          <button type="button" class="btn-link" onclick="openCategoryEditor()">+ 편집</button>
        </div>
      </div>
      <ul class="space-y-1" id="catList"></ul>
    </section>

    <div class="sidebar-nav-extras">
      <button type="button" class="sidebar-stats-btn" onclick="showStats()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
        토큰 통계
      </button>
      <button type="button" class="sidebar-stats-btn" id="shortcutsPanelToggle" onclick="toggleShortcutsPanel()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"></path></svg>
        단축키 설정
      </button>
    </div>

    <section class="shortcuts-section" id="shortcutsSection" hidden>
      <span class="section-title">단축키</span>
      <div id="shortcutsList"></div>
    </section>
  </div>

  <div class="sidebar-model">
    <span class="section-title">모델</span>
    <select id="modelSelect" class="select select-sm w-full font-mono text-xs">
      <option value="claude-opus-4-7">Claude Opus 4.7</option>
      <option value="claude-sonnet-4-6" selected>Claude Sonnet 4.6</option>
      <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
    </select>
  </div>

  <div class="sidebar-footer">
    <button type="button" id="authChip" class="auth-chip" onclick="openAuthModal()">
      <span class="auth-dot" id="authDot"></span>
      <span class="auth-label" id="authLabel">확인 중…</span>
    </button>
  </div>
</aside>`;
}

export function getCategoryModalHTML() {
  return `
<dialog class="modal category-modal" id="categoryModal">
  <div class="modal-box category-modal-box">
    <button type="button" class="btn btn-icon category-close-float" onclick="closeCategoryModal()" aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
    <div class="category-modal-body">
      <div class="category-root-dropzone" id="catRootDropzone" aria-label="루트로 이동">
        폴더 밖으로 이동 (최상위)
      </div>
      <ul id="catEditList" class="category-list"></ul>
      <div class="category-add-row">
        <input type="text" id="newCatName" class="input-inline" placeholder="새 카테고리 추가" autocomplete="off" maxlength="12" />
      </div>
      <details class="github-settings" id="githubSettings" style="margin-top:12px;">
        <summary style="cursor:pointer; user-select:none; padding:6px 0; font-size:12px; opacity:0.75;">GitHub 설정</summary>
        <div style="padding:8px 0; display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:11px; opacity:0.6;">Personal Access Token (scope: repo)</label>
          <input type="password" id="ghPatInput" class="input-inline" placeholder="ghp_..." autocomplete="off" />
          <a href="https://github.com/settings/tokens" target="_blank" style="font-size:11px; opacity:0.6;">토큰 생성하기 →</a>
        </div>
      </details>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>`;
}
