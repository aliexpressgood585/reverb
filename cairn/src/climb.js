import { FEEL } from './feel.js';

/** The next visible milestone; landing, rather than passing through it, earns it.
 * @param {number} height */
export function nextGoal(height) {
  return (Math.floor(Math.max(0, height) / FEEL.climb.goalStep) + 1) * FEEL.climb.goalStep;
}

/** Untrusted links may choose a bounded seed and target, never save data.
 * @param {string} search
 * @returns {{seed: number, target: number}|null} */
export function readChallenge(search) {
  const p = new URLSearchParams(search);
  if (p.get('challenge') !== '1') return null;
  const seedText = p.get('seed') || '';
  const targetText = p.get('target') || '';
  if (!/^\d{1,10}$/.test(seedText) || !/^\d{1,7}$/.test(targetText)) return null;
  const seed = Number(seedText), target = Number(targetText);
  if (seed < 1 || seed > 0xffffffff || target < 1 || target > FEEL.climb.maxTarget) return null;
  return { seed, target };
}

/** Links start a separate tower with the same initial layout, preserving saves.
 * @param {string} base
 * @param {number} seed
 * @param {number} height */
export function challengeURL(base, seed, height) {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('challenge', '1');
  url.searchParams.set('seed', String(seed >>> 0 || 1));
  url.searchParams.set('target', String(Math.min(FEEL.climb.maxTarget, Math.max(1, Math.floor(height)))));
  return url.href;
}
