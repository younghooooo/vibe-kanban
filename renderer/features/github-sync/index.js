// features/github-sync/index.js
import { state, persist } from '../../app/state.js';
import { getPAT } from '../../shared/lib/github-pat.js';
import { listAssignedIssues, updateIssueState } from '../../shared/lib/github-api.js';
import { findCardByIssue, buildCardFromIssue } from '../../entities/card/index.js';
import { getCategoryRepos } from '../../entities/category/index.js';
import { showToast } from '../../shared/ui/toast.js';

export async function syncCategory(catId) {
  const pat = getPAT();
  if (!pat) return { skipped: true, reason: 'no-pat' };

  const repos = getCategoryRepos(catId);
  if (!repos.length) return { ok: true, fetched: 0, created: 0, updated: 0 };

  let fetched = 0, created = 0, updated = 0;

  for (const { owner, repo } of repos) {
    let issues;
    try {
      issues = await listAssignedIssues(pat, owner, repo);
    } catch (err) {
      showToast({ kind: 'error', title: 'GitHub fetch 실패', body: `${owner}/${repo}: ${err.message}` });
      continue;
    }
    for (const issue of issues) {
      fetched++;
      const existing = findCardByIssue(owner, repo, issue.number);
      if (!existing) {
        state.cards.push(buildCardFromIssue(issue, owner, repo, catId));
        created++;
      } else {
        // remote wins
        existing.title = issue.title;
        existing.desc = issue.body || existing.desc;
        existing.github = existing.github || {};
        existing.github.state = issue.state;
        existing.github.updatedAt = issue.updated_at;
        existing.github.htmlUrl = issue.html_url;
        if (issue.state === 'closed') {
          existing.status = 'done';
        } else if (existing.status === 'done') {
          existing.status = 'todo';
        }
        updated++;
      }
    }
  }

  await persist();
  if (typeof window.renderColumns === 'function') window.renderColumns();
  return { ok: true, fetched, created, updated };
}

export async function pushCardChange(card, { prevStatus } = {}) {
  if (!card || !card.github) return;
  const pat = getPAT();
  if (!pat) return;

  const { owner, repo, issueNumber } = card.github;
  const wasDone = prevStatus === 'done';
  const isDone = card.status === 'done';
  if (wasDone === isDone) return;

  const newState = isDone ? 'closed' : 'open';
  try {
    await updateIssueState(pat, owner, repo, issueNumber, newState);
    card.github.state = newState;
    await persist();
  } catch (err) {
    showToast({ kind: 'error', title: 'GitHub 동기화 실패', body: err.message });
  }
}

export async function syncAll() {
  const pat = getPAT();
  if (!pat) return;

  let total = 0, created = 0, updated = 0;
  for (const cat of state.categories) {
    const res = await syncCategory(cat.id);
    if (res && res.ok) {
      total += res.fetched;
      created += res.created;
      updated += res.updated;
    }
  }
  if (total > 0) {
    showToast({
      kind: 'success',
      title: 'GitHub 동기화 완료',
      body: `${total}개 이슈 (신규 ${created}, 갱신 ${updated})`,
    });
  }
}
