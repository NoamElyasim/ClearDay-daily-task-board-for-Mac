// The notes editor: rich text in a contenteditable, with a small side menu
// (bold, underline, strikethrough, text size) and bullet points that carry
// on with Enter.
//
// A note is saved twice: as cleaned HTML (notesHtml, only the tags below
// survive) for the formatting, and as plain text (notes) for search, the
// notes dot and Claude.
import { ICONS } from './icons.js';
import { openPopover } from './popover.js';

const SIZES = [
  ['s', 'Small'], ['', 'Normal'], ['l', 'Large'], ['xl', 'Title'],
];
// execCommand('fontSize') sizes 1–7 → our classes, for pasted or old markup.
const FONT_SIZE_CLASS = { 1: 's', 2: 's', 3: '', 4: 'l', 5: 'l', 6: 'xl', 7: 'xl' };

// ─── Cleaning ────────────────────────────────────────────────────────────────
const KEEP = { B: 'b', STRONG: 'b', U: 'u', S: 's', STRIKE: 's', DEL: 's', UL: 'ul', LI: 'li', BR: 'br', DIV: 'div', P: 'div' };

function cleanInto(src, out) {
  for (const node of src.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) { out.append(node.textContent); continue; }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    let tag = KEEP[node.tagName];
    let size = '';
    if (node.tagName === 'SPAN' && /\bfs-(s|l|xl)\b/.test(node.className)) size = node.className.match(/\bfs-(s|l|xl)\b/)[1];
    if (node.tagName === 'FONT') size = FONT_SIZE_CLASS[node.getAttribute('size')] ?? '';
    if (node.tagName === 'SPAN' || node.tagName === 'FONT') tag = size ? 'span' : null;
    if (node.tagName === 'SPAN' && /font-weight:\s*(bold|[6-9]00)/.test(node.getAttribute('style') || '')) tag = 'b';
    if (!tag) { cleanInto(node, out); continue; }          // unwrap anything else
    const el = document.createElement(tag);
    if (tag === 'span') el.className = `fs-${size}`;
    if (tag !== 'br') cleanInto(node, el);
    out.append(el);
  }
}

export function cleanHtml(html) {
  const src = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  const out = document.createElement('div');
  cleanInto(src, out);
  return out.innerHTML;
}

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const BULLET = /^\s*(?:[-*•])\s+(.*)$/;

// Plain notes (older notes, or notes Claude wrote) as editor markup: lines
// starting with "- ", "* " or "• " become bullets.
export function plainToHtml(text) {
  if (!text) return '';
  let html = '';
  let inList = false;
  for (const line of text.split('\n')) {
    const m = line.match(BULLET);
    if (m) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${escape(m[1]) || '<br>'}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    html += `<div>${escape(line) || '<br>'}</div>`;
  }
  if (inList) html += '</ul>';
  return html;
}

// The plain text of the editor: one line per block, bullets as "- ".
export function editorText(root) {
  const lines = [];
  let cur = '';
  const flush = () => { lines.push(cur); cur = ''; };
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) { cur += n.textContent; continue; }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      if (n.tagName === 'BR') { flush(); continue; }
      if (n.tagName === 'LI' || n.tagName === 'DIV' || n.tagName === 'P') {
        if (cur) flush();
        if (n.tagName === 'LI') cur = '- ';
        walk(n);
        if (cur || n.tagName === 'LI') flush();
        continue;
      }
      walk(n);
    }
  };
  walk(root);
  if (cur) flush();
  return lines.join('\n').replace(/\n+$/, '').replace(/^\s+$/, '');
}

// ─── The editor ──────────────────────────────────────────────────────────────
// Builds the editor and its side menu inside `notesEl`. onChange(text, html)
// fires on every edit; onToolsToggle() when the menu is folded or opened.
export function buildEditor(notesEl, { html, placeholder, onChange, onToolsToggle }) {
  const ed = document.createElement('div');
  ed.className = 'notes-editor';
  ed.contentEditable = 'true';
  ed.dataset.placeholder = placeholder;
  ed.innerHTML = html;

  const tools = document.createElement('div');
  tools.className = 'notes-tools';
  const toggle = toolButton('nt-toggle', `<span class="nt-dash"></span>${ICONS.chevron}`, 'Hide the formatting menu');
  const list = document.createElement('div');
  list.className = 'nt-list';
  const bold = toolButton('nt-bold', '<b>B</b>', 'Bold (⌘B)');
  const under = toolButton('nt-under', '<u>U</u>', 'Underline (⌘U)');
  const strike = toolButton('nt-strike', '<s>S</s>', 'Strikethrough (⇧⌘X)');
  const size = toolButton('nt-size', '<span class="nt-aa">A<small>A</small></span>', 'Text size');
  list.append(bold, under, strike, size);
  tools.append(toggle, list);
  notesEl.append(ed, tools);

  const changed = () => {
    if (!editorText(ed).trim() && !ed.querySelector('li')) ed.innerHTML = '';   // shows the placeholder
    onChange(editorText(ed), cleanHtml(ed.innerHTML));
    paintState();
  };
  const run = (cmd, value) => { ed.focus(); document.execCommand(cmd, false, value); changed(); };

  toggle.addEventListener('click', () => onToolsToggle());
  bold.addEventListener('click', () => run('bold'));
  under.addEventListener('click', () => run('underline'));
  strike.addEventListener('click', () => run('strikeThrough'));
  size.addEventListener('click', () => {
    const saved = saveRange(ed);
    openPopover(size, SIZES.map(([cls, label]) => ({
      label,
      onPick: () => { restoreRange(ed, saved); applySize(ed, cls); changed(); },
    })));
  });

  ed.addEventListener('input', (e) => {
    if (e.inputType === 'insertText' && e.data?.endsWith(' ')) startListIfDashed(ed);
    changed();
  });
  ed.addEventListener('keydown', (e) => {
    const cmd = e.metaKey && !e.ctrlKey && !e.altKey;
    const k = e.key.toLowerCase();
    // In a bullet: Enter starts the next bullet (or, on an empty one, ends
    // the list); Backspace at the start of a bullet removes the bullet.
    const li = caretLi(ed);
    if (li && !cmd && !e.altKey) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); e.stopPropagation();
        document.execCommand(li.textContent.trim() ? 'insertParagraph' : 'insertUnorderedList');
        changed();
        return;
      }
      if (e.key === 'Backspace' && caretAtStart(li)) {
        e.preventDefault(); e.stopPropagation();
        document.execCommand('insertUnorderedList');
        changed();
        return;
      }
    }
    if (cmd && !e.shiftKey && (k === 'b' || k === 'u')) {
      e.preventDefault(); e.stopPropagation();
      run(k === 'b' ? 'bold' : 'underline');
    } else if (cmd && e.shiftKey && k === 'x') {
      e.preventDefault(); e.stopPropagation();
      run('strikeThrough');
    }
  });
  // Pasted text arrives plain; its lines stay lines.
  ed.addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain') || '');
  });

  // Which of B / U / S the caret is in.
  function paintState() {
    if (!ed.contains(window.getSelection()?.anchorNode)) return;
    bold.classList.toggle('on', document.queryCommandState('bold'));
    under.classList.toggle('on', document.queryCommandState('underline'));
    strike.classList.toggle('on', document.queryCommandState('strikeThrough'));
  }
  document.addEventListener('selectionchange', paintState);

  return {
    editor: ed,
    setHtml(next) { if (document.activeElement !== ed && ed.innerHTML !== next) ed.innerHTML = next; },
    dispose() { document.removeEventListener('selectionchange', paintState); },
  };
}

// The bullet the caret is in, if any.
function caretLi(ed) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return null;
  const node = sel.anchorNode;
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const li = el?.closest('li');
  return li && ed.contains(li) ? li : null;
}

function caretAtStart(li) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(li);
  r.setEnd(sel.anchorNode, sel.anchorOffset);
  return r.toString().length === 0;
}

function toolButton(cls, inner, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `nt-btn ${cls}`;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = inner;
  // Keep the caret (and the selection) in the note.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  return b;
}

// "- " or "* " typed at the start of a line turns it into a bullet point.
function startListIfDashed(ed) {
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE || !ed.contains(node)) return;
  if (node.parentElement?.closest('li')) return;
  const before = node.textContent.slice(0, sel.anchorOffset);
  if (!/^[-*•]\s$/.test(before.replace(/ /g, ' '))) return;
  // Only at the start of its line: nothing before this text node in the block.
  const block = node.parentElement.closest('div:not(.notes-editor)') || ed;
  const range = document.createRange();
  range.setStart(block === ed ? ed : block, 0);
  range.setEnd(node, sel.anchorOffset);
  if (range.toString().replace(/ /g, ' ') !== before.replace(/ /g, ' ')) return;
  const del = document.createRange();
  del.setStart(node, 0);
  del.setEnd(node, sel.anchorOffset);
  sel.removeAllRanges();
  sel.addRange(del);
  document.execCommand('delete');
  document.execCommand('insertUnorderedList');
}

// Text size on the selection: execCommand marks it as <font size="7">, which
// becomes our class (or nothing, for Normal).
function applySize(ed, cls) {
  ed.focus();
  document.execCommand('fontSize', false, '7');
  for (const f of ed.querySelectorAll('font[size="7"]')) {
    for (const inner of f.querySelectorAll('span[class^="fs-"]')) inner.replaceWith(...inner.childNodes);
    if (cls) {
      const span = document.createElement('span');
      span.className = `fs-${cls}`;
      span.append(...f.childNodes);
      f.replaceWith(span);
    } else {
      f.replaceWith(...f.childNodes);
    }
  }
}

function saveRange(ed) {
  const sel = window.getSelection();
  return sel && sel.rangeCount && ed.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
}
function restoreRange(ed, range) {
  ed.focus();
  if (!range) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
