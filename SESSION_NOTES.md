# vibe-kanban 세션 작업 노트 (2026-04-22)

## 세션 개요

- **목적**: vibe-kanban의 "컨펌 필요" UI 버그 조사 + 토큰 소비 최적화
- **결과**: 4개 개선 사항 커밋/푸시 완료, Bash 승인 UI 미구현 이슈 남음
- **리모트**: https://github.com/younghooooo/vibe-kanban

---

## Part 1: 조사한 이슈와 원인

### 이슈 A: "컨펌 필요" UI가 모든 카드에서 반복 노출

**증상**: AI 결과 후 "컨펌 필요" 승인 카드가 매번 뜸.

**원인 체인**:
1. Agmo 플러그인 28개 스킬 → Claude CLI가 `Skill` 툴 호출
2. `main.js` 의 `--permission-mode acceptEdits` 에서 `Skill` 툴 미허용 → permission prompt 발생
3. `app.js:1799` `onPending` 이 IPC 받아 `card.pendingConfirmation` 저장 → `persist()`로 디스크 기록
4. `renderDetail` 이 UI에 표시
5. 매 실행마다 반복

**해결 (적용됨)**:
- `~/.claude/settings.json`에 `permissions.allow: ["Skill"]` 추가
- `~/Library/Application Support/vibe-kanban/kanban-data.json` 잔존 `pendingConfirmation` 4개 null 초기화 (`c_3bsbnan`, `c_7dofs7i`, `c_o58ygns`, `c_jmdydew`)

### 이슈 B: 토큰 소비가 빠름

**TOP 3 원인 분석**:

1. **`--resume` 영구 재개 + idle 시 cache miss** (영향: 대)
   - Claude Code는 prompt caching TTL 5분
   - 터미널 `claude`는 연속 사용 → cache warm → 저렴
   - vibe-kanban은 카드 방치 후 재실행 → 매번 cache miss → 풀 히스토리 재청구

2. **Agmo 플러그인 로딩** (영향: 중-소)
   - 28개 SKILL.md 메타데이터 + `using-plugin` auto-load 스킬 본문
   - 세션당 실제 ~5-10k 토큰 (초기 architect 보고의 "36k" 는 과장, 정정함)

3. **턴마다 system 프리앰블 prepend** (영향: 소)
   - `buildPrompt` 가 매 턴 프리앰블을 user 메시지에 붙여서 전송 → prompt cache 불가능

---

## Part 2: 적용한 개선 (커밋 완료)

### 커밋 목록

| 해시 | 제목 |
|------|------|
| `264ec26` | chore: 프로젝트 초기 설정 파일 추가 |
| `3d7c14b` | feat: main.js — 스킬 토글·설정 소스 제한·시스템 프롬프트 캐싱 적용 |
| `cc60080` | feat: 카드 상세 UI에 스킬 사용 토글 및 스타일 추가 |
| `84062bb` | feat: renderer/app.js — 시스템 프롬프트 분리·스킬 토글·자동 compact 추가 |

### 개선 1: `--append-system-prompt` 도입 (프롬프트 캐싱)

- **파일/라인**: `main.js:287,295,310`, `renderer/app.js:2437,2447,2374,2413`
- **동작**: `buildPrompt` → `buildSystemPrompt(카테고리/제목/프리앰블, 정적) + buildUserPrompt(사용자 입력, 동적)` 분리. `--append-system-prompt` 플래그로 system 영역 전달
- **효과**: 프리앰블 ~60 토큰이 cache read 대상으로 전환. 10턴당 ~540 토큰 절감(Sonnet 기준)

### 개선 2: 자동 `/compact` 트리거

- **파일/라인**: `renderer/app.js:52-58` (상수), `1581-1645` (doCompact 리팩토링), `2317-2335` (runCard 자동 트리거), `2456` (lastRunAt)
- **조건**: 턴 수 ≥ 20 **OR** idle ≥ 30분 → `runCard` 실행 직전 `doCompact(card)` 선행
- **상수**: `AUTO_COMPACT_TURN_THRESHOLD = 20`, `AUTO_COMPACT_IDLE_MS = 30 * 60 * 1000`
- **30분 근거**: cache TTL 5분의 6배 → 확실한 cache miss 구간이므로 compact 후 fresh 세션 시작이 이득
- **엣지 케이스**: `sessionId === null` / `running===true` / `_retriedWithoutSession` 은 skip. compact 실패 시 그대로 runCard 진행 (fallback)

### 개선 3: Agmo 플러그인 비활성화 (`--setting-sources project,local`)

- **파일/라인**: `main.js:293`, `main.js:643` (둘 다 조건부)
- **동작**: `useSkills=false` 시 `--setting-sources project,local` 추가 → user level `~/.claude/settings.json` 무시 → 플러그인 로드 안 됨
- **영향 범위**: vibe-kanban spawn 전용. 터미널 `claude`는 영향 없음. 다만 user level permission allowlist, MCP 서버, hook 도 함께 무효화됨

### 개선 4: 카드별 `useSkills` 토글

- **파일/라인**:
  - `main.js:287` destructure, `295` 조건부 플래그, `487` ai:run 핸들러 payload, `640` claude:compact 핸들러
  - `preload.js:26` compactSession 4번째 파라미터
  - `renderer/app.js:1394` 상태 반영, `1533` 토글 이벤트, `1608` compactSession 호출, `1922` openNewCard 기본값, `2413` IPC 페이로드
  - `renderer/index.html` 토글 DOM (자동 진행 아래)
  - `renderer/styles.css` `.meta-hint` 클래스
- **UI**: 카드 상세 → 메타 섹션 → "자동 진행" 토글 바로 아래 "스킬 사용" 토글
- **기본값**: `false` (토큰 효율 우선)
- **ON 시**: `--setting-sources` 플래그 제외 → Agmo 포함 user level 설정 로드

---

## Part 3: 미해결 이슈 (다음 세션 작업)

### 이슈 1: Bash 명령 승인 UI 미구현 (CRITICAL)

**상태**: 카드에서 Bash 명령 실행 시 권한 요청이 UI 로 전달되지 않아 카드가 멈춘 것처럼 보임.

**근본 원인** (architect 조사):
- `main.js:582` `tryDetectPendingConfirmation` 함수 정의만 존재, **호출되는 곳 0건** (dead code)
- `claude:pending` IPC emit 코드 **코드베이스 전무** (grep 결과)
- 과거 텍스트 휴리스틱으로 감지하던 로직을 "신뢰 어렵다"며 제거한 후 대체 경로 미구현
- `sanitizeCliLine` (`main.js:143-284`) 이 `type === 'system'|'assistant'|'user'|'result'` 만 처리, permission 관련 이벤트 미처리
- 결과: Claude CLI가 permission 거부 → `permission_denials` 배열 반환 → vibe-kanban 감지 못함 → UI 비어있음

**해결 옵션**:

#### 옵션 A: MCP permission-prompt-tool (정식)
- Claude CLI `--permission-prompt-tool` 플래그 + 자체 MCP 서버 구동
- 실시간 인터랙티브 승인 (CLI 가 일시정지 후 사용자 응답 대기 → 재개)
- **구현 난이도: 높음** (MCP 서버, JSON-RPC, Electron 프로세스 수명 관리, 에러 처리)
- 예상 작업: 3-5일

#### 옵션 B: 거부 감지 + 재실행 (현실적, 권장)
- `sanitizeCliLine` 또는 `proc.on('close')` 에서 stream-json `result` 이벤트의 `permission_denials` 파싱
- `pendingByCard.set(cardId, {...})` 저장 + `win.webContents.send('claude:pending', ...)` emit
- 기존 UI/IPC 재사용:
  - `renderer/app.js:1412-1456` renderDetail pending section ✅
  - `renderer/app.js:1832` onPending 리스너 ✅
  - `main.js:619-634` approvePending/rejectPending 핸들러 ✅
  - 재실행 시 `skipPermissions:true` 로 runCard 재호출 ✅ (`app.js:1906-1909`)
- 승인 시 `--allowedTools "Bash(명령:*)"` 추가해 `--resume` 재실행
- **구현 난이도: 낮음** (빠진 건 "거부 감지 → IPC emit" 한 함수만)
- **예상 작업: 1-2시간**
- **단점**: 첫 거부 시 약간의 토큰 낭비, UX 상 "버튼 눌렀더니 로딩 한 번 더"

**임시 우회책**:
- 카드 `autoRun` 토글 ON → `--dangerously-skip-permissions` (Bash 전부 자동, 보안 리스크)
- 또는 터미널에서 직접 명령 실행 후 결과 붙여넣기

### 이슈 2: 좌측 하단 미확인 버튼

**상태**: 사용자가 "카드 상세 페이지 + 사이드바 닫은 상태 + 좌측 하단" 위치에 정체불명 버튼 발견.

**조사 결과 (기각된 후보들)**:
- `#authChip` (`renderer/index.html:132`, `styles.css:485`): 사이드바 내부라 사이드바 닫으면 숨김 → 배제
- `#detailBack` (`renderer/index.html:229`, `styles.css:1547`): 상단 좌측 → 위치 불일치
- `#sidebar-toggle` (`renderer/index.html:54`): 헤더 영역 → 위치 불일치

**다음 세션 액션**: 사용자에게 스크린샷 확대 / 클릭 결과 / 툴팁 정보 요청

### 이슈 3: 추가 최적화 후보 (우선순위 낮음)

- **모델 라우팅**: 카드 유형별 모델 선택 (제목 생성 등 경량 작업은 Haiku)
- **sessionExpired 재시도 시 compact 강제**: 빈도 낮아 우선순위 낮음
- **autoRun tool-call 가드**: idle timer 10분까지 폭주 시 토큰 소비

---

## Part 4: 핵심 개념 메모

### Headless vs Interactive Claude Code
- **Interactive**: 터미널에서 `claude`. `[y/n]` 프롬프트 직접 키보드 입력. 사람이 앞에 있음 가정
- **Headless**: 프로그램(vibe-kanban)이 CLI를 `spawn`으로 내부 실행. stdin/stdout JSON 스트림으로만 소통. CLI 화면 없음
- Headless 에서 permission prompt 처리 방식:
  - `--permission-prompt-tool <MCP 도구명>` 으로 외부 MCP 도구에 위임
  - 또는 `--dangerously-skip-permissions` 로 전부 건너뜀
  - 위 둘 다 없으면: permission 필요한 tool call 은 조용히 거부되고 `permission_denials` 에 기록

### Permission 모드
- `default`: 인터랙티브 프롬프트
- `acceptEdits`: 파일 편집(Edit/Write)만 자동 허용, 나머지(Bash 등)는 여전히 승인 필요 (vibe-kanban 기본값)
- `bypassPermissions` / `--dangerously-skip-permissions`: 전부 자동 허용 (autoRun 카드가 사용)
- `plan`: 계획 모드, 실행 안 함

### Prompt caching
- Claude Code 자동 적용, 설정 불필요
- TTL: 5분
- 5분 이내 재사용 → cache read (~10% 원가)
- 5분 초과 → cache miss (풀 원가 재청구)
- vibe-kanban 과 터미널 `claude` 의 토큰 체감 차이의 주 원인

### Settings sources
- `user`: `~/.claude/settings.json` (플러그인 등록, 전역 설정, 권한 allowlist)
- `project`: `<cwd>/.claude/settings.json`
- `local`: `<cwd>/.claude/settings.local.json`
- `--setting-sources project,local` 으로 특정 소스만 로드 가능. `user` 제외 시 플러그인/user 전역 설정 모두 무효화

---

## Part 5: 파일 경로 & 라인 참조

### 프로젝트 파일
- `main.js` - Electron main 프로세스, Claude CLI spawn, IPC 핸들러
- `preload.js` - IPC bridge (renderer ↔ main)
- `renderer/app.js` - UI 로직 (runCard, doCompact, renderDetail, 이벤트 핸들러)
- `renderer/index.html` - DOM 구조
- `renderer/styles.css` - 스타일

### 외부 파일
- `~/.claude/settings.json` - user level Claude 설정 (Skill allowlist 추가됨)
- `~/Library/Application Support/vibe-kanban/kanban-data.json` - 앱 데이터

### 주요 함수/라인 맵
- `main.js:287` - `runViaClaudeCLI` 진입
- `main.js:293/295` - `--setting-sources` 조건부
- `main.js:310` - `--append-system-prompt`
- `main.js:312` - `--permission-mode acceptEdits`
- `main.js:487` - `ai:run` IPC handler
- `main.js:582` - `tryDetectPendingConfirmation` (dead code, 호출 없음)
- `main.js:619-634` - `approvePending`/`rejectPending` 핸들러
- `main.js:640-648` - `claude:compact` 핸들러
- `renderer/app.js:52-58` - `AUTO_COMPACT_*` 상수
- `renderer/app.js:1394` - useSkills UI 상태 반영
- `renderer/app.js:1412-1456` - `renderDetail` pending section
- `renderer/app.js:1533` - useSkills 토글 이벤트
- `renderer/app.js:1581-1645` - `doCompact` (리팩토링됨, targetCard 파라미터)
- `renderer/app.js:1608` - `compactSession` 호출
- `renderer/app.js:1799/1832` - `onPending` 리스너
- `renderer/app.js:1906-1909` - `rerun:true` 처리 (재실행 플로우)
- `renderer/app.js:1922` - `openNewCard` 기본값 (`useSkills: false`)
- `renderer/app.js:2317-2335` - `runCard` 자동 compact 트리거
- `renderer/app.js:2374` - `runCard` IPC 페이로드 구성
- `renderer/app.js:2413` - useSkills IPC 전달
- `renderer/app.js:2437/2447` - `buildSystemPrompt`/`buildUserPrompt`
- `renderer/app.js:2456` - `lastRunAt` 갱신

---

## Part 6: 다음 세션 액션 아이템

### 우선순위 1 (해결 필수)
- [ ] **Bash 승인 UI 정식 구현 (옵션 B 권장)**: `main.js` `sanitizeCliLine` 또는 `proc.on('close')` 에서 `permission_denials` 파싱 → `pendingByCard.set` + `claude:pending` IPC emit → 기존 UI/재실행 플로우 연결

### 우선순위 2 (편의)
- [ ] 좌측 하단 버튼 정체 파악 (사용자 추가 정보 필요)

### 우선순위 3 (선택)
- [ ] 모델 라우팅 (경량 작업 Haiku)
- [ ] autoRun 카드 tool-call 폭주 가드
- [ ] sessionExpired 재시도 시 compact 강제 (빈도 낮음)

---

**작성일**: 2026-04-22  
**작성자**: Claude session orchestrator
