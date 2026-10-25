import { S } from './state.js';
import { $, hooks, modelList, modelSlot, post, pref, provider, setPref, status, store } from './util.js';

// --- connecting to a provider: the API key ----------------------------------------------------------
// The page keeps the key in localStorage (this app or browser only) and sends it to the local server with
// each request. POST /key checks a key before it's kept. the provider's key in .env (ENV_KEYS in
// server.js) works as a fallback. The server's /key also returns the provider table.
let key = { env: false, envs: {} };
/** What /key said about a provider (nothing, until it has answered). */
const providerInfo = (/** @type {string} */ p) => S.providers[p] || /** @type {Partial<import('./types.js').ProviderInfo>} */ ({});
export const hasKey = () => !!store.get() || !!(key.envs || {})[provider()] || !!providerInfo(provider()).noKey;
export async function loadKey() {
  try {
    key = await (await fetch('/key')).json(); S.providers = key.providers || S.providers;
    $('provider').replaceChildren(...Object.entries(S.providers).map(([id, p]) => Object.assign(document.createElement('option'), { value: id, textContent: p.name })));
  } catch {}
}
const shortName = (p = provider()) => (S.providers[p]?.name || p).replace(/ \(.*\)/, '');
export function renderKey() {
  const p = provider(), info = providerInfo(p), local = store.get(), saved = !!local;
  const hint = local ? `${local.slice(0, 7)}…${local.slice(-4)}` : null;
  const envHas = !!(key.envs || {})[p];
  $('provName').textContent = shortName() + (pref(modelSlot(), '') && p !== 'anthropic' ? ' · ' + pref(modelSlot(), '') : '');
  $('keyState').className = saved || envHas || info.noKey ? 'ok' : 'none';
  $('keyState').textContent = saved ? `connected · ${hint}` : envHas ? 'connected · key from .env' : info.noKey ? 'no key needed' : 'not connected';
  $('keyChange').textContent = saved ? 'Change…' : 'Connect…';
  $('keyRemove').hidden = !saved;
  $('keyWhere').textContent = saved ? `The key is kept in ${/Electron/.test(navigator.userAgent) ? 'this app' : 'this browser'} only, and sent to its local server with each request.`
    : envHas ? `Using the key from .env. Connect a key here to use that instead.` : info.noKey ? '' : 'Connect to use ' + shortName() + '.';
}
// Wording and links for the provider shown in Connect
function renderConnect() {
  const p = $('provider').value, info = providerInfo(p), claude = p === 'anthropic';
  $('connectTitle').textContent = 'Connect to ' + shortName(p);
  $('connectLead').textContent = claude
    ? 'AnInstrument uses your own Anthropic API key, so you only pay Anthropic for what you use: usually a cent or two per request, and every request shows its cost.'
    : info.free ? 'Runs a model on this Mac with Ollama: free and offline, but quality depends on the model, and the sound code Claude writes best is the benchmark.'
    : `AnInstrument uses your own ${shortName(p)} key. Your prompts and code are sent to that provider, not to Anthropic. The prompts were written for Claude: other models may need a retry more often.`;
  $('stepCreate').hidden = !!info.noKey || p === 'custom';
  $('createText').textContent = claude ? 'Sign in to the Claude Console (or sign up), click Create Key, and copy it.' : `Sign in to ${shortName(p)}, create an API key, and copy it.`;
  $('consoleKeys').textContent = claude ? 'Open the Claude Console ↗' : `Open ${shortName(p)} ↗`;
  $('consoleKeys').href = info.keyUrl || '#';
  $('consoleBilling').href = info.billingUrl || '#';
  $('connectBase').hidden = p !== 'custom';
  $('connectBase').value = pref('base:' + p, '');
  $('connectKey').hidden = !!info.noKey;
  $('connectKey').placeholder = claude ? 'sk-ant-…' : 'API key';
  $('pasteTitle').textContent = info.noKey ? 'Check that it is running.' : 'Paste it here.';
  $('stepModel').hidden = claude;
  $('connectModel').value = pref(modelSlot(p), '');
  $('modelList').replaceChildren(...modelList(p).map((m) => Object.assign(document.createElement('option'), { value: m })));
  $('connect').querySelector('.credit').hidden = !claude && !info.billingUrl;
}
// why: welcome (first run), no_key, bad_key or no_credit (the credit step is highlighted)
export function openConnect(why = 'welcome') {
  $('provider').value = provider();
  renderConnect();
  $('connectKey').value = '';
  const msg = { bad_key: ['err', 'The saved key stopped working (deleted or mistyped?). Paste a new one.'],
    no_credit: ['err', 'The key works, but the account is out of credit: add some under Billing.'] }[why] || ['', ''];
  $('connectMsg').className = 'hint ' + msg[0]; $('connectMsg').textContent = msg[1];
  $('connect').querySelector('.credit').classList.toggle('hl', why === 'no_credit');
  $('connectDone').disabled = why !== 'no_credit';
  if ($('settings').open) $('settings').close();
  if (!$('connect').open) $('connect').showModal();
  if (why !== 'no_credit') ($('connectKey').hidden ? $('connectDone') : $('connectKey')).focus();
  if (why === 'welcome') checkConnected();
}
// Done needs a working key and, outside Claude, a model
function updateDone() {
  const p = $('provider').value, ok = $('connectMsg').classList.contains('ok');
  $('connectDone').disabled = !(ok && (p === 'anthropic' || $('connectModel').value.trim()));
}
// Switching provider in Connect: one that is already connected needs nothing more
async function checkConnected() {
  const p = $('provider').value, info = providerInfo(p);
  if (store.get(p) || info.noKey) { await checkPasted(store.get(p)); }
}
let checking = 0;
export async function checkPasted(saved) {
  const p = $('provider').value, info = providerInfo(p), claude = p === 'anthropic';
  const k = (typeof saved === 'string' ? saved : $('connectKey').value).trim(), n = ++checking;
  const base = $('connectBase').value.trim();
  const msg = (cls, t) => { $('connectMsg').className = 'hint ' + cls; $('connectMsg').textContent = t; };
  $('connectDone').disabled = true;
  if (!k && !info.noKey) return msg('', '');
  if (claude && (!k.startsWith('sk-ant-') || k.length < 30)) return msg('err', 'Anthropic API keys start with sk-ant-. Copy the whole key.');
  if (p === 'custom' && !base) return msg('err', 'Enter the base URL first.');
  msg('dots', info.noKey ? 'Checking' : 'Checking the key');
  try {
    const r = await post('/key', { key: k, provider: p, baseURL: p === 'custom' ? base : undefined });
    if (n !== checking) return; // a newer paste is being checked
    if (!r.ok) return msg('err', r.error);
    store.set(k, p); setPref('provider', p);
    if (p === 'custom') setPref('base:' + p, base);
    if (r.models) { setPref('models:' + p, JSON.stringify(r.models)); renderConnect(); }
    msg('ok', `✓ Connected${r.hint ? ` (${r.hint})` : ''}.`);
    updateDone();
    if (!$('connectDone').disabled) $('connectDone').focus(); else $('connectModel').focus();
    status('');
  } catch (e) { if (n === checking) msg('err', e.message); }
}
let pasteTimer;
$('connectKey').addEventListener('input', () => { clearTimeout(pasteTimer); pasteTimer = setTimeout(checkPasted, 400); });
$('connectBase').addEventListener('input', () => { clearTimeout(pasteTimer); pasteTimer = setTimeout(() => { if ($('connectKey').value.trim() || providerInfo('custom').noKey) checkPasted(); }, 600); });
$('connectModel').addEventListener('input', () => { setPref(modelSlot($('provider').value), $('connectModel').value.trim()); updateDone(); });
$('provider').addEventListener('change', () => {
  const p = $('provider').value;
  renderConnect(); $('connectKey').value = '';
  $('connectMsg').className = 'hint'; $('connectMsg').textContent = ''; $('connectDone').disabled = true;
  // The provider is switched when its key is accepted (checkPasted), so a cancelled change leaves things as they were
  if (store.get(p) || providerInfo(p).noKey) checkPasted(store.get(p));
  else if (!$('connectKey').hidden) $('connectKey').focus();
});
$('keyChange').onclick = () => openConnect();
$('keyRemove').onclick = async () => {
  if (!confirm(`Disconnect? The key is removed from this app (it still exists with ${shortName()}).`)) return;
  store.set('');
  renderKey(); status('no key set');
};
$('connect').addEventListener('close', () => { if (!hasKey()) status('no key set'); });
// A click on the backdrop (outside the dialog's box, so the event lands on the <dialog> itself) closes it,
// like Close. Both press and release must be outside, so a text selection dragged out of a dialog doesn't.
for (const d of document.querySelectorAll('dialog')) {
  const outside = (e) => {
    const r = d.getBoundingClientRect();
    return e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
  };
  let downOutside = false;
  d.addEventListener('mousedown', (e) => { downOutside = outside(e); });
  d.addEventListener('click', (e) => { if (downOutside && outside(e)) d.close(); downOutside = false; });
}

hooks.openConnect = openConnect;
