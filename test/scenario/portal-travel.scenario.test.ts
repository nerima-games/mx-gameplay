import { describe, expect, it } from '@effect/vitest'
import { DeltaTimeSecs, BlockAxis, BlockId, PositionAxis, blockPosition, blockIdOf, type BlockPosition } from '@nerima-games/mc-kernel'
import { makeTimeService, PlayerServiceSnapshotSchema, type PlayerPose } from '@nerima-games/mc-sim'
import { END_PORTAL_BLOCK, type Dimension } from '@nerima-games/mc-worldgen'
import { Effect, Option } from 'effect'
import {
  drainEndPortalTravels,
  drainPortalTravels,
  gameplayStages,
  makeGameplayFrameState,
} from '../../src/stages/registration'
import type { GameplayStageCommitServices } from '../../src/stages/registration-core'
import { makeGameplayCommitServices, makeTransactionalChunkStoreDouble } from '../support/transactional-stage-doubles'
import { world } from '../support/chunk-store-double'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { runFrames } from '../support/frame-runner'
import { makeInventoryDouble } from '../support/inventory-service-double'
import { SPAWN_POSE } from '../support/player-service-double'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import { PORTAL_ACTIVATION_SECS, PORTAL_REENTRY_COOLDOWN_SECS } from '../../src/domain/portal-dwell'

const atBlockPosition = (x: number, y: number, z: number): BlockPosition =>
  blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))

const playerPoseAt = (cell: BlockPosition): PlayerPose => ({
  ...SPAWN_POSE,
  feetPosition: {
    x: PositionAxis(cell.x),
    y: PositionAxis(cell.y),
    z: PositionAxis(cell.z),
  },
})

const makePortalScenario = (
  blocks: ReadonlyArray<readonly [BlockPosition, BlockId]>,
  initialCell: BlockPosition,
  initialDimension: Dimension,
) =>
  Effect.gen(function* () {
    const store = yield* makeTransactionalChunkStoreDouble(world(blocks), ['0,0'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble()
    const commit = yield* makeGameplayCommitServices(store.api, inventory.api, {
      playerPose: playerPoseAt(initialCell),
      dimension: initialDimension,
    })
    const time = yield* makeTimeService()
    const state = yield* makeGameplayFrameState
    const stages = gameplayStages(
      state,
      store.api,
      roster.api,
      inventory.api,
      undefined,
      time,
      undefined,
      undefined,
      {},
      commit,
    )

    return { commit, state, stages }
  })

const snapshot = (commit: GameplayStageCommitServices) =>
  commit.coordinator.snapshot(commit.playerOwnerId, PlayerServiceSnapshotSchema)

describe('portal travel through gameplay stages', () => {
  const frameSeconds = 0.1
  const delta = DeltaTimeSecs(frameSeconds)
  const framesFor = (seconds: number) => Math.ceil(seconds / frameSeconds)
  const activationFrames = framesFor(PORTAL_ACTIVATION_SECS) + 1
  const cooldownFrames = framesFor(PORTAL_REENTRY_COOLDOWN_SECS)
  const cooldownProbeFrames = Math.max(0, cooldownFrames - 1)
  const framesAfterCooldownProbe = cooldownFrames - cooldownProbeFrames + framesFor(PORTAL_ACTIVATION_SECS)

  it.effect('crosses a Nether portal both ways and waits out cooldown before returning', () =>
    Effect.gen(function* () {
      const overworldCell = atBlockPosition(8, 64, 8)
      const netherCell = atBlockPosition(1, 64, 1)
      const netherPortal = Option.getOrElse(blockIdOf('nether_portal'), () => BlockId(118))
      const { commit, state, stages } = yield* makePortalScenario(
        [[overworldCell, netherPortal], [netherCell, netherPortal]],
        overworldCell,
        'overworld',
      )

      const before = yield* snapshot(commit)
      expect(before.state.pose.feetPosition).toStrictEqual({ dimension: 'overworld', x: 8, y: 64, z: 8 })

      yield* runFrames(stages, activationFrames, delta)

      const nether = yield* snapshot(commit)
      expect(nether.state.pose.feetPosition).toStrictEqual({ dimension: 'nether', x: 1, y: 64, z: 1 })
      const [outbound] = yield* drainPortalTravels(state)
      expect(outbound?.sourceDimension).toBe('overworld')
      expect(outbound?.sourcePosition).toStrictEqual(overworldCell)
      expect(outbound?.plan.toDimension).toBe('nether')
      expect(outbound?.plan.destination).toStrictEqual(netherCell)

      yield* runFrames(stages, cooldownProbeFrames, delta)

      const cooling = yield* snapshot(commit)
      expect(cooling.state.pose.feetPosition).toStrictEqual({ dimension: 'nether', x: 1, y: 64, z: 1 })
      expect(yield* drainPortalTravels(state)).toStrictEqual([])

      yield* runFrames(stages, framesAfterCooldownProbe, delta)

      const returned = yield* snapshot(commit)
      expect(returned.state.pose.feetPosition).toStrictEqual({ dimension: 'overworld', x: 8, y: 64, z: 8 })
      const [inbound] = yield* drainPortalTravels(state)
      expect(inbound?.sourceDimension).toBe('nether')
      expect(inbound?.sourcePosition).toStrictEqual(netherCell)
      expect(inbound?.plan.toDimension).toBe('overworld')
      expect(inbound?.plan.destination).toStrictEqual(overworldCell)
    }),
  )

  it.effect('crosses an End portal out and back after the re-entry cooldown', () =>
    Effect.gen(function* () {
      const overworldCell = atBlockPosition(0, 64, 0)
      const endArrivalCell = atBlockPosition(0, 61, 0)
      // The stage consumes an active portal block; frame filling is not wired to a gameplay stage.
      const { commit, state, stages } = yield* makePortalScenario(
        [
          [overworldCell, END_PORTAL_BLOCK.PORTAL],
          [endArrivalCell, END_PORTAL_BLOCK.PORTAL],
        ],
        overworldCell,
        'overworld',
      )

      yield* runFrames(stages, activationFrames, delta)

      const end = yield* snapshot(commit)
      expect(end.state.pose.feetPosition).toStrictEqual({ dimension: 'end', x: 0, y: 61, z: 0 })
      const [outbound] = yield* drainEndPortalTravels(state)
      expect(outbound?.sourceDimension).toBe('overworld')
      expect(outbound?.toDimension).toBe('end')
      expect(outbound?.destination).toStrictEqual(endArrivalCell)
      expect(outbound?.arrival?.platform).toHaveLength(25)

      yield* runFrames(stages, cooldownProbeFrames, delta)

      const cooling = yield* snapshot(commit)
      expect(cooling.state.pose.feetPosition).toStrictEqual({ dimension: 'end', x: 0, y: 61, z: 0 })
      expect(yield* drainEndPortalTravels(state)).toStrictEqual([])

      yield* runFrames(stages, framesAfterCooldownProbe, delta)

      const overworld = yield* snapshot(commit)
      expect(overworld.state.pose.feetPosition).toStrictEqual({ dimension: 'overworld', x: 0, y: 64, z: 0 })
      const [inbound] = yield* drainEndPortalTravels(state)
      expect(inbound?.sourceDimension).toBe('end')
      expect(inbound?.toDimension).toBe('overworld')
      expect(inbound?.destination).toStrictEqual(overworldCell)
      expect(inbound?.arrival).toBeUndefined()
    }),
  )
})
