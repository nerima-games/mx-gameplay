/**
 * The ender pearl: plan.md §3.11's first responsibility, the other half of the
 * item use the bow opened.
 *
 * The first `describe` is the reference's oracle
 * (`<reference-impl>/packages/app/application/frame/stages/interaction-item-use-handler/ender-pearl.test.ts`)
 * transcribed — docs/porting.md §4. Everything after it is this repository's, and
 * each block says what it is for.
 *
 * THE LAST TWO `describe`s ARE THE WIRING, through the shipped stage
 * registrations rather than by calling the rules again, which is
 * `test/vertical-slice.test.ts`'s distinction: 「the port and the loop were each
 * proven separately before, and separately proven halves do not compose by
 * themselves」.
 */
import { describe, expect, it } from '@effect/vitest'
import { makeTimeService, type Slot } from '@nerima-games/mc-sim'
import { Effect, Ref } from 'effect'
import {
  enderPearlDisplacement,
  enderPearlDistance,
  shouldSpawnEndermite,
  ENDER_PEARL_DAMAGE,
  ENDER_PEARL_DEATH_CAUSE,
  ENDER_PEARL_ENDERMITE_SPAWN_CHANCE,
  ENDER_PEARL_MAX_DISTANCE,
} from '../src/domain/interactions/throw-ender-pearl'
import { applyDamage, deathMessage, DEATH_MESSAGES } from '../src/domain/death-cause'
import {
  ENDERMITE_KIND,
  ENDERMITE_MAX_HEALTH,
  HOSTILE_KINDS,
  type MobBehaviour,
} from '../src/domain/entities/mob-frame'
import {
  gameplayStages,
  makeGameplayFrameState,
  type EnderPearlThrowRequest,
} from '../src/stages/registration'
import { makeChunkStoreDouble } from './support/chunk-store-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { makePlayerServiceDouble } from './support/player-service-double'
import { makeInventoryDouble } from './support/inventory-service-double'
import { runFrame } from './support/frame-runner'
import { StackCount } from '../src/domain/frame-contract'

const ORIGIN = { x: 10, y: 64, z: 10 }

/** A frame with the shipped stages over the three doubles. */
const inventoryWithPearl = (): ReadonlyArray<Slot> =>
  Array.from({ length: 36 }, (_, index) =>
    index === 0 ? { item: 'ender_pearl' as const, count: StackCount(1) } : undefined,
  )

const scene = (inventorySlots?: ReadonlyArray<Slot>) =>
  Effect.gen(function* () {
    const store = yield* makeChunkStoreDouble(new Map<string, number>(), ['0,0'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const player = yield* makePlayerServiceDouble()
    const inventory = yield* makeInventoryDouble(inventorySlots)
    const time = yield* makeTimeService()
    const state = yield* makeGameplayFrameState
    return {
      roster,
      player,
      inventory,
      state,
      stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api, time),
    }
  })

type PearlInput = Omit<EnderPearlThrowRequest, 'inventory'> &
  Partial<Pick<EnderPearlThrowRequest, 'inventory'>>

const throwPearl = (request: PearlInput): EnderPearlThrowRequest => ({
  inventory: { mode: 'creative', slotIndex: 0 },
  ...request,
})

// ---------------------------------------------------------------------------
// The reference's oracle, transcribed
// ---------------------------------------------------------------------------

describe('enderPearlDistance — the reference oracle (ender-pearl.ts:27)', () => {
  it('uses the maximum when the aim ray struck nothing', () => {
    expect(enderPearlDistance(undefined)).toBe(ENDER_PEARL_MAX_DISTANCE)
  })

  it('uses the hit distance when it is nearer than the maximum', () => {
    expect(enderPearlDistance(7)).toBe(7)
  })

  it('CAPS at the maximum when the hit is further away', () => {
    expect(enderPearlDistance(ENDER_PEARL_MAX_DISTANCE + 100)).toBe(ENDER_PEARL_MAX_DISTANCE)
  })

  it('floors at zero: a negative hit distance does not throw you backwards', () => {
    expect(enderPearlDistance(-5)).toBe(0)
  })
})

describe('shouldSpawnEndermite — the reference oracle (ender-pearl.ts:36-37)', () => {
  it('spawns below the chance', () => {
    expect(shouldSpawnEndermite(0)).toBe(true)
    expect(shouldSpawnEndermite(ENDER_PEARL_ENDERMITE_SPAWN_CHANCE / 2)).toBe(true)
  })

  it('does NOT spawn at exactly the chance — the comparison is strict', () => {
    expect(shouldSpawnEndermite(ENDER_PEARL_ENDERMITE_SPAWN_CHANCE)).toBe(false)
  })

  it('does not spawn above it', () => {
    expect(shouldSpawnEndermite(0.9)).toBe(false)
  })

  it('THE LOWER BOUND IS DOING REAL WORK: a negative roll does not spawn', () => {
    // `roll >= 0 &&` is transcribed rather than simplified away. A bare `<`
    // would accept every negative roll and spawn an endermite from a broken
    // generator on every throw.
    expect(shouldSpawnEndermite(-1)).toBe(false)
  })

  it('a roll that is not a number does not spawn', () => {
    expect(shouldSpawnEndermite(Number.NaN)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// This repository's
// ---------------------------------------------------------------------------

describe('enderPearlDisplacement', () => {
  it('carries you along the aim, the full range when nothing was hit', () => {
    const displacement = enderPearlDisplacement(0, 0, 1, undefined)
    expect(displacement).toStrictEqual({ x: 0, y: 0, z: ENDER_PEARL_MAX_DISTANCE })
  })

  it('stops at what the ray struck', () => {
    const displacement = enderPearlDisplacement(0, 0, 1, 6)
    expect(displacement?.z).toBeCloseTo(6)
  })

  it('HAS A VERTICAL COMPONENT, unlike the enderman teleport: a pearl gets you up a cliff', () => {
    const displacement = enderPearlDisplacement(0, 1, 0, 10)
    expect(displacement?.y).toBeCloseTo(10)
    expect(displacement?.x).toBeCloseTo(0)
  })

  it('normalises: the length of the throw is the distance, whatever the aim measures', () => {
    const displacement = enderPearlDisplacement(3, 4, 0, 10)
    expect(Math.hypot(displacement?.x ?? 0, displacement?.y ?? 0, displacement?.z ?? 0)).toBeCloseTo(
      10,
    )
  })

  it('SCALE-INVARIANT under positive factors: docs/responsibility.md §5-1, executable', () => {
    const answers = [1, 0.001, 25, 1e6].map((scale) =>
      enderPearlDisplacement(1 * scale, 2 * scale, 3 * scale, 12),
    )
    for (const answer of answers) {
      expect(answer?.x).toBeCloseTo(answers[0]?.x ?? -1)
      expect(answer?.y).toBeCloseTo(answers[0]?.y ?? -1)
      expect(answer?.z).toBeCloseTo(answers[0]?.z ?? -1)
    }
  })

  it('DIVERGENCE: a degenerate aim moves nobody, where the reference throws due NORTH', () => {
    // `ender-pearl.ts:23-25` falls back to `dz = -1` on a zero-length
    // direction, so a player who aimed at nothing is teleported 24 blocks north
    // at full range. See `enderPearlDisplacement`'s doc comment.
    expect(enderPearlDisplacement(0, 0, 0, undefined)).toBeUndefined()
  })

  it('a non-finite aim moves nobody', () => {
    expect(enderPearlDisplacement(Number.NaN, 0, 1, 5)).toBeUndefined()
    expect(enderPearlDisplacement(0, 0, Number.POSITIVE_INFINITY, 5)).toBeUndefined()
  })

  it('A NON-FINITE HIT DISTANCE CANNOT LOSE THE PLAYER', () => {
    // The reference's `Math.max(0, Math.min(NaN, 24))` is NaN, which multiplies
    // every axis and teleports the player to NaN — out of the world. Here it is
    // read as "nothing was hit".
    const displacement = enderPearlDisplacement(0, 0, 1, Number.NaN)
    expect(displacement).toStrictEqual({ x: 0, y: 0, z: ENDER_PEARL_MAX_DISTANCE })
  })

  it('a zero-distance hit lands you exactly where you stood', () => {
    expect(enderPearlDisplacement(0, 0, 1, 0)).toStrictEqual({ x: 0, y: 0, z: 0 })
  })
})

describe('the cost of a throw', () => {
  it('is five health points, a quarter of the player', () => {
    expect(ENDER_PEARL_DAMAGE).toBe(5)
  })

  it('kills a player on four throws with no food, and says WHY', () => {
    let vitals = { healthPoints: 20, lastDeathCause: undefined as never }
    for (let throwCount = 0; throwCount < 4; throwCount += 1) {
      vitals = applyDamage(vitals, {
        amount: ENDER_PEARL_DAMAGE,
        cause: ENDER_PEARL_DEATH_CAUSE,
      }) as typeof vitals
    }
    expect(vitals.healthPoints).toBe(0)
    expect(deathMessage(vitals)).toBe(DEATH_MESSAGES.ender_pearl)
    // Not the fallback: the cause is the point of the type.
    expect(deathMessage(vitals)).not.toBe(DEATH_MESSAGES.generic)
  })

  it("the message is the reference's own (player-damage-cause.ts:29)", () => {
    expect(DEATH_MESSAGES.ender_pearl).toBe('You teleported too hard.')
  })
})

describe('the endermite is NOT a naturally spawning hostile', () => {
  it('is absent from HOSTILE_KINDS, so the night spawner cannot produce one', () => {
    // `HOSTILE_KINDS` is the spawner's roster AND the population cap's. Adding
    // the endermite to it would make endermites rain from the night sky, which
    // is neither vanilla nor the reference — the pearl is its only producer.
    // See `ENDERMITE_KIND`'s header for the cost of the exclusion, which is
    // that the cap does not count them.
    expect(HOSTILE_KINDS).not.toContain(ENDERMITE_KIND)
  })

  it('has the reference\'s health (endermite.ts:9)', () => {
    expect(ENDERMITE_MAX_HEALTH).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// The wiring, through the shipped stages
// ---------------------------------------------------------------------------

describe('gameplay:interactions — the pearl arm', () => {
  it.effect('a throw produces a displacement and its cost in the outbox', () =>
    Effect.gen(function* () {
      const { state, inventory, stages } = yield* scene(inventoryWithPearl())
      yield* Ref.set(state.pendingPearlThrows, [
        throwPearl({
          origin: ORIGIN,
          dirX: 0,
          dirY: 0,
          dirZ: 1,
          hitDistance: 8,
          inventory: { mode: 'survival', slotIndex: 0 },
        }),
      ])

      yield* runFrame(stages)

      const outcomes = yield* Ref.get(state.enderPearlOutcomes)
      expect(outcomes).toHaveLength(1)
      expect(outcomes[0]?.displacement.z).toBeCloseTo(8)
      expect(outcomes[0]?.damage).toStrictEqual({
        amount: ENDER_PEARL_DAMAGE,
        cause: 'ender_pearl',
      })
      const storage = yield* inventory.api.storageSnapshot
      expect(storage.inventory.slots[0]).toBeUndefined()
      expect(storage.inventoryDurability[0]).toBeNull()
    }),
  )

  it.effect('creative throws do not consume pearls or produce self-damage', () =>
    Effect.gen(function* () {
      const { state, inventory, stages } = yield* scene(inventoryWithPearl())
      yield* Ref.set(state.pendingPearlThrows, [
        throwPearl({
          origin: ORIGIN,
          dirX: 0,
          dirY: 0,
          dirZ: 1,
          hitDistance: 8,
          inventory: { mode: 'creative', slotIndex: 0 },
        }),
      ])

      yield* runFrame(stages)

      const outcomes = yield* Ref.get(state.enderPearlOutcomes)
      expect(outcomes[0]?.damage).toBeUndefined()
      expect((yield* inventory.api.storageSnapshot).inventory.slots[0]).toStrictEqual({
        item: 'ender_pearl',
        count: StackCount(1),
      })
    }),
  )

  it.effect('THE INBOX IS DRAINED, so one throw is serviced once', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* scene()
      yield* Ref.set(state.pendingPearlThrows, [
        throwPearl({ origin: ORIGIN, dirX: 0, dirY: 0, dirZ: 1 }),
      ])

      yield* runFrame(stages)
      yield* runFrame(stages)

      expect(yield* Ref.get(state.pendingPearlThrows)).toStrictEqual([])
      expect(yield* Ref.get(state.enderPearlOutcomes)).toHaveLength(1)
    }),
  )

  it.effect('a degenerate throw costs nothing at all — no damage, no roll spent on it', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* scene()
      yield* Ref.set(state.pendingPearlThrows, [
        throwPearl({ origin: ORIGIN, dirX: 0, dirY: 0, dirZ: 0 }),
      ])

      yield* runFrame(stages)

      expect(yield* Ref.get(state.enderPearlOutcomes)).toStrictEqual([])
    }),
  )

  it.effect('THE SAME SCENARIO TWICE DRAWS THE SAME ROLLS — no Math.random anywhere', () =>
    Effect.gen(function* () {
      // plan.md §5.1-3 makes determinism the precondition for using the
      // reference's tests as an oracle, and the reference's own pearl cannot be
      // replayed because `ender-pearl.ts:72` reads the global generator.
      const run = Effect.gen(function* () {
        const { state, roster, player, stages } = yield* scene()
        yield* player.api.moveTo(ORIGIN)
        yield* Ref.set(
          state.pendingPearlThrows,
          Array.from({ length: 60 }, () =>
            throwPearl({ origin: ORIGIN, dirX: 0, dirY: 0, dirZ: 1, hitDistance: 4 , inventory: { mode: 'creative', slotIndex: 0 }}),
          ),
        )
        yield* runFrame(stages)
        return (yield* roster.api.snapshot).entities.map((entity) => entity.feetPosition)
      })

      expect(yield* run).toStrictEqual(yield* run)
    }),
  )

  it.effect('an endermite appears at the LANDING point, not at the throwing point', () =>
    Effect.gen(function* () {
      // `ender-pearl.ts:73` spawns it at `teleportTarget`. Sixty throws makes
      // the 5% roll a near-certainty for the seeded generator; the assertion is
      // about WHERE, not about how many.
      const { state, roster, player, stages } = yield* scene()
      yield* player.api.moveTo(ORIGIN)
      yield* Ref.set(
        state.pendingPearlThrows,
        Array.from({ length: 60 }, () =>
          throwPearl({ origin: ORIGIN, dirX: 0, dirY: 0, dirZ: 1, hitDistance: 4 , inventory: { mode: 'creative', slotIndex: 0 }}),
        ),
      )

      yield* runFrame(stages)

      const spawned = (yield* roster.api.snapshot).entities
      expect(spawned.length).toBeGreaterThan(0)
      for (const endermite of spawned) {
        expect(endermite.kind).toBe(ENDERMITE_KIND)
        expect(endermite.healthPoints).toBe(ENDERMITE_MAX_HEALTH)
        // It ticks nothing: no rule in `domain/mob/` claims it.
        expect(endermite.behaviour).toBeUndefined()
        expect(endermite.feetPosition.z).toBeCloseTo(ORIGIN.z + 4)
      }
    }),
  )

  it.effect('the compatibility target Ref does not override the mc-sim player pose', () =>
    Effect.gen(function* () {
      const { state, roster, player, stages } = yield* scene()
      yield* player.api.moveTo(ORIGIN)
      yield* Ref.set(
        state.pendingPearlThrows,
        Array.from({ length: 60 }, () =>
          throwPearl({ origin: ORIGIN, dirX: 0, dirY: 0, dirZ: 1, hitDistance: 4 , inventory: { mode: 'creative', slotIndex: 0 }}),
        ),
      )

      yield* runFrame(stages)

      const spawned = (yield* roster.api.snapshot).entities
      expect(spawned.length).toBeGreaterThan(0)
      expect(spawned.every((entity) => entity.feetPosition.z === ORIGIN.z + 4)).toBe(true)
      expect(yield* Ref.get(state.targetPosition)).toBeUndefined()
      expect(yield* Ref.get(state.enderPearlOutcomes)).toHaveLength(60)
    }),
  )
})
