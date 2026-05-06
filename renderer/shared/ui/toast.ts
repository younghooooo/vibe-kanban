// shared/ui/toast.js

const __toastContainer = () => document.getElementById('toastContainer');

export function showToast({ kind = 'info', title, body = '', actions = [], duration = 4500, id = null, onToastClick = null }) {
  const container = __toastContainer();
  if (!container) return;

  // Prevent duplicates: replace existing toast with same id
  if (id) {
    const existing = container.querySelector(`[data-toast-id="${id}"]`);
    if (existing) existing.remove();
  }

  const toastEl = document.createElement('div');
  toastEl.className = `toast toast-${kind}`;
  if (id) toastEl.setAttribute('data-toast-id', id);

  const escapeHtml = (str) => String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  toastEl.innerHTML = `
    <div class="toast-left">
      <div class="toast-title">${escapeHtml(title || '')}</div>
      ${body ? `<div class="toast-body">${escapeHtml(body)}</div>` : ''}
    </div>
    ${actions.length ? `<div class="toast-actions"></div>` : ''}
  `;

  function dismiss() {
    toastEl.classList.add('is-leaving');
    setTimeout(() => toastEl.remove(), 220);
  }

  toastEl.addEventListener('click', (e) => {
    if (!e.target.closest('.toast-action-btn')) {
      if (onToastClick) onToastClick();
      dismiss();
    }
  });

  if (actions.length) {
    const actionsEl = toastEl.querySelector('.toast-actions');
    const primary = actions.find(a => a.primary) || actions[0];
    const btn = document.createElement('button');
    btn.className = 'toast-action-btn';
    btn.type = 'button';
    btn.textContent = primary.label;
    btn.addEventListener('click', () => {
      try { primary.onClick && primary.onClick(); } catch (e) {}
      dismiss();
    });
    actionsEl.appendChild(btn);
  }

  container.appendChild(toastEl);

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }

  return { el: toastEl, dismiss };
}

// Legacy wrapper
export function toast(msg, type = '') {
  const wrap = document.getElementById('toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'alert ' + (type === 'success' ? 'alert-success' : type === 'error' ? 'alert-error' : '');
  el.innerHTML = `<span>${String(msg || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// expose __toastContainer for use in card-detail pending resolved handler
export { __toastContainer };
