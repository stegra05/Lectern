// Flat ESLint config: typescript-eslint's type-aware recommended set plus the
// React hooks rules. Stylistic concerns stay with Prettier; this only guards
// correctness (floating promises, hooks deps, unsafe narrowing).

import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'src-tauri', 'website', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Fire-and-forget is deliberate in UI event handlers; require the
      // explicit `void` marker instead of banning it outright.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // The engine deliberately coerces unknown model output to strings
      // (tolerant normalization in quality.ts); this rule fights that design.
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
  {
    // Test fetch mocks are `async` for the fetch signature without awaiting.
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  {
    // Node-context config files are linted without type information.
    files: ['*.config.js', '*.config.ts', 'vite.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
)
