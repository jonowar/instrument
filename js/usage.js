import { $, guard } from './util.js';

// --- usage line under the prompt: tokens, cost, time, running total for this page load ---
let sessionCost = 0, sessionKnown = true;
const fmtCost = (c) => (c < 0.1 ? '$' + c.toFixed(4) : '$' + c.toFixed(2));
// One call's tokens, cost and time. Every feature that calls Claude shows this under its own UI, so
// the cost of each call is visible where it was made (see CLAUDE.md).
export function usageText(u, ms) {
  const parts = [`<b>${u.input.toLocaleString()}</b> tokens sent`, `<b>${u.output.toLocaleString()}</b> received`];
  parts.push(u.cost == null ? 'cost unknown for ' + u.model : `<b>${fmtCost(u.cost)}</b>`);
  if (ms != null) parts.push((ms / 1000).toFixed(1) + 's');
  return parts.join(' · ');
}
// Adds a call to the session total and shows it on the line under the prompt.
export function showUsage(label, u, ms) {
  if (!u) return;
  if (u.cost == null) sessionKnown = false; else sessionCost += u.cost;
  $('usage').innerHTML = `${label} · ${usageText(u, ms)} · session ${fmtCost(sessionCost)}${sessionKnown ? '' : '+'}`;
}

// --- usage history (🧾): every Claude request's tokens and cost, recorded by the server in usage.jsonl ---
export const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const shortModel = (m) => String(m ?? '').replace(/^claude-/, '').replace(/-(\d)-(\d)$/, ' $1.$2');
// Total cost of some entries; '+' marks a total that leaves out calls with an unknown price.
function sumCost(list) {
  const known = list.filter((e) => e.cost != null);
  return fmtCost(known.reduce((a, e) => a + e.cost, 0)) + (known.length < list.length ? '+' : '');
}
const LEDGER_ROWS = 500;
async function openLedger() {
  const r = await fetch('/usage');
  const { entries, file } = await r.json();
  const now = new Date();
  const day = now.toDateString(), month = now.getFullYear() * 12 + now.getMonth();
  const at = (e) => new Date(e.at);
  const totals = [
    ['today', entries.filter((e) => at(e).toDateString() === day)],
    ['this month', entries.filter((e) => at(e).getFullYear() * 12 + at(e).getMonth() === month)],
    ['all time', entries],
  ];
  $('ledgerTotals').innerHTML = totals.map(([name, list]) => `<div class="total"><b>${sumCost(list)}</b>`
    + `<span>${name} · ${list.length} request${list.length === 1 ? '' : 's'}</span></div>`).join('');
  const kinds = Object.groupBy(entries, (e) => e.kind);
  $('ledgerKinds').innerHTML = Object.entries(kinds).map(([k, list]) => `${esc(k)} <b>${sumCost(list)}</b> (${list.length})`).join(' · ')
    + (entries.length ? ` · <b>${entries.reduce((a, e) => a + e.input, 0).toLocaleString()}</b> tokens sent, `
      + `<b>${entries.reduce((a, e) => a + e.output, 0).toLocaleString()}</b> received` : '');
  const rows = entries.slice(-LEDGER_ROWS).reverse().map((e) => {
    const d = at(e);
    const when = (d.toDateString() === day ? '' : d.toLocaleDateString(undefined, { month:'short', day:'numeric' }) + ' ')
      + d.toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
    return `<tr><td>${esc(when)}</td><td>${esc(e.kind)}</td><td>${esc(shortModel(e.model))}${e.effort ? ' ' + esc(e.effort) : ''}</td>`
      + `<td>${e.input.toLocaleString()}</td><td>${(e.cacheRead || 0).toLocaleString()}</td><td>${e.output.toLocaleString()}</td>`
      + `<td>${e.cost == null ? '?' : fmtCost(e.cost)}</td><td>${(e.ms / 1000).toFixed(1)}s</td></tr>`;
  }).join('');
  $('ledgerTable').innerHTML = entries.length
    ? `<table><thead><tr><th>when</th><th>what</th><th>model</th><th>sent</th><th>cached</th><th>received</th><th>cost</th><th>time</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="hint">No requests yet. Each Generate, Fix, error analysis and Gear request is added here.</p>';
  $('ledgerFile').textContent = (entries.length > LEDGER_ROWS ? `Showing the latest ${LEDGER_ROWS}; totals count all ${entries.length}. ` : '')
    + `"sent" includes "cached" tokens, which cost a tenth as much. Costs use list prices. Kept in ${file}.`;
  $('ledger').showModal();
}
$('ledgerBtn').onclick = guard(openLedger);
