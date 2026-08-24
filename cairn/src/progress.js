import { t } from './i18n.js';

/**
 * Everything that accumulates across sessions: lifetime counters, the daily
 * streak, and the marks.
 *
 * SEPARATE FROM THE TOWER, DELIBERATELY. `store.js` holds the corpses and the
 * seed — losing that is losing a player's work, so it has a migration chain, a
 * backup slot and per-row validation. This is a scoreboard. If it is ever lost
 * the player loses bragging rights and not their tower, so it gets its own key
 * and its own much simpler contract, and a corrupt scoreboard can never take a
 * tower down with it.
 *
 * The counters are written on every death, which is roughly once per attempt.
 * That is far too often for `localStorage`, so writes are coalesced: the object
 * in memory is the truth and it is flushed on death, on backgrounding and on
 * page hide.
 */

const KEY = 'cairn.progress.v1';

/**
 * @typedef {object} Progress
 * @property {number} v            schema
 * @property {number} best         highest cairn ever, metres
 * @property {number} stones       bodies laid, lifetime
 * @property {number} deaths       same thing counted from the other end
 * @property {number} climbed      total metres ascended, lifetime
 * @property {number} stood        landings onto one of your own bodies
 * @property {number} launches     jumps taken
 * @property {number} streak       consecutive UTC days played
 * @property {number} bestStreak
 * @property {number} days         distinct days played
 * @property {string} lastDay      the last UTC date a run happened on
 * @property {string[]} marks      ids of everything unlocked
 */

/** @returns {Progress} */
function blank() {
  return {
    v: 1, best: 0, stones: 0, deaths: 0, climbed: 0, stood: 0, launches: 0,
    streak: 0, bestStreak: 0, days: 0, lastDay: '', marks: [],
  };
}

/** @type {Progress} */
let P = blank();
let dirty = false;

/**
 * Coerce whatever was on disk into something the rest of the game can read.
 *
 * Every field is checked individually and a bad one is replaced with its
 * default. A scoreboard is not worth failing a boot over, and this is the file
 * most likely to be hand-edited by someone poking at localStorage.
 *
 * @param {any} raw
 * @returns {Progress}
 */
function coerce(raw) {
  const out = blank();
  if (!raw || typeof raw !== 'object') return out;
  /** @type {(k: keyof Progress) => void} */
  const nOf = (k) => {
    const v = Number(raw[k]);
    if (Number.isFinite(v) && v >= 0) /** @type {any} */ (out)[k] = v;
  };
  for (const k of /** @type {const} */ ([
    'best', 'stones', 'deaths', 'climbed', 'stood', 'launches',
    'streak', 'bestStreak', 'days',
  ])) nOf(k);
  if (typeof raw.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastDay)) {
    out.lastDay = raw.lastDay;
  }
  if (Array.isArray(raw.marks)) {
    out.marks = raw.marks.filter(/** @param {unknown} m */ (m) => typeof m === 'string').slice(0, 200);
  }
  return out;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    P = coerce(raw ? JSON.parse(raw) : null);
  } catch {
    P = blank();
  }
  return P;
}

export function flush() {
  if (!dirty) return;
  dirty = false;
  try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* quota, private mode */ }
}

/** @returns {Progress} */
export function get() { return P; }

/** Wipe the scoreboard. The tower is `Store.wipe` and is a separate decision. */
export function reset() {
  P = blank();
  dirty = true;
  flush();
}

// --------------------------------------------------------------------- streak

/**
 * The streak, rolled on the first run of a UTC day.
 *
 * UTC rather than local, for exactly the reason the Daily Climb is UTC: the
 * tower everyone is playing today is the same tower, so "today" has to mean the
 * same thing in Auckland and in Los Angeles. A player who travels does not lose
 * a streak to a timezone.
 *
 * Yesterday continues it, anything older restarts it, the same day is a no-op.
 *
 * @param {string} today YYYY-MM-DD, UTC
 * @returns {{rolled: boolean, streak: number}}
 */
export function touchDay(today) {
  if (P.lastDay === today) return { rolled: false, streak: P.streak };
  const prev = P.lastDay;
  P.lastDay = today;
  P.days += 1;
  if (prev && dayBefore(today) === prev) P.streak += 1;
  else P.streak = 1;
  if (P.streak > P.bestStreak) P.bestStreak = P.streak;
  dirty = true;
  return { rolled: true, streak: P.streak };
}

/**
 * @param {string} date YYYY-MM-DD
 * @returns {string} the UTC date one day earlier
 */
export function dayBefore(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// --------------------------------------------------------------------- counts

/** @param {{best?: number, climbed?: number, stones?: number, stood?: number, launches?: number}} d */
export function record(d) {
  if (d.best !== undefined && d.best > P.best) P.best = d.best;
  if (d.climbed) P.climbed += d.climbed;
  if (d.stones) { P.stones += d.stones; P.deaths += d.stones; }
  if (d.stood) P.stood += d.stood;
  if (d.launches) P.launches += d.launches;
  dirty = true;
}

// ---------------------------------------------------------------------- marks

/**
 * THE MARKS — achievements, named for what the game calls them.
 *
 * Thirty, and the shape of the list is the design: they are weighted toward
 * *the tower*, not toward height. A list of "reach 100 m, reach 200 m" is a
 * progress bar with extra steps; these ask the player to notice what the game is
 * actually about, and several of them can only be earned by using a corpse
 * deliberately.
 *
 * `test` runs against a snapshot after every death. It must be cheap and pure.
 *
 * @typedef {object} Mark
 * @property {string} id
 * @property {string} en
 * @property {string} he
 * @property {string} hint  what it asks for, in English
 * @property {string} hintHe ... and in Hebrew
 * @property {(p: Progress, run: RunSummary) => boolean} test
 */

/**
 * What one attempt did. Handed to every mark's test after the death that ended
 * it.
 *
 * @typedef {object} RunSummary
 * @property {number} height     apex of the death, metres
 * @property {number} stood      landings on your own bodies this run
 * @property {number} launches
 * @property {boolean} daily     was this the Daily Climb
 * @property {number} bodiesAlive corpses still solid in the world
 */

/** @type {Mark[]} */
export const MARKS = [
  // — the first hour ————————————————————————————————————————————
  { id: 'first_stone', en: 'First Stone', he: 'האבן הראשונה',
    hint: "Die once. Every death leaves one.",
    hintHe: "תמות פעם אחת. כל מוות משאיר אחת.",
    test: (p) => p.stones >= 1 },
  { id: 'ten_stones', en: 'Ten Below', he: 'עשר מתחת',
    hint: "Leave ten bodies in the tower.",
    hintHe: "השאר עשר גופות במגדל.",
    test: (p) => p.stones >= 10 },
  { id: 'stand', en: 'Stand On Yourself', he: 'לעמוד על עצמך',
    hint: "Land on a body you left behind.",
    hintHe: "תנחת על גופה שהשארת.",
    test: (p) => p.stood >= 1 },
  { id: 'fifty', en: 'Fifty Metres', he: 'חמישים מטר',
    hint: "Reach 50 m.",
    hintHe: "הגע ל-50 מטר.",
    test: (p) => p.best >= 50 },
  { id: 'hundred', en: 'A Hundred Up', he: 'מאה למעלה',
    hint: "Reach 100 m.",
    hintHe: "הגע ל-100 מטר.",
    test: (p) => p.best >= 100 },

  // — the tower ——————————————————————————————————————————————
  { id: 'stood_ten', en: 'Ten Times Yourself', he: 'עשר פעמים על עצמך',
    hint: "Stand on your own bodies ten times.",
    hintHe: "עמוד על הגופות שלך עשר פעמים.",
    test: (p) => p.stood >= 10 },
  { id: 'stood_hundred', en: 'A Hundred Times Yourself', he: 'מאה פעמים על עצמך',
    hint: "Stand on your own bodies a hundred times.",
    hintHe: "עמוד על הגופות שלך מאה פעמים.",
    test: (p) => p.stood >= 100 },
  { id: 'staircase', en: 'Staircase', he: 'גרם מדרגות',
    hint: "Three times on your own bodies in ONE attempt.",
    hintHe: "שלוש פעמים על הגופות שלך בניסיון אחד.",
    test: (_p, r) => r.stood >= 3 },
  { id: 'ladder', en: 'Ladder', he: 'סולם',
    hint: "Six times on your own bodies in one attempt.",
    hintHe: "שש פעמים על הגופות שלך בניסיון אחד.",
    test: (_p, r) => r.stood >= 6 },
  { id: 'built_of_you', en: 'Built Of You', he: 'בנוי ממך',
    hint: "End an attempt with 25 bodies still bearing weight.",
    hintHe: "סיים ניסיון כש-25 גופות עדיין נושאות משקל.",
    test: (_p, r) => r.bodiesAlive >= 25 },
  { id: 'hundred_stones', en: 'A Hundred Stones', he: 'מאה אבנים',
    hint: "Leave a hundred bodies.",
    hintHe: "השאר מאה גופות.",
    test: (p) => p.stones >= 100 },
  { id: 'five_hundred', en: 'Five Hundred Selves', he: 'חמש מאות גרסאות',
    hint: "Leave five hundred bodies.",
    hintHe: "השאר חמש מאות גופות.",
    test: (p) => p.stones >= 500 },

  // — height ——————————————————————————————————————————————————
  { id: 'three_hundred', en: 'Three Hundred', he: 'שלוש מאות',
    hint: "Reach 300 m.",
    hintHe: "הגע ל-300 מטר.",
    test: (p) => p.best >= 300 },
  { id: 'six_hundred', en: 'Six Hundred', he: 'שש מאות',
    hint: "Reach 600 m.",
    hintHe: "הגע ל-600 מטר.",
    test: (p) => p.best >= 600 },
  { id: 'kilometre', en: 'A Kilometre Up', he: 'קילומטר למעלה',
    hint: "Reach 1,000 m.",
    hintHe: "הגע ל-1,000 מטר.",
    test: (p) => p.best >= 1000 },
  { id: 'two_km', en: 'Two Kilometres', he: 'שני קילומטרים',
    hint: "Reach 2,000 m.",
    hintHe: "הגע ל-2,000 מטר.",
    test: (p) => p.best >= 2000 },
  { id: 'total_ten', en: 'Ten Kilometres Climbed', he: 'עשרה ק״מ טיפוס',
    hint: "Ten kilometres of climbing, across every attempt.",
    hintHe: "עשרה קילומטרים של טיפוס, בסך כל הניסיונות.",
    test: (p) => p.climbed >= 10000 },
  { id: 'total_hundred', en: 'A Hundred Kilometres Climbed', he: 'מאה ק״מ טיפוס',
    hint: "A hundred kilometres, across every attempt.",
    hintHe: "מאה קילומטרים, בסך כל הניסיונות.",
    test: (p) => p.climbed >= 100000 },

  // — skill ———————————————————————————————————————————————————
  { id: 'clean_ten', en: 'Ten Clean Jumps', he: 'עשר קפיצות נקיות',
    hint: "Reach 150 m in one attempt, ten launches or more, without standing on a single body.",
    hintHe: "הגע ל-150 מטר בניסיון אחד, עשרה זינוקים ומעלה, בלי לעמוד על אף גופה.",
    test: (_p, r) => r.launches >= 10 && r.stood === 0 && r.height >= 150 },
  { id: 'clean_thirty', en: 'Thirty Without Falling', he: 'שלושים בלי ליפול',
    hint: "Thirty launches in a single attempt.",
    hintHe: "שלושים זינוקים בניסיון אחד.",
    test: (_p, r) => r.launches >= 30 },
  { id: 'no_help', en: 'Nobody Held You', he: 'אף אחד לא החזיק אותך',
    hint: "Reach 400 m without standing on a single body.",
    hintHe: "הגע ל-400 מטר בלי לעמוד על אף גופה.",
    test: (_p, r) => r.height >= 400 && r.stood === 0 },
  { id: 'thousand_jumps', en: 'A Thousand Jumps', he: 'אלף קפיצות',
    hint: "A thousand launches in total.",
    hintHe: "אלף זינוקים בסך הכול.",
    test: (p) => p.launches >= 1000 },
  { id: 'ten_thousand_jumps', en: 'Ten Thousand Jumps', he: 'עשרת אלפים קפיצות',
    hint: "Ten thousand launches in total.",
    hintHe: "עשרת אלפים זינוקים בסך הכול.",
    test: (p) => p.launches >= 10000 },

  // — the daily ————————————————————————————————————————————————
  { id: 'daily_first', en: 'The Same Tower', he: 'אותו מגדל',
    hint: "Play the Daily Climb once.",
    hintHe: "שחק פעם אחת בטיפוס היומי.",
    test: (_p, r) => r.daily },
  { id: 'daily_300', en: 'Three Hundred, Today', he: 'שלוש מאות, היום',
    hint: "Reach 300 m on the Daily Climb.",
    hintHe: "הגע ל-300 מטר בטיפוס היומי.",
    test: (_p, r) => r.daily && r.height >= 300 },
  { id: 'streak_3', en: 'Three Days Running', he: 'שלושה ימים ברצף',
    hint: "Play three days running.",
    hintHe: "שחק שלושה ימים ברצף.",
    test: (p) => p.streak >= 3 },
  { id: 'streak_7', en: 'A Week Of It', he: 'שבוע שלם',
    hint: "Play seven days running.",
    hintHe: "שחק שבעה ימים ברצף.",
    test: (p) => p.streak >= 7 },
  { id: 'streak_30', en: 'A Month Of It', he: 'חודש שלם',
    hint: "Play thirty days running.",
    hintHe: "שחק שלושים ימים ברצף.",
    test: (p) => p.streak >= 30 },

  // — the long tail ————————————————————————————————————————————
  { id: 'ten_days', en: 'Ten Days', he: 'עשרה ימים',
    hint: "Play on ten separate days.",
    hintHe: "שחק בעשרה ימים שונים.",
    test: (p) => p.days >= 10 },
  { id: 'thousand_stones', en: 'A Thousand Selves', he: 'אלף גרסאות',
    hint: "Leave a thousand bodies.",
    hintHe: "השאר אלף גופות.",
    test: (p) => p.stones >= 1000 },
];

/**
 * Test everything and return whatever just unlocked.
 *
 * @param {RunSummary} run
 * @returns {Mark[]} newly earned, in list order
 */
export function checkMarks(run) {
  /** @type {Mark[]} */
  const won = [];
  for (const m of MARKS) {
    if (P.marks.includes(m.id)) continue;
    let ok;
    // A mark whose predicate throws must not stop the ones after it, and must
    // certainly not stop the death transition it is running inside.
    try { ok = m.test(P, run); } catch { ok = false; }
    if (ok) { P.marks.push(m.id); won.push(m); dirty = true; }
  }
  return won;
}

/**
 * @param {Mark} m
 * @returns {string} the mark's name in the current language
 */
export function markName(m) {
  return t('lang.name') === 'עברית' ? m.he : m.en;
}

/**
 * WHAT A MARK ACTUALLY ASKS FOR.
 *
 * The marks screen listed thirty names against thirty "Not yet"s and said
 * nothing else, so a player looking at "Staircase" or "Built Of You" had no way
 * to know what either wanted. This game's no-text rule is about the TOWER
 * teaching itself — it was never a licence to hide what a goal is, and a goal
 * nobody can read gives no direction at all.
 *
 * Every line here is written from the mark's `test`, not from its name, because
 * several of them are subtler than they sound: "Ten Clean Jumps" also demands
 * 150 m and zero bodies stood on, and a hint that said "ten clean jumps" would
 * be a wrong hint, which is worse than none.
 *
 * @param {Mark} m
 * @returns {string}
 */
export function markHint(m) {
  return t('lang.name') === 'עברית' ? m.hintHe : m.hint;
}

/** @returns {{done: number, total: number}} */
export function markProgress() {
  return { done: P.marks.filter((id) => MARKS.some((m) => m.id === id)).length, total: MARKS.length };
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function hasMark(id) { return P.marks.includes(id); }
