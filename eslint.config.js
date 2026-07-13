import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.wrangler'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // TypeScript resolves worker/browser globals; leave no-undef to the type checker.
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
)
