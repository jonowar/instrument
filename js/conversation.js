import { S } from './state.js';
import { renderKey } from './connect.js';
import { renderGutter } from './editor.js';
import { AUTO_FIX_TRIES, hideTile, syncShellWarn } from './errors.js';
import { midiAllOff } from './midi.js';
import { activeParts, stripComments } from './parts.js';
import { nTurns } from './saved.js';
import { log } from './setup.js';
import { esc, shortModel, showUsage } from './usage.js';
import { $, guard, modelList, modelSlot, post, pref, provider, setPref, speed, status } from './util.js';
import { runRec } from './record.js';

// --- conversation: every prompt and the code Claude returned, sent back with each request ---------
// The editor shows only the latest code; 💬 shows the whole thing. Kept in sessionStorage, so a reload
// keeps it but each launch of the app starts a new conversation (♡ saves one to come back to).
// Each turn: { prompt (what you typed), user (the message actually sent, which may include your
// edited code), code (Claude's reply), at }.
try { localStorage.removeItem('conversation'); } catch {} // where it used to be kept, across launches
export const chat = {
  load: () => { try { return JSON.parse(sessionStorage.getItem('conversation') || '[]'); } catch { return []; } },
  save: (t) => { try { sessionStorage.setItem('conversation', JSON.stringify(t)); } catch {} },
};
S.turns = chat.load();
// The saved session (♡) being worked on, if any: set by saving or loading one, cleared by New. Exports
// are named after it. Kept beside the conversation, so it lasts until the app quits.
export const session = {
  get: () => { try { return sessionStorage.getItem('session-name') || ''; } catch { return ''; } },
  set: (n) => { try { n ? sessionStorage.setItem('session-name', n) : sessionStorage.removeItem('session-name'); } catch {} },
};
// A file name for an export: "<saved session> 2026-10-14 22.58.<ext>" when working on one (at = when the
// thing was made), else null so the caller keeps its own name.
export function sessionFileName(ext, at = Date.now()) {
  const name = session.get().replace(/[\/\\:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const d = new Date(at), p2 = (n) => String(n).padStart(2, '0');
  return `${name} ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${ext}`;
}
export function renderChat() {
  $('historyBtn').hidden = !S.turns.length;
  $('historyBtn').textContent = `💬 ${S.turns.length} turn${S.turns.length === 1 ? '' : 's'}`;
}
// Sends the prompt plus the conversation so far; Claude's reply replaces the editor.
export async function converse(prompt, label, code = $('code').value) {
  const t0 = performance.now();
  const history = S.turns.map(({ user, code }) => ({ user, code }));
  const res = await post('/generate', { prompt, code, history, kind: label, ...speed() });
  showUsage(`${label} · ${shortModel(res.usage?.model)} ${speed().effort}`, res.usage, performance.now() - t0);
  $('code').value = res.code;
  S.turns.push({ prompt, user: res.user, code: res.code, at: Date.now() });
  chat.save(S.turns); renderChat();
  if (res.truncated) log('! Claude hit the output limit, so this code is incomplete. Ask for something shorter or split it into parts.\n');
  return res;
}

export const generate = guard(async () => {
  const prompt = $('prompt').value.trim();
  if (!prompt) return;
  status('thinking…');
  const { truncated } = await converse(prompt, 'generate');
  status(truncated ? 'cut off!' : '');
  $('prompt').select();
});

$('historyBtn').onclick = () => {
  const current = $('code').value.trim();
  $('historyHint').textContent = `Claude sees all ${S.turns.length} turns, with Generate and Fix alike.`;
  $('turns').innerHTML = S.turns.map((t, i) => `
    <li>
      <div class="you">${esc(t.prompt)}</div>
      <div class="meta">
        <span>${new Date(t.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
        <details><summary>code · ${t.code.split('\n').length} lines${t.code.trim() === current ? ' · <span class="current">in editor</span>' : ''}</summary>
          <pre>${esc(t.code)}</pre></details>
        <button type="button" data-copy="${i}" title="Copy this version's code to the clipboard">Copy</button>
        ${i < S.turns.length - 1 ? `<button type="button" data-rewind="${i}" title="Go back to this version. Claude's context goes back too: the later turns are dropped.">Rewind here</button>` : ''}
      </div>
    </li>`).join('');
  $('turns').onclick = async (e) => {
    const c = e.target.closest('button[data-copy]');
    if (c) {
      try { await navigator.clipboard.writeText(S.turns[+c.dataset.copy].code); c.textContent = 'Copied ✓'; }
      catch { c.textContent = 'Copy failed'; }
      setTimeout(() => (c.textContent = 'Copy'), 1500);
      return;
    }
    const b = e.target.closest('button[data-rewind]'); if (!b) return;
    const i = +b.dataset.rewind, later = S.turns.length - 1 - i;
    if (!confirm(`Rewind to this turn? The ${later} later turn${later === 1 ? '' : 's'} will be dropped, so Claude continues from here with only the context up to this point. Save first (♡) to keep them.`)) return;
    S.turns = S.turns.slice(0, i + 1); chat.save(S.turns); renderChat();
    $('code').value = S.turns[i].code; status('rewound — Run to hear it'); $('history').close();
  };
  $('history').showModal();
  $('turns').scrollTop = $('turns').scrollHeight; // newest at the bottom, like a chat
};
// Start fresh: the next prompt begins a new piece, with no code or history behind it.
$('newChat').onclick = () => {
  const lost = [S.turns.length && `the ${nTurns(S.turns.length)} conversation`, $('code').value.trim() && 'the code in the editor']
    .filter(Boolean).join(' and ');
  if (lost && !confirm(`Start something new? This clears ${lost}. Save first (♡) to keep them. Anything playing keeps playing until Stop.`)) return;
  S.turns = []; chat.save(S.turns); renderChat(); session.set('');
  $('code').value = ''; $('prompt').value = ''; hideTile();
  status('new conversation'); $('prompt').focus();
};
renderChat();
// Every run sends the parts the code mentions outside comments; the server stops all the others,
// so deleting or commenting out a Pdef/Ndef silences it.
// Live mode runs only what changed. Re-running the whole file restarts patterns from their first beat,
// stacks a second copy of any bare `{ }.play`, and rebuilds every SynthDef. So the code is cut into
// top-level statements (at each ; outside brackets, strings and comments), and statements that were in the
// last run are blanked out, keeping their line breaks so sclang's line numbers still match the editor.
export function topStatements(code) {
  const out = []; let start = 0, depth = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i], n = code[i + 1];
    if (c === '/' && n === '/') { while (i < code.length && code[i] !== '\n') i++; }
    else if (c === '/' && n === '*') { const e = code.indexOf('*/', i + 2); i = e < 0 ? code.length : e + 1; }
    else if (c === '"' || c === "'") { for (i++; i < code.length && code[i] !== c; i++) if (code[i] === '\\') i++; }
    else if (c === '$') i++;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) { out.push(code.slice(start, i + 1)); start = i + 1; }
  }
  out.push(code.slice(start));
  return out;
}
const stmtKey = (t) => stripComments(t).replace(/\s+/g, ' ').trim();
// What to send for a live edit of `cur`, given the code of the last run. Whole file when that's safer.
export function liveDiff(prev, cur) {
  if (prev == null) return cur;
  const now = topStatements(cur), had = new Map();
  for (const t of topStatements(prev)) { const k = stmtKey(t); had.set(k, (had.get(k) || 0) + 1); }
  let out = '';
  for (const t of now) {
    const k = stmtKey(t);
    if (!k) { out += t; continue; }
    if (/^var\b/.test(k)) return cur;                    // later statements may use it
    if (had.get(k) > 0) { had.set(k, had.get(k) - 1); out += t.replace(/[^\n]/g, ''); continue; }
    if (/^~\w+\s*=/.test(k)) return cur;                // a shared setting changed: let everything pick it up
    out += t;
  }
  return out;
}
 // the code of the last run that is still sounding; null after Stop or a restart, so the next run is whole
 // the latest run came from live mode, not the Run button
export async function sendRun(isLive, fromAutoFix = false) {
  hideTile(); syncShellWarn();
  S.watchForError = true; S.liveRunning = isLive;
  if (!fromAutoFix) S.autoFixLeft = AUTO_FIX_TRIES; // each Run of yours gets fresh tries
  S.errLine = 0; renderGutter();
  S.lastRunCode = $('code').value;
  // Run always stops first, so a new run never piles onto the old one's sound. Live re-runs don't: they
  // update the playing parts in place.
  if (!isLive) { S.runBase = null; midiAllOff(); await post('/stop', {}); }
  await post('/run', { code: isLive ? liveDiff(S.runBase, S.lastRunCode) : S.lastRunCode, full: S.lastRunCode, keep: activeParts(S.lastRunCode) });
  S.runBase = S.lastRunCode;
  status(isLive ? 'live ↻' : 'sent');
}
export const run = guard(() => sendRun(false));
export const stop = guard(async () => { S.runBase = null; midiAllOff(); await post('/stop', {}); status('stopped'); });

$('cog').onclick = () => {
  renderKey();
  $('effort').value = pref('effort', 'low');
  const p = provider(), claude = p === 'anthropic';
  $('model').value = pref('model', '');
  $('modelText').value = pref(modelSlot(), '');
  $('modelClaude').hidden = !claude; $('modelOther').hidden = claude;
  fillModels();
  const paid = !claude && !(S.providers[p] || {}).free;
  $('priceRow').hidden = $('priceHint').hidden = !paid;
  [$('priceIn').value, $('priceOut').value] = pref('price:' + p, ',').split(',');
  $('settings').returnValue = ''; // Esc or a click outside closes without saving or clearing
  $('settings').showModal();
};
$('settings').addEventListener('close', () => {
  const v = $('settings').returnValue;
  if (v !== 'save') return;
  const p = provider();
  setPref('effort', $('effort').value);
  if (p === 'anthropic') setPref('model', $('model').value);
  else {
    setPref(modelSlot(), $('modelText').value.trim());
    const [pin, pout] = [$('priceIn').value.trim(), $('priceOut').value.trim()];
    setPref('price:' + p, Number.isFinite(parseFloat(pin)) && Number.isFinite(parseFloat(pout)) ? `${parseFloat(pin)},${parseFloat(pout)}` : ',');
  }
});
function fillModels() { // the provider's own list, from when its key was checked
  $('modelList').replaceChildren(...modelList().map((m) => Object.assign(document.createElement('option'), { value: m })));
}

// buttons and keys for the prompt and the transport
$('gen').onclick = generate; $('run').onclick = run; $('stop').onclick = stop;
$('prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.isComposing) { e.preventDefault(); generate(); }
});
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.shiftKey ? runRec() : run(); }
  if ((e.metaKey || e.ctrlKey) && e.key === '.') { e.preventDefault(); stop(); }
});
