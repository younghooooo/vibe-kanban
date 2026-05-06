// features/auth/template.js
export function getAuthModalHTML() {
  return `
<dialog class="modal" id="authModal">
  <div class="modal-box max-w-2xl border shadow-2xl p-0">
    <header class="flex items-center justify-between px-6 py-4 border-b">
      <div>
        <h3 class="text-xl font-semibold">인증 설정</h3>
        <p class="text-xs opacity-60 mt-0.5">AI를 실행하려면 두 방식 중 하나를 선택하세요</p>
      </div>
      <button onclick="closeAuthModal()" class="btn btn-ghost btn-sm btn-icon">✕</button>
    </header>

    <div class="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
      <div class="rounded-xl border overflow-hidden">
        <div class="flex items-start justify-between p-5">
          <div class="flex items-start gap-3">
            <div class="h-10 w-10 rounded-lg border flex items-center justify-center flex-shrink-0">
              <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            </div>
            <div>
              <h4 class="font-semibold text-base">Claude Code 구독 사용</h4>
              <p class="text-sm opacity-60 mt-0.5">Pro/Max 구독이 있으면 추가 비용 없음</p>
            </div>
          </div>
          <span class="badge badge-sm" id="cliBadge">확인 중</span>
        </div>
        <div class="px-5 pb-5 space-y-3">
          <div class="rounded-lg border px-4 py-3 text-sm" id="cliStep">CLI 감지 중...</div>
          <div class="flex flex-wrap gap-2">
            <button onclick="recheckCLI()" class="btn btn-sm btn-ghost">↻ 다시 감지</button>
            <button onclick="openClaudeInstall()" class="btn btn-sm btn-ghost">설치 가이드 →</button>
            <button id="useCliBtn" onclick="selectAuthMode('cli')" class="btn btn-sm btn-primary border-0 font-semibold ml-auto" disabled>
              이 방식 사용
            </button>
          </div>
          <details class="text-xs">
            <summary class="cursor-pointer opacity-60 hover:opacity-100">작동 원리 보기</summary>
            <ol class="mt-3 space-y-1.5 opacity-70 pl-4 list-decimal">
              <li><code class="border px-1.5 py-0.5 rounded font-mono">npm i -g @anthropic-ai/claude-code</code></li>
              <li>터미널에서 <code class="border px-1.5 py-0.5 rounded font-mono">claude</code> 실행 → 브라우저 로그인</li>
              <li>이 앱에서 "다시 감지" 클릭</li>
              <li>RUN 누르면 내부적으로 CLI 호출 → 본인 구독 사용</li>
            </ol>
          </details>
        </div>
      </div>

      <div class="rounded-xl border overflow-hidden">
        <div class="flex items-start justify-between p-5">
          <div class="flex items-start gap-3">
            <div class="h-10 w-10 rounded-lg border flex items-center justify-center flex-shrink-0">
              <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v2h-2V7zm0 4h2v6h-2v-6z"/></svg>
            </div>
            <div>
              <h4 class="font-semibold text-base">API 키 직접 입력</h4>
              <p class="text-sm opacity-60 mt-0.5">사용량만큼 과금. 구독 없어도 OK</p>
            </div>
          </div>
          <span class="badge badge-sm" id="apiBadge">미설정</span>
        </div>
        <div class="px-5 pb-5 space-y-3">
          <input type="password" id="apiKeyInput"
            class="input w-full font-mono text-sm"
            placeholder="sk-ant-..."
            autocomplete="new-password" />
          <p class="text-[11px] opacity-50">OS 키체인에 암호화되어 저장됩니다.</p>
          <div class="flex flex-wrap gap-2">
            <button onclick="openApiKeys()" class="btn btn-sm btn-ghost">키 발급 →</button>
            <button id="clearKeyBtn" onclick="clearApiKey()" class="btn btn-sm btn-ghost text-red-500 hidden">키 삭제</button>
            <button id="useApiBtn" onclick="selectAuthMode('api')" class="btn btn-sm btn-primary border-0 font-semibold ml-auto" disabled>
              이 방식 사용
            </button>
          </div>
        </div>
      </div>

      <div class="rounded-xl border p-5">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-start gap-3">
            <div class="h-10 w-10 rounded-lg border flex items-center justify-center flex-shrink-0">
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
            </div>
            <div>
              <h4 class="font-semibold text-base">자동 모드</h4>
              <p class="text-sm opacity-60 mt-0.5">CLI 먼저 시도, 실패 시 API로 자동 전환</p>
            </div>
          </div>
          <button onclick="selectAuthMode('auto')" class="btn btn-sm btn-primary border-0 font-semibold">선택</button>
        </div>
      </div>

      <div class="text-center text-xs opacity-50 pt-2" id="authCurrent"></div>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>`;
}
