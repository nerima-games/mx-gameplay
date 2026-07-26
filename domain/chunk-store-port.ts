/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-worldgen`'s `ChunkStore`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * mc-worldgen is a legitimate `dependencies` edge for this repository
 * (plan.md §2.1: `gameplay --> worldgen`), so unlike `./frame-contract` this
 * mirror is not standing in for a forbidden import — only for an unpublished
 * one. plan.md §6 Step 3 publishes bottom-up and nothing is published yet, so
 * `pnpm check:deps` would reject an import of a package absent from
 * `package.json#dependencies`.
 *
 * WHEN mc-worldgen IS PUBLISHED:
 *   1. add `@nerima-games/mc-worldgen` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './chunk-store-port'` at `'@nerima-games/mc-worldgen'`.
 *
 * It is NOT re-exported from `index.ts`, for the same reason `./frame-contract`
 * and `./position-key` are not: re-exporting it would make another repository's
 * service part of THIS package's published surface, and deleting the stand-in
 * would then be a breaking change for consumers of mx-gameplay.
 *
 * ---------------------------------------------------------------------------
 * Why the WHOLE api is mirrored even though four members are all that is used
 * ---------------------------------------------------------------------------
 *
 * `ChunkStore` is a `Context.Tag`, and Effect resolves Tags by their TEXTUAL
 * KEY — here, `'@nerima-games/mc-worldgen/ChunkStore'`. Two classes built from
 * the same key are one service at runtime and two unrelated nominal types to
 * TypeScript. A NARROWER mirror is therefore not "less of the vocabulary", it
 * is a silent runtime hazard: a `Layer` built against a four-method mirror
 * satisfies the ten-method tag, and the six missing methods read `undefined` in
 * a repository that never saw this file. mc-sim's `domain/kernel-vocabulary.ts`
 * records the same rule after the same near-miss with `ClockPort`, and
 * `test/chunk-store-mirror.test.ts` pins the key and the shape here.
 *
 * ONE deliberate widening. mc-worldgen's `Chunk.biomes` is
 * `ReadonlyArray<BiomeType>`; here it is `ReadonlyArray<string>`, because
 * mx-gameplay has no biome vocabulary and must not invent a second one
 * (plan.md §2.3-1: classification is mc-worldgen's noun). The widening is in
 * the safe direction — mc-worldgen's `Chunk` is assignable to this one, which
 * is the direction a consumer needs — and this repository never reads the
 * field. It is recorded here rather than left to be discovered.
 *
 * ---------------------------------------------------------------------------
 * Why this port is in mc-worldgen and not in mc-sim
 * ---------------------------------------------------------------------------
 *
 * `mx-gameplay/stages/registration.ts` used to say the falling-block move would
 * be "applied through mc-sim's block service". There is no such service and
 * there is not going to be one: plan.md left the owner of the block write path
 * unassigned between §3.7 (`ChunkManager` — load / unload / dirty flags, in
 * mc-worldgen) and §3.8 (mc-sim as the centre of game state, whose
 * responsibility sentence never names blocks), and it has been settled in
 * mc-worldgen. The full argument is in that repository's
 * `application/chunk-store.ts` header. For a rule author the practical
 * consequences are only these two:
 *
 *   - block reads and writes come from `ChunkStore`, not from mc-sim;
 *   - the item a broken block yields still goes to mc-sim's `InventoryService`,
 *     which is unchanged and is what plan.md §2.3-1's worked example is about.
 */
import { Context, type Effect, type Scope } from 'effect'

// ---------------------------------------------------------------------------
// Vocabulary — mirrors mc-worldgen/domain/kernel-vocabulary.ts, which in turn
// mirrors mc-kernel. Two hops, one shape; both are deleted together.
// ---------------------------------------------------------------------------

/** Mirrors kernel's `ChunkAxis`. Unbranded here — see the note on `BlockId`. */
export type ChunkCoord = {
  readonly cx: number
  readonly cz: number
}

/** Mirrors kernel's `BlockPosition`. */
export type BlockPosition = {
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * Mirrors kernel's `BlockId`.
 *
 * Deliberately UNBRANDED, unlike kernel's. `PositionKey` in this repository
 * carries the same note and the same reason: a brand declared here would let
 * mx-gameplay masquerade as the owner of the concept, and a downstream reader
 * would end up converting between two brands of one number. A branded value
 * from kernel is assignable to this alias, which is the direction that matters
 * for a consumer, and the deletion in step 3 above narrows rather than widens.
 */
export type BlockId = number

/** Mirrors mc-worldgen's `Chunk`. See the widening note in the header. */
export type WorldgenChunk = {
  readonly coord: ChunkCoord
  readonly blocks: Uint8Array
  readonly biomes: ReadonlyArray<string>
}

/** Mirrors mc-worldgen's `ChunkNeighbours`. Absent means absent, not `undefined`. */
export type ChunkNeighbours = {
  readonly xPos?: WorldgenChunk
  readonly xNeg?: WorldgenChunk
  readonly zPos?: WorldgenChunk
  readonly zNeg?: WorldgenChunk
}

// ---------------------------------------------------------------------------
// Reads and writes
// ---------------------------------------------------------------------------

/**
 * The answer to "what block is at this world position".
 *
 * Three-valued, and a rule author must respect all three. `ChunkNotLoaded` is
 * NOT air: sand at the edge of the loaded area, told the cell below it is air,
 * falls out of the world. mc-meshing's equivalent read deliberately DOES
 * collapse the two — an unloaded neighbour should mesh as open sky rather than
 * as a black wall — which is correct for drawing and wrong for simulating.
 */
export type BlockReading =
  | { readonly _tag: 'Block'; readonly block: BlockId }
  | { readonly _tag: 'ChunkNotLoaded' }
  | { readonly _tag: 'OutOfWorld' }

/**
 * The outcome of a block write. TOTAL — there is no error channel, because
 * `StageRegistration.run` has none either (`./frame-contract`), so a rule would
 * have nowhere to put a failure and would end up swallowing one.
 *
 * `Unchanged` does not dirty the chunk. Re-placing the block that is already
 * there is a legal thing for a rule to do — a fluid re-asserting its level, a
 * redstone tick recomputing to the same state — and treating it as a change
 * would remesh the chunk every tick forever.
 */
export type BlockWriteOutcome =
  | { readonly _tag: 'Written'; readonly previous: BlockId; readonly chunk: ChunkCoord }
  | { readonly _tag: 'Unchanged'; readonly previous: BlockId }
  | { readonly _tag: 'ChunkNotLoaded' }
  | { readonly _tag: 'OutOfWorld' }

// ---------------------------------------------------------------------------
// The dirty channel
// ---------------------------------------------------------------------------

/** One drain's worth of news. */
export type ChunkDirtyBatch = {
  readonly changed: ReadonlyArray<ChunkCoord>
  readonly removed: ReadonlyArray<ChunkCoord>
}

/**
 * A held handle rather than a registered callback.
 *
 * This is the answer to the question `mc-kernel/docs/freeze-checklist.md`
 * recorded as open — "which chunks changed since I last looked", when the
 * writer is a rule in a different repository. Each subscriber accumulates a SET
 * of coordinates and drains it: the cost is O(changed since your last drain),
 * never O(loaded), and a chunk touched thirty-two times in one tick is one
 * entry rather than thirty-two messages.
 */
export type ChunkDirtySubscription = {
  readonly id: number
  readonly drain: Effect.Effect<ChunkDirtyBatch>
  readonly unsubscribe: Effect.Effect<void>
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export type ChunkStoreApi = {
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

/**
 * The tag key is `'@nerima-games/mc-worldgen/ChunkStore'` — mc-worldgen's, not
 * this repository's, because it denotes mc-worldgen's service. Changing this
 * string breaks resolution silently at runtime while typechecking cleanly, so
 * `test/chunk-store-mirror.test.ts` asserts it literally.
 */
export class ChunkStore extends Context.Tag('@nerima-games/mc-worldgen/ChunkStore')<
  ChunkStore,
  ChunkStoreApi
>() {}

// ---------------------------------------------------------------------------
// Capability lookups — mirrors mc-kernel/domain/block-registry.ts
// ---------------------------------------------------------------------------

/**
 * The block ids this repository's rules ask about, and the one capability the
 * falling-block rule needs.
 *
 * Restated from kernel's `BLOCK_REGISTRY` rather than derived here. Note what
 * the rule does NOT do: name a block. The reference implementation asked
 * `blockTypeToIndex('SAND')` in 229 places across 51 files (plan.md §3.1), and
 * that scatter is what made engine/content separation impossible. Adding a
 * falling block should be one row in kernel's table and no change here at all —
 * which is exactly what `test/vertical-slice.test.ts` checks by running the
 * same rule over gravel.
 *
 * When mc-kernel is published these collapse into
 * `capabilityOfBlockId(id, 'fallsWhenUnsupported')` and
 * `capabilityOfBlockId(id, 'replaceable')`.
 */
export const AIR_BLOCK_ID: BlockId = 0

const FALLS_WHEN_UNSUPPORTED_IDS: ReadonlySet<BlockId> = new Set<BlockId>([
  5, // sand
  8, // gravel
])

const REPLACEABLE_IDS: ReadonlySet<BlockId> = new Set<BlockId>([
  0, // air
  6, // water
  // Lava was MISSING here until mc-dev-meta's `pnpm check:mirrors` compared this
  // set against mc-kernel's `capabilityOfBlockId(id, 'replaceable')` and found
  // the disagreement. kernel's registry says ids 0-10 reproduce mc-worldgen's
  // BLOCK constant and 11+ are appended as blocks are needed — this transcription
  // was written when the table stopped at 10 and did not follow the append.
  //
  // The consequence was not cosmetic: falling sand and gravel did not displace
  // lava, and placement treated a lava cell as occupied. `chunk-store-mirror.test.ts`
  // passed throughout, because it pins the transcription rather than the source.
  // That is the whole reason the cross-repository check exists.
  11, // lava
])

export const fallsWhenUnsupported = (block: BlockId): boolean => FALLS_WHEN_UNSUPPORTED_IDS.has(block)

export const isReplaceable = (block: BlockId): boolean => REPLACEABLE_IDS.has(block)
