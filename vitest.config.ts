import { defineConfig } from 'vitest/config'

// vitest 4 removed `poolOptions.forks.{maxForks,minForks,isolate,singleFork}` in
// favour of top-level `maxWorkers` / `isolate` (poolOptions is deprecated in
// favour of top-level `isolate`); `minForks` and `singleFork` have no
// replacement and are dropped rather than approximated.
const config: ReturnType<typeof defineConfig> = defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    isolate: true,
    maxWorkers: '50%',
    include: ['test/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.git/**'],
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    slowTestThreshold: 300,
    fileParallelism: true,
    sequence: {
      seed: 0,
      hooks: 'stack',
    },
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      enabled: false,
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.config.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // THE 100% GATE, ON. `docs/testing.md` §6 / org toolchain pin table (Wave 0).
      //
      // Statements, functions and lines are all at 100%. Branches is not: one
      // branch (`domain/entities/mob-frame.ts`, the enderman-teleport-search
      // path) is left red rather than papered over with a threshold below 100
      // or a coverage-ignore pragma — see the Wave 0 toolchain-freeze PR body
      // for the exact line, the 9.16-billion-trial deterministic-seed search
      // that backs "no test can reach it", and why deleting the branch is not
      // behaviour-preserving (it is a real, if statistically negligible,
      // possible outcome, not a logical impossibility). The other branch arms
      // this repository used to except at the 99% threshold (a clamped array
      // index; several `UnknownBlock` fallbacks) were resolved by deleting the
      // unreachable code, one line of "why" apiece, at their call sites.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
  esbuild: {
    target: 'node24',
    format: 'esm',
    platform: 'node',
  },
})

export default config
