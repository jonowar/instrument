import { S } from './state.js';
import { syncShellWarn } from './errors.js';
import { renderParts } from './parts.js';
import { esc } from './usage.js';
import { $ } from './util.js';

// --- find in the code editor (⌘F) ----------------------------------------------
// A textarea can't highlight ranges itself, so matches are drawn as <mark>s in #marks, a copy of the
// text laid out identically behind it. Closing the bar selects the current match in the editor.
let findHits = [], findCur = -1;
// Shell commands (unixCmd and friends) can do anything to this Mac. The prompt tells Claude never to write
// them, but code can still arrive by typing, import or loading, so every occurrence is flagged on its line.
const SHELL_RE = /\b(unixCmdGetStdOut|unixCmd|systemCmd|runInTerminal)\b/;
export const shellLines = (code) => code.split('\n').flatMap((l, i) => (SHELL_RE.test(l.replace(/\/\/.*/, '')) ? [i + 1] : []));
// Syntax highlighting: one class per character of the code (comments, strings, symbols, numbers, class
// names, keywords, ~environment variables), found with a single scan, then drawn as runs of <span>s in #marks.
const TOKEN_RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\]|\\[\s\S])*(?:"|$))|('(?:[^'\\\n]|\\.)*'|\\[A-Za-z_]\w*)|(\$[\s\S])|(~[A-Za-z_]\w*)|\b(var|arg|true|false|nil|inf|this|thisProcess|thisThread|thisFunction)\b|\b([A-Z]\w*)|(\b\d[\d_]*(?:\.\d+)?(?:e-?\d+)?\b)/g;
const TOKEN_CLASS = [null, 'c', 's', 'y', 's', 'e', 'w', 'k', 'n'];
function charClasses(code) {
  const cls = new Array(code.length).fill('');
  for (const m of code.matchAll(TOKEN_RE)) {
    const g = m.findIndex((x, i) => i && x !== undefined);
    cls.fill(TOKEN_CLASS[g], m.index, m.index + m[0].length);
  }
  for (const m of code.matchAll(new RegExp(SHELL_RE.source, 'g'))) { // shell commands outside comments get a warning underline
    if (cls[m.index] !== 'c') for (let i = m.index; i < m.index + m[0].length; i++) cls[i] += ' shellcmd';
  }
  return cls;
}
// The html for code[a, b), as runs of characters with the same class.
function codeHtml(code, cls, a, b) {
  let html = '';
  for (let i = a; i < b;) {
    let j = i + 1;
    while (j < b && cls[j] === cls[i]) j++;
    const t = esc(code.slice(i, j));
    const names = cls[i].split(' ').filter(Boolean).map((x) => (x === 'shellcmd' ? x : 't-' + x)).join(' ');
    html += names ? `<span class="${names}">${t}</span>` : t;
    i = j;
  }
  return html;
}
function renderMarks() {
  const code = $('code').value, q = $('find').hidden ? '' : $('findText').value;
  findHits = [];
  const cls = charClasses(code);
  if (q) for (let i = code.toLowerCase().indexOf(q.toLowerCase()); i >= 0; i = code.toLowerCase().indexOf(q.toLowerCase(), i + q.length)) findHits.push(i);
  if (findCur >= findHits.length) findCur = findHits.length - 1;
  if (findCur < 0 && findHits.length) findCur = 0;
  // One <div> per line, with matches inside, so each line's height (it may wrap) can be measured for
  // the line numbers. A search can't span lines, since the find box is a single line.
  let html = '', off = 0, n = 0;
  for (const line of code.split('\n')) {
    let row = '', at = off;
    for (; n < findHits.length && findHits[n] < off + line.length; n++) {
      const h = findHits[n];
      row += codeHtml(code, cls, at, h) + `<mark${n === findCur ? ' class="cur"' : ''}>${codeHtml(code, cls, h, h + q.length)}</mark>`;
      at = h + q.length;
    }
    html += `<div>${row + codeHtml(code, cls, at, off + line.length) || '\u200b'}</div>`; // empty lines still need height
    off += line.length + 1;
  }
  $('marks').innerHTML = html;
  renderGutter(); syncShellWarn();
  $('findCount').textContent = q ? (findHits.length ? `${findCur + 1} of ${findHits.length}` : 'none') : '';
}
// Line numbers, each as tall as its line in #marks. errLine is the line sclang's last error named.

export function renderGutter() {
  const ta = $('code'), cur = ta.value.slice(0, ta.selectionStart).split('\n').length, shellSet = new Set(shellLines(ta.value));
  // exact heights: a line is 13px × 1.55 = 20.15px, and offsetHeight's whole pixels drifted ~3px per 20 lines
  $('gutter').innerHTML = [...$('marks').children].map((d, i) =>
    `<div style="height:${d.getBoundingClientRect().height}px"${i + 1 === S.errLine ? ' class="err"' : shellSet.has(i + 1) ? ' class="shell" title="This line runs a shell command"' : i + 1 === cur ? ' class="cur"' : ''}>${i + 1}</div>`).join('')
    + '<div style="height:40px"></div>'; // room to scroll as far as the textarea can
  $('marks').scrollTop = $('gutter').scrollTop = ta.scrollTop;
}
function findStep(d) {
  if (!findHits.length) return;
  findCur = (findCur + d + findHits.length) % findHits.length;
  renderMarks();
  const m = $('marks').querySelector('mark.cur'), ta = $('code');
  if (m && (m.offsetTop < ta.scrollTop || m.offsetTop + m.offsetHeight > ta.scrollTop + ta.clientHeight)) {
    ta.scrollTop = m.offsetTop - ta.clientHeight / 3;
  }
  $('marks').scrollTop = ta.scrollTop;
}
function openFind() {
  const ta = $('code'), sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (sel && !sel.includes('\n')) $('findText').value = sel; // like most editors: search for the selection
  $('find').hidden = false; $('findText').select();
  findCur = -1; renderMarks(); findStep(0);
}
function closeFind() {
  const q = $('findText').value, h = findHits[findCur];
  $('find').hidden = true; renderMarks();
  $('code').focus();
  if (h != null) $('code').setSelectionRange(h, h + q.length);
}
$('findText').addEventListener('input', () => { findCur = -1; renderMarks(); findStep(0); });
$('findText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
$('findNext').onclick = () => findStep(1);
$('findPrev').onclick = () => findStep(-1);
$('findClose').onclick = closeFind;
// Generate, Fix, Load and Rewind set .value directly, which fires no input event; refresh then too.
const valueProp = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
Object.defineProperty($('code'), 'value', {
  get() { return valueProp.get.call(this); },
  set(v) { valueProp.set.call(this, v); renderMarks(); renderParts(); },
});
$('code').addEventListener('scroll', () => { $('marks').scrollTop = $('gutter').scrollTop = $('code').scrollTop; });
$('code').addEventListener('input', renderMarks);
// the current line's number is brighter: follow the cursor
for (const ev of ['keyup', 'click', 'select']) $('code').addEventListener(ev, renderGutter);
new ResizeObserver(renderMarks).observe($('code')); // a new width changes how lines wrap
renderMarks();
// After a reload the conversation is still there, so show its latest code rather than an empty editor.
if (S.turns.length && !$('code').value) $('code').value = S.turns.at(-1).code;

addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); openFind(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'g' && !$('find').hidden) { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
});
