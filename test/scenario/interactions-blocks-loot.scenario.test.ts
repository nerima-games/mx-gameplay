import { describe, expect, it } from '@effect/vitest'
import {
  AttackRangeDistance,
  BlockId,
  DimensionIdSchema,
  EntityHealthPoints,
  StackCount,
  blockIdOf,
  itemComponents,
  itemStack,
  type EnchantmentsComponent,
} from '@nerima-games/mc-kernel'
import {
  PlayerStorageSnapshotSchema,
  EntityId,
  EntitySerial,
  storageFromInventory,
  type Entity,
  type EntityRoster,
  type PlayerStorage,
} from '@nerima-games/mc-sim'
import { Effect, Option, Ref, Result, Schema } from 'effect'
import fc from 'fast-check'
import { makeInMemoryWorld, cellKey, chunkKey, chunkOf } from '../../src/domain/in-memory-world'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import { ZOMBIE_KIND } from '../../src/domain/mob/hostile-combat'
import { rollMobDrop, type MobDropRule } from '../../src/domain/mob/mob-drop'
import type { BlockLootContext } from '../../src/domain/interactions/block-loot'
import {
  drainMeleeAttackResults,
  gameplayStages,
  makeGameplayFrameState,
  makeGameplayFrameStateForOwner,
  requestBlockBreak,
  requestMeleeAttack,
} from '../../src/stages/registration'
import { GAMEPLAY_STAGE_IDS } from '../../src/stages/stage-ids'
import { GAMEPLAY_VITALS_OWNER_ID } from '../../src/stages/gameplay-owner-registrations'
import { makeGameplayCommitServices } from '../support/transactional-stage-doubles'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { runFrame } from '../support/frame-runner'
import { blockPosition, position } from '../support/coordinate-fixtures'
import { emptySlots } from '../support/inventory-service-double'

const OVERWORLD = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
const HELD_PICKAXE = { _tag: 'Inventory', slotIndex: 0 } as const

const storageWithEnchantedDiamondPickaxe = (
  id: 'fortune' | 'silk_touch' | 'unbreaking',
  level: number,
): PlayerStorage => {
  const enchantments = {
    [`minecraft:${id}`]: level,
  } as unknown as EnchantmentsComponent
  const components = Result.getOrThrow(itemComponents('diamond_pickaxe', { enchantments }))
  const pickaxe = Result.getOrThrow(itemStack('diamond_pickaxe', StackCount(1), { components }))
  const slots = [...emptySlots()]
  slots[HELD_PICKAXE.slotIndex] = pickaxe
  return storageFromInventory({ slots })
}

const storageWithLootingSword = (level: number): PlayerStorage => {
  const enchantments = { 'minecraft:looting': level } as unknown as EnchantmentsComponent
  const components = Result.getOrThrow(itemComponents('diamond_sword', { enchantments }))
  const sword = Result.getOrThrow(itemStack('diamond_sword', StackCount(1), { components }))
  const slots = [...emptySlots()]
  slots[0] = sword
  return storageFromInventory({ slots })
}

const killZombieWithLootingSword = (level: number, seed: number) =>
  Effect.gen(function* () {
    const playerPosition = position(0, 64, 0)
    const targetPosition = position(0, 64.72, -2)
    const world = yield* makeInMemoryWorld<MobBehaviour>({
      spawnPose: { feetPosition: playerPosition, yawRadians: 0, pitchRadians: 0 },
      world: {
        blocks: new Map(),
        loaded: [
          chunkKey(chunkOf(blockPosition(0, 64, 0))),
          chunkKey(chunkOf(blockPosition(0, 64, -2))),
        ],
      },
    })
    const target: Entity<MobBehaviour> = {
      id: EntityId('looting-zombie-target'),
      kind: ZOMBIE_KIND,
      feetPosition: targetPosition,
      healthPoints: EntityHealthPoints(1),
      behaviour: undefined,
    }
    const initialEntities: EntityRoster<MobBehaviour> = {
      entities: [target],
      nextSerial: EntitySerial(1),
    }
    const entities = yield* makeEntityManagerDouble(initialEntities)
    const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory, {
      playerStorage: storageWithLootingSword(level),
      entities: initialEntities,
      playerPose: { feetPosition: playerPosition, yawRadians: 0, pitchRadians: 0 },
    })
    const state = yield* makeGameplayFrameStateForOwner({
      coordinator: commit.coordinator,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    })
    yield* Ref.set(state.rollSeed, seed)
    const stages = gameplayStages(
      state,
      world.chunkStore,
      entities.api,
      world.inventory,
      world.player,
      world.time,
      undefined,
      undefined,
      {},
      commit,
    )

    yield* requestMeleeAttack(state, {
      requestId: `kill-zombie-looting-${String(level)}`,
      origin: playerPosition,
      direction: position(0, 0, 1),
      reach: AttackRangeDistance(3),
      damage: 20,
      toolLocation: { _tag: 'Inventory', slotIndex: 0 },
    })
    yield* runFrame(stages)
    expect(yield* drainMeleeAttackResults(state)).toMatchObject([{
      requestId: `kill-zombie-looting-${String(level)}`,
      success: true,
      target: { id: target.id },
    }])
    return yield* Ref.get(state.mobDrops)
  })

const mineWithEquippedPickaxe = (
  block: BlockId,
  playerStorage: PlayerStorage,
  rollSeed?: number,
  lootContext?: BlockLootContext,
) =>
  Effect.gen(function* () {
    const position = blockPosition(3, 64, 7)
    const world = yield* makeInMemoryWorld<MobBehaviour>({
      world: {
        blocks: new Map([[cellKey(position), block]]),
        loaded: [chunkKey(chunkOf(position))],
      },
    })
    const state = yield* makeGameplayFrameState
    if (rollSeed !== undefined) yield* Ref.set(state.rollSeed, rollSeed)
    const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory, { playerStorage })
    const stages = gameplayStages(
      state,
      world.chunkStore,
      world.entities,
      world.inventory,
      world.player,
      world.time,
      undefined,
      undefined,
      {},
      commit,
    )

    yield* requestBlockBreak(state, position, lootContext, {
      dimension: OVERWORLD,
      toolLocation: HELD_PICKAXE,
    })
    yield* runFrame(stages.filter(({ id }) => id === GAMEPLAY_STAGE_IDS.interactions))

    expect(yield* Ref.get(state.operationFailures)).toStrictEqual([])
    const storageSnapshot = yield* commit.coordinator.snapshot(
      commit.playerStorageOwnerId,
      PlayerStorageSnapshotSchema,
    )
    return Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(storageSnapshot.state)
  })

const itemCount = (storage: PlayerStorage, item: string): number =>
  storage.inventory.slots.reduce(
    (count, slot) => count + (slot?.item === item ? slot.count : 0),
    0,
  )

describe('block loot gameplay scenarios', () => {
  it.effect('mines glass with Silk Touch and commits the block item to player storage', () =>
    Effect.gen(function* () {
      const position = blockPosition(3, 64, 7)
      const glass = Option.getOrThrow(blockIdOf('glass'))
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        world: {
          blocks: new Map([[cellKey(position), glass]]),
          loaded: [chunkKey(chunkOf(position))],
        },
      })
      const state = yield* makeGameplayFrameState
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory)
      const stages = gameplayStages(
        state,
        world.chunkStore,
        world.entities,
        world.inventory,
        world.player,
        world.time,
        undefined,
        undefined,
        {},
        commit,
      )

      yield* requestBlockBreak(state, position, { silkTouch: true })
      yield* runFrame(stages)

      expect(yield* world.chunkStore.getBlock(position)).toStrictEqual({
        _tag: 'Block',
        block: BlockId(0),
      })
      const storageSnapshot = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      const storage = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(storageSnapshot.state)
      const glassCount = storage.inventory.slots.reduce(
        (count, slot) => count + (slot?.item === 'glass' ? slot.count : 0),
        0,
      )
      expect(glassCount).toBe(1)
    }),
  )

  it.effect('reads Fortune III from the equipped pickaxe when gravel is mined', () =>
    Effect.gen(function* () {
      // Vanilla Fortune III makes gravel drop flint with probability 1
      // (https://minecraft.wiki/w/Fortune#Gravel).
      // This request omits legacy loot metadata, so the stage must read the
      // enchantment from the item in the captured storage slot.
      const gravel = Option.getOrThrow(blockIdOf('gravel'))
      const storage = yield* mineWithEquippedPickaxe(
        gravel,
        storageWithEnchantedDiamondPickaxe('fortune', 3),
        undefined,
        { fortuneLevel: 0 },
      )

      expect(itemCount(storage, 'flint')).toBe(1)
      expect(itemCount(storage, 'gravel')).toBe(0)
    }),
  )

  it.effect('reads Silk Touch from the equipped pickaxe instead of caller loot metadata', () =>
    Effect.gen(function* () {
      const glass = Option.getOrThrow(blockIdOf('glass'))
      const storage = yield* mineWithEquippedPickaxe(
        glass,
        storageWithEnchantedDiamondPickaxe('silk_touch', 1),
        undefined,
        { silkTouch: false },
      )

      expect(itemCount(storage, 'glass')).toBe(1)
    }),
  )

  it.effect('uses Unbreaking III roll bounds for equipped pickaxe wear', () =>
    Effect.gen(function* () {
      const stone = Option.getOrThrow(blockIdOf('stone'))
      const lowRollStorage = storageWithEnchantedDiamondPickaxe('unbreaking', 3)
      const highRollStorage = storageWithEnchantedDiamondPickaxe('unbreaking', 3)
      const lowInitial = lowRollStorage.inventoryDurability[HELD_PICKAXE.slotIndex]
      const highInitial = highRollStorage.inventoryDurability[HELD_PICKAXE.slotIndex]
      if (lowInitial === null || lowInitial === undefined || highInitial === null || highInitial === undefined) {
        throw new Error('The test pickaxe must have kernel durability data.')
      }

      // For tools, Unbreaking III prevents wear for 3/4 of uses
      // (https://minecraft.wiki/w/Unbreaking#Usage). These seeds
      // produce rolls 0.743505... and 0.782636... respectively, straddling 3/4.
      const lowRollResult = yield* mineWithEquippedPickaxe(stone, lowRollStorage, 95_000)
      const highRollResult = yield* mineWithEquippedPickaxe(stone, highRollStorage, 100_000)

      expect(lowRollResult.inventoryDurability[HELD_PICKAXE.slotIndex]).toStrictEqual(lowInitial)
      expect(highRollResult.inventoryDurability[HELD_PICKAXE.slotIndex]).toStrictEqual({
        current: highInitial.current - 1,
        max: highInitial.max,
      })
    }),
  )
})

describe('Looting mob-drop calculations', () => {
  it.effect('matches the Vanilla Java 26.3 zombie count distribution', () =>
    Effect.sync(() => {
      // The 26.3 zombie loot table sets rotten flesh to 0..2, then applies
      // enchanted_count_increase with a uniform 0..1 provider per level. The
      // scaled bonus is rounded: at Looting III its probabilities are 1/6,
      // 1/3, 1/3, 1/6 for bonuses 0..3. Convolving that with the three equally
      // likely base counts gives final probabilities [1,3,5,5,3,1]/18.
      // Sources: https://mcasset.cloud/26.3-snapshot-2/data/minecraft/loot_table/entities/zombie.json
      // https://minecraft.wiki/w/Loot_functions#enchanted_count_increase
      const rule: MobDropRule = {
        item: 'rotten_flesh',
        count: 0,
        maxCount: 2,
        lootingCountIncrease: true,
      }
      const kill = { _tag: 'Slain', lootingLevel: 3 } as const
      const epsilon = 0.000001
      const cases = [
        [0, undefined],
        [1 / 18 - epsilon, undefined],
        [1 / 18, { item: 'rotten_flesh', count: 1 }],
        [4 / 18 - epsilon, { item: 'rotten_flesh', count: 1 }],
        [4 / 18, { item: 'rotten_flesh', count: 2 }],
        [9 / 18 - epsilon, { item: 'rotten_flesh', count: 2 }],
        [9 / 18, { item: 'rotten_flesh', count: 3 }],
        [14 / 18 - epsilon, { item: 'rotten_flesh', count: 3 }],
        [14 / 18, { item: 'rotten_flesh', count: 4 }],
        [17 / 18 - epsilon, { item: 'rotten_flesh', count: 4 }],
        [17 / 18, { item: 'rotten_flesh', count: 5 }],
        [1, { item: 'rotten_flesh', count: 5 }],
      ] as const

      for (const [roll, expected] of cases) {
        expect(rollMobDrop(rule, kill, { chance: 0, count: roll })).toStrictEqual(expected)
      }
      expect(rollMobDrop(rule, { ...kill, lootingLevel: 0 }, { chance: 0, count: 0.5 }))
        .toStrictEqual({ item: 'rotten_flesh', count: 1 })
      expect(rollMobDrop(rule, { ...kill, lootingLevel: -1 }, { chance: 0, count: 0.5 }))
        .toStrictEqual({ item: 'rotten_flesh', count: 1 })
    }),
  )

  it.effect('applies the Looting bonus to vanilla rare-drop chance at its strict boundary', () =>
    Effect.sync(() => {
      const rareDrop: MobDropRule = {
        item: 'iron_ingot',
        count: 1,
        chance: 0.025,
        lootingChancePerLevel: 0.01,
        playerKillOnly: true,
      }
      const lootingThreeKill = { _tag: 'Slain', lootingLevel: 3, playerKill: true } as const

      // Zombie rare drops use 2.5% base chance and 3.5% + 1% per level above
      // I, hence 5.5% at Looting III.
      // Source: https://mcasset.cloud/26.3-snapshot-2/data/minecraft/loot_table/entities/zombie.json
      expect(rollMobDrop(rareDrop, lootingThreeKill, { chance: 0.054999, count: 0 }))
        .toStrictEqual({ item: 'iron_ingot', count: 1 })
      expect(rollMobDrop(rareDrop, lootingThreeKill, { chance: 0.055, count: 0 }))
        .toBeUndefined()
      expect(rollMobDrop(rareDrop, { ...lootingThreeKill, lootingLevel: 0 }, { chance: 0.025, count: 0 }))
        .toBeUndefined()
    }),
  )

  it('keeps Looting count monotone and within the vanilla bound', () => {
    const rule: MobDropRule = {
      item: 'rotten_flesh',
      count: 0,
      maxCount: 2,
      lootingCountIncrease: true,
    }
    const actualCount = (level: number, roll: number): number =>
      rollMobDrop(rule, { _tag: 'Slain', lootingLevel: level }, { chance: 0, count: roll })?.count ?? 0

    fc.assert(fc.property(
      fc.integer({ min: 0, max: 8 }),
      fc.double({ min: 0, max: 0.999999999 }),
      fc.double({ min: 0, max: 0.999999999 }),
      (level, leftRoll, rightRoll) => {
        const lowRoll = Math.min(leftRoll, rightRoll)
        const highRoll = Math.max(leftRoll, rightRoll)
        const lowCount = actualCount(level, lowRoll)
        const highCount = actualCount(level, highRoll)
        expect(lowCount).toBeLessThanOrEqual(highCount)
        expect(lowCount).toBeGreaterThanOrEqual(0)
        expect(highCount).toBeLessThanOrEqual(2 + level)
      },
    ))
  })

  it.effect('uses the equipped Looting III sword through the melee and entity stages', () =>
    Effect.gen(function* () {
      // This seed's second Park-Miller roll is about 0.08987, inside the
      // independently calculated [1/18, 4/18) band, so the count is one.
      const drops = yield* killZombieWithLootingSword(3, 95_000)
      const rottenFlesh = drops.find(({ item }) => item === 'rotten_flesh')

      expect(rottenFlesh?.count).toBe(1)
    }),
  )
})
