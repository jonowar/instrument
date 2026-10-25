import { S } from './state.js';
import { hasKey, loadKey, openConnect } from './connect.js';
import { renderGutter } from './editor.js';
import { onRunIssue } from './errors.js';
import { $, hooks, post } from './util.js';

// --- setup screen: shown instead of the app until SuperCollider is installed ------
const keyLoaded = loadKey();
fetch('/status').then((r) => r.json()).then(async (st) => {
  if (st.supercollider) { await keyLoaded; if (!hasKey()) openConnect(); return; } // setup first, then connect
  $('setupPaths').textContent = 'AnInstrument looks for it in: ' + st.paths.map((p) => p.replace(/\/Contents\/MacOS\/sclang$/, '')).join(', ');
  $('setup').hidden = false;
}).catch(() => {});
$('recheck').onclick = async () => {
  $('setupStatus').textContent = 'Checking…';
  try {
    const { supercollider } = await post('/recheck', {});
    if (supercollider) {
      $('setupStatus').textContent = 'Found it! Starting SuperCollider…';
      setTimeout(() => location.reload(), 1500); // reconnect so the page gets the fresh audio state
    } else {
      $('setupStatus').textContent = 'Still not found. Is SuperCollider.app in your Applications folder?';
    }
  } catch (e) { $('setupStatus').textContent = e.message; }
};

const logEl = $('log');
export function log(t) {
  logEl.textContent += t; logEl.scrollTop = logEl.scrollHeight;
  // sclang names the line of a syntax error ("line 3 char 7"); the run file starts the code on line 1,
  // so it's the editor's line too. Mark the first one in the gutter.
  const at = !S.errLine && S.watchForError && t.match(/line (\d+) char \d+/);
  if (at && +at[1] <= $('code').value.split('\n').length) { S.errLine = +at[1]; renderGutter(); }
  if (S.watchForError) {
    const kind = /ERROR:/.test(t) ? 'error' : /WARNING:/.test(t) ? 'warning' : null;
    if (kind) onRunIssue(kind);
  }
}

hooks.log = log;
