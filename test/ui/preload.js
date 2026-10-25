window.__test = true; // the page then exposes its functions to the tests (js/main.js)
// Stubs the page's outside world before its inline script runs, as CLAUDE.md describes: no server,
// no sclang, no network. contextIsolation is off so these land on the page's own window.
const routes = {
  '/status': { supercollider: true, paths: ['/Applications/SuperCollider.app/Contents/MacOS/sclang'] },
  '/key': {
    env: true, envs: { anthropic: true },
    providers: {
      anthropic: { name: 'Claude (Anthropic)', keyUrl: 'https://platform.claude.com/settings/keys', billingUrl: 'https://platform.claude.com/settings/billing' },
      openai: { name: 'OpenAI', baseURL: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
      ollama: { name: 'Ollama (local, free)', baseURL: 'http://localhost:11434/v1', noKey: true, free: true },
      custom: { name: 'Other (OpenAI-compatible)', baseURL: '' },
    },
  },
  '/usage': { entries: [], file: '/tmp/usage.jsonl' },
  '/share': {
    id: 'abcdefghijkm',
    url: 'https://share.example.invalid/s/abcdefghijkm',
    token: 'f'.repeat(48),
    expiresAt: Date.parse('2027-01-13T00:00:00Z'),
  },
  '/unshare': { ok: true },
  '/explain': {
    explanation: {
      overview: 'A sine wave at concert A. <img src=x onerror="window.__pwned=1">',
      steps: [{ from: 1, to: 1, what: 'Makes a sine oscillator.', why: '440 Hz is concert A.' }, { from: 2, to: 3, what: 'Plays it.', why: 'play sends the graph to the server.' }],
      concepts: [{ term: 'SinOsc', meaning: 'a sine wave oscillator' }, { term: 'javascript:alert(1)', meaning: 'not a class' }, { term: 'sample rate', meaning: 'samples per second' }],
      try: [{ change: 'Change 440 to 220.', hear: 'an octave lower' }],
    },
    range: null, usage: { input: 900, output: 400, cost: 0.0123, model: 'claude-sonnet-5-5' },
  },
  '/question': { answer: 'Because A above middle C is tuned to 440 Hz.', truncated: false, usage: { input: 500, output: 80, cost: 0.002, model: 'claude-sonnet-5-5' } },
};

window.__calls = [];
window.fetch = async (url, opts = {}) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  window.__calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers || {} });
  if (path === '/generate' && window.__holdGen) { // a test can keep a model request pending, and see if anything aborts it
    opts.signal?.addEventListener('abort', () => (window.__aborted = true));
    await window.__holdGen;
  }
  if (path === '/share' && window.__hold) await window.__hold; // a test can keep the upload pending
  const body = path === '/key' && opts.method === 'POST' ? { ok: true, hint: 'sk-test…cdef', models: ['gpt-test', 'gpt-test-mini'] } : routes[path] ?? { ok: true };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};

class FakeSocket {
  constructor() {
    this.readyState = 0;
  }
  send() {}
  close() {}
  addEventListener() {}
}
window.WebSocket = FakeSocket;

window.confirm = () => true;
window.__opened = [];
window.open = (u) => {
  window.__opened.push(u);
  return null;
};
// file:// is not a secure context, so there is no clipboard API to spy on; give it one.
window.__copied = [];
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: async (t) => void window.__copied.push(t) },
  configurable: true,
});
