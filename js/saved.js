import { S } from './state.js';
import { chat, renderChat, session } from './conversation.js';
import { log } from './setup.js';
import { esc } from './usage.js';
import { $, status } from './util.js';

// --- saved sessions (localStorage) -----------------------------------------
// A save is the whole session: the editor's code and the conversation that led to it. Loading one
// brings both back, so the next prompt continues with Claude seeing everything up to the save.
// Saves from before conversations existed have no turns; they load with a fresh conversation.
const lib = {
  load: () => { try { return JSON.parse(localStorage.getItem('saved-patches') || '[]'); } catch { return []; } },
  save: (list) => { try { localStorage.setItem('saved-patches', JSON.stringify(list)); return true; } catch { return false; } },
};
// default name: first few words of the first prompt, since that's what you'll remember it by
// With dots = true a cut-short name ends in "...", so a shared title doesn't pass for the whole prompt.
export const suggestName = (dots = false) => {
  const words = (S.turns[0]?.prompt || $('prompt').value).trim().split(/\s+/).filter(Boolean);
  const name = words.slice(0, 4).join(' ');
  return name.slice(0, 24) + (dots && (words.length > 4 || name.length > 24) ? '...' : '');
};
export const nTurns = (n) => `${n} turn${n === 1 ? '' : 's'}`;

function renderLibrary() {
  const list = lib.load().sort((a, b) => b.savedAt - a.savedAt);
  $('savedList').innerHTML = list.length ? list.map((p, i) => `
    <li title="${esc(p.turns?.length ? p.turns.map((t) => '• ' + t.prompt).join('\n') : p.prompt || '')}">
      <span class="name">${esc(p.name)}</span>
      <span class="when">${p.turns?.length ? nTurns(p.turns.length) : 'code only'}</span>
      <span class="when">${new Date(p.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
      <button type="button" data-load="${i}">Load</button>
      <button type="button" data-del="${i}">✕</button>
    </li>`).join('') : '<li class="empty">Nothing saved yet.</li>';
  $('savedList').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const all = lib.load().sort((a, c) => c.savedAt - a.savedAt);
    if (b.dataset.load != null) {
      const p = all[+b.dataset.load];
      const busy = S.turns.length || ($('code').value.trim() && $('code').value !== p.code);
      if (busy && !confirm(`Load "${p.name}"? It replaces the editor${S.turns.length ? ` and the current ${nTurns(S.turns.length)} conversation` : ''}. Save first (♡) to keep them.`)) return;
      $('code').value = p.code;
      S.turns = structuredClone(p.turns || []); chat.save(S.turns); renderChat(); session.set(p.name);
      status(`loaded "${p.name}"${S.turns.length ? ` · ${nTurns(S.turns.length)}` : ''}`); $('library').close();
    } else if (b.dataset.del != null) {
      const p = all[+b.dataset.del];
      if (!confirm(`Delete "${p.name}"?`)) return;
      lib.save(all.filter((x) => x !== p && x.name !== p.name)); renderLibrary();
    }
  };
}
function saveCurrent() {
  const code = $('code').value.trim(), name = $('saveName').value.trim().slice(0, 24);
  if (!code) { $('saveName').placeholder = 'nothing in the editor to save'; return; }
  if (!name) { $('saveName').focus(); return; }
  const list = lib.load().filter((p) => p.name !== name); // same name replaces
  list.push({ name, code: $('code').value, prompt: $('prompt').value.trim(), turns: S.turns, savedAt: Date.now() });
  if (!lib.save(list)) { log('! Could not save: storage is unavailable or full.\n'); return; }
  session.set(name);
  $('saveName').value = ''; status(`saved "${name}"`); renderLibrary();
}
$('heart').onclick = () => { $('saveName').value = suggestName(); renderLibrary(); $('library').showModal(); $('saveName').select(); };
$('saveBtn').onclick = saveCurrent;
$('saveName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveCurrent(); } });
