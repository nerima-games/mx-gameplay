/**
 * The world the mining site digs in: a real `ChunkStoreApi`, not a stub.
 *
 * A dev application, not shipped API.
 *
 * ---------------------------------------------------------------------------
 * Why the preview builds its own store instead of importing the test double
 * ---------------------------------------------------------------------------
 *
 * `test/support/chunk-store-double.ts` exists and is typed by the same mirror.
 * It is deliberately NOT imported here, for the reason its own header gives for
 * not sharing `positionKeyOf`: a double that a preview and a test both depend on
 * becomes a second implementation nobody audits, and the two consumers want
 * different things. The double dies (`Effect.dieMessage`) on every method
 * outside its slice, which is right for a test — a rule that starts scanning
 * chunks must break the suite — and wrong for a preview, which wants to SHOW you
 * the loaded set.
 *
 * What is shared is the thing that must be: `domain/chunk-store-port.ts`, the
 * mirror of mc-worldgen's service. This store implements that interface, so
 * every semantic a rule can get wrong is reproduced here rather than smoothed
 * over (`mc-worldgen/docs/public-api.md` §6-3, §6-4):
 *
 *   - a position in an unloaded chunk reads `ChunkNotLoaded`, NEVER air;
 *   - a position outside [0, WORLD_HEIGHT) reads `OutOfWorld`;
 *   - writing the block that is already there is `Unchanged` and does NOT dirty;
 *   - each dirty subscriber accumulates a SET, so N writes to one chunk drain
 *     as one coordinate.
 *
 * It also COUNTS reads and writes, and that is not decoration. "An idle frame
 * does not touch the store" (DN-GP-1) is a claim about the number of store
 * calls, and the whole reason the falling-block queue exists is that the
 * reference implementation's answer to that question was ~7M reads per
 * maintenance tick. A preview that showed the world but not the call counter
 * could not tell a working event-driven cascade from a full scan that happened
 * to produce the same picture.
 *
 * ---------------------------------------------------------------------------
 * Two dimensions, and why that is honest here
 * ---------------------------------------------------------------------------
 *
 * The site is a vertical cross-section at a fixed `z`. Falling blocks move along
 * exactly one axis (`domain/block-position-key.ts`'s `above` / `below`), so the
 * third dimension adds nothing a viewer can use and costs the ability to see a
 * whole column at once. The store underneath is fully three-dimensional and the
 * chunk arithmetic is real — `cx = floor(x / 16)`, which is what makes the
 * chunk-edge scenario show a genuine `ChunkNotLoaded`, not a drawn one.
 */
import { Effect, Ref } from 'effect'
import {
  AIR_BLOCK_ID,
  type BlockId,
  type BlockPosition,
  type BlockReading,
  type LightReading,
  type BlockWriteOutcome,
  type ChunkCoord,
  type ChunkDirtyBatch,
  type ChunkDirtySubscription,
  type ChunkStoreApi,
  type ChunkNeighbours,
} from '../../domain/chunk-store-port'
import {
  blockTypeOfId,
  fallsWhenUnsupported,
  isPlaceableItem,
  isReplaceable,
  itemOfBlock,
  type PlaceableItemType,
} from '../../domain/block-vocabulary'

/**
 * Block ids, transcribed from kernel's `BLOCK_REGISTRY` exactly as
 * `domain/block-vocabulary.ts` transcribes the four capability sets.
 *
 * The preview NAMES blocks and the rules do not; that asymmetry is the point of
 * DN-GP-1's capability table. `LAVA` is here specifically because the mirror's
 * comment records that its absence from `REPLEACABLE_IDS` was a real bug found
 * by `mc-dev-meta`'s `pnpm check:mirrors` — falling sand did not displace lava —
 * and the `lava-pit` scenario is what that bug would have looked like.
 */
export const AIR: BlockId = AIR_BLOCK_ID
export const STONE: BlockId = 2
export const SAND: BlockId = 5
export const WATER: BlockId = 6
export const GRAVEL: BlockId = 8
export const LAVA: BlockId = 11

/**
 * The four that arrived with item use and the per-block placement rules.
 *
 * `OBSIDIAN` is what a player builds a portal ring out of; `NETHER_PORTAL` and
 * `FIRE` are what `domain/interactions/ignite-portal.ts` and `./ignite-fire.ts`
 * WRITE, so they are here to be drawn rather than to be selected — pressing `p`
 * with either of them chosen prints kernel's answer, which is that neither has
 * an item form. That refusal is worth a key: it is the same roster fact that
 * keeps three of the four per-block placement rules off the hotbar.
 *
 * `DOOR` is the one per-block rule a player can actually reach, and it is the
 * only palette entry whose placement fills TWO cells.
 */
export const OBSIDIAN: BlockId = 40
export const DOOR: BlockId = 106
export const NETHER_PORTAL: BlockId = 118
export const FIRE: BlockId = 119

export const CHUNK_SIDE = 16
export const WORLD_HEIGHT = 256

export type Glyph = {
  readonly id: BlockId
  readonly name: string
  readonly glyph: string
  readonly color: readonly [number, number, number]
}

/** The palette the number keys select, and the legend the HUD prints. */
export const BLOCKS: ReadonlyArray<Glyph> = [
  { id: AIR, name: 'air', glyph: '.', color: [58, 58, 68] },
  { id: STONE, name: 'stone', glyph: '#', color: [150, 150, 155] },
  { id: SAND, name: 'sand', glyph: 'S', color: [226, 202, 130] },
  { id: GRAVEL, name: 'gravel', glyph: 'G', color: [162, 152, 148] },
  { id: WATER, name: 'water', glyph: '~', color: [80, 130, 230] },
  { id: LAVA, name: 'lava', glyph: '!', color: [232, 118, 44] },
  { id: OBSIDIAN, name: 'obsidian', glyph: 'O', color: [72, 52, 108] },
  { id: DOOR, name: 'door', glyph: 'D', color: [150, 110, 70] },
  { id: NETHER_PORTAL, name: 'nether_portal', glyph: '%', color: [150, 70, 220] },
  { id: FIRE, name: 'fire', glyph: '*', color: [240, 160, 40] },
]

export const glyphOf = (id: BlockId): Glyph =>
  BLOCKS.find((entry) => entry.id === id) ?? { id, name: `id ${String(id)}`, glyph: '?', color: [255, 0, 255] }

/**
 * The item a player would be holding in order to place this block, if there is
 * one.
 *
 * `undefined` for THREE of the six palette entries — air, water and lava — and
 * that is kernel's answer rather than this file's: `itemOfBlock` is partial and
 * `UNITEMISED_BLOCK_TYPES` is the list of blocks with no item form
 * (`domain/block-vocabulary.ts`). Pressing `p` with lava selected therefore says
 * so, which is a more useful thing for the screen to demonstrate than a key that
 * silently does nothing.
 *
 * The two hops — id -> `BlockType` -> `ItemType` — are exactly the bridge
 * `stages/registration.ts` used to be missing in the other direction, and they
 * are the reason this preview can name a held item at all.
 */
export const placeableItemOf = (id: BlockId): PlaceableItemType | undefined => {
  const type = blockTypeOfId(id)
  const item = type === undefined ? undefined : itemOfBlock(type)
  return item !== undefined && isPlaceableItem(item) ? item : undefined
}

export const chunkKeyOf = (position: BlockPosition): string =>
  `${String(Math.floor(position.x / CHUNK_SIDE))},${String(Math.floor(position.z / CHUNK_SIDE))}`

const chunkCoordOf = (position: BlockPosition): ChunkCoord => ({
  cx: Math.floor(position.x / CHUNK_SIDE),
  cz: Math.floor(position.z / CHUNK_SIDE),
})

const blockKey = (position: BlockPosition): string =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

export type StoreCalls = {
  readonly reads: number
  readonly writes: number
}

/**
 * One `setBlock` as it happened.
 *
 * Recorded because a falling-block MOVE is not observable from outside: it is
 * two writes, and the count of moves is what the per-tick budget is a bound on
 * (`domain/falling-block.ts:53-60`). Deriving it from the write counter would
 * mean assuming "two writes per move", which is precisely one of the things the
 * preview is meant to check rather than assume — `applyFallingBlocks` has a
 * three-write path for a refused destination.
 */
export type WriteRecord = {
  readonly position: BlockPosition
  readonly block: BlockId
  readonly outcome: BlockWriteOutcome['_tag']
}

type Inner = {
  readonly blocks: Map<string, BlockId>
  readonly loadedChunks: Set<string>
  readonly subscribers: Map<number, Set<string>>
  writeLog: Array<WriteRecord>
  nextSubscriber: number
  reads: number
  writes: number
}

export type PreviewWorld = {
  readonly api: ChunkStoreApi
  /** Reads a cell WITHOUT going through the counters, so drawing is free. */
  readonly peekBlock: (position: BlockPosition) => BlockId | undefined
  /** `true` when the chunk containing this position is resident. */
  readonly isResident: (position: BlockPosition) => boolean
  readonly loadedChunkKeys: () => ReadonlyArray<string>
  readonly calls: () => StoreCalls
  readonly resetCalls: () => void
  /** Every `setBlock` since the last call, and clears the log. */
  readonly takeWriteLog: () => ReadonlyArray<WriteRecord>
  /**
   * The multiset of every non-air block in the world, as a histogram.
   *
   * This is the mass-conservation oracle. A falling-block move is a
   * `setBlock(source, AIR)` followed by a `setBlock(target, material)`, and both
   * of the ways that pair can go wrong — placing before vacating, or failing to
   * restore after a refused destination write — change this histogram.
   */
  readonly census: () => ReadonlyMap<BlockId, number>
  /** Writes a cell directly, bypassing the rules. See the note in `site.ts`. */
  readonly poke: (position: BlockPosition, block: BlockId) => void
}

export type WorldSpec = {
  /** `[x, y, blockId]` at the scenario's fixed z. */
  readonly cells: ReadonlyArray<readonly [number, number, BlockId]>
  /** Chunk keys (`"cx,cz"`) that are resident. Everything else reads ChunkNotLoaded. */
  readonly loadedChunks: ReadonlyArray<string>
  readonly z: number
}

export const makePreviewWorld = (spec: WorldSpec): Effect.Effect<PreviewWorld> =>
  Effect.map(
    Ref.make<Inner>({
      blocks: new Map(spec.cells.map(([x, y, id]) => [blockKey({ x, y, z: spec.z }), id] as const)),
      loadedChunks: new Set(spec.loadedChunks),
      subscribers: new Map(),
      writeLog: [],
      nextSubscriber: 0,
      reads: 0,
      writes: 0,
    }),
    (state) => {
      // `Ref.unsafeGet` does not exist in Effect's public API, and threading an
      // Effect through the RENDERER would make every draw call an Effect for no
      // benefit. `Effect.runSync` on a `Ref.get` is total and allocation-free.
      const inner = (): Inner => Effect.runSync(Ref.get(state))

      const notImplemented = (name: string): Effect.Effect<never> =>
        Effect.dieMessage(`preview-mining-site: ChunkStore.${name} is not exercised by this preview`)

      const markDirty = (doubles: Inner, position: BlockPosition): void => {
        for (const pending of doubles.subscribers.values()) {
          pending.add(chunkKeyOf(position))
        }
      }

      const subscribe: Effect.Effect<ChunkDirtySubscription> = Ref.modify(state, (doubles) => {
        const id = doubles.nextSubscriber
        doubles.subscribers.set(id, new Set())

        const subscription: ChunkDirtySubscription = {
          id,
          drain: Ref.modify(state, (current) => {
            const pending = current.subscribers.get(id) ?? new Set<string>()
            const batch: ChunkDirtyBatch = {
              changed: [...pending].map((entry) => {
                const [cx, cz] = entry.split(',')
                return { cx: Number(cx), cz: Number(cz) }
              }),
              removed: [],
            }
            current.subscribers.set(id, new Set())
            return [batch, current] as const
          }),
          unsubscribe: Ref.update(state, (current) => {
            current.subscribers.delete(id)
            return current
          }),
        }

        return [subscription, { ...doubles, nextSubscriber: id + 1 }] as const
      })

      const api: ChunkStoreApi = {
        load: () => notImplemented('load'),
        peek: () => notImplemented('peek'),
        snapshot: () => notImplemented('snapshot'),
        isLoaded: (coord) =>
          Effect.sync(() => inner().loadedChunks.has(`${String(coord.cx)},${String(coord.cz)}`)),
        loadedCoords: Effect.sync(() =>
          [...inner().loadedChunks].map((entry): ChunkCoord => {
            const [cx, cz] = entry.split(',')
            return { cx: Number(cx), cz: Number(cz) }
          }),
        ),
        neighbours: (): Effect.Effect<ChunkNeighbours> => notImplemented('neighbours'),
        unload: () => notImplemented('unload'),

        getBlock: (position) =>
          Ref.modify(state, (doubles): readonly [BlockReading, Inner] => {
            doubles.reads += 1
            if (position.y < 0 || position.y >= WORLD_HEIGHT) {
              return [{ _tag: 'OutOfWorld' } as const, doubles] as const
            }
            if (!doubles.loadedChunks.has(chunkKeyOf(position))) {
              return [{ _tag: 'ChunkNotLoaded' } as const, doubles] as const
            }
            return [
              { _tag: 'Block', block: doubles.blocks.get(blockKey(position)) ?? AIR_BLOCK_ID } as const,
              doubles,
            ] as const
          }),

        /**
         * SKY EXPOSURE ONLY, and it is a stand-in rather than a light engine.
         *
         * mc-worldgen computes light with two BFS passes over a nibble-packed
         * grid (`domain/light.ts` there). Reproducing that here would be a
         * second implementation of one algorithm, and the preview's rule — see
         * `main.ts` — is that a slider may drive a REAL rule but a fake may not
         * imitate another repository's arithmetic. So this answers the one
         * question the preview's world can answer honestly: is anything above
         * this cell in its column?
         *
         * Consequences, stated because the arena screen prints the result:
         *
         *   - sky light is 15 or 0 with nothing in between, so there is no
         *     sideways falloff under an overhang;
         *   - BLOCK light is always 0, because this preview places no emitters —
         *     its palette is stone, sand, gravel and water. A torch would need
         *     the real engine, and the arena would be measuring this function
         *     instead of the spawn rule.
         *
         * The spawn rule gates on BLOCK light, so what the arena exercises with
         * this store is the DARK branch — which is the branch that spawns, and
         * therefore the one worth being able to reach from a preview.
         */
        getLight: (position) =>
          Ref.modify(state, (doubles): readonly [LightReading, Inner] => {
            doubles.reads += 1
            if (position.y < 0 || position.y >= WORLD_HEIGHT) {
              return [{ _tag: 'OutOfWorld' } as const, doubles] as const
            }
            if (!doubles.loadedChunks.has(chunkKeyOf(position))) {
              return [{ _tag: 'ChunkNotLoaded' } as const, doubles] as const
            }

            let exposed = true
            for (let y = position.y + 1; y < WORLD_HEIGHT; y += 1) {
              const above = doubles.blocks.get(blockKey({ x: position.x, y, z: position.z }))
              if (above !== undefined && above !== AIR_BLOCK_ID) {
                exposed = false
                break
              }
            }

            return [{ _tag: 'Light', sky: exposed ? 15 : 0, block: 0 } as const, doubles] as const
          }),

        setBlock: (position, block) =>
          Ref.modify(state, (doubles): readonly [BlockWriteOutcome, Inner] => {
            doubles.writes += 1

            const record = (outcome: BlockWriteOutcome): readonly [BlockWriteOutcome, Inner] => {
              doubles.writeLog.push({ position, block, outcome: outcome._tag })
              return [outcome, doubles] as const
            }

            if (position.y < 0 || position.y >= WORLD_HEIGHT) {
              return record({ _tag: 'OutOfWorld' })
            }
            if (!doubles.loadedChunks.has(chunkKeyOf(position))) {
              return record({ _tag: 'ChunkNotLoaded' })
            }

            const previous = doubles.blocks.get(blockKey(position)) ?? AIR_BLOCK_ID
            if (previous === block) {
              return record({ _tag: 'Unchanged', previous })
            }

            doubles.blocks.set(blockKey(position), block)
            markDirty(doubles, position)

            return record({ _tag: 'Written', previous, chunk: chunkCoordOf(position) })
          }),

        subscribeDirty: subscribe,
        subscribeDirtyScoped: Effect.acquireRelease(subscribe, (s) => s.unsubscribe),
        reset: Ref.update(state, (doubles) => {
          doubles.blocks.clear()
          return doubles
        }),
      }

      return {
        api,
        peekBlock: (position) => inner().blocks.get(blockKey(position)),
        isResident: (position) => inner().loadedChunks.has(chunkKeyOf(position)),
        loadedChunkKeys: () => [...inner().loadedChunks].sort(),
        calls: () => {
          const doubles = inner()
          return { reads: doubles.reads, writes: doubles.writes }
        },
        resetCalls: () => {
          const doubles = inner()
          doubles.reads = 0
          doubles.writes = 0
        },
        takeWriteLog: () => {
          const doubles = inner()
          const log = doubles.writeLog
          doubles.writeLog = []
          return log
        },
        census: () => {
          const histogram = new Map<BlockId, number>()
          for (const id of inner().blocks.values()) {
            if (id !== AIR_BLOCK_ID) {
              histogram.set(id, (histogram.get(id) ?? 0) + 1)
            }
          }
          return histogram
        },
        poke: (position, block) => {
          const doubles = inner()
          if (block === AIR_BLOCK_ID) {
            doubles.blocks.delete(blockKey(position))
          } else {
            doubles.blocks.set(blockKey(position), block)
          }
        },
      }
    },
  )

/**
 * Is this cell supported, in the sense the falling-block rule uses?
 *
 * A falling block is unsupported exactly when the reading below it is a `Block`
 * this build calls `replaceable`. `ChunkNotLoaded` and `OutOfWorld` both hold it
 * up — the whole of DN-GP-11 — so this predicate must agree with
 * `domain/entities/falling-block-move.ts`'s `canReceive` or the invariant check
 * built on it would report a bug that is not there.
 */
export const restsOnSupport = (world: PreviewWorld, position: BlockPosition): boolean => {
  const belowPosition = { x: position.x, y: position.y - 1, z: position.z }
  if (belowPosition.y < 0 || belowPosition.y >= WORLD_HEIGHT) {
    return true
  }
  if (!world.isResident(belowPosition)) {
    return true
  }
  return !isReplaceable(world.peekBlock(belowPosition) ?? AIR_BLOCK_ID)
}

/**
 * Every falling block that is currently hanging in the air.
 *
 * The oracle behind the `unsupported` finding in `--stats`: a settled world in
 * which this is non-empty means the cascade stopped early, which is exactly the
 * failure the reference implementation's `pendingCoordKeysRef` existed to
 * prevent (`domain/falling-block.ts:30-38`).
 */
export const floatingBlocks = (
  world: PreviewWorld,
  cells: ReadonlyArray<BlockPosition>,
): ReadonlyArray<BlockPosition> =>
  cells.filter(
    (position) =>
      fallsWhenUnsupported(world.peekBlock(position) ?? AIR_BLOCK_ID) && !restsOnSupport(world, position),
  )
