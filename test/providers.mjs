// Runs the OpenAI-compatible adapter (generate, key check, errors, cost) against a stand-in server:
// no keys, no network. Run: node test/providers.mjs
import http from 'node:http';
import { generate, gear, explain, question, checkKey } from '../server.js';
let failed = 0;
const expect0 = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) failed++; };
const expect = expect0;
const seen = [];
const srv = http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  seen.push({ url: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
  res.setHeader('content-type', 'application/json');
  if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'gpt-x' }, { id: 'text-embedding-3' }, { id: 'Llama-4' }] }));
  if (req.headers.authorization === 'Bearer bad') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'nope' } })); }
  const sys = seen.at(-1).body.messages[0].content;
  const wantsJson = sys.includes('JSON Schema');
  if (wantsJson && sys.includes('new to audio')) { // explain()
    return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ overview: 'o', steps: [{ from: 1, to: 1, what: 'w', why: 'y' }], concepts: [{ term: 'SinOsc', meaning: 'm' }], try: [{ change: 'c', hear: 'h' }] }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  }
  res.end(JSON.stringify({ choices: [{ message: { content: wantsJson ? '```json\n{"gear":[]}\n```' : '```\n{ SinOsc.ar }.play\n```' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 500 } }));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/v1`;
const conn = { provider: 'custom', key: 'k', baseURL: base, priceIn: 2, priceOut: 10 };
console.log('check', JSON.stringify(await checkKey('k', { provider: 'custom', baseURL: base })));
const g = await generate('a sine', '', [{ user: 'hi', code: 'x' }], conn, { model: 'gpt-x', effort: 'low' });
console.log('generate', JSON.stringify(g.code), JSON.stringify(g.usage));
console.log('body', JSON.stringify({ ...seen.at(-1).body, messages: seen.at(-1).body.messages.map((m) => m.role + ':' + typeof m.content) }));
console.log('gear-ish', JSON.stringify('ollama is free'));
try { await generate('x', '', [], { ...conn, key: 'bad' }, { model: 'gpt-x' }); } catch (e) { console.log('bad', e.code, e.message); }
try { await generate('x', '', [], conn, {}); } catch (e) { console.log('nomodel', e.message); }
const free = await generate('x', '', [], { provider: 'ollama', baseURL: base }, { model: 'llama3' });
console.log('free cost', free.usage.cost, 'auth', seen.at(-1).auth);
const nop = await generate('x', '', [], { provider: 'custom', key: 'k', baseURL: base }, { model: 'm' });
console.log('unpriced cost', nop.usage.cost);
// Learn: explain() numbers the code and focuses on a selection; question() carries the code and the history.
const code3 = '{ SinOsc.ar(440) }\n.play;\n// done';
const ex = await explain(conn, { code: code3, from: 2, to: 3, model: 'gpt-x' });
const exSent = seen.at(-1).body.messages;
expect0(ex.explanation.steps.length === 1 && ex.explanation.concepts[0].term === 'SinOsc', 'explain: returns the structured explanation');
expect0(JSON.stringify(ex.range) === '[2,3]', 'explain: a selection becomes a focus range');
expect0(exSent[1].content.includes('Explain only lines 2 to 3') && exSent[1].content.includes('1: { SinOsc.ar(440) }'), 'explain: the code is numbered and the range is stated');
const whole = await explain(conn, { code: code3, from: 1, to: 3, model: 'gpt-x' });
expect0(whole.range === null && !seen.at(-1).body.messages[1].content.includes('Explain only'), 'explain: selecting everything is the same as no selection');
let emptyErr = ''; try { await explain(conn, { code: '  ', model: 'gpt-x' }); } catch (e) { emptyErr = e.message; }
expect0(/Nothing in the editor/.test(emptyErr), 'explain: empty code is refused before any call');
const q = await question(conn, { code: code3, question: 'why 440?', history: [{ q: 'what is SinOsc', a: 'a sine' }], model: 'gpt-x' });
const qMsgs = seen.at(-1).body.messages;
expect0(qMsgs.length === 1 + 2 + 2 + 1 && qMsgs.at(-1).content === 'why 440?' && qMsgs[1].content.includes('1: { SinOsc'), 'question: code first, then the history, then the question');
expect0(typeof q.answer === 'string' && q.usage.input === 1000, 'question: returns the answer and its usage');

// Meta Muse Spark: with no base URL given, calls go to Meta's own endpoint, and MODEL_API_KEY (the name
// Meta documents) is the fallback key. fetch is replaced so nothing leaves this machine.
const realFetch = globalThis.fetch;
const sent = [];
globalThis.fetch = async (url, opts = {}) => {
  sent.push({ url: String(url), auth: opts.headers?.authorization });
  const body = String(url).endsWith('/models') ? { data: [{ id: 'muse-spark-test' }] }
    : { choices: [{ message: { content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
  return { ok: true, status: 200, json: async () => body };
};
process.env.MODEL_API_KEY = 'meta-env-key';
await checkKey('pasted', { provider: 'meta' });
expect(sent.at(-1).url === 'https://api.meta.ai/v1/models', 'meta: key check goes to api.meta.ai/v1');
expect(sent.at(-1).auth === 'Bearer pasted', 'meta: sends the pasted key as a bearer token');
await generate('x', '', [], { provider: 'meta' }, { model: 'muse-spark-test' });
expect(sent.at(-1).url === 'https://api.meta.ai/v1/chat/completions', 'meta: chat goes to api.meta.ai/v1');
expect(sent.at(-1).auth === 'Bearer meta-env-key', 'meta: falls back to MODEL_API_KEY from .env');
globalThis.fetch = realFetch;
srv.close();
if (failed) process.exit(1);
