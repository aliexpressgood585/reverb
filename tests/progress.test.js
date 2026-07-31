import { describe, it, expect, beforeEach } from 'vitest';
import * as P from '../cairn/src/progress.js';
import { MARKS } from '../cairn/src/progress.js';
import { initLang, setLang, t, height, days, isRtl } from '../cairn/src/i18n.js';

/**
 * A localStorage that behaves like the real one, including the part that makes
 * this file necessary: it can throw. Private-mode Safari throws on `setItem`,
 * and a scoreboard that takes the game down with it when it cannot write is a
 * scoreboard that will take the game down.
 */
function fakeStorage(broken = false) {
  /** @type {Map<string, string>} */
  const m = new Map();
  return {
    /** @param {string} k */
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    /**
     * @param {string} k
     * @param {string} v
     */
    setItem: (k, v) => {
      if (broken) throw new Error('QuotaExceededError');
      m.set(k, String(v));
    },
    /** @param {string} k */
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    _map: m,
  };
}

/**
 * `navigator` is a getter-only global in Node 22, so plain assignment throws.
 * Everything the browser gives us has to be installed as a configurable property.
 *
 * @param {string} name
 * @param {unknown} value
 */
function stub(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

beforeEach(() => {
  stub('localStorage', fakeStorage());
  stub('navigator', { languages: ['en-GB'], language: 'en-GB' });
  stub('document', { documentElement: { lang: '', dir: '' } });
  P.reset();
});

describe('the streak', () => {
  it('starts at one on the first day ever', () => {
    expect(P.touchDay('2026-07-30')).toEqual({ rolled: true, streak: 1 });
  });

  it('does not roll twice in the same day', () => {
    P.touchDay('2026-07-30');
    expect(P.touchDay('2026-07-30')).toEqual({ rolled: false, streak: 1 });
    expect(P.get().days).toBe(1);
  });

  it('continues across consecutive days', () => {
    P.touchDay('2026-07-28');
    P.touchDay('2026-07-29');
    expect(P.touchDay('2026-07-30').streak).toBe(3);
  });

  it('breaks when a day is missed', () => {
    P.touchDay('2026-07-28');
    expect(P.touchDay('2026-07-30').streak).toBe(1);
  });

  it('remembers the longest streak after it breaks', () => {
    P.touchDay('2026-07-01');
    P.touchDay('2026-07-02');
    P.touchDay('2026-07-03');
    P.touchDay('2026-07-20');
    expect(P.get().streak).toBe(1);
    expect(P.get().bestStreak).toBe(3);
  });

  it('crosses a month boundary', () => {
    P.touchDay('2026-07-31');
    expect(P.touchDay('2026-08-01').streak).toBe(2);
  });

  it('crosses a year boundary', () => {
    P.touchDay('2026-12-31');
    expect(P.touchDay('2027-01-01').streak).toBe(2);
  });

  it('crosses a leap day', () => {
    P.touchDay('2028-02-28');
    expect(P.touchDay('2028-02-29').streak).toBe(2);
    expect(P.touchDay('2028-03-01').streak).toBe(3);
  });
});

describe('marks', () => {
  const run = (over = {}) => ({
    height: 0, stood: 0, launches: 0, daily: false, bodiesAlive: 0, ...over,
  });

  it('has thirty of them with unique ids', () => {
    expect(MARKS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(MARKS.map((m) => m.id)).size).toBe(MARKS.length);
  });

  it('gives every mark a name in both languages', () => {
    for (const m of MARKS) {
      expect(m.en.length).toBeGreaterThan(0);
      expect(m.he.length).toBeGreaterThan(0);
      // A Hebrew name that is pure Latin means it was never translated.
      expect(/[֐-׿]/.test(m.he)).toBe(true);
    }
  });

  it('unlocks the first stone on the first death', () => {
    P.record({ stones: 1 });
    const won = P.checkMarks(run());
    expect(won.map((m) => m.id)).toContain('first_stone');
  });

  it('never unlocks the same mark twice', () => {
    P.record({ stones: 1 });
    expect(P.checkMarks(run()).length).toBeGreaterThan(0);
    expect(P.checkMarks(run()).map((m) => m.id)).not.toContain('first_stone');
  });

  it('unlocks the run-shaped ones from the run, not the totals', () => {
    const won = P.checkMarks(run({ stood: 3 }));
    expect(won.map((m) => m.id)).toContain('staircase');
  });

  it('survives a mark whose test throws', () => {
    const bad = { id: 'bad', en: 'Bad', he: 'רע', test: () => { throw new Error('nope'); } };
    MARKS.push(/** @type {any} */ (bad));
    expect(() => P.checkMarks(run())).not.toThrow();
    MARKS.pop();
  });

  it('counts progress against the real list only', () => {
    P.get().marks.push('a_mark_that_no_longer_exists');
    const { done, total } = P.markProgress();
    expect(done).toBe(0);
    expect(total).toBe(MARKS.length);
  });
});

describe('persistence', () => {
  it('round-trips', () => {
    P.record({ best: 412.5, stones: 3, stood: 2, launches: 40, climbed: 900 });
    P.touchDay('2026-07-30');
    P.flush();
    const again = P.load();
    expect(again.best).toBe(412.5);
    expect(again.stones).toBe(3);
    expect(again.streak).toBe(1);
  });

  it('drops rubbish instead of believing it', () => {
    globalThis.localStorage.setItem(
      'cairn.progress.v1',
      JSON.stringify({ v: 1, best: 'tall', stones: -5, marks: [1, 2, {}], lastDay: 'yesterday' }),
    );
    const p = P.load();
    expect(p.best).toBe(0);
    expect(p.stones).toBe(0);
    expect(p.marks).toEqual([]);
    expect(p.lastDay).toBe('');
  });

  it('survives unparseable json', () => {
    globalThis.localStorage.setItem('cairn.progress.v1', '{{{');
    expect(() => P.load()).not.toThrow();
    expect(P.get().best).toBe(0);
  });

  it('does not throw when the disk refuses to be written', () => {
    stub('localStorage', fakeStorage(true));
    P.record({ stones: 1 });
    expect(() => P.flush()).not.toThrow();
  });
});

describe('i18n', () => {
  it('falls back to the key rather than to nothing', () => {
    setLang('en');
    expect(t(/** @type {any} */ ('not.a.key'))).toBe('not.a.key');
  });

  it('fills placeholders', () => {
    setLang('en');
    expect(t('run.stones', { n: 12 })).toBe('12 STONES');
  });

  it('has a Hebrew string for every English one', () => {
    setLang('en');
    const en = t('menu.settings');
    setLang('he');
    const he = t('menu.settings');
    expect(he).not.toBe(en);
    expect(/[֐-׿]/.test(he)).toBe(true);
  });

  it('sets dir=rtl on the document for Hebrew, and back', () => {
    setLang('he');
    expect(isRtl()).toBe(true);
    expect(globalThis.document.documentElement.dir).toBe('rtl');
    setLang('en');
    expect(isRtl()).toBe(false);
    expect(globalThis.document.documentElement.dir).toBe('ltr');
  });

  it('starts in English on a Hebrew device — English is the game', () => {
    stub('navigator', { languages: ['he-IL'], language: 'he-IL' });
    initLang();
    expect(isRtl()).toBe(false);
    expect(t('menu.settings')).toBe('SETTINGS');
  });

  it('honours an explicit choice of Hebrew across a restart', () => {
    setLang('he');
    stub('navigator', { languages: ['en-GB'], language: 'en-GB' });
    initLang();
    expect(isRtl()).toBe(true);
  });

  it('does not persist a default nobody chose', () => {
    globalThis.localStorage.clear();
    initLang();
    // A default written to disk becomes indistinguishable from a decision.
    expect(globalThis.localStorage.getItem('cairn.lang')).toBe(null);
  });

  it('switches to kilometres past ten', () => {
    setLang('en');
    expect(height(412)).toBe('412 m');
    expect(height(12345)).toBe('12.3 km');
  });
});

describe('grammatical number', () => {
  it('does not say "1 days" in either language', () => {
    setLang('en');
    expect(days(1)).toBe('1 day');
    expect(days(3)).toBe('3 days');
    setLang('he');
    // "1 ימים" is what a native speaker reads as broken software.
    expect(days(1)).toBe('יום 1');
    expect(days(3)).toBe('3 ימים');
  });
});
