// entities/card/index.js

export function uid() { return 'c_' + Math.random().toString(36).slice(2, 9); }
export function catUid() { return 'cat_' + Math.random().toString(36).slice(2, 7); }

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
