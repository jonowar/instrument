import { S } from './state.js';
import { esc, showUsage, usageText } from './usage.js';
import { $, post, speed } from './util.js';

// --- 🎛 Gear: real instruments that could play this sound ------------------------
// Claude reads the code and the prompts behind it and answers in a fixed JSON shape (see GEAR_SCHEMA
// in server.js). Prices are its estimates; links are store searches built here, never URLs Claude
// wrote, so they can't point at pages that don't exist. The last answer is kept per code version.
const gearCache = {
  load: () => { try { return JSON.parse(localStorage.getItem('gear-last') || 'null'); } catch { return null; } },
  save: (v) => { try { localStorage.setItem('gear-last', JSON.stringify(v)); } catch {} },
};
const usd = (n) => '$' + Math.round(n).toLocaleString();
const range = (r) => (r && r.high > 0 ? (r.low === r.high ? usd(r.low) : `${usd(r.low)}–${usd(r.high)}`) : '—');
// "Korg minilogue xd" with maker "Korg" -> "minilogue xd", since the maker is shown beside it
const modelName = (it) => (it.name.toLowerCase().startsWith(it.maker.toLowerCase() + ' ') ? it.name.slice(it.maker.length + 1) : it.name);
function renderGear(g) {
  const q = (t) => encodeURIComponent(t);
  $('gearBody').innerHTML = `
    <p class="summary">${esc(g.summary)}</p>
    <div class="rigs">${g.rigs.map((r) => `
      <div class="rig"><b>${esc(r.name)}</b><span class="total">≈ ${usd(r.total_new_usd)}</span>
        <div>${esc(r.items.join(' + '))}</div><div>${esc(r.note)}</div></div>`).join('')}</div>
    <div class="cards">${g.items.map((it) => `
      <div class="card">
        <h3>${esc(modelName(it))}<small>${esc(it.maker)}</small></h3>
        <div class="chips"><span class="chip">${esc(it.category)}</span><span class="chip ${esc(it.tier)}">${esc(it.tier)}</span></div>
        <div class="covers">Covers: ${esc(it.covers)}</div>
        <div class="why">${esc(it.why)}</div>
        <table>
          <tr><td>Synthesis</td><td>${esc(it.synthesis)}</td></tr>
          <tr><td>Voices</td><td>${esc(it.voices)}</td></tr>
          <tr><td>Form</td><td>${esc(it.form)}</td></tr>
          <tr><td>New</td><td class="price">${range(it.price_new_usd)}</td></tr>
          <tr><td>Used</td><td class="price">${range(it.price_used_usd)}</td></tr>
        </table>
        <div class="tip"><b>To get this sound:</b> ${esc(it.tip)}</div>
        <div class="links">
          <a href="https://www.sweetwater.com/store/search?s=${q(it.search)}" target="_blank" rel="noopener">Sweetwater ↗</a>
          <a href="https://reverb.com/marketplace?query=${q(it.search)}" target="_blank" rel="noopener">Reverb ↗</a>
        </div>
      </div>`).join('')}</div>`;
}
// The "thinking" animation: a line-drawn brain (side view) and notes on spiralling orbits. Each note
// gets its own speed, direction, radii, size and colour; negative delays spread them around the circle.
const THINK_BRAIN = `<svg viewBox="0 0 100 80">
  <path class="lobe" d="M20,55 C8,55 5,40 14,34 C10,22 22,14 32,18 C36,8 52,6 58,14 C66,6 82,10 84,22 C95,26 96,42 88,48 C92,58 82,66 72,62 C68,70 54,70 50,63 C44,68 32,66 30,58 C26,60 22,58 20,55 Z"/>
  <path d="M60,66 C60,71 62,75 66,77"/>
  <path class="fold" d="M48,13 C46,22 52,28 47,36 C43,44 50,50 47,60"/>
  <path class="fold" d="M26,30 C31,26 36,32 41,28"/>
  <path class="fold" d="M18,45 C24,41 29,47 36,43"/>
  <path class="fold" d="M31,53 C34,49 38,52 41,49"/>
  <path class="fold" d="M58,24 C63,29 68,22 74,27"/>
  <path class="fold" d="M57,40 C63,36 68,44 76,38 C79,36 82,38 84,36"/>
  <path class="fold" d="M62,54 C66,50 71,56 78,52"/>
</svg>`;
const THINK_NOTES = [
  ['♪', '22px', '4.2s', '0s',    '96px', '62px', '#7fd',    'normal'],
  ['♫', '26px', '5.6s', '-1.4s', '104px', '70px', '#c6fff0', 'normal'],
  ['♩', '18px', '3.8s', '-2.2s', '84px', '58px', '#5fd9bb', 'reverse'],
  ['♬', '24px', '6.4s', '-3.1s', '108px', '66px', '#9ff0da', 'normal'],
  ['♪', '16px', '4.8s', '-0.7s', '78px', '56px', '#c6fff0', 'reverse'],
  ['♫', '20px', '7.2s', '-4.5s', '100px', '74px', '#7fd',    'reverse'],
  ['♩', '15px', '5.2s', '-3.8s', '90px', '60px', '#5fd9bb', 'normal'],
].map(([g, s, d, delay, r1, r2, c, dir]) =>
  `<i class="note" style="--s:${s};--d:${d};--delay:${delay};--r1:${r1};--r2:${r2};--c:${c};--dir:${dir}">${g}</i>`).join('');
let gearBusy = false;
async function askGear() {
  const code = $('code').value;
  if (!code.trim()) { $('gearBody').innerHTML = '<div class="pending">Generate or write some code first; the gear suggestions are for the sound in the editor.</div>'; return; }
  if (gearBusy) return;
  gearBusy = true; $('gearRefresh').disabled = true;
  $('gearHint').textContent = ''; $('gearCost').innerHTML = '';
  $('gearBody').innerHTML = `<div class="think" aria-hidden="true">${THINK_BRAIN}${THINK_NOTES}</div>
    <div class="pending dots" style="padding-top:0">Listening to the code and thinking about gear</div>`;
  try {
    const t0 = performance.now();
    const { gear, usage } = await post('/gear', { code, prompts: S.turns.map((t) => t.prompt), ...speed() });
    const ms = performance.now() - t0;
    showUsage('gear', usage, ms);
    gearCache.save({ code, gear, usage, ms, at: Date.now() });
    $('gearCost').innerHTML = usageText(usage, ms);
    renderGear(gear);
    $('gearHint').textContent = 'for the code in the editor now';
  } catch (e) {
    $('gearBody').innerHTML = `<div class="pending">${esc(e.message)}</div>`;
  } finally {
    gearBusy = false; $('gearRefresh').disabled = false;
  }
}
$('gearBtn').onclick = () => {
  $('gear').showModal();
  if (gearBusy) return;
  const last = gearCache.load();
  if (last && last.code === $('code').value) { // same sound: no need to ask (and pay) again
    renderGear(last.gear);
    $('gearCost').innerHTML = last.usage ? 'this answer cost ' + usageText(last.usage, last.ms) + ' · reopening is free' : '';
    $('gearHint').textContent = `from ${new Date(last.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  } else askGear();
};
$('gearRefresh').onclick = askGear;
