import { S } from './state.js';
import { sendRun, sessionFileName } from './conversation.js';
import { log } from './setup.js';
import { $, guard, post, status } from './util.js';

// --- recording: ⏺ Rec records the output (record.scd); a finished take saves as WAV or MP3 --------
let recTick = null;
const REC_TITLE = $('recBtn').title;
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export function onRecord(r) {
  const prev = S.rec; S.rec = r;
  const b = $('recBtn');
  clearInterval(recTick);
  b.classList.toggle('on', r.state === 'recording');
  b.classList.toggle('busy', r.state === 'starting' || r.state === 'stopping');
  if (r.state === 'recording') {
    const show = () => (b.textContent = '⏺ ' + mmss((Date.now() - r.startedAt) / 1000));
    show(); recTick = setInterval(show, 500);
  } else b.textContent = r.state === 'starting' ? '⏺ starting…' : r.state === 'stopping' ? '⏺ finishing…' : '⏺ Rec';
  b.title = r.state === 'recording' ? 'Recording. Press to finish the take (Stop doesn\'t end it).' : REC_TITLE;
  if (r.state === 'recording' && prev.state !== 'recording') status('recording');
  if (r.state === 'recording' || r.state === 'idle') {
    const w = recWaiters; recWaiters = [];
    // the error is already in the log (above), so the waiter fails quietly
    for (const { ok, fail } of w) r.state === 'recording' ? ok() : fail(Object.assign(new Error(r.error || "the recording didn't start"), { logged: !!r.error }));
  }
  if (r.error && r.error !== prev.error) { log(`! ${r.error}\n`); status(''); }
  const t = r.take;
  $('takeBtn').hidden = !t;
  if (t) $('takeBtn').textContent = '⬇ take ' + mmss(t.seconds);
  // a new take just finished: offer to save it
  if (t && t.id !== prev.take?.id && prev.state !== 'idle') { status('recorded'); openTake(); }
}
// Run + Rec: the code runs only once the recorder is running, so the take starts before the first note
let recWaiters = [];
const recStarted = () => new Promise((ok, fail) => {
  recWaiters.push({ ok, fail });
  setTimeout(() => fail(new Error("the recording didn't start")), 10000);
});
export const runRec = guard(async () => {
  if (S.rec.state === 'stopping') { status('wait: the last take is finishing'); return; }
  if (S.rec.state !== 'recording') {
    const started = recStarted();
    if (S.rec.state === 'idle') await post('/record', { on: true });
    await started;
  }
  await sendRun(false);
  status('recording');
});
$('runRec').onclick = runRec;
$('recBtn').onclick = guard(async () => {
  if (S.rec.state === 'stopping') return;
  await post('/record', { on: S.rec.state === 'idle' });
});
function openTake() {
  const t = S.rec.take; if (!t) return;
  $('takeInfo').textContent = `${mmss(t.seconds)} · ${new Date(Number(t.id)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${t.notes || 'no'} note${t.notes === 1 ? '' : 's'}`;
  $('takeMid').disabled = !t.notes;
  $('takeMid').title = t.notes ? MID_TITLE : 'No notes were played during this take (only patterns\' notes and ~midi are captured, not Ndefs)';
  $('takeNote').className = 'hint';
  $('takeNote').textContent = 'The take is kept until the app quits, or until the next recording replaces it (⬇ take, next to 🧾 Usage, reopens this).';
  if (!$('takeDlg').open) $('takeDlg').showModal();
}
$('takeBtn').onclick = openTake;
// name: the saved file's name ('' keeps the server's, "AnInstrument <date time>.<ext>")
const download = (href, name = '') => { const a = document.createElement('a'); a.href = href; a.download = name; document.body.append(a); a.click(); a.remove(); };
const takeFile = (id, ext) => download(`/take/${id}.${ext}`, sessionFileName(ext, Number(id)) || '');
$('takeWav').onclick = () => takeFile(S.rec.take.id, 'wav');
const MID_TITLE = $('takeMid').title;
$('takeMid').onclick = () => takeFile(S.rec.take.id, 'mid');
$('takeMp3').onclick = async () => {
  const b = $('takeMp3'), id = S.rec.take.id;
  b.disabled = true; b.textContent = 'Making MP3'; b.classList.add('dots');
  try {
    await post('/take-mp3', { id });
    takeFile(id, 'mp3');
  } catch (e) {
    $('takeNote').className = 'hint err'; $('takeNote').textContent = e.message;
  } finally { b.disabled = false; b.classList.remove('dots'); b.textContent = 'Save MP3'; }
};
