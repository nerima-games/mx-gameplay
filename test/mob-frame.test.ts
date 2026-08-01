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
import {
  CREEPER_KIND,
  CREEPER_MAX_HEALTH,
  dropRollsNeeded,
  dropRulesOfKind,
  ENDERMAN_KIND,
  ENDERMAN_MAX_HEALTH,
  HOSTILE_KINDS,
  resolveBlasts,
  resolveMeleeHits,
  rollCasualtyDrops,
  STEADY_ENDERMAN,
  STRUCK_ENDERMAN,
  type Blast,
  type MobBehaviour,
  xpRewardOfKind,
} from '../src/domain/entities/mob-frame'
import {
  BLAZE_DROPS,
  BLAZE_XP_REWARD,
  CREEPER_DROPS,
  ENDERMAN_DROPS,
  ZOMBIE_DROPS,
} from '../src/domain/mob/mob-drop'
import { BLAZE_KIND } from '../src/domain/mob/mob-ecosystem'
import { CREEPER_EXPLOSION_POWER, explosionDamageAmount } from '../src/domain/mob/explosion'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat'
import { EntityId, type Position } from '../src/domain/entity-manager-port'
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
        world([[{ x: 0, y: 64, z: 0 }, STONE]]),
        ['0,0'],
      )

      const resolution = yield* resolveBlasts(roster.api, store.api, [CREEPER_BLAST])

      expect(resolution.casualties).toStrictEqual([])
      expect(resolution.disturbed.length).toBeGreaterThan(0)
    }),
  )
})
