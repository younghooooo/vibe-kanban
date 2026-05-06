// renderer/types/electron.d.ts — window.api 타입 정의 (preload contextBridge 기반)

export interface ClaudeCLIStatus {
  found: boolean
  path?: string
  version?: string
}

export interface DocResult {
  ok: boolean
  exists?: boolean
  content?: string
  path?: string
  scope?: string
  mtimeMs?: number
  hash?: string
  error?: string
}

export interface RunResult {
  ok: boolean
  text?: string
  error?: string
  via?: string
  fallback?: boolean
  fallbackFrom?: string
  sessionExpired?: boolean
  empty?: boolean
}

export interface AiLogPayload {
  cardId: string | null
  line: string
  type?: string
  meta?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    cost: number
    durationMs: number
  } | null
}

export interface AiDonePayload {
  cardId: string | null
  code: number | null
  signal: string | null
  output: string
  error?: string
  empty?: boolean
  sessionExpired?: boolean
  sessionId?: string | null
}

export interface PendingConfirmation {
  id: string
  toolName: string
  filePath: string | null
  before: string | null
  after: string | null
  command: string | null
  summary: string
  createdAt: number
}

export interface ClipboardImage {
  dataUrl: string
  base64: string
  mimeType: string
  name: string
}

export interface ElectronAPI {
  // 설정
  saveKey: (key: string) => Promise<{ ok: boolean; encrypted?: boolean; error?: string }>
  hasKey: () => Promise<boolean>
  clearKey: () => Promise<{ ok: boolean }>
  getModel: () => Promise<string>
  setModel: (model: string) => Promise<{ ok: boolean }>
  getAuthMode: () => Promise<string>
  setAuthMode: (mode: string) => Promise<{ ok: boolean }>

  // 인증
  detectClaudeCLI: () => Promise<ClaudeCLIStatus>
  openClaudeInstall: () => Promise<{ ok: boolean }>
  openApiKeys: () => Promise<{ ok: boolean }>

  // 데이터
  loadData: () => Promise<unknown>
  saveData: (data: unknown) => Promise<{ ok: boolean; error?: string }>

  // 카드 문서
  docPath: (cardId: string, cwd?: string | null) => Promise<{ ok: boolean; path?: string; scope?: string; error?: string }>
  docWrite: (cardId: string, cwd: string | null | undefined, content: string) => Promise<DocResult>
  docRead: (cardId: string, cwd?: string | null) => Promise<DocResult>

  // AI 실행
  run: (payload: Record<string, unknown>) => Promise<RunResult>
  compactSession: (cardId: string, sessionId: string, cwd?: string | null, useSkills?: boolean) => Promise<{ ok: boolean; summary?: string; error?: string }>
  isCardRunning: (cardId: string) => Promise<boolean>
  approvePending: (cardId: string, pendingId: string) => Promise<{ ok: boolean }>
  rejectPending: (cardId: string, pendingId: string) => Promise<{ ok: boolean }>

  // 클립보드
  readClipboardImage: () => Promise<ClipboardImage | null>

  // 내보내기
  exportMarkdown: (card: unknown) => Promise<{ ok: boolean; path?: string; error?: string }>
  openExportFolder: () => Promise<{ ok: boolean; path?: string }>
  backupJson: () => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>

  // 외부 앱 / 시스템
  openExternal: (url: string) => Promise<{ ok: boolean }>
  pickDirectory: (defaultPath?: string) => Promise<string | null>
  openTerminal: (cwd?: string | null) => Promise<{ ok: boolean; app?: string; error?: string }>
  openEditor: (cwd?: string | null) => Promise<{ ok: boolean; app?: string; error?: string }>
  showDiff: (payload: { filePath?: string; before: string; after: string }) => Promise<{ ok: boolean; error?: string }>

  // 페이지 내 검색
  findInPage: (text: string, opts?: unknown) => Promise<void>
  stopFindInPage: (action?: string) => Promise<void>

  // IPC 이벤트 구독
  onPending: (cb: (payload: PendingConfirmation) => void) => void
  onPendingResolved: (cb: (payload: { cardId: string; id: string; accepted: boolean; rerun: boolean }) => void) => void
  onAiLog: (cb: (payload: AiLogPayload) => void) => void
  onAiDone: (cb: (payload: AiDonePayload) => void) => void
  onAiSession: (cb: (payload: { cardId: string; sessionId: string }) => void) => void
  onFindResult: (cb: (result: unknown) => void) => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
