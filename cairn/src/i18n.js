/**
 * Strings, and the direction they run in.
 *
 * CAIRN's rule is that nothing is taught with text, so there is less of this
 * than there would be in almost any other game — the tutorial is the level
 * design and the only in-play strings are a height and a word. What needs
 * translating is the furniture: settings, statistics, achievements, the share
 * line.
 *
 * RTL IS A LAYOUT, NOT A STRING. Setting `dir="rtl"` mirrors the box model, and
 * that is most of the work, but three things do not follow it and are handled
 * explicitly:
 *
 *   1. The height numeral is a NUMBER WITH A UNIT and stays LTR in both
 *      languages. `120m` reversed is not a Hebrew convention, it is a bug.
 *   2. The canvas never mirrors. The tower is a physical space; a climb that
 *      goes right in English does not go left in Hebrew.
 *   3. Anything positioned with `left`/`right` in CSS is written with
 *      `inset-inline-start`/`end` so it follows `dir` for free.
 */

/**
 * @typedef {keyof typeof EN} Key
 */

const EN = {
  'lang.name': 'English',
  'title.tagline': 'EVERY DEATH LEAVES A STONE',
  'title.begin': 'TOUCH TO BEGIN',

  'hud.metres': '{n}m',
  'hud.sound.on': 'SOUND ON',
  'hud.sound.off': 'SOUND OFF',
  'hud.daily': 'DAILY',
  'hud.daily.on': 'DAILY {date}',
  'hud.share': 'SHARE THIS',

  'run.best': 'NEW HIGH',
  'run.stones': '{n} STONES',
  'run.share': 'SHARE',

  'toast.copied': 'COPIED TO CLIPBOARD',
  'toast.saved': 'SAVED',
  'toast.failed': 'COULD NOT SHARE',
  'toast.streak': '{n} DAYS RUNNING',
  'toast.unlocked': 'UNLOCKED — {name}',

  'menu.title': 'CAIRN',
  'menu.resume': 'RESUME',
  'menu.stats': 'STATISTICS',
  'menu.marks': 'MARKS',
  'menu.settings': 'SETTINGS',
  'menu.close': 'CLOSE',
  'menu.back': 'BACK',

  'set.sound': 'Sound',
  'set.music': 'Ambience',
  'set.haptics': 'Haptics',
  'set.language': 'Language',
  'set.reduced': 'Reduced motion',
  'set.on': 'ON',
  'set.off': 'OFF',
  'set.auto': 'AUTO',
  'set.wipe': 'ERASE THE TOWER',
  'set.wipe.sure': 'ERASE? THIS CANNOT BE UNDONE',

  'stat.title': 'STATISTICS',
  'stat.highest': 'Highest cairn',
  'stat.stones': 'Stones laid',
  'stat.deaths': 'Deaths',
  'stat.climbed': 'Distance climbed',
  'stat.stood': 'Stood on yourself',
  'stat.streak': 'Current streak',
  'stat.best_streak': 'Longest streak',
  'stat.days': 'Days played',
  'stat.launches': 'Jumps',
  'stat.unit.m': '{n} m',
  'stat.unit.km': '{n} km',
  'stat.unit.days': '{n} days',
  'stat.unit.day': '{n} day',
  'stat.unit.times': '{n}',

  'marks.title': 'MARKS',
  'marks.progress': '{done} of {total}',
  'marks.locked': 'Not yet',

  'share.line': '{h}m — {n} stones below. CAIRN',
  'share.daily': '{h}m — {n} stones below. CAIRN daily {date}',
};

/** @type {Record<Key, string>} */
const HE = {
  'lang.name': 'עברית',
  'title.tagline': 'כל מוות משאיר אבן',
  'title.begin': 'גע כדי להתחיל',

  'hud.metres': '{n}m',
  'hud.sound.on': 'קול פועל',
  'hud.sound.off': 'קול כבוי',
  'hud.daily': 'יומי',
  'hud.daily.on': 'יומי {date}',
  'hud.share': 'שתף את זה',

  'run.best': 'שיא חדש',
  'run.stones': '{n} אבנים',
  'run.share': 'שתף',

  'toast.copied': 'הועתק',
  'toast.saved': 'נשמר',
  'toast.failed': 'השיתוף נכשל',
  'toast.streak': '{n} ימים ברצף',
  'toast.unlocked': 'נפתח — {name}',

  'menu.title': 'קאירן',
  'menu.resume': 'חזרה',
  'menu.stats': 'נתונים',
  'menu.marks': 'אותות',
  'menu.settings': 'הגדרות',
  'menu.close': 'סגור',
  'menu.back': 'חזור',

  'set.sound': 'צלילים',
  'set.music': 'רקע',
  'set.haptics': 'רטט',
  'set.language': 'שפה',
  'set.reduced': 'תנועה מופחתת',
  'set.on': 'פועל',
  'set.off': 'כבוי',
  'set.auto': 'אוטומטי',
  'set.wipe': 'מחק את המגדל',
  'set.wipe.sure': 'למחוק? אי אפשר לבטל',

  'stat.title': 'נתונים',
  'stat.highest': 'המגדל הגבוה',
  'stat.stones': 'אבנים שהונחו',
  'stat.deaths': 'מיתות',
  'stat.climbed': 'מרחק טיפוס',
  'stat.stood': 'עמדת על עצמך',
  'stat.streak': 'רצף נוכחי',
  'stat.best_streak': 'הרצף הארוך',
  'stat.days': 'ימי משחק',
  'stat.launches': 'קפיצות',
  'stat.unit.m': '{n} מ׳',
  'stat.unit.km': '{n} ק״מ',
  'stat.unit.days': '{n} ימים',
  'stat.unit.day': 'יום {n}',
  'stat.unit.times': '{n}',

  'marks.title': 'אותות',
  'marks.progress': '{done} מתוך {total}',
  'marks.locked': 'עדיין לא',

  'share.line': '{h} מ׳ — {n} אבנים מתחת. קאירן',
  'share.daily': '{h} מ׳ — {n} אבנים מתחת. קאירן יומי {date}',
};

const TABLES = { en: EN, he: HE };
export const LANGS = /** @type {const} */ (['en', 'he']);
const RTL = new Set(['he']);

const STORE_KEY = 'cairn.lang';

/** @type {'en'|'he'} */
let current = 'en';

/**
 * The language to start in: an explicit choice if one was made, otherwise the
 * device's. Anything that is not a language we ship falls back to English rather
 * than to a half-translated screen.
 *
 * @returns {'en'|'he'}
 */
function detect() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'en' || saved === 'he') return saved;
  } catch { /* private mode */ }
  const tags = navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language || 'en'];
  for (const tag of tags) {
    const base = String(tag).toLowerCase().split('-')[0];
    // `iw` is the deprecated ISO code for Hebrew and is still what some Android
    // builds report. A device set to Hebrew must not get an English game.
    if (base === 'he' || base === 'iw') return 'he';
    if (base === 'en') return 'en';
  }
  return 'en';
}

/** @returns {'en'|'he'} */
export function lang() { return current; }

/** @returns {boolean} */
export function isRtl() { return RTL.has(current); }

/**
 * Apply a language to the document. Sets `lang` and `dir` so the box model,
 * text alignment and logical CSS properties all follow without a second system.
 *
 * @param {'en'|'he'} next
 */
export function setLang(next) {
  current = TABLES[next] ? next : 'en';
  try { localStorage.setItem(STORE_KEY, current); } catch { /* private mode */ }
  const html = document.documentElement;
  html.lang = current;
  html.dir = isRtl() ? 'rtl' : 'ltr';
}

/** Read the device's preference and apply it. Called once at boot. */
export function initLang() { setLang(detect()); }

/**
 * Look up a string and fill its placeholders.
 *
 * A missing key returns the key itself rather than an empty string, because a
 * screen reading `stat.highest` is a bug you notice and a blank one is a bug you
 * ship.
 *
 * @param {Key} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  const table = TABLES[current];
  const raw = table[key] ?? EN[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_m, name) => {
    const v = vars[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}

/**
 * A number for display, in the current locale's digits and grouping.
 *
 * Hebrew uses Western digits, so this is grouping and decimals rather than
 * numerals — but it goes through `Intl` anyway so that adding a language with
 * different digits later is a table change and not a hunt.
 *
 * @param {number} n
 * @param {number} [decimals]
 * @returns {string}
 */
export function num(n, decimals = 0) {
  try {
    return new Intl.NumberFormat(current, {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(n);
  } catch {
    return n.toFixed(decimals);
  }
}

/**
 * A count of days, in the right grammatical number.
 *
 * Hebrew inflects here and English does too, and "1 ימים" is the kind of thing a
 * native speaker reads as broken software rather than as a rough edge. Only the
 * one/many split is handled: neither language we ship has a dual form for this,
 * and inventing a general plural engine for two strings would be the wrong
 * amount of machinery.
 *
 * @param {number} n
 * @returns {string}
 */
export function days(n) {
  return t(n === 1 ? 'stat.unit.day' : 'stat.unit.days', { n: num(n) });
}

/**
 * A height, formatted for reading. Metres under 10 km, kilometres above.
 *
 * @param {number} metres
 * @returns {string}
 */
export function height(metres) {
  return metres >= 10000
    ? t('stat.unit.km', { n: num(metres / 1000, 1) })
    : t('stat.unit.m', { n: num(Math.round(metres)) });
}
