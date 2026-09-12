// @ts-check
import js from '@eslint/js'
import globals from 'globals'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      'playwright-report',
      'test-results',
      'pnpm-lock.yaml',
      '.husky',
      // 各 Agent 的本地准备目录不属于 Agent-0 工程范围（目录所有权，分工 §2）
      'agent1-prep',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // DS 组件与工具常量同文件导出是常见模式，交由 Agent 后续按需收紧
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Node 侧配置文件（vite/playwright 配置等由 tsconfig.node.json 管）
    files: ['*.config.ts', '*.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
)
