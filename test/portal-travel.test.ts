import { describe, expect, it } from '@effect/vitest'
import { END_PORTAL_BLOCK, type Dimension } from '@nerima-games/mc-worldgen'
import { makeTimeService } from '@nerima-games/mc-sim'
import { Effect, Option, Ref } from 'effect'
import { type BlockPosition } from '../src/domain/chunk-store-port'
import {
  OVERWORLD_RETURN_POSITION,
  applyEndPortalTravel,
} from '../src/domain/end-portal-travel'
import { applyPortalTravel, NO_KNOWN_PORTALS } from '../src/domain/portal-travel'
import { type PlayerPose, type PlayerServiceApi } from '@nerima-games/mc-sim'
import { blockIdOf } from '@nerima-games/mc-kernel'
import { type MobBehaviour } from '../src/domain/entities/mob-frame'
import { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import {
  drainEndPortalTravels,
  drainPortalTravels,
  gameplayStages,
  makeGameplayFrameState,
  setPortalCandidates,
} from '../src/stages/registration'
import { makeChunkStoreDouble, world } from './support/chunk-store-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { makeInventoryDouble } from './support/inventory-service-double'
import { makePlayerServiceDouble } from './support/player-service-double'
import { runFrames } from './support/frame-runner'

/**
 * A PlayerService stand-in that records what was called on it.
 *
 * mc-sim is not a dependency yet, so the real service cannot be constructed
 * here. What this double must be faithful about is only the two members the rule
 * calls plus the one it reads — and the recording is the point: this file's job
 * is to assert that BOTH writes happen, so a double that merely stored the final
 * state could not tell "moved and switched" from "switched twice".
 */
const makeRecordingPlayer = (
  initial: Dimension,
): Effect.Effect<{
  readonly api: PlayerServiceApi
  readonly moves: Ref.Ref<ReadonlyArray<BlockPosition>>
  readonly switches: Ref.Ref<ReadonlyArray<Dimension>>
}> =>
  Effect.gen(function* () {
    const dimension = yield* Ref.make<Dimension>(initial)
    const moves = yield* Ref.make<ReadonlyArray<BlockPosition>>([])
    const switches = yield* Ref.make<ReadonlyArray<Dimension>>([])

    const unused = <A,>(): Effect.Effect<A> =>
      Effect.die('portal travel must not touch this member') as Effect.Effect<A>

    const api: PlayerServiceApi = {
      pose: unused<PlayerPose>(),
      dimension: Ref.get(dimension),
      look: () => unused<PlayerPose>(),
      moveTo: (feetPosition) =>
        Ref.update(moves, (seen) => [
          ...seen,
          { x: feetPosition.x, y: feetPosition.y, z: feetPosition.z },
        ]),
      setDimension: (next) =>
        Effect.zipRight(
          Ref.set(dimension, next),
          Ref.update(switches, (seen) => [...seen, next]),
        ),
      cameraPose: unused(),
      restore: () => unused<void>(),
      reset: unused<void>(),
    }

    return { api, moves, switches }
  })

/**
 * THE WIRING TEST.
 *
 * `mx-gameplay/docs/responsibility.md` recorded that 「今日ここで書ける『移動』は
 * 1 つの世界の中での再配置でしかなく、**次元の切り替えは本当に無い**」. That
 * sentence is what this file exists to falsify, and the assertions are chosen so
 * that DELETING EITHER HALF of the wiring turns it red:
 *
 *   - drop `player.moveTo(...)` from `applyPortalTravel` and `moves` is empty;
 *   - drop `player.setDimension(...)` and `switches` is empty and the dimension
 *     is unchanged — which is precisely the 「callable but unreachable」 state
 *     this repository has had to fix repeatedly.
 *
 * A rule that is callable and never called passes every test that only checks
 * the rule. These check the CALL.
 */
describe('a portal crossing actually completes', () => {
  const overworldCell: BlockPosition = { x: 128, y: 64, z: -256 }

  it.effect('overworld to nether: the player moves AND the dimension changes', () =>
    Effect.gen(function* () {
      const { api, moves, switches } = yield* makeRecordingPlayer('overworld')

      const plan = yield* applyPortalTravel(api, overworldCell)

      // WHERE — mc-worldgen's rule, divided by eight.
      expect(plan.toDimension).toBe('nether')
      expect(plan.destination).toStrictEqual({
        x: 16,
        y: overworldCell.y,
        z: -32,
      })

      // APPLY — both halves, exactly once each.
      expect(yield* Ref.get(moves)).toStrictEqual([plan.destination])
      expect(yield* Ref.get(switches)).toStrictEqual(['nether'])

      // And the state the whole task was about.
      expect(yield* api.dimension).toBe('nether')
    }),
  )

  it.effect('nether to overworld: the reverse crossing multiplies by eight', () =>
    Effect.gen(function* () {
      const netherCell: BlockPosition = { x: 16, y: 70, z: -32 }
      const { api, moves, switches } = yield* makeRecordingPlayer('nether')

      const plan = yield* applyPortalTravel(api, netherCell)

      expect(plan.toDimension).toBe('overworld')
      expect(plan.destination).toStrictEqual({
        x: 128,
        y: netherCell.y,
        z: -256,
      })
      expect(yield* Ref.get(moves)).toStrictEqual([plan.destination])
      expect(yield* Ref.get(switches)).toStrictEqual(['overworld'])
      expect(yield* api.dimension).toBe('overworld')
    }),
  )

  /**
   * `from` IS READ, NOT PASSED, and this is the test that says so.
   *
   * If `applyPortalTravel` took `from` as an argument, a caller could hand it a
   * dimension the player is not in and the rule would scale in the wrong
   * direction with no type able to object. Reading it means the two can never
   * disagree — so a player in the End takes the End branch without anyone
   * choosing it.
   */
  it.effect('the end returns to the overworld, transcribed from the reference', () =>
    Effect.gen(function* () {
      const { api, switches } = yield* makeRecordingPlayer('end')

      const plan = yield* applyPortalTravel(api, { x: 8, y: 64, z: 8 })

      expect(plan.toDimension).toBe('overworld')
      expect(yield* Ref.get(switches)).toStrictEqual(['overworld'])
    }),
  )

  it.effect('a round trip returns to the starting dimension', () =>
    Effect.gen(function* () {
      const { api, switches } = yield* makeRecordingPlayer('overworld')

      yield* applyPortalTravel(api, overworldCell)
      yield* applyPortalTravel(api, { x: 16, y: 64, z: -32 })

      expect(yield* Ref.get(switches)).toStrictEqual(['nether', 'overworld'])
      expect(yield* api.dimension).toBe('overworld')
    }),
  )
})

describe('applyEndPortalTravel, called directly', () => {
  /**
   * The REACHABILITY suite below drives the overworld-to-end leg through the
   * real stage. It never drives a player standing IN the End back out, so
   * that branch of `applyEndPortalTravel` — the `else` of its one `if` — has
   * never run. This calls the APPLY step directly, the same way
   * `applyPortalTravel` is unit-tested above it, to reach it.
   */
  it.effect('the end returns a player to the deterministic overworld position', () =>
    Effect.gen(function* () {
      const { api, moves, switches } = yield* makeRecordingPlayer('end')

      const event = yield* applyEndPortalTravel(api, { x: 8, y: 64, z: 8 })

      expect(event.toDimension).toBe('overworld')
      expect(event.destination).toStrictEqual(OVERWORLD_RETURN_POSITION)
      expect(event.arrival).toBeUndefined()
      expect(yield* Ref.get(moves)).toStrictEqual([OVERWORLD_RETURN_POSITION])
      expect(yield* Ref.get(switches)).toStrictEqual(['overworld'])
      expect(yield* api.dimension).toBe('overworld')
    }),
  )
})

describe('portal candidate defaults', () => {
  it.effect('a direct caller without candidates plans a portal to create', () =>
    Effect.gen(function* () {
      const { api } = yield* makeRecordingPlayer('overworld')

      const plan = yield* applyPortalTravel(api, { x: 0, y: 64, z: 0 })

      expect(Option.isSome(plan.portalToCreate)).toBe(true)
      expect(NO_KNOWN_PORTALS).toStrictEqual([])
    }),
  )

  it.effect('a supplied candidate is reused', () =>
    Effect.gen(function* () {
      const { api, moves } = yield* makeRecordingPlayer('overworld')
      // Scales to { x: 16, y: 64, z: -32 }; the candidate sits one block off it.
      const departure: BlockPosition = { x: 128, y: 64, z: -256 }
      const existing: BlockPosition = { x: 17, y: 64, z: -31 }

      const plan = yield* applyPortalTravel(api, departure, [existing])

      expect(Option.isNone(plan.portalToCreate)).toBe(true)
      expect(plan.destination).toStrictEqual(existing)
      // The player is placed AT the reused portal, not at the scaled point —
      // arriving beside an existing portal is how a world grows two of them.
      expect(yield* Ref.get(moves)).toStrictEqual([existing])
    }),
  )
})

/**
 * REACHABILITY: the stage actually calls the rule.
 *
 * The tests above prove `applyPortalTravel` is CORRECT. This one proves it is
 * REACHED, and the two are different failures: a rule with a green test file and
 * no call site passes everything above while doing nothing in a running game.
 * `stages/registration.ts` names that state 「callable but unreachable」 and this
 * repository has had to correct it more than once.
 *
 * So this drives the REAL `gameplay:interactions` stage, through the real frame
 * runner, over a world with a portal block under the player — and asserts the
 * player ends up in the Nether. Deleting the `stepPortalTravel` call from the
 * stage leaves every test above green and turns this one red.
 *
 */
describe('REACHABILITY: the interactions stage performs the crossing', () => {
  const spawnCell: BlockPosition = { x: 0, y: 64, z: 0 }
  // `?? 118` matches `test/vertical-slice.test.ts`'s idiom: kernel's id is the
  // authority, and the literal is the fallback that keeps the test readable
  // rather than a second source of truth.
  const NETHER_PORTAL = blockIdOf('nether_portal') ?? 118

  const portalWorld = Effect.gen(function* () {
    const store = yield* makeChunkStoreDouble(world([[spawnCell, NETHER_PORTAL]]), ['0,0'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble()
    const player = yield* makePlayerServiceDouble()
    const time = yield* makeTimeService()
    const state = yield* makeGameplayFrameState
    return {
      player,
      state,
      stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api, time),
    }
  })

  it.effect('four seconds of standing in a portal block moves the player to the nether', () =>
    Effect.gen(function* () {
      const { player, state, stages } = yield* portalWorld

      expect(yield* player.api.dimension).toBe('overworld')
      expect(yield* Ref.get(state.portalCandidates)).toStrictEqual(new Map())
      expect(yield* drainPortalTravels(state)).toStrictEqual([])

      // Just under the activation time: nothing has fired yet, which is what
      // makes the assertion after it about the DWELL rather than about the very
      // first frame.
      yield* runFrames(stages, 200, DeltaTimeSecs(0.016))
      expect(yield* player.api.dimension).toBe('overworld')
      expect(yield* drainPortalTravels(state)).toStrictEqual([])

      // Past four seconds.
      yield* runFrames(stages, 100, DeltaTimeSecs(0.016))

      expect(yield* player.api.dimension).toBe('nether')
      // And the placement half ran too, through the same stage.
      expect((yield* Ref.get(player.moves)).length).toBeGreaterThan(0)

      const completed = yield* drainPortalTravels(state)
      expect(completed).toHaveLength(1)
      expect(completed[0]?.sourceDimension).toBe('overworld')
      expect(completed[0]?.sourcePosition).toStrictEqual(spawnCell)
      expect(completed[0]?.plan.toDimension).toBe('nether')
      expect(Option.isSome(completed[0]?.plan.portalToCreate ?? Option.none())).toBe(true)
      expect(yield* drainPortalTravels(state)).toStrictEqual([])

      yield* runFrames(stages, 100, DeltaTimeSecs(0.016))
      expect(yield* drainPortalTravels(state)).toStrictEqual([])
    }),
  )

  it.effect('uses only the destination dimension candidate snapshot', () =>
    Effect.gen(function* () {
      const { player, state, stages } = yield* portalWorld
      const wrongDimensionCandidate: BlockPosition = { x: 1, y: 64, z: 1 }
      const netherCandidate: BlockPosition = { x: 2, y: 64, z: 2 }

      yield* setPortalCandidates(state, 'overworld', [wrongDimensionCandidate])
      yield* setPortalCandidates(state, 'nether', [netherCandidate])
      yield* runFrames(stages, 300, DeltaTimeSecs(0.016))

      const [completed] = yield* drainPortalTravels(state)
      expect(completed?.plan.destination).toStrictEqual(netherCandidate)
      expect(Option.isNone(completed?.plan.portalToCreate ?? Option.some(undefined))).toBe(true)
      expect(yield* Ref.get(player.moves)).toStrictEqual([netherCandidate])
    }),
  )

  it.effect('standing outside a portal never fires, however long the frame runs', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inventory = yield* makeInventoryDouble()
      const player = yield* makePlayerServiceDouble()
      const time = yield* makeTimeService()
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api, time)

      yield* runFrames(stages, 600, DeltaTimeSecs(0.016))

      expect(yield* player.api.dimension).toBe('overworld')
      expect(yield* Ref.get(player.switches)).toStrictEqual([])
      expect(yield* drainPortalTravels(state)).toStrictEqual([])
    }),
  )

  it.effect('an End portal moves the player and emits the worldgen arrival plan', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([[spawnCell, END_PORTAL_BLOCK.PORTAL]]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inventory = yield* makeInventoryDouble()
      const player = yield* makePlayerServiceDouble()
      const time = yield* makeTimeService()
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api, time)

      yield* runFrames(stages, 300, DeltaTimeSecs(0.016))

      expect(yield* player.api.dimension).toBe('end')
      expect(yield* Ref.get(player.moves)).toStrictEqual([{ x: 0, y: 61, z: 0 }])

      const [completed] = yield* drainEndPortalTravels(state)
      expect(completed?.sourceDimension).toBe('overworld')
      expect(completed?.toDimension).toBe('end')
      expect(completed?.destination).toStrictEqual({ x: 0, y: 61, z: 0 })
      expect(completed?.arrival?.platform).toHaveLength(25)
      expect(completed?.arrival?.clear).toHaveLength(27)
      expect(yield* drainEndPortalTravels(state)).toStrictEqual([])
      expect(yield* drainPortalTravels(state)).toStrictEqual([])
    }),
  )
})
