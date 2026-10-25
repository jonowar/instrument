import { S } from './state.js';
import { sendRun } from './conversation.js';
import { log } from './setup.js';
import { esc } from './usage.js';
import { $, guard, post, status } from './util.js';

// --- parts strip and live coding -----------------------------------------------
// Reads sclang code roughly: enough to skip comments (// and nested /* */) and to tell strings and
// character literals apart from code. Returns the code with comments removed, strings kept.
export function stripComments(code) {
  let out = '', i = 0;
  while (i < code.length) {
    const c = code[i], n = code[i + 1];
    if (c === '/' && n === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') {
      let depth = 0;
      do {
        if (code[i] === '/' && code[i + 1] === '*') { depth++; i += 2; }
        else if (code[i] === '*' && code[i + 1] === '/') { depth--; i += 2; }
        else i++;
      } while (depth > 0 && i < code.length);
      continue;
    }
    if (c === '"' || c === "'") { // string or quoted symbol: copy through, honouring \ escapes
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
      out += code.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '$') { out += code.slice(i, i + 2); i += 2; continue; } // character literal, e.g. $/
    out += c; i++;
  }
  return out;
}
// Part keys ('pdef:drums', 'ndef:pad') for every Pdef(\name…) / Ndef('name'…) outside comments.
export function activeParts(code) {
  const keys = new Set();
  // empty strings and symbols that aren't plain names, so text like "uses Pdef(\\x)" doesn't count
  const text = stripComments(code).replace(/(["'])((?:(?!\1)[^\\]|\\.)*)\1/g, (m, q, body) => (/^\w+$/.test(body) ? m : q + q));
  for (const m of text.matchAll(/\b(Pdef|Ndef)\s*\(\s*(?:\\(\w+)|'(\w+)'|"(\w+)")/g)) {
    keys.add(`${m[1].toLowerCase()}:${m[2] || m[3] || m[4]}`);
  }
  return [...keys];
}
// Brackets and strings balance: a live edit is only run once it could be complete.
function balanced(code) {
  const t = stripComments(code);
  if ((t.match(/"/g) || []).length % 2) return false;
  const bare = t.replace(/"(?:[^"\\]|\\.)*"/g, '').replace(/'(?:[^'\\]|\\.)*'/g, '').replace(/\$./g, '');
  const stack = [], pair = { ')': '(', ']': '[', '}': '{' };
  for (const ch of bare) {
    if ('([{'.includes(ch)) stack.push(ch);
    else if (ch in pair && stack.pop() !== pair[ch]) return false;
  }
  return !stack.length;
}

 // from sclang: [{ kind, name, playing, muted }]
const partKey = (p) => `${p.kind}:${p.name}`;
export function renderParts() {
  const inCode = new Set(activeParts($('code').value));
  // parts in the code, plus anything still sounding that the code no longer has (stops on next run)
  const shown = S.parts.filter((p) => inCode.has(partKey(p)) || p.playing);
  $('muteAll').hidden = $('unmuteAll').hidden = !shown.length;
  $('muteAll').disabled = !S.parts.some((p) => p.playing && !p.muted);
  $('unmuteAll').disabled = !S.parts.some((p) => p.muted);
  if (!shown.length) {
    $('partsList').className = 'hint';
    $('partsList').textContent = 'parts: each Pdef or Ndef in your code shows up here as a toggle once it has run';
    return;
  }
  $('partsList').className = '';
  $('partsList').innerHTML = shown.map((p) => {
    const orphan = !inCode.has(partKey(p));
    const state = p.muted ? 'muted' : p.playing ? 'playing' : 'stopped';
    const tip = orphan ? 'Not in the code any more: stops on the next run. Click to silence it now.'
      : p.muted ? 'Muted: keeps time silently, and stays muted when the code re-runs. Click to bring it back in.'
      : p.playing ? 'Playing. Click to mute: it keeps its place in time, so it comes back in on the beat.' : 'Stopped. Click to play.';
    return `<button class="part ${state}${orphan ? ' orphan' : ''}" data-key="${esc(partKey(p))}" data-on="${p.muted || !p.playing}" title="${esc(`${p.kind === 'pdef' ? 'Pdef' : 'Ndef'} \\${p.name} · ${tip}`)}"><span class="k">${p.kind === 'pdef' ? 'P' : 'N'}</span>${esc(p.name)}</button>`;
  }).join('');
}
$('muteAll').onclick = guard(() => post('/parts-all', { on: false }));
$('unmuteAll').onclick = guard(() => post('/parts-all', { on: true }));
$('partsList').onclick = async (e) => {
  const b = e.target.closest('button.part'); if (!b) return;
  try { await post('/part', { key: b.dataset.key, on: b.dataset.on === 'true' }); }
  catch (err) { log('! ' + err.message + '\n'); }
};

const live = {
  get: () => { try { return localStorage.getItem('live') === '1'; } catch { return false; } },
  set: (v) => { try { localStorage.setItem('live', v ? '1' : '0'); } catch {} },
};
function renderLive() {
  $('liveBtn').classList.toggle('on', live.get());
  $('liveBtn').textContent = live.get() ? '● Live' : '○ Live';
}
$('liveBtn').onclick = () => { live.set(!live.get()); renderLive(); status(live.get() ? 'live: edits re-run by themselves' : ''); };
renderLive();
/** @type {ReturnType<typeof setTimeout>} */
let liveTimer, partsTimer;
$('code').addEventListener('input', () => {
  clearTimeout(partsTimer); partsTimer = setTimeout(renderParts, 150);
  if (!live.get()) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(guard(async () => {
    const code = $('code').value;
    if (!code.trim() || code === S.lastRunCode) return;
    if (!balanced(code)) { status('live: waiting for brackets to balance'); return; }
    await sendRun(true);
  }), 900);
});

// ⌘; comments or uncomments the selected lines (or the line with the cursor). Uses insertText so
// it can be undone with ⌘Z, and fires an input event, so live mode picks it up.
function toggleComment() {
  const ta = $('code'), v = ta.value;
  const start = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let end = v.indexOf('\n', ta.selectionEnd - (ta.selectionEnd > ta.selectionStart && v[ta.selectionEnd - 1] === '\n' ? 1 : 0));
  if (end < 0) end = v.length;
  const lines = v.slice(start, end).split('\n');
  const filled = lines.filter((l) => l.trim());
  const commented = filled.length && filled.every((l) => /^\s*\/\//.test(l));
  const indent = Math.min(...filled.map((l) => l.match(/^\s*/)[0].length));
  const out = lines.map((l) => {
    if (!l.trim()) return l;
    return commented ? l.replace(/^(\s*)\/\/ ?/, '$1') : l.slice(0, indent) + '// ' + l.slice(indent);
  }).join('\n');
  ta.focus(); ta.setSelectionRange(start, end);
  document.execCommand('insertText', false, out);
  ta.setSelectionRange(start, start + out.length);
}
$('code').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === ';') { e.preventDefault(); toggleComment(); }
});
