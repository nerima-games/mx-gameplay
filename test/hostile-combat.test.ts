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
  DAMAGE_IMMUNITY_TICKS,
  HOSTILE_CONTACT_INTERVAL_TICKS,
  HostileAttackPreparationSchema,
  prepareHostileAttack,
  prepareShieldBlocking,
  pursueHorizontally as pursueHorizontallyResult,
  resolveDamageWithInvulnerability,
  resolveHostileContacts,
  resolvePlayerBlastDamage as resolvePlayerBlastDamageResult,
  scaleHostileDamageForDifficulty,
  SHIELD_BLOCKING_DELAY_TICKS,
  SHIELD_DURABILITY_DAMAGE_THRESHOLD,
  SHIELD_HORIZONTAL_BLOCKING_HALF_ANGLE_DEGREES,
  ShieldBlockingPreparationSchema,
  ZOMBIE_KIND,
  ZOMBIE_LOCOMOTION,
  type HostileLocomotion,
} from '../src/domain/mob/hostile-combat'

const pursueHorizontally = (...args: Parameters<typeof pursueHorizontallyResult>) =>
  Result.getOrThrow(pursueHorizontallyResult(...args))
const resolvePlayerBlastDamage = (...args: Parameters<typeof resolvePlayerBlastDamageResult>) =>
  Result.getOrThrow(resolvePlayerBlastDamageResult(...args))

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

const simulationTick = (value: number) => Schema.decodeUnknownSync(SimulationTickSchema)(value)

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

  it('does not move without a target or at zero dt, and rejects invalid elapsed time', () => {
    const from = atPosition(5, 10, 5 )
    const target = atPosition(20, 10, 5 )
    expect(pursueHorizontally(from, undefined, 1, ZOMBIE_LOCOMOTION)).toStrictEqual(from)
    expect(pursueHorizontally(from, target, 0, ZOMBIE_LOCOMOTION)).toStrictEqual(from)
    expect(Result.isFailure(pursueHorizontallyResult(from, target, Number.NaN, ZOMBIE_LOCOMOTION))).toBe(true)
    expect(Result.isFailure(pursueHorizontallyResult(from, target, -1, ZOMBIE_LOCOMOTION))).toBe(true)
    expect(Result.isFailure(pursueHorizontallyResult(from, target, Number.POSITIVE_INFINITY, ZOMBIE_LOCOMOTION))).toBe(true)
  })

  it('property: only finite non-negative dt produces a movement result', () => {
    const dtInput = FastCheck.double({ noNaN: false, noDefaultInfinity: false })
    FastCheck.assert(FastCheck.property(dtInput, (dt) => {
      const result = pursueHorizontallyResult(
        atPosition(0, 64, 0),
        atPosition(10, 64, 0),
        dt,
        ZOMBIE_LOCOMOTION,
      )
      expect(Result.isFailure(result)).toBe(!Number.isFinite(dt) || dt < 0)
    }))
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
  it('holds hurt resistance through tick 9, expires at tick 10, and applies only a stronger-hit delta', () => {
    const previousState = { lastDamageTick: simulationTick(10), lastDamageAmount: 4 }
    const earlierTick = resolveDamageWithInvulnerability({
      tick: simulationTick(9),
      amount: 4,
      previousState,
    })
    const withinWindow = resolveDamageWithInvulnerability({
      tick: simulationTick(10 + DAMAGE_IMMUNITY_TICKS - 1),
      amount: 4,
      previousState,
    })
    const strongerHit = resolveDamageWithInvulnerability({
      tick: simulationTick(15),
      amount: 7,
      previousState,
    })
    const repeatedStrongerHit = Result.isFailure(strongerHit)
      ? strongerHit
      : resolveDamageWithInvulnerability({
          tick: simulationTick(16),
          amount: 7,
          previousState: strongerHit.success.state,
        })
    const windowExpired = Result.isFailure(repeatedStrongerHit)
      ? repeatedStrongerHit
      : resolveDamageWithInvulnerability({
          tick: simulationTick(10 + DAMAGE_IMMUNITY_TICKS),
          amount: 4,
          previousState: repeatedStrongerHit.success.state,
        })

    expect(DAMAGE_IMMUNITY_TICKS).toBe(10)
    expect(earlierTick).toStrictEqual(Result.fail('invalid-tick-order'))
    expect(Result.isSuccess(withinWindow) && withinWindow.success.appliedAmount).toBe(0)
    expect(Result.isSuccess(withinWindow) && withinWindow.success.state).toStrictEqual(previousState)
    expect(Result.isSuccess(strongerHit) && strongerHit.success.appliedAmount).toBe(3)
    expect(Result.isSuccess(strongerHit) && strongerHit.success.state).toStrictEqual({
      lastDamageTick: simulationTick(10),
      lastDamageAmount: 7,
    })
    expect(Result.isSuccess(repeatedStrongerHit) && repeatedStrongerHit.success.appliedAmount).toBe(0)
    expect(Result.isSuccess(repeatedStrongerHit) && repeatedStrongerHit.success.state).toStrictEqual({
      lastDamageTick: simulationTick(10),
      lastDamageAmount: 7,
    })
    expect(Result.isSuccess(windowExpired) && windowExpired.success.appliedAmount).toBe(4)
    expect(Result.isSuccess(windowExpired) && windowExpired.success.state).toStrictEqual({
      lastDamageTick: simulationTick(20),
      lastDamageAmount: 4,
    })
  })

  it('scales hostile damage for each difficulty, including the easy-mode cap boundary', () => {
    expect(scaleHostileDamageForDifficulty({ amount: 6, difficulty: 'peaceful' })).toStrictEqual(
      Result.succeed(0),
    )
    expect(scaleHostileDamageForDifficulty({ amount: 6, difficulty: 'easy' })).toStrictEqual(
      Result.succeed(4),
    )
    expect(scaleHostileDamageForDifficulty({ amount: 2, difficulty: 'easy' })).toStrictEqual(
      Result.succeed(2),
    )
    expect(scaleHostileDamageForDifficulty({ amount: 6, difficulty: 'normal' })).toStrictEqual(
      Result.succeed(6),
    )
    expect(scaleHostileDamageForDifficulty({ amount: 6, difficulty: 'hard' })).toStrictEqual(
      Result.succeed(9),
    )
    expect(scaleHostileDamageForDifficulty({ amount: Number.MAX_VALUE, difficulty: 'hard' })).toStrictEqual(
      Result.fail('invalid-result'),
    )
  })

  it('emits zombie contact damage once per 20-tick interval and suppresses same-tick replays', () => {
    const target = atPosition(0, 64, 0 )
    const first = Result.getOrThrow(resolveHostileContacts([zombie(1)], target, simulationTick(10), new Map()))
    expect(first.damages).toHaveLength(1)
    expect(first.damages[0]).toMatchObject({
      _tag: 'HostileContact',
      source: 'zombie:1',
      kind: 'zombie',
      damage: { amount: 3, cause: 'mob' },
    })
    expect(first.cooldowns.get(EntityId('zombie:1'))).toBe(simulationTick(10))

    const sameTickReplay = Result.getOrThrow(resolveHostileContacts(
      [zombie(1)], target, simulationTick(10), first.cooldowns,
    ))
    expect(sameTickReplay.damages).toStrictEqual([])
    expect(sameTickReplay.cooldowns.get(EntityId('zombie:1'))).toBe(simulationTick(10))

    const beforeInterval = Result.getOrThrow(resolveHostileContacts(
      [zombie(1)], target, simulationTick(10 + HOSTILE_CONTACT_INTERVAL_TICKS - 1), first.cooldowns,
    ))
    expect(beforeInterval.damages).toStrictEqual([])
    expect(beforeInterval.cooldowns.get(EntityId('zombie:1'))).toBe(simulationTick(10))

    const ready = Result.getOrThrow(resolveHostileContacts(
      [zombie(1)], target, simulationTick(10 + HOSTILE_CONTACT_INTERVAL_TICKS), first.cooldowns,
    ))
    expect(ready.damages).toHaveLength(1)
    expect(ready.cooldowns.get(EntityId('zombie:1'))).toBe(simulationTick(30))

    const peaceful = Result.getOrThrow(resolveHostileContacts(
      [zombie(1)], target, simulationTick(31), ready.cooldowns, 'peaceful',
    ))
    expect(peaceful.damages).toStrictEqual([])
    expect(peaceful.cooldowns.get(EntityId('zombie:1'))).toBe(simulationTick(30))
  })

  it('fails closed when the simulation tick moves behind a prior contact tick', () => {
    const cooldowns = new Map([[EntityId('zombie:9'), simulationTick(10)]])
    const result = resolveHostileContacts([zombie(1)], atPosition(0, 64, 0), simulationTick(9), cooldowns)

    expect(result).toStrictEqual(Result.fail('invalid-tick-order'))
  })

  it('rejects invalid current and prior contact ticks', () => {
    const invalidTick = -1 as unknown as ReturnType<typeof simulationTick>
    const invalidCurrent = resolveHostileContacts([zombie(1)], atPosition(0, 64, 0), invalidTick, new Map())
    const invalidPrevious = resolveHostileContacts(
      [zombie(1)],
      atPosition(0, 64, 0),
      simulationTick(10),
      new Map([[EntityId('zombie:9'), invalidTick]]),
    )

    expect(invalidCurrent).toStrictEqual(Result.fail('invalid-input'))
    expect(invalidPrevious).toStrictEqual(Result.fail('invalid-input'))
  })

  it('uses the default difficulty only when the argument is omitted', () => {
    const result = resolveHostileContacts(
      [zombie(1)],
      atPosition(0, 64, 0),
      simulationTick(10),
      new Map(),
      undefined as never,
    )

    expect(result).toStrictEqual(Result.fail('invalid-input'))
  })

  it('ignores non-zombies and zombies outside the contact range', () => {
    const target = atPosition(0, 64, 0)
    const skeleton = { ...zombie(1), id: EntityId('skeleton:1'), kind: EntityKind('skeleton') }
    const result = Result.getOrThrow(resolveHostileContacts(
      [skeleton, zombie(2)],
      target,
      simulationTick(10),
      new Map(),
    ))

    expect(result.damages).toStrictEqual([])
    expect(result.cooldowns).toStrictEqual(new Map())
  })

  it('without a target, no damage is emitted and an active tick cooldown is preserved', () => {
    const cooldowns = new Map([[EntityId('zombie:9'), simulationTick(10)]])
    const result = Result.getOrThrow(resolveHostileContacts(
      [zombie(1)], undefined, simulationTick(11), cooldowns,
    ))
    expect(result.damages).toStrictEqual([])
    expect(result.cooldowns.get(EntityId('zombie:9'))).toBe(simulationTick(10))
  })

  it('returns typed contact failures or schema-valid tick state for generated inputs', () => {
    const tickValue = FastCheck.oneof(
      FastCheck.integer({ min: 0, max: 50 }),
      FastCheck.integer({ min: -50, max: -1 }),
      FastCheck.constantFrom(1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1),
    )
    const isSimulationTick = (value: unknown): boolean =>
      Result.isSuccess(Schema.decodeUnknownResult(SimulationTickSchema)(value))

    FastCheck.assert(
      FastCheck.property(tickValue, FastCheck.boolean(), tickValue, (currentValue, hasPrevious, previousValue) => {
        const zombieId = EntityId('zombie:1')
        const currentTick = currentValue as unknown as ReturnType<typeof simulationTick>
        const previousTick = previousValue as unknown as ReturnType<typeof simulationTick>
        const previousCooldowns = hasPrevious
          ? new Map([[zombieId, previousTick]])
          : new Map()
        const result = resolveHostileContacts(
          [zombie(1)],
          atPosition(0, 64, 0),
          currentTick,
          previousCooldowns,
        )

        const validCurrent = isSimulationTick(currentValue)
        const validPrevious = !hasPrevious || isSimulationTick(previousValue)
        const validOrder = !hasPrevious || currentValue >= previousValue
        if (!validCurrent || !validPrevious || !validOrder) {
          const expectedFailure = validCurrent && validPrevious
            ? 'invalid-tick-order'
            : 'invalid-input'
          return Result.isFailure(result) && result.failure === expectedFailure
        }
        if (Result.isFailure(result)) return false

        const previousIsActive = hasPrevious && currentValue - previousValue < HOSTILE_CONTACT_INTERVAL_TICKS
        const expectedContactTick = previousIsActive ? previousTick : currentTick
        const expectedDamageCount = previousIsActive ? 0 : 1
        if (result.success.damages.length !== expectedDamageCount) return false
        const savedTick = result.success.cooldowns.get(zombieId)
        return savedTick === expectedContactTick &&
          [...result.success.cooldowns.values()].every((saved) =>
            isSimulationTick(saved) && Number.isSafeInteger(saved) && saved >= 0,
          )
      }),
      { numRuns: 250 },
    )
  })

  it('attributes explosion damage to the detonating mob', () => {
    const blast = {
      source: EntityId('creeper:1'),
      kind: EntityKind('creeper'),
      at: atPosition(0, 64, 0 ),
      explosion: { source: 'creeper' as const, power: 3 },
    }
    const target = atPosition(2, 64, 0 )
    expect(resolvePlayerBlastDamage([blast], target)).toStrictEqual([
      {
        _tag: 'Explosion',
        source: 'creeper:1',
        kind: 'creeper',
        at: atPosition(0, 64, 0 ),
        explosion: { source: 'creeper', power: 3 },
        damage: { amount: 24, cause: 'explosion' },
      },
    ])
    expect(resolvePlayerBlastDamage([blast], target, 'peaceful')).toStrictEqual([])
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

  it('rejects non-finite target coordinates instead of treating them as zero damage', () => {
    const blast = {
      source: EntityId('creeper:4'),
      kind: EntityKind('creeper'),
      at: atPosition(0, 64, 0),
      explosion: { source: 'creeper' as const, power: 3 },
    }
    const target = { x: Number.NaN, y: 64, z: 0 } as unknown as ReturnType<typeof atPosition>
    expect(Result.isFailure(resolvePlayerBlastDamageResult([blast], target))).toBe(true)
    expect(Result.isFailure(resolvePlayerBlastDamageResult([blast], atPosition(0, 64, 0), 'invalid' as never))).toBe(true)
    expect(Result.isFailure(resolvePlayerBlastDamageResult([blast], atPosition(0, 64, 0), undefined as never))).toBe(true)
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
  const hostileAttackInput = {
    tick: tick(15),
    dimension,
    pose,
    hasShield: true,
    currentShield: input.current,
    incoming: input.incoming,
    difficulty: 'normal' as const,
    damageState: null,
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

  it('composes difficulty scaling with shield blocking and incoming damage', () => {
    const commonInput = {
      tick: tick(15),
      dimension,
      pose,
      hasShield: true,
      currentShield: input.current,
      incoming: { ...input.incoming, amount: 6 },
      difficulty: 'easy' as const,
      damageState: null,
    }
    const blocked = prepareHostileAttack(intent, commonInput)
    const unblocked = prepareHostileAttack(
      { ...intent, blocking: false },
      { ...commonInput, hasShield: false, currentShield: null },
    )

    expect(Result.isSuccess(blocked)).toBe(true)
    expect(Result.isSuccess(unblocked)).toBe(true)
    if (Result.isFailure(blocked) || Result.isFailure(unblocked)) return

    const decodedBlocked = Schema.decodeUnknownResult(HostileAttackPreparationSchema)(blocked.success)
    const decodedUnblocked = Schema.decodeUnknownResult(HostileAttackPreparationSchema)(unblocked.success)
    expect(Result.isSuccess(decodedBlocked)).toBe(true)
    expect(Result.isSuccess(decodedUnblocked)).toBe(true)
    expect(blocked.success).toMatchObject({
      shield: { blocked: true, blockedAmount: 4, durabilityDamage: 4 },
      appliedAmount: 0,
      damageState: null,
    })
    expect(unblocked.success).toMatchObject({
      shield: { blocked: false, blockedAmount: 0 },
      appliedAmount: 4,
      damageState: { lastDamageTick: tick(15), lastDamageAmount: 4 },
    })
  })

  it('rejects malformed hostile attack state and propagates preparation failures', () => {
    const invalidInput = prepareHostileAttack(intent, { ...hostileAttackInput, tick: -1 })
    const futureDamageState = prepareHostileAttack(intent, {
      ...hostileAttackInput,
      damageState: { lastDamageTick: tick(16), lastDamageAmount: 4 },
    })
    const priorDamageState = prepareHostileAttack(
      { ...intent, blocking: false },
      {
        ...hostileAttackInput,
        hasShield: false,
        currentShield: null,
        damageState: { lastDamageTick: tick(10), lastDamageAmount: 4 },
      },
    )
    const invalidAttack = prepareHostileAttack(
      { ...intent, blocking: false },
      {
        ...hostileAttackInput,
        hasShield: false,
        currentShield: null,
        difficulty: 'hard',
        incoming: { ...input.incoming, amount: Number.MAX_VALUE },
      },
    )
    const invalidShield = prepareHostileAttack(intent, {
      ...hostileAttackInput,
      hasShield: false,
      currentShield: null,
    })

    expect(invalidInput).toStrictEqual(Result.fail('invalid-input'))
    expect(futureDamageState).toStrictEqual(Result.fail('invalid-damage-state'))
    expect(Result.isSuccess(priorDamageState) && priorDamageState.success).toMatchObject({
      appliedAmount: 0,
      damageState: { lastDamageTick: tick(10), lastDamageAmount: 4 },
    })
    expect(invalidAttack).toStrictEqual(Result.fail('invalid-attack'))
    expect(invalidShield).toStrictEqual(Result.fail('invalid-shield-state'))
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

  it('starts the delay on the first blocking intent and clears state when lowered', () => {
    const noCurrentAttack = {
      tick: tick(20),
      dimension,
      pose,
      hasShield: true,
      current: null,
    }
    const raised = prepareShieldBlocking(intent, noCurrentAttack)
    const lowered = prepareShieldBlocking({ ...intent, blocking: false }, noCurrentAttack)

    expect(Result.isSuccess(raised) && raised.success).toMatchObject({
      blocking: true,
      raisedAt: tick(20),
      blocked: false,
      event: null,
    })
    expect(Result.isSuccess(lowered) && lowered.success).toMatchObject({
      blocking: false,
      raisedAt: null,
      blocked: false,
      event: null,
    })
  })

  it('rejects malformed intent/state, actor changes, earlier ticks, and a missing shield', () => {
    const malformedIntent = prepareShieldBlocking({ _tag: 'MeleeAttack', actor } as never, input)
    const malformedState = prepareShieldBlocking(intent, {
      ...input,
      current: { actor, raisedAt: -1 as ReturnType<typeof tick> },
    })
    const actorChanged = prepareShieldBlocking(intent, {
      ...input,
      current: { actor: EntityId('another-player'), raisedAt: tick(10) },
    })
    const earlierTick = prepareShieldBlocking(intent, { ...input, tick: tick(9) })
    const noShield = prepareShieldBlocking(intent, { ...input, current: null, hasShield: false })

    expect(Result.isFailure(malformedIntent) && malformedIntent.failure).toBe('invalid-intent')
    expect(Result.isFailure(malformedState) && malformedState.failure).toBe('invalid-authoritative-state')
    expect(Result.isFailure(actorChanged) && actorChanged.failure).toBe('invalid-authoritative-state')
    expect(Result.isFailure(earlierTick) && earlierTick.failure).toBe('invalid-tick-order')
    expect(Result.isFailure(noShield) && noShield.failure).toBe('shield-not-equipped')
  })

  it('rejects self and cross-dimension attacks, and refuses overflowing geometry', () => {
    const selfAttack = prepareShieldBlocking(intent, {
      ...input,
      incoming: { ...input.incoming, attacker: actor },
    })
    const crossDimension = prepareShieldBlocking(intent, {
      ...input,
      incoming: {
        ...input.incoming,
        attackerPosition: Schema.decodeUnknownSync(WorldPositionSchema)({
          dimension: Schema.decodeUnknownSync(DimensionIdSchema)('nether'),
          x: 0,
          y: 64,
          z: 2,
        }),
      },
    })
    const overflow = prepareShieldBlocking(intent, {
      ...input,
      pose: {
        ...pose,
        feetPosition: { x: -Number.MAX_VALUE, y: 64, z: 0 } as typeof pose.feetPosition,
      },
      incoming: {
        ...input.incoming,
        attackerPosition: Schema.decodeUnknownSync(WorldPositionSchema)({
          dimension,
          x: Number.MAX_VALUE,
          y: 64,
          z: 2,
        }),
      },
    })

    expect(Result.isFailure(selfAttack) && selfAttack.failure).toBe('invalid-attack')
    expect(Result.isFailure(crossDimension) && crossDimension.failure).toBe('invalid-attack')
    expect(Result.isFailure(overflow) && overflow.failure).toBe('invalid-attack')
  })

  it('does not treat a coincident attacker as a front-facing block', () => {
    const coincident = prepareShieldBlocking(intent, {
      ...input,
      incoming: {
        ...input.incoming,
        attackerPosition: Schema.decodeUnknownSync(WorldPositionSchema)({
          dimension,
          x: 0,
          y: 64,
          z: 0,
        }),
      },
    })

    expect(Result.isSuccess(coincident) && coincident.success).toMatchObject({
      blocked: false,
      blockedAmount: 0,
      event: null,
    })
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
