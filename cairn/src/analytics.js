/**
 * Events, into a ring buffer, and nowhere else.
 *
 * The brief is right that you cannot improve retention you cannot see, so every
 * event it names is emitted from the real code path today. What this
 * deliberately does NOT do is send them anywhere: there is no backend, no SDK
 * and no account, and shipping a half-wired Firebase would mean answering
 * Google's Data Safety form with "we collect device identifiers" for data
 * nobody is reading.
 *
 * So the events are real, the sink is swappable, and the default sink is a
 * 200-entry ring in memory that the debug overlay can dump. When there is a
 * backend, `setSink` is the only line that changes — and `RELEASE.md`'s Data
 * Safety answers change with it, which is why that is written down next to the
 * answers rather than here.
 *
 * NOTHING LEAVES THE DEVICE. That statement is what the store listing rests on
 * and it is enforced by there being no network code in this file at all.
 */

/**
 * @typedef {object} Event
 * @property {string} name
 * @property {number} t      ms since the session began
 * @property {Record<string, string|number|boolean>} [props]
 */

const MAX = 200;
/** @type {Event[]} */
const ring = [];
const t0 = Date.now();

/** @type {((e: Event) => void)|null} */
let sink = null;

/**
 * Install a destination for events. Called by nothing today.
 * @param {((e: Event) => void)|null} fn
 */
export function setSink(fn) { sink = fn; }

/**
 * @param {string} name
 * @param {Record<string, string|number|boolean>} [props]
 */
export function track(name, props) {
  /** @type {Event} */
  const e = { name, t: Date.now() - t0 };
  if (props) e.props = props;
  ring.push(e);
  if (ring.length > MAX) ring.shift();
  if (sink) {
    try { sink(e); } catch { /* a broken sink must never break a run */ }
  }
}

/** @returns {Event[]} a copy, newest last */
export function dump() { return ring.slice(); }

/** The events this game emits, named once so a typo is a lint error later. */
export const EVENTS = /** @type {const} */ ({
  SESSION_START: 'session_start',
  RUN_START: 'run_start',
  DEATH: 'death',                 // { height, stood, launches, daily }
  BEST: 'best',                   // { height }
  STOOD_ON_SELF: 'stood_on_self', // { height }
  SHARE: 'share',                 // { how, height }
  MARK: 'mark',                   // { id }
  STREAK: 'streak',               // { days }
  MODE: 'mode',                   // { daily }
  MONUMENT: 'monument',
  MONUMENT_REVEAL: 'monument_reveal', // { at, bodies } the game opened it, not the player
  CLAIM: 'claim',                 // { band, height } a landmark answered
  AD_OFFERED: 'ad_offered',       // { placement }
  AD_SHOWN: 'ad_shown',           // { placement }
  AD_REWARDED: 'ad_rewarded',     // { placement }
  PURCHASE: 'purchase',           // { sku }
  SETTINGS: 'settings',           // { key, value }
});
