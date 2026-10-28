import { describe, expect, it } from "vitest"
import fc from "fast-check"
import { Effect, Option, Result, Schema } from "effect"
import {
  AIR_BLOCK_ID,
  BlockPositionSchema,
  ChunkAxis,
  DimensionRevisionSchema,
  WorldIdSchema,
  WorldRevisionSchema,
  blockIdOf,
  chunkCoord
} from "@nerima-games/mc-kernel"
import type { BlockType } from "@nerima-games/mc-kernel"
import {
  ChunkCapacity,
  ChunkStoreRegistry,
  ChunkStoreRegistryLayer,
  CHUNK_SIZE_XZ,
  type BlockWriteOutcome,
  type ChunkSource,
  type ChunkStoreApi
} from "@nerima-games/mc-worldgen"
import { emptyBlocks } from "@nerima-games/mc-worldgen/testing"
import {
  emptyPlayerStorage,
  itemStack,
  withInventory,
  emptyInventory,
  PlayerStorageSnapshotSchema,
  playerStorageOwnerRegistration,
  ReplicatedOwnerIdSchema,
  WorldCommitCoordinator,
  WorldCommitCoordinatorLayer,
  type InventoryServiceApi,
  type StorageLocation
} from "@nerima-games/mc-sim"
import {
  BreakTransactionFailureSchema,
  BreakTransactionResultSchema,
  breakBlock,
  type BreakTransactionContext
} from "../src/domain/interactions/break-block.js"

const dimension = "overworld" as const
const chunk = chunkCoord(ChunkAxis(0), ChunkAxis(0))
const positionAt = (y: number) => Schema.decodeUnknownSync(BlockPositionSchema)({ x: 4, y, z: 4 })
const blockId = (type: BlockType) => Option.getOrThrow(blockIdOf(type))
const sand = blockId("sand")
const cactus = blockId("cactus")

const source: ChunkSource = (coord) =>
  Effect.succeed({
    coord,
    blocks: emptyBlocks(),
    biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => "PLAINS" as const)
  })

const decode = Schema.decodeUnknownSync
type BreakTransactionResult = Schema.Schema.Type<typeof BreakTransactionResultSchema>
type CommittedCascade = Extract<BreakTransactionResult, { _tag: "CommittedCascade" }>

const makePlayerStorage = () => {
  const tool = Result.getOrThrow(itemStack("iron_pickaxe", 1))
  const inventory = {
    slots: emptyInventory().slots.map((slot, index) => index === 0 ? tool : slot)
  }
  return decode(PlayerStorageSnapshotSchema)(Result.getOrThrow(withInventory(emptyPlayerStorage(), inventory)))
}

const makeFixture = async () => {
  const registryLayer = ChunkStoreRegistryLayer(() => source, ChunkCapacity(2))
  const registry = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* ChunkStoreRegistry
    }).pipe(Effect.provide(registryLayer))
  )
  const ownerId = decode(ReplicatedOwnerIdSchema)("support-cascade-player")
  const initialStorage = makePlayerStorage()
  const coordinatorLayer = WorldCommitCoordinatorLayer({
    world: decode(WorldIdSchema)("support-cascade-world"),
    owners: [playerStorageOwnerRegistration(ownerId, initialStorage)],
    dimensions: [dimension],
    chunkStores: registry
  })
  const coordinator = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* WorldCommitCoordinator
    }).pipe(Effect.provide(coordinatorLayer))
  )
  const store = registry.forDimension(dimension)
  await Effect.runPromise(store.load(chunk))

  let restoredStorage = initialStorage
  const inventory: Pick<InventoryServiceApi, "restoreStorage"> = {
    restoreStorage: (snapshot) => Effect.sync(() => {
      restoredStorage = decode(PlayerStorageSnapshotSchema)(snapshot)
    })
  }
  const context: BreakTransactionContext = {
    coordinator,
    dimension,
    ownerId,
    inventory,
    toolLocation: { _tag: "Inventory", slotIndex: 0 }
  }

  return {
    coordinator,
    context,
    initialStorage,
    readRestoredStorage: () => restoredStorage,
    store
  }
}

const seedCactusColumn = async (store: ChunkStoreApi, baseY: number, height: number) => {
  const positions = Array.from({ length: height + 1 }, (_, offset) => positionAt(baseY + offset))
  const outcomes: Array<BlockWriteOutcome> = await Effect.runPromise(
    Effect.forEach(
      positions,
      (position, index) => store.setBlock(position, index === 0 ? sand : cactus),
      { concurrency: 1 },
    ),
  )
  expect(outcomes.map(({ _tag }) => _tag)).toEqual(Array.from({ length: height + 1 }, () => "Written"))
  return positions
}

const readBlocks = async (store: ChunkStoreApi, positions: ReadonlyArray<ReturnType<typeof positionAt>>) =>
  Promise.all(positions.map((position) => Effect.runPromise(store.getBlock(position))))

const readOwnerStorage = (coordinator: BreakTransactionContext["coordinator"], ownerId: BreakTransactionContext["ownerId"]) =>
  Effect.runPromise(coordinator.snapshot(ownerId, PlayerStorageSnapshotSchema))

const assertFiniteBrandedCommit = (result: CommittedCascade) => {
  const worldRevision = decode(WorldRevisionSchema)(result.worldRevision)
  const dimensionRevision = decode(DimensionRevisionSchema)(result.dimensionRevision)
  expect(Number.isFinite(worldRevision)).toBe(true)
  expect(Number.isFinite(dimensionRevision)).toBe(true)
  expect(worldRevision).toBeGreaterThan(0)
  expect(dimensionRevision).toBeGreaterThan(0)
  decode(BlockPositionSchema)(result.primary)
  for (const position of result.removed) decode(BlockPositionSchema)(position)
}

describe("breakBlock support cascade transaction", () => {
  it("decodes finite branded results and returns deterministic breadth-first removal order", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (height) => {
        const first = await makeFixture()
        const second = await makeFixture()
        const baseY = 60
        const firstPositions = await seedCactusColumn(first.store, baseY, height)
        const secondPositions = await seedCactusColumn(second.store, baseY, height)
        const primary = firstPositions[0]
        if (primary === undefined) throw new Error("the support position was not generated")

        const firstRaw = await Effect.runPromise(breakBlock(first.store, primary, first.context))
        const secondRaw = await Effect.runPromise(breakBlock(second.store, primary, second.context))
        const firstResult = decode(BreakTransactionResultSchema)(firstRaw)
        const secondResult = decode(BreakTransactionResultSchema)(secondRaw)
        expect(firstResult._tag).toBe("CommittedCascade")
        expect(secondResult._tag).toBe("CommittedCascade")
        if (firstResult._tag !== "CommittedCascade" || secondResult._tag !== "CommittedCascade") return

        assertFiniteBrandedCommit(firstResult)
        assertFiniteBrandedCommit(secondResult)
        expect(secondResult).toEqual(firstResult)
        const expected = firstPositions.map((position) => decode(BlockPositionSchema)(position))
        expect(decode(BlockPositionSchema)(firstResult.primary)).toEqual(expected[0])
        expect(firstResult.removed.map((position) => decode(BlockPositionSchema)(position))).toEqual(expected)
        expect(secondResult.removed).toEqual(firstResult.removed)
        expect(secondResult.yielded).toEqual(firstResult.yielded)

        const firstAfter = await readBlocks(first.store, firstPositions)
        const secondAfter = await readBlocks(second.store, secondPositions)
        expect(firstAfter).toEqual(secondAfter)
        expect(firstAfter.every((reading) => reading._tag === "Block" && reading.block === AIR_BLOCK_ID)).toBe(true)

        const firstStorage = await readOwnerStorage(first.coordinator, first.context.ownerId)
        const secondStorage = await readOwnerStorage(second.coordinator, second.context.ownerId)
        expect(firstStorage.state).toEqual(secondStorage.state)
        const beforeDurability = first.initialStorage.inventoryDurability[0]
        const afterDurability = firstStorage.state.inventoryDurability[0]
        if (
          beforeDurability === undefined ||
          beforeDurability === null ||
          afterDurability === undefined ||
          afterDurability === null
        ) throw new Error("the generated pickaxe has no durability")
        expect(afterDurability.current).toBe(beforeDurability.current - 1)
        expect(first.readRestoredStorage()).toEqual(firstStorage.state)
      }),
      { numRuns: 20, seed: 742019 }
    )
  })

  it("leaves blocks and tool durability unchanged when tool damage is rejected", async () => {
    const fixture = await makeFixture()
    const positions = await seedCactusColumn(fixture.store, 60, 3)
    const primary = positions[0]
    if (primary === undefined) throw new Error("the support position was not generated")
    const beforeBlocks = await readBlocks(fixture.store, positions)
    const beforeStorage = await readOwnerStorage(fixture.coordinator, fixture.context.ownerId)
    const invalidToolContext: BreakTransactionContext = {
      ...fixture.context,
      toolLocation: { _tag: "Inventory", slotIndex: -1 } satisfies StorageLocation
    }

    const raw = await Effect.runPromise(breakBlock(fixture.store, primary, invalidToolContext))
    const result = decode(BreakTransactionResultSchema)(raw)
    expect(result._tag).toBe("TransactionFailure")
    if (result._tag !== "TransactionFailure") return
    const failure = decode(BreakTransactionFailureSchema)(result.failure)
    expect(failure).toEqual({ _tag: "ToolDamageRejected", reason: "InvalidLocation" })

    const afterBlocks = await readBlocks(fixture.store, positions)
    const afterStorage = await readOwnerStorage(fixture.coordinator, fixture.context.ownerId)
    expect(afterBlocks).toEqual(beforeBlocks)
    expect(afterStorage.state).toEqual(beforeStorage.state)
    expect(fixture.readRestoredStorage()).toEqual(fixture.initialStorage)
  })
})
