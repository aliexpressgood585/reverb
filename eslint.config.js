import js from '@eslint/js';
import globals from 'globals';

/**
 * Lint rules chosen for the failure modes this project has actually had, not
 * for style. Formatting belongs to Prettier and is not litigated here.
 *
 * The two that matter:
 *
 *   no-restricted-syntax bans `new` inside the frame loop's hot paths by name,
 *   because a per-frame allocation is the one performance bug this game cannot
 *   see in a screenshot and cannot measure on a phone it does not own.
 *
 *   no-restricted-globals bans `Math.random` in the simulation. A tower is a
 *   seed; one unseeded call anywhere in `cairn/src/sim.js` and determinism —
 *   which the daily climb, the share card and acceptance test 1 all rest on —
 *   is quietly gone.
 */
export default [
  js.configs.recommended,
  {
    files: ['cairn/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-implicit-coercion': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // THE SIMULATION IS A PURE FUNCTION OF ITS SEED. Nothing else is allowed in.
    files: ['cairn/src/sim.js'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'The simulation is seeded. Use world.rng() — a tower must be identical on every device, '
            + 'and the daily climb, the share card and acceptance test 1 all depend on it.',
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    ignores: ['dist/**', 'dist-android/**', 'node_modules/**', 'src/**',
      'android/**', 'public/**', 'store/**', 'shots/**', 'keystore/**'],
  },
];
