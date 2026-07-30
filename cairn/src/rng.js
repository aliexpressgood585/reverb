/**
 * Seeded randomness, and the reason there are two of them.
 *
 * `makeRng` in sim.js is an xorshift32 and it IS the tower: change it and every
 * save on every phone describes a world that no longer exists. It is not touched
 * and it is not replaced.
 *
 * `mulberry32` here is for everything that is random but is NOT the terrain —
 * replays, cosmetic variation, a shuffled achievement order, anything added
 * later that needs a repeatable stream without reaching into the world's. Two
 * separate streams so a future feature cannot advance the generator's sequence
 * and silently regenerate a player's tower, which is the exact failure mode the
 * unconditional hard-gap roll in `generate()` exists to prevent.
 *
 * Both are pure functions of a 32-bit seed and identical on every device.
 */

/**
 * mulberry32. Better distribution than xorshift32 and the same cost.
 *
 * @param {number} seed
 * @returns {() => number} uniform in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a over a string, for turning a date or a name into a seed.
 *
 * The daily climb already uses this shape in `store.js` and must keep using its
 * own copy: that hash is a wire format — it decides which tower every player on
 * earth gets today — and a shared helper is a helper someone can "improve".
 *
 * @param {string} str
 * @returns {number}
 */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/**
 * Fisher-Yates, seeded. Shuffles in place and returns the array.
 *
 * @template T
 * @param {T[]} arr
 * @param {() => number} rnd
 * @returns {T[]}
 */
export function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = /** @type {T} */ (arr[i]);
    arr[i] = /** @type {T} */ (arr[j]);
    arr[j] = t;
  }
  return arr;
}
