import { openConnect } from './connect.js';
import { showUsage, usageText } from './usage.js';
import { $, post, speed } from './util.js';

// --- Learn: a step-by-step walk through the code (or the selected lines), and questions about it ---
// Everything the model writes is added as text, never as HTML. The only links are SuperCollider's own
// class docs, built here from a class name that passed a strict pattern, never a URL the model wrote.
const learn = { key: null, ex: null, qa: [], busy: false };
const lineAt = (text, pos) => text.slice(0, pos).split('\n').length;
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function selectLines(from, to) {
  const ta = $('code'), lines = ta.value.split('\n');
  if (!(from >= 1 && to >= from && to <= lines.length)) return;
  const start = lines.slice(0, from - 1).reduce((n, l) => n + l.length + 1, 0);
  const end = start + lines.slice(from - 1, to).join('\n').length;
  ta.focus(); ta.setSelectionRange(start, end);
  ta.scrollTop = Math.max(0, (from - 1) * (ta.scrollHeight / lines.length) - ta.clientHeight / 3);
  $('marks').scrollTop = $('gutter').scrollTop = ta.scrollTop;
}
function renderLearn() {
  const body = $('learnBody'), ex = learn.ex;
  body.replaceChildren();
  if (ex) {
    body.append(mk('p', 'overview', ex.overview));
    if (ex.steps.length) body.append(mk('h4', '', 'Step by step · click to select the lines'));
    for (const st of ex.steps) {
      const d = mk('div', 'step');
      d.tabIndex = 0;
      d.append(mk('div', 'lines', st.from === st.to ? `line ${st.from}` : `lines ${st.from}–${st.to}`), mk('p', 'what', st.what), mk('p', 'why', st.why));
      const go = () => selectLines(st.from, st.to);
      d.onclick = go; d.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      body.append(d);
    }
    if (ex.concepts.length) body.append(mk('h4', '', 'Worth knowing'));
    for (const c of ex.concepts) {
      const p = mk('p', 'concept'), t = mk('span', 'term');
      if (/^[A-Z][A-Za-z0-9]{1,40}$/.test(c.term)) { // a class name: link to SuperCollider's own docs
        const a = mk('a', '', c.term);
        a.href = `https://doc.sccode.org/Classes/${c.term}.html`; a.target = '_blank'; a.rel = 'noopener';
        a.title = 'Open its page in the SuperCollider docs'; t.append(a);
      } else t.textContent = c.term;
      p.append(t, mk('span', 'meaning', ' · ' + c.meaning));
      body.append(p);
    }
    if (ex.try.length) body.append(mk('h4', '', 'Try it · click to put it in the prompt'));
    for (const t of ex.try) {
      const d = mk('div', 'try');
      d.tabIndex = 0;
      d.append(mk('p', '', t.change), mk('p', 'hear', '→ ' + t.hear));
      const use = () => { $('prompt').value = t.change; $('prompt').focus(); };
      d.onclick = use; d.onkeydown = (e) => { if (e.key === 'Enter') use(); };
      body.append(d);
    }
  }
  if (learn.qa.length) body.append(mk('h4', '', 'Your questions'));
  for (const t of learn.qa) {
    const d = mk('div', 'qa');
    d.append(mk('p', 'q', t.q), mk('p', 'a', t.a === null ? 'thinking' : t.a));
    if (t.a === null) d.lastChild.classList.add('dots');
    body.append(d);
  }
}
function showLearnError(e) {
  $('learnBody').replaceChildren(mk('div', 'pending', e.message));
  if (['no_key', 'bad_key', 'no_credit'].includes(e.code)) openConnect(e.code);
}
async function explainCode() {
  const ta = $('code'), code = ta.value;
  $('learn').hidden = false;
  if (!code.trim()) { learn.ex = null; renderLearn(); $('learnBody').prepend(mk('div', 'pending', 'Generate or write some code first, then press Learn.')); return; }
  if (learn.busy) return;
  let from, to;
  if (ta.selectionEnd > ta.selectionStart) { // the lines the selection touches
    from = lineAt(code, ta.selectionStart);
    to = lineAt(code, ta.selectionEnd - (code[ta.selectionEnd - 1] === '\n' ? 1 : 0));
  }
  const key = `${from ?? ''}-${to ?? ''}:${code}`;
  if (learn.key === key && learn.ex) { renderLearn(); return; } // same code and lines: no need to ask (and pay) again
  learn.busy = true; $('learnAgain').disabled = true;
  $('learnHint').textContent = from ? `lines ${from}–${to}` : 'the whole piece';
  $('learnCost').textContent = '';
  // keep the panel the size it was while the new explanation is on its way; it resizes when that arrives
  const h = $('learn').offsetHeight;
  if (h) $('learn').style.height = h + 'px';
  $('learnBody').replaceChildren(mk('div', 'pending dots', 'Reading the code'));
  try {
    const t0 = performance.now();
    const { explanation, usage } = await post('/explain', { code, from, to, ...speed() });
    const ms = performance.now() - t0;
    showUsage('explain', usage, ms);
    $('learnCost').innerHTML = usageText(usage, ms);
    learn.ex = explanation; learn.key = key;
    renderLearn();
  } catch (e) { learn.ex = null; showLearnError(e); }
  finally { learn.busy = false; $('learnAgain').disabled = false; $('learn').style.height = ''; }
}
async function askAbout(q) {
  if (learn.busy) return;
  learn.busy = true; $('learnSend').disabled = true;
  const turn = { q, a: null };
  const history = learn.qa.filter((t) => t.a !== null);
  learn.qa.push(turn); renderLearn();
  $('learnBody').lastElementChild?.scrollIntoView({ block: 'nearest' });
  try {
    const t0 = performance.now();
    const { answer, usage } = await post('/question', { code: $('code').value, question: q, history, ...speed() });
    const ms = performance.now() - t0;
    showUsage('question', usage, ms);
    $('learnCost').innerHTML = usageText(usage, ms);
    turn.a = answer;
  } catch (e) { // keep the explanation; show the problem above it
    learn.qa.pop(); renderLearn(); $('learnBody').prepend(mk('div', 'pending', e.message));
    if (['no_key', 'bad_key', 'no_credit'].includes(e.code)) openConnect(e.code);
    learn.busy = false; $('learnSend').disabled = false; return;
  }
  learn.busy = false; $('learnSend').disabled = false;
  renderLearn();
  $('learnBody').lastElementChild?.scrollIntoView({ block: 'nearest' });
}
$('learnBtn').onclick = explainCode;
$('learnAgain').onclick = () => { learn.key = null; explainCode(); };
$('learnClose').onclick = () => { $('learn').hidden = true; };
$('learnAsk').onsubmit = (e) => {
  e.preventDefault();
  const q = $('learnQ').value.trim();
  if (!q) return;
  $('learnQ').value = '';
  askAbout(q);
};
