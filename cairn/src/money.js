import { track, EVENTS } from './analytics.js';

/**
 * Monetisation, as a policy first and a provider second.
 *
 * The rules below are the product decision and they are enforced here rather
 * than trusted to whoever wires the SDK up later. There is exactly one provider
 * today — `none` — and it shows nothing, so the policy is testable now and the
 * ad network is a later, smaller change.
 *
 * THE RULES, and every one of them is a refusal:
 *
 *   1. REWARDED ONLY. There is no interstitial code path in this file. Not
 *      disabled — absent. An interstitial in a game whose whole loop is
 *      death → retry in 900 ms would be an ad between every attempt, which is
 *      the single fastest way to kill a retry loop.
 *   2. NEVER IN THE FIRST THREE SESSIONS. A player who has not decided whether
 *      they like this yet is not shown an advertisement.
 *   3. NEVER GATES CORE PLAY. Both offers are additive: one continue on a run
 *      you already lost, and one extra Daily attempt. Declining costs a player
 *      nothing they had.
 *   4. THE OFFER IS OFFERED ONCE. If it is declined, it does not reappear that
 *      run. A second ask is a nag.
 *   5. PREMIUM REMOVES ADS ENTIRELY and unlocks every cosmetic. It never buys
 *      height, a continue, or an advantage. One purchase, no currency, no shop,
 *      no timers.
 *
 * See DECISIONS.md §22.
 */

/** The single in-app product. Must match the Play Console SKU exactly. */
export const SKU = 'cairn.premium';

/** TODO(you): from AdMob, once the account exists. See BLOCKED.md §3. */
export const AD_UNITS = { rewarded: '' };

/** 'none' shows nothing and logs everything. See BLOCKED.md §3 to change it. */
const PROVIDER = 'none';

const KEY_PREMIUM = 'cairn.premium';
const KEY_SESSIONS = 'cairn.sessions';

/** How many sessions must happen before an ad may ever be offered. */
const GRACE_SESSIONS = 3;

/** @type {Set<string>} placements already offered this run */
const offeredThisRun = new Set();

/**
 * @param {string} k
 * @param {string} v
 */
function write(k, v) {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
}

/**
 * @param {string} k
 * @returns {string|null}
 */
function read(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}

/**
 * Has this player bought the one thing there is to buy?
 *
 * Local only. A real build verifies against the Play Billing library on start;
 * until then this is the entitlement a closed test can grant itself, which is
 * correct for a closed test and wrong for production. BLOCKED.md §4.
 *
 * @returns {boolean}
 */
export function isPremium() { return read(KEY_PREMIUM) === '1'; }

/** @param {boolean} on */
export function setPremium(on) {
  write(KEY_PREMIUM, on ? '1' : '0');
  if (on) track(EVENTS.PURCHASE, { sku: SKU });
}

/** Count this launch. Called once at boot. @returns {number} */
export function countSession() {
  const n = (Number(read(KEY_SESSIONS)) || 0) + 1;
  write(KEY_SESSIONS, String(n));
  track(EVENTS.SESSION_START, { session: n });
  return n;
}

/** @returns {number} */
export function sessions() { return Number(read(KEY_SESSIONS)) || 0; }

/** A new attempt: the once-per-run offers are available again. */
export function newRun() { offeredThisRun.clear(); }

/**
 * May an ad be offered at this placement, right now?
 *
 * Every rule above is a clause here, so the answer to "why did a player see an
 * ad" is one function rather than a search.
 *
 * @param {'continue'|'daily_retry'} placement
 * @returns {boolean}
 */
export function mayOffer(placement) {
  if (PROVIDER === 'none') return false;          // nothing to show
  if (isPremium()) return false;                  // rule 5
  if (sessions() <= GRACE_SESSIONS) return false; // rule 2
  if (offeredThisRun.has(placement)) return false; // rule 4
  return true;
}

/**
 * Offer a rewarded video and resolve with whether the reward was earned.
 *
 * Resolves `false` for every failure — no provider, no fill, a network error, a
 * player who closed it early. The caller's job is then to carry on as though the
 * offer had never been made, which is rule 3 in code: **the reward is a bonus
 * and its absence is the normal state of the game.**
 *
 * @param {'continue'|'daily_retry'} placement
 * @returns {Promise<boolean>}
 */
export async function offerRewarded(placement) {
  if (!mayOffer(placement)) return false;
  offeredThisRun.add(placement);
  track(EVENTS.AD_OFFERED, { placement });
  // A real provider goes here. Nothing else in this file changes.
  return false;
}

/**
 * Cosmetics. Earned by play, never bought — premium unlocks them all at once
 * because the purchase is "stop asking me and give me the paint", not an
 * advantage.
 *
 * Each is a mark id from `progress.js`, so there is one achievement list and no
 * second progression to keep in step.
 *
 * @typedef {object} Cosmetic
 * @property {string} id
 * @property {string} en
 * @property {string} he
 * @property {string} needs  a mark id
 */

/** @type {Cosmetic[]} */
export const COSMETICS = [
  { id: 'stone_default', en: 'Stone', he: 'אבן', needs: '' },
  { id: 'stone_slate', en: 'Slate', he: 'צפחה', needs: 'ten_stones' },
  { id: 'stone_bone', en: 'Bone', he: 'עצם', needs: 'stand' },
  { id: 'stone_ember', en: 'Ember', he: 'גחלת', needs: 'hundred' },
  { id: 'stone_glass', en: 'Glass', he: 'זכוכית', needs: 'kilometre' },
  { id: 'stone_gold', en: 'Memory', he: 'זיכרון', needs: 'hundred_stones' },
  { id: 'trail_none', en: 'No trail', he: 'ללא שובל', needs: '' },
  { id: 'trail_dust', en: 'Dust', he: 'אבק', needs: 'clean_ten' },
  { id: 'trail_spark', en: 'Spark', he: 'ניצוץ', needs: 'streak_3' },
];

/**
 * @param {Cosmetic} c
 * @param {(id: string) => boolean} hasMark
 * @returns {boolean}
 */
export function cosmeticUnlocked(c, hasMark) {
  if (!c.needs) return true;
  if (isPremium()) return true;
  return hasMark(c.needs);
}
