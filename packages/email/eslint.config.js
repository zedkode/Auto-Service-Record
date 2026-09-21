import node from '@autoservices/eslint-config/node'

export default [
  ...node,
  {
    // The ONLY file permitted to import the Resend SDK (ADR-006). The rule exists to
    // keep the provider contained; this is the container.
    name: 'autoservices/email-resend-transport',
    files: ['src/transports/resend.transport.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
]
