import node from '@autoservices/eslint-config/node'

export default [
  ...node,
  {
    // The worker legitimately operates across workspaces (scheduled sweeps), so the
    // unscoped-access rule is relaxed here — and only here (ARCHITECTURE.md §4).
    name: 'autoservices/worker-cross-tenant',
    files: ['src/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
]
