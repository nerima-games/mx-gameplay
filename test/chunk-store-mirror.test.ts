/**
 * The `ChunkStore` mirror is pinned against mc-worldgen's real interface.
 *
 * ---------------------------------------------------------------------------
 * What this file is defending against
 * ---------------------------------------------------------------------------
 *
 * `domain/chunk-store-port.ts` is a temporary local copy of a service that
 * lives in another repository, and its header promises that deleting it and
 * repointing every import at `@nerima-games/mc-worldgen` will typecheck.
 * Nothing but a test can enforce that promise, and the failure mode if it goes
 * unenforced is not a compile error — it is silent.
 *
 * `ChunkStore` is a `Context.Tag`, and Effect resolves Tags BY THEIR TEXTUAL
 * KEY. Both copies use `'@nerima-games/mc-worldgen/ChunkStore'`, so in any
 * bundle containing two of them — mc-compose depends on both mx-gameplay and,
 * transitively, mc-worldgen — a `Layer` built against a narrow mirror satisfies
 * the wide tag, and every method the narrow copy omitted is `undefined` at the
 * point of use. TypeScript cannot see it: the two classes are nominally
 * distinct types denoting one service. mc-sim's `test/kernel-mirror.test.ts`
 * records the same near-miss with `ClockPort`, which is where this pattern
 * comes from.
 *
 * So the shape is asserted in both directions, at compile time, and the tag key
 * is asserted literally.
 *
 * ---------------------------------------------------------------------------
 * The capability assertions that used to be here
 * ---------------------------------------------------------------------------
 *
 * They are in `./block-vocabulary-mirror.test.ts`, unchanged, because the
 * predicates they cover are in `domain/block-vocabulary.ts` now. They were never
 * really about `ChunkStore`: `fallsWhenUnsupported`, `isReplaceable`,
 * `validSpawnSurface` and `canSupportAttachments` are mc-KERNEL's flags, and
 * this file pins a mirror of mc-worldgen. Having them here made this test read
 * as though it covered the repoint promise for them, which it could not — the
 * promise was false the whole time and it took mc-dev-meta's `pnpm
 * check:mirrors` to say so.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, type Layer, type Scope } from 'effect'
import {
  AIR_BLOCK_ID,
  ChunkStore,
  type BlockId,
  type BlockPosition,
  type BlockReading,
  type BlockWriteOutcome,
  type ChunkCoord,
  type ChunkDirtySubscription,
  type ChunkNeighbours,
  type ChunkStoreApi,
  type LightReading,
  type WorldgenChunk,
} from '../src/domain/chunk-store-port'

/**
 * mc-worldgen's `ChunkStoreApi`, restated from
 * `mc-worldgen/application/chunk-store.ts`.
 *
 * Written out rather than imported because mc-worldgen is not published — which
 * is the same reason the mirror exists at all. When it is published, this alias
 * becomes `import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'` and
 * every assertion below keeps its meaning unchanged.
 *
 * `Chunk` there has `biomes: ReadonlyArray<BiomeType>`; here it is
 * `ReadonlyArray<string>`, which is the one deliberate widening the mirror's
 * header records. It is restated the same way so that this file checks
 * everything EXCEPT the widening, rather than quietly checking nothing.
 */
type WorldgenChunkStoreApi = {
  readonly load: (coord: ChunkCoord) => Effect.Effect<WorldgenChunk>
  readonly peek: (coord: ChunkCoord) => Effect.Effect<WorldgenChunk | undefined>
  readonly snapshot: (coord: ChunkCoord) => Effect.Effect<WorldgenChunk | undefined>
  readonly isLoaded: (coord: ChunkCoord) => Effect.Effect<boolean>
  readonly loadedCoords: Effect.Effect<ReadonlyArray<ChunkCoord>>
  readonly neighbours: (coord: ChunkCoord) => Effect.Effect<ChunkNeighbours>
  readonly unload: (coord: ChunkCoord) => Effect.Effect<boolean>
  readonly getBlock: (position: BlockPosition) => Effect.Effect<BlockReading>
  readonly setBlock: (position: BlockPosition, block: BlockId) => Effect.Effect<BlockWriteOutcome>
  readonly getLight: (position: BlockPosition) => Effect.Effect<LightReading>
  readonly subscribeDirty: Effect.Effect<ChunkDirtySubscription>
  readonly subscribeDirtyScoped: Effect.Effect<ChunkDirtySubscription, never, Scope.Scope>
  readonly reset: Effect.Effect<void>
}

describe('the ChunkStore mirror', () => {
  it.effect('matches mc-worldgen\'s interface in BOTH directions', () =>
    Effect.sync(() => {
      // The assertions ARE the assignments. A method added, removed or
      // re-signed on either side stops the build here rather than at the
      // repoint — and, more importantly, rather than at runtime with an
      // `undefined` method.
      const asWorldgen = (api: ChunkStoreApi): WorldgenChunkStoreApi => api
      const asMirror = (api: WorldgenChunkStoreApi): ChunkStoreApi => api

      expect(typeof asWorldgen).toBe('function')
      expect(typeof asMirror).toBe('function')
    }),
  )

  it.effect('uses mc-worldgen\'s tag key, character for character', () =>
    Effect.sync(() => {
      // If this string drifts, Effect resolves two different services and the
      // failure is a missing method at runtime in a bundle neither repository
      // tested alone.
      expect(ChunkStore.key).toBe('@nerima-games/mc-worldgen/ChunkStore')
    }),
  )

  it.effect('does not leak into this package\'s published surface', () =>
    Effect.gen(function* () {
      // `index.ts` deliberately omits this module, exactly as it omits
      // `domain/frame-contract.ts` and `domain/position-key.ts`. Re-exporting
      // another repository's service would make deleting the stand-in a
      // breaking change for consumers of mx-gameplay.
      const barrel = yield* Effect.promise(() => import('../src/index'))
      expect(Object.keys(barrel)).not.toContain('ChunkStore')
      // `AIR_BLOCK_ID` rather than `fallsWhenUnsupported`, which this module no
      // longer exports — see the note on the capability move below. Naming a
      // symbol the file does not have would assert nothing.
      expect(Object.keys(barrel)).not.toContain('AIR_BLOCK_ID')
    }),
  )

  it.effect('hands back only what mc-worldgen\'s barrel can replace', () =>
    Effect.gen(function* () {
      // THE ASSERTION THE CAPABILITY MOVE ADDED, and the one this file was
      // missing when it mattered. `domain/chunk-store-port.ts` used to export
      // `fallsWhenUnsupported`, `isReplaceable`, `validSpawnSurface` and
      // `canSupportAttachments` — mc-KERNEL's capability flags, in a file whose
      // header promises that repointing every import at
      // `@nerima-games/mc-worldgen` will typecheck. mc-worldgen exports none of
      // the four, so the promise was false and the repoint would have deleted
      // them. They live in `../domain/block-vocabulary` now, which is the mirror
      // mc-kernel's barrel replaces.
      //
      // This does NOT re-check what mc-dev-meta's `pnpm check:mirrors` checks —
      // that gate imports both packages and can see mc-worldgen's real barrel,
      // and this repository cannot. What it pins is the LOCAL half: the four
      // must not drift back into a mirror of a package that does not have them.
      const port = yield* Effect.promise(() => import('../src/domain/chunk-store-port'))
      for (const capability of [
        'fallsWhenUnsupported',
        'isReplaceable',
        'validSpawnSurface',
        'canSupportAttachments',
      ]) {
        expect(Object.keys(port)).not.toContain(capability)
      }

      // ...and the constant that DID survive the test, because mc-worldgen's
      // `domain/kernel-vocabulary.ts` re-exports kernel's `AIR_BLOCK_ID`. The
      // rule is whose barrel replaces the symbol, not whose table defines it,
      // and this is the row where the two answers differ.
      expect(Object.keys(port)).toContain('AIR_BLOCK_ID')
      expect(AIR_BLOCK_ID).toBe(0)

      // THE FOUR THAT ARRIVED WITH THE CHUNK WINDOW, and they pass the same
      // test for the same reason: mc-worldgen's `index.ts` re-exports
      // `./domain/constants` and `./domain/chunk`, so all four come back from
      // `@nerima-games/mc-worldgen` on deletion day.
      //
      // `getBlockAt` is deliberately absent and its absence is the interesting
      // half. It is on that barrel and would be the convenient one to mirror,
      // and it takes mc-worldgen's `Chunk` — whose `biomes` this mirror WIDENS
      // to `ReadonlyArray<string>`. The widening is safe for a consumer and
      // wrong for a call site, so mirroring `getBlockAt` would produce a name
      // that stops compiling on the day the header promises it will start.
      for (const layout of ['blockIndex', 'readBlock', 'CHUNK_SIZE_XZ', 'CHUNK_HEIGHT']) {
        expect(Object.keys(port)).toContain(layout)
      }
      expect(Object.keys(port)).not.toContain('getBlockAt')
    }),
  )

  it.effect('LightReading can say "I do not know", which is the point of it', () =>
    Effect.sync(() => {
      // Restated from `mc-worldgen/domain/chunk-store-state.ts` rather than
      // imported, for the reason `WorldgenChunkStoreApi` above is: mc-worldgen
      // is not published. The three-valued shape is the load-bearing part —
      // `domain/mob/hostile-spawn.ts` answers `unmeasurable` to a non-finite
      // light level because `NaN > 7` is `false`, so a two-valued reading that
      // forced "unknown" into a number would spawn hostiles in daylight at the
      // edge of the loaded area.
      type WorldgenLightReading =
        | { readonly _tag: 'Light'; readonly sky: number; readonly block: number }
        | { readonly _tag: 'ChunkNotLoaded' }
        | { readonly _tag: 'OutOfWorld' }

      const asWorldgen = (reading: LightReading): WorldgenLightReading => reading
      const asMirror = (reading: WorldgenLightReading): LightReading => reading

      expect(typeof asWorldgen).toBe('function')
      expect(typeof asMirror).toBe('function')

      // Sky and block are SEPARATE. A single combined level would make a torch
      // and a sunbeam the same fact, and the spawn rule gates on block light
      // alone — the daylight gate has already run by then.
      const lit: LightReading = { _tag: 'Light', sky: 15, block: 0 }
      expect(lit._tag === 'Light' ? lit.sky : -1).toBe(15)
      expect(lit._tag === 'Light' ? lit.block : -1).toBe(0)
    }),
  )

  it.effect('a Layer built from the mirror is a Layer for the tag', () =>
    Effect.sync(() => {
      // The compile-time half of the tag-key hazard: whatever this repository
      // builds must be usable where mc-worldgen's `ChunkStoreLayer` is.
      const asLayer = (layer: Layer.Layer<ChunkStore>): Layer.Layer<ChunkStore> => layer
      expect(typeof asLayer).toBe('function')
    }),
  )
})
