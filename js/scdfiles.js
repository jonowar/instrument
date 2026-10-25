import { S } from './state.js';
import { sessionFileName } from './conversation.js';
import { suggestName } from './saved.js';
import { log } from './setup.js';
import { $, status } from './util.js';

// --- .scd files: export the editor's code to run in SuperCollider by itself, or import one ---------
// The export is wrapped in s.waitForBoot, which boots the server and runs the code in a Routine, as the
// app does (so .wait and s.sync work); importing an export takes the wrapper off again.
const SCD_HEAD = '// Exported from AnInstrument';
function exportScd() {
  const code = $('code').value.trim();
  if (!code) { status('nothing to export'); return; }
  const lines = [`${SCD_HEAD} on ${new Date().toLocaleDateString()}${S.turns[0] ? `: "${S.turns[0].prompt.replace(/\s+/g, ' ').slice(0, 80)}"` : ''}.`,
    '// In SuperCollider: click inside the outer brackets and press Cmd-Return. Cmd-. stops it.'];
  if (/~midi\b/.test(code)) lines.push('// ~midi is the app\'s MIDI display; outside the app, point it at a real port first, e.g. MIDIClient.init; ~midi = MIDIOut(0);');
  const text = `${lines.join('\n')}\n(\ns.waitForBoot {\n${code}\n};\n)\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = sessionFileName('scd')
    || (suggestName() || 'instrument').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.scd';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  status('exported ' + a.download);
}
const unwrapScd = (t) => {
  const m = t.replace(/\r\n?/g, '\n').match(/^\/\/ Exported from AnInstrument[^\n]*\n(?:\/\/[^\n]*\n)*\(\ns\.waitForBoot \{\n([\s\S]*)\n\};\n\)\s*$/);
  return m ? m[1] : t.replace(/\r\n?/g, '\n');
};
$('exportScd').onclick = exportScd;
$('importScd').onclick = () => $('scdFile').click();
$('scdFile').onchange = async () => {
  const f = $('scdFile').files[0]; $('scdFile').value = '';
  if (!f) return;
  if (f.size > 1e6) { log(`! ${f.name} is too big for the editor (over 1 MB)\n`); return; }
  const code = unwrapScd(await f.text());
  if ($('code').value.trim() && $('code').value !== code && !confirm(`Open ${f.name}? It replaces the code in the editor.`)) return;
  $('code').value = code;
  status(`loaded ${f.name} — Run to hear it`);
};
