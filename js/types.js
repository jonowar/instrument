// Shapes shared by the page and server.js, as JSDoc typedefs (checked by `npm run typecheck`). Nothing runs here.

/** One call's tokens and cost, from summarizeUsage() in server.js. cost is null for an unpriced model.
 * @typedef {{ input: number, output: number, cost: number | null, model?: string, cacheRead?: number, cacheWrite?: number }} Usage */

/** One turn of the conversation: what you asked, what was sent to Claude, and the code that came back.
 * @typedef {{ prompt: string, user?: string, code: string, at: number }} Turn */

/** A Pdef or Ndef reported by sclang (parts.scd).
 * @typedef {{ kind: 'pdef' | 'ndef', name: string, playing: boolean, muted: boolean }} Part */

/** A finished recording.
 * @typedef {{ id: string, seconds: number, notes?: number }} Take */
/** @typedef {{ state: 'idle' | 'starting' | 'recording' | 'stopping', take: Take | null, seconds?: number, error?: string }} Recorder */

/** What /key says about each provider.
 * @typedef {{ name: string, free?: boolean, noKey?: boolean, baseURL?: string, keyUrl?: string, billingUrl?: string }} ProviderInfo */

/** @typedef {{ from: number, to: number, what: string, why: string }} ExplainStep */
/** @typedef {{ overview: string, steps: ExplainStep[], concepts: { term: string, meaning: string }[], try: { change: string, hear: string }[] }} Explanation */

/** Every endpoint the page calls through post(): request body and response.
 * @typedef {{
 *   '/generate': { req: { prompt: string, code: string, history: object[], kind?: string, model?: string, effort?: string }, res: { code: string, user: string, truncated?: boolean, usage: Usage } },
 *   '/explain': { req: { code: string, from?: number, to?: number, model?: string, effort?: string }, res: { explanation: Explanation, range: [number, number] | null, usage: Usage } },
 *   '/question': { req: { code: string, question: string, history: { q: string, a: string }[], model?: string, effort?: string }, res: { answer: string, truncated: boolean, usage: Usage } },
 *   '/gear': { req: { code: string, prompts: string[], model?: string, effort?: string }, res: { gear: any, usage: Usage } },
 *   '/analyze': { req: { model?: string }, res: { analysis: string | null, usage?: Usage } },
 *   '/run': { req: { code: string, full?: string, keep: string[] }, res: { ok: true } },
 *   '/key': { req: { key?: string, provider?: string, baseURL?: string }, res: { ok: boolean, hint?: string | null, models?: string[], noKey?: boolean, code?: string, error?: string } },
 *   '/share': { req: object, res: any },
 *   '/unshare': { req: { id: string, token: string }, res: any },
 * }} Routes */

export {};
