export default {
  packageManager: 'pnpm',
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
    // Stryker's Vitest runner requires threads; the regular suite keeps its fork pool.
    pool: 'threads',
  },
  mutate: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
  ],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  clearTextReporter: {
    reportMutants: false,
    reportTests: false,
    reportScoreTable: true,
    skipFull: false,
  },
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
}
