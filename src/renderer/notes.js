// The notes editor: rich text in a contenteditable, with a small side menu
// (bold, underline, strikethrough, text size), bullet points that carry on
// with Enter, links, and attachments: images shown inline, other files as
// chips. Attach and Link sit beside the note's label.
//
// A note is saved twice: as cleaned HTML (notesHtml, only the tags below
// survive) for the formatting, and as plain text (notes) for search, the
// notes dot and Claude. In the plain text an image reads "[image: name]", a
// file "[file: name]" and a link "text (url)".
import { ICONS } from './icons.js';
import { plainToHtml, ATT_FILE, ATT_URL } from '../shared/model.mjs';
import { openPopover } from './popover.js';
import { showToast } from './toast.js';

const api = window.clearday;
const LINK_HREF = /^(https?:\/\/|mailto:)/i;
// A web address as typed or pasted: with its scheme, or starting www.
const URL_WORD = /(?:https?:\/\/|www\.)[^\s<>"]+[^\s<>".,;:!?)\]'’]/i;
const hrefFor = (text) => (/^www\./i.test(text) ? `https://${text}` : text);

const SIZES = [
  ['s', 'Small'], ['', 'Normal'], ['l', 'Large'], ['xl', 'Title'],
];
// execCommand('fontSize') sizes 1–7 → our classes, for pasted or old markup.
const FONT_SIZE_CLASS = { 1: 's', 2: 's', 3: '', 4: 'l', 5: 'l', 6: 'xl', 7: 'xl' };

// ─── Cleaning ────────────────────────────────────────────────────────────────
const KEEP = { B: 'b', STRONG: 'b', U: 'u', S: 's', STRIKE: 's', DEL: 's', UL: 'ul', LI: 'li', BR: 'br', DIV: 'div', P: 'div' };

// An attachment's file name, if the element is a valid attachment.
const attFile = (el) => {
  const f = el.tagName === 'IMG' ? (el.getAttribute('src') || '').slice(ATT_URL.length) : el.dataset?.att;
  return (el.tagName !== 'IMG' || (el.getAttribute('src') || '').startsWith(ATT_URL)) && ATT_FILE.test(f || '') ? f : null;
};

// The markup of an attachment, as the cleaner keeps it.
function attachmentEl({ file, name, image }) {
  if (image) {
    const img = document.createElement('img');
    img.src = ATT_URL + file;
    img.alt = name;
    return img;
  }
  const chip = document.createElement('span');
  chip.className = 'att';
  chip.contentEditable = 'false';
  chip.dataset.att = file;
  chip.dataset.name = name;
  chip.textContent = name;
  return chip;
}

function cleanInto(src, out) {
  for (const node of src.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) { out.append(node.textContent); continue; }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    // Attachments and links keep only what they need; anything else of the
    // kind (an outside image, a javascript: link) is dropped or unwrapped.
    if (node.tagName === 'IMG') {
      const f = attFile(node);
      if (f) out.append(attachmentEl({ file: f, name: node.getAttribute('alt') || 'image', image: true }));
      continue;
    }
    if (node.tagName === 'SPAN' && node.classList.contains('att')) {
      const f = attFile(node);
      if (f) out.append(attachmentEl({ file: f, name: node.dataset.name || node.textContent || 'file', image: false }));
      continue;
    }
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (!LINK_HREF.test(href)) { cleanInto(node, out); continue; }
      const a = document.createElement('a');
      a.href = href;
      cleanInto(node, a);
      out.append(a);
      continue;
    }
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

// Plain notes as editor markup: shared with the main process, which uses it
// when Claude rewrites a note that holds attachments.
export { plainToHtml };

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
      if (n.tagName === 'IMG') {
        if (cur) flush();
        cur = `[image: ${n.getAttribute('alt') || 'image'}]`;
        flush();
        continue;
      }
      if (n.classList?.contains('att')) { cur += `[file: ${n.dataset.name || n.textContent}]`; continue; }
      if (n.tagName === 'A') {
        const text = n.textContent, href = n.getAttribute('href') || '';
        cur += text === href || hrefFor(text) === href ? text : `${text} (${href})`;
        continue;
      }
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
  // The editor types a space before a link or chip as a no-break space;
  // the plain notes keep ordinary ones.
  return lines.join('\n').replace(/\u00a0/g, ' ').replace(/\n+$/, '').replace(/^\s+$/, '');
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
  // Attach and Link, beside the note's label.
  const head = notesEl.querySelector('.notes-head') || notesEl;
  const attachBtn = toolButton('nt-attach', ICONS.paperclip, 'Attach a file or image');
  const linkBtn = toolButton('nt-link', ICONS.link, 'Link (⌘K)');
  head.append(attachBtn, linkBtn);

  // While one of the note's own menus (link field, text size) or the file
  // picker is open, focus is outside the editor; a save landing then must
  // not redraw it, or the selection the menu acts on is lost.
  let busy = 0;
  const hold = () => { busy++; let done = false; return () => { if (!done) { done = true; busy--; } }; };

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
    const release = hold();
    if (!openPopover(size, SIZES.map(([cls, label]) => ({
      label,
      onPick: () => { restoreRange(ed, saved); applySize(ed, cls); changed(); },
    })), { onClose: release })) release();
  });

  // ─── Attachments ───
  // Each file is copied in by the main process, then put where the caret
  // was (or where it was dropped). A file that can't be attached says why.
  async function attachFiles(files, range) {
    const metas = [];
    for (const f of files) {
      const p = api.attachments.pathFor(f);
      const name = !f.name || f.name === 'image.png' ? 'Pasted image.png' : f.name;
      metas.push(p ? await api.attachments.addPath(p) : await api.attachments.addBytes(name, f.type, await f.arrayBuffer()));
    }
    insertAttachments(metas, range);
  }
  function insertAttachments(metas, range) {
    for (const m of metas) if (m?.error) showToast(m.error, { duration: 4500 });
    const ok = metas.filter((m) => m && !m.error);
    if (!ok.length) return;
    if (range) restoreRange(ed, range);
    else { ed.focus(); if (!ed.contains(window.getSelection()?.anchorNode)) caretToEnd(ed); }
    // A chip is followed by a space, so typing carries on after it.
    document.execCommand('insertHTML', false, ok.map((m) => attachmentEl(m).outerHTML + (m.image ? '' : '&nbsp;')).join(''));
    changed();
  }
  attachBtn.addEventListener('click', async () => {
    const saved = saveRange(ed);
    const release = hold();
    try { insertAttachments(await api.attachments.pick(), saved); } finally { release(); }
  });
  // Files dragged in from Finder (or another app) drop into the note.
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  notesEl.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    notesEl.classList.add('drop-over');
  });
  notesEl.addEventListener('dragleave', (e) => { if (!notesEl.contains(e.relatedTarget)) notesEl.classList.remove('drop-over'); });
  notesEl.addEventListener('drop', (e) => {
    notesEl.classList.remove('drop-over');
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    attachFiles(files, r && ed.contains(r.startContainer) ? r : null);
  });

  // ─── Links ───
  function insertLink(href, text) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    document.execCommand('insertHTML', false, a.outerHTML);
    changed();
  }
  // ⌘K or the link button: link the selected words, or put a link at the
  // caret; on a link, change where it goes, open it or remove it.
  function editLink() {
    const saved = saveRange(ed);
    const node = saved?.startContainer;
    const a = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : node)?.closest?.('a');
    const link = a && ed.contains(a) ? a : null;
    const items = [{ field: {
      value: link?.getAttribute('href') || '',
      placeholder: 'Paste or type a link',
      onSubmit: (v) => {
        if (!v) return;
        const href = LINK_HREF.test(v) ? v : /^[^\s@/]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}` : `https://${v}`;
        restoreRange(ed, saved);
        if (link) { link.setAttribute('href', href); changed(); return; }
        if (saved && !saved.collapsed) { document.execCommand('createLink', false, href); changed(); return; }
        insertLink(href, v);
      },
    } }];
    if (link) {
      items.push(
        { sep: true },
        { label: 'Open link', icon: ICONS.link, onPick: () => api.attachments.openLink(link.getAttribute('href')) },
        { label: 'Remove link', icon: ICONS.close, onPick: () => { link.replaceWith(...link.childNodes); changed(); } },
      );
    }
    const release = hold();
    if (!openPopover(linkBtn, items, { onClose: () => { release(); restoreRange(ed, saved); } })) release();
  }
  linkBtn.addEventListener('click', editLink);

  // A click opens a link in the browser, and an image or file in its app.
  ed.addEventListener('click', async (e) => {
    const a = e.target.closest('a');
    if (a && ed.contains(a)) { e.preventDefault(); api.attachments.openLink(a.getAttribute('href')); return; }
    const att = e.target.closest('img, .att');
    const f = att && ed.contains(att) && attFile(att);
    if (f && !(await api.attachments.open(f))) showToast('That attachment can no longer be found.', { duration: 3500 });
  });
  ed.addEventListener('mouseover', (e) => {
    const a = e.target.closest('a');
    if (a && !a.title) a.title = `${a.getAttribute('href')}\nClick to open · ⌘K to edit`;
  });

  ed.addEventListener('input', (e) => {
    if (e.inputType === 'insertText' && e.data?.endsWith(' ')) { startListIfDashed(ed); linkBeforeCaret(ed, 1); }
    changed();
  });
  ed.addEventListener('keydown', (e) => {
    const cmd = e.metaKey && !e.ctrlKey && !e.altKey;
    const k = e.key.toLowerCase();
    // In a bullet: Enter starts the next bullet (or, on an empty one, ends
    // the list); Backspace at the start of a bullet removes the bullet.
    // A web address just typed becomes a link when its line ends.
    if (e.key === 'Enter' && !cmd && !e.altKey && linkBeforeCaret(ed, 0)) changed();
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
    } else if (cmd && !e.shiftKey && k === 'k') {
      e.preventDefault(); e.stopPropagation();
      editLink();
    }
  });
  // Pasted images and files are attached. A pasted web address on its own
  // becomes a link; any other text arrives plain, its lines kept.
  ed.addEventListener('paste', (e) => {
    e.preventDefault();
    const files = [...(e.clipboardData.files || [])];
    if (files.length) { attachFiles(files, saveRange(ed)); return; }
    const text = e.clipboardData.getData('text/plain') || '';
    const url = text.trim().match(URL_WORD)?.[0];
    if (url && url === text.trim()) { insertLink(hrefFor(url), url); return; }
    document.execCommand('insertText', false, text);
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
    setHtml(next) { if (!busy && document.activeElement !== ed && ed.innerHTML !== next) ed.innerHTML = next; },
    dispose() { document.removeEventListener('selectionchange', paintState); },
  };
}

// Turns the web address just before the caret (less `skip` characters: the
// space just typed) into a link, and puts the caret back where it was.
// Returns whether it made one.
function linkBeforeCaret(ed, skip) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return false;
  const node = sel.anchorNode;
  if (node?.nodeType !== Node.TEXT_NODE || !ed.contains(node) || node.parentElement.closest('a')) return false;
  const caret = sel.anchorOffset;
  const before = node.textContent.slice(0, caret - skip);
  const m = before.match(/(?:^|\s)(\S+)$/);
  const word = m?.[1].match(URL_WORD)?.[0];
  if (!word || !m[1].startsWith(word)) return false;
  const start = before.length - m[1].length;
  const r = document.createRange();
  r.setStart(node, start);
  r.setEnd(node, start + word.length);
  sel.removeAllRanges();
  sel.addRange(r);
  document.execCommand('createLink', false, hrefFor(word));
  // createLink leaves the link selected; the caret goes back after it, past
  // whatever followed the address (the space, a full stop).
  const a = (sel.anchorNode?.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode)?.closest?.('a');
  const back = document.createRange();
  const rest = caret - (start + word.length);
  const next = a?.nextSibling;
  if (next?.nodeType === Node.TEXT_NODE && next.textContent.length >= rest) back.setStart(next, rest);
  else if (a) back.setStartAfter(a);
  else return true;
  back.collapse(true);
  sel.removeAllRanges();
  sel.addRange(back);
  return true;
}

function caretToEnd(ed) {
  const r = document.createRange();
  r.selectNodeContents(ed);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
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
