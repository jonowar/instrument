import { S } from './state.js';
import { midiAllOff } from './midi.js';
import { log } from './setup.js';
import { $, post, status } from './util.js';

// --- oscilloscope + level meters ----------------------------------------
const cv = $('scope'), g = cv.getContext('2d');
      // latest Float32Array snapshot from scsynth (every 2nd sample of ~43 ms)
new ResizeObserver(() => {
  const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
  cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
}).observe(cv);

// Levels come from SendPeakRMS in scsynth, 20 times a second, measured on every sample.
const levels = { peak: [0, 0], rms: [0, 0], hold: [0, 0], holdAt: [0, 0], at: 0 };
let clipUntil = 0;              // the clip light stays on for 3 s after any sample reaches full scale
const CLIP_MS = 3000, HOLD_MS = 1500;
export function onLevels([pl, rl, pr, rr]) {
  const now = performance.now();
  levels.peak = [pl, pr]; levels.rms = [rl, rr]; levels.at = now;
  for (const c of [0, 1]) {
    if (levels.peak[c] >= levels.hold[c] || now - levels.holdAt[c] > HOLD_MS) { levels.hold[c] = levels.peak[c]; levels.holdAt[c] = now; }
  }
  if (Math.max(pl, pr) >= 1) clipUntil = now + CLIP_MS;
}
const toDb = (a) => 20 * Math.log10(Math.max(a, 1e-6));
const DB_MIN = -60, DB_MAX = 3;
const dbFrac = (a) => Math.min(1, Math.max(0, (toDb(a) - DB_MIN) / (DB_MAX - DB_MIN)));

// --- audio status: device, restart, sample-rate warning ---
let audio = { running: false, nominal: 0, actual: 0, device: null };
let notRunning = 0, rateOff = 0, restarting = false;
const esc2 = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export function onAudio(a) {
  audio = a;
  if (!a.running) { notRunning++; rateOff = 0; }
  else {
    notRunning = 0;
    if (restarting) { restarting = false; log('\naudio restarted' + (a.device ? ` on ${a.device}` : '') + '. Press Run to start your code again.\n'); }
    // actual is measured, so it wobbles slightly; a real mismatch is large (e.g. 24 kHz vs 48 kHz)
    const off = a.nominal > 0 && a.actual > 0 && Math.abs(a.actual - a.nominal) / a.nominal > 0.03;
    rateOff = off ? rateOff + 1 : 0;
  }
  updateAudioWarn();
  renderOutNote();
}
function updateAudioWarn() {
  let msg = '';
  if (restarting) msg = '';
  else if (rateOff >= 2) msg = `The output is running at ${(audio.actual / 1000).toFixed(1)} kHz but scsynth expects ${(audio.nominal / 1000).toFixed(1)} kHz, so sound will be distorted and out of tune. Bluetooth headphones such as AirPods switch to a low-quality call mode while anything is using their microphone. To fix it: open System Settings → Sound → Input and choose the MacBook’s microphone instead of the headphones, quit any app showing the orange mic dot in Control Center (video calls, dictation, voice apps), then press Restart audio.`;
  else if (notRunning >= 5) msg = 'The audio server isn’t running (see the log for why). Check the output device, then restart audio.';
  // scsynth booted on a device that was already in a low-rate mode, so the rates agree but music suffers
  else if (audio.running && audio.nominal > 0 && audio.nominal < 44100) msg = `The output is running at only ${(audio.nominal / 1000).toFixed(audio.nominal % 1000 ? 1 : 0)} kHz (music needs 44.1 or 48), so sound will be grainy and muffled. Bluetooth headphones drop to this call-quality mode while an app is using their mic. To fix it: open System Settings → Sound → Input and choose the MacBook’s microphone instead of the headphones, quit any app showing the orange mic dot in Control Center, then press Restart audio.`;
  $('audioWarn').hidden = !msg;
  $('audioWarnText').textContent = msg;
}
async function restartAudio() {
  S.runBase = null;
  restarting = true; notRunning = 0; rateOff = 0; updateAudioWarn();
  midiAllOff(); S.frame = null;
  try { await post('/restart-audio', {}); status('restarting audio…'); }
  catch (e) { restarting = false; log('! ' + e.message + '\n'); }
}
$('restartAudio').onclick = restartAudio;

// --- output device dropdown ---
let devices = { list: [], selected: null };   // selected null = system default
export function onDevices(d) { devices = d; renderDevices(); }
function renderDevices() {
  const sel = $('outDevice');
  const opts = [['', 'System default'], ...devices.list.map((n) => [n, n])];
  // the saved device may be unplugged; keep it listed so the choice is visible
  if (devices.selected && !devices.list.includes(devices.selected)) opts.push([devices.selected, devices.selected + ' (not connected)']);
  const html = opts.map(([v, label]) => `<option value="${esc2(v)}">${esc2(label)}</option>`).join('');
  if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; } // don't disturb an open menu needlessly
  sel.value = devices.selected || '';
  renderOutNote();
}
function renderOutNote() {
  // what scsynth actually opened, when that differs from the choice or the choice is "System default"
  let note = '';
  if (audio.device) {
    if (!devices.selected) note = audio.device;
    else if (audio.device !== devices.selected) note = `using ${audio.device}`;
  }
  if ($('outNote').textContent !== note) {
    $('outNote').textContent = note;
    $('outNote').title = note.startsWith('using') ? `${devices.selected} isn't connected, so scsynth is using ${audio.device}` : '';
  }
}
$('outDevice').onchange = async (e) => {
  const device = e.target.value || null;
  restarting = true; notRunning = 0; rateOff = 0; updateAudioWarn();
  midiAllOff(); S.frame = null;
  try { await post('/audio-device', { device }); status('switching output…'); }
  catch (err) { restarting = false; log('! ' + err.message + '\n'); }
};
$('audioWarnBtn').onclick = restartAudio;

function drawScope() {
  requestAnimationFrame(drawScope);
  const w = cv.width, h = cv.height, d = devicePixelRatio || 1, now = performance.now();
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const meterW = 44 * d, sw = w - meterW;   // waveform area | L/R meters on the right
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);

  g.lineWidth = 1; g.strokeStyle = '#1c1c1c'; g.beginPath();
  for (let i = 1; i < 8; i++) { const x = Math.round(sw * i / 8) + .5; g.moveTo(x, 0); g.lineTo(x, h); }
  for (let i = 1; i < 4; i++) { const y = Math.round(h * i / 4) + .5; g.moveTo(0, y); g.lineTo(sw, y); }
  g.stroke();
  g.strokeStyle = '#333'; g.beginPath(); g.moveTo(0, h / 2 + .5); g.lineTo(sw, h / 2 + .5); g.stroke();
  g.strokeStyle = '#222'; g.beginPath(); g.moveTo(sw + .5, 0); g.lineTo(sw + .5, h); g.stroke();

  // waveform: trigger on a rising zero crossing in the first half so periodic sounds hold still
  if (S.frame && S.frame.length >= 8) {
    const n = S.frame.length >> 1;
    let start = 0;
    for (let i = 1; i < n; i++) if (S.frame[i - 1] < 0 && S.frame[i] >= 0) { start = i; break; }
    g.strokeStyle = accent; g.lineWidth = 1.5 * d; g.lineJoin = 'round'; g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * sw;
      const y = h / 2 - Math.max(-1.1, Math.min(1.1, S.frame[start + i])) * (h / 2) * 0.9;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }

  // meters: RMS bar, peak line, held peak tick; scale -60..+3 dBFS with marks at 0, -6, -12, -24, -48
  const live = now - levels.at < 500;   // no reports (server down) -> empty meters
  const top = 34 * d, bot = h - 18 * d, mh = bot - top, barW = 10 * d;
  const yOf = (frac) => bot - frac * mh;
  const clipping = now < clipUntil;
  g.font = `${9 * d}px ui-monospace, Menlo, monospace`; g.textBaseline = 'middle'; g.textAlign = 'right';
  for (const db of [0, -6, -12, -24, -48]) {
    const y = Math.round(yOf((db - DB_MIN) / (DB_MAX - DB_MIN))) + .5;
    g.fillStyle = db === 0 ? '#844' : '#3a3a3a';
    g.fillRect(sw + 6 * d, y, meterW - 26 * d, 1);
    g.fillStyle = '#555'; g.fillText(String(db), w - 3 * d, y);
  }
  for (const c of [0, 1]) {
    const x = sw + 6 * d + c * (barW + 3 * d);
    g.fillStyle = '#111'; g.fillRect(x, top, barW, mh);
    if (!live) continue;
    const rms = dbFrac(levels.rms[c]), pk = dbFrac(levels.peak[c]), hold = dbFrac(levels.hold[c]);
    const peakDb = toDb(levels.peak[c]);
    g.fillStyle = peakDb >= 0 ? '#e44' : peakDb > -6 ? '#e8c547' : accent;
    g.globalAlpha = 0.55; g.fillRect(x, yOf(pk), barW, pk * mh); // peak, translucent
    g.globalAlpha = 1;    g.fillRect(x, yOf(rms), barW, rms * mh); // RMS (loudness), solid
    g.fillStyle = toDb(levels.hold[c]) >= 0 ? '#f66' : '#ddd';
    g.fillRect(x, yOf(hold) - 1 * d, barW, 2 * d);              // held peak
  }
  // clip light above the meters, and L / R labels below
  g.fillStyle = clipping ? '#f33' : '#311';
  g.fillRect(sw + 6 * d, top - 12 * d, barW * 2 + 3 * d, 7 * d);
  g.textAlign = 'center'; g.fillStyle = '#555';
  g.fillText('L', sw + 6 * d + barW / 2, h - 9 * d); g.fillText('R', sw + 9 * d + barW * 1.5, h - 9 * d);

  // header: peak in dBFS and clip on the first line, the output device on the second
  const parts = ['scope'];
  if (restarting) parts.push('restarting audio…');
  else if (!audio.running && notRunning < 5) parts.push('starting audio…');
  if (live) {
    const pk = Math.max(levels.peak[0], levels.peak[1]);
    parts.push(`peak ${pk < 1e-5 ? '−∞' : toDb(pk).toFixed(1)} dB`);
  }
  let html = '<div>' + parts.join(' · ') + (clipping ? ' <span class="clip">CLIP</span>' : '') + '</div>';
  if ($('scopeInfo').innerHTML !== html) $('scopeInfo').innerHTML = html;
}
drawScope();
