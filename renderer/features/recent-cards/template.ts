// features/recent-cards/template.js
export function getRecentCardsHTML() {
  return `
<div id="recentCardsOverlay" class="global-search-overlay" hidden>
  <div class="global-search-box recent-cards-box" role="dialog" aria-label="최근 카드">
    <div class="global-search-header recent-cards-header">
      <svg class="global-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      <span class="recent-cards-title">최근 카드</span>
      <kbd class="global-search-esc">ESC</kbd>
    </div>
    <div id="recentCardsList" class="global-search-results recent-cards-list"></div>
    <div class="global-search-footer">
      <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
      <span><kbd>↵</kbd> 열기</span>
      <span><kbd>⌘E</kbd> 닫기</span>
    </div>
  </div>
</div>`;
}
