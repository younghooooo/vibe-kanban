// features/github-sync/template.js
export function getGhModalsHTML() {
  return `
<dialog class="modal" id="ghConnectModal">
  <div class="modal-box max-w-md border shadow-2xl p-0">
    <header class="flex items-center justify-between px-5 py-3 border-b">
      <h3 class="text-base font-semibold">GitHub 연결 <span id="ghConnectCatName" class="opacity-60 text-sm font-normal"></span></h3>
      <button onclick="closeGhConnectModal()" class="btn btn-ghost btn-sm btn-icon" aria-label="Close">✕</button>
    </header>
    <div class="p-5 space-y-4">
      <div id="ghConnectPatRow" class="space-y-1.5">
        <label class="text-xs opacity-70">Personal Access Token <span class="opacity-50">(scope: repo)</span></label>
        <div class="flex gap-2">
          <input type="password" id="ghConnectPatInput" class="input flex-1 font-mono text-sm" placeholder="ghp_..." autocomplete="off" />
          <button type="button" id="ghConnectPatConfirm" onclick="confirmGhPat()" class="btn btn-sm btn-primary border-0 font-semibold">확인</button>
        </div>
        <a href="#" id="ghConnectPatLink" class="text-[11px] opacity-60 hover:opacity-100">토큰 생성하기 →</a>
        <p id="ghConnectPatStatus" class="text-[11px] opacity-60" hidden></p>
      </div>
      <div id="ghConnectOwnerRow" class="space-y-1.5" hidden>
        <label class="text-xs opacity-70">Owner (사용자 또는 Organization login)</label>
        <div class="flex gap-2">
          <input type="text" id="ghConnectOwnerInput" class="input flex-1 font-mono text-sm" placeholder="예: AGMO-Inc" autocomplete="off" />
          <button type="button" onclick="loadProjectsForOwner()" class="btn btn-sm btn-primary border-0 font-semibold">Project 불러오기</button>
        </div>
      </div>
      <div id="ghConnectProjectRow" class="space-y-1.5" hidden>
        <label class="text-xs opacity-70">Project 선택</label>
        <div class="flex gap-2">
          <select id="ghConnectProjectSelect" class="input flex-1 font-mono text-sm">
            <option value="">불러오는 중…</option>
          </select>
          <button type="button" onclick="confirmGhProjectConnect()" class="btn btn-sm btn-primary border-0 font-semibold">연결</button>
        </div>
      </div>
      <div>
        <div class="text-xs opacity-70 mb-1.5">연결된 Project</div>
        <ul id="ghConnectRepoList" class="flex flex-wrap gap-1.5 text-xs font-mono"></ul>
      </div>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>

<dialog class="modal" id="ghRegisterModal">
  <div class="modal-box max-w-md border shadow-2xl p-0">
    <header class="flex items-center justify-between px-5 py-3 border-b">
      <h3 class="text-base font-semibold">GitHub 이슈로 등록</h3>
      <button onclick="closeGhRegisterModal()" class="btn btn-ghost btn-sm btn-icon" aria-label="Close">✕</button>
    </header>
    <div class="p-5 space-y-3">
      <p class="text-xs opacity-70">선택한 저장소에 새 이슈를 만들고, 카테고리에 연결된 Project에 추가합니다. 현재 컬럼이 Status로 매핑됩니다.</p>
      <div class="space-y-1.5">
        <label class="text-xs opacity-70">저장소</label>
        <select id="ghRegisterRepoSelect" class="input w-full font-mono text-sm">
          <option value="">불러오는 중…</option>
        </select>
      </div>
      <div class="flex justify-end gap-2 pt-1">
        <button class="btn btn-ghost btn-sm" onclick="closeGhRegisterModal()">취소</button>
        <button class="btn btn-primary btn-sm border-0 font-semibold" onclick="confirmGhRegister()">등록</button>
      </div>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>

<dialog class="modal" id="ghPushConfirmModal">
  <div class="modal-box max-w-sm border shadow-2xl p-0">
    <header class="px-5 py-3 border-b">
      <h3 class="text-base font-semibold">GitHub 이슈 수정</h3>
    </header>
    <div class="p-5 space-y-3">
      <p class="text-sm" id="ghPushConfirmMsg">GitHub 이슈를 수정할까요?</p>
      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" onclick="rejectGhPush()">취소</button>
        <button class="btn btn-primary btn-sm border-0 font-semibold" onclick="approveGhPush()">확인</button>
      </div>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>`;
}
