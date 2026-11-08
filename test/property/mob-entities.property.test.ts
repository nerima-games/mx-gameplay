import { describe, expect, it } from '@effect/vitest'
import fc from 'fast-check'
import { Effect, Result, Schema } from 'effect'
import {
  AngleRadians,
  DeltaTimeSecs,
  DimensionIdSchema,
  DimensionRevisionSchema,
  EntityHealthPoints,
  EntityIdSchema,
  ENTITY_TYPES,
  PositionAxis,
  ProjectileIdSchema,
  SimulationTick,
  SimulationTickSchema,
  StackCount,
  WorldRevisionSchema,
  ITEM_TYPES,
  itemStack,
  position as makePosition,
  type Position,
} from '@nerima-games/mc-kernel'
import {
  ARROW_PROFILE,
  DESPAWNED,
  EntityId,
  EntityKind,
  ProjectileServiceFailure,
  SPAWN_VITALS,
  UNCHANGED,
  emptyPlayerStorage,
  type ProjectileLaunchOutcome,
  type ProjectileLaunchRequest,
  type ProjectileServiceError,
  type ProjectileStepOutcome,
  type ProjectileStepRequest,
} from '@nerima-games/mc-sim'
import { drawRolls } from '../../src/domain/frame-rolls'
import { emptySlots } from '../../src/domain/in-memory-inventory'
import {
  createDroppedItemLifetimeTracker,
  DROPPED_ITEM_LIFETIME_SECS,
  planDroppedItemPickup,
  type DroppedItemOwnerSnapshot,
} from '../../src/domain/entities/dropped-item'
import { makeProjectileRuntime } from '../../src/domain/entities/projectile-runtime'
import {
  experienceOfCasualties,
  MOB_EXPERIENCE_CREDIT_WINDOW_TICKS,
  rollCasualtyDrops,
  type MobCasualty,
} from '../../src/domain/entities/mob-frame'
import { planExperienceOrbAbsorption, createExperienceOrbValue } from '../../src/domain/entities/xp-orb'
import { makeInMemoryEntityManager as createEntityManager } from '../../src/domain/in-memory-entity-manager'
import {
  dropPasses,
  MOB_DROP_TABLES,
  MOB_EXPERIENCE_RULES,
  mobXpReward,
  rollMobTable,
  rollMobDrop,
  type DropRolls,
  type MobDropRule,
} from '../../src/domain/mob/mob-drop'
import { ZOMBIE_KIND } from '../../src/domain/mob/hostile-combat'
import { dropRollsNeeded } from '../../src/domain/entities/mob-frame'
import { COW_KIND } from '../../src/domain/mob/mob-ecosystem'

const position = (x: number, y: number, z: number): Position =>
  makePosition(PositionAxis(x), PositionAxis(y), PositionAxis(z))

const ORIGIN = position(0, 64, 0)
const normalizedRoll = fc.double({ min: 0, max: 0.999_999_999, noNaN: true })

const launchRequest = (serial: number, tick: number, revision: number): ProjectileLaunchRequest => ({
  projectileId: Schema.decodeUnknownSync(ProjectileIdSchema)(`property-arrow-${String(serial)}`),
  dimension: Schema.decodeUnknownSync(DimensionIdSchema)('overworld'),
  shooter: Schema.decodeUnknownSync(EntityIdSchema)('property-player'),
  tick: Schema.decodeUnknownSync(SimulationTickSchema)(tick),
  expectedRevision: Schema.decodeUnknownSync(WorldRevisionSchema)(revision),
  expectedDimensionRevision: Schema.decodeUnknownSync(DimensionRevisionSchema)(revision),
  kind: 'projectile',
  position: position(0, 1.6, 0),
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: 1 as ProjectileLaunchRequest['speed'],
  profile: ARROW_PROFILE,
})

const stepRequest = (launch: ProjectileLaunchRequest): ProjectileStepRequest => ({
  projectileId: launch.projectileId,
  tick: launch.tick,
  expectedRevision: launch.expectedRevision,
  expectedDimensionRevision: launch.expectedDimensionRevision,
  deltaTime: DeltaTimeSecs(0.05),
  world: {
    blockBounds: () => [],
    entities: [],
    isInWater: () => false,
    bounds: {
      minX: PositionAxis(-16),
      minY: PositionAxis(-16),
      minZ: PositionAxis(-16),
      maxX: PositionAxis(16),
      maxY: PositionAxis(16),
      maxZ: PositionAxis(16),
    },
  },
  blockAddressOfHit: () => undefined,
})

describe('mob entity properties', () => {
  it('forwards generated projectile requests and preserves service effects', () => {
    // Catches a runtime adapter that changes a request, calls the service twice, or replaces its result.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (serial, tick, revision) => {
          const launch = launchRequest(serial, tick, revision)
          const step = stepRequest(launch)
          const launchEffect = Effect.fail(new ProjectileServiceFailure({ reason: 'invalid-launch' }))
          const stepEffect = Effect.fail(new ProjectileServiceFailure({ reason: 'unknown-projectile' }))
          let receivedLaunch: ProjectileLaunchRequest | undefined
          let receivedStep: ProjectileStepRequest | undefined
          let launchCalls = 0
          let stepCalls = 0
          const runtime = makeProjectileRuntime({
            launch: (request): Effect.Effect<ProjectileLaunchOutcome, ProjectileServiceError> => {
              launchCalls += 1
              receivedLaunch = request
              return launchEffect
            },
            step: (request): Effect.Effect<ProjectileStepOutcome, ProjectileServiceError> => {
              stepCalls += 1
              receivedStep = request
              return stepEffect
            },
          })

          expect(runtime.launch(launch)).toBe(launchEffect)
          expect(runtime.step(step)).toBe(stepEffect)
          expect(receivedLaunch).toBe(launch)
          expect(receivedStep).toBe(step)
          expect(launchCalls).toBe(1)
          expect(stepCalls).toBe(1)
        },
      ),
    )
  })

  it('keeps frame roll batches composable and within the unit interval', () => {
    // Catches skipped or extra generator steps when a frame splits its roll budget.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_147_483_646 }),
        fc.integer({ min: 0, max: 32 }),
        fc.integer({ min: 0, max: 32 }),
        (seed, firstCount, secondCount) => {
          const whole = drawRolls(seed, firstCount + secondCount)
          const first = drawRolls(seed, firstCount)
          const second = drawRolls(first.seed, secondCount)

          expect([...first.rolls, ...second.rolls]).toStrictEqual(whole.rolls)
          expect(second.seed).toBe(whole.seed)
          expect(whole.rolls).toHaveLength(firstCount + secondCount)
          expect(whole.rolls.every((roll) => roll >= 0 && roll < 1)).toBe(true)
        },
      ),
    )
  })

  it('advances mob loot seed only for casualty drop budgets', () => {
    // Catches loot draws inside ordinary mob sweeps or a per-casualty budget off by one.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_147_483_646 }),
        fc.integer({ min: 0, max: 12 }),
        (seed, casualtyCount) => {
          const casualties: ReadonlyArray<MobCasualty> = Array.from(
            { length: casualtyCount },
            (_, index) => ({
              id: EntityId(`property-zombie-${String(index)}`),
              kind: ZOMBIE_KIND,
              at: ORIGIN,
            }),
          )
          const rolled = rollCasualtyDrops(casualties, seed)
          const expectedSeed = drawRolls(
            seed,
            casualtyCount * dropRollsNeeded(ZOMBIE_KIND),
          ).seed

          expect(rolled.seed).toBe(expectedSeed)
          expect(rolled.drops.every((drop) => drop.count >= 1 && drop.count <= 2)).toBe(true)
          expect(rolled.drops.every((drop) => casualties.some(({ id }) => id === drop.source))).toBe(true)
        },
      ),
    )
  })

  it('keeps mob drop chances strict and the count roll monotone', () => {
    // Catches an inclusive chance boundary or a count outside its declared range.
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 0, max: 5 }),
        normalizedRoll,
        normalizedRoll,
        (chance, baseCount, spread, lootingLevel, firstCountRoll, secondCountRoll) => {
          const countRule: MobDropRule = {
            item: 'rotten_flesh',
            count: baseCount,
            maxCount: baseCount + spread,
          }
          const rule: MobDropRule = { ...countRule, chance }
          const lowRoll = Math.min(firstCountRoll, secondCountRoll)
          const highRoll = Math.max(firstCountRoll, secondCountRoll)
          const withoutLooting = rollMobDrop(
            countRule,
            { _tag: 'Slain', lootingLevel: 0 },
            { chance: 0, count: lowRoll },
          )
          const withLooting = rollMobDrop(
            countRule,
            { _tag: 'Slain', lootingLevel },
            { chance: 0, count: lowRoll },
          )
          const highCount = rollMobDrop(
            countRule,
            { _tag: 'Slain', lootingLevel },
            { chance: 0, count: highRoll },
          )
          const rolls: DropRolls = { chance: 0, count: lowRoll }

          expect(dropPasses(rule, chance)).toBe(false)
          expect(dropPasses(rule, chance - Math.min(chance / 2, 1e-6))).toBe(true)
          expect(withoutLooting).toBeDefined()
          expect(withLooting).toBeDefined()
          expect(highCount).toBeDefined()
          expect(withoutLooting!.count).toBeGreaterThanOrEqual(baseCount)
          expect(withoutLooting!.count).toBeLessThanOrEqual(baseCount + spread)
          expect(withLooting!.count).toBe(withoutLooting!.count)
          expect(highCount!.count).toBeGreaterThanOrEqual(withLooting!.count)
          expect(rollMobDrop(rule, { _tag: 'SelfDestruct' }, rolls)).toBeUndefined()
          expect(mobXpReward({ _tag: 'Slain', lootingLevel }, 10)).toBe(10)
          expect(mobXpReward({ _tag: 'SelfDestruct' }, 10)).toBe(0)
        },
      ),
    )
  })

  it('rolls every kernel mob table with valid item IDs and in-range counts', () => {
    const kinds = Object.keys(MOB_DROP_TABLES)
    fc.assert(
      fc.property(
        fc.constantFrom(...kinds),
        fc.array(normalizedRoll, { maxLength: 32 }),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom('adult' as const, 'baby' as const),
        fc.constantFrom('small' as const, 'medium' as const, 'large' as const),
        fc.integer({ min: 0, max: 5 }),
        (kind, rolls, playerKill, burning, age, size, lootingLevel) => {
          const table = MOB_DROP_TABLES[kind]
          if (table === undefined) throw new Error(`Missing mob drop table for ${kind}`)
          expect(table).toBeDefined()
          if (table === undefined) return

          const drops = rollMobTable(table, {
            _tag: 'Slain',
            lootingLevel,
            playerKill,
            burning,
            age,
            size,
          }, rolls)
          const candidates = [
            ...table.rules.map((rule) => ({
              item: rule.item,
              burningItem: rule.burningItem,
              count: rule.count,
              maxCount: rule.maxCount,
            })),
            ...(table.pools ?? []).flatMap((pool) => pool.choices.map((choice) => ({
              item: choice.item,
              burningItem: choice.burningItem,
              count: choice.count,
              maxCount: choice.maxCount,
            }))),
          ]

          expect(drops.every((drop) => ITEM_TYPES.includes(drop.item))).toBe(true)
          for (const drop of drops) {
            const matching = candidates.filter((candidate) =>
              candidate.item === drop.item || candidate.burningItem === drop.item,
            )
            expect(matching.some((candidate) =>
              drop.count >= candidate.count && drop.count <= (candidate.maxCount ?? candidate.count),
            )).toBe(true)
          }
        },
      ),
    )
    expect(kinds).toHaveLength(81)
    expect(kinds.every((kind) => ENTITY_TYPES.includes(kind as typeof ENTITY_TYPES[number]))).toBe(true)
  })

  it('resolves XP rolls within each adult, baby, and size range', () => {
    const kinds = Object.keys(MOB_EXPERIENCE_RULES)
    fc.assert(
      fc.property(
        fc.constantFrom(...kinds),
        normalizedRoll,
        fc.constantFrom('adult' as const, 'baby' as const),
        fc.constantFrom('small' as const, 'medium' as const, 'large' as const),
        (kind, roll, age, size) => {
          const rule = MOB_EXPERIENCE_RULES[kind]
          if (rule === undefined) throw new Error(`Missing mob experience rule for ${kind}`)
          const range = rule.sizes?.[size] ?? (age === 'baby' ? rule.baby : undefined) ?? rule.adult
          const amount = mobXpReward(
            { _tag: 'Slain', lootingLevel: 0 },
            rule,
            roll,
            { age, size },
          )
          expect(amount).toBeGreaterThanOrEqual(range.min)
          expect(amount).toBeLessThanOrEqual(range.max)
        },
      ),
    )
  })

  it('conserves dropped item counts across eligible and partial pickups', () => {
    // Catches consuming an unaccepted stack, losing a leftover, or picking before its eligible frame.
    // At storedBefore=0, every slot is full stone; that inventory cannot accept gunpowder.
    // Only a pre-existing gunpowder stack has capacity in this fixture.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 63 }),
        fc.integer({ min: 1, max: 64 }),
        fc.boolean(),
        fc.boolean(),
        (storedBefore, dropCount, withinRadius, eligible) => {
          const emptyStorage = emptyPlayerStorage()
          const slots = emptySlots().map(() =>
            Result.getOrThrow(itemStack('stone', StackCount(64))),
          )
          if (storedBefore > 0) {
            slots[0] = Result.getOrThrow(itemStack('gunpowder', StackCount(storedBefore)))
          }
          const playerStorage = { ...emptyStorage, inventory: { slots } }
          const drop: DroppedItemOwnerSnapshot = {
            items: [{
              id: EntityId('property-ground-gunpowder'),
              feetPosition: ORIGIN,
              behaviour: {
                _tag: 'DroppedItem',
                item: 'gunpowder',
                count: StackCount(dropCount),
                durability: null,
                eligibleFromFrame: eligible ? 5 : 6,
              },
            }],
          }
          const plan = Effect.runSync(planDroppedItemPickup({
            actor: EntityId('property-player'),
            tick: 0,
            position: position(withinRadius ? 1.5 : 1.500_001, 64, 0),
            radius: 1.5,
            currentFrame: 5,
          }, playerStorage, drop))
          const storedAfter = plan.playerStorage.inventory.slots.reduce(
            (total, slot) => total + (slot?.item === 'gunpowder' ? slot.count : 0),
            0,
          )
          const leftover = plan.droppedItems.items.reduce(
            (total, item) => total + item.behaviour.count,
            0,
          )
          const available = storedBefore === 0 ? 0 : 64 - storedBefore
          const collected = withinRadius && eligible ? Math.min(dropCount, available) : 0

          expect(storedAfter - storedBefore + leftover).toBe(dropCount)
          expect(storedAfter - storedBefore).toBe(collected)
        },
      ),
      { examples: [[0, 1, true, true]] },
    )
  })

  it('expires a dropped item at its exact remaining lifetime', () => {
    // Catches changing the inclusive expiry boundary or retaining an expired id.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: DROPPED_ITEM_LIFETIME_SECS }),
        (remainingSecs) => {
          const tracker = createDroppedItemLifetimeTracker()
          tracker.restore('overworld', [{
            entityId: 'property-expiring-drop',
            elapsedSecs: DROPPED_ITEM_LIFETIME_SECS - remainingSecs,
          }])

          expect(tracker.advance('overworld', remainingSecs - 1, ['property-expiring-drop'])).toStrictEqual([])
          expect(tracker.elapsed('overworld', 'property-expiring-drop')).toBe(DROPPED_ITEM_LIFETIME_SECS - 1)
          expect(tracker.advance('overworld', 1, ['property-expiring-drop'])).toStrictEqual(['property-expiring-drop'])
          expect(tracker.elapsed('overworld', 'property-expiring-drop')).toBe(0)
        },
      ),
    )
  })

  it('adds exactly the absorbed XP and leaves every other orb', () => {
    // Catches awarding the wrong orb value or consuming a neighboring orb during absorption.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), (amount) => {
        const orbId = EntityId('property-xp-orb')
        const otherOrbId = EntityId('property-other-xp-orb')
        const orb = Result.getOrThrow(createExperienceOrbValue(amount))
        const otherOrb = Result.getOrThrow(createExperienceOrbValue(7))
        const plan = Effect.runSync(planExperienceOrbAbsorption(
          {
            actor: EntityId('property-player'),
            orb: orbId,
            tick: 0,
            position: { dimension: 'overworld', x: 0, y: 64, z: 0 },
          },
          { vitals: SPAWN_VITALS },
          { orbs: [{ id: orbId, value: orb }, { id: otherOrbId, value: otherOrb }] },
        ))

        expect(plan.vitals.vitals.totalExperience).toBe(SPAWN_VITALS.totalExperience + amount)
        expect(plan.orbs.orbs.map(({ id }) => id)).toStrictEqual([otherOrbId])
      }),
    )
  })

  it('mints unique IDs for generated spawn sequences', () => {
    // Catches a serial that repeats or an ID scheme that collides across entity kinds.
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('zombie', 'creeper', 'cow'), { minLength: 1, maxLength: 32 }),
        (kinds) => {
          const roster = Effect.runSync(createEntityManager<undefined>())
          const spawned = kinds.map((kind) => Effect.runSync(roster.spawn({
            kind: EntityKind(kind),
            feetPosition: ORIGIN,
            healthPoints: EntityHealthPoints(20),
            behaviour: undefined,
          })))
          const entities = Effect.runSync(roster.entities)
          const ids = entities.map(({ id }) => id)

          expect(new Set(ids).size).toBe(kinds.length)
          expect(ids).toStrictEqual(spawned.map(({ id }) => id))
          expect(Number(Effect.runSync(roster.count))).toBe(kinds.length)
        },
      ),
    )
  })

  it('applies generated sweep transitions without changing entity identity or kind', () => {
    // Catches sweep transitions that drop survivors or let a changed step rewrite identity fields.
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('unchanged', 'changed', 'despawned'), { maxLength: 16 }),
        (generatedModes) => {
          const modes = ['unchanged', 'changed', 'despawned', ...generatedModes] as const
          const roster = Effect.runSync(createEntityManager<undefined>())
          const spawned = modes.map((_, index) => Effect.runSync(roster.spawn({
            kind: EntityKind(index % 2 === 0 ? 'zombie' : 'creeper'),
            feetPosition: position(index, 64, 0),
            healthPoints: EntityHealthPoints(20),
            behaviour: undefined,
          })))
          const modeById = new Map(spawned.map((entity, index) => [entity.id, modes[index]]))

          Effect.runSync(roster.sweep((entity) => {
            const mode = modeById.get(entity.id)
            if (mode === 'despawned') return { transition: DESPAWNED, emit: undefined }
            if (mode === 'changed') {
              return {
                transition: {
                  _tag: 'Changed' as const,
                  state: {
                    feetPosition: entity.feetPosition,
                    healthPoints: EntityHealthPoints(entity.healthPoints - 1),
                    behaviour: undefined,
                  },
                },
                emit: undefined,
              }
            }
            return { transition: UNCHANGED, emit: undefined }
          }))

          const after = Effect.runSync(roster.entities)
          const survivors = spawned.filter((_, index) => modes[index] !== 'despawned')
          expect(after.map(({ id }) => id)).toStrictEqual(survivors.map(({ id }) => id))
          for (const [index, before] of spawned.entries()) {
            const mode = modes[index]
            const current = after.find(({ id }) => id === before.id)
            if (mode === 'despawned') {
              expect(current).toBeUndefined()
            } else {
              expect(current?.kind).toBe(before.kind)
              expect(current?.healthPoints).toBe(before.healthPoints - (mode === 'changed' ? 1 : 0))
              if (mode === 'unchanged') expect(current).toBe(before)
            }
          }
        },
      ),
    )
  })

  it('credits player kills only through the inclusive recent-hit window', () => {
    // Catches an off-by-one XP credit window or awarding XP to an uncredited casualty.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MOB_EXPERIENCE_CREDIT_WINDOW_TICKS + 10 }),
        (age) => {
          const casualty: MobCasualty = {
            id: EntityId('property-zombie-casualty'),
            kind: ZOMBIE_KIND,
            at: ORIGIN,
            killCredit: 'player',
            lastHitTick: SimulationTick(0),
            deathTick: SimulationTick(age),
          }
          const experience = experienceOfCasualties([casualty])
          const uncreditedCasualty: MobCasualty = {
            id: casualty.id,
            kind: casualty.kind,
            at: casualty.at,
            lastHitTick: SimulationTick(0),
            deathTick: SimulationTick(age),
          }

          expect(experience.length).toBe(age <= MOB_EXPERIENCE_CREDIT_WINDOW_TICKS ? 1 : 0)
          if (age <= MOB_EXPERIENCE_CREDIT_WINDOW_TICKS) {
            expect(experience[0]?.amount).toBe(5)
          }
          expect(experienceOfCasualties([uncreditedCasualty])).toStrictEqual([])
        },
      ),
    )
  })

  it('keeps the recorded roll count tied to each mob drop table', () => {
    // Catches a frame budget that spends too few or too many rolls for a casualty's loot table.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_147_483_646 }),
        fc.integer({ min: 0, max: 12 }),
        (seed, casualtyCount) => {
          const casualtyKinds = Array.from({ length: casualtyCount }, (_, index) =>
            index % 2 === 0 ? ZOMBIE_KIND : COW_KIND)
          const casualties: ReadonlyArray<MobCasualty> = casualtyKinds.map((kind, index) => ({
            id: EntityId(`property-mob-${String(index)}`),
            kind,
            at: ORIGIN,
          }))
          const expectedRollCount = casualtyKinds.reduce(
            (total, kind) => total + dropRollsNeeded(kind),
            0,
          )

          expect(rollCasualtyDrops(casualties, seed).seed).toBe(drawRolls(seed, expectedRollCount).seed)
        },
      ),
    )
  })
})
