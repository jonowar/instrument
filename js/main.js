// AnInstrument's page. Each module owns one part of the UI and wires its own buttons when it loads; this
// file only loads them, in the order the page needs, and exposes a few functions to the UI tests.
import './util.js';
import './usage.js';
import './conversation.js';
import './connect.js';
import './saved.js';
import './record.js';
import './share.js';
import './scdfiles.js';
import './editor.js';
import './gear.js';
import './learn.js';
import './parts.js';
import './setup.js';
import './errors.js';
import './audio.js';
import './midi.js';
import { S } from './state.js';
import { suggestName } from './saved.js';
import { $, post, setPref, speed } from './util.js';
import { liveDiff, topStatements } from './conversation.js';
import { checkPasted, loadKey, openConnect } from './connect.js';

// The UI tests (test/ui) drive the page from outside, which modules can't be reached by; they set
// window.__test first, and get these.
if (/** @type {any} */ (window).__test) Object.assign(window, { suggestName, S, $, post, setPref, speed, liveDiff, topStatements, loadKey, openConnect, checkPasted });
