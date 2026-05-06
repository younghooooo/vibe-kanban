// preload.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  saveKey:       (key: string)  => ipcRenderer.invoke('settings:save-key', key),
  hasKey:        ()             => ipcRenderer.invoke('settings:has-key'),
  clearKey:      ()             => ipcRenderer.invoke('settings:clear-key'),
  getModel:      ()             => ipcRenderer.invoke('settings:get-model'),
  setModel:      (m: string)    => ipcRenderer.invoke('settings:set-model', m),
  getAuthMode:   ()             => ipcRenderer.invoke('settings:get-auth-mode'),
  setAuthMode:   (mode: string) => ipcRenderer.invoke('settings:set-auth-mode', mode),

  detectClaudeCLI:   () => ipcRenderer.invoke('auth:detect-claude-cli'),
  openClaudeInstall: () => ipcRenderer.invoke('auth:open-claude-install'),
  openApiKeys:       () => ipcRenderer.invoke('auth:open-api-keys'),

  loadData: ()              => ipcRenderer.invoke('data:load'),
  saveData: (data: unknown) => ipcRenderer.invoke('data:save', data),

  docPath:  (cardId: string, cwd?: string | null)                        => ipcRenderer.invoke('doc:path', { cardId, cwd }),
  docWrite: (cardId: string, cwd: string | null | undefined, content: string) => ipcRenderer.invoke('doc:write', { cardId, cwd, content }),
  docRead:  (cardId: string, cwd?: string | null)                        => ipcRenderer.invoke('doc:read', { cardId, cwd }),

  run:              (payload: Record<string, unknown>) => ipcRenderer.invoke('ai:run', payload),
  compactSession:   (cardId: string, sessionId: string, cwd?: string | null, useSkills?: boolean) =>
                    ipcRenderer.invoke('claude:compact', cardId, sessionId, cwd, useSkills),
  isCardRunning:    (cardId: string) => ipcRenderer.invoke('claude:isRunning', cardId),
  approvePending:   (cardId: string, pendingId: string) => ipcRenderer.invoke('claude:approvePending', cardId, pendingId),
  rejectPending:    (cardId: string, pendingId: string) => ipcRenderer.invoke('claude:rejectPending', cardId, pendingId),

  readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),

  exportMarkdown:   (card: unknown)  => ipcRenderer.invoke('export:card-markdown', card),
  openExportFolder: ()               => ipcRenderer.invoke('export:open-folder'),
  backupJson:       ()               => ipcRenderer.invoke('export:backup-json'),

  openExternal:  (url: string)         => ipcRenderer.invoke('app:open-external', url),
  pickDirectory: (defaultPath?: string) => ipcRenderer.invoke('dialog:pickDirectory', defaultPath),
  openTerminal:  (cwd?: string | null) => ipcRenderer.invoke('shell:openTerminal', cwd),
  openEditor:    (cwd?: string | null) => ipcRenderer.invoke('editor:open', cwd),
  showDiff:      (payload: { filePath?: string; before: string; after: string }) => ipcRenderer.invoke('editor:showDiff', payload),

  findInPage:     (text: string, opts?: unknown)  => ipcRenderer.invoke('findInPage:find', text, opts),
  stopFindInPage: (action?: string)               => ipcRenderer.invoke('findInPage:stop', action),

  onPending:          (cb: (payload: unknown) => void) => ipcRenderer.on('claude:pending',         (_e, p) => cb(p)),
  onPendingResolved:  (cb: (payload: unknown) => void) => ipcRenderer.on('claude:pendingResolved', (_e, p) => cb(p)),
  onAiLog:            (cb: (payload: unknown) => void) => ipcRenderer.on('ai:log',                 (_e, p) => cb(p)),
  onAiDone:           (cb: (payload: unknown) => void) => ipcRenderer.on('ai:done',                (_e, p) => cb(p)),
  onAiSession:        (cb: (payload: unknown) => void) => ipcRenderer.on('ai:session',             (_e, p) => cb(p)),
  onFindResult:       (cb: (result: unknown) => void)  => ipcRenderer.on('findInPage:result',      (_e, r) => cb(r)),
})
