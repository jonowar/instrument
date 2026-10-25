import { S } from './state.js';
import { onAudio, onDevices, onLevels } from './audio.js';
import { openConnect } from './connect.js';
import { converse, sendRun } from './conversation.js';
import { shellLines } from './editor.js';
import { onMidi } from './midi.js';
import { renderParts } from './parts.js';
import { onRecord } from './record.js';
import { log } from './setup.js';
import { onFade } from './share.js';
import { showUsage, usageText } from './usage.js';
import { $, post, pref, setPref, speed, status } from './util.js';

// --- error tile: send sclang's output to Claude for an explanation (never rewrites the code) ---
// Warnings get the same treatment as errors: the code ran, but something in it deserves fixing
// (a deprecated name, a missing SynthDef, a bad argument that sclang worked around).
/** @type {ReturnType<typeof setTimeout>} */
let errTimer;
let runIssue = null;    // 'warning' or 'error': the worst sclang has printed since the last Run
let lastAnalysis = '';  // Claude's explanation, once we have one
export const hideTile = () => { S.shellTile = false; clearTimeout(errTimer); runIssue = null; lastAnalysis = ''; $('fixBtn').hidden = true; $('errTile').hidden = true; };
// The warning for shell commands in the code. It shares the error tile, never goes to Claude, and gives way
// to a real sclang error or warning.
export function syncShellWarn() {
  const lines = shellLines($('code').value);
  if (!lines.length) { if (S.shellTile) hideTile(); return; }
  if (!$('errTile').hidden && !S.shellTile) return;
  showTile(`${lines.length === 1 ? 'Line ' + lines[0] : 'Lines ' + lines.join(', ')} of this code runs a shell command (unixCmd). It can do anything to this Mac, so read it before you press Run, and remove it unless you wrote it.`);
  S.shellTile = true;
  $('errKind').textContent = 'warning'; $('errTile').classList.add('warn'); $('reanalyze').hidden = true;
}
function showTile(text, pending) {
  S.shellTile = false; $('reanalyze').hidden = false;
  if (pending) $('errCost').innerHTML = ''; // a new analysis is on its way
  $('errTile').hidden = false;
  $('errBody').textContent = pending ? text.replace(/…$/, '') : text;
  $('errBody').classList.toggle('pending', !!pending);
  $('errBody').classList.toggle('dots', !!pending);
}
// Errors and warnings from a Run are always explained. Auto-fix (off by default) goes on to Fix and run
// again, at most AUTO_FIX_TRIES times per Run, so a fix that keeps failing can't loop.
export const AUTO_FIX_TRIES = 2;

$('autoFix').checked = pref('auto-fix', '0') === '1';
$('autoFix').onchange = (e) => setPref('auto-fix', e.target.checked ? '1' : '0');
export function onRunIssue(kind) {
  if (runIssue === kind || runIssue === 'error') return; // only escalate, warning -> error
  if (kind === 'error') S.runBase = null; // some of it may not have run, so the next live edit sends everything
  runIssue = kind;
  $('errKind').textContent = 'sclang ' + kind;
  $('errTile').classList.toggle('warn', kind === 'warning');
  const what = kind === 'error' ? 'an error' : 'a warning';
  clearTimeout(errTimer);
  if (S.liveRunning) { showTile(`A live edit produced ${what}. Not sent to Claude while you type; press Explain to ask.`); return; }
  showTile(`${what} in sclang output…`, true);
  // let sclang finish printing (an error dump, or an error after the warning), then analyze once
  errTimer = setTimeout(() => { S.watchForError = false; analyze(); }, 1500);
}
async function analyze() {
  showTile('Claude is explaining…', true);
  lastAnalysis = ''; $('fixBtn').hidden = true;
  try {
    const t0 = performance.now();
    const { analysis, usage } = await post('/analyze', { model: speed().model });
    if (analysis) {
      const ms = performance.now() - t0;
      showUsage('analysis', usage, ms);
      $('errCost').innerHTML = usageText(usage, ms);
    }
    showTile(analysis ?? 'No sclang errors or warnings since the last Run.', !analysis);
    if (analysis) { lastAnalysis = analysis; $('fixBtn').hidden = false; }
  } catch (e) {
    showTile(e.message);
    if (['no_key', 'bad_key', 'no_credit'].includes(e.code)) openConnect(e.code);
    return;
  }
  if (lastAnalysis && $('autoFix').checked && !S.liveRunning) {
    if ($('code').value !== S.lastRunCode) $('errBody').textContent += "\n\n(Not auto-fixed: you've edited the code since that Run. Press Fix to use this anyway.)";
    else if (S.autoFixLeft <= 0) $('errBody').textContent += `\n\n(Auto-fix tried ${AUTO_FIX_TRIES} times on this Run; over to you.)`;
    else { S.autoFixLeft--; await fix(true); }
  }
}
$('reanalyze').onclick = analyze;
// isAuto: from auto-fix, which then runs the fixed code (a manual Fix leaves it for you to review)
async function fix(isAuto) {
  if (!lastAnalysis) return;
  if (!isAuto && $('code').value !== S.lastRunCode && !confirm('The editor has changed since that Run. Replace it with the fixed version of the code that was run?')) return;
  const analysis = lastAnalysis, what = runIssue === 'warning' ? 'ran but printed a warning' : 'failed to run';
  $('fixBtn').disabled = true; status(isAuto ? 'fixing… (auto-fix)' : 'fixing…');
  try {
    const { truncated } = await converse(
      `Fix: this code ${what}. Here is an analysis of the sclang output:\n\n${analysis}\n\nFix the code based on this analysis. Return the full corrected code.`,
      'fix', S.lastRunCode);
    hideTile();
    if (truncated) { status('cut off!'); return; }
    if (isAuto) { await sendRun(false, true); status('fixed and running again (auto-fix)'); }
    else status('fixed — review, then Run');
  } catch (e) {
    status(''); log('! ' + e.message + '\n');
    if (['no_key', 'bad_key', 'no_credit'].includes(e.code)) openConnect(e.code);
  } finally {
    $('fixBtn').disabled = false;
  }
}
$('fixBtn').onclick = () => fix(false);
$('dismiss').onclick = hideTile;
// The socket carries logs, meters and the scope. If it drops (sleep, a hiccup), reconnect by itself;
// the server sends the current audio/parts/record state again on every new connection.
let wsDown = false, wsDelay = 500;
function connectWs() {
  const ws = new WebSocket(`ws://${location.host}`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { wsDelay = 500; if (wsDown) { wsDown = false; log('[reconnected to server]\n'); } };
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') { S.frame = new Float32Array(e.data); return; }
    const m = JSON.parse(e.data);
    if (m.type === 'log') log(m.data);
    else if (m.type === 'midi') onMidi(m.data);
    else if (m.type === 'levels') onLevels(m.data);
    else if (m.type === 'audio') onAudio(m.data);
    else if (m.type === 'devices') onDevices(m.data);
    else if (m.type === 'parts') { S.parts = m.data; renderParts(); }
    else if (m.type === 'record') onRecord(m.data);
    else if (m.type === 'fade') onFade(m.data);
  };
  ws.onclose = () => {
    if (!wsDown) { wsDown = true; log('\n[disconnected from server, reconnecting…]\n'); }
    setTimeout(connectWs, wsDelay);
    wsDelay = Math.min(wsDelay * 2, 5000);
  };
}
connectWs();
