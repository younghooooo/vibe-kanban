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

let _cachedLogin = null;
async function resolveLogin(pat) {
  if (_cachedLogin) return _cachedLogin;
  const data = await request(pat, '/user');
  _cachedLogin = data.login;
  return _cachedLogin;
}

export async function listAssignedIssues(pat, owner, repo, { state = 'all', assignee } = {}) {
  const login = assignee || await resolveLogin(pat);
  const q = `assignee=${encodeURIComponent(login)}&state=${encodeURIComponent(state)}&per_page=100`;
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

// ===== GraphQL =====

async function gql(pat, query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      ...headers(pat),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    const msg = (json.errors && json.errors[0]?.message) || res.statusText;
    const err = new Error(`GitHub GraphQL: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json.data;
}

// Try organization first, then user. Owner type is unknown to caller.
export async function listProjectsForOwner(pat, login) {
  const q = `query($login:String!){
    organization(login:$login){ projectsV2(first:50, orderBy:{field:UPDATED_AT, direction:DESC}){ nodes{ id number title closed } } }
    user(login:$login){ projectsV2(first:50, orderBy:{field:UPDATED_AT, direction:DESC}){ nodes{ id number title closed } } }
  }`;
  let data;
  try {
    data = await gql(pat, q, { login });
  } catch (err) {
    // Either org or user might 404; try them individually
    data = {};
    try {
      const od = await gql(pat, `query($login:String!){ organization(login:$login){ projectsV2(first:50){ nodes{ id number title closed } } } }`, { login });
      data.organization = od.organization;
    } catch (_) {}
    try {
      const ud = await gql(pat, `query($login:String!){ user(login:$login){ projectsV2(first:50){ nodes{ id number title closed } } } }`, { login });
      data.user = ud.user;
    } catch (_) {}
  }
  const orgNodes = data.organization?.projectsV2?.nodes || [];
  const userNodes = data.user?.projectsV2?.nodes || [];
  const seen = new Set();
  const all = [];
  for (const n of [...orgNodes, ...userNodes]) {
    if (!n || seen.has(n.id) || n.closed) continue;
    seen.add(n.id);
    all.push(n);
  }
  return all;
}

// Returns { id, statusFieldId, statusOptions: [{id, name}] }
export async function getProjectMeta(pat, projectId) {
  const q = `query($id:ID!){
    node(id:$id){
      ... on ProjectV2 {
        id title number
        field(name:"Status"){
          ... on ProjectV2SingleSelectField { id name options { id name } }
        }
      }
    }
  }`;
  const data = await gql(pat, q, { id: projectId });
  const node = data.node;
  if (!node) throw new Error('Project not found');
  const f = node.field;
  if (!f || !f.options) throw new Error('Project has no Status field');
  return {
    id: node.id,
    title: node.title,
    number: node.number,
    statusFieldId: f.id,
    statusOptions: f.options.map(o => ({ id: o.id, name: o.name })),
  };
}

// Returns array of { itemId, statusName, statusOptionId, issue: { number, title, body, state, url, owner, repo, nodeId } }
// Filtered to items assigned to `assigneeLogin` (or all if not provided).
export async function listProjectItemsForAssignee(pat, projectId, assigneeLogin) {
  const all = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const q = `query($id:ID!, $cursor:String){
      node(id:$id){
        ... on ProjectV2 {
          items(first:100, after:$cursor){
            pageInfo{ hasNextPage endCursor }
            nodes{
              id
              fieldValueByName(name:"Status"){
                ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
              }
              content{
                __typename
                ... on Issue {
                  id number title body state url
                  assignees(first:10){ nodes{ login } }
                  repository{ name owner{ login } }
                  updatedAt
                }
              }
            }
          }
        }
      }
    }`;
    const data = await gql(pat, q, { id: projectId, cursor });
    const items = data.node?.items;
    if (!items) break;
    for (const it of items.nodes || []) {
      const c = it.content;
      if (!c || c.__typename !== 'Issue') continue;
      if (assigneeLogin) {
        const assignees = c.assignees?.nodes?.map(a => a.login) || [];
        if (!assignees.includes(assigneeLogin)) continue;
      }
      all.push({
        itemId: it.id,
        statusName: it.fieldValueByName?.name || '',
        statusOptionId: it.fieldValueByName?.optionId || '',
        issue: {
          nodeId: c.id,
          number: c.number,
          title: c.title,
          body: c.body || '',
          state: c.state ? c.state.toLowerCase() : 'open',
          url: c.url,
          owner: c.repository?.owner?.login || '',
          repo: c.repository?.name || '',
          updatedAt: c.updatedAt,
        },
      });
    }
    if (!items.pageInfo?.hasNextPage) break;
    cursor = items.pageInfo.endCursor;
  }
  return all;
}

export async function createIssue(pat, owner, repo, { title, body, assignee }) {
  return request(pat, `/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, assignees: assignee ? [assignee] : undefined }),
  });
}

export async function addProjectV2Item(pat, projectId, contentNodeId) {
  const q = `mutation($p:ID!, $c:ID!){
    addProjectV2ItemById(input:{projectId:$p, contentId:$c}){ item{ id } }
  }`;
  const data = await gql(pat, q, { p: projectId, c: contentNodeId });
  return data.addProjectV2ItemById?.item?.id;
}

export async function updateProjectItemStatus(pat, projectId, itemId, fieldId, optionId) {
  const q = `mutation($p:ID!, $i:ID!, $f:ID!, $v:ProjectV2FieldValue!){
    updateProjectV2ItemFieldValue(input:{ projectId:$p, itemId:$i, fieldId:$f, value:$v }){
      projectV2Item{ id }
    }
  }`;
  return gql(pat, q, { p: projectId, i: itemId, f: fieldId, v: { singleSelectOptionId: optionId } });
}

export async function listUserRepos(pat, { perPage = 100, maxPages = 5 } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await request(pat, `/user/repos?per_page=${perPage}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`);
    if (!Array.isArray(data) || data.length === 0) break;
    for (const r of data) {
      all.push({
        owner: r.owner?.login || '',
        repo: r.name,
        fullName: r.full_name,
        private: r.private,
        updatedAt: r.updated_at,
      });
    }
    if (data.length < perPage) break;
  }
  return all;
}
