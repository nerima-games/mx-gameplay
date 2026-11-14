import { describe, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Effect, Result } from 'effect'
import {
  BlockAxis,
  DeltaTimeSecs,
  EntityHealthPoints,
  FoodSaturation,
  PositionAxis,
  StackCount,
  blockPosition,
  itemStack,
  maxStackCountForItem,
  position,
} from '@nerima-games/mc-kernel'
import {
  ExhaustionAmount,
  FoodTimerSecs,
  HungerPoints,
  TotalExperience,
  type PlayerPose,
  type Slot,
} from '@nerima-games/mc-sim'
import {
  INVENTORY_SLOT_COUNT,
  addToSlots,
  emptySlots,
  normaliseInventory,
  totalOf,
} from '../../src/domain/in-memory-inventory'
import {
  INITIAL_PLAYER_POSE,
  PITCH_MAX_RADIANS,
  PITCH_MIN_RADIANS,
  applyLook,
} from '../../src/domain/in-memory-player'
import {
  isValidPlayerVitals,
  makeInMemoryVitals,
  type PlayerVitals,
} from '../../src/domain/in-memory-vitals'
import {
  advanceSleep,
  enterSleep,
  initialSleepRuntimeState,
  requiredSleeperCount,
  type SleepLocation,
} from '../../src/domain/bed-sleep'

const stoneSlot = (count: number): Slot =>
  count === 0
    ? undefined
    : Result.getOrThrow(itemStack('stone', StackCount(count)))

// Persisted saves may contain a stack count above the item's cap before normalization.
const savedStoneSlot = (count: number): Slot => {
  if (count === 0) return undefined
  const valid = Result.getOrThrow(itemStack('stone', StackCount(1)))
  return { ...valid, count } as unknown as Slot
}

const STONE_STACK_LIMIT = maxStackCountForItem('stone')

const pose = (pitchRadians: number, yawRadians: number): PlayerPose => ({
  ...INITIAL_PLAYER_POSE,
  feetPosition: position(PositionAxis(3), PositionAxis(64), PositionAxis(-2)),
  pitchRadians,
  yawRadians,
})

const vitals = (health: number, hunger: number, saturation: number, timer: number): PlayerVitals => ({
  healthPoints: EntityHealthPoints(health),
  maxHealthPoints: EntityHealthPoints(20),
  hungerPoints: HungerPoints(hunger),
  maxHungerPoints: HungerPoints(20),
  saturation: FoodSaturation(saturation),
  exhaustion: ExhaustionAmount(0),
  foodTimerSecs: FoodTimerSecs(timer),
  totalExperience: TotalExperience(0),
  lastDamageCause: undefined,
})

const sleepLocation: SleepLocation = {
  dimension: 'overworld',
  position: position(PositionAxis(0), PositionAxis(65), PositionAxis(0)),
  bedPosition: blockPosition(BlockAxis(0), BlockAxis(64), BlockAxis(0)),
}

describe('player state properties', () => {
  it('keeps accepted inventory additions equal to the increase in held items', () => {
    // Fails if adding a stack duplicates items or reports a different accepted count than it stores.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 0, max: STONE_STACK_LIMIT }),
        FastCheck.integer({ min: 0, max: STONE_STACK_LIMIT * 2 }),
        (initialCount, requested) => {
          const before: ReadonlyArray<Slot> = [stoneSlot(initialCount), ...emptySlots().slice(1)]
          const beforeTotal = totalOf(before, 'stone')
          const result = addToSlots(before, 'stone', requested)
          const afterTotal = totalOf(result.slots, 'stone')

          return result.accepted >= 0 &&
            result.accepted <= requested &&
            afterTotal === beforeTotal + result.accepted &&
            result.slots.length === INVENTORY_SLOT_COUNT &&
            result.slots.every((slot) => slot === undefined || slot.count <= STONE_STACK_LIMIT)
        },
      ),
    )
  })

  it('accounts for every item removed while restoring an inventory to its slot limit', () => {
    // Fails if trimming an overlong save silently loses items without reporting the discarded total.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.array(FastCheck.integer({ min: 0, max: STONE_STACK_LIMIT * 2 }), {
          maxLength: INVENTORY_SLOT_COUNT + 12,
        }),
        (counts) => {
          const original: ReadonlyArray<Slot> = counts.map(savedStoneSlot)
          const result = normaliseInventory({ slots: original })
          const originalTotal = totalOf(original, 'stone')
          const retainedTotal = totalOf(result.slots, 'stone')
          const expectedDiscarded = counts.reduce(
            (total, count, index) =>
              total + (index < INVENTORY_SLOT_COUNT ? Math.max(0, count - STONE_STACK_LIMIT) : count),
            0,
          )

          return result.slots.length === INVENTORY_SLOT_COUNT &&
            result.discarded === expectedDiscarded &&
            retainedTotal + result.discarded === originalTotal &&
            result.slots.every((slot) => slot === undefined || slot.count <= STONE_STACK_LIMIT)
        },
      ),
    )
  })

  it('clamps every finite look delta without changing player position', () => {
    // Fails if accumulated pitch can pass vertical or a look update changes the player's feet position.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.double({ min: -20, max: 20, noNaN: true }),
        FastCheck.double({ min: -20, max: 20, noNaN: true }),
        FastCheck.double({ min: -20, max: 20, noNaN: true }),
        FastCheck.double({ min: -20, max: 20, noNaN: true }),
        (pitch, yaw, pitchDelta, yawDelta) => {
          const before = pose(pitch, yaw)
          const after = applyLook(before, yawDelta, pitchDelta)
          if (Result.isFailure(after)) return false

          return after.success.pitchRadians >= PITCH_MIN_RADIANS &&
            after.success.pitchRadians <= PITCH_MAX_RADIANS &&
            after.success.yawRadians === yaw + yawDelta &&
            after.success.feetPosition === before.feetPosition
        },
      ),
    )
  })

  it('uses the rounded-up sleeper ratio and never requires fewer than one player', () => {
    // Fails if percentage rounding changes to floor or zero sleepers can satisfy the night-skip rule.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 0, max: 64 }),
        FastCheck.double({ min: 0, max: 1, noNaN: true }),
        (connectedPlayers, ratio) => {
          const required = requiredSleeperCount(connectedPlayers, ratio)
          return Result.isSuccess(required) && required.success ===
            Math.max(1, Math.ceil(connectedPlayers * ratio))
        },
      ),
    )
  })

  it('skips the night for one connected sleeper only after the wait boundary', () => {
    // Fails if a single sleeper skips too early or still cannot skip after meeting the configured delay.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.double({ min: 0, max: 20, noNaN: true }),
        FastCheck.double({ min: 0, max: 20, noNaN: true }),
        (deltaSecs, delaySecs) => {
          const sleeping = enterSleep(initialSleepRuntimeState(), 'player-1', sleepLocation)
          const result = advanceSleep(sleeping, deltaSecs, 1, 1, delaySecs)
          return Result.isSuccess(result) &&
            result.success.skipToMorning === (deltaSecs >= delaySecs) &&
            result.success.state.sleepers[0]?.elapsedSecs === deltaSecs
        },
      ),
    )
  })

  it('keeps player health, hunger, and saturation within their valid ranges after food ticks', async () => {
    // Fails if starvation or regeneration pushes player vitals outside the persisted-state contract.
    await FastCheck.assert(
      FastCheck.asyncProperty(
        FastCheck.integer({ min: 0, max: 20 }),
        FastCheck.integer({ min: 0, max: 20 }),
        FastCheck.integer({ min: 0, max: 20 }),
        FastCheck.double({ min: 0, max: 3.9, noNaN: true }),
        FastCheck.integer({ min: 0, max: 12 }),
        async (health, hunger, saturation, timer, elapsedSecs) => {
          const service = await Effect.runPromise(
            makeInMemoryVitals(vitals(health, hunger, Math.min(saturation, hunger), timer)),
          )
          const result = await Effect.runPromise(service.advanceFoodTimer(DeltaTimeSecs(elapsedSecs)))

          return isValidPlayerVitals(result.vitals) &&
            result.vitals.healthPoints >= 0 &&
            result.vitals.healthPoints <= result.vitals.maxHealthPoints &&
            result.vitals.hungerPoints >= 0 &&
            result.vitals.hungerPoints <= result.vitals.maxHungerPoints &&
            result.vitals.saturation <= result.vitals.maxHungerPoints
        },
      ),
    )
  })
})
