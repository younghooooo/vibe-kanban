// shared/lib/theme.js
import { _safeGet, _safeSet } from './utils.js';

export function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
}

export function toggleTheme() {
  var isDark = document.documentElement.classList.contains('dark');
  var next = isDark ? 'light' : 'dark';
  applyTheme(next);
  _safeSet('vk:theme', next);
}

export function applySidebar(st) {
  var s = st === 'closed' ? 'closed' : 'open';
  document.body.setAttribute('data-sidebar', s);
  document.documentElement.setAttribute('data-sidebar', s);
}

export function toggleSidebar() {
  var current = document.body.getAttribute('data-sidebar') || document.documentElement.getAttribute('data-sidebar') || 'open';
  var next = current === 'open' ? 'closed' : 'open';
  applySidebar(next);
  _safeSet('vk:sidebar', next);
}

export function initThemeAndSidebar() {
  // initial theme (FOUC script may have already set it, fallback if not stored)
  var storedTheme = _safeGet('vk:theme');
  if (!storedTheme) {
    var prefersDark = false;
    try { prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) {}
    storedTheme = prefersDark ? 'dark' : 'light';
    _safeSet('vk:theme', storedTheme);
  }
  applyTheme(storedTheme);

  // initial sidebar: sync documentElement -> body
  var storedSidebar = _safeGet('vk:sidebar') || document.documentElement.getAttribute('data-sidebar') || 'open';
  applySidebar(storedSidebar);

  // button event binding
  var sbBtn = document.getElementById('sidebar-toggle');
  if (sbBtn && !sbBtn.dataset.bound) {
    sbBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleSidebar();
    });
    sbBtn.dataset.bound = '1';
  }

  var thBtn = document.getElementById('theme-toggle');
  if (thBtn && !thBtn.dataset.bound) {
    thBtn.addEventListener('click', toggleTheme);
    thBtn.dataset.bound = '1';
  }
}

export function initMoreMenu() {
  var wrap = document.getElementById('moreMenu');
  var btn = document.getElementById('moreMenuBtn');
  if (!wrap || !btn) return;
  function close() { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
  function open() { wrap.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (wrap.classList.contains('open')) close(); else open();
  });
  document.addEventListener('click', function (e) {
    if (!wrap.contains(e.target)) close();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  // close on menu item click
  wrap.querySelectorAll('.dropdown-content a, .dropdown-content button').forEach(function (el) {
    el.addEventListener('click', close);
  });
}
