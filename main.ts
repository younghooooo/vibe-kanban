// main.ts
// TODO: Claude CLI 출력 포맷 확정 후 실제 승인 요청 감지 로직 구현.
// 현재는 스텁: 텍스트 매칭으로 "Do you want to ..?" 패턴만 감지.
// stream-json 모드로 전환 시 permission_request 메시지를 직접 구조화해 사용.
import { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, clipboard } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, mkdtempSync } from 'fs'
import { request as httpsRequest } from 'https'
import { spawn, execSync } from 'child_process'
import { tmpdir, homedir } from 'os'
import { createHash } from 'crypto'

// Map of cardId -> child process
const runningProcesses = new Map<string, ReturnType<typeof spawn>>()

// Map of cardId -> pending state
const pendingByCard = new Map<string, unknown>()

const isDev = process.argv.includes('--dev')

const getSettingsPath = () => join(app.getPath('userData'), 'settings.json')
const getDataPath = () => join(app.getPath('userData'), 'kanban-data.json')
const getExportDir = () => join(app.getPath('userData'), 'exports')
const getDocFallbackDir = () => join(app.getPath('userData'), 'cardDocs')

function resolveDocPath(cardId: string, cwd?: string | null) {
  const safeId = String(cardId || '').replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safeId) throw new Error('invalid cardId')
  if (cwd && typeof cwd === 'string' && existsSync(cwd)) {
    const dir = join(cwd, '.vibe-kanban')
    return { path: join(dir, safeId + '.md'), dir, scope: 'cwd' }
  }
  const dir = getDocFallbackDir()
  return { path: join(dir, safeId + '.md'), dir, scope: 'fallback' }
}

function hashContent(s: string) {
  return createHash('sha1').update(String(s || ''), 'utf-8').digest('hex')
}

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0b0b0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (isDev) mainWindow.webContents.openDevTools()
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.webContents.on('found-in-page', (_e, result) => {
    mainWindow?.webContents.send('findInPage:result', result)
  })
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// settings
function readSettings(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(getSettingsPath(), 'utf-8')) }
  catch { return {} }
}
function writeSettings(obj: Record<string, unknown>) {
  writeFileSync(getSettingsPath(), JSON.stringify(obj, null, 2), 'utf-8')
}

ipcMain.handle('settings:save-key', async (_e, apiKey: string) => {
  try {
    const settings = readSettings()
    if (safeStorage.isEncryptionAvailable()) {
      settings.apiKeyEncrypted = safeStorage.encryptString(apiKey).toString('base64')
      delete settings.apiKeyPlain
    } else {
      settings.apiKeyPlain = apiKey
      delete settings.apiKeyEncrypted
    }
    writeSettings(settings)
    return { ok: true, encrypted: !!settings.apiKeyEncrypted }
  } catch (err: unknown) { return { ok: false, error: (err as Error).message } }
})
ipcMain.handle('settings:has-key', async () => {
  const s = readSettings()
  return !!(s.apiKeyEncrypted || s.apiKeyPlain)
})
ipcMain.handle('settings:clear-key', async () => {
  const s = readSettings()
  delete s.apiKeyEncrypted; delete s.apiKeyPlain
  writeSettings(s)
  return { ok: true }
})
function getApiKey(): string | null {
  const s = readSettings()
  if (s.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(s.apiKeyEncrypted as string, 'base64')) }
    catch { return null }
  }
  return (s.apiKeyPlain as string) || null
}
ipcMain.handle('settings:get-model', async () => (readSettings().model as string) || 'claude-sonnet-4-6')
ipcMain.handle('settings:set-model', async (_e, model: string) => {
  const s = readSettings(); s.model = model; writeSettings(s); return { ok: true }
})
ipcMain.handle('settings:get-auth-mode', async () => (readSettings().authMode as string) || 'auto')
ipcMain.handle('settings:set-auth-mode', async (_e, mode: string) => {
  const s = readSettings(); s.authMode = mode; writeSettings(s); return { ok: true }
})

// Claude CLI
function detectClaudeCLI() {
  const candidates = [
    'claude',
    '/usr/local/bin/claude',
    join(process.env.HOME || '', '.local/bin/claude'),
    join(process.env.HOME || '', '.npm-global/bin/claude'),
  ]
  for (const cmd of candidates) {
    try {
      const result = execSync(`${cmd} --version`, {
        encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      if (result) return { found: true, path: cmd, version: result }
    } catch {}
  }
  try {
    const which = execSync('which claude', { encoding: 'utf-8', timeout: 2000 }).trim()
    if (which) {
      const version = execSync(`${which} --version`, { encoding: 'utf-8', timeout: 3000 }).trim()
      return { found: true, path: which, version }
    }
  } catch {}
  return { found: false }
}

ipcMain.handle('auth:detect-claude-cli', async () => detectClaudeCLI())

// data
ipcMain.handle('data:load', async () => {
  try { return JSON.parse(readFileSync(getDataPath(), 'utf-8')) }
  catch { return null }
})
ipcMain.handle('data:save', async (_e, data: unknown) => {
  try {
    writeFileSync(getDataPath(), JSON.stringify(data, null, 2), 'utf-8')
    return { ok: true }
  } catch (err: unknown) { return { ok: false, error: (err as Error).message } }
})

// Card doc IPC
ipcMain.handle('doc:path', async (_e, { cardId, cwd }: { cardId: string; cwd?: string }) => {
  try {
    const r = resolveDocPath(cardId, cwd)
    return { ok: true, path: r.path, scope: r.scope }
  } catch (err: unknown) { return { ok: false, error: (err as Error).message } }
})
ipcMain.handle('doc:write', async (_e, { cardId, cwd, content }: { cardId: string; cwd?: string; content: string }) => {
  try {
    const r = resolveDocPath(cardId, cwd)
    if (!existsSync(r.dir)) {
      mkdirSync(r.dir, { recursive: true })
      if (r.scope === 'cwd') {
        try { writeFileSync(join(r.dir, '.gitignore'), '*\n!.gitignore\n', 'utf-8') } catch {}
      }
    }
    writeFileSync(r.path, String(content || ''), 'utf-8')
    const st = statSync(r.path)
    return { ok: true, path: r.path, scope: r.scope, mtimeMs: st.mtimeMs, hash: hashContent(content) }
  } catch (err: unknown) { return { ok: false, error: (err as Error).message } }
})
ipcMain.handle('doc:read', async (_e, { cardId, cwd }: { cardId: string; cwd?: string }) => {
  try {
    const r = resolveDocPath(cardId, cwd)
    if (!existsSync(r.path)) return { ok: true, exists: false, content: '', path: r.path, scope: r.scope }
    const content = readFileSync(r.path, 'utf-8')
    const st = statSync(r.path)
    return { ok: true, exists: true, content, path: r.path, scope: r.scope, mtimeMs: st.mtimeMs, hash: hashContent(content) }
  } catch (err: unknown) { return { ok: false, error: (err as Error).message } }
})

// AI run
interface LogEntry {
  type: string
  line: string
  meta?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    cost: number
    durationMs: number
  }
}

function sanitizeCliLine(line: string): LogEntry[] {
  const s = String(line || '').trim()
  if (!s) return []
  const hasMetaSignals = /"(type|session_id|total_cost_usd|duration_ms|stop_reason|modelUsage|permission_denials|usage)"\s*:/.test(s)
  const looksLikeJson = s.startsWith('{') || /^\s*\{/.test(s)

  if (looksLikeJson || hasMetaSignals) {
    let jsonStr = s
    const firstBrace = jsonStr.indexOf('{')
    const lastBrace = jsonStr.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1)
    }

    try {
      const obj = JSON.parse(jsonStr)
      const out: LogEntry[] = []

      if (obj.type === 'system' && obj.subtype === 'init') {
        const m = obj.model ? `model=${obj.model}` : ''
        const tools = Array.isArray(obj.tools) ? `tools=${obj.tools.length}` : ''
        const meta = [m, tools].filter(Boolean).join(' · ')
        if (meta) out.push({ type: 'info', line: `세션 시작 · ${meta}` })
        return out
      }

      if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
        for (const block of obj.message.content) {
          if (!block) continue
          if (block.type === 'text' && typeof block.text === 'string') {
            const txt = block.text.trim()
            if (txt) out.push({ type: 'stream', line: txt })
          } else if (block.type === 'tool_use') {
            const name = block.name || 'tool'
            const input = block.input || {}

            if (name === 'Edit' && input.file_path) {
              if (typeof input.old_string === 'string' && typeof input.new_string === 'string') {
                out.push({ type: 'diff', line: JSON.stringify({ filePath: input.file_path, before: input.old_string, after: input.new_string }) })
              }
              continue
            }
            if (name === 'Write' && input.file_path) {
              if (typeof input.content === 'string') {
                out.push({ type: 'diff', line: JSON.stringify({ filePath: input.file_path, before: '', after: input.content, mode: 'write' }) })
              }
              continue
            }
            if (name === 'MultiEdit' && input.file_path && Array.isArray(input.edits)) {
              for (const edit of input.edits) {
                if (typeof edit.old_string === 'string' && typeof edit.new_string === 'string') {
                  out.push({ type: 'diff', line: JSON.stringify({ filePath: input.file_path, before: edit.old_string, after: edit.new_string }) })
                }
              }
              continue
            }
            continue
          }
        }
        return out
      }

      if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
        return out
      }

      if (obj.type === 'result' || typeof obj.result === 'string') {
        if (obj.session_id) {
          out.push({ type: 'sessionId', line: obj.session_id })
        }
        if (typeof obj.result === 'string' && obj.result.trim()) {
          out.push({ type: 'result', line: obj.result })
        }
        if (obj.usage) {
          const u = obj.usage
          const cost = typeof obj.total_cost_usd === 'number' ? ` · $${obj.total_cost_usd.toFixed(4)}` : ''
          const dur = typeof obj.duration_ms === 'number' ? ` · ${Math.round(obj.duration_ms / 1000)}s` : ''
          const usageLine = `in=${u.input_tokens || 0} · out=${u.output_tokens || 0}${cost}${dur}`
          out.push({
            type: 'usage',
            line: usageLine,
            meta: {
              inputTokens: u.input_tokens || 0,
              outputTokens: u.output_tokens || 0,
              cacheReadTokens: u.cache_read_input_tokens || 0,
              cacheCreationTokens: u.cache_creation_input_tokens || 0,
              cost: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : 0,
              durationMs: typeof obj.duration_ms === 'number' ? obj.duration_ms : 0,
            },
          })
        }
        return out
      }

      return []
    } catch (e) {
      if (hasMetaSignals) {
        const resultMatch = /"result"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s)
        if (resultMatch) {
          try {
            const resultText = JSON.parse('"' + resultMatch[1] + '"')
            if (resultText.trim()) return [{ type: 'result', line: resultText }]
          } catch {}
        }
        return []
      }
      return [{ type: 'info', line: s }]
    }
  }

  return [{ type: 'info', line: s }]
}

interface RunOptions {
  autoRun?: boolean
  cwd?: string
  refPaths?: string[]
  skipPermissions?: boolean
  sessionId?: string | null
  systemPrompt?: string | null
  useSkills?: boolean
  images?: unknown[]
}

async function runViaClaudeCLI(prompt: string, model: string, cardId: string | null, options: RunOptions = {}) {
  const { autoRun = false, cwd, refPaths = [], skipPermissions = false, sessionId = null, systemPrompt = null, useSkills = false } = options
  const cli = detectClaudeCLI()
  if (!cli.found) return { ok: false, error: 'Claude CLI not found', fallback: true }

  return new Promise((resolve) => {
    let stdout = '', stderr = ''
    const args = useSkills
      ? ['-p', '--output-format', 'stream-json', '--verbose']
      : ['-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project,local']
    if (sessionId) args.push('--resume', sessionId)
    if (model) {
      const cliModel: Record<string, string> = {
        'claude-opus-4-7': 'claude-opus-4-7',
        'claude-sonnet-4-6': 'claude-sonnet-4-6',
        'claude-haiku-4-5': 'haiku',
      }
      args.push('--model', cliModel[model] || 'claude-sonnet-4-6')
    }
    if (skipPermissions || autoRun) {
      args.push('--dangerously-skip-permissions')
    } else {
      args.push('--permission-mode', 'acceptEdits')
    }
    if (systemPrompt) {
      args.push('--append-system-prompt', systemPrompt)
    }
    if (Array.isArray(refPaths)) {
      for (const p of refPaths) {
        if (p && typeof p === 'string') args.push('--add-dir', p)
      }
    }

    const spawnOpts: { stdio: ['pipe','pipe','pipe']; env: NodeJS.ProcessEnv; cwd?: string } = { stdio: ['pipe','pipe','pipe'], env: { ...process.env } }
    if (cwd) spawnOpts.cwd = cwd
    console.log(`[claude-cli] useSkills=${useSkills}, spawn args:`, cli.path, args.join(' '))
    const proc = spawn(cli.path!, args, spawnOpts)

    let lastActivity = Date.now()
    const idleChecker = setInterval(() => {
      if (Date.now() - lastActivity > 10 * 60 * 1000) {
        console.warn('[claude-cli] idle 10min, killing process')
        try { proc.kill('SIGTERM') } catch {}
        clearInterval(idleChecker)
      }
    }, 30_000)

    const cardIdForProc = cardId || null
    if (cardIdForProc) {
      runningProcesses.set(cardIdForProc, proc)
      proc.on('exit', () => runningProcesses.delete(cardIdForProc))
    }
    proc.on('exit', () => clearInterval(idleChecker))

    const win = BrowserWindow.getAllWindows()[0]
    let stdoutBuffer = ''
    let hasStreamed = false

    proc.stdout!.on('data', (d: Buffer) => {
      lastActivity = Date.now()
      const text = d.toString('utf8')
      stdout += text
      stdoutBuffer += text

      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop()!
      for (const rawLine of lines) {
        if (!rawLine) continue
        const entries = sanitizeCliLine(rawLine)
        for (const entry of entries) {
          if (entry.type === 'stream') hasStreamed = true
          if (entry.type === 'result' && hasStreamed) continue
          if (entry.type === 'sessionId') {
            win?.webContents.send('ai:session', { cardId: cardIdForProc, sessionId: entry.line })
          } else {
            win?.webContents.send('ai:log', { cardId: cardIdForProc, line: entry.line, type: entry.type, meta: entry.meta || null })
          }
        }
      }
    })
    proc.stderr!.on('data', (d: Buffer) => {
      lastActivity = Date.now()
      const text = d.toString('utf8')
      stderr += text
      win?.webContents.send('ai:log', { cardId: cardIdForProc, line: `[stderr] ${text.trim()}` })
    })
    proc.on('error', (err: Error) => {
      clearInterval(idleChecker)
      win?.webContents.send('ai:done', { cardId: cardIdForProc, code: -1, signal: null, output: '', error: String(err), empty: true })
      resolve({ ok: false, error: 'CLI error: ' + err.message, fallback: true })
    })
    proc.on('close', (code: number | null, signal: string | null) => {
      clearInterval(idleChecker)

      if (stdoutBuffer && stdoutBuffer.length > 0) {
        const entries = sanitizeCliLine(stdoutBuffer)
        for (const entry of entries) {
          if (entry.type === 'stream') hasStreamed = true
          if (entry.type === 'result' && hasStreamed) continue
          if (entry.type === 'sessionId') {
            win?.webContents.send('ai:session', { cardId: cardIdForProc, sessionId: entry.line })
          } else {
            win?.webContents.send('ai:log', { cardId: cardIdForProc, line: entry.line, type: entry.type, meta: entry.meta || null })
          }
        }
      }

      if (code !== 0) {
        const sessionExpired = !!(sessionId && /session|resume|not[\s-]?found/i.test(stderr))
        win?.webContents.send('ai:done', { cardId: cardIdForProc, code, signal, output: stdout, error: `CLI exit ${code}: ${stderr.slice(0, 300)}`, empty: !stdout.trim(), sessionExpired })
        resolve({ ok: false, error: `CLI exit ${code}: ${stderr.slice(0, 300)}`, fallback: stderr.includes('auth') || stderr.includes('login') || stderr.includes('not found'), sessionExpired })
        return
      }
      win?.webContents.send('ai:done', { cardId: cardIdForProc, code, signal, output: '', empty: false, sessionId: null })
      resolve({ ok: true, text: '', usage: { input_tokens: 0, output_tokens: 0 }, via: 'claude-cli' })
    })
    proc.stdin!.write(prompt)
    proc.stdin!.end()
  })
}

async function runViaAPI(prompt: string, model: string, maxTokens: number, images: unknown[] = []) {
  const apiKey = getApiKey()
  if (!apiKey) return { ok: false, error: 'API 키가 없고 Claude CLI도 사용 불가' }

  let messageContent
  if (Array.isArray(images) && images.length > 0) {
    messageContent = [
      ...(images as { mimeType: string; base64: string }[]).map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } })),
      { type: 'text', text: prompt },
    ]
  } else {
    messageContent = prompt
  }
  const body = JSON.stringify({ model, max_tokens: maxTokens || 2048, messages: [{ role: 'user', content: messageContent }] })

  return new Promise((resolve) => {
    const req = httpsRequest({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-length': Buffer.byteLength(body),
      },
    }, (res) => {
      let chunks = ''
      res.on('data', (c: Buffer) => chunks += c)
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks)
          if ((res.statusCode ?? 0) >= 400) {
            resolve({ ok: false, error: data.error?.message || `HTTP ${res.statusCode}` })
            return
          }
          const text = (data.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n')
          resolve({ ok: true, text, usage: data.usage || { input_tokens: 0, output_tokens: 0 }, via: 'api' })
        } catch (e: unknown) {
          resolve({ ok: false, error: 'Invalid response: ' + (e as Error).message })
        }
      })
    })
    req.on('error', (err: Error) => resolve({ ok: false, error: err.message }))
    req.write(body)
    req.end()
  })
}

ipcMain.handle('ai:run', async (_e, { model, prompt, systemPrompt, maxTokens, cardId, autoRun, useSkills, cwd, refPaths, skipPermissions, sessionId, images }) => {
  const authMode = (readSettings().authMode as string) || 'auto'
  if (authMode === 'api') return await runViaAPI(prompt, model, maxTokens, images)
  if (authMode === 'cli') return await runViaClaudeCLI(prompt, model, cardId, { autoRun, useSkills, cwd, refPaths, skipPermissions, sessionId, images, systemPrompt })

  const cliResult = await runViaClaudeCLI(prompt, model, cardId, { autoRun, useSkills, cwd, refPaths, skipPermissions, sessionId, images, systemPrompt }) as { ok: boolean; fallback?: boolean }
  if (cliResult.ok) return cliResult
  if (cliResult.fallback && getApiKey()) {
    const apiResult = await runViaAPI(prompt, model, maxTokens, images)
    return { ...apiResult, fallbackFrom: 'cli' }
  }
  return cliResult
})

ipcMain.handle('clipboard:readImage', () => {
  try {
    const img = clipboard.readImage()
    if (!img || img.isEmpty()) return null
    const dataUrl = img.toDataURL()
    if (!dataUrl || dataUrl === 'data:image/png;base64,') return null
    return { dataUrl, base64: dataUrl.split(',')[1], mimeType: 'image/png', name: 'pasted-image.png' }
  } catch { return null }
})

ipcMain.handle('auth:open-claude-install', async () => {
  shell.openExternal('https://docs.claude.com/en/docs/claude-code/quickstart')
  return { ok: true }
})
ipcMain.handle('auth:open-api-keys', async () => {
  shell.openExternal('https://console.anthropic.com/settings/keys')
  return { ok: true }
})

// export
ipcMain.handle('export:card-markdown', async (_e, card: Record<string, unknown>) => {
  try {
    const dir = getExportDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const safeTitle = ((card.title as string) || 'untitled').replace(/[<>:"/\\|?*]/g, '_').slice(0, 60)
    const filename = `${Date.now()}_${safeTitle}.md`
    const filepath = join(dir, filename)
    let md = `# ${card.title}\n\n`
    md += `- **Category**: ${card.category}\n`
    md += `- **Priority**: ${card.priority}\n`
    md += `- **Status**: ${card.status}\n`
    md += `- **Tokens used**: ${card.tokens || 0}\n\n`
    md += `## Instruction\n\n${card.desc || '-'}\n\n`
    md += `## Execution Log\n\n`
    ;((card.log as { time: string; label: string; body: string }[]) || []).forEach(entry => {
      md += `### [${entry.time}] ${entry.label}\n\n${entry.body}\n\n`
    })
    writeFileSync(filepath, md, 'utf-8')
    return { ok: true, path: filepath }
  } catch (err: unknown) { return { ok: false, error: (err as Error).message } }
})
ipcMain.handle('export:open-folder', async () => {
  const dir = getExportDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  shell.openPath(dir)
  return { ok: true, path: dir }
})
ipcMain.handle('export:backup-json', async () => {
  try {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Kanban Data',
      defaultPath: `vibe-kanban-backup-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    writeFileSync(filePath, readFileSync(getDataPath(), 'utf-8'), 'utf-8')
    return { ok: true, path: filePath }
  } catch (err: unknown) { return { ok: false, error: (err as Error).message } }
})
ipcMain.handle('app:open-external', async (_e, url: string) => { shell.openExternal(url); return { ok: true } })

ipcMain.handle('findInPage:find', (_e, text: string, options: unknown) => {
  if (!mainWindow) return
  if (text) mainWindow.webContents.findInPage(text, (options || {}) as Electron.FindInPageOptions)
  else mainWindow.webContents.stopFindInPage('clearSelection')
})
ipcMain.handle('findInPage:stop', (_e, action: string) => {
  if (mainWindow) mainWindow.webContents.stopFindInPage((action || 'clearSelection') as 'clearSelection' | 'keepSelection' | 'activateSelection')
})

ipcMain.handle('dialog:pickDirectory', async (_event, defaultPath: string) => {
  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory'],
    defaultPath: defaultPath && typeof defaultPath === 'string' ? defaultPath : app.getPath('home'),
    title: '작업 경로 선택'
  })
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

function tryDetectPendingConfirmation(cardId: string, fullOutput: string) {
  const text = String(fullOutput || '')
  if (!text.trim()) return null
  const patterns = [/Claude Code 권한 팝업/, /방법 1[\s\S]{0,60}허용/, /"허용" 클릭/]
  const matched = patterns.some(p => p.test(text))
  if (!matched) return null

  let command = '권한이 필요한 작업'
  const cmdMatches = [
    /`([^`\n]{1,120})`/,
    /(VSCode|Cursor|code|터미널|git|npm|yarn|pnpm|brew|open|curl|wget|make|rm|mv)\s+[^\s].{0,60}/,
    /(\w+) 명령/,
  ]
  for (const re of cmdMatches) {
    const m = re.exec(text)
    if (m) { command = m[0].replace(/[`]/g, '').trim().slice(0, 120); break }
  }

  return {
    id: 'p_' + Date.now(),
    toolName: 'Permission',
    filePath: null,
    before: null,
    after: null,
    command,
    summary: `승인 필요 · ${command}`,
    createdAt: Date.now(),
  }
}

ipcMain.handle('claude:approvePending', async (_e, cardId: string, pendingId: string) => {
  const saved = pendingByCard.get(cardId)
  if (!saved) return { ok: false, reason: 'no-pending' }
  pendingByCard.delete(cardId)
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send('claude:pendingResolved', { cardId, id: pendingId, accepted: true, rerun: true })
  return { ok: true, rerun: true }
})

ipcMain.handle('claude:rejectPending', async (_e, cardId: string, pendingId: string) => {
  pendingByCard.delete(cardId)
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send('claude:pendingResolved', { cardId, id: pendingId, accepted: false, rerun: false })
  return { ok: true }
})

ipcMain.handle('claude:isRunning', (_e, cardId: string) => {
  return runningProcesses.has(cardId)
})

ipcMain.handle('claude:compact', async (_e, cardId: string, sessionId: string, cwd: string | undefined, useSkills: boolean) => {
  const cli = detectClaudeCLI()
  if (!cli.found) return { ok: false, reason: 'cli-not-found' }
  if (!sessionId) return { ok: false, reason: 'no-session' }

  const compactPrompt = '지금까지의 대화를 핵심만 3-6 문장으로 요약해줘. 작업 목적, 현재 상태, 남은 할 일 중심으로. 이 요약은 이후 새 세션에서 같은 작업을 이어갈 때 맥락 용도로만 사용될 거야. 마크다운이나 장식 없이 평문으로.'

  const args = useSkills
    ? ['-p', '--output-format', 'json', '--resume', sessionId, '--dangerously-skip-permissions']
    : ['-p', '--output-format', 'json', '--resume', sessionId, '--setting-sources', 'project,local', '--dangerously-skip-permissions']
  const spawnOpts: { stdio: ['pipe','pipe','pipe']; env: NodeJS.ProcessEnv; cwd?: string } = { stdio: ['pipe','pipe','pipe'], env: { ...process.env } }
  if (cwd) spawnOpts.cwd = cwd

  return new Promise((resolve) => {
    console.log(`[claude-cli] useSkills=${!!useSkills}, compact spawn args:`, cli.path, args.join(' '))
    const proc = spawn(cli.path!, args, spawnOpts)
    let stdout = '', stderr = ''
    let resolved = false
    const safeResolve = (val: unknown) => { if (!resolved) { resolved = true; resolve(val) } }

    const timeout = setTimeout(() => {
      try { proc.kill('SIGTERM') } catch {}
      safeResolve({ ok: false, error: 'compact timeout (2min)' })
    }, 2 * 60 * 1000)
    proc.on('exit', () => clearTimeout(timeout))

    proc.stdout!.on('data', (d: Buffer) => stdout += d.toString('utf8'))
    proc.stderr!.on('data', (d: Buffer) => stderr += d.toString('utf8'))
    proc.on('error', (err: Error) => safeResolve({ ok: false, error: String(err) }))
    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        return safeResolve({ ok: false, error: `CLI exit ${code}: ${stderr.slice(0, 200)}` })
      }
      try {
        const parsed = JSON.parse(stdout)
        const summary = typeof parsed.result === 'string' ? parsed.result.trim() : ''
        if (!summary) return safeResolve({ ok: false, error: '빈 응답' })
        return safeResolve({ ok: true, summary })
      } catch (e: unknown) {
        return safeResolve({ ok: false, error: 'JSON parse: ' + (e as Error).message })
      }
    })
    proc.stdin!.write(compactPrompt)
    proc.stdin!.end()
  })
})

ipcMain.handle('editor:open', async (_e, cwd: string) => {
  const target = (cwd && typeof cwd === 'string') ? cwd : homedir()

  const cursorPaths = ['/Applications/Cursor.app', join(homedir(), 'Applications/Cursor.app')]
  if (cursorPaths.some(p => existsSync(p))) {
    spawn('open', ['-a', 'Cursor', target], { detached: true, stdio: 'ignore' }).unref()
    return { ok: true, app: 'Cursor' }
  }

  const vscodePaths = ['/Applications/Visual Studio Code.app', join(homedir(), 'Applications/Visual Studio Code.app')]
  if (vscodePaths.some(p => existsSync(p))) {
    spawn('open', ['-a', 'Visual Studio Code', target], { detached: true, stdio: 'ignore' }).unref()
    return { ok: true, app: 'VSCode' }
  }

  try {
    await shell.openPath(target)
    return { ok: true, app: 'finder', fallback: true }
  } catch (err: unknown) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('editor:showDiff', async (_e, payload: { filePath?: string; before: string; after: string }) => {
  try {
    const { filePath, before, after } = payload || {}
    const tmpDir = mkdtempSync(join(tmpdir(), 'vk-diff-'))
    const baseName = filePath ? filePath.split('/').pop()! : 'file.txt'
    const beforePath = join(tmpDir, `before-${baseName}`)
    const afterPath = join(tmpDir, `after-${baseName}`)
    writeFileSync(beforePath, String(before || ''), 'utf-8')
    writeFileSync(afterPath, String(after || ''), 'utf-8')

    const candidates = [
      { name: 'cursor', path: '/Applications/Cursor.app/Contents/Resources/app/bin/cursor' },
      { name: 'cursor-user', path: join(homedir(), 'Applications/Cursor.app/Contents/Resources/app/bin/cursor') },
      { name: 'code', path: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' },
      { name: 'code-user', path: join(homedir(), 'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code') },
    ]
    const found = candidates.find(c => existsSync(c.path))

    if (found) {
      spawn(found.path, ['--diff', beforePath, afterPath], { detached: true, stdio: 'ignore' }).unref()
      return { ok: true, tool: found.name, tmpDir }
    }

    spawn('open', ['-a', 'Cursor', beforePath, afterPath], { detached: true, stdio: 'ignore' }).unref()
    return { ok: true, tool: 'open-fallback', tmpDir, note: 'CLI not found — opened without --diff' }
  } catch (err: unknown) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('shell:openTerminal', async (_event, cwd: string) => {
  const targetCwd = (cwd && typeof cwd === 'string') ? cwd : app.getPath('home')
  try {
    if (process.platform === 'darwin') {
      const ghosttyPaths = ['/Applications/Ghostty.app', join(homedir(), 'Applications/Ghostty.app')]
      if (ghosttyPaths.some(p => existsSync(p))) {
        spawn('open', ['-na', 'Ghostty', '--args', '--working-directory=' + targetCwd], { detached: true, stdio: 'ignore' }).unref()
        return { ok: true, app: 'Ghostty' }
      }
      spawn('open', ['-a', 'Terminal', targetCwd], { detached: true, stdio: 'ignore' }).unref()
      return { ok: true, app: 'Terminal' }
    }
    await shell.openPath(targetCwd)
    return { ok: true, fallback: true }
  } catch (err: unknown) {
    return { ok: false, error: String(err) }
  }
})
