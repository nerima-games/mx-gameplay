import { describe, expect, it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import { position as atPosition } from './support/coordinate-fixtures'
import { EntityId, EntityKind, IntentPayloadSchema, type Entity } from '@nerima-games/mc-sim'
import {
  DimensionIdSchema,
  EntityHealthPoints,
  SimulationTickSchema,
  WorldPositionSchema,
} from '@nerima-games/mc-kernel'
import {
  CREEPER_LOCOMOTION,
  prepareShieldBlocking,
  pursueHorizontally,
  resolveHostileContacts,
  resolvePlayerBlastDamage,
  SHIELD_BLOCKING_DELAY_TICKS,
  SHIELD_DURABILITY_DAMAGE_THRESHOLD,
  SHIELD_HORIZONTAL_BLOCKING_HALF_ANGLE_DEGREES,
  ShieldBlockingPreparationSchema,
  ZOMBIE_KIND,
  ZOMBIE_LOCOMOTION,
  type HostileLocomotion,
} from '../src/domain/mob/hostile-combat'

const SHIELD_FIXTURE = {
  source: 'https://minecraft.wiki/w/Shield',
  edition: 'Java Edition 26.3',
} as const

const zombie = (x: number): Entity<undefined> => ({
  id: EntityId('zombie:1'),
  kind: ZOMBIE_KIND,
  feetPosition: atPosition(x, 64, 0),
  healthPoints: EntityHealthPoints(20),
  behaviour: undefined,
})

describe('hostile locomotion', () => {
  it('moves horizontally by at most speed * dt and preserves altitude', () => {
    expect(
      pursueHorizontally(
        atPosition(10, 70, 0 ),
        atPosition(0, 20, 0 ),
        0.5,
        ZOMBIE_LOCOMOTION,
      ),
    ).toStrictEqual(atPosition(8.85, 70, 0 ))
  })

  it('stops at the kind-specific engagement distance', () => {
    const target = atPosition(0, 64, 0 )
    expect(pursueHorizontally(atPosition(2, 64, 0 ), target, 1, CREEPER_LOCOMOTION)).toStrictEqual({
      x: 2,
      y: 64,
      z: 0,
    })
  })

  it('does not move without a target, with a non-finite dt, or with a non-positive dt', () => {
    const from = atPosition(5, 10, 5 )
    const target = atPosition(20, 10, 5 )
    expect(pursueHorizontally(from, undefined, 1, ZOMBIE_LOCOMOTION)).toStrictEqual(from)
    expect(pursueHorizontally(from, target, Number.NaN, ZOMBIE_LOCOMOTION)).toStrictEqual(from)
    expect(pursueHorizontally(from, target, 0, ZOMBIE_LOCOMOTION)).toStrictEqual(from)
    expect(pursueHorizontally(from, target, -1, ZOMBIE_LOCOMOTION)).toStrictEqual(from)
  })

  it('does not move when the locomotion has no speed to spend', () => {
    // `distanceMoved <= 0` is reachable only through the locomotion's own
    // numbers — `dt` and `distance` are already positive by this point — so a
    // stalled mob (speed zero) is the one caller that can produce it.
    const stalled: HostileLocomotion = { speedBlocksPerSecond: 0, stoppingDistanceBlocks: 1 }
    const from = atPosition(0, 10, 0 )
    expect(pursueHorizontally(from, atPosition(10, 10, 0 ), 1, stalled)).toStrictEqual(from)
  })
})

describe('player damage resolution', () => {
  it('emits zombie contact damage once per cooldown interval', () => {
    const target = atPosition(0, 64, 0 )
    const first = resolveHostileContacts([zombie(1)], target, 0.25, new Map())
    expect(first.damages).toHaveLength(1)
    expect(first.damages[0]).toMatchObject({
      _tag: 'HostileContact',
      source: 'zombie:1',
      kind: 'zombie',
      damage: { amount: 3, cause: 'mob' },
    })

    const cooling = resolveHostileContacts([zombie(1)], target, 0.5, first.cooldowns)
    expect(cooling.damages).toStrictEqual([])
    const ready = resolveHostileContacts([zombie(1)], target, 0.5, cooling.cooldowns)
    expect(ready.damages).toHaveLength(1)
  })

  it('without a target, no damage is emitted but a non-finite dt still leaves cooldowns untouched', () => {
    const cooldowns = new Map([[EntityId('zombie:9'), 0.5]])
    const result = resolveHostileContacts([zombie(1)], undefined, Number.NaN, cooldowns)
    expect(result.damages).toStrictEqual([])
    // `elapsed` fell back to zero, so nothing was subtracted from the
    // cooldown that was already ticking down.
    expect(result.cooldowns.get(EntityId('zombie:9'))).toBe(0.5)
  })

  it('attributes explosion damage to the detonating mob', () => {
    expect(
      resolvePlayerBlastDamage(
        [
          {
            source: EntityId('creeper:1'),
            kind: EntityKind('creeper'),
            at: atPosition(0, 64, 0 ),
            explosion: { source: 'creeper', power: 3 },
          },
        ],
        atPosition(2, 64, 0 ),
      ),
    ).toStrictEqual([
      {
        _tag: 'Explosion',
        source: 'creeper:1',
        kind: 'creeper',
        at: atPosition(0, 64, 0 ),
        explosion: { source: 'creeper', power: 3 },
        damage: { amount: 24, cause: 'explosion' },
      },
    ])
  })

  it('drops a blast whose damage falls off to zero at distance, rather than reporting a zero-amount event', () => {
    // The only prior blast test is close enough to always damage — the
    // `damage.amount > 0` filter's FALSE arm, a blast too far away to hurt at
    // all, had never fired.
    expect(
      resolvePlayerBlastDamage(
        [
          {
            source: EntityId('creeper:3'),
            kind: EntityKind('creeper'),
            at: atPosition(0, 64, 0 ),
            explosion: { source: 'creeper', power: 3 },
          },
        ],
        atPosition(100, 64, 0 ),
      ),
    ).toStrictEqual([])
  })

  it('returns no blast damage without a target', () => {
    expect(
      resolvePlayerBlastDamage(
        [
          {
            source: EntityId('creeper:2'),
            kind: EntityKind('creeper'),
            at: atPosition(0, 64, 0 ),
            explosion: { source: 'creeper', power: 3 },
          },
        ],
        undefined,
      ),
    ).toStrictEqual([])
  })
})

describe(`C2 shield blocking (${SHIELD_FIXTURE.source}, ${SHIELD_FIXTURE.edition})`, () => {
  const actor = EntityId('player:shield-owner')
  const attacker = EntityId('mob:shield-attacker')
  const dimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
  const tick = (value: number) => Schema.decodeUnknownSync(SimulationTickSchema)(value)
  const intent = { _tag: 'SetShieldBlocking', actor, blocking: true } as const
  const pose = { feetPosition: atPosition(0, 64, 0), yawRadians: 0, pitchRadians: 0 }
  const input = {
    tick: tick(15),
    dimension,
    pose,
    hasShield: true,
    current: { actor, raisedAt: tick(10) },
    incoming: {
      attacker,
      attackerPosition: Schema.decodeUnknownSync(WorldPositionSchema)({
        dimension,
        x: 0,
        y: 64,
        z: 2,
      }),
      kind: 'melee' as const,
      amount: 3.1,
    },
  }

  it('strictly prepares a front block at tick 5 and its 3 HP durability candidate', () => {
    expect(Result.isSuccess(Schema.decodeUnknownResult(IntentPayloadSchema)(intent))).toBe(true)
    expect(SHIELD_BLOCKING_DELAY_TICKS).toBe(5)
    expect(SHIELD_HORIZONTAL_BLOCKING_HALF_ANGLE_DEGREES).toBe(90)
    expect(SHIELD_DURABILITY_DAMAGE_THRESHOLD).toBe(3)
    const result = prepareShieldBlocking(intent, input)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isFailure(result)) return
    const decoded = Schema.decodeUnknownResult(ShieldBlockingPreparationSchema, {
      onExcessProperty: 'error',
    })(result.success)
    expect(Result.isSuccess(decoded)).toBe(true)
    expect(result.success).toMatchObject({
      actor,
      blocking: true,
      raisedAt: tick(10),
      blocked: true,
      blockedAmount: 3.1,
      durabilityDamage: 4,
      event: {
        _tag: 'ShieldBlocked',
        attacker,
        defender: actor,
        blockedAmount: 3.1,
      },
    })
  })

  it('requires the full delay and front-facing, and does not block piercing projectiles', () => {
    const delayed = prepareShieldBlocking(intent, { ...input, tick: tick(14) })
    const behind = prepareShieldBlocking(intent, {
      ...input,
      incoming: {
        ...input.incoming,
        attackerPosition: Schema.decodeUnknownSync(WorldPositionSchema)({
          dimension,
          x: 0,
          y: 64,
          z: -2,
        }),
      },
    })
    const piercing = prepareShieldBlocking(intent, {
      ...input,
      incoming: { ...input.incoming, kind: 'projectile', piercing: true },
    })

    expect(Result.isSuccess(delayed) && delayed.success.blocked).toBe(false)
    expect(Result.isSuccess(behind) && behind.success.blocked).toBe(false)
    expect(Result.isSuccess(piercing) && piercing.success.blocked).toBe(false)
  })

  it('includes the 90-degree side boundary and blocks supported explosions', () => {
    const side = prepareShieldBlocking(intent, {
      ...input,
      incoming: {
        ...input.incoming,
        attackerPosition: Schema.decodeUnknownSync(WorldPositionSchema)({
          dimension,
          x: 2,
          y: 64,
          z: 0,
        }),
        amount: 3,
      },
    })
    const explosion = prepareShieldBlocking(intent, {
      ...input,
      incoming: { ...input.incoming, kind: 'explosion' },
    })
    const belowDurabilityThreshold = prepareShieldBlocking(intent, {
      ...input,
      incoming: { ...input.incoming, amount: SHIELD_DURABILITY_DAMAGE_THRESHOLD - 0.1 },
    })

    expect(Result.isSuccess(side) && side.success).toMatchObject({ blocked: true, durabilityDamage: 3 })
    expect(Result.isSuccess(explosion) && explosion.success.blocked).toBe(true)
    expect(Result.isSuccess(belowDurabilityThreshold) && belowDurabilityThreshold.success).toMatchObject({
      blocked: true,
      durabilityDamage: 0,
    })
  })

  it('returns typed failure for invalid damage and leaves the caller state unchanged', () => {
    const malformed = { ...input, incoming: { ...input.incoming, amount: Number.NaN } }
    const snapshot = JSON.stringify(malformed)

    expect(Result.isFailure(prepareShieldBlocking(intent, malformed))).toBe(true)
    expect(JSON.stringify(malformed)).toBe(snapshot)
  })

  it('returns a typed failure or a strict finite result with nonnegative damage fields', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.double({ min: -1e12, max: 1e12, noNaN: false, noDefaultInfinity: false }),
        (amount) => {
          const candidate = { ...input, incoming: { ...input.incoming, amount } }
          const snapshot = JSON.stringify(candidate)
          const result = prepareShieldBlocking(intent, candidate)
          if (JSON.stringify(candidate) !== snapshot) return false
          if (Result.isFailure(result)) return true
          const decoded = Schema.decodeUnknownResult(ShieldBlockingPreparationSchema, {
            onExcessProperty: 'error',
          })(result.success)
          return Result.isSuccess(decoded) &&
            Number.isFinite(decoded.success.blockedAmount) &&
            Number.isFinite(decoded.success.durabilityDamage) &&
            decoded.success.blockedAmount >= 0 &&
            decoded.success.durabilityDamage >= 0
        },
      ),
      { numRuns: 250 },
    )
  })
})
