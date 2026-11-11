import js from '@eslint/js';

export default [
  {
    ignores: [
      'node_modules/',
      'test-results/',
      'playwright-report/',
      // A ported third-party module: kept as it came.
      'public/js/gift/',
    ],
  },
  js.configs.recommended,
  // tsc reports undeclared names with real browser and Node types.
  { rules: { 'no-undef': 'off' } },
];
