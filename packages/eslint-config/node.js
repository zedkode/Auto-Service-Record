import globals from 'globals'
import base from './base.js'

export default [
  ...base,
  {
    name: 'autoservices/node',
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Scripts and seeds are operator-facing: printing to stdout is their job.
    name: 'autoservices/node-scripts',
    files: ['**/scripts/**', '**/prisma/seed.ts', '**/*.config.ts', '**/*.config.js'],
    rules: { 'no-console': 'off' },
  },
]
