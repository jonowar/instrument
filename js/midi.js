import { $ } from './util.js';

// --- MIDI piano roll ------------------------------------------------------
// ~midi (midi.scd) relays every message it is sent; here noteOn/noteOff pairs become bars.
const WINDOW_MS = 10000;
let notes = [];                 // {chan, note, vel, t0, t1|null}
let ticks = [];                 // non-note messages: {cmd, chan, t}
let lastMidi = '';
const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const noteName = (n) => NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

export function midiAllOff(chan) {
  const now = performance.now();
  for (const n of notes) if (n.t1 == null && (chan == null || n.chan === chan)) n.t1 = now;
}
export function onMidi({ cmd, args }) {
  const now = performance.now();
  // Drawing (which also prunes) pauses while the window is hidden, so prune here too or a long
  // pattern playing in the background would pile up notes.
  if (notes.length > 1000) notes = notes.filter((n) => n.t1 == null || n.t1 > now - WINDOW_MS);
  if (ticks.length > 1000) ticks = ticks.filter((t) => t.t > now - WINDOW_MS);
  const [chan, a, b] = args;
  if (cmd === 'noteOn' && b > 0) {
    midiAllOff_note(chan, a, now);
    notes.push({ chan, note: a, vel: b, t0: now, t1: null });
    lastMidi = `ch${chan + 1} ${noteName(a)} vel ${b}`;
  } else if (cmd === 'noteOff' || cmd === 'noteOn') {
    midiAllOff_note(chan, a, now);
  } else if (cmd === 'allNotesOff') {
    midiAllOff(chan);
  } else {
    ticks.push({ cmd, chan, t: now });
    lastMidi = `ch${chan + 1} ${cmd} ${args.slice(1).join(' ')}`;
  }
}
function midiAllOff_note(chan, note, now) {
  for (const n of notes) if (n.t1 == null && n.chan === chan && n.note === note) n.t1 = now;
}

const mcv = $('midi'), mg = mcv.getContext('2d');
new ResizeObserver(() => {
  const r = mcv.getBoundingClientRect(), d = devicePixelRatio || 1;
  mcv.width = Math.round(r.width * d); mcv.height = Math.round(r.height * d);
}).observe(mcv);
const chanColor = (c) => `hsl(${(170 + c * 47) % 360} 70% 62%)`; // channel 1 = the accent teal

function drawMidi() {
  requestAnimationFrame(drawMidi);
  const w = mcv.width, h = mcv.height, d = devicePixelRatio || 1, now = performance.now();
  mg.fillStyle = '#000'; mg.fillRect(0, 0, w, h);

  notes = notes.filter((n) => (n.t1 ?? now) > now - WINDOW_MS && now - n.t0 < 60000); // drop stuck notes after 60 s
  ticks = ticks.filter((t) => t.t > now - WINDOW_MS);
  if (!notes.length && !ticks.length) { $('midiInfo').textContent = 'midi · no notes yet. Notes played by patterns show here'; return; }

  // pitch range follows the music, with at least two octaves of room
  let lo = 127, hi = 0;
  for (const n of notes) { lo = Math.min(lo, n.note); hi = Math.max(hi, n.note); }
  if (hi < lo) { lo = 55; hi = 79; }
  const mid = (lo + hi) / 2, span = Math.max(hi - lo + 6, 24);
  const bottom = mid - span / 2, rowH = (h * 0.9) / span, top = h * 0.1;
  const yOf = (n) => h - (n - bottom + 0.5) * rowH * 0.9 - h * 0.02;

  mg.font = `${10 * d}px ui-monospace, Menlo, monospace`; mg.textBaseline = 'middle';
  for (let n = Math.ceil(bottom); n < bottom + span; n++) {
    if (n % 12 !== 0) continue; // a faint line and label at every C
    const y = Math.round(yOf(n)) + .5;
    mg.strokeStyle = '#1c1c1c'; mg.lineWidth = 1; mg.beginPath(); mg.moveTo(0, y); mg.lineTo(w, y); mg.stroke();
    mg.fillStyle = '#444'; mg.fillText(noteName(n), 4 * d, y - 6 * d);
  }
  const xOf = (t) => ((t - (now - WINDOW_MS)) / WINDOW_MS) * w;
  mg.strokeStyle = '#2a2a2a'; mg.beginPath(); mg.moveTo(w - 1, 0); mg.lineTo(w - 1, h); mg.stroke(); // "now"

  const barH = Math.max(3 * d, rowH * 0.8);
  for (const n of notes) {
    const x0 = Math.max(0, xOf(n.t0)), x1 = Math.max(x0 + 3 * d, xOf(n.t1 ?? now));
    mg.globalAlpha = 0.35 + 0.65 * (n.vel / 127);
    mg.fillStyle = chanColor(n.chan);
    mg.fillRect(x0, yOf(n.note) - barH / 2, x1 - x0, barH);
    if (n.t1 == null) { mg.globalAlpha = 1; mg.fillStyle = '#fff'; mg.fillRect(x1 - 2 * d, yOf(n.note) - barH / 2, 2 * d, barH); } // still held
  }
  mg.globalAlpha = 1;
  for (const t of ticks) { // control change, bend etc. as ticks along the top
    const x = xOf(t.t); mg.fillStyle = chanColor(t.chan);
    mg.beginPath(); mg.moveTo(x, top - 6 * d); mg.lineTo(x - 3 * d, top - 12 * d); mg.lineTo(x + 3 * d, top - 12 * d); mg.fill();
  }
  const held = notes.filter((n) => n.t1 == null).length;
  $('midiInfo').textContent = `midi · ${lastMidi}${held ? ` · ${held} held` : ''}`;
}
drawMidi();
