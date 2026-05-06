// entities/label/template.js
export function getLabelModalHTML() {
  return `
<dialog class="modal label-modal" id="labelModal">
  <div class="modal-box label-modal-box">
    <button type="button" class="btn btn-icon label-close-float" onclick="closeLabelModal()" aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
    <div class="label-modal-body">
      <ul id="labelList" class="label-list"></ul>
      <div class="label-add-row">
        <input type="text" id="newLabelName" class="input-inline" placeholder="새 라벨 이름" autocomplete="off" />
        <button type="button" id="newLabelPick" class="btn btn-ghost btn-sm">경로 선택</button>
        <button type="button" id="newLabelAdd" class="btn btn-primary btn-sm">추가</button>
      </div>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>`;
}
