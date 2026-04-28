// shared/lib/utils.js

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function truncate(s, max) {
  s = String(s || '');
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function nowHMS() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}시 ${pad(d.getMinutes())}분 ${pad(d.getSeconds())}초`;
}

export function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

export function formatCost(usd) {
  if (usd === 0) return '$0';
  if (usd < 0.01) return '$' + usd.toFixed(4);
  return '$' + usd.toFixed(2);
}

export function computeDiff(before, after) {
  if (before == null && after == null) return [];
  const a = (before || '').split(/\r?\n/);
  const b = (after || '').split(/\r?\n/);
  const result = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) {
      if (typeof a[i] !== 'undefined') result.push({ type: 'ctx', text: a[i] });
    } else {
      if (typeof a[i] !== 'undefined') result.push({ type: 'del', text: a[i] });
      if (typeof b[i] !== 'undefined') result.push({ type: 'add', text: b[i] });
    }
  }
  return result;
}

export function renderMarkdown(text) {
  if (!text) return '';
  let src = String(text).replace(/\r\n/g, '\n');

  // 1. Extract fenced code blocks first (replace with placeholders to avoid rule interference)
  const codeBlocks = [];
  src = src.replace(/```([a-zA-Z0-9+\-_]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: (lang || '').trim(), code });
    return ` CODEBLOCK${idx} `;
  });

  // 2. Extract inline code (replace with placeholders)
  const inlineCodes = [];
  src = src.replace(/`([^`\n]+?)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(code);
    return ` INLINE${idx} `;
  });

  // 3. Escape HTML on the remaining source
  src = escapeHtml(src);

  // 4. Headers (#### must come before ### etc.)
  src = src.replace(/^####\s+(.+)$/gm, '<h4 class="md-h">$1</h4>');
  src = src.replace(/^###\s+(.+)$/gm, '<h3 class="md-h">$1</h3>');
  src = src.replace(/^##\s+(.+)$/gm, '<h2 class="md-h">$1</h2>');
  src = src.replace(/^#\s+(.+)$/gm, '<h1 class="md-h">$1</h1>');

  // 5. Horizontal rule
  src = src.replace(/^[\s]*---+[\s]*$/gm, '<hr class="md-hr" />');

  // 6. Blockquote (&gt; because escapeHtml already ran)
  src = src.replace(/^&gt;\s?(.+)$/gm, '<blockquote class="md-quote">$1</blockquote>');

  // 7. Unordered lists — wrap consecutive - or * lines in <ul>
  src = src.replace(/(?:^(?:[-*])\s+.+(?:\n|$))+/gm, (block) => {
    const items = block.trim().split(/\n/).map(l => l.replace(/^[-*]\s+/, ''));
    return '<ul class="md-list">' + items.map(it => `<li>${it}</li>`).join('') + '</ul>';
  });

  // 8. Ordered lists — wrap consecutive N. lines in <ol>
  src = src.replace(/(?:^\d+\.\s+.+(?:\n|$))+/gm, (block) => {
    const items = block.trim().split(/\n/).map(l => l.replace(/^\d+\.\s+/, ''));
    return '<ol class="md-list">' + items.map(it => `<li>${it}</li>`).join('') + '</ol>';
  });

  // 9. Bold & italic (bold before italic to avoid ** being treated as italic)
  src = src.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  src = src.replace(/(?<!\*)\*(?!\*)([^\n*]+?)\*(?!\*)/g, '<em>$1</em>');
  src = src.replace(/(?<!_)_(?!_)([^\n_]+?)_(?!_)/g, '<em>$1</em>');

  // 10. Links (http/https scheme whitelist only)
  src = src.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // 11. Paragraphs — split on blank lines; wrap plain blocks in <p>
  const blocks = src.split(/\n\n+/).map(b => {
    const trimmed = b.trim();
    if (!trimmed) return '';
    // Already a block-level element
    if (/^<(h[1-6]|ul|ol|blockquote|pre|hr)/.test(trimmed)) return trimmed;
    // Lone code block placeholder
    if (/^CODEBLOCK\d+$/.test(trimmed)) return trimmed;
    return '<p class="md-p">' + trimmed.replace(/\n/g, '<br>') + '</p>';
  });
  src = blocks.join('');

  // 12. Restore placeholders
  src = src.replace(/CODEBLOCK(\d+)/g, (_, i) => {
    const { lang, code } = codeBlocks[Number(i)];
    const safeCode = escapeHtml(code);
    const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
    return `<pre class="md-code"${langAttr}><code>${safeCode}</code></pre>`;
  });
  src = src.replace(/INLINE(\d+)/g, (_, i) => {
    const code = inlineCodes[Number(i)];
    return `<code class="md-inline">${escapeHtml(code)}</code>`;
  });

  return src;
}

export function renderLogEntries(log) {
  if (!Array.isArray(log) || log.length === 0) return '';

  // STREAM skip indices: hide STREAM entries when their time matches a RESULT entry's time
  const skipIndices = new Set();
  const getEntryType = (e) => ((e && (e.type || e.label)) || '').toLowerCase();
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    if (entry && getEntryType(entry) === 'result' && entry.time) {
      for (let j = 0; j < log.length; j++) {
        const other = log[j];
        if (j !== i && other && getEntryType(other) === 'stream' && other.time === entry.time) {
          skipIndices.add(j);
        }
      }
    }
  }

  // Chronological — newest at bottom
  return log.map((entry, originalIdx) => {
    if (skipIndices.has(originalIdx)) return '';
    let type = 'info', time = '', text = '';
    if (typeof entry === 'string') {
      const m = /^\[?(START|ERROR|RESULT|USAGE|INFO|WARN)\]?\s*(\d{1,2}[:]\d{1,2}[:]\d{1,2})?\s*(.*)$/is.exec(entry);
      if (m) { type = m[1].toLowerCase(); time = m[2] || ''; text = m[3] || ''; }
      else { text = entry; }
    } else if (entry && typeof entry === 'object') {
      type = (entry.label || entry.type || 'info').toLowerCase();
      time = entry.time || entry.at || '';
      text = entry.body || entry.text || entry.message || entry.line || '';
    }

    // DIFF entry — parse and render as diff viewer
    if (type === 'diff') {
      let payload = null;
      try { payload = JSON.parse(text); } catch (e) {}
      if (!payload) return '';
      const before = payload.before || '';
      const after = payload.after || '';
      const filePath = payload.filePath || '';
      const lines = computeDiff(before, after);
      const diffHtml = lines.length === 0
        ? `<div class="diff-empty">변경 없음</div>`
        : lines.map(l => {
            const sign = l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' ';
            return `<div class="diff-line ${l.type}"><span class="sign">${sign}</span><span>${escapeHtml(l.text)}</span></div>`;
          }).join('');
      // base64 encode payload for safe attribute storage
      const payloadB64 = btoa(unescape(encodeURIComponent(JSON.stringify({ filePath, before, after }))));
      return `<div class="log-entry log-entry-diff" data-diff="${payloadB64}">
        <div class="log-entry-head">
          <span class="log-badge log-badge-diff">DIFF</span>
          ${time ? `<span class="log-time">${escapeHtml(time)}</span>` : ''}
        </div>
        <div class="log-diff-body">
          <div class="log-diff-path">
            ${escapeHtml(filePath)}
            <button class="log-diff-open" type="button" title="에디터에서 Diff 보기">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
              에디터
            </button>
          </div>
          <div class="diff-view">${diffHtml}</div>
        </div>
      </div>`;
    }

    const badgeClass = `log-badge log-badge-${type}`;
    const labelMap = {
      stream: 'STREAM',
      tool: 'TOOL',
      toolresult: 'TOOL',
      user: 'USER',
    };
    const badgeLabel = labelMap[type] || type.toUpperCase();
    // RESULT and STREAM entries render inline with markdown content as a flex item
    if (type === 'result' || type === 'stream') {
      return `<div class="log-entry log-entry-${type}">
        <div class="log-entry-head">
          <span class="${badgeClass}">${badgeLabel}</span>
          ${time ? `<span class="log-time">${escapeHtml(time)}</span>` : ''}
        </div>
        <div class="log-text log-markdown">${renderMarkdown(text)}</div>
      </div>`;
    }
    // All other types stay as plain text
    return `<div class="log-entry log-entry-${type}">
      <div class="log-entry-head">
        <span class="${badgeClass}">${badgeLabel}</span>
        ${time ? `<span class="log-time">${escapeHtml(time)}</span>` : ''}
      </div>
      <div class="log-text">${escapeHtml(text)}</div>
    </div>`;
  }).filter(Boolean).join('');
}

export function renderLogs(card) {
  const section = document.getElementById('logSection');
  const box = document.getElementById('logBox');
  const tokensLabel = document.getElementById('logTokens');
  if (!card.log || card.log.length === 0) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  tokensLabel.textContent = `${(card.tokens||0).toLocaleString()} tokens`;
  box.innerHTML = renderLogEntries(card.log);
}

export function _safeGet(key) {
  try { return localStorage.getItem(key); } catch (e) { console.warn('localStorage unavailable', e); return null; }
}

export function _safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { console.warn('localStorage unavailable', e); }
}

export function parseStreamLine(line, type) {
  const s = String(line || '');
  return { type: type || 'info', time: nowHMS(), text: s };
}

export function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function resolveEffectiveAuth(mode, cliOk, hasKey) {
  if (mode === 'cli') return cliOk ? 'cli' : null;
  if (mode === 'api') return hasKey ? 'api' : null;
  if (mode === 'auto') {
    if (cliOk) return 'cli';
    if (hasKey) return 'api';
    return null;
  }
  return null;
}

export function autoresizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
