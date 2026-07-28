module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  // `backend` is a separate Node package with its own runtime and deps — this
  // config is browser/React only, so linting it here just reports false errors.
  ignorePatterns: ['dist', '.eslintrc.cjs', 'backend'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    'react/prop-types': 'off',
  },
  overrides: [
    {
      // Build-time config runs in Node, so it may use `process`.
      files: ['vite.config.js'],
      env: { node: true, browser: false },
    },
  ],
};
