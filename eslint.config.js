const js = require('@eslint/js');
const globals = require('globals');

const browserNodeGlobals = {
  ...globals.browser,
  ...globals.node,
};

module.exports = [
  {
    ignores: [
      '.auto-claude/**',
      '.cache_gametora/**',
      '.claude/**',
      '.vercel/**',
      'assets/**',
      'cards/**',
      'node_modules/**',
      'reference/**',
      'css/theme-d.build.css',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...browserNodeGlobals,
        ...globals.serviceworker,
      },
    },
    rules: {
      'no-console': 'off',
      'no-empty': 'off',
      'no-redeclare': 'off',
      'no-undef': 'off',
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      'no-useless-assignment': 'off',
      'no-useless-escape': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['tailwind.config.js', 'postcss.config.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
    },
  },
];
