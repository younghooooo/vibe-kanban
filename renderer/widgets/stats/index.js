// widgets/stats/index.js
import { state } from '../../app/state.js';
import { escapeHtml, formatTokens, formatCost, getWeekStart } from '../../shared/lib/utils.js';
import { getLabelColor } from '../../shared/config/index.js';

export let currentStatsPeriod = 'month';
export let currentStatsMetric = 'tokens';

export function getCardCost(card) {
  if (!Array.isArray(card.log)) return 0;
  let cost = 0;
  for (const entry of card.log) {
    if (entry && typeof entry === 'object' && entry.type === 'usage' && entry.meta && typeof entry.meta.cost === 'number') {
      cost += entry.meta.cost;
    }
  }
  return cost;
}

export function getCardRunCount(card) {
  if (!Array.isArray(card.log)) return 0;
  return card.log.filter(e => e && typeof e === 'object' && e.type === 'start').length;
}

export function computeTimeline(period) {
  const now = new Date();
  const buckets = [];

  if (period === 'days') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const label = i === 0 ? '오늘' : i === 1 ? '어제' : `${d.getMonth() + 1}/${d.getDate()}`;
      buckets.push({ label, start: d.getTime(), end: end.getTime(), tokens: 0, cost: 0, runs: 0, cardCount: 0, isCurrent: i === 0 });
    }
  } else if (period === 'week') {
    for (let i = 7; i >= 0; i--) {
      const ref = new Date(now);
      ref.setDate(ref.getDate() - i * 7);
      const weekStart = getWeekStart(ref);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const label = i === 0 ? '이번 주' : `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
      buckets.push({ label, start: weekStart.getTime(), end: weekEnd.getTime(), tokens: 0, cost: 0, runs: 0, cardCount: 0, isCurrent: i === 0 });
    }
  } else if (period === 'month') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const label = i === 0 ? '이번 달' : `${d.getMonth() + 1}월`;
      buckets.push({ label, start: d.getTime(), end: end.getTime(), tokens: 0, cost: 0, runs: 0, cardCount: 0, isCurrent: i === 0 });
    }
  } else {
    const startYear = now.getFullYear() - 4;
    for (let y = startYear; y <= now.getFullYear(); y++) {
      const label = y === now.getFullYear() ? '올해' : `${y}`;
      buckets.push({ label, start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime(), tokens: 0, cost: 0, runs: 0, cardCount: 0, isCurrent: y === now.getFullYear() });
    }
  }

  for (const card of state.cards) {
    const ts = card.createdAt || 0;
    const bucket = buckets.find(b => ts >= b.start && ts < b.end);
    if (bucket) {
      bucket.tokens += card.tokens || 0;
      bucket.cost += getCardCost(card);
      bucket.runs += getCardRunCount(card);
      bucket.cardCount += 1;
    }
  }
  for (const snap of (state.deletedCardSnapshots || [])) {
    const ts = snap.createdAt || 0;
    const bucket = buckets.find(b => ts >= b.start && ts < b.end);
    if (bucket) {
      bucket.tokens += snap.tokens || 0;
      bucket.cost += snap.cost || 0;
      bucket.runs += snap.runs || 0;
      bucket.cardCount += 1;
    }
  }
  return buckets;
}

export function computeByCategory() {
  const deleted = state.deletedCardSnapshots || [];
  return state.categories
    .map(cat => {
      const cards = state.cards.filter(c => c.category === cat.id);
      const snaps = deleted.filter(s => s.categoryId === cat.id);
      return {
        id: cat.id, name: cat.name,
        tokens: cards.reduce((s, c) => s + (c.tokens || 0), 0) + snaps.reduce((s, n) => s + (n.tokens || 0), 0),
        cost: cards.reduce((s, c) => s + getCardCost(c), 0) + snaps.reduce((s, n) => s + (n.cost || 0), 0),
        runs: cards.reduce((s, c) => s + getCardRunCount(c), 0) + snaps.reduce((s, n) => s + (n.runs || 0), 0),
        cardCount: cards.length,
        deletedCount: snaps.length,
      };
    })
    .filter(r => r.tokens > 0 || r.cardCount > 0)
    .sort((a, b) => b.tokens - a.tokens);
}

export function computeByLabel() {
  const deleted = state.deletedCardSnapshots || [];
  return state.labels
    .map(label => {
      const cards = state.cards.filter(c => c.labelId === label.id);
      const snaps = deleted.filter(s => s.labelId === label.id);
      return {
        id: label.id, name: label.name,
        color: getLabelColor(label.id),
        tokens: cards.reduce((s, c) => s + (c.tokens || 0), 0) + snaps.reduce((s, n) => s + (n.tokens || 0), 0),
        cost: cards.reduce((s, c) => s + getCardCost(c), 0) + snaps.reduce((s, n) => s + (n.cost || 0), 0),
        runs: cards.reduce((s, c) => s + getCardRunCount(c), 0) + snaps.reduce((s, n) => s + (n.runs || 0), 0),
        cardCount: cards.length,
        deletedCount: snaps.length,
      };
    })
    .filter(r => r.tokens > 0 || r.cardCount > 0)
    .sort((a, b) => b.tokens - a.tokens);
}

// ===== CHART =====

function fmtAxisVal(v, metric) {
  if (metric === 'tokens') {
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return Math.round(v / 1000) + 'k';
    return Math.round(v).toString();
  }
  if (metric === 'cost') {
    if (v >= 1) return '$' + v.toFixed(1);
    if (v >= 0.01) return '$' + v.toFixed(2);
    if (v > 0) return '$' + v.toFixed(3);
    return '$0';
  }
  if (v >= 1000) return Math.round(v / 1000) + 'k';
  return Math.round(v).toString();
}

function fmtTooltipVal(v, metric) {
  if (metric === 'tokens') return formatTokens(v);
  if (metric === 'cost') return formatCost(v);
  return v.toLocaleString();
}

function renderBarChart(timeline, metric) {
  const values = timeline.map(b => b[metric] || 0);
  const maxVal = Math.max(...values, 1);

  const W = 640, H = 220;
  const ml = 52, mt = 28, mr = 16, mb = 38;
  const cw = W - ml - mr;
  const ch = H - mt - mb;
  const n = timeline.length;
  const step = cw / n;
  const bw = Math.max(6, step * 0.58);

  let svg = '';

  // Y gridlines + labels (4 ticks)
  for (let i = 0; i <= 4; i++) {
    const frac = i / 4;
    const v = maxVal * frac;
    const y = (mt + ch - ch * frac).toFixed(1);
    svg += `<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="currentColor" stroke-opacity="0.07" stroke-width="1"/>`;
    svg += `<text x="${ml - 7}" y="${(parseFloat(y) + 3.5).toFixed(1)}" text-anchor="end" class="sc-axis">${fmtAxisVal(v, metric)}</text>`;
  }

  // Bars + labels
  const peakVal = Math.max(...values, 0);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    const bh = v > 0 ? Math.max(3, ch * v / maxVal) : 0;
    const cx = (ml + i * step + step / 2).toFixed(1);
    const bx = (ml + i * step + step / 2 - bw / 2).toFixed(1);
    const by = (mt + ch - bh).toFixed(1);
    const isCurrent = timeline[i].isCurrent;
    const isPeak = v > 0 && v === peakVal;

    svg += `<rect x="${bx}" y="${by}" width="${bw.toFixed(1)}" height="${Math.max(bh, 2).toFixed(1)}" rx="3" class="sc-bar${isCurrent ? ' sc-bar--cur' : ''}${v === 0 ? ' sc-bar--zero' : ''}"><title>${escapeHtml(timeline[i].label + ': ' + fmtTooltipVal(v, metric))}</title></rect>`;

    // Value label above current bar or peak bar
    if ((isCurrent || isPeak) && v > 0) {
      svg += `<text x="${cx}" y="${(parseFloat(by) - 6).toFixed(1)}" text-anchor="middle" class="sc-val-label${isCurrent ? ' sc-val-label--cur' : ''}">${escapeHtml(fmtTooltipVal(v, metric))}</text>`;
    }

    // X axis label
    svg += `<text x="${cx}" y="${H - 4}" text-anchor="middle" class="sc-axis${isCurrent ? ' sc-axis--cur' : ''}">${escapeHtml(timeline[i].label)}</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" class="stats-chart-svg" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
}

// ===== EXPORTS =====

export function showStats() {
  const bv = document.getElementById('boardView');
  const dv = document.getElementById('detailView');
  const sv = document.getElementById('statsView');
  if (bv) bv.hidden = true;
  if (dv) dv.hidden = true;
  if (sv) sv.hidden = false;
  renderStatsView();
}

export function setStatsPeriod(period) {
  currentStatsPeriod = period;
  renderStatsView();
}

export function setStatsMetric(metric) {
  currentStatsMetric = metric;
  renderStatsView();
}

export function renderStatsView() {
  const sv = document.getElementById('statsView');
  if (!sv) return;

  const deletedSnaps = state.deletedCardSnapshots || [];
  const totalTokens = state.totals.tokens || 0;
  const totalRuns = state.totals.runs || 0;
  const totalCards = state.cards.length;
  const deletedCount = deletedSnaps.length;
  const totalCost = state.cards.reduce((s, c) => s + getCardCost(c), 0)
    + deletedSnaps.reduce((s, n) => s + (n.cost || 0), 0);

  const timeline = computeTimeline(currentStatsPeriod);
  const byCategory = computeByCategory();
  const byLabel = computeByLabel();

  const maxCat = Math.max(...byCategory.map(r => r.tokens), 1);
  const maxLbl = Math.max(...byLabel.map(r => r.tokens), 1);

  const periodLabel = currentStatsPeriod === 'days' ? '최근 7일' : currentStatsPeriod === 'week' ? '주간' : currentStatsPeriod === 'month' ? '월간' : '연간';
  const metricLabels = { tokens: '토큰', cost: '비용', runs: '실행', cardCount: '카드 수' };

  sv.innerHTML = `
    <div class="stats-page">
      <div class="stats-header">
        <button onclick="showBoard()" class="btn btn-ghost detail-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          <span>보드</span>
        </button>
        <h1 class="stats-title">토큰 사용량 통계</h1>
      </div>

      <div class="stats-overview-grid">
        <div class="stats-card">
          <div class="stats-card-value">${formatTokens(totalTokens)}</div>
          <div class="stats-card-label">총 토큰</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-value">${formatCost(totalCost)}</div>
          <div class="stats-card-label">총 비용 (USD)</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-value">${totalRuns.toLocaleString()}</div>
          <div class="stats-card-label">총 실행 횟수</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-value">${totalCards.toLocaleString()}</div>
          <div class="stats-card-label">현재 작업 수</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-value stats-card-value--muted">${deletedCount.toLocaleString()}</div>
          <div class="stats-card-label">삭제된 작업</div>
        </div>
      </div>

      <div class="stats-chart-controls">
        <div class="stats-period-tabs">
          <button onclick="setStatsPeriod('days')" class="stats-tab ${currentStatsPeriod === 'days' ? 'is-active' : ''}">7일</button>
          <button onclick="setStatsPeriod('week')" class="stats-tab ${currentStatsPeriod === 'week' ? 'is-active' : ''}">주간</button>
          <button onclick="setStatsPeriod('month')" class="stats-tab ${currentStatsPeriod === 'month' ? 'is-active' : ''}">월간</button>
          <button onclick="setStatsPeriod('year')" class="stats-tab ${currentStatsPeriod === 'year' ? 'is-active' : ''}">연간</button>
        </div>
        <div class="stats-metric-tabs">
          ${Object.entries(metricLabels).map(([k, v]) =>
            `<button onclick="setStatsMetric('${k}')" class="stats-metric-tab ${currentStatsMetric === k ? 'is-active' : ''}">${v}</button>`
          ).join('')}
        </div>
      </div>

      <div class="stats-section">
        <div class="stats-section-header">
          <span class="stats-section-title">${periodLabel} ${metricLabels[currentStatsMetric]} 추이</span>
          <span class="stats-section-note">카드 생성일 기준 · 삭제된 카드 포함</span>
        </div>
        ${renderBarChart(timeline, currentStatsMetric)}
      </div>

      <div class="stats-breakdown-grid">
        <div class="stats-section">
          <div class="stats-section-header">
            <span class="stats-section-title">카테고리별</span>
          </div>
          ${byCategory.length === 0
            ? '<div class="stats-empty">데이터 없음</div>'
            : `<div class="stats-breakdown-list">${byCategory.map(r => `
              <div class="stats-breakdown-row">
                <div class="stats-breakdown-meta">
                  <span class="stats-breakdown-name">${escapeHtml(r.name)}</span>
                  <span class="stats-breakdown-sub">${r.cardCount}개${r.deletedCount > 0 ? ` +${r.deletedCount}삭제` : ''} · ${formatCost(r.cost)}</span>
                </div>
                <div class="stats-bar-wrap"><div class="stats-bar stats-bar--cat" style="width:${(r.tokens / maxCat * 100).toFixed(1)}%"></div></div>
                <span class="stats-breakdown-value">${formatTokens(r.tokens)}</span>
              </div>`).join('')}</div>`
          }
        </div>

        <div class="stats-section">
          <div class="stats-section-header">
            <span class="stats-section-title">라벨별</span>
          </div>
          ${byLabel.length === 0
            ? '<div class="stats-empty">데이터 없음</div>'
            : `<div class="stats-breakdown-list">${byLabel.map(r => `
              <div class="stats-breakdown-row">
                <div class="stats-breakdown-meta">
                  <span class="stats-breakdown-dot" style="background:${r.color.fg}"></span>
                  <span class="stats-breakdown-name">${escapeHtml(r.name)}</span>
                  <span class="stats-breakdown-sub">${r.cardCount}개${r.deletedCount > 0 ? ` +${r.deletedCount}삭제` : ''} · ${formatCost(r.cost)}</span>
                </div>
                <div class="stats-bar-wrap"><div class="stats-bar" style="width:${(r.tokens / maxLbl * 100).toFixed(1)}%;background:${r.color.fg}"></div></div>
                <span class="stats-breakdown-value">${formatTokens(r.tokens)}</span>
              </div>`).join('')}</div>`
          }
        </div>
      </div>
    </div>
  `;
}
