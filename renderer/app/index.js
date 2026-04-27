// app/index.js — 초기화 + window 노출

// ===== IMPORTS =====
import { DEFAULT_CATEGORIES, LABEL_COLORS, MODEL_PRICES, getLabelColor, hashLabelId } from '../shared/config/index.js';
import { state, persist, loadFromDisk, clearStaleRuntimeFields } from './state.js';
import { escapeHtml, truncate, nowHMS, formatTokens, formatCost, computeDiff, renderMarkdown, renderLogEntries, renderLogs, _safeGet, _safeSet, parseStreamLine, getWeekStart, resolveEffectiveAuth, autoresizeTextarea } from '../shared/lib/utils.js';
import { showToast, toast, __toastContainer } from '../shared/ui/toast.js';
import { applyTheme, toggleTheme, applySidebar, toggleSidebar, initThemeAndSidebar, initMoreMenu } from '../shared/lib/theme.js';
import {
  currentLabelFilter, setCurrentLabelFilter,
  getLabel, createLabel, updateLabel, deleteLabel,
} from '../entities/label/index.js';
import {
  getFolder, getCategoriesByFolder, getAllCategoriesOrdered, getCategoriesInTreeOrder,
  toggleFolderCollapse, createFolder, deleteFolder, renameFolder, promptCreateFolder,
} from '../entities/folder/index.js';
import {
  currentCategoryId, setCurrentCategoryId,
  currentSearchQuery, setCurrentSearchQuery,
  selectCategory, filteredCards,
  addCategory, deleteCategory,
} from '../entities/category/index.js';
import {
  renderCard, updateColumn, renderColumns, renderStats, renderModelHint,
  initBoardEvents, initCardSearch, renderLabelFilterBar,
} from '../widgets/board/index.js';
import { renderCategories, openCategoryEditor, closeCategoryModal, renderCategoryEditor } from '../widgets/sidebar/index.js';
import {
  currentStatsPeriod,
  getCardCost, getCardRunCount,
  computeTimeline, computeByCategory, computeByLabel,
  showStats, setStatsPeriod, setStatsMetric, renderStatsView,
} from '../widgets/stats/index.js';
import {
  _globalSearchOpen, _globalSearchSelectedIdx,
  openGlobalSearch, closeGlobalSearch,
  _renderGlobalSearchResults, initGlobalSearch,
} from '../features/search/index.js';
import {
  cliStatus, currentAuthMode,
  refreshAuthStatus, openAuthModal, closeAuthModal,
  recheckCLI, selectAuthMode, clearApiKey,
  openClaudeInstall, openApiKeys, renderAuthModal,
} from '../features/auth/index.js';
import {
  pushLog, ensureCardTitle,
  buildSystemPrompt, buildUserPrompt, buildPrompt,
  startElapsedTicker, doCompact,
  runCard, runCurrent, quickRun,
} from '../features/ai-run/index.js';
import { exportCurrentMd, openExports, backupJson, resetAll, openExternal } from '../features/export/index.js';
import {
  renderDetail, showBoard, showDetail,
  saveDetailField, initDetailView,
  openCard, openNewCard, closeModal, saveCard,
  deleteCurrent, deleteCard,
  openLabelManager, closeLabelModal,
  renderLabelEditor, bindLabelEditorActions,
  startRenameLabel, initLabelAddUI,
} from '../widgets/card-detail/index.js';

// ===== render() 헬퍼 =====
function render() {
  renderCategories();
  renderColumns();
  renderStats();
  renderLabelFilterBar();
  renderModelHint();
}

// ===== 전역 노출 (HTML onclick + 내부 모듈 간 window.* 호출 대상) =====
Object.assign(window, {
  // 카드 CRUD
  openNewCard, openCard, closeModal, saveCard, deleteCurrent, deleteCard,
  // 실행
  runCurrent, quickRun, runCard,
  // export
  exportCurrentMd, openExports, backupJson, resetAll, openExternal,
  // 인증
  openAuthModal, closeAuthModal, recheckCLI, selectAuthMode, clearApiKey,
  openClaudeInstall, openApiKeys,
  // 카테고리
  openCategoryEditor, closeCategoryModal, addCategory, deleteCategory,
  selectCategory, toggleFolderCollapse, promptCreateFolder,
  renderCategoryEditor,
  // 뷰 이동
  showBoard, showDetail, renderDetail, saveDetailField,
  // 통계
  showStats, setStatsPeriod, setStatsMetric,
  // toast
  showToast, toast,
  // 라벨
  openLabelManager, closeLabelModal,
  createLabel, updateLabel, deleteLabel, getLabel,
  // 렌더
  render, renderColumns, renderCategories, renderStats, renderDetail, renderModelHint,
  // AI ticker
  startElapsedTicker,
  // 검색
  openGlobalSearch, closeGlobalSearch,
});

// ===== 전역 이벤트 바인딩 =====
(function bindStaticInputs() {
  const apiKeyInput = document.getElementById('apiKeyInput');
  if (apiKeyInput) {
    apiKeyInput.addEventListener('change', async (e) => {
      const v = e.target.value.trim();
      if (v.startsWith('sk-ant-')) {
        const r = await window.api.saveKey(v);
        if (r.ok) {
          toast(r.encrypted ? 'API 키 저장 (암호화)' : 'API 키 저장', 'success');
          await refreshAuthStatus();
        } else {
          toast('저장 실패: ' + r.error, 'error');
        }
      } else if (v === '' || v.startsWith('••')) {
        // ignore masked value
      } else {
        toast('sk-ant- 로 시작하는 키가 필요해요', 'error');
      }
    });
  }

  const modelSelect = document.getElementById('modelSelect');
  if (modelSelect) {
    modelSelect.addEventListener('change', async (e) => {
      await window.api.setModel(e.target.value);
      renderModelHint();
    });
  }

  // 새 카테고리 이름 입력 시 Enter 처리
  const newCatEl = document.getElementById('newCatName');
  if (newCatEl && !newCatEl.dataset.bound) {
    newCatEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        addCategory();
      }
    });
    newCatEl.dataset.bound = '1';
  }
})();

// ===== DEBUG HELPER =====
window.__mockPending = function(cardId) {
  const card = state.cards.find(c => c.id === (cardId || state.detailCardId));
  if (!card) { console.warn('__mockPending: card not found', cardId || state.detailCardId); return; }
  card.pendingConfirmation = {
    id: 'mock_' + Date.now(),
    toolName: 'Edit',
    filePath: 'src/sample.ts',
    before: "function hello() {\n  console.log('hi');\n}",
    after: "function hello() {\n  console.log('hello, world');\n}",
    command: null,
    summary: 'Edit src/sample.ts',
    createdAt: Date.now(),
  };
  if (state.view === 'detail' && state.detailCardId === card.id) renderDetail();
  if (typeof renderColumns === 'function') renderColumns();
};

// ===== INIT =====
(async () => {
  try { initThemeAndSidebar(); } catch (e) { console.error('initThemeAndSidebar failed', e); }
  try { initMoreMenu(); } catch (e) { console.error('initMoreMenu failed', e); }
  try { initDetailView(); } catch (e) { console.error('initDetailView failed', e); }
  try { initCardSearch(); } catch (e) { console.error('initCardSearch failed', e); }
  try { initGlobalSearch(); } catch (e) { console.error('initGlobalSearch failed', e); }
  try { initBoardEvents(); } catch (e) { console.error('initBoardEvents failed', e); }

  const savedModel = await window.api.getModel();
  const modelSelect = document.getElementById('modelSelect');
  const validModels = Array.from(modelSelect.options).map(o => o.value);
  const resolvedModel = validModels.includes(savedModel) ? savedModel : 'claude-sonnet-4-6';
  modelSelect.value = resolvedModel;
  if (resolvedModel !== savedModel) window.api.setModel(resolvedModel);

  await loadFromDisk();

  // Start elapsed ticker for cards that are still running after verification
  if (state.cards.some(c => c.running)) startElapsedTicker();

  // Restore last selected category from localStorage, fallback to first category
  const _savedCatId = localStorage.getItem('lastCategoryId');
  if (_savedCatId && state.categories.find(c => c.id === _savedCatId)) {
    setCurrentCategoryId(_savedCatId);
  } else if (currentCategoryId === 'all' || !state.categories.find(c => c.id === currentCategoryId)) {
    const ordered = getAllCategoriesOrdered();
    if (ordered.length > 0) {
      setCurrentCategoryId(ordered[0].id);
    }
  }

  await refreshAuthStatus();
  render();

  if (state.view === 'detail' && state.detailCardId) {
    showDetail(state.detailCardId);
  }

  const hasKey = await window.api.hasKey();
  if (!cliStatus.found && !hasKey) {
    setTimeout(() => openAuthModal(), 600);
  }
})();
