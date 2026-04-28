// widgets/doc-editor/index.js
// Tiptap-based notion-style live Markdown editor.
// Loads Tiptap lazily via ESM importmap so renderer boot stays fast.

let _editor = null;
let _onChange = null;
let _saveTimer = null;
let _loadingPromise = null;

async function loadTiptap() {
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    const [core, sk, tl, ti, ph, cbl, lowMod, mdMod] = await Promise.all([
      import('@tiptap/core'),
      import('@tiptap/starter-kit'),
      import('@tiptap/extension-task-list'),
      import('@tiptap/extension-task-item'),
      import('@tiptap/extension-placeholder'),
      import('@tiptap/extension-code-block-lowlight'),
      import('lowlight'),
      import('tiptap-markdown'),
    ]);
    const createLowlight = lowMod.createLowlight || (lowMod.default && lowMod.default.createLowlight);
    const common = lowMod.common || (lowMod.default && lowMod.default.common);
    const lowlight = createLowlight(common);
    return {
      Editor: core.Editor,
      StarterKit: sk.default || sk.StarterKit,
      TaskList: tl.default || tl.TaskList,
      TaskItem: ti.default || ti.TaskItem,
      Placeholder: ph.default || ph.Placeholder,
      CodeBlockLowlight: cbl.default || cbl.CodeBlockLowlight,
      lowlight,
      Markdown: mdMod.Markdown || mdMod.default,
    };
  })();
  return _loadingPromise;
}

export async function mountDocEditor(el, { initial = '', readOnly = false, onChange, placeholder = '' } = {}) {
  if (!el) return null;
  if (_editor) { try { _editor.destroy(); } catch {} _editor = null; }
  _onChange = onChange || null;

  const T = await loadTiptap();
  _editor = new T.Editor({
    element: el,
    editable: !readOnly,
    extensions: [
      T.StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false, // replaced by CodeBlockLowlight below
      }),
      T.CodeBlockLowlight.configure({
        lowlight: T.lowlight,
        defaultLanguage: null,
        HTMLAttributes: { class: 'hljs doc-code-block' },
      }),
      T.TaskList,
      T.TaskItem.configure({ nested: true }),
      T.Placeholder.configure({ placeholder: placeholder || '# 제목을 입력하거나 본문을 적어보세요…' }),
      T.Markdown.configure({
        html: false,
        breaks: true,
        transformPastedText: true,
        transformCopiedText: true,
        tightLists: true,
        bulletListMarker: '-',
        linkify: true,
      }),
    ],
    content: initial || '',
    onUpdate({ editor }) {
      if (!_onChange) return;
      if (_saveTimer) clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => {
        try {
          const md = editor.storage.markdown.getMarkdown();
          _onChange(md);
        } catch (e) { console.warn('doc onChange failed', e); }
      }, 400);
    },
  });
  return _editor;
}

export function setDocMarkdown(md, { force = false } = {}) {
  if (!_editor) return;
  if (!force && _editor.isFocused) return;
  try {
    const cur = _editor.storage.markdown.getMarkdown();
    if (cur === (md || '')) return;
    _editor.commands.setContent(md || '', false);
  } catch (e) { console.warn('setDocMarkdown failed', e); }
}

export function getDocMarkdown() {
  if (!_editor) return '';
  try { return _editor.storage.markdown.getMarkdown(); } catch { return ''; }
}

export function setDocReadOnly(ro) {
  if (!_editor) return;
  try { _editor.setEditable(!ro); } catch {}
}

export function isDocFocused() {
  return !!_editor && _editor.isFocused;
}

export function isDocMounted() {
  return !!_editor;
}

export function destroyDocEditor() {
  if (_editor) { try { _editor.destroy(); } catch {} _editor = null; }
  _onChange = null;
}
