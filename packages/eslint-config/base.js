import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

/**
 * Shared base configuration.
 *
 * The rules in the "security invariants" block below are CONTROLS, not style
 * preferences (AGENTS.md §10, SECURITY.md §14). They mechanically enforce claims the
 * documentation makes. Do not relax them to unblock a build — fix the code.
 */
export const securityInvariants = {
  name: 'autoservices/security-invariants',
  rules: {
    // ADR-006 / EMAILS.md §2: only the Resend transport may import the Resend SDK.
    // Anything else makes provider migration a repo-wide refactor and lets a test
    // reach the real provider.
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'resend',
            message:
              'Import the Resend SDK only in packages/email/src/transports/resend.transport.ts. Everywhere else, depend on EmailService.',
          },
        ],
        patterns: [
          {
            // Matches the literal specifier, not a resolved path, so both relative
            // escapes (../../admin/src/...) and package-name imports are covered.
            group: [
              '../../*/src/**',
              '../../../apps/**',
              '**/apps/*/src/**',
              '@autoservices/dashboard',
              '@autoservices/dashboard/**',
              '@autoservices/admin',
              '@autoservices/admin/**',
              '@autoservices/marketing',
              '@autoservices/marketing/**',
              '@autoservices/api',
              '@autoservices/api/**',
              '@autoservices/worker',
              '@autoservices/worker/**',
            ],
            message:
              'Apps must not import from other apps. Share code through packages/ (ADR-010).',
          },
        ],
      },
    ],

    // ARCHITECTURE.md §4: $unscoped()/prisma.raw bypass tenant scoping. Permitted only
    // in the admin module and the worker, which legitimately cross workspaces.
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.name='unscoped']",
        message:
          'unscoped() bypasses tenant isolation. It is permitted only in admin modules and the worker (ARCHITECTURE.md §4).',
      },
      {
        // String-concatenated SQL. $queryRaw tagged templates are parameterised and fine.
        selector: 'CallExpression[callee.property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]',
        message:
          'Use the tagged-template form ($queryRaw`...`), which parameterises. The Unsafe variants concatenate.',
      },
    ],

    // Money must never go through float arithmetic (AGENTS.md rule 9).
    'no-loss-of-precision': 'error',
  },
}

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  securityInvariants,
  {
    name: 'autoservices/base',
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Tests deliberately feed malformed and adversarial input; `any` is the honest type
    // for that, and contorting the tests to avoid it would make them worse.
    name: 'autoservices/tests',
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  prettier,
)
