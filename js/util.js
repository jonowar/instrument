/** The element with this id. Typed `any`: the page has hundreds of ids and they are checked by the UI tests. */
export const $ = /** @type {(id: string) => any} */ ((id) => document.getElementById(id));
// Each status gets a small animated icon, picked from its text: [pattern, kind, icon, floating notes].
/** @type {[RegExp, string, string, string?][]} */
const STATUS_ANIM = [
  [/^thinking/, 'think', '🧠', '♪♫♩'], [/^fixing/, 'fix', '🔨'], [/^fixed/, 'fixed', '🔨'],
  [/^cut off/, 'cut', '✂️'], [/^sent|^live ↻/, 'play', '', '♪♫♩'], [/^stopped/, 'stop', '⏹'],
  [/^restarting audio|^switching output/, 'audio', '🔊', '))'], [/^saved/, 'saved', '❤️'],
  [/^loaded/, 'loaded', '📂'], [/^new conversation/, 'new', '✨'], [/^rewound/, 'rewind', '⏪'],
  [/^no key/, 'key', '🔑'], [/^recording/, 'live', '⏺'], [/^fading out/, 'fade', '↘', '♪♫'], [/^faded out/, 'stop', '⏹'], [/^recorded/, 'saved', '💾'], [/^exported/, 'loaded', '📄'], [/^live: waiting/, 'wait', '⏳'], [/^live: edits/, 'live', '🔴'],
  [/^sharing/, 'think', '🔗'], [/^shared/, 'saved', '🔗'], [/^unshared/, 'cut', '✂️'],
];
export const status = (t) => {
  const el = $('status');
  const a = t && STATUS_ANIM.find(([re]) => re.test(t));
  // a status still in progress ("thinking…") gets animated dots instead of a fixed ellipsis
  el.classList.toggle('dots', /…$/.test(t || ''));
  el.textContent = (t || '').replace(/…$/, '');
  if (!a) return;
  const [, kind, icon, notes = ''] = a;
  const span = document.createElement('span');
  span.className = 'st st-' + kind;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<b>${icon}</b>` + [...notes].map((n) => `<i>${n}</i>`).join('');
  el.prepend(span);
};
// The page runs in the desktop app or in a browser (npm start); say where things are saved.
if (/Electron/.test(navigator.userAgent)) document.querySelectorAll('.where').forEach((e) => (e.textContent = 'this app'));
// The provider (Claude, OpenAI, Llama API, Ollama, other), its key and its model; each provider keeps its own.
export const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
export const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
export const provider = () => pref('provider', 'anthropic');
const keySlot = (p) => (p === 'anthropic' ? 'anthropic-key' : 'key:' + p); // Claude's slot predates providers
export const store = {
  get: (p = provider()) => { try { return localStorage.getItem(keySlot(p)) || ''; } catch { return ''; } },
  set: (v, p = provider()) => { try { v ? localStorage.setItem(keySlot(p), v) : localStorage.removeItem(keySlot(p)); } catch {} },
};
export const modelSlot = (p = provider()) => (p === 'anthropic' ? 'model' : 'model:' + p);
export const modelList = (p = provider()) => { try { return JSON.parse(pref('models:' + p, '[]')); } catch { return []; } };
// Speed settings from ⚙, sent with Claude requests. Effort defaults to low: quick sketches suit live play.
export const speed = () => ({ effort: pref('effort', 'low'), model: pref(modelSlot(), '') || undefined });
/** POST JSON to the local server. Known endpoints (types.js) check their request and give a typed response.
 * @template {string} P
 * @param {P} path
 * @param {P extends keyof import('./types.js').Routes ? import('./types.js').Routes[P]['req'] : object} body
 * @returns {Promise<P extends keyof import('./types.js').Routes ? import('./types.js').Routes[P]['res'] : any>} */
export const post = async (path, body) => {
  const headers = { 'content-type':'application/json' };
  const p = provider();
  if (store.get()) headers['x-api-key'] = store.get();
  if (p !== 'anthropic') {
    headers['x-provider'] = p;
    const base = pref('base:' + p, ''), [pin, pout] = pref('price:' + p, ',').split(',');
    if (base) headers['x-base-url'] = base;
    if (pin !== '' && pout !== '') { headers['x-price-in'] = pin; headers['x-price-out'] = pout; }
  }
  const r = await fetch(path, { method:'POST', headers, body:JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error), { code: j.code });
  return j;
};

// What guard() needs from modules that load after this one, set by them when they load (util.js imports
// nothing, so every module can import it without a cycle).
export const hooks = { openConnect: (/** @type {string} */ _why) => {}, log: (/** @type {string} */ _text) => {} };
// A missing, rejected or out-of-credit key opens the Connect dialog at the step that fixes it.
export const guard = (fn) => async () => {
  try { await fn(); } catch (e) {
    status(''); if (!e.logged) hooks.log('! ' + e.message + '\n');
    if (['no_key', 'bad_key', 'no_credit'].includes(e.code)) hooks.openConnect(e.code);
  }
};
