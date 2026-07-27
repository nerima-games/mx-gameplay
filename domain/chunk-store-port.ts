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
 * ---------------------------------------------------------------------------
 * That promise used to be FALSE, and this is how it was found
 * ---------------------------------------------------------------------------
 *
 * This file also exported `fallsWhenUnsupported`, `isReplaceable`,
 * `validSpawnSurface` and `canSupportAttachments`, under a heading that said in
 * as many words that they mirrored `mc-kernel/domain/block-registry.ts`. They
 * are MC-KERNEL's capability flags and mc-worldgen has never exported any of
 * them, so step 3 would not have repointed those four at anything — it would
 * have deleted them. One mirror file was mirroring two sources, and the file
 * that promised to be replaceable by one package needed two.
 *
 * They now live in `./block-vocabulary`, which is the mirror mc-kernel's barrel
 * replaces. Nothing else about them changed: same sets, same polarity, same
 * comments.
 *
 * mc-dev-meta's `pnpm check:mirrors` is the only thing in the organisation that
 * can see this, because it is the only place where both packages exist in one
 * build. It compares what this file exports against what mc-worldgen's barrel
 * exports, and it had been reporting agreement on three of the four for as long
 * as they existed — a `MIRROR_SPECS` capability probe names the third repository
 * that owns a flag, and naming one also EXEMPTS that symbol from the
 * "is it on the source's barrel?" check (`mirror-contract.ts`'s `compareValues`
 * skips every probed name). Three had probes and were therefore invisible. The
 * fourth, `canSupportAttachments`, had none, fell through to the plain check,
 * and reported that mc-worldgen does not export it. That one line is the whole
 * of the evidence, and it was only readable at all once the manifest pin
 * advanced far enough for the gate to be looking at current code.
 *
 * The lesson is about the probe list rather than about one symbol: a probe row
 * asserts "this predicate is a third repository's, compare it there", and that
 * assertion is a claim about OWNERSHIP which nothing was checking against the
 * mirror's own repoint promise. A file that needs a probe row is a file
 * mirroring something its own source does not have.
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

/**
 * How bright a cell is, from the sky and from the blocks around it.
 *
 * THREE-VALUED, exactly as `BlockReading` is, and the third value is the whole
 * reason this type is not a pair of numbers. `domain/mob/hostile-spawn.ts`
 * refuses a candidate whose light is not finite and its comment says why:
 * `NaN > 7` is `false`, so a light level that could not say "I do not know"
 * would be read as PITCH DARK and would spawn a hostile in a lit room — or, at
 * the edge of the loaded area, in broad daylight.
 *
 * `sky` and `block` are separate because the rule that reads them gates on
 * BLOCK light alone (`HOSTILE_SPAWN_MAX_BLOCK_LIGHT`). A combined number would
 * make a torch and a sunbeam the same fact, and the daylight gate has already
 * run by the time this is consulted.
 */
export type LightReading =
  | { readonly _tag: 'Light'; readonly sky: number; readonly block: number }
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
  /**
   * The query the spawn search was blocked on.
   *
   * NOT free: mc-worldgen computes light lazily and a block write drops the
   * chunk's cached grid, so the first read after a write relights that chunk.
   * A caller on a per-frame per-cell path would be paying O(chunk) repeatedly;
   * `stages/registration.ts` runs the search on a cadence for that reason.
   */
  readonly getLight: (position: BlockPosition) => Effect.Effect<LightReading>
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
// The one block constant that is mc-worldgen's to hand back
// ---------------------------------------------------------------------------

/**
 * Air, as a chunk buffer byte.
 *
 * It stays in this file although the value is kernel's, because the test that
 * decides where a mirrored symbol lives is WHOSE BARREL REPLACES IT — and
 * mc-worldgen's `domain/kernel-vocabulary.ts` re-exports kernel's
 * `AIR_BLOCK_ID`, so `@nerima-games/mc-worldgen` really does hand this one back
 * on the day this file is deleted. `pnpm check:mirrors` confirms that by
 * comparing the two values rather than by taking the comment's word for it.
 *
 * THE CAPABILITY PREDICATES THAT USED TO BE HERE FAILED THAT TEST AND HAVE
 * MOVED; see the header.
 */
export const AIR_BLOCK_ID: BlockId = 0
