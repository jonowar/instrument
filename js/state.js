// State shared between modules. A module-level `let` can't be assigned from another module, so anything
// that more than one module reads or writes lives here, as S.name.
/** @typedef {import('./types.js').Turn} Turn */
/** @type {{ turns: Turn[], runBase: string | null, liveRunning: boolean, providers: Record<string, import('./types.js').ProviderInfo>,
 *   rec: import('./types.js').Recorder, shellTile: boolean, errLine: number, parts: import('./types.js').Part[],
 *   watchForError: boolean, lastRunCode: string, autoFixLeft: number, frame: Float32Array | null }} */
export const S = {
  turns: [],
  runBase: null,
  liveRunning: false,
  providers: { anthropic: { name: 'Claude (Anthropic)' } },
  rec: { state: 'idle', take: null },
  shellTile: false,
  errLine: 0,
  parts: [],
  watchForError: false,
  lastRunCode: '', // the code of the latest run (the editor may have changed since)
  autoFixLeft: 0,
  frame: null,
};
