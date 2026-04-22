# Vibe Kanban v0.3

AI 칸반 보드. Claude API로 카드 작업을 실행합니다.
**Claude Code 구독이 있으면 추가 비용 없이** 사용 가능.

## v0.3 변경점

- **디자인 전면 리뉴얼**: Tailwind + DaisyUI 기반, 정보 위계/가독성 대폭 개선
- **카테고리 완전 관리**: 추가/이름 변경/색상 변경/삭제 (편집 버튼 클릭)
- **Fraunces 세리프** + **Inter 산세리프** + **JetBrains Mono** 3-font 시스템
- 색상 팔레트 10종, 색상 선택기

## 필요한 것

- Node.js 18+
- 다음 중 하나:
  - Claude Code CLI (Pro/Max 구독 추천)
  - Anthropic API 키

## 설치 & 실행

```bash
npm install
npm start
```

## 인증 방식

상단 "인증" 버튼 → 3가지 중 선택

1. **Claude Code 구독** — CLI 감지해서 본인 로그인 세션 활용 (구독자 무료)
2. **API 키 직접 입력** — 사용량만큼 과금
3. **자동 모드** — CLI 먼저 시도, 실패 시 API fallback

## 카테고리 관리

사이드바의 "카테고리" 섹션 옆 **"+ 편집"** 버튼 클릭:
- 새 카테고리 추가 (이름 + 색상 선택)
- 기존 카테고리 이름 변경 (클릭 → 편집)
- 색상 변경 (점 아이콘 클릭 → 다음 색으로 순환)
- 카테고리 삭제 (안에 작업 있으면 경고)

## 주요 기능

- 4단 칸반 (할 일 / 진행 중 / 검토 / 완료)
- 드래그앤드롭 카드 이동
- 카드별 AI 실행 (실행 → 진행률 → REVIEW로 자동 이동)
- 토큰/비용 실시간 집계
- 실행 로그 (START / RESULT / USAGE / ERROR 라벨링)
- 마크다운 내보내기
- JSON 백업/복원
- OS 키체인 암호화 저장

## 앱으로 빌드

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

## 데이터 위치

- macOS: `~/Library/Application Support/vibe-kanban/`
- Windows: `%APPDATA%/vibe-kanban/`
- Linux: `~/.config/vibe-kanban/`

## 알려진 이슈

- Claude CLI의 `-p --output-format json` 출력 포맷은 버전별 차이가 있을 수 있음 → 파싱 실패 시 API fallback 권장
- CDN 기반 Tailwind라 오프라인 첫 실행 시 폰트/CSS 로드 필요 (이후엔 캐시됨)
