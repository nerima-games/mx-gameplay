/**
 * Named regression tests for the frame contract.
 *
 * Each `it.effect` title below names the thing that must never come back. These
 * are not smoke tests: they encode plan.md §2.3-1 and §2.3-3, both of which are
 * invisible to the type checker and to `pnpm check:deps`, because both are
 * violated with STRINGS rather than with imports.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import { AIR_BLOCK_ID, type ChunkStore } from '../domain/chunk-store-port'
import {
  CREEPER_KIND,
  type MobBehaviour,
  type MobDropEvent,
  type MobSpawnAttempt,
} from '../domain/entities/mob-frame'
import {
  EntityId,
  EntityKind,
  type EntityManager,
  type EntityRoster,
} from '../domain/entity-manager-port'
import { BOW_TARGET_CENTER_Y_OFFSET } from '../domain/interactions/bow-shot'
import { BOW_FULL_CHARGE_SECS, BOW_MIN_CHARGE_SECS } from '../domain/interactions/draw-bow'
import type { InventoryService } from '@nerima-games/mc-sim'
import {
  DeltaTimeSecs,
  MAX_STACK_COUNT,
  StackCount,
  StageId,
  type FrameServices,
  type GameModule,
  type StageRegistration,
} from '../domain/frame-contract'
import { disturb, takeBatch } from '../domain/falling-block'
import { DEFAULT_ROLL_SEED } from '../domain/frame-rolls'
import {
  gameplayStages,
  drainBowShotResults,
  drainMobDrops,
  LAVA_TICK_INTERVAL,
  makeGameplayFrameState,
  makeGameplayStages,
  gameplayModule,
  requestBowShot,
  requestMobSpawn,
} from '../stages/registration'
import {
  EXPERIENCE_MODULE_STAGE_PREFIXES,
  GAMEPLAY_STAGE_IDS,
  OWN_STAGE_PREFIX,
  UPSTREAM_STAGE_IDS,
} from '../stages/stage-ids'
import {
  emptyWorldStoreLayer,
  makeChunkStoreDouble,
  STONE,
  world,
} from './support/chunk-store-double'
import { emptyRosterLayer, makeEntityManagerDouble } from './support/entity-manager-double'
import { makePlayerServiceDouble, playerDoubleLayer } from './support/player-service-double'
import { PlayerService } from '../domain/player-port'
import { emptyInventoryLayer, makeInventoryDouble } from './support/inventory-service-double'
import { FrameServicesLayer } from './support/frame-services'

const stageIds = (stages: ReadonlyArray<StageRegistration>): ReadonlyArray<string> =>
  stages.map((stage) => stage.id)

/**
 * The stages read and write blocks, iterate mobs and deposit mined items, so
 * building them takes mc-worldgen's `ChunkStore` AND mc-sim's `EntityManager`
 * AND mc-sim's `InventoryService` (in `frameStages` — see
 * `domain/frame-contract.ts` on `RRegister`). Tests about the SHAPE of the
 * registration provide an empty resident world, an empty roster and an empty
 * inventory: these assertions are about ordering and contract, and the
 * behaviour over a real world is `test/vertical-slice.test.ts`.
 */
const emptyWorld = Layer.mergeAll(
  emptyWorldStoreLayer,
  emptyRosterLayer,
  emptyInventoryLayer,
  // mc-sim's PlayerService, which `stepPortalTravel` reads every frame.
  playerDoubleLayer,
)

const registeredStages = Effect.provide(makeGameplayStages, emptyWorld)

/** The same, for the tests that need to reach into the frame state. */
const builtStages = Effect.gen(function* () {
  const state = yield* makeGameplayFrameState
  const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const player = yield* makePlayerServiceDouble()
  const inventory = yield* makeInventoryDouble()
  return {
    state,
    store,
    roster,
    inventory,
    stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api),
  }
})

const allAfterEdges = (stages: ReadonlyArray<StageRegistration>): ReadonlyArray<string> =>
  stages.flatMap((stage) => [...(stage.after ?? [])])

describe('§2.3-1 zero edges between experience modules', () => {
  it.effect(
    'REGRESSION: no `after` edge names another experience module, so mx-gameplay cannot be ordered against mx-redstone/mx-ui/mx-multiplayer',
    () =>
      Effect.gen(function* () {
        const stages = yield* registeredStages
        const foreign = allAfterEdges(stages).filter((edge) =>
          EXPERIENCE_MODULE_STAGE_PREFIXES.some(
            (prefix) => prefix !== OWN_STAGE_PREFIX && edge.startsWith(prefix),
          ),
        )

        // A StageId is a string, so `pnpm check:deps` cannot see this: an
        // `after: [StageId('ui:hud-sync')]` imports nothing while still making
        // mx-gameplay's frame position depend on mx-ui existing. plan.md §4.2
        // puts redstone between gameplay's fluids and its time/weather stage —
        // that ordering is mc-compose's to state, not ours.
        expect(foreign).toStrictEqual([])
      }),
  )

  it.effect('REGRESSION: every declared upstream stage belongs to a foundation repository, never to a sibling', () =>
    Effect.sync(() => {
      for (const id of Object.values(UPSTREAM_STAGE_IDS)) {
        const isSibling = EXPERIENCE_MODULE_STAGE_PREFIXES.some(
          (prefix) => prefix !== OWN_STAGE_PREFIX && id.startsWith(prefix),
        )
        expect(isSibling).toBe(false)
      }
    }),
  )
})

describe('§2.3-3 the total order belongs to mc-compose', () => {
  it.effect('REGRESSION: this repository exposes no way to resolve a total order — only `after` constraints', () =>
    Effect.gen(function* () {
      const stages = yield* registeredStages

      // Every stage declares constraints and nothing else. If a future commit
      // adds a `priority`, an `index`, or a `sortStages()` export, this
      // assertion is the thing that should stop it: those are all ways of
      // claiming a position in a sequence this repository cannot see.
      for (const stage of stages) {
        expect(Object.keys(stage).sort()).toStrictEqual(['after', 'id', 'run'])
      }
    }),
  )

  it.effect('the declared constraints form the §4.2 skeleton fragment gameplay is responsible for', () =>
    Effect.gen(function* () {
      const stages = yield* registeredStages
      const byId = new Map(stages.map((stage) => [stage.id, stage]))

      expect(stageIds(stages)).toStrictEqual([
        GAMEPLAY_STAGE_IDS.interactions,
        GAMEPLAY_STAGE_IDS.entities,
        GAMEPLAY_STAGE_IDS.fluids,
        GAMEPLAY_STAGE_IDS.timeWeather,
      ])

      expect(byId.get(GAMEPLAY_STAGE_IDS.interactions)?.after).toStrictEqual([
        UPSTREAM_STAGE_IDS.simPhysics,
      ])
      expect(byId.get(GAMEPLAY_STAGE_IDS.entities)?.after).toStrictEqual([
        GAMEPLAY_STAGE_IDS.interactions,
      ])
      expect(byId.get(GAMEPLAY_STAGE_IDS.fluids)?.after).toStrictEqual([GAMEPLAY_STAGE_IDS.entities])
      expect(byId.get(GAMEPLAY_STAGE_IDS.timeWeather)?.after).toStrictEqual([
        GAMEPLAY_STAGE_IDS.fluids,
      ])
    }),
  )

  it.effect('a consumer that ignores the array order and honours only `after` still gets a legal schedule', () =>
    Effect.gen(function* () {
      const stages = yield* registeredStages
      // Reversed on purpose: mc-compose merges four modules' arrays, so the
      // order mx-gameplay happened to write them in is never what it sees.
      const shuffled = [...stages].reverse()

      const position = new Map(stageIds(shuffled).map((id, index) => [id, index]))
      const satisfied = shuffled.every((stage) =>
        (stage.after ?? []).every((edge) => {
          const edgePosition = position.get(edge)
          // A dangling edge (a stage nobody registered) is scheduled as if the
          // edge were absent — that is what lets a module order itself against
          // an optional peer. See domain/frame-contract.ts.
          return edgePosition === undefined || edgePosition < (position.get(stage.id) ?? 0)
        }),
      )

      // The REVERSED array violates the constraints, which is the point: the
      // array order is not the schedule. A real consumer must sort.
      expect(satisfied).toBe(false)
    }),
  )

  it.effect('StageId rejects a blank id, so a stage cannot register itself as an unnameable vertex', () =>
    Effect.sync(() => {
      expect(() => StageId('   ')).toThrow()
      expect(StageId('gameplay:interactions')).toBe('gameplay:interactions')
    }),
  )
})

describe('stage behaviour', () => {
  it.effect('REGRESSION: an idle tick does no falling-block work at all (the O(chunks × blocks) scan is gone)', () =>
    Effect.gen(function* () {
      const { state, store, stages } = yield* builtStages
      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)
      expect(entities).toBeDefined()

      yield* entities?.run(DeltaTimeSecs(0.016)) ?? Effect.void

      // Nothing was disturbed, so nothing was looked at. The reference's
      // pre-fix behaviour read ~7M blocks here regardless
      // (falling-block-maintenance.ts:9-15). Now that the stage really holds a
      // store, "did no work" is checkable directly: zero calls, not merely zero
      // changes.
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0, peeks: 0 })
      const queue = yield* Ref.get(state.fallingBlocks)
      expect(queue.pending.size).toBe(0)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('REGRESSION: a burst of disturbances is spread across ticks by the per-tick move budget', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)

      // A TNT blast under a desert. The world is empty, so none of these
      // positions produces a move — the assertion is about the BUDGET, which
      // bounds how many positions are examined rather than how many move.
      const blast = Array.from({ length: 100 }, (_, index) => `0,${String(index)},0`)
      yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, blast))

      yield* entities?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(100 - 32)

      yield* entities?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      expect((yield* Ref.get(state.fallingBlocks)).pending.size).toBe(100 - 64)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('REGRESSION: lava keys survive the ticks on which lava is not scheduled', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const fluids = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)

      yield* Ref.set(state.fluidFrontier, [
        { key: 'lava-a', kind: 'lava' },
        { key: 'lava-b', kind: 'lava' },
      ])

      // Tick 1: lava's tick is inactive (1 % 4 !== 0), so nothing is evaluated
      // and BOTH keys must still be there next tick. Dropping them is the
      // straight-edged-lava-lake bug.
      yield* fluids?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      expect((yield* Ref.get(state.fluidFrontier)).map((item) => item.key)).toStrictEqual([
        'lava-a',
        'lava-b',
      ])

      for (let tick = 2; tick <= LAVA_TICK_INTERVAL; tick += 1) {
        yield* fluids?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      }

      // On the active tick they are consumed.
      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([])
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  // REGRESSION: the time of day is mc-sim's. It survives save/load, which is
  // the very test the module header names for whether a Ref belongs here, so it
  // is a noun and lives in `mc-sim/domain/time-of-day.ts` behind
  // `application/time-service.ts` (plan.md §2.3-1). This file used to hold
  // `timeOfDaySecs` and `dayLengthSecs` Refs and advance them, with a
  // `DEFAULT_DAY_LENGTH_SECS` of 1200 against mc-sim's 400 — two owners of one
  // noun, disagreeing, with only mc-sim's copy reaching the save file.
  //
  // ---------------------------------------------------------------------------
  // THIS TEST WAS CALLED 「holds no time of day and no day length」 AND IS NOT
  // ---------------------------------------------------------------------------
  //
  // A `timeOfDay` Ref now exists, and renaming a regression test to accommodate
  // the thing it was built to prevent deserves the paragraph rather than a
  // shrug. Two facts settle it.
  //
  // FIRST, the deleted failure was not "a field named timeOfDay". It was
  // OWNERSHIP: this file computed the hour, advanced it every frame from its own
  // day length, and disagreed with mc-sim about how long a day was. The new Ref
  // does none of those three. Nothing in `stages/registration.ts` increments it,
  // there is no day length anywhere in this repository, and the value is
  // overwritten by the host every frame rather than accumulated.
  //
  // SECOND, the property that actually matters is now asserted DIRECTLY, in the
  // test below, instead of being inferred from the absence of a key: running
  // frames must not change the hour. That is a strictly stronger statement than
  // "there is no field called this", because a field called something else that
  // advanced the clock would have passed the old test and fails the new one.
  //
  // What survives here unchanged is the exact-list gate, which is the part that
  // makes an addition reviewable.
  it.effect('REGRESSION: the frame state holds no day length, and every Ref is scratch', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState

      // The list is exact on purpose: another answer to "what does mx-gameplay
      // remember between frames" has to be argued for in a diff. Two arrived
      // with the block-write wiring, four with the mob wiring, two with the
      // spawn search and FIVE with placement, loot and weather, and every one of
      // the sixteen passes the save-file test — see the paragraph on
      // `GameplayFrameState` in `stages/registration.ts`, which argues
      // `targetPosition`, `timeOfDay` and the weather pair at length because
      // they are the ones that most look like second owners of a noun.
      //
      // `spawnClockSecs` is the least interesting of the sixteen and the easiest
      // to justify: it is a countdown to the next search, and losing it on a
      // reload costs at most one 0.3s interval.
      //
      // `weather` / `weatherAdvanced` ARE THE PAIR TO WATCH, and they are the
      // reason this list is worth keeping exact. A save file does need the
      // weather, and no repository owns it — so the temptation is a single
      // advancing `Ref`, which would be `timeOfDaySecs` all over again except
      // that nothing would ever disagree with it and nobody would find out. The
      // two keys are an inbox and an outbox, and the test below asserts that
      // running frames does not change the inbox.
      //
      // `pendingItemUses` / `usedItems` ARE THE THIRD INBOX AND THE THIRD
      // OUTBOX, and they pass the same test the other five do: a save file
      // records that a portal is lit, never that a flint and steel was clicked,
      // and never that one point of durability is owed to a slot mc-sim owns.
      // The outbox is separate from `consumedItems` because the two name
      // different `InventoryService` verbs — see the header.
      //
      // `pendingBowShots` / `bowKnockbacks` AND `pendingPearlThrows` /
      // `enderPearlOutcomes` are the fourth and fifth inbox/outbox pairs, and
      // they pass the same test: a save file records where a mob is and how much
      // health it has left — both mc-sim's — never that a bow was loosed, and
      // never which way a hit shoved something. THE TWO OUTBOXES ARE HERE FOR A
      // DIFFERENT REASON FROM THE OTHER THREE, though, and it is worth the
      // distinction: `consumedItems` and `usedItems` wait on an inventory verb
      // this repository could call wrongly, while these two wait on a noun that
      // does not exist anywhere — a velocity field on the roster, and a player.
      // See their types in `stages/registration.ts`.
      //
      // `portalDwell` IS THE SEVENTEENTH AND IT IS NOT AN INBOX OR AN OUTBOX,
      // which makes it the one most worth arguing. It holds how long the player
      // has stood in a portal block, and it passes the save-file test cleanly: a
      // save records WHICH DIMENSION the player is in — mc-sim's, reached
      // through `PlayerServiceApi.setDimension` — and never that they were two
      // seconds into a crossing. Losing it on a reload costs at most one dwell,
      // which is the same trade `spawnClockSecs` makes.
      //
      // It is emphatically NOT a second owner of the dimension. The union is
      // mc-worldgen's word and the current value is mc-sim's state; this Ref
      // holds neither, only a timer and a cooldown.
      //
      // WHAT IS STILL NOT HERE is the thing this list exists to keep out: there
      // is no `Ref<Map<MobId, CreeperFuse>>`, no mob position, no mob health, no
      // entity id, no INVENTORY, no PLAYER POSITION and no GAME MODE — and no DAY
      // LENGTH, which is the half of the original failure that has no stand-in
      // and never will, because nothing in this repository needs to know how long
      // a day is.
      expect(Object.keys(state).sort()).toStrictEqual([
        'blockUseResults',
        'bowKnockbacks',
        'bowShotResults',
        'consumedItems',
        'enderPearlOutcomes',
        'fallingBlocks',
        'fluidFrontier',
        'handledBowShotRequestIds',
        'heldTool',
        'hostileContactCooldowns',
        'itemUseResults',
        'leftoverItems',
        'mobDrops',
        'pendingBlockUses',
        'pendingBowShots',
        'pendingBreaks',
        'pendingItemUses',
        'pendingMeleeAttacks',
        'pendingPearlThrows',
        'pendingPlacements',
        'playerDamages',
        'portalDwell',
        'rollSeed',
        'spawnAttempts',
        'spawnClockSecs',
        'targetPosition',
        'tickCount',
        'timeOfDay',
        'usedItems',
        'weather',
        'weatherAdvanced',
      ])

      // The pearl teleports the player and the game mode decides whether it
      // hurts. NEITHER IS HERE, and both are named because the pearl is the first
      // rule in this repository that wanted them: a `playerPosition` Ref would be
      // a second owner of `targetPosition`'s noun, and a `gameMode` Ref would be
      // a second owner of a save-file fact. Both leave through
      // `enderPearlOutcomes` instead.
      expect(Object.keys(state)).not.toContain('playerPosition')
      expect(Object.keys(state)).not.toContain('gameMode')

      expect(Object.keys(state)).not.toContain('dayLength')
      expect(Object.keys(state)).not.toContain('dayLengthSecs')
      expect(Object.keys(state)).not.toContain('timeOfDaySecs')
      // The inventory is mc-sim's, and this assertion means MORE now than it
      // did when `minedItems` held every mined stack: the stage calls
      // `InventoryService.add` and reads the number back, so the temptation is
      // no longer a second outbox but a CACHE of what the service answered —
      // which is what a Ref named for the noun would be. `leftoverItems` holds
      // only what `add` refused, and `consumedItems` and `usedItems` are lists
      // the host drains for verbs the rules do not call.
      expect(Object.keys(state)).not.toContain('inventory')
      expect(Object.keys(state)).not.toContain('slots')
      expect(Object.keys(state)).not.toContain('heldItems')
    }),
  )

  it.effect('bow results correlate successful and refused requests and drain exactly once', () =>
    Effect.gen(function* () {
      const { state, inventory, stages } = yield* builtStages
      const shot = {
        origin: { x: 0, y: 64, z: 0 },
        dirX: 0,
        dirY: 1,
        dirZ: 0,
        chargeSecs: BOW_FULL_CHARGE_SECS,
      }

      yield* requestBowShot(state, 'fired', shot)
      yield* requestBowShot(state, 'undercharged', {
        ...shot,
        chargeSecs: BOW_MIN_CHARGE_SECS / 2,
      })
      yield* requestBowShot(state, 'duplicate', shot)
      yield* requestBowShot(state, 'duplicate', shot)

      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
      yield* interactions!.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainBowShotResults(state)).toStrictEqual([
        { requestId: 'fired', success: true, outcome: 'Fired' },
        { requestId: 'undercharged', success: false, outcome: 'Undercharged' },
        { requestId: 'duplicate', success: true, outcome: 'Fired' },
        { requestId: 'duplicate', success: false, outcome: 'DuplicateRequest' },
      ])
      expect(yield* drainBowShotResults(state)).toStrictEqual([])
      expect(yield* inventory.withdrawals).toStrictEqual([])

      yield* requestBowShot(state, 'duplicate', shot)
      yield* interactions!.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      expect(yield* drainBowShotResults(state)).toStrictEqual([
        { requestId: 'duplicate', success: false, outcome: 'DuplicateRequest' },
      ])
      expect(yield* inventory.withdrawals).toStrictEqual([])
    }),
  )

  it.effect('terrain occludes entity damage before a fired shot reaches the roster', () =>
    Effect.gen(function* () {
      const target: EntityRoster<MobBehaviour> = {
        entities: [
          {
            id: EntityId('target-behind-wall'),
            kind: EntityKind('creeper'),
            feetPosition: { x: 0, y: 64 - BOW_TARGET_CENTER_Y_OFFSET, z: 10 },
            healthPoints: 20,
            behaviour: undefined,
          },
        ],
        nextSerial: 1,
      }
      const state = yield* makeGameplayFrameState
      const store = yield* makeChunkStoreDouble(world([[{ x: 0, y: 64, z: 5 }, STONE]]), [
        '0,0',
      ])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>(target)
      const player = yield* makePlayerServiceDouble()
      const inventory = yield* makeInventoryDouble()
      const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api)

      yield* requestBowShot(state, 'wall-shot', {
        origin: { x: 0, y: 64, z: 0 },
        dirX: 0,
        dirY: 0,
        dirZ: 1,
        chargeSecs: BOW_FULL_CHARGE_SECS,
      })
      const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
      yield* interactions!.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainBowShotResults(state)).toStrictEqual([
        { requestId: 'wall-shot', success: true, outcome: 'Fired' },
      ])
      expect((yield* roster.api.snapshot).entities[0]?.healthPoints).toBe(20)
      expect(yield* Ref.get(state.bowKnockbacks)).toStrictEqual([])
    }),
  )

  // REGRESSION, and the one that replaces what the rename above gave up: this
  // repository READS the hour and never ADVANCES it.
  //
  // The deleted `timeOfDaySecs` Ref was advanced by the `gameplay:time-weather`
  // stage, which is why that stage is still deliberately empty and says so.
  // Anything that ticked the clock — there, or in the entities stage that now
  // reads it — would recreate the two-owners failure under a different name, and
  // the key-list test above could not see it.
  it.effect('REGRESSION: no stage advances the clock, whatever the frame does', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages

      // A value no default could produce, so that "unchanged" cannot be
      // satisfied by a stage resetting it to zero.
      const written = 0.375
      yield* Ref.set(state.timeOfDay, written)

      // Every stage, many times, with a delta large enough that the spawn
      // search's 0.3s cadence fires repeatedly. If anything ticked the clock —
      // by dt, by a day length, or by a tick count — twenty frames would show
      // it.
      for (let frame = 0; frame < 20; frame += 1) {
        for (const stage of stages) {
          yield* stage.run(DeltaTimeSecs(0.25))
        }
      }

      // EXACTLY what the host wrote. This is the property the deleted
      // `timeOfDaySecs` Ref violated, and it is asserted rather than inferred
      // from a missing key.
      expect(yield* Ref.get(state.timeOfDay)).toBe(written)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  // REGRESSION-SHAPED: the paragraph in `stages/registration.ts` that this file
  // has enforced since the day-length deletion says a `Ref<Map<MobId,
  // CreeperFuse>>` here would be 「the same mistake as the `timeOfDaySecs` Ref
  // this file used to hold」. The roster now exists in mc-sim, so the temptation
  // is gone — but the way it would come back is a stage that CACHES what it read
  // from the roster, which looks like an optimisation rather than like ownership.
  it.effect('REGRESSION: the frame state holds no mob, no mob position and no mob health', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState

      // Nothing here is a Map, which is the shape a mob cache takes, and nothing
      // is an entity. The two mob-shaped fields hold a target the frame is
      // handed and candidate cells offered to a rule; both are emptied or
      // overwritten within the frame that reads them.
      expect(yield* Ref.get(state.targetPosition)).toBeUndefined()
      expect(yield* Ref.get(state.spawnAttempts)).toStrictEqual([])
      expect(yield* Ref.get(state.mobDrops)).toStrictEqual([])
    }),
  )

  it.effect('host mob boundaries preserve spawn order and atomically drain drops', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const spawn = (x: number): MobSpawnAttempt => ({
        candidate: {
          groundBlock: AIR_BLOCK_ID,
          footBlock: AIR_BLOCK_ID,
          headBlock: AIR_BLOCK_ID,
          blockLight: 0,
          timeOfDay: 0,
          distanceToPlayerBlocksXZ: 24,
        },
        kind: CREEPER_KIND,
        feetPosition: { x, y: 64, z: 0 },
      })
      const first = spawn(1)
      const second = spawn(2)

      yield* requestMobSpawn(state, first)
      yield* requestMobSpawn(state, second)
      expect(yield* Ref.get(state.spawnAttempts)).toStrictEqual([first, second])

      const drop: MobDropEvent = {
        item: 'gunpowder',
        count: 1,
        source: EntityId('qa-creeper'),
        kind: CREEPER_KIND,
        at: { x: 1, y: 64, z: 0 },
      }
      yield* Ref.set(state.mobDrops, [drop])

      expect(yield* drainMobDrops(state)).toStrictEqual([drop])
      expect(yield* Ref.get(state.mobDrops)).toStrictEqual([])
      expect(yield* drainMobDrops(state)).toStrictEqual([])
    }),
  )

  it.effect('the seed is a literal, so two frame states start from the same one', () =>
    Effect.gen(function* () {
      // `domain/frame-rolls.ts` is a whole file about why randomness enters here
      // and nowhere else. The property that matters to plan.md §5.1-3 is this
      // one: two runs of one scenario draw the same numbers.
      const first = yield* makeGameplayFrameState
      const second = yield* makeGameplayFrameState

      expect(yield* Ref.get(first.rollSeed)).toBe(DEFAULT_ROLL_SEED)
      expect(yield* Ref.get(second.rollSeed)).toBe(DEFAULT_ROLL_SEED)
    }),
  )

  // REGRESSION: every Ref here must be free to lose on a reload. That is the
  // save-file test from the module header, applied to the whole state rather
  // than to the one field that failed it.
  it.effect('REGRESSION: every Ref in the frame state is frame-local scratch, not saved state', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState

      // A work queue of disturbed columns, a frontier of cells still to look
      // at, the counter that paces lava, an inbox of this frame's requests and
      // a list of what mc-sim's inventory had no room for. Reconstructed within
      // a frame of a reload; none of them is a fact about the world. In
      // particular `leftoverItems` is not an inventory — it answers no question
      // about what anyone is carrying, it is empty in every ordinary frame, and
      // it is emptied by whoever drains it.
      expect(yield* Ref.get(state.fallingBlocks)).toStrictEqual({ pending: new Set<string>() })
      expect(yield* Ref.get(state.fluidFrontier)).toStrictEqual([])
      expect(yield* Ref.get(state.tickCount)).toBe(0)
      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual([])
      expect(yield* Ref.get(state.leftoverItems)).toStrictEqual([])
      expect(yield* Ref.get(state.mobDrops)).toStrictEqual([])
      expect(yield* Ref.get(state.spawnAttempts)).toStrictEqual([])
      expect(yield* Ref.get(state.targetPosition)).toBeUndefined()
      expect(yield* Ref.get(state.rollSeed)).toBe(DEFAULT_ROLL_SEED)
    }),
  )

  it.effect('a stage tolerates dt = 0, because a frame may be scheduled twice inside one clock tick', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* builtStages
      const before = yield* Ref.get(state.tickCount)
      yield* Effect.forEach(stages, (stage) => stage.run(DeltaTimeSecs(0)))
      // The fluid stage counts ticks rather than seconds, so a zero delta still
      // advances it by one — what must not happen is a crash or a divide by dt.
      expect(yield* Ref.get(state.tickCount)).toBe(before + 1)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('each call to makeGameplayFrameState yields independent state (re-entrant initialisation)', () =>
    Effect.gen(function* () {
      // plan.md §3.8: app-scope singletons were among the reference's worst bug
      // sources — a second world load inherited the first world's refs and
      // deadlocked. Two playgrounds in one process must not share a frontier.
      const first = yield* makeGameplayFrameState
      const second = yield* makeGameplayFrameState

      yield* Ref.update(first.fallingBlocks, (queue) => disturb(queue, ['1,2,3']))

      expect((yield* Ref.get(first.fallingBlocks)).pending.size).toBe(1)
      expect((yield* Ref.get(second.fallingBlocks)).pending.size).toBe(0)
    }),
  )

  it.effect('takeBatch preserves disturbance order, which is what makes a scenario test an oracle', () =>
    Effect.sync(() => {
      const queue = disturb({ pending: new Set<string>() }, ['c', 'a', 'b', 'a'])
      const { batch, rest } = takeBatch(queue, 2)
      expect(batch).toStrictEqual(['c', 'a'])
      expect([...rest.pending]).toStrictEqual(['b'])
    }),
  )
})

describe('the mirrored DeltaTimeSecs brand is kernel’s', () => {
  /*
   * REGRESSION. `domain/frame-contract.ts` restates kernel's `DeltaTimeSecs`
   * (`mc-kernel/domain/quantities.ts:37-42`), and a brand is keyed by its
   * STRING: `Brand.Brand<'DeltaTimeSecs'>` here and in kernel are ONE TYPE to
   * TypeScript, however differently the two constructors validate. So a mirror
   * that refined differently would be a false guarantee the compiler could
   * never contradict — which is exactly what mc-physics had, refining to the
   * frame-loop clamp [0.001, 0.05] while kernel refines to "finite and
   * non-negative". A kernel-built `DeltaTimeSecs(30)` satisfied its parameter
   * types while breaking the invariant its comments claimed.
   *
   * Kernel's is the agreed refinement and it is deliberately LOOSE: a zero
   * delta is legal, because a frame may be scheduled twice inside one clock
   * tick, and the clamp of plan.md §3.4 is a frame-loop concern applied at the
   * boundary by whoever PRODUCES the delta — mc-sim's `frame-timing.ts`,
   * mc-physics' `clampDeltaTime` — never a property of the quantity itself.
   * A stage receives whatever the loop produced and must cope.
   */
  it.effect('accepts zero and any finite non-negative delta, and rejects nothing else', () =>
    Effect.sync(() => {
      expect(DeltaTimeSecs(0)).toBe(0)
      expect(DeltaTimeSecs(0.0001)).toBe(0.0001)
      // Out of the integrator's safe range, and still a valid quantity: this is
      // what a tab that was backgrounded for thirty seconds produces.
      expect(DeltaTimeSecs(30)).toBe(30)

      expect(() => DeltaTimeSecs(-0.000_001)).toThrow()
      expect(() => DeltaTimeSecs(Number.NaN)).toThrow()
      expect(() => DeltaTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )
})

describe('the mirrored StackCount brand is kernel’s too', () => {
  /*
   * The same regression shape as `DeltaTimeSecs` above, one module over and one
   * commit later. `StackCount` arrived in `domain/frame-contract.ts` with
   * the inventory integration, which needs it for mc-sim's `ItemStack`, and it
   * is in THAT file because `mc-kernel/domain/quantities.ts` is one of the
   * three kernel modules it already mirrors — the file's header argues the
   * placement and names the alternative it rejected.
   *
   * A brand is keyed by its string, so a mirror that refined `[1, 64]` instead
   * of `[0, 64]` would reject the empty stack kernel accepts, in a repository
   * where every value it touches came from mc-sim and is therefore already
   * believed to be valid. That is the mc-physics defect exactly.
   *
   * The bounds are NOT symmetrical and both ends matter: 0 is legal because
   * `removeItem` writes the count left in a slot before deciding whether the
   * slot is empty, and 64 is `MAX_STACK_COUNT` — the cap that makes an
   * inventory able to be FULL, which is what makes `add`'s leftover reachable
   * at all (`test/inventory-mirror.test.ts`).
   */
  it.effect('accepts integers in [0, MAX_STACK_COUNT] and nothing else', () =>
    Effect.sync(() => {
      expect(MAX_STACK_COUNT).toBe(64)
      expect(StackCount(0)).toBe(0)
      expect(StackCount(1)).toBe(1)
      expect(StackCount(MAX_STACK_COUNT)).toBe(64)

      expect(() => StackCount(65)).toThrow()
      expect(() => StackCount(-1)).toThrow()
      // An integer, not a quantity: half a block is not a thing a slot holds.
      expect(() => StackCount(2.5)).toThrow()
      expect(() => StackCount(Number.NaN)).toThrow()
      expect(() => StackCount(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )
})


describe('the module contract has caught up with this file’s shape', () => {
  /*
   * REGRESSION — the change the vertical-slice spike forced on mc-kernel.
   *
   * `stages/registration.ts` used to carry a comment saying it was "NOT yet a
   * `GameModule`" because the service set could not be named until mc-sim
   * published. That diagnosis was half wrong, and the wrong half is what the
   * spike found: mx-gameplay publishes no service for another repository to call — a rule is not a
 * service (plan.md §2.3-1) — so its Layer is empty and always was.
   *
   * The real obstacle was that `GameModule.frameStages` was an ARRAY. These
   * stages are built from `Ref`s allocated in an Effect, so there was no way to
   * put them in a field typed `ReadonlyArray` — and, worse, an array gave NO
   * module anywhere a context in which to acquire a service in order to build a
   * stage, which forced every service any stage touched into `FrameServices`
   * and would have made kernel name mc-sim's and mc-render's services.
   *
   * kernel's `frameStages` is now an Effect. This test is what says the
   * repository actually took the shape, rather than the comment merely changing.
   */
  it.effect('REGRESSION: exports a real GameModule, not "stages alone, the Layer comes later"', () =>
    Effect.gen(function* () {
      const module: GameModule<
        never,
        never,
        never,
        ChunkStore | EntityManager | InventoryService | PlayerService
      > = gameplayModule
      const stages = yield* Effect.provide(module.frameStages, emptyWorld)

      expect(stageIds(stages)).toStrictEqual(Object.values(GAMEPLAY_STAGE_IDS))
    }),
  )

  it.effect('its frameStages IS the registration Effect this file already exported', () =>
    Effect.gen(function* () {
      expect(gameplayModule.frameStages).toBe(makeGameplayStages)

      // ...and it is re-entrant: two builds share no state, which is why it was
      // an Effect in the first place (plan.md §3.8 on app-scope singletons).
      const first = yield* registeredStages
      const second = yield* registeredStages
      expect(first).not.toBe(second)
    }),
  )

  // This has now read TWO, then THREE, and reads FOUR. Each step discharged a
  // prediction the previous comment had written down by name, which is why the
  // history is kept rather than overwritten:
  //
  //   TWO   -> THREE: 「The candidate for the third is mc-sim's
  //          `InventoryService`, and until it can be mirrored whole the mob
  //          drops go to an outbox instead」. Integrated whole from mc-sim; the
  //          stage deposits through it.
  //   THREE -> FOUR:  「The candidate for the fourth is mc-sim's
  //          `PlayerService`, and it cannot be mirrored whole … `cameraPose`
  //          requires `ClockPort`, and restating `ClockPort` locally is 『a far
  //          worse failure than a narrower type』」.
  //
  // THAT SECOND PREDICTION WAS RIGHT ABOUT THE CANDIDATE AND WRONG ABOUT THE
  // OBSTACLE. `domain/frame-contract.ts` carries `ClockPort` in the kernel
  // mirror where kernel's barrel replaces it, so `cameraPose` is transcribed
  // whole WITH its requirement and nothing was narrowed. What actually blocked
  // the fourth service was a noun with no owner — `Dimension` — and mc-worldgen
  // taking the word is what let `stepPortalTravel` call `PlayerService` every
  // frame.
  //
  // `RIn` is still `never` and that is the distinction `RRegister` exists for.
  // This repository BUILDS nothing another repository has to supply; it CALLS
  // what mc-worldgen and mc-sim supply. Any of the three leaking into `RIn`
  // would be mx-gameplay claiming to construct part of somebody else's
  // repository.
  it.effect('acquires exactly four services to register — store, roster, inventory and player', () =>
    Effect.gen(function* () {
      const registration: Effect.Effect<
        ReadonlyArray<StageRegistration>,
        never,
        ChunkStore | EntityManager | InventoryService | PlayerService
      > = gameplayModule.frameStages

      // Providing those four — and nothing else — discharges the whole context.
      // If a stage started demanding a FIFTH service at REGISTRATION time, this
      // assignment would stop compiling, which is the point. There is no named
      // candidate for a fifth today, and inventing one here would be the
      // speculation this file's history is a record of NOT doing.
      const satisfied: Effect.Effect<ReadonlyArray<StageRegistration>, never, never> =
        Effect.provide(registration, emptyWorld)

      expect(yield* satisfied).toHaveLength(4)
    }),
  )

  // REGRESSION-SHAPED, and it is the property mc-sim's §7-1 buys with
  // `Context.GenericTag`: `EntityManager` appears ONCE in the requirement,
  // without a parameter, however the behaviour type is instantiated. If mc-sim
  // had used a Tag class per behaviour, this union would have grown a member per
  // consumer and mc-compose would have had to name mx-gameplay's `MobBehaviour`.
  it.effect('the roster requirement carries no behaviour parameter', () =>
    Effect.sync(() => {
      const unparameterised: Effect.Effect<
        ReadonlyArray<StageRegistration>,
        never,
        ChunkStore | EntityManager | InventoryService | PlayerService
      > = makeGameplayStages

      expect(typeof unparameterised).toBe('object')
    }),
  )

  // The `run` side must stay free of it. `StageRegistration.run` is typed by
  // kernel's `FrameServices`, and a stage that demanded `ChunkStore` there
  // would be asking kernel to name mc-worldgen's services — which the tier
  // model (plan.md §2.2) forbids, and which no amount of local testing would
  // reveal until mc-compose tried to build a frame.
  //
  // The annotation below says `FrameServices` and NOT `never`, and the
  // difference is the whole assertion. `never` says 「`run` demands nothing」,
  // which is true only by the accident that this repository's mirror aliases
  // `FrameServices` to `never` while kernel aliases it to `ClockPort`. What
  // this test means — and what the paragraph above claims — is 「`run` demands
  // nothing BEYOND the frame contract」, and `FrameServices` is how that
  // sentence is spelled. It is the same assertion today, because the alias is
  // `never` today; it is still the right assertion after the repoint, when a
  // stage that reached for `ChunkStore` would fail this line exactly as it
  // would have before.
  it.effect('REGRESSION: the store is acquired at registration, never demanded by `run`', () =>
    Effect.gen(function* () {
      const stages = yield* registeredStages

      for (const stage of stages) {
        const runnable: Effect.Effect<void, never, FrameServices> = stage.run(DeltaTimeSecs(0.016))
        yield* runnable
      }
    }).pipe(Effect.provide(FrameServicesLayer)),
  )
})
