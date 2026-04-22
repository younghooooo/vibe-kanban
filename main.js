// main.js
// TODO: Claude CLI 출력 포맷 확정 후 실제 승인 요청 감지 로직 구현.
// 현재는 스텁: 텍스트 매칭으로 "Do you want to ..?" 패턴만 감지.
// stream-json 모드로 전환 시 permission_request 메시지를 직접 구조화해 사용.
const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, execSync } = require('child_process');
const os = require('os');

// Map of cardId -> child process (for pending confirmation IPC)
const runningProcesses = new Map();

// Map of cardId -> { pending, originalPrompt, originalModel, cwd } (for rerun after approval)
const pendingByCard = new Map();

const isDev = process.argv.includes('--dev');

const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const getDataPath = () => path.join(app.getPath('userData'), 'kanban-data.json');
const getExportDir = () => path.join(app.getPath('userData'), 'exports');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0b0b0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// settings
function readSettings() {
  try { return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8')); }
  catch { return {}; }
}
function writeSettings(obj) {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(obj, null, 2), 'utf-8');
}

ipcMain.handle('settings:save-key', async (_e, apiKey) => {
  try {
    const settings = readSettings();
    if (safeStorage.isEncryptionAvailable()) {
      settings.apiKeyEncrypted = safeStorage.encryptString(apiKey).toString('base64');
      delete settings.apiKeyPlain;
    } else {
      settings.apiKeyPlain = apiKey;
      delete settings.apiKeyEncrypted;
    }
    writeSettings(settings);
    return { ok: true, encrypted: !!settings.apiKeyEncrypted };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('settings:has-key', async () => {
  const s = readSettings();
  return !!(s.apiKeyEncrypted || s.apiKeyPlain);
});
ipcMain.handle('settings:clear-key', async () => {
  const s = readSettings();
  delete s.apiKeyEncrypted; delete s.apiKeyPlain;
  writeSettings(s);
  return { ok: true };
});
function getApiKey() {
  const s = readSettings();
  if (s.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(s.apiKeyEncrypted, 'base64')); }
    catch { return null; }
  }
  return s.apiKeyPlain || null;
}
ipcMain.handle('settings:get-model', async () => readSettings().model || 'claude-sonnet-4-5');
ipcMain.handle('settings:set-model', async (_e, model) => {
  const s = readSettings(); s.model = model; writeSettings(s); return { ok: true };
});
ipcMain.handle('settings:get-auth-mode', async () => readSettings().authMode || 'auto');
ipcMain.handle('settings:set-auth-mode', async (_e, mode) => {
  const s = readSettings(); s.authMode = mode; writeSettings(s); return { ok: true };
});

// Claude CLI
function detectClaudeCLI() {
  const candidates = [
    'claude',
    '/usr/local/bin/claude',
    path.join(process.env.HOME || '', '.local/bin/claude'),
    path.join(process.env.HOME || '', '.npm-global/bin/claude'),
  ];
  for (const cmd of candidates) {
    try {
      const result = execSync(`${cmd} --version`, {
        encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (result) return { found: true, path: cmd, version: result };
    } catch {}
  }
  try {
    const which = execSync('which claude', { encoding: 'utf-8', timeout: 2000 }).trim();
    if (which) {
      const version = execSync(`${which} --version`, { encoding: 'utf-8', timeout: 3000 }).trim();
      return { found: true, path: which, version };
    }
  } catch {}
  return { found: false };
}

ipcMain.handle('auth:detect-claude-cli', async () => detectClaudeCLI());

// data
ipcMain.handle('data:load', async () => {
  try { return JSON.parse(fs.readFileSync(getDataPath(), 'utf-8')); }
  catch { return null; }
});
ipcMain.handle('data:save', async (_e, data) => {
  try {
    fs.writeFileSync(getDataPath(), JSON.stringify(data, null, 2), 'utf-8');
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

// AI run
// Parse a single Claude CLI stream-json line and return an array of log entries.
// Each entry is { type: 'info'|'stream'|'tool'|'toolresult'|'result'|'usage'|'sessionId', line: string }.
// Returns an empty array to suppress the line entirely.
function sanitizeCliLine(line) {
  const s = String(line || '').trim();
  if (!s) return [];
  const hasMetaSignals = /"(type|session_id|total_cost_usd|duration_ms|stop_reason|modelUsage|permission_denials|usage)"\s*:/.test(s);
  const looksLikeJson = s.startsWith('{') || /^\s*\{/.test(s);

  if (looksLikeJson || hasMetaSignals) {
    let jsonStr = s;
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    try {
      const obj = JSON.parse(jsonStr);
      const out = [];

      // system init
      if (obj.type === 'system' && obj.subtype === 'init') {
        const m = obj.model ? `model=${obj.model}` : '';
        const tools = Array.isArray(obj.tools) ? `tools=${obj.tools.length}` : '';
        const meta = [m, tools].filter(Boolean).join(' · ');
        if (meta) out.push({ type: 'info', line: `세션 시작 · ${meta}` });
        return out;
      }

      // assistant text / tool_use
      if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
        for (const block of obj.message.content) {
          if (!block) continue;
          if (block.type === 'text' && typeof block.text === 'string') {
            const txt = block.text.trim();
            if (txt) out.push({ type: 'stream', line: txt });
          } else if (block.type === 'tool_use') {
            const name = block.name || 'tool';
            const input = block.input || {};

            if (name === 'Edit' && input.file_path) {
              if (typeof input.old_string === 'string' && typeof input.new_string === 'string') {
                out.push({
                  type: 'diff',
                  line: JSON.stringify({
                    filePath: input.file_path,
                    before: input.old_string,
                    after: input.new_string,
                  }),
                });
              }
              continue;
            }
            if (name === 'Write' && input.file_path) {
              if (typeof input.content === 'string') {
                out.push({
                  type: 'diff',
                  line: JSON.stringify({
                    filePath: input.file_path,
                    before: '',
                    after: input.content,
                    mode: 'write',
                  }),
                });
              }
              continue;
            }
            if (name === 'MultiEdit' && input.file_path && Array.isArray(input.edits)) {
              for (const edit of input.edits) {
                if (typeof edit.old_string === 'string' && typeof edit.new_string === 'string') {
                  out.push({
                    type: 'diff',
                    line: JSON.stringify({
                      filePath: input.file_path,
                      before: edit.old_string,
                      after: edit.new_string,
                    }),
                  });
                }
              }
              continue;
            }

            // Bash / Read / Glob / Grep and others — skip (no push)
            continue;
          }
        }
        return out;
      }

      // tool_result — suppressed entirely (hidden from log)
      if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
        return out;
      }

      // final result
      if (obj.type === 'result' || typeof obj.result === 'string') {
        if (obj.session_id) {
          out.push({ type: 'sessionId', line: obj.session_id });
        }
        if (typeof obj.result === 'string' && obj.result.trim()) {
          out.push({ type: 'result', line: obj.result });
        }
        if (obj.usage) {
          const u = obj.usage;
          const cost = typeof obj.total_cost_usd === 'number'
            ? ` · $${obj.total_cost_usd.toFixed(4)}` : '';
          const dur = typeof obj.duration_ms === 'number'
            ? ` · ${Math.round(obj.duration_ms / 1000)}s` : '';
          const usageLine = `in=${u.input_tokens || 0} · out=${u.output_tokens || 0}${cost}${dur}`;
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
          });
        }
        return out;
      }

      return [];
    } catch (e) {
      if (hasMetaSignals) {
        const resultMatch = /"result"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s);
        if (resultMatch) {
          try {
            const resultText = JSON.parse('"' + resultMatch[1] + '"');
            if (resultText.trim()) return [{ type: 'result', line: resultText }];
          } catch (e2) {}
        }
        return [];
      }
      return [{ type: 'info', line: s }];
    }
  }

  return [{ type: 'info', line: s }];
}

async function runViaClaudeCLI(prompt, model, cardId, options = {}) {
  const { autoRun = false, cwd, skipPermissions = false, sessionId = null, systemPrompt = null, useSkills = false } = options;
  const cli = detectClaudeCLI();
  if (!cli.found) return { ok: false, error: 'Claude CLI not found', fallback: true };

  return new Promise((resolve) => {
    let stdout = '', stderr = '';
    // When useSkills=true, omit --setting-sources so user-level settings (Agmo plugins) load.
    // When useSkills=false (default), restrict to project,local to save tokens.
    const args = useSkills
      ? ['-p', '--output-format', 'stream-json', '--verbose']
      : ['-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project,local'];
    if (sessionId) args.push('--resume', sessionId);
    if (model) {
      const cliModel = {
        'claude-opus-4-7': 'claude-opus-4-7',
        'claude-opus-4-5': 'opus',
        'claude-sonnet-4-5': 'sonnet',
        'claude-haiku-4-5': 'haiku',
      }[model] || 'sonnet';
      args.push('--model', cliModel);
    }
    // Use dangerously-skip-permissions when autoRun is enabled or user explicitly approved.
    if (skipPermissions || autoRun) {
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--permission-mode', 'acceptEdits');
    }
    // Append system prompt as array arg to avoid shell escaping issues
    if (systemPrompt) {
      args.push('--append-system-prompt', systemPrompt);
    }

    const spawnOpts = { stdio: ['pipe','pipe','pipe'], env: { ...process.env } };
    if (cwd) spawnOpts.cwd = cwd;
    console.log(`[claude-cli] useSkills=${useSkills}, spawn args:`, cli.path, args.join(' '));
    const proc = spawn(cli.path, args, spawnOpts);

    // Idle timeout: kill if no stdout/stderr activity for 10 minutes
    let lastActivity = Date.now();
    const idleChecker = setInterval(() => {
      const idleMs = Date.now() - lastActivity;
      if (idleMs > 10 * 60 * 1000) {
        console.warn('[claude-cli] idle 10min, killing process');
        try { proc.kill('SIGTERM'); } catch (e) {}
        clearInterval(idleChecker);
      }
    }, 30_000);

    // Store running process for pending confirmation IPC
    const cardIdForProc = cardId || null;
    if (cardIdForProc) {
      runningProcesses.set(cardIdForProc, proc);
      proc.on('exit', () => runningProcesses.delete(cardIdForProc));
    }
    proc.on('exit', () => clearInterval(idleChecker));

    const win = BrowserWindow.getAllWindows()[0];
    let stdoutBuffer = '';
    let hasStreamed = false;  // STREAM 이 한 번이라도 방출됐는지

    proc.stdout.on('data', d => {
      lastActivity = Date.now();
      const text = d.toString('utf8');
      stdout += text;
      stdoutBuffer += text;

      // Flush complete lines to renderer in real-time
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop(); // preserve last incomplete line
      for (const rawLine of lines) {
        if (!rawLine) continue;
        const entries = sanitizeCliLine(rawLine);
        for (const entry of entries) {
          if (entry.type === 'stream') hasStreamed = true;
          // STREAM 이 있었으면 RESULT 중복 제거
          if (entry.type === 'result' && hasStreamed) continue;
          if (entry.type === 'sessionId') {
            if (win) win.webContents.send('ai:session', { cardId: cardIdForProc, sessionId: entry.line });
          } else {
            if (win) win.webContents.send('ai:log', {
              cardId: cardIdForProc,
              line: entry.line,
              type: entry.type,
              meta: entry.meta || null,
            });
          }
        }
      }
    });
    proc.stderr.on('data', d => {
      lastActivity = Date.now();
      const text = d.toString('utf8');
      stderr += text;
      if (win) win.webContents.send('ai:log', { cardId: cardIdForProc, line: `[stderr] ${text.trim()}` });
    });
    proc.on('error', err => {
      clearInterval(idleChecker);
      if (win) win.webContents.send('ai:done', { cardId: cardIdForProc, code: -1, signal: null, output: '', error: String(err), empty: true });
      resolve({ ok: false, error: 'CLI error: ' + err.message, fallback: true });
    });
    proc.on('close', (code, signal) => {
      clearInterval(idleChecker);

      // Flush remaining buffer
      if (stdoutBuffer && stdoutBuffer.length > 0) {
        const entries = sanitizeCliLine(stdoutBuffer);
        for (const entry of entries) {
          if (entry.type === 'stream') hasStreamed = true;
          if (entry.type === 'result' && hasStreamed) continue;
          if (entry.type === 'sessionId') {
            if (win) win.webContents.send('ai:session', { cardId: cardIdForProc, sessionId: entry.line });
          } else {
            if (win) win.webContents.send('ai:log', {
              cardId: cardIdForProc,
              line: entry.line,
              type: entry.type,
              meta: entry.meta || null,
            });
          }
        }
      }

      if (code !== 0) {
        const sessionExpired = !!(sessionId && /session|resume|not[\s-]?found/i.test(stderr));
        if (win) win.webContents.send('ai:done', { cardId: cardIdForProc, code, signal, output: stdout, error: `CLI exit ${code}: ${stderr.slice(0, 300)}`, empty: !stdout.trim(), sessionExpired });
        resolve({
          ok: false,
          error: `CLI exit ${code}: ${stderr.slice(0,300)}`,
          fallback: stderr.includes('auth') || stderr.includes('login') || stderr.includes('not found'),
          sessionExpired,
        });
        return;
      }
      // stream-json 모드에선 stdout 이 여러 줄 JSON 이므로 통째 parse 안 됨.
      // 마지막 result 이벤트는 sanitizeCliLine 에서 이미 result 로 송출됨.
      // sessionId 도 ai:session 채널로 이미 전송. 여기선 종료 상태만 알림.
      if (win) win.webContents.send('ai:done', {
        cardId: cardIdForProc,
        code,
        signal,
        output: '',
        empty: false,
        sessionId: null,
      });
      resolve({ ok: true, text: '', usage: { input_tokens: 0, output_tokens: 0 }, via: 'claude-cli' });
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

async function runViaAPI(prompt, model, maxTokens, images = []) {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, error: 'API 키가 없고 Claude CLI도 사용 불가' };

  let messageContent;
  if (Array.isArray(images) && images.length > 0) {
    messageContent = [
      ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } })),
      { type: 'text', text: prompt },
    ];
  } else {
    messageContent = prompt;
  }
  const body = JSON.stringify({
    model,
    max_tokens: maxTokens || 2048,
    messages: [{ role: 'user', content: messageContent }],
  });

  return new Promise((resolve) => {
    const req = https.request({
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
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks);
          if (res.statusCode >= 400) {
            resolve({ ok: false, error: data.error?.message || `HTTP ${res.statusCode}` });
            return;
          }
          const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
          resolve({ ok: true, text, usage: data.usage || { input_tokens: 0, output_tokens: 0 }, via: 'api' });
        } catch (e) {
          resolve({ ok: false, error: 'Invalid response: ' + e.message });
        }
      });
    });
    req.on('error', err => resolve({ ok: false, error: err.message }));
    req.write(body);
    req.end();
  });
}

ipcMain.handle('ai:run', async (_e, { model, prompt, systemPrompt, maxTokens, cardId, autoRun, useSkills, cwd, skipPermissions, sessionId, images }) => {
  const authMode = readSettings().authMode || 'auto';
  if (authMode === 'api') return await runViaAPI(prompt, model, maxTokens, images);
  if (authMode === 'cli') return await runViaClaudeCLI(prompt, model, cardId, { autoRun, useSkills, cwd, skipPermissions, sessionId, images, systemPrompt });

  // auto
  const cliResult = await runViaClaudeCLI(prompt, model, cardId, { autoRun, useSkills, cwd, skipPermissions, sessionId, images, systemPrompt });
  if (cliResult.ok) return cliResult;
  if (cliResult.fallback && getApiKey()) {
    const apiResult = await runViaAPI(prompt, model, maxTokens, images);
    return { ...apiResult, fallbackFrom: 'cli' };
  }
  return cliResult;
});

ipcMain.handle('clipboard:readImage', () => {
  try {
    const img = clipboard.readImage();
    if (!img || img.isEmpty()) return null;
    const dataUrl = img.toDataURL();
    if (!dataUrl || dataUrl === 'data:image/png;base64,') return null;
    return { dataUrl, base64: dataUrl.split(',')[1], mimeType: 'image/png', name: 'pasted-image.png' };
  } catch (e) {
    return null;
  }
});

ipcMain.handle('auth:open-claude-install', async () => {
  shell.openExternal('https://docs.claude.com/en/docs/claude-code/quickstart');
  return { ok: true };
});
ipcMain.handle('auth:open-api-keys', async () => {
  shell.openExternal('https://console.anthropic.com/settings/keys');
  return { ok: true };
});

// export
ipcMain.handle('export:card-markdown', async (_e, card) => {
  try {
    const dir = getExportDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const safeTitle = (card.title || 'untitled').replace(/[<>:"/\\|?*]/g, '_').slice(0, 60);
    const filename = `${Date.now()}_${safeTitle}.md`;
    const filepath = path.join(dir, filename);
    let md = `# ${card.title}\n\n`;
    md += `- **Category**: ${card.category}\n`;
    md += `- **Priority**: ${card.priority}\n`;
    md += `- **Status**: ${card.status}\n`;
    md += `- **Tokens used**: ${card.tokens || 0}\n\n`;
    md += `## Instruction\n\n${card.desc || '-'}\n\n`;
    md += `## Execution Log\n\n`;
    (card.log || []).forEach(entry => {
      md += `### [${entry.time}] ${entry.label}\n\n${entry.body}\n\n`;
    });
    fs.writeFileSync(filepath, md, 'utf-8');
    return { ok: true, path: filepath };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('export:open-folder', async () => {
  const dir = getExportDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return { ok: true, path: dir };
});
ipcMain.handle('export:backup-json', async () => {
  try {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Kanban Data',
      defaultPath: `vibe-kanban-backup-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, fs.readFileSync(getDataPath(), 'utf-8'), 'utf-8');
    return { ok: true, path: filePath };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('app:open-external', async (_e, url) => { shell.openExternal(url); return { ok: true }; });

ipcMain.handle('dialog:pickDirectory', async (event, defaultPath) => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    defaultPath: defaultPath && typeof defaultPath === 'string' ? defaultPath : app.getPath('home'),
    title: '작업 경로 선택'
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Detect pending confirmation from accumulated stdout text.
// Called once at process close with the full stdout buffer.
function tryDetectPendingConfirmation(cardId, fullOutput) {
  const text = String(fullOutput || '');
  if (!text.trim()) return null;
  // Korean/English mixed permission-denial patterns — intentionally specific to avoid false positives
  const patterns = [
    /Claude Code 권한 팝업/,
    /방법 1[\s\S]{0,60}허용/,
    /"허용" 클릭/,
  ];
  const matched = patterns.some(p => p.test(text));
  if (!matched) return null;

  // Attempt to extract the relevant command or tool name
  let command = '권한이 필요한 작업';
  const cmdMatches = [
    /`([^`\n]{1,120})`/,
    /(VSCode|Cursor|code|터미널|git|npm|yarn|pnpm|brew|open|curl|wget|make|rm|mv)\s+[^\s].{0,60}/,
    /(\w+) 명령/,
  ];
  for (const re of cmdMatches) {
    const m = re.exec(text);
    if (m) { command = m[0].replace(/[`]/g, '').trim().slice(0, 120); break; }
  }

  return {
    id: 'p_' + Date.now(),
    toolName: 'Permission',
    filePath: null,
    before: null,
    after: null,
    command: command,
    summary: `승인 필요 · ${command}`,
    createdAt: Date.now(),
  };
}

// Approve pending: signal renderer to rerun with --dangerously-skip-permissions
ipcMain.handle('claude:approvePending', async (_e, cardId, pendingId) => {
  const saved = pendingByCard.get(cardId);
  if (!saved) return { ok: false, reason: 'no-pending' };
  pendingByCard.delete(cardId);
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('claude:pendingResolved', { cardId, id: pendingId, accepted: true, rerun: true });
  return { ok: true, rerun: true };
});

// Reject pending: clear state, notify renderer
ipcMain.handle('claude:rejectPending', async (_e, cardId, pendingId) => {
  pendingByCard.delete(cardId);
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('claude:pendingResolved', { cardId, id: pendingId, accepted: false, rerun: false });
  return { ok: true };
});

ipcMain.handle('claude:isRunning', (_e, cardId) => {
  return runningProcesses && runningProcesses.has(cardId);
});

ipcMain.handle('claude:compact', async (_e, cardId, sessionId, cwd, useSkills) => {
  const cli = detectClaudeCLI();
  if (!cli.found) return { ok: false, reason: 'cli-not-found' };
  if (!sessionId) return { ok: false, reason: 'no-session' };

  const compactPrompt = '지금까지의 대화를 핵심만 3-6 문장으로 요약해줘. 작업 목적, 현재 상태, 남은 할 일 중심으로. 이 요약은 이후 새 세션에서 같은 작업을 이어갈 때 맥락 용도로만 사용될 거야. 마크다운이나 장식 없이 평문으로.';

  // When useSkills=true, omit --setting-sources to allow Agmo plugins during compact.
  const args = useSkills
    ? ['-p', '--output-format', 'json', '--resume', sessionId]
    : ['-p', '--output-format', 'json', '--resume', sessionId, '--setting-sources', 'project,local'];
  const spawnOpts = { stdio: ['pipe','pipe','pipe'], env: { ...process.env } };
  if (cwd) spawnOpts.cwd = cwd;

  return new Promise((resolve) => {
    console.log(`[claude-cli] useSkills=${!!useSkills}, compact spawn args:`, cli.path, args.join(' '));
    const proc = spawn(cli.path, args, spawnOpts);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d.toString('utf8'));
    proc.stderr.on('data', d => stderr += d.toString('utf8'));
    proc.on('error', err => resolve({ ok: false, error: String(err) }));
    proc.on('close', (code) => {
      if (code !== 0) {
        return resolve({ ok: false, error: `CLI exit ${code}: ${stderr.slice(0, 200)}` });
      }
      try {
        const parsed = JSON.parse(stdout);
        const summary = typeof parsed.result === 'string' ? parsed.result.trim() : '';
        if (!summary) return resolve({ ok: false, error: '빈 응답' });
        return resolve({ ok: true, summary });
      } catch (e) {
        return resolve({ ok: false, error: 'JSON parse: ' + e.message });
      }
    });
    proc.stdin.write(compactPrompt);
    proc.stdin.end();
  });
});

// IPC channel: 'editor:open' — open Cursor or VSCode at the given cwd
ipcMain.handle('editor:open', async (_e, cwd) => {
  const { existsSync } = require('fs');
  const os = require('os');
  const target = (cwd && typeof cwd === 'string') ? cwd : os.homedir();

  // Cursor first
  const cursorPaths = [
    '/Applications/Cursor.app',
    path.join(os.homedir(), 'Applications/Cursor.app'),
  ];
  const hasCursor = cursorPaths.some(p => existsSync(p));
  if (hasCursor) {
    spawn('open', ['-a', 'Cursor', target], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, app: 'Cursor' };
  }

  // VSCode
  const vscodePaths = [
    '/Applications/Visual Studio Code.app',
    path.join(os.homedir(), 'Applications/Visual Studio Code.app'),
  ];
  const hasVSCode = vscodePaths.some(p => existsSync(p));
  if (hasVSCode) {
    spawn('open', ['-a', 'Visual Studio Code', target], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, app: 'VSCode' };
  }

  // Fallback
  try {
    await shell.openPath(target);
    return { ok: true, app: 'finder', fallback: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// IPC channel: 'editor:showDiff' — open two temp files in Cursor/VSCode diff view
ipcMain.handle('editor:showDiff', async (_e, payload) => {
  try {
    const { filePath, before, after } = payload || {};
    const { existsSync, writeFileSync, mkdtempSync } = require('fs');
    const os = require('os');

    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vk-diff-'));
    const baseName = filePath ? path.basename(String(filePath)) : 'file.txt';
    const beforePath = path.join(tmpDir, `before-${baseName}`);
    const afterPath = path.join(tmpDir, `after-${baseName}`);
    writeFileSync(beforePath, String(before || ''), 'utf-8');
    writeFileSync(afterPath, String(after || ''), 'utf-8');

    // Cursor/VSCode CLI path candidates — prefer Cursor
    const candidates = [
      { name: 'cursor', path: '/Applications/Cursor.app/Contents/Resources/app/bin/cursor' },
      { name: 'cursor-user', path: path.join(os.homedir(), 'Applications/Cursor.app/Contents/Resources/app/bin/cursor') },
      { name: 'code', path: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' },
      { name: 'code-user', path: path.join(os.homedir(), 'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code') },
    ];
    const found = candidates.find(c => existsSync(c.path));

    if (found) {
      spawn(found.path, ['--diff', beforePath, afterPath], {
        detached: true, stdio: 'ignore',
      }).unref();
      return { ok: true, tool: found.name, tmpDir };
    }

    // Fallback: open app without --diff (at least shows the file)
    spawn('open', ['-a', 'Cursor', beforePath, afterPath], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, tool: 'open-fallback', tmpDir, note: 'CLI not found — opened without --diff' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('shell:openTerminal', async (event, cwd) => {
  const os = require('os');
  const targetCwd = (cwd && typeof cwd === 'string') ? cwd : app.getPath('home');
  try {
    if (process.platform === 'darwin') {
      // Check if Ghostty is installed before attempting to open
      const ghosttyPaths = [
        '/Applications/Ghostty.app',
        path.join(os.homedir(), 'Applications/Ghostty.app'),
      ];
      const hasGhostty = ghosttyPaths.some(p => fs.existsSync(p));

      if (hasGhostty) {
        spawn('open', ['-na', 'Ghostty', '--args', '--working-directory=' + targetCwd], {
          detached: true, stdio: 'ignore'
        }).unref();
        return { ok: true, app: 'Ghostty' };
      }

      // Fallback to Terminal.app
      spawn('open', ['-a', 'Terminal', targetCwd], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, app: 'Terminal' };
    }
    // Other platforms: shell.openPath fallback
    await shell.openPath(targetCwd);
    return { ok: true, fallback: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
