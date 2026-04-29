// entities/card/index.js
import { state } from '../../app/state.js';
import { statusNameToColumn } from '../../shared/config/index.js';

export function uid() { return 'c_' + Math.random().toString(36).slice(2, 9); }
export function catUid() { return 'cat_' + Math.random().toString(36).slice(2, 7); }

export function findCardByIssue(owner, repo, issueNumber) {
  return state.cards.find(c =>
    c.github &&
    c.github.owner === owner &&
    c.github.repo === repo &&
    c.github.issueNumber === issueNumber
  ) || null;
}

export function findCardByProjectItem(projectId, itemId) {
  return state.cards.find(c =>
    c.github && c.github.projectId === projectId && c.github.projectItemId === itemId
  ) || null;
}

export function buildCardFromProjectItem(item, categoryId, projectId) {
  const { issue, statusName, statusOptionId, itemId } = item;
  const column = statusNameToColumn(statusName);
  return {
    id: uid(),
    title: issue.title,
    desc: issue.body || '',
    doc: '',
    docUpdatedAt: 0,
    docUpdatedBy: 'user',
    docHistory: [],
    category: categoryId,
    priority: 'med',
    status: column,
    progress: column === 'done' ? 100 : 0,
    tokens: 0,
    log: [],
    createdAt: Date.now(),
    github: {
      projectId,
      projectItemId: itemId,
      statusName,
      statusOptionId,
      issueNumber: issue.number,
      owner: issue.owner,
      repo: issue.repo,
      state: issue.state,
      htmlUrl: issue.url,
      updatedAt: issue.updatedAt,
    },
  };
}

export function sampleCards() {
  return [
    {
      id: uid(), title: '이번 주 운동 계획 짜기',
      desc: '주 5회, 유산소 2 + 근력 3. 기구 없이 집에서. 요일별 30분 내외 루틴.',
      category: 'personal', priority: 'med', status: 'todo',
      progress: 0, tokens: 0, log: [], createdAt: Date.now()
    },
    {
      id: uid(), title: 'MVP 기능 명세 정리',
      desc: '현재 아이디어를 기능 단위로 쪼개고, 핵심/부가 기능으로 분류.',
      category: 'project', priority: 'high', status: 'todo',
      progress: 0, tokens: 0, log: [], createdAt: Date.now()
    },
    {
      id: uid(), title: 'React Hook 핵심 정리',
      desc: 'useState, useEffect, useMemo, useCallback, useRef의 쓰임과 흔한 실수.',
      category: 'study', priority: 'med', status: 'todo',
      progress: 0, tokens: 0, log: [], createdAt: Date.now()
    },
  ];
}
