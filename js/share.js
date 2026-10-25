import { S } from './state.js';
import { session } from './conversation.js';
import { midiAllOff } from './midi.js';
import { activeParts } from './parts.js';
import { mmss } from './record.js';
import { suggestName } from './saved.js';
import { log } from './setup.js';
import { esc } from './usage.js';
import { $, guard, post, pref, setPref, status } from './util.js';

// --- ⤴ Share: publish the code (and the last take) as a link --------------------------------------
// The server does the upload (see share/) and hands back the link plus a token. The token is kept
// here, so only the app that made a share can take it down again.
const shares = {
  load: () => { try { return JSON.parse(localStorage.getItem('shares') || '[]'); } catch { return []; } },
  save: (l) => { try { localStorage.setItem('shares', JSON.stringify(l)); } catch {} },
};
const shareMsg = (t, kind = '') => { $('shareMsg').className = 'hint ' + kind; $('shareMsg').textContent = t; };
const shareDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
function renderShares() {
  const list = shares.load().sort((a, b) => b.at - a.at);
  $('shareList').innerHTML = list.map((s, i) => `
    <li>
      <span class="name"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.id)}</a></span>
      <span class="when">${s.audio ? '♪ ' : ''}${new Date(s.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
      <button type="button" data-copy-share="${i}">Copy</button>
      <button type="button" data-unshare="${i}">Unshare</button>
    </li>`).join('');
}
$('shareList').onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const all = shares.load().sort((a, c) => c.at - a.at); // the order renderShares drew
  if (b.dataset.copyShare != null) {
    const s = all[+b.dataset.copyShare];
    try { await navigator.clipboard.writeText(s.url); b.textContent = 'Copied ✓'; } catch { b.textContent = 'Copy failed'; }
    setTimeout(() => (b.textContent = 'Copy'), 1500);
    return;
  }
  if (b.dataset.unshare == null) return;
  const s = all[+b.dataset.unshare];
  if (!confirm(`Unshare "${s.title || s.id}"? The link stops working for everyone who has it, and the audio is deleted.`)) return;
  b.disabled = true;
  try {
    const r = await post('/unshare', { id: s.id, token: s.token });
    shares.save(shares.load().filter((x) => x.id !== s.id));
    renderShares();
    shareMsg(r.gone ? 'That one had already gone.' : 'Unshared.', 'ok');
    status('unshared');
  } catch (err) { shareMsg(err.message, 'err'); b.disabled = false; }
};
function openShare() {
  const code = $('code').value, take = S.rec.take;
  $('sharePre').hidden = false; $('sharePost').hidden = true;
  shareMsg('');
  $('shareWhat').textContent = code.trim()
    ? `${code.split('\n').length} lines${take ? ` · a ${mmss(take.seconds)} take` : ''}` : '';
  $('shareTitle').value = session.get() || suggestName(true);
  $('shareAudioRow').hidden = !take;
  if (take) { $('shareAudio').checked = true; $('shareAudioLen').textContent = `(${mmss(take.seconds)})`; }
  $('shareGo').disabled = !code.trim();
  if (!code.trim()) shareMsg('Nothing in the editor to share yet.', 'err');
  renderShares();
  if (!$('shareDlg').open) $('shareDlg').showModal();
  $('shareTitle').select();
}
$('shareBtn').onclick = openShare;
$('takeShare').onclick = () => { $('takeDlg').close(); openShare(); };
$('shareGo').onclick = async () => {
  const code = $('code').value;
  if (!code.trim()) return;
  const take = S.rec.take, withAudio = !!take && $('shareAudio').checked;
  $('shareGo').disabled = true; $('shareGo').classList.add('busy'); $('shareGoLabel').textContent = 'Uploading'; $('shareGoLabel').classList.add('dots');
  shareMsg(withAudio ? 'Uploading the code and the take…' : 'Uploading the code…');
  status('sharing…');
  try {
    const r = await post('/share', {
      code, title: $('shareTitle').value, parts: activeParts(code),
      audio: withAudio, takeId: withAudio ? take.id : undefined,
    });
    shares.save([{ id: r.id, url: r.url, token: r.token, title: $('shareTitle').value.trim(),
      at: Date.now(), expiresAt: r.expiresAt, audio: withAudio }, ...shares.load().filter((s) => s.id !== r.id)]);
    $('sharePre').hidden = true; $('sharePost').hidden = false;
    $('shareLink').value = r.url;
    $('shareExpires').textContent = `Anyone with this link can open it. It stops working on ${shareDate(r.expiresAt)}.`;
    renderShares();
    try { await navigator.clipboard.writeText(r.url); shareMsg('Link copied to the clipboard.', 'ok'); }
    catch { $('shareLink').select(); shareMsg('Copy the link above to send it.', 'ok'); }
    status('shared');
  } catch (e) {
    shareMsg(e.message, 'err');
    log('! ' + e.message + '\n');
    status('');
  } finally { $('shareGo').disabled = false; $('shareGo').classList.remove('busy'); $('shareGoLabel').classList.remove('dots'); $('shareGoLabel').textContent = 'Share'; }
};
$('shareCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('shareLink').value); shareMsg('Link copied.', 'ok'); }
  catch { $('shareLink').select(); shareMsg('Press ⌘C to copy the link.', ''); }
};
$('shareOpen').onclick = () => window.open($('shareLink').value, '_blank', 'noopener');

// Fade out: fades the whole output over the chosen seconds, then finishes the take and stops (record.scd)
let fade = { fading: false }, fadeTick = null;
const FADE_TITLE = $('fadeBtn').title;
$('fadeSecs').value = pref('fadeSecs', '8');
$('fadeSecs').onchange = () => {
  const v = Math.min(300, Math.max(1, Math.round(+$('fadeSecs').value || 8)));
  $('fadeSecs').value = v; setPref('fadeSecs', String(v));
};
export function onFade(f) {
  const prev = fade; fade = f;
  const b = $('fadeBtn');
  clearInterval(fadeTick);
  b.classList.toggle('on', f.fading);
  b.title = f.fading ? 'Fading out. Press to cancel and bring the sound back.' : FADE_TITLE;
  if (f.fading) {
    const show = () => (b.textContent = `↘ ${Math.max(0, Math.ceil(f.seconds - (Date.now() - f.startedAt) / 1000))}s`);
    show(); fadeTick = setInterval(show, 250);
    if (!prev.fading) status('fading out…');
  } else {
    b.textContent = '↘ Fade';
    if (prev.fading && f.done) { midiAllOff(); if (S.rec.state === 'idle') status('faded out'); }
  }
}
$('fadeBtn').onclick = guard(async () => {
  if (fade.fading) { await post('/fade', { cancel: true }); status(''); return; }
  $('fadeSecs').onchange();
  await post('/fade', { seconds: +$('fadeSecs').value });
});
