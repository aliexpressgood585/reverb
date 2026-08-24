import { t, num, height as fmtHeight, days, lang, setLang, LANGS } from './i18n.js';
import * as Progress from './progress.js';
import { MARKS } from './progress.js';

/** How long an armed ERASE stays armed before it forgets. */
const WIPE_ARM_MS = 4000;
import { track, EVENTS } from './analytics.js';

/**
 * Menu, statistics, marks, settings — one element, four contents.
 *
 * A game with four separately styled screens is a game with four things to keep
 * in step, and CAIRN's interface is small enough not to need them. Everything
 * here is built from two row shapes and a footer.
 *
 * THE PANEL IS THE ONLY THING IN THE PRODUCT ALLOWED TO PAUSE. It exists because
 * a store release needs settings and statistics somewhere, not because the climb
 * wanted interrupting — which is why it is reached from a corner control and
 * never raises itself. Test 14 pins the rule that nothing blocks the middle of
 * the screen during a climb, and this obeys it by only ever opening on a touch.
 *
 * All text goes through `t()`. All layout uses logical properties, so `dir`
 * mirrors it for free.
 */

/** @typedef {'menu'|'stats'|'marks'|'settings'} Screen */

export class Panel {
  /**
   * @param {HTMLElement} root the #panel element
   * @param {{
   *   onClose: () => void,
   *   onLangChange: () => void,
   *   onWipe: () => void,
   *   getAudio: () => { muted: boolean, setMuted: (m: boolean) => void },
   *   getHaptics: () => boolean,
   *   setHaptics: (on: boolean) => void,
   * }} hooks
   */
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    /** @type {Screen} */
    this.screen = 'menu';
    this.open = false;
    /** Two taps to erase a tower. The first arms it, the second does it. */
    this.wipeArmed = false;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    this._wipeTimer = undefined;
  }

  /** @param {Screen} [screen] */
  show(screen = 'menu') {
    this.screen = screen;
    this.open = true;
    this.wipeArmed = false;
    // ... and the pending disarm goes with it, or a timer from a previous visit
    // fires against a button that no longer exists.
    clearTimeout(this._wipeTimer);
    this.root.className = 'on';
    this.render();
    track(EVENTS.SETTINGS, { key: 'panel', value: screen });
  }

  hide() {
    this.open = false;
    this.root.className = '';
    this.root.replaceChildren();
    this.hooks.onClose();
  }

  /**
   * @param {string} tag
   * @param {string} cls
   * @param {string} [text]
   * @returns {HTMLElement}
   */
  _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /**
   * @param {string} label
   * @param {string} value
   * @returns {HTMLElement}
   */
  _row(label, value) {
    const r = this._el('div', 'row');
    r.append(this._el('span', 'lab', label), this._el('span', 'val', value));
    return r;
  }

  /**
   * @param {string} label
   * @param {string} cls
   * @param {() => void} onTap
   * @returns {HTMLButtonElement}
   */
  _btn(label, cls, onTap) {
    const b = /** @type {HTMLButtonElement} */ (this._el('button', `btn ${cls}`, label));
    b.type = 'button';
    // pointerdown, never click: everything in this product reacts on the press.
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onTap();
    });
    return b;
  }

  render() {
    const r = this.root;
    r.replaceChildren();
    const body = this._el('div', 'body');
    const foot = this._el('div', 'foot');

    if (this.screen === 'menu') {
      r.append(this._el('h2', '', t('menu.title')));
      body.append(
        this._btn(t('menu.stats'), '', () => this.show('stats')),
        this._btn(t('menu.marks'), '', () => this.show('marks')),
        this._btn(t('menu.settings'), '', () => this.show('settings')),
      );
      for (const b of Array.from(body.children)) {
        /** @type {HTMLElement} */ (b).style.width = '100%';
        /** @type {HTMLElement} */ (b).style.marginBottom = '10px';
      }
      foot.append(this._btn(t('menu.resume'), 'primary', () => this.hide()));
    } else if (this.screen === 'stats') {
      r.append(this._el('h2', '', t('stat.title')));
      const p = Progress.get();
      body.append(
        this._row(t('stat.highest'), fmtHeight(p.best)),
        this._row(t('stat.stones'), num(p.stones)),
        this._row(t('stat.stood'), num(p.stood)),
        this._row(t('stat.climbed'), fmtHeight(p.climbed)),
        this._row(t('stat.launches'), num(p.launches)),
        this._row(t('stat.streak'), days(p.streak)),
        this._row(t('stat.best_streak'), days(p.bestStreak)),
        this._row(t('stat.days'), days(p.days)),
      );
      foot.append(this._btn(t('menu.back'), '', () => this.show('menu')));
    } else if (this.screen === 'marks') {
      const { done, total } = Progress.markProgress();
      r.append(this._el('h2', '', `${t('marks.title')} · ${t('marks.progress', { done, total })}`));
      for (const m of MARKS) {
        const got = Progress.hasMark(m.id);
        const row = this._el('div', got ? 'mark got' : 'mark');
        // Name and state on the top line, what it asks for underneath. A list
        // of thirty names against thirty "Not yet"s is thirty mysteries, and
        // this game hides how the TOWER works, never what a goal is.
        const head = this._el('div', 'mkhead');
        head.append(
          this._el('span', 'nm', Progress.markName(m)),
          this._el('span', 'st', got ? '◆' : t('marks.locked')),
        );
        row.append(head, this._el('span', 'hint', Progress.markHint(m)));
        body.append(row);
      }
      foot.append(this._btn(t('menu.back'), '', () => this.show('menu')));
    } else {
      r.append(this._el('h2', '', t('menu.settings')));
      const audio = this.hooks.getAudio();
      /**
       * @param {import('./i18n.js').Key} labelKey
       * @param {boolean} on
       * @param {(on: boolean) => void} set
       * @returns {HTMLElement}
       */
      const toggle = (labelKey, on, set) => {
        const row = this._el('div', 'row');
        const val = this._el('span', 'val', on ? t('set.on') : t('set.off'));
        row.append(this._el('span', 'lab', t(labelKey)), val);
        row.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const next = !(val.textContent === t('set.on'));
          set(next);
          val.textContent = next ? t('set.on') : t('set.off');
          track(EVENTS.SETTINGS, { key: labelKey, value: String(next) });
        });
        return row;
      };

      body.append(
        toggle('set.sound', !audio.muted, (on) => audio.setMuted(!on)),
        toggle('set.haptics', this.hooks.getHaptics(), (on) => this.hooks.setHaptics(on)),
      );

      // Language. A list rather than a switch, so adding a third is a data change.
      const langRow = this._el('div', 'row');
      const langVal = this._el('span', 'val', t('lang.name'));
      langRow.append(this._el('span', 'lab', t('set.language')), langVal);
      langRow.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const i = LANGS.indexOf(lang());
        setLang(LANGS[(i + 1) % LANGS.length] ?? 'en');
        track(EVENTS.SETTINGS, { key: 'lang', value: lang() });
        this.hooks.onLangChange();
        this.render();
      });
      body.append(langRow);

      // TWO TAPS, AND THE SECOND ONE DISARMS ITSELF.
      //
      // The first tap arms; the second erases every body, the record and the
      // streak, with no recovery — `Store.wipe` clears the backup slot too. So
      // an armed button must not sit there waiting: a player who arms it,
      // reads the warning, decides against it and then taps anywhere on that
      // row later has destroyed their tower with a stray touch. It disarms
      // itself after `WIPE_ARM_MS` and on leaving the screen.
      const wipe = this._btn(t('set.wipe'), 'danger', () => {
        if (!this.wipeArmed) {
          this.wipeArmed = true;
          wipe.textContent = t('set.wipe.sure');
          wipe.classList.add('armed');
          clearTimeout(this._wipeTimer);
          this._wipeTimer = setTimeout(() => {
            this.wipeArmed = false;
            wipe.textContent = t('set.wipe');
            wipe.classList.remove('armed');
          }, WIPE_ARM_MS);
          return;
        }
        clearTimeout(this._wipeTimer);
        this.hooks.onWipe();
        this.hide();
      });
      wipe.style.width = '100%';
      wipe.style.marginTop = '18px';
      body.append(wipe);

      foot.append(this._btn(t('menu.back'), '', () => this.show('menu')));
    }

    r.append(body, foot);
  }
}
