import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    ignores: ['dist', 'coverage', 'public/sw.js'],
    rules: { 'no-undef': 'off', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
);
