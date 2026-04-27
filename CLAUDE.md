# Vibe Kanban — 프로젝트 구조 가이드

## 기술 스택

- **Electron** (Node.js 메인 프로세스 + Chromium 렌더러)
- **Vanilla JS** (ES6 Modules, 빌드 도구 없음)
- **Tailwind CSS** (CDN, `renderer/index.html`에서 로드)
- **CSS Variables** 기반 디자인 토큰 (`renderer/styles.css`)

## 폴더 구조 — Feature Slice Design (FSD)

렌더러 코드는 **Feature Slice Design** 아키텍처를 따른다. 레이어 간 import는 단방향이며 아래 규칙을 엄수한다.

```
renderer/
├── app.js                        # 진입점 (import './app/index.js' 한 줄)
├── index.html
├── styles.css
│
├── app/                          # 레이어 1 — 앱 초기화
│   ├── state.js                  # 전역 state 객체, persist(), loadFromDisk()
│   └── index.js                  # 초기화 IIFE, window.* 전역 노출
│
├── shared/                       # 레이어 2 — 공유 유틸리티 (외부 import 없음)
│   ├── config/
│   │   └── index.js              # 상수: LABEL_COLORS, MODEL_PRICES, DEFAULT_CATEGORIES
│   ├── lib/
│   │   ├── utils.js              # 순수 유틸 함수 (escapeHtml, formatTokens 등)
│   │   └── theme.js              # 테마/사이드바 토글
│   └── ui/
│       └── toast.js              # 토스트 알림 시스템
│
├── entities/                     # 레이어 3 — 도메인 모델 (shared + app/state만 import)
│   ├── card/
│   │   └── index.js              # uid(), catUid(), sampleCards()
│   ├── category/
│   │   └── index.js              # currentCategoryId, selectCategory(), filteredCards()
│   ├── folder/
│   │   └── index.js              # 폴더 CRUD (getFolder, createFolder 등)
│   └── label/
│       └── index.js              # currentLabelFilter, 라벨 CRUD
│
├── features/                     # 레이어 4 — 사용자 인터랙션 (entities + shared import 가능)
│   ├── ai-run/
│   │   └── index.js              # runCard(), buildPrompt(), doCompact(), startElapsedTicker()
│   ├── auth/
│   │   └── index.js              # 인증 상태 관리 (CLI/API Key)
│   ├── search/
│   │   └── index.js              # 전역 검색 UI + 로직
│   └── export/
│       └── index.js              # 내보내기, JSON 백업
│
└── widgets/                      # 레이어 5 — 복합 UI 블록 (모든 하위 레이어 import 가능)
    ├── board/
    │   └── index.js              # 칸반 보드 컬럼, 카드 렌더링, DnD, 라벨 필터 바
    ├── sidebar/
    │   └── index.js              # 카테고리 목록, 폴더 DnD, 카테고리 에디터 모달
    ├── card-detail/
    │   └── index.js              # 카드 상세 뷰, 라벨 에디터, openCard/deleteCard
    └── stats/
        └── index.js              # 토큰 통계 뷰
```

## 레이어 Import 규칙

```
shared      ←  외부 레이어 import 금지
entities    ←  shared, app/state 만
features    ←  entities, shared, app/state
widgets     ←  features, entities, shared, app/state
app         ←  모든 레이어 가능
```

상위 레이어에서 하위 레이어로 역방향 호출이 필요한 경우 `window.functionName()` 패턴을 사용한다. 전역 노출 목록은 `app/index.js`의 `Object.assign(window, {...})` 에서 관리한다.

## 주요 설계 결정

- **state 참조 유지**: `loadFromDisk()`에서 `state = {...}` 재할당 대신 `Object.assign(state, {...})` 사용 — 모든 모듈이 동일한 객체 참조를 유지
- **filteredCards 순수 함수**: `filteredCards(cards, { categoryId, labelFilter, searchQuery })` 형태로 인자 주입 — 모듈 변수 직접 참조 없음
- **draggedCatId**: DnD UI 상태이므로 `widgets/sidebar`에 위치 (entities/folder 아님)
- **window.* 역참조**: 순환 의존성 방지용. 예: `ai-run`이 `renderDetail()`을 호출할 때 `window.renderDetail()` 사용
