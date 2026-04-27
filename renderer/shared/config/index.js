// shared/config/index.js

export const DEFAULT_CATEGORIES = [
  { id: 'personal', name: '사생활',   folderId: null },
  { id: 'project',  name: '프로젝트', folderId: null },
  { id: 'study',    name: '공부',     folderId: null },
];

// 10색 팔레트 — 색상환 ~36° 간격으로 최대 분산 (인접 색상 혼동 방지)
export const LABEL_COLORS = [
  { bg: 'rgba(239, 68, 68, 0.28)',  fg: '#b91c1c', fgDark: '#f87171' },   // red      0°
  { bg: 'rgba(249, 115, 22, 0.28)', fg: '#c2410c', fgDark: '#fb923c' },   // orange   36°
  { bg: 'rgba(234, 179, 8, 0.28)',  fg: '#92400e', fgDark: '#fbbf24' },   // amber    72°
  { bg: 'rgba(34, 197, 94, 0.28)',  fg: '#15803d', fgDark: '#4ade80' },   // green   108°
  { bg: 'rgba(20, 184, 166, 0.28)', fg: '#0f766e', fgDark: '#2dd4bf' },   // teal    144°
  { bg: 'rgba(6, 182, 212, 0.28)',  fg: '#0e7490', fgDark: '#22d3ee' },   // cyan    180°
  { bg: 'rgba(59, 130, 246, 0.28)', fg: '#1d4ed8', fgDark: '#60a5fa' },   // blue    216°
  { bg: 'rgba(139, 92, 246, 0.28)', fg: '#6d28d9', fgDark: '#a78bfa' },   // violet  252°
  { bg: 'rgba(217, 70, 239, 0.28)', fg: '#86198f', fgDark: '#e879f9' },   // fuchsia 288°
  { bg: 'rgba(236, 72, 153, 0.28)', fg: '#9d174d', fgDark: '#f472b6' },   // pink    324°
];

export function hashLabelId(id) {
  const s = String(id || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function getLabelColor(labelId) {
  const idx = hashLabelId(labelId) % LABEL_COLORS.length;
  return LABEL_COLORS[idx];
}

export const MODEL_PRICES = {
  'claude-opus-4-7':   { in: 15, out: 75, label: 'Opus 4.7' },
  'claude-sonnet-4-6': { in: 3,  out: 15, label: 'Sonnet 4.6' },
  'claude-haiku-4-5':  { in: 1,  out: 5,  label: 'Haiku 4.5' },
};

// Auto-compact thresholds
// 20 turns: each user turn appends one type:'user' log entry; beyond 20 the context
// grows large enough that compaction pays for itself.
export const AUTO_COMPACT_TURN_THRESHOLD = 20;
// 30 min idle: Anthropic prompt cache TTL is 5 min, so 30 min guarantees a full
// cache miss. Compacting before a cold resume avoids re-uploading stale history.
export const AUTO_COMPACT_IDLE_MS = 30 * 60 * 1000;
