import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Isolation tests share one app instance and one database; running files in
    // parallel against the same tenant fixtures would produce flaky cross-talk.
    fileParallelism: false,
  },
})
