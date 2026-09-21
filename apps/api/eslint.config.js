import node from '@autoservices/eslint-config/node'

export default [
  ...node,
  {
    name: 'autoservices/api-nest',
    files: ['src/**/*.ts'],
    rules: {
      /**
       * NestJS dependency injection depends on `emitDecoratorMetadata`, which emits
       * `design:paramtypes` referencing the RUNTIME value of each constructor parameter
       * type. Rewriting an injected class to `import type` erases that value and the
       * container fails to resolve it at runtime — a silent, boot-time breakage that
       * the type checker cannot see. The rule is therefore wrong for this app.
       */
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // The admin module legitimately reads across workspaces (ARCHITECTURE.md §4).
    name: 'autoservices/api-admin-cross-tenant',
    files: ['src/modules/admin/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
]
