// widgets/board/template.js
const COLUMNS = [
  { status: 'todo',     label: '할 일',   textClass: 'opacity-60',        dotClass: 'opacity-40 bg-current' },
  { status: 'doing',    label: '진행 중', textClass: 'text-cyan-400',     dotClass: 'bg-cyan-400 animate-pulse' },
  { status: 'review',   label: '검토',    textClass: 'text-indigo-400',   dotClass: 'bg-indigo-400' },
  { status: 'document', label: '문서',    textClass: 'text-amber-400',    dotClass: 'bg-amber-400' },
  { status: 'done',     label: '완료',    textClass: 'text-emerald-400',  dotClass: 'bg-emerald-400' },
];

const TRASH_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>`;

function columnHTML({ status, label, textClass, dotClass }) {
  return `
    <div class="column-wrap" data-status="${status}">
      <div class="flex items-center justify-between mb-3 px-1">
        <div class="flex items-center gap-2">
          <span class="h-1.5 w-1.5 rounded-full ${dotClass}"></span>
          <h2 class="text-xs font-semibold uppercase tracking-wider ${textClass}">${label}</h2>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-mono opacity-40" id="cnt-${status}">0</span>
          <button class="col-clear-btn" data-status="${status}" title="이 열 전체 삭제" aria-label="이 열 전체 삭제">${TRASH_ICON}</button>
        </div>
      </div>
      <div class="column-body" id="col-${status}"></div>
    </div>`;
}

export function getBoardViewHTML() {
  return `
<div id="boardView" class="board-view">
  <div class="flex items-center justify-between mb-6 gap-4">
    <div>
      <h1 class="text-3xl lg:text-4xl font-semibold leading-tight" id="boardTitle"></h1>
      <div class="text-sm opacity-60 mt-1" id="boardMeta"></div>
    </div>
    <div class="flex items-center gap-2">
      <div id="boardRunningSummary" class="board-running-summary" hidden>
        <span class="spinner is-small"></span>
        실행 중 <span id="boardRunningCount">0</span>개
      </div>
      <button id="ghRefreshBtn" type="button" onclick="syncCurrentCategory()" class="btn btn-sm btn-ghost" title="이 프로젝트 GitHub 새로고침" hidden>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
      </button>
      <button id="ghConnectBtn" type="button" onclick="openGhConnectModal()" class="btn btn-sm btn-ghost gap-1.5" title="GitHub 연결" hidden>
        <span id="ghConnectBtnIcon">+</span>
        <span id="ghConnectBtnLabel">깃허브</span>
      </button>
      <button onclick="openNewCard()" class="btn btn-sm btn-primary border-0 font-semibold gap-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        새 작업
      </button>
    </div>
  </div>

  <div class="filter-toolbar" id="filterToolbar">
    <div class="card-search-wrap" id="cardSearchWrap">
      <input
        type="text"
        id="cardSearchInput"
        class="input card-search-input"
        placeholder="카드 검색 (제목/설명)"
        autocomplete="off"
      />
      <button type="button" id="cardSearchClear" class="card-search-clear" hidden aria-label="검색어 지우기">&#xD7;</button>
    </div>
    <div class="label-filter-bar" id="labelFilterBar" hidden></div>
  </div>

  <div class="columns-grid" id="columns">
    ${COLUMNS.map(columnHTML).join('')}
  </div>
</div>`;
}
