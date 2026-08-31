/**
 * `domain/entities/mob-frame.ts` — the frame-level half of the mob rules.
 *
 * ---------------------------------------------------------------------------
 * What is here and what is not
 * ---------------------------------------------------------------------------
 *
 * `test/mob.test.ts` owns the RULES in `domain/mob/`: the fuse, the curve, the
 * teleport band, the despawn distance, each pinned against the reference's own
 * oracle. `test/vertical-slice.test.ts` owns the WIRING: a creeper's blast
 * reaching an enderman two stages later, across a frame boundary.
 *
 * This file owns the layer between them — the functions in
 * `domain/entities/mob-frame.ts` that turn a rule into a roster operation. They
 * were reachable from the slice, which is why they worked, but the slice can
 * only ask about the frames it builds: it has never run a blast that MISSED,
 * never asked what an empty blast list costs, and never asked what a creeper's
 * fuse looks like after it survives one. Each of those is a decision this file
 * makes explicitly and none of them had an assertion.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import type { Position } from '@nerima-games/mc-kernel'
import {
  CREEPER_KIND,
  CREEPER_MAX_HEALTH,
  DROPPED_ITEM_KIND,
  dropRollsNeeded,
  dropRulesOfKind,
  ENDERMAN_KIND,
  ENDERMAN_MAX_HEALTH,
  experienceOfCasualties,
  hostileMobSnapshot,
  HOSTILE_KINDS,
  PRIMED_TNT_KIND,
  repairMobBehaviour,
  resolveBlasts,
  resolveEndermanTeleportProbes,
  resolveMeleeHits,
  rollCasualtyDrops,
  STEADY_ENDERMAN,
  STRUCK_ENDERMAN,
  sweepMobs,
  type Blast,
  type DroppedItemBehaviour,
  type EndermanTeleportProbe,
  type MobBehaviour,
  type MobCasualty,
  xpRewardOfKind,
} from '../src/domain/entities/mob-frame'
import {
  BLAZE_DROPS,
  BLAZE_XP_REWARD,
  CREEPER_DROPS,
  ENDERMAN_DROPS,
  ENDERMAN_XP_REWARD,
  ZOMBIE_DROPS,
  ZOMBIE_XP_REWARD,
} from '../src/domain/mob/mob-drop'
import { BLAZE_KIND, initialEcosystemMobState } from '../src/domain/mob/mob-ecosystem'
import { CREEPER_EXPLOSION_POWER, explosionDamageAmount, TNT_EXPLOSION_POWER } from '../src/domain/mob/explosion'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat'
import { DORMANT_FUSE } from '../src/domain/mob/creeper-fuse'
import { FRESH_PRIMED_TNT } from '../src/domain/mob/primed-tnt'
import type { EndermanTeleportPosition } from '../src/domain/mob/enderman-teleport'
import { BlockId, blockPosition, DeltaTimeSecs } from '@nerima-games/mc-kernel'
import { durabilityForItem, EntityId, EntityKind } from '@nerima-games/mc-sim'
import { makeChunkStoreDouble, STONE, world } from './support/chunk-store-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'

const ORIGIN: Position = { x: 0, y: 64, z: 0 }

/** A creeper's blast, at the origin. The only explosion source this build has. */
const CREEPER_BLAST: Blast = {
  source: EntityId('creeper-0'),
  kind: CREEPER_KIND,
  at: ORIGIN,
  explosion: { source: 'creeper', power: CREEPER_EXPLOSION_POWER },
}

const away = (blocks: number): Position => ({ x: blocks, y: ORIGIN.y, z: ORIGIN.z })

/**
 * A distance the curve answers zero at, derived rather than guessed.
 *
 * `explosionRadius(3)` is 6, so 7 is outside — but the assertion below reads the
 * curve instead of trusting that arithmetic, because the day the power or the
 * radius formula moves is the day a hard-coded 7 stops testing a miss and starts
 * testing a hit while still passing.
 */
const OUT_OF_RANGE_BLOCKS = 7

/** A distance the curve answers with a survivable amount. Same argument. */
const GRAZING_BLOCKS = 5

const emptyStore = makeChunkStoreDouble(world([]), ['0,0'])

describe('the loot table is keyed by a kind that something actually spawns', () => {
  it.effect('every hostile kind has its drop table wired into the frame', () =>
    Effect.sync(() => {
      // The module header refuses a row for a kind nothing produces: 「a row
      // mapping a kind nothing produces would be a claim that this build has
      // ghasts」. `domain/mob/mob-drop.ts` holds a ghast's table, but no ghast is
      // spawned here. A blaze is spawned by the Nether ecosystem, so its table
      // and XP reward must be reachable through the frame dispatchers.
      //
      // Asked over the whole roster and not just the enderman: a third hostile
      // added without a `domain/mob/` rule behind it should show up here as a
      // silent zero, and that is the state worth being able to see.
      const tables = [
        [CREEPER_KIND, CREEPER_DROPS],
        [BLAZE_KIND, BLAZE_DROPS],
        [ENDERMAN_KIND, ENDERMAN_DROPS],
        [ZOMBIE_KIND, ZOMBIE_DROPS],
      ] as const
      for (const [kind, rules] of tables) {
        expect(HOSTILE_KINDS).toContain(kind)
        expect(dropRulesOfKind(kind)).toBe(rules)
        expect(dropRollsNeeded(kind)).toBe(rules.length * 2)
      }
      expect(xpRewardOfKind(BLAZE_KIND)).toBe(BLAZE_XP_REWARD)
    }),
  )

  it.effect('the roll budget is two per line, which is what lets the caller draw before it knows', () =>
    Effect.sync(() => {
      // A chance and a count per line. The budget is asked BEFORE the drop is
      // rolled, so this arithmetic is the contract between the two.
      expect(dropRollsNeeded(CREEPER_KIND)).toBe(dropRulesOfKind(CREEPER_KIND).length * 2)
    }),
  )
})

describe('mob drops through frame death paths', () => {
  it.effect('normal deaths generate zombie and enderman drops', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const zombie = yield* roster.api.spawn({
        kind: ZOMBIE_KIND, feetPosition: ORIGIN, healthPoints: 1, behaviour: undefined,
      })
      const enderman = yield* roster.api.spawn({
        kind: ENDERMAN_KIND, feetPosition: ORIGIN, healthPoints: 1, behaviour: STEADY_ENDERMAN,
      })
      const casualties = yield* resolveMeleeHits(roster.api, [
        { id: zombie.id, damage: 1 }, { id: enderman.id, damage: 1 },
      ])
      const { drops } = rollCasualtyDrops(casualties, 4)
      expect(drops.map((drop) => drop.item)).toContain('rotten_flesh')
      expect(drops.map((drop) => drop.item)).toContain('ender_pearl')
    }),
  )

  it.effect('explosion deaths generate zombie and enderman drops', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      yield* roster.api.spawn({
        kind: ZOMBIE_KIND, feetPosition: ORIGIN, healthPoints: 1, behaviour: undefined,
      })
      yield* roster.api.spawn({
        kind: ENDERMAN_KIND, feetPosition: ORIGIN, healthPoints: 1, behaviour: STEADY_ENDERMAN,
      })
      const resolution = yield* resolveBlasts(roster.api, store.api, [CREEPER_BLAST])
      const { drops } = rollCasualtyDrops(resolution.casualties, 4)
      expect(drops.map((drop) => drop.item)).toContain('rotten_flesh')
      expect(drops.map((drop) => drop.item)).toContain('ender_pearl')
    }),
  )
})

describe('resolveBlasts: the frame with no explosion in it', () => {
  it.effect('an empty blast list touches NOTHING — no sweep, no store call, and the shared empties', () =>
    Effect.gen(function* () {
      // This is the overwhelmingly common frame, and the early return is the
      // reason it costs nothing. Without it every frame would run a full roster
      // sweep whose step function answers `IGNORED` for every mob — correct, and
      // proportional to the number of mobs rather than to the number of
      // explosions.
      //
      // Asserted on the CALL COUNTS rather than on the result, because a version
      // that swept and then returned the same empty arrays would pass any
      // assertion about the value. The doubles count for exactly this.
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const store = yield* emptyStore

      yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: ORIGIN,
        healthPoints: CREEPER_MAX_HEALTH,
        behaviour: { _tag: 'Dormant' },
      })

      const before = yield* roster.calls
      const resolution = yield* resolveBlasts(roster.api, store.api, [])

      expect(resolution.casualties).toStrictEqual([])
      expect(resolution.disturbed).toStrictEqual([])

      const after = yield* roster.calls
      expect(after.sweeps).toBe(before.sweeps)

      const storeCalls = yield* store.calls
      expect(storeCalls.reads).toBe(0)
      expect(storeCalls.writes).toBe(0)
    }),
  )

  it.effect('the two empty answers are SHARED, so an uneventful frame allocates neither', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const store = yield* emptyStore

      const first = yield* resolveBlasts(roster.api, store.api, [])
      const second = yield* resolveBlasts(roster.api, store.api, [])

      expect(first.casualties).toBe(second.casualties)
      expect(first.disturbed).toBe(second.disturbed)
    }),
  )
})

describe('resolveBlasts: the mobs a blast does not reach', () => {
  it.effect('a mob outside every radius is left alone — same object, no transition', () =>
    Effect.gen(function* () {
      // The common case even on the frame a creeper goes off, and it must cost
      // nothing: `damageFrom` answers `undefined` rather than "unchanged
      // vitals", so the sweep can hand back the shared `IGNORED` step and mc-sim
      // can return the ARGUMENT roster. A version that allocated a `Vitals` per
      // out-of-range mob would be completely correct and would turn one
      // explosion into work proportional to the whole roster.
      //
      // Reference identity is the assertion, not deep equality, because that is
      // the property: `entity-manager-double.ts`'s header spells out that an
      // `Unchanged` entity is REUSED so a renderer can compare by reference.
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const store = yield* emptyStore

      // The curve's own answer, so this stays a miss if the radius moves.
      expect(explosionDamageAmount(CREEPER_EXPLOSION_POWER, OUT_OF_RANGE_BLOCKS)).toBe(0)

      const spawned = yield* roster.api.spawn({
        kind: ENDERMAN_KIND,
        feetPosition: away(OUT_OF_RANGE_BLOCKS),
        healthPoints: ENDERMAN_MAX_HEALTH,
        behaviour: STEADY_ENDERMAN,
      })

      const resolution = yield* resolveBlasts(roster.api, store.api, [CREEPER_BLAST])
      expect(resolution.casualties).toStrictEqual([])

      const after = yield* roster.api.entities
      expect(after.length).toBe(1)
      expect(after[0]).toBe(spawned)
    }),
  )

  it.effect('a mob in range of ONE of two blasts takes that one and is not zeroed by the miss', () =>
    Effect.gen(function* () {
      // The loop that folds several blasts onto one mob skips the ones that
      // reach it for nothing. The failure it avoids is not "too little damage" —
      // it is a blast that contributes 0 still allocating a `Vitals` and
      // therefore turning an untouched mob into a `Changed` transition, which
      // costs an allocation per mob per blast and defeats the reuse above.
      //
      // Two blasts in one call, which is also the shape the module header
      // argues for: two creepers going off in the same frame is ONE sweep, so a
      // mob between them takes both blows by design rather than by luck.
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const store = yield* emptyStore

      const grazing = explosionDamageAmount(CREEPER_EXPLOSION_POWER, GRAZING_BLOCKS)
      expect(grazing).toBeGreaterThan(0)
      expect(grazing).toBeLessThan(ENDERMAN_MAX_HEALTH)

      yield* roster.api.spawn({
        kind: ENDERMAN_KIND,
        feetPosition: away(GRAZING_BLOCKS),
        healthPoints: ENDERMAN_MAX_HEALTH,
        behaviour: STEADY_ENDERMAN,
      })

      const distant: Blast = { ...CREEPER_BLAST, source: EntityId('creeper-1'), at: away(1_000) }
      const resolution = yield* resolveBlasts(roster.api, store.api, [distant, CREEPER_BLAST])

      expect(resolution.casualties).toStrictEqual([])

      const after = yield* roster.api.entities
      expect(after[0]?.healthPoints).toBe(ENDERMAN_MAX_HEALTH - grazing)
    }),
  )
})

describe('resolveBlasts: what a survivor remembers', () => {
  it.effect('a blast arms an enderman’s flinch', () =>
    Effect.gen(function* () {
      // The one hit this repository can measure. `endermanTeleportUrge`'s
      // `damagedThisStep` is 「mc-sim's combat lane」 and there is no combat lane
      // here, so a blast is the only trigger the frame both delivers and knows
      // about — and it is what the next sweep reads to make the mob flee.
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const store = yield* emptyStore

      yield* roster.api.spawn({
        kind: ENDERMAN_KIND,
        feetPosition: away(GRAZING_BLOCKS),
        healthPoints: ENDERMAN_MAX_HEALTH,
        behaviour: STEADY_ENDERMAN,
      })

      yield* resolveBlasts(roster.api, store.api, [CREEPER_BLAST])

      const after = yield* roster.api.entities
      expect(after[0]?.behaviour).toBe(STRUCK_ENDERMAN)
    }),
  )

  it.effect('a CREEPER that survives a blast keeps its fuse — the bruise asks the value, not the kind', () =>
    Effect.gen(function* () {
      // `bruise` deliberately does not branch on a kind, and this is the case
      // that says what that buys. A lit fuse is a countdown that is already
      // running; overwriting it with a flinch would either reset the timer or
      // — worse — hand a creeper an enderman's behaviour, which
      // `repairMobBehaviour` exists to make impossible on the load path and
      // which nothing would repair here.
      //
      // Reference identity again: a creeper that was not flinching is handed the
      // SAME behaviour object back, so a chain of blasts across one frame costs
      // no allocation per blast.
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const store = yield* emptyStore

      const fuse: MobBehaviour = { _tag: 'Lit', burnedSecs: 0.4 }
      yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: away(GRAZING_BLOCKS),
        healthPoints: CREEPER_MAX_HEALTH,
        behaviour: fuse,
      })

      const grazing = explosionDamageAmount(CREEPER_EXPLOSION_POWER, GRAZING_BLOCKS)
      expect(grazing).toBeLessThan(CREEPER_MAX_HEALTH)

      yield* resolveBlasts(roster.api, store.api, [CREEPER_BLAST])

      const after = yield* roster.api.entities
      expect(after[0]?.healthPoints).toBe(CREEPER_MAX_HEALTH - grazing)
      expect(after[0]?.behaviour).toBe(fuse)
      expect(after[0]?.behaviour).not.toBe(STRUCK_ENDERMAN)
    }),
  )

  it.effect('the crater still runs when the blast killed nobody, because it is about the WORLD', () =>
    Effect.gen(function* () {
      // The two halves of a blast are independent: `casualties` is over a
      // roster and `disturbed` is over a store. An empty roster must not make
      // the crater a no-op, or a creeper that goes off alone would leave the
      // terrain intact.
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const store = yield* makeChunkStoreDouble(
        world([[blockPosition(0, 64, 0), STONE]]),
        ['0,0'],
      )

      const resolution = yield* resolveBlasts(roster.api, store.api, [CREEPER_BLAST])

      expect(resolution.casualties).toStrictEqual([])
      expect(resolution.disturbed.length).toBeGreaterThan(0)
    }),
  )
})

describe('dropRulesOfKind and xpRewardOfKind: a kind nothing here has a rule for', () => {
  it.effect('answers the empty table and zero reward rather than throwing', () =>
    Effect.sync(() => {
      // VILLAGER: the module header's own refusal, applied to a third kind — a
      // row for a kind nothing produces would be a claim this build has
      // villagers, the same argument `dropRulesOfKind`'s own comment makes for
      // the ghast.
      const NO_RULE_KIND = EntityKind('villager')
      expect(dropRulesOfKind(NO_RULE_KIND)).toStrictEqual([])
      expect(xpRewardOfKind(NO_RULE_KIND)).toBe(0)

      // The two rows the table above never asked for directly: it looped over
      // CREEPER/BLAZE/ENDERMAN/ZOMBIE together for `dropRulesOfKind`, but only
      // ever called `xpRewardOfKind` with BLAZE_KIND.
      expect(xpRewardOfKind(ZOMBIE_KIND)).toBe(ZOMBIE_XP_REWARD)
      expect(xpRewardOfKind(ENDERMAN_KIND)).toBe(ENDERMAN_XP_REWARD)
    }),
  )
})

describe('repairMobBehaviour: the load path for every stored shape', () => {
  it.effect('a creeper: a bad fuse resets to dormant, a good one is wrapped as-is', () =>
    Effect.sync(() => {
      expect(repairMobBehaviour(CREEPER_KIND, 'not a fuse')).toStrictEqual(
        hostileMobSnapshot(DORMANT_FUSE),
      )
      const lit = { _tag: 'Lit' as const, burnedSecs: 0.4 }
      expect(repairMobBehaviour(CREEPER_KIND, lit)).toStrictEqual(hostileMobSnapshot(lit))
    }),
  )

  it.effect('an enderman: a bad flinch resets to steady, a good one is wrapped as-is', () =>
    Effect.sync(() => {
      // A non-object value first — `isEndermanFlinch`'s own guard, the same
      // shape `isCreeperFuse`'s 'not a fuse' case exercises above.
      expect(repairMobBehaviour(ENDERMAN_KIND, 'not a flinch')).toStrictEqual(
        hostileMobSnapshot(STEADY_ENDERMAN),
      )
      expect(repairMobBehaviour(ENDERMAN_KIND, { _tag: 'Confused' })).toStrictEqual(
        hostileMobSnapshot(STEADY_ENDERMAN),
      )
      expect(repairMobBehaviour(ENDERMAN_KIND, STRUCK_ENDERMAN)).toStrictEqual(
        hostileMobSnapshot(STRUCK_ENDERMAN),
      )
    }),
  )

  it.effect('a zombie handed a RAW value still lands on the snapshot with no inner state', () =>
    Effect.sync(() => {
      // `hostile-despawn-frame.test.ts` only exercises the ZOMBIE_KIND branch
      // through an ALREADY-wrapped snapshot, so `isHostileMobSnapshot` takes the
      // top branch there. This is the raw path underneath it — the shape a save
      // predating the snapshot wrapper would have handed back.
      expect(repairMobBehaviour(ZOMBIE_KIND, undefined)).toStrictEqual(hostileMobSnapshot(undefined))
      expect(repairMobBehaviour(ZOMBIE_KIND, { _tag: 'Lit', burnedSecs: 1 })).toStrictEqual(
        hostileMobSnapshot(undefined),
      )
    }),
  )

  it.effect('an ecosystem mob repairs garbage to a fresh state and keeps a good one, raw', () =>
    Effect.sync(() => {
      expect(repairMobBehaviour(BLAZE_KIND, 'garbage')).toStrictEqual(
        hostileMobSnapshot(initialEcosystemMobState()),
      )
      const state = {
        _tag: 'EcosystemMob' as const, attackCooldownSecs: 1, motionPhase: 2, provoked: true,
      }
      expect(repairMobBehaviour(BLAZE_KIND, state)).toStrictEqual(hostileMobSnapshot(state))
    }),
  )

  it.effect('primed tnt is trusted as-is when it is one, and reset to fresh when it is not', () =>
    Effect.sync(() => {
      expect(repairMobBehaviour(PRIMED_TNT_KIND, 'not tnt')).toBe(FRESH_PRIMED_TNT)
      const burning = { _tag: 'PrimedTnt', burnedSecs: 2 }
      expect(repairMobBehaviour(PRIMED_TNT_KIND, burning)).toBe(burning)
    }),
  )

  it.effect('a dropped item: well-formed passes through, a pre-durability save gains one, and no kind with no rule invents one', () =>
    Effect.sync(() => {
      const wellFormed: DroppedItemBehaviour = {
        _tag: 'DroppedItem', item: 'gunpowder', count: 1, durability: null,
      }
      expect(repairMobBehaviour(DROPPED_ITEM_KIND, wellFormed)).toBe(wellFormed)

      // A save from before `durability` existed on the shape: the field is
      // simply ABSENT rather than `null`, and the repair adds it.
      const legacy = { _tag: 'DroppedItem', item: 'gunpowder', count: 1 }
      expect(repairMobBehaviour(DROPPED_ITEM_KIND, legacy)).toStrictEqual({
        ...legacy,
        durability: null,
      })

      // The same legacy shape for a DAMAGEABLE item: `isLegacyDroppedItemBehaviour`
      // still has to check `count === 1` rather than short-circuiting on the
      // item alone, since a stack of more than one damageable item was never
      // a legal shape.
      const legacyTool = { _tag: 'DroppedItem', item: 'wooden_pickaxe', count: 1 }
      expect(repairMobBehaviour(DROPPED_ITEM_KIND, legacyTool)).toStrictEqual({
        ...legacyTool,
        durability: durabilityForItem('wooden_pickaxe'),
      })

      // Not even object-shaped: `hasDroppedItemFields`'s own top guard, which
      // both the current shape and the legacy one are built on.
      expect(repairMobBehaviour(DROPPED_ITEM_KIND, 'not an item')).toBeUndefined()

      // VILLAGER again: no rule at all, so the load path LOSES the behaviour
      // rather than inventing one for a kind that carries none.
      expect(repairMobBehaviour(EntityKind('villager'), wellFormed)).toBeUndefined()
    }),
  )

  it.effect('a hostile snapshot that already agrees with the repair is handed back BY REFERENCE', () =>
    Effect.sync(() => {
      // The allocation `bruise` below relies on for the same reason: a snapshot
      // already correct for its kind costs nothing to repair.
      const snapshot = hostileMobSnapshot(DORMANT_FUSE)
      expect(repairMobBehaviour(CREEPER_KIND, snapshot)).toBe(snapshot)

      const endermanSnapshot = hostileMobSnapshot(STRUCK_ENDERMAN)
      expect(repairMobBehaviour(ENDERMAN_KIND, endermanSnapshot)).toBe(endermanSnapshot)
    }),
  )

  it.effect('a hostile snapshot whose INNER behaviour is wrong for its kind is repaired without losing the outer fields', () =>
    Effect.sync(() => {
      const badCreeper = hostileMobSnapshot(STEADY_ENDERMAN, { ageTicks: 12, named: true })
      expect(repairMobBehaviour(CREEPER_KIND, badCreeper)).toStrictEqual({
        ...badCreeper,
        behaviour: DORMANT_FUSE,
      })

      const badEnderman = hostileMobSnapshot(DORMANT_FUSE, { ageTicks: 12 })
      expect(repairMobBehaviour(ENDERMAN_KIND, badEnderman)).toStrictEqual({
        ...badEnderman,
        behaviour: STEADY_ENDERMAN,
      })

      const badBlaze = hostileMobSnapshot(DORMANT_FUSE, { ageTicks: 12 })
      expect(repairMobBehaviour(BLAZE_KIND, badBlaze)).toStrictEqual({
        ...badBlaze,
        behaviour: initialEcosystemMobState(),
      })
    }),
  )
})

describe('sweepMobs: primed TNT', () => {
  it.effect('a fresh fuse below the threshold advances and is stored, not detonated', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      yield* roster.api.spawn({
        kind: PRIMED_TNT_KIND, feetPosition: ORIGIN, healthPoints: 20, behaviour: FRESH_PRIMED_TNT,
      })
      const swept = yield* sweepMobs(roster.api, { target: undefined, dt: DeltaTimeSecs(1) }, 1)
      expect(swept.blasts).toStrictEqual([])
      const after = yield* roster.api.entities
      expect(after[0]?.behaviour).toStrictEqual({ _tag: 'PrimedTnt', burnedSecs: 1 })
    }),
  )

  it.effect('a zero-length frame changes nothing, and the shared step proves it', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      yield* roster.api.spawn({
        kind: PRIMED_TNT_KIND, feetPosition: ORIGIN, healthPoints: 20, behaviour: FRESH_PRIMED_TNT,
      })
      yield* sweepMobs(roster.api, { target: undefined, dt: DeltaTimeSecs(0) }, 1)
      const after = yield* roster.api.entities
      expect(after[0]?.behaviour).toBe(FRESH_PRIMED_TNT)
    }),
  )

  it.effect('a fuse that reaches its threshold detonates and leaves the roster', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const tnt = yield* roster.api.spawn({
        kind: PRIMED_TNT_KIND, feetPosition: ORIGIN, healthPoints: 20, behaviour: FRESH_PRIMED_TNT,
      })
      const swept = yield* sweepMobs(roster.api, { target: undefined, dt: DeltaTimeSecs(5) }, 1)
      expect(swept.blasts).toStrictEqual([
        {
          source: tnt.id,
          kind: PRIMED_TNT_KIND,
          at: ORIGIN,
          explosion: { source: 'tnt', power: TNT_EXPLOSION_POWER },
        },
      ])
      expect(yield* roster.api.count).toBe(0)
    }),
  )

  it.effect('a kind-matched but malformed behaviour is not treated as primed TNT at all', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      yield* roster.api.spawn({
        kind: PRIMED_TNT_KIND, feetPosition: ORIGIN, healthPoints: 20, behaviour: undefined,
      })
      const swept = yield* sweepMobs(roster.api, { target: undefined, dt: DeltaTimeSecs(1) }, 1)
      expect(swept.blasts).toStrictEqual([])
      const after = yield* roster.api.entities
      expect(after[0]?.behaviour).toBeUndefined()
    }),
  )
})

describe('sweepMobs: the zombie that has nothing to chase', () => {
  it.effect('with no target and no snapshot, the same shared step is returned', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const zombie = yield* roster.api.spawn({
        kind: ZOMBIE_KIND, feetPosition: ORIGIN, healthPoints: 20, behaviour: undefined,
      })
      yield* sweepMobs(roster.api, { target: undefined, dt: DeltaTimeSecs(0.05) }, 1)
      const after = yield* roster.api.entities
      expect(after[0]).toBe(zombie)
    }),
  )

  it.effect('a RAW (un-wrapped) zombie that DOES move stays raw — `storedBehaviour` hands the inner value straight back', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      yield* roster.api.spawn({
        kind: ZOMBIE_KIND, feetPosition: ORIGIN, healthPoints: 20, behaviour: undefined,
      })
      yield* sweepMobs(roster.api, { target: away(10), dt: DeltaTimeSecs(0.05) }, 1)
      const after = yield* roster.api.entities
      expect(after[0]?.feetPosition).not.toStrictEqual(ORIGIN)
      expect(after[0]?.behaviour).toBeUndefined()
    }),
  )
})

describe('sweepMobs: an ecosystem hostile close enough to attack', () => {
  it.effect('a blaze inside its projectile band attacks instead of moving', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const blaze = yield* roster.api.spawn({
        kind: BLAZE_KIND,
        feetPosition: ORIGIN,
        healthPoints: 20,
        behaviour: hostileMobSnapshot(initialEcosystemMobState()),
      })
      // 10 blocks: inside the blaze's [8, 24] projectile band.
      const target = away(10)
      const swept = yield* sweepMobs(roster.api, { target, dt: DeltaTimeSecs(0.05) }, 1)
      expect(swept.attacks).toStrictEqual([
        {
          _tag: 'MobAttack',
          attackerKind: BLAZE_KIND,
          mode: 'projectile',
          damage: 6,
          source: blaze.id,
          at: ORIGIN,
        },
      ])
    }),
  )
})

describe('sweepMobs: a dormant creeper truly idle', () => {
  it.effect('out of range and unmoving, it is the shared IGNORED step', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const creeper = yield* roster.api.spawn({
        kind: CREEPER_KIND, feetPosition: ORIGIN, healthPoints: CREEPER_MAX_HEALTH, behaviour: DORMANT_FUSE,
      })
      yield* sweepMobs(roster.api, { target: undefined, dt: DeltaTimeSecs(0.05) }, 1)
      const after = yield* roster.api.entities
      expect(after[0]).toBe(creeper)
    }),
  )
})

describe('sweepMobs: an enderman with nothing to chase and no blow to answer', () => {
  it.effect('with no snapshot, nothing happened and the shared step proves it', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const enderman = yield* roster.api.spawn({
        kind: ENDERMAN_KIND, feetPosition: ORIGIN, healthPoints: ENDERMAN_MAX_HEALTH, behaviour: STEADY_ENDERMAN,
      })
      yield* sweepMobs(roster.api, { target: undefined, dt: DeltaTimeSecs(0.05) }, 1)
      const after = yield* roster.api.entities
      expect(after[0]).toBe(enderman)
    }),
  )

  it.effect('with a snapshot, the flinch is re-stored rather than dropped, and no roll is drawn', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      yield* roster.api.spawn({
        kind: ENDERMAN_KIND,
        feetPosition: ORIGIN,
        healthPoints: ENDERMAN_MAX_HEALTH,
        behaviour: hostileMobSnapshot(STEADY_ENDERMAN, { ageTicks: 3 }),
      })
      const seed = 1
      const swept = yield* sweepMobs(roster.api, { target: undefined, dt: DeltaTimeSecs(0.05) }, seed)
      expect(swept.seed).toBe(seed)
      const after = yield* roster.api.entities
      expect(after[0]?.behaviour).toStrictEqual({
        ...hostileMobSnapshot(STEADY_ENDERMAN),
        ageTicks: 4,
      })
    }),
  )
})

describe('resolveEndermanTeleportProbes: validating a candidate against the store', () => {
  it.effect('every candidate cell across an unloaded chunk boundary is refused, and the sweep never runs', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const store = yield* makeChunkStoreDouble(world([]), [])
      const current: EndermanTeleportPosition = { x: 0, y: 64, z: 0 }
      const spawned = yield* roster.api.spawn({
        kind: ENDERMAN_KIND, feetPosition: current, healthPoints: ENDERMAN_MAX_HEALTH, behaviour: STEADY_ENDERMAN,
      })
      const probe: EndermanTeleportProbe = {
        _tag: 'EndermanTeleport',
        entityId: spawned.id,
        current,
        anchor: { x: 100, y: 70, z: 100 },
        rolls: [0.75, 0.5],
      }
      const before = yield* roster.calls
      yield* resolveEndermanTeleportProbes(roster.api, store.api, [probe])
      const after = yield* roster.calls
      expect(after.sweeps).toBe(before.sweeps)
      const entities = yield* roster.api.entities
      expect(entities[0]).toBe(spawned)
    }),
  )

  it.effect('an unregistered block is refused like an unsafe one, and a later candidate still lands — the miss stays IGNORED for a bystander', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const current: EndermanTeleportPosition = { x: 0, y: 64, z: 0 }
      const anchor: EndermanTeleportPosition = { x: 100, y: 70, z: 100 }
      // `test/enderman-safe-teleport.test.ts`'s own two-candidate rolls: attempt
      // 0 lands at `first`, attempt 1 at `second`.
      const first = { x: 116, y: 64, z: 100 }
      const second = { x: 100, y: 64, z: 116 }
      // 60_000: inside kernel's `BlockId` brand range ([0, 65535], a storage
      // bound) but far outside its registry (~120 rows), so it is genuinely
      // unregistered rather than out-of-range-invalid — `999_999` used to
      // stand in for this before the mirror's unbranded `BlockId` was
      // repointed to kernel's real, range-validated one.
      const UNREGISTERED_BLOCK_ID = BlockId(60_000)
      const store = yield* makeChunkStoreDouble(
        world([
          // The first candidate's floor names a block id kernel's registry does
          // not carry — the same "asks the registry rather than assumes" shape
          // `blockTypeOfId`'s other callers refuse a held item over.
          [blockPosition(first.x, first.y - 1, first.z), UNREGISTERED_BLOCK_ID],
          [blockPosition(second.x, second.y - 1, second.z), STONE],
        ]),
        ['7,6', '6,7'],
      )
      const teleporting = yield* roster.api.spawn({
        kind: ENDERMAN_KIND, feetPosition: current, healthPoints: ENDERMAN_MAX_HEALTH, behaviour: STEADY_ENDERMAN,
      })
      const bystander = yield* roster.api.spawn({
        kind: ENDERMAN_KIND, feetPosition: away(1), healthPoints: ENDERMAN_MAX_HEALTH, behaviour: STEADY_ENDERMAN,
      })
      const probe: EndermanTeleportProbe = {
        _tag: 'EndermanTeleport',
        entityId: teleporting.id,
        current,
        anchor,
        rolls: [0.75, 0.5, 0.5, 0.75],
      }
      yield* resolveEndermanTeleportProbes(roster.api, store.api, [probe])
      const entities = yield* roster.api.entities
      const moved = entities.find((entity) => entity.id === teleporting.id)
      expect(moved?.feetPosition).toStrictEqual(second)
      // The bystander has no probe of its own: `destinations.get` answers
      // `undefined` for it, and it is the shared IGNORED step, by reference.
      const untouched = entities.find((entity) => entity.id === bystander.id)
      expect(untouched).toBe(bystander)
    }),
  )
})

describe('resolveBlasts and resolveMeleeHits: a dropped item on the ground is never a combat target', () => {
  it.effect('a blast passes through it untouched', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const store = yield* emptyStore
      const droppedItem: DroppedItemBehaviour = {
        _tag: 'DroppedItem', item: 'gunpowder', count: 1, durability: null,
      }
      const item = yield* roster.api.spawn({
        kind: DROPPED_ITEM_KIND, feetPosition: ORIGIN, healthPoints: 1, behaviour: droppedItem,
      })
      const resolution = yield* resolveBlasts(roster.api, store.api, [CREEPER_BLAST])
      expect(resolution.casualties).toStrictEqual([])
      const after = yield* roster.api.entities
      expect(after[0]).toBe(item)
    }),
  )

  it.effect('a bow hit passes through it untouched, even when explicitly targeted', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const droppedItem: DroppedItemBehaviour = {
        _tag: 'DroppedItem', item: 'gunpowder', count: 1, durability: null,
      }
      const item = yield* roster.api.spawn({
        kind: DROPPED_ITEM_KIND, feetPosition: ORIGIN, healthPoints: 1, behaviour: droppedItem,
      })
      const casualties = yield* resolveMeleeHits(roster.api, [{ id: item.id, damage: 5 }])
      expect(casualties).toStrictEqual([])
      const after = yield* roster.api.entities
      expect(after[0]).toBe(item)
    }),
  )
})

describe('bruise: a hostile snapshot survives a non-lethal blast with its outer fields intact', () => {
  it.effect('an enderman flinch inside a snapshot is struck, and a creeper fuse inside one is untouched', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const store = yield* emptyStore

      const grazing = explosionDamageAmount(CREEPER_EXPLOSION_POWER, GRAZING_BLOCKS)
      expect(grazing).toBeLessThan(CREEPER_MAX_HEALTH)

      const endermanSnapshot = hostileMobSnapshot(STEADY_ENDERMAN, { ageTicks: 9 })
      yield* roster.api.spawn({
        kind: ENDERMAN_KIND,
        feetPosition: away(GRAZING_BLOCKS),
        healthPoints: ENDERMAN_MAX_HEALTH,
        behaviour: endermanSnapshot,
      })

      const creeperSnapshot = hostileMobSnapshot(DORMANT_FUSE, { ageTicks: 9 })
      yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: away(GRAZING_BLOCKS),
        healthPoints: CREEPER_MAX_HEALTH,
        behaviour: creeperSnapshot,
      })

      yield* resolveBlasts(roster.api, store.api, [CREEPER_BLAST])

      const after = yield* roster.api.entities
      expect(after[0]?.behaviour).toStrictEqual({ ...endermanSnapshot, behaviour: STRUCK_ENDERMAN })
      // Reference identity: nothing about the creeper's snapshot needed to
      // change, so `bruise` hands the SAME object back.
      expect(after[1]?.behaviour).toBe(creeperSnapshot)
    }),
  )
})

describe('experienceOfCasualties: a kind with no reward yields nothing', () => {
  it.effect('an unrewarded kind contributes no event, and a rewarded one still does', () =>
    Effect.sync(() => {
      const noReward: MobCasualty = { id: EntityId('e:0'), kind: EntityKind('villager'), at: ORIGIN }
      const rewarded: MobCasualty = { id: EntityId('e:1'), kind: ZOMBIE_KIND, at: ORIGIN }
      expect(experienceOfCasualties([noReward, rewarded])).toStrictEqual([
        { source: rewarded.id, kind: ZOMBIE_KIND, at: ORIGIN, amount: ZOMBIE_XP_REWARD },
      ])
    }),
  )
})
