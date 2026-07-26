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
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, type Layer, type Scope } from 'effect'
import {
  ChunkStore,
  fallsWhenUnsupported,
  isReplaceable,
  type BlockId,
  type BlockPosition,
  type BlockReading,
  type BlockWriteOutcome,
  type ChunkCoord,
  type ChunkDirtySubscription,
  type ChunkNeighbours,
  type ChunkStoreApi,
  type WorldgenChunk,
} from '../domain/chunk-store-port'

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
      const barrel = yield* Effect.promise(() => import('../index'))
      expect(Object.keys(barrel)).not.toContain('ChunkStore')
      expect(Object.keys(barrel)).not.toContain('fallsWhenUnsupported')
    }),
  )

  it.effect('reads capabilities, and knows about exactly the ids kernel says carry them', () =>
    Effect.sync(() => {
      // Transcribed from mc-kernel's `BLOCK_REGISTRY`: sand is 5, gravel is 8,
      // and they are the only two rows with `fallsWhenUnsupported`.
      expect(fallsWhenUnsupported(5)).toBe(true)
      expect(fallsWhenUnsupported(8)).toBe(true)
      expect(fallsWhenUnsupported(2)).toBe(false)
      expect(fallsWhenUnsupported(0)).toBe(false)

      // air, water AND lava. Not stone, and not glass — `replaceable` is not
      // "non-solid", which kernel's audit §4.9 spends a section on.
      //
      // Lava is here because it was MISSING, and this assertion could not see
      // that: it pins what this file transcribes, not what mc-kernel's registry
      // says. mc-dev-meta's `pnpm check:mirrors` found the disagreement by
      // importing both and diffing all 256 ids — that check is the one that
      // guards this set, and this one only guards against a careless local edit.
      expect(isReplaceable(0)).toBe(true)
      expect(isReplaceable(6)).toBe(true)
      expect(isReplaceable(11)).toBe(true)
      expect(isReplaceable(2)).toBe(false)
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
