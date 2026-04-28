// shared/lib/github-api.js
// GitHub REST v3 fetch wrapper. PAT is passed in per call — never cached.

const BASE = 'https://api.github.com';

function headers(pat) {
  if (!pat) throw new Error('GitHub PAT is required');
  return {
    'Authorization': `Bearer ${pat}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function request(pat, path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers(pat), ...(init.headers || {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      if (body && body.message) msg = body.message;
    } catch (_) {}
    const err = new Error(`GitHub API ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function listAssignedIssues(pat, owner, repo, { state = 'all' } = {}) {
  const q = `assignee=@me&state=${encodeURIComponent(state)}&per_page=100`;
  const data = await request(pat, `/repos/${owner}/${repo}/issues?${q}`);
  return (data || []).filter(i => !i.pull_request);
}

export async function updateIssueState(pat, owner, repo, issueNumber, state) {
  return request(pat, `/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
}

export async function getCurrentUser(pat) {
  const data = await request(pat, '/user');
  return data.login;
}
