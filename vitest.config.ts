import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: '50%',
        minForks: 1,
        isolate: true,
        singleFork: false,
      },
    },
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
      include: ['index.ts', 'domain/**/*.ts', 'stages/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.config.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        // PURE_TYPE: a single type alias, zero executable statements. v8 reports
        // such a file as 0% rather than 100%, which would make the headline
        // number meaningless. It is a placeholder for mc-kernel's coordinate
        // vocabulary and is deleted when kernel is published.
        'domain/position-key.ts',
      ],
      all: true,
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // THE 99% GATE, ON. `docs/testing.md` §6.
      //
      // This block used to explain why there was NO threshold: a number imposed
      // on a skeleton is trivially satisfied by type-only modules and says
      // nothing about the implementation. That argument was about the skeleton
      // and it has expired — `domain/` now carries the mob rules, the frame
      // sweep, the spawn search, the loot and support tables, the weather and
      // the day-night cycle, and `stages/` carries five stages that wire them
      // to two mirrored services.
      //
      // It is 99 rather than the measured 99.49 because the gate exists to catch
      // a REGRESSION. A threshold pinned to the current number turns every
      // unrelated refactor into a red build, which teaches people to lower the
      // number instead of writing the test.
      //
      // WHAT THE REMAINING GAP IS, because a threshold below 100 is only honest
      // if the gap is named. Five branch arms, each recorded at its own call
      // site, none of them reachable by any input a test can construct:
      //
      //   `domain/entities/mob-frame.ts`   an enderman whose sixteen teleport
      //     attempts ALL miss the 8..32 band. About one decision in a billion;
      //     the seed search that drives every other teleport test cannot find
      //     one and no budget would.
      //   `domain/entities/mob-spawn-search.ts`  `HOSTILE_KINDS[index]` under
      //     `noUncheckedIndexedAccess`, over an index the line above clamps into
      //     range. A formality the type system demands and the arithmetic
      //     forbids.
      //   `domain/interactions/place-block.ts`   `UnknownBlock`, for a held item
      //     with no registry row. `test/block-vocabulary-mirror.test.ts` pins
      //     `blockIdOf` total over all 120 `BlockType`s, so in a green tree
      //     nothing can reach it — the same shape as mc-kernel's own excluded
      //     `blockIdOf` fallback, and kept for the same reason: it fails toward
      //     a NAMED refusal rather than toward a block that silently vanishes.
      //   `domain/interactions/ignite-fire.ts`   `UnknownBlock`, for `fire`.
      //   `domain/interactions/ignite-portal.ts` `UnknownBlock`, for
      //     `nether_portal`. The last two are the third one's shape exactly:
      //     both ask kernel's registry for a block the registry carries, and
      //     both would otherwise write a byte nobody chose into the world.
      //
      // WHAT IS NOT ON THIS LIST, and was nearly: the four per-block placement
      // rules. Three of them name blocks kernel gives no item form, so
      // `placeBlock` cannot be handed one and their arms in that file looked
      // exactly like the five above. They are NOT unreachable — the missing
      // thing is one row in kernel's `ITEM_TYPES`, not a logical impossibility —
      // and `test/placement-rules.test.ts` reaches them through a cast that
      // states in as many words that it stands in for that row. That is the
      // distinction this list is for: an arm no input can produce gets named
      // here, an arm one roster row away gets a test.
      //
      // None of the five is excluded and the `exclude` list below was not
      // widened to reach this number. Reaching a coverage figure by contriving
      // inputs to unreachable arms — or by hiding them — is the failure this
      // gate is meant to make visible.
      thresholds: { branches: 99, functions: 99, lines: 99, statements: 99 },
    },
  },
  esbuild: {
    target: 'node22',
    format: 'esm',
    platform: 'node',
  },
})
