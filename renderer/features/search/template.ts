// features/search/template.js
export function getFindBarHTML() {
  return `
<div id="findBar" class="find-bar" hidden>
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="find-bar-icon" aria-hidden="true">
    <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
  <input type="text" id="findInput" class="find-input" placeholder="페이지에서 찾기..." autocomplete="off" spellcheck="false" />
  <span id="findCount" class="find-count"></span>
  <button id="findPrev" class="find-nav-btn" aria-label="이전">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
  </button>
  <button id="findNext" class="find-nav-btn" aria-label="다음">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
  </button>
  <button id="findClose" class="find-close-btn" aria-label="닫기">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
  </button>
</div>`;
}

export function getGlobalSearchHTML() {
  return `
<div id="globalSearchOverlay" class="global-search-overlay" hidden>
  <div class="global-search-box" role="dialog" aria-label="글로벌 검색">
    <div class="global-search-header">
      <svg class="global-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <input
        type="text"
        id="globalSearchInput"
        class="global-search-input"
        placeholder="카드 검색..."
        autocomplete="off"
        spellcheck="false"
      />
      <kbd class="global-search-esc">ESC</kbd>
    </div>
    <div id="globalSearchResults" class="global-search-results"></div>
    <div class="global-search-footer">
      <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
      <span><kbd>↵</kbd> 열기</span>
      <span><kbd>⌘K</kbd> 닫기</span>
    </div>
  </div>
</div>`;
}
