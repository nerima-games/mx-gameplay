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
 * `capabilityOfBlockId(id, 'fallsWhenUnsupported')`,
 * `capabilityOfBlockId(id, 'replaceable')`,
 * `capabilityOfBlockId(id, 'validSpawnSurface')` and
 * `capabilityOfBlockId(id, 'canSupportAttachments')`.
 *
 * THE TWO STRUCT-VALUED COLUMNS ARE NOT HERE. `harvestTool` and `drops` are
 * mirrored in `./block-vocabulary`, because kernel keeps them in their own file
 * (`domain/block-harvest.ts`, audit §7: struct fields are the ones most likely
 * to grow a member, so they are split out to make the diff obvious) and because
 * this file is a mirror of mc-worldgen's SERVICE, which has a different
 * publication date and a different deletion step from kernel's table.
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

/**
 * The blocks a mob may NOT stand on. A NEGATIVE list, and that is kernel's shape
 * rather than a preference of this file.
 *
 * `validSpawnSurface` is one of kernel's three flags that default to `true`
 * (`BLOCK_CAPABILITY_DEFAULTS`, `TRUE_BY_DEFAULT_CAPABILITY_FLAGS`), because for
 * an ordinary opaque cube the true answer IS true and the reference
 * implementation correspondingly stored `NON_SPAWN_SURFACE_BLOCK_IDS`
 * (`spawn-selection-search.ts:41-60`) rather than the complement. Transcribing
 * the negative set keeps two properties for free that the positive set would
 * have to remember:
 *
 *   - an id this build cannot name resolves to `true`, exactly as kernel's
 *     `capabilityOfBlockId` does (an unknown byte reads as an ordinary cube);
 *   - adding an ordinary block to kernel's registry needs no edit here.
 *
 * DO NOT collapse this into a general `solid` test. kernel's audit §4.9 is
 * explicit that `passable`, `suffocates`, `canSupportAttachments`,
 * `validSpawnSurface` and `collisionShape` are five INDEPENDENT capabilities
 * with different membership, and it names the disagreements: glass is solid for
 * collision but is not a spawn surface, leaves are solid for collision but are
 * not a spawn surface, snow is non-supporting but not passable. The reference
 * kept two near-duplicate negative lists (`spawn-selection-search.ts:41-60` and
 * `village-placement-surface.ts:6-12`) that DISAGREED with each other; a spawn
 * rule that re-derives the answer from "is it solid" is how a third one starts.
 */
const NON_SPAWN_SURFACE_IDS: ReadonlySet<BlockId> = new Set<BlockId>([
  0, // air — nothing to stand on
  6, // water
  // oak_log was MISSING here, and so was kernel's own row: both resolved to the
  // default `true` while the reference implementation lists WOOD in
  // `NON_SPAWN_SURFACE_BLOCK_IDS` ("log — semi-solid / tree") and again in
  // `VILLAGE_NON_GROUND_IDS`. Mobs and villages were treating the top of a tree
  // trunk as ground. Unlike the lava case below, `pnpm check:mirrors` could NOT
  // have caught this: `MIRROR_SPECS` probed `fallsWhenUnsupported` and
  // `replaceable` and nothing else, so this file and kernel agreed — on the
  // wrong answer. A `validSpawnSurface` probe has been added alongside the fix.
  9, // oak_log
  10, // oak_leaves — solid for collision, and still not ground
  11, // lava
  13, // glass — solid for collision, and still not ground
  14, // torch
  // Kernel's roster completed the reference's `PASSABLE_BLOCK_IDS` and the
  // non-`full` collision shapes. These are the additions the reference's
  // `NON_SPAWN_SURFACE_BLOCK_IDS` names.
  18, // ladder
  19, // cobweb
  20, // sapling
  21, // dandelion
  22, // poppy
  23, // brown_mushroom
  24, // red_mushroom
  25, // tall_grass
  26, // fern
  27, // sugar_cane
  28, // lily_pad
  33, // cactus — collides, and is still not ground
  34, // pressure_plate
  // DELIBERATELY ABSENT, and this is transcription rather than oversight:
  // `rail` (31), `powered_rail` (32), `kelp` (29), `seagrass` (30) and
  // `stone_slab` (35) are passable-or-partial blocks that the reference's
  // negative list does NOT contain, so kernel resolves them to `true` and so
  // must this set. Adding them "for consistency" would be the same class of
  // error as omitting oak_log, in the opposite direction — and the probe now
  // fails either way.
])

/**
 * The blocks nothing may be ATTACHED TO. A NEGATIVE list, and kernel's shape for
 * the same reason `NON_SPAWN_SURFACE_IDS` is one: `canSupportAttachments` is the
 * second of kernel's three flags that default to `true`
 * (`BLOCK_CAPABILITY_DEFAULTS`), because for an ordinary opaque cube the true
 * answer IS true and the reference correspondingly stores
 * `NON_SUPPORTING_BLOCK_TYPES` (`block-support.ts:47-61`) rather than the
 * complement.
 *
 * THIS IS NOT `NON_SPAWN_SURFACE_IDS` AND MUST NOT BE COLLAPSED INTO IT, even
 * though the two lists overlap heavily. kernel's audit §4.9 names the
 * disagreement in this very pair: SNOW is NON-SUPPORTING but IS a valid spawn
 * surface — a mob may stand on snow and a torch may not be planted in it — and
 * `oak_log` / `oak_leaves` / `glass` are the mirror image, valid supports that
 * are not ground. Five independent capabilities with different membership is
 * exactly what the audit measured, and it measured it by finding five
 * near-duplicate lists in the reference that DISAGREED.
 *
 * Read about the block BELOW a placement, by `./interactions/place-block`.
 */
const NON_SUPPORTING_IDS: ReadonlySet<BlockId> = new Set<BlockId>([
  0, // air — nothing to attach to
  6, // water
  7, // snow — non-supporting, and STILL a valid spawn surface (audit §4.9)
  11, // lava
  14, // torch
  // `SURFACE_PLANT_CAPABILITIES` in kernel's table, which is one constant
  // because `block-support.ts:4-12` is one set (`SURFACE_PLANT_BLOCK_TYPES`)
  // fed into three different negative lists.
  20, // sapling
  21, // dandelion
  22, // poppy
  23, // brown_mushroom
  24, // red_mushroom
  25, // tall_grass
  26, // fern
  27, // sugar_cane
  28, // lily_pad
  31, // rail
  32, // powered_rail
  33, // cactus
  34, // pressure_plate
  // DELIBERATELY ABSENT, and this is transcription rather than oversight:
  // `ladder` (18), `cobweb` (19), `kelp` (29) and `seagrass` (30) are passable
  // blocks that the reference's `NON_SUPPORTING_BLOCK_TYPES` does NOT contain,
  // so kernel resolves them to `true` and so must this set. Adding them "for
  // consistency" with `PASSABLE_BLOCK_IDS` would be the same class of error as
  // omitting oak_log from the spawn list, in the opposite direction.
])

export const fallsWhenUnsupported = (block: BlockId): boolean => FALLS_WHEN_UNSUPPORTED_IDS.has(block)

export const isReplaceable = (block: BlockId): boolean => REPLACEABLE_IDS.has(block)

/** Total, like kernel's: an id outside the transcription reads as ordinary ground. */
export const validSpawnSurface = (block: BlockId): boolean => !NON_SPAWN_SURFACE_IDS.has(block)

/** Total, like kernel's: an id outside the transcription reads as an ordinary support. */
export const canSupportAttachments = (block: BlockId): boolean => !NON_SUPPORTING_IDS.has(block)
