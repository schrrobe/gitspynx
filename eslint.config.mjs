// Bug-finding rules only (no formatting): JS + typescript-eslint recommended, Vue essential.
import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import ts from 'typescript-eslint'

export default ts.config(
  { ignores: ['out/**', 'dist/**', 'tools/**', '.work/**', '.vitest/**', '.superpowers/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: ts.parser } }
  },
  { files: ['src/renderer/**'], languageOptions: { globals: globals.browser } },
  { files: ['src/main/**', 'src/preload/**', '*.config.*'], languageOptions: { globals: globals.node } },
  {
    rules: {
      'vue/multi-word-component-names': 'off', // app components (Sidebar, …), not a reusable library
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }]
    }
  }
)
