// Checks the page's ⤴ Share wiring in a hidden Electron window with fetch, WebSocket, confirm,
// window.open and the clipboard stubbed (see preload.js), so nothing reaches the server, sclang or
// the network. Run with `npm run test:ui` from the repo root.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

// The page is ES modules, which Chromium won't load from file://, so serve the repo's files over http.
const ROOT = path.join(__dirname, '..', '..');
const staticServer = http.createServer((req, res) => {
  const f = req.url === '/' ? 'index.html' : req.url.replace(/^\//, '');
  if (!/^(index\.html|js\/[a-z]+\.js)$/.test(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.end(fs.readFileSync(path.join(ROOT, f)));
});
let PAGE;
const problems = [];
let failures = 0;
const check = (ok, what, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  await new Promise((r) => staticServer.listen(0, '127.0.0.1', r));
  PAGE = `http://127.0.0.1:${staticServer.address().port}/`;
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.webContents.on('console-message', (e, level, message) => {
    const lvl = e && typeof e === 'object' && 'level' in e ? e.level : level;
    const msg = e && typeof e === 'object' && 'message' in e ? e.message : message;
    if (lvl === 'error' || lvl === 3) problems.push(msg);
  });
  win.webContents.on('render-process-gone', (_e, d) => problems.push(`renderer gone: ${d.reason}`));

  await win.loadURL(PAGE);
  await new Promise((r) => setTimeout(r, 600));

  const run = (js) => win.webContents.executeJavaScript(js, true);
  const settle = () => new Promise((r) => setTimeout(r, 400));

  try {
    check(problems.length === 0, 'the page loads with no console errors', problems.join(' | '));

    const missing = await run(`
      ['shareBtn','takeShare','shareDlg','sharePre','sharePost','shareTitle','shareAudio','shareAudioRow',
       'shareAudioLen','shareGo','shareLink','shareCopy','shareOpen','shareExpires','shareMsg','shareList','shareWhat']
        .filter((id) => !document.getElementById(id))
    `);
    check(missing.length === 0, 'every element the share code uses exists', missing.join(', '));

    // with an empty editor, Share explains itself rather than uploading
    await run(`$('shareBtn').click()`);
    const empty = await run(`({ open: $('shareDlg').open, disabled: $('shareGo').disabled, msg: $('shareMsg').textContent })`);
    check(empty.open === true, 'Share opens the dialog');
    check(empty.disabled === true, 'Share is disabled with an empty editor');
    check(/Nothing in the editor/.test(empty.msg), 'it says why', empty.msg);
    await run(`$('shareDlg').close()`);

    // now with code and a finished take
    await run(`
      $('code').value = 'Pdef(\\\\kick, Pbind(\\\\degree, 0)).play;\\nNdef(\\\\pad, { SinOsc.ar(220) * 0.1 }).play;';
      S.rec = { state: 'idle', take: { id: '1760000000000', seconds: 102, notes: 48 } };
      $('shareBtn').click();
    `);
    const ready = await run(`({
      disabled: $('shareGo').disabled,
      audioRow: !$('shareAudioRow').hidden,
      audioLen: $('shareAudioLen').textContent,
      checked: $('shareAudio').checked,
      what: $('shareWhat').textContent,
    })`);
    check(ready.disabled === false, 'Share is enabled once there is code');
    check(ready.audioRow === true, 'the take checkbox shows when a take exists');
    check(ready.checked === true && ready.audioLen === '(1:42)', 'the take is included by default, with its length', ready.audioLen);
    check(/2 lines · a 1:42 take/.test(ready.what), 'the header says what will be shared', ready.what);

    // while the upload is pending the button animates and says so; afterwards it is back to normal
    await run(`window.__hold = new Promise((r) => (window.__release = r)); $('shareGo').click()`);
    await settle();
    const busy = await run(`({
      busy: $('shareGo').classList.contains('busy'),
      label: $('shareGoLabel').textContent,
      disabled: $('shareGo').disabled,
      anim: getComputedStyle($('shareGo').querySelector('.up')).animationName,
    })`);
    check(busy.busy && busy.disabled, 'the Share button is busy and disabled while uploading');
    check(busy.label === 'Uploading', 'its label says Uploading', busy.label);
    check(busy.anim === 'shareRise', 'the arrow is animated', busy.anim);
    check(await run(`getComputedStyle($('shareGoLabel'), '::after').animationName`) === 'dots', 'the label has animated dots');
    await run(`window.__release()`);
    await settle();
    const idle = await run(`({
      busy: $('shareGo').classList.contains('busy'),
      label: $('shareGoLabel').textContent,
      anim: getComputedStyle($('shareGo').querySelector('.up')).animationName,
    })`);
    check(!idle.busy && idle.label === 'Share' && idle.anim === 'none', 'afterwards the button is back to normal', JSON.stringify(idle));

    const posted = await run(`({
      call: window.__calls.find((c) => c.path === '/share'),
      post: !$('sharePost').hidden,
      pre: !$('sharePre').hidden,
      link: $('shareLink').value,
      expires: $('shareExpires').textContent,
      copied: window.__copied,
      saved: JSON.parse(localStorage.getItem('shares') || '[]'),
      status: $('status').textContent,
    })`);
    check(posted.call?.method === 'POST', 'it posts to /share');
    check(posted.call?.body?.takeId === '1760000000000', 'it sends the take id', String(posted.call?.body?.takeId));
    check(posted.call?.body?.audio === true, 'it asks for the audio to be included');
    check(
      JSON.stringify(posted.call?.body?.parts) === JSON.stringify(['pdef:kick', 'ndef:pad']),
      'it sends the parts found in the code',
      JSON.stringify(posted.call?.body?.parts),
    );
    check(posted.post && !posted.pre, 'the dialog switches to showing the link');
    check(posted.link === 'https://share.example.invalid/s/abcdefghijkm', 'the link is shown', posted.link);
    check(/It stops working on \w+ \d+, 2027/.test(posted.expires), 'the expiry date is shown', posted.expires);
    check(posted.copied[0] === posted.link, 'the link is copied to the clipboard');
    check(posted.saved.length === 1 && posted.saved[0].token === 'f'.repeat(48), 'the token is kept for unsharing');
    check(posted.status.endsWith('shared'), 'the status line says shared', posted.status);

    const listed = await run(`({ items: $('shareList').children.length, html: $('shareList').innerHTML })`);
    check(listed.items === 1, 'the share is listed');
    check(/♪ /.test(listed.html), 'the list marks that it has audio');

    await run(`$('shareList').querySelector('[data-unshare]').click()`);
    await settle();
    const after = await run(`({
      call: window.__calls.find((c) => c.path === '/unshare'),
      left: JSON.parse(localStorage.getItem('shares') || '[]').length,
      items: $('shareList').children.length,
      msg: $('shareMsg').textContent,
    })`);
    check(after.call?.body?.id === 'abcdefghijkm', 'Unshare posts the id');
    check(after.call?.body?.token === 'f'.repeat(48), 'Unshare posts the token');
    check(after.left === 0 && after.items === 0, 'it disappears from the list');
    check(/Unshared/.test(after.msg), 'it says so', after.msg);

    await run(`$('shareDlg').close(); $('takeDlg').showModal(); $('takeShare').click()`);
    const handover = await run(`({ take: $('takeDlg').open, share: $('shareDlg').open })`);
    check(handover.take === false && handover.share === true, 'the take dialog hands over to Share');

    await run(`$('shareLink').value = 'https://share.example.invalid/s/abcdefghijkm'; $('shareOpen').click()`);
    const opened = await run(`window.__opened`);
    check(opened[0] === 'https://share.example.invalid/s/abcdefghijkm', 'Open hands the link to the browser');

    // the default share title is the start of the first prompt, with "..." when it was cut
    const names = await run(`(() => {
      const out = [];
      for (const t of ['a short pad', 'a slow detuned saw pad with reverb', 'extraordinarily-long-single-word-prompt']) {
        $('prompt').value = t; S.turns.length = 0; out.push(suggestName(true));
      }
      $('prompt').value = 'a slow detuned saw pad with reverb'; out.push(suggestName());
      return out;
    })()`);
    check(names[0] === 'a short pad', 'a short prompt is the title as it is', names[0]);
    check(names[1] === 'a slow detuned saw...', 'a long prompt is cut with ...', names[1]);
    check(names[2].endsWith('...'), 'so is one cut at 24 characters', names[2]);
    check(names[3] === 'a slow detuned saw', 'saving a session keeps its plain name', names[3]);

    // no button on the command row may kill a model request in flight: press them all while one is pending
    await run(`window.__aborted = false; window.__holdGen = new Promise((r) => (window.__releaseGen = r)); $('prompt').value = 'a pad'; $('gen').click()`);
    await settle();
    await run(`for (const id of ['run', 'stop', 'runRec', 'recBtn', 'fadeBtn', 'gearBtn']) $(id).click()`);
    await settle();
    await run(`window.__releaseGen(); window.__holdGen = null`);
    await settle();
    check(await run(`window.__aborted === false`), 'no command-row button aborts a request in flight');
    check(await run(`$('code').value.length > 0 && !$('gen').disabled`), 'the pending request still lands after them');
    // syntax highlighting: coloured runs in #marks, text unchanged
    await run(`$('code').value = '// hi\\nPdef(\\\\a, Pbind(\\\\dur, 0.5, "s")).play; ~x = var nil;'`);
    const hl = await run(`({
      text: $('marks').textContent, code: $('code').value,
      kinds: [...new Set([...$('marks').querySelectorAll('span')].map((e) => e.className))].sort(),
      color: getComputedStyle($('marks').querySelector('.t-k')).color,
    })`);
    check(hl.text === hl.code.replace(/\n/g, ''), 'highlighting changes no text', JSON.stringify(hl.text));
    check(['t-c', 't-e', 't-k', 't-n', 't-s', 't-w', 't-y'].every((k) => hl.kinds.includes(k)), 'comments, strings, symbols, numbers, classes, keywords and ~vars each get a colour', hl.kinds.join(' '));
    // live mode sends only the statements that changed, blanked to keep line numbers
    const prev = 'SynthDef(\\a, { Out.ar(0, SinOsc.ar) }).add;\n{ Saw.ar(100) }.play; // drone\nPdef(\\x, Pbind(\\dur, 1)).play;';
    const next = 'SynthDef(\\a, { Out.ar(0, SinOsc.ar) }).add;\n{ Saw.ar(100) }.play; // drone\nPdef(\\x, Pbind(\\dur, 0.5)).play;';
    const d = await run(`({
      same: liveDiff(${JSON.stringify(prev)}, ${JSON.stringify(prev)}),
      edit: liveDiff(${JSON.stringify(prev)}, ${JSON.stringify(next)}),
      first: liveDiff(null, ${JSON.stringify(next)}) === ${JSON.stringify(next)},
      env: liveDiff('~t = 1;\\nPdef(\\\\a, 1).play;', '~t = 2;\\nPdef(\\\\a, 1).play;'),
      variable: liveDiff('var a = 1;\\na.postln;', 'var a = 2;\\na.postln;'),
      semi: topStatements('"a;b".post; // x; y\\n{ 1; 2 }.value; $;').length,
    })`);
    check(d.same.trim() === '' && d.same.split('\n').length === 3, 'an unchanged live edit sends only blank lines', JSON.stringify(d.same));
    check(d.edit.split('\n').length === 3 && !d.edit.includes('SynthDef') && !d.edit.includes('Saw') && d.edit.includes('0.5'), 'only the changed statement is sent, on its own line', JSON.stringify(d.edit));
    check(d.first, 'with no earlier run, everything is sent');
    check(d.env === '~t = 2;\nPdef(\\a, 1).play;' && d.variable === 'var a = 2;\na.postln;', 'a changed ~setting or a var sends the whole file');
    check(d.semi === 3, 'statements split at ; outside strings, comments, brackets and $; ', d.semi);
    // shell commands in the code: flagged on their line and in the error tile as a warning, never sent to Claude
    await run(`$('code').value = '{ SinOsc.ar }.play;\\n"ls".unixCmdGetStdOut;\\n// "x".unixCmd'`);
    const sh = await run(`({
      gutter: [...$('gutter').children].map((d) => d.className),
      mark: $('marks').querySelectorAll('.shellcmd').length,
      tile: !$('errTile').hidden && $('errTile').classList.contains('warn'), kind: $('errKind').textContent, body: $('errBody').textContent,
      explain: $('reanalyze').hidden,
    })`);
    check(sh.gutter[1] === 'shell' && sh.gutter[0] !== 'shell' && sh.gutter[2] !== 'shell', 'only the line with a shell command is flagged (comments are ignored)', JSON.stringify(sh.gutter));
    check(sh.mark === 1, 'the command is highlighted in the text', sh.mark);
    check(sh.tile && sh.kind === 'warning' && /Line 2/.test(sh.body) && sh.explain, 'the error tile warns, without an Explain button', JSON.stringify(sh));
    await run(`$('code').value = '{ SinOsc.ar }.play;'`);
    check(await run(`$('errTile').hidden`), 'the warning goes away with the command');
    // Learn: a step-by-step walk through the code, click-to-select, links built from data, questions
    await run(`localStorage.clear(); $('code').value = '{ SinOsc.ar(440) }\\n.play;\\n// done'; $('learnBtn').click()`);
    await settle();
    const lr = await run(`({ open: !$('learn').hidden, steps: document.querySelectorAll('#learnBody .step').length,
      links: [...document.querySelectorAll('#learnBody .term a')].map((a) => a.href),
      terms: [...document.querySelectorAll('#learnBody .term')].map((t) => t.textContent),
      imgs: document.querySelectorAll('#learnBody img').length, pwned: !!window.__pwned,
      cost: $('learnCost').textContent, session: $('usage').textContent,
      call: window.__calls.filter((c) => c.path === '/explain').length })`);
    check(lr.open && lr.steps === 2, 'Learn opens with the steps', JSON.stringify(lr));
    check(lr.links.length === 1 && lr.links[0] === 'https://doc.sccode.org/Classes/SinOsc.html', 'only a class name becomes a docs link', JSON.stringify(lr.links));
    check(lr.imgs === 0 && !lr.pwned, 'text from the model is never run as HTML');
    check(/900/.test(lr.cost) && /\$0\.0123/.test(lr.cost) && /session/.test(lr.session), 'the call shows its cost where it was made, and in the session total', lr.cost);
    await run(`document.querySelectorAll('#learnBody .step')[1].click()`);
    const sel = await run(`(() => { const t = $('code'); return t.value.slice(t.selectionStart, t.selectionEnd); })()`);
    check(sel === '.play;\n// done', 'clicking a step selects its lines in the editor', JSON.stringify(sel));
    await run(`$('learnBtn').click()`); await settle();
    check((await run(`window.__calls.filter((c) => c.path === '/explain').length`)) === 2, 'a selection is a different request');
    const sent = await run(`window.__calls.filter((c) => c.path === '/explain').at(-1).body`);
    check(sent.from === 2 && sent.to === 3, 'and it sends the lines selected', JSON.stringify(sent));
    await run(`$('learnBtn').click()`); await settle();
    check((await run(`window.__calls.filter((c) => c.path === '/explain').length`)) === 2, 'asking again for the same code and lines is free (cached)');
    await run(`document.querySelector('#learnBody .try').click()`);
    check((await run(`$('prompt').value`)) === 'Change 440 to 220.', 'a suggested experiment goes into the prompt');
    await run(`$('learnQ').value = 'why 440?'; $('learnAsk').requestSubmit()`);
    await settle();
    const qa = await run(`({ text: $('learnBody').textContent, body: window.__calls.find((c) => c.path === '/question').body })`);
    check(/Because A above middle C/.test(qa.text) && qa.body.question === 'why 440?' && qa.body.code.includes('SinOsc'), 'a question gets an answer, with the code sent along');
    await run(`$('learnClose').click()`);
    check(await run(`$('learn').hidden`), 'Learn closes');

    // other providers: pick OpenAI in Connect, paste a key, choose a model, and requests carry them
    await run(`localStorage.clear(); loadKey().then(() => { openConnect(); })`);
    await settle();
    const opts = await run(`[...$('provider').options].map((o) => o.value).join(',')`);
    check(opts === 'anthropic,openai,ollama,custom', 'Connect lists the providers', opts);
    await run(`$('provider').value = 'openai'; $('provider').dispatchEvent(new Event('change'));
      $('connectKey').value = 'sk-test-1234567890abcdef'; checkPasted();`);
    await settle();
    const oa = await run(`({ title: $('connectTitle').textContent, model: !$('stepModel').hidden, done: $('connectDone').disabled,
      list: $('modelList').children.length, provider: localStorage.getItem('provider') })`);
    check(oa.title === 'Connect to OpenAI' && oa.model, 'OpenAI asks for a model', JSON.stringify(oa));
    check(oa.done === true && oa.list === 2 && oa.provider === 'openai', 'Done waits for a model; the key check filled the list', JSON.stringify(oa));
    await run(`$('connectModel').value = 'gpt-test'; $('connectModel').dispatchEvent(new Event('input'));`);
    check(await run(`!$('connectDone').disabled`), 'a model enables Done');
    await run(`window.__calls.length = 0; post('/generate', { prompt: 'x', ...speed() })`);
    const gen = await run(`window.__calls.find((c) => c.path === '/generate')`);
    check(gen.headers['x-provider'] === 'openai' && gen.headers['x-api-key'] === 'sk-test-1234567890abcdef', 'requests carry the provider and its key', JSON.stringify(gen.headers));
    check(gen.body.model === 'gpt-test', 'and its model', JSON.stringify(gen.body));
    await run(`$('provider').value = 'ollama'; $('provider').dispatchEvent(new Event('change'));`);
    await settle();
    const ol = await run(`({ key: $('connectKey').hidden, provider: localStorage.getItem('provider') })`);
    check(ol.key && ol.provider === 'ollama', 'Ollama needs no key and is checked at once', JSON.stringify(ol));
    await run(`setPref('provider', 'anthropic'); $('connect').close()`);
    await run(`window.__calls.length = 0; post('/generate', { prompt: 'x' })`);
    const claude = await run(`window.__calls.find((c) => c.path === '/generate')`);
    check(!claude.headers['x-provider'], 'Claude requests carry no provider header');

    check(problems.length === 0, 'no console errors during any of that', problems.join(' | '));
  } catch (e) {
    check(false, 'harness ran without throwing', e.message);
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  app.exit(failures ? 1 : 0);
});
