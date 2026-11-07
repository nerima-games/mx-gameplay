import { describe, expect, it } from '@effect/vitest'
import {
  EntityHealthPoints,
  blockIdOf,
  type BlockId,
  type BlockType,
} from '@nerima-games/mc-kernel'
import {
  EntitySerial,
  makeTimeService,
  type EntityManagerApi,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { Effect, Option } from 'effect'
import { CREEPER_KIND, CREEPER_MAX_HEALTH, type MobBehaviour } from '../../src/domain/entities/mob-frame'
import { CREEPER_EXPLOSION_POWER } from '../../src/domain/mob/explosion'
import { CREEPER_FUSE_SECS } from '../../src/domain/mob/creeper-fuse'
import { gameplayStages, makeGameplayFrameStateForOwner } from '../../src/stages/registration'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayEntityRosterSchema,
} from '../../src/stages/gameplay-owner-registrations'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { emptySlots, makeInventoryDouble } from '../support/inventory-service-double'
import { makePlayerServiceDouble } from '../support/player-service-double'
import { blockPosition as atBlockPosition, position as atPosition } from '../support/coordinate-fixtures'
import { STONE, world } from '../support/chunk-store-double'
import { runFrame } from '../support/frame-runner'
import {
  makeGameplayCommitServices,
  makeTransactionalChunkStoreDouble,
} from '../support/transactional-stage-doubles'

const registeredBlockId = (type: BlockType): BlockId => {
  return Option.getOrElse(blockIdOf(type), () => {
    throw new Error(`missing block registry entry: ${type}`)
  })
}

const BEDROCK = registeredBlockId('bedrock')
const creeperAt = atBlockPosition(5, 64, 5)
const blastRadius = Math.floor(CREEPER_EXPLOSION_POWER)
const blastCell = (distance: number) => atBlockPosition(creeperAt.x + distance, creeperAt.y, creeperAt.z)
const resistantAt = blastCell(1)
const boundaryAt = blastCell(blastRadius)
const outsideAt = blastCell(blastRadius + 1)

const makeCraterScenario = () =>
  Effect.gen(function* () {
    const store = yield* makeTransactionalChunkStoreDouble(
      world([
        [creeperAt, STONE],
        [resistantAt, BEDROCK],
        [boundaryAt, STONE],
        [outsideAt, STONE],
      ]),
      ['0,0'],
    )
    const roster = yield* makeEntityManagerDouble<MobBehaviour>()
    const inventory = yield* makeInventoryDouble(emptySlots())
    const player = yield* makePlayerServiceDouble({
      feetPosition: atPosition(creeperAt.x - 2, creeperAt.y, creeperAt.z),
      yawRadians: 0,
      pitchRadians: 0,
    })
    const time = yield* makeTimeService()
    const playerPose = yield* player.api.pose
    const dimension = yield* player.api.dimension
    const commit = yield* makeGameplayCommitServices(store.api, inventory.api, { playerPose, dimension })
    const state = yield* makeGameplayFrameStateForOwner({
      coordinator: commit.coordinator,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    })
    const stages = gameplayStages(
      state,
      store.api,
      roster.api,
      inventory.api,
      player.api,
      time,
      undefined,
      undefined,
      {},
      commit,
    )

    return { commit, roster, stages, store }
  })

const syncGameplayEntityOwner = (
  coordinator: WorldCommitCoordinatorApi,
  roster: Readonly<{ api: EntityManagerApi<MobBehaviour> }>,
) =>
  Effect.gen(function* () {
    const entities = yield* roster.api.entities
    const current = yield* coordinator.snapshot(GAMEPLAY_ENTITIES_OWNER_ID, GameplayEntityRosterSchema)
    yield* coordinator.commit({
      expectedRevision: current.revision,
      expectedDimensions: [],
      changes: [{
        ownerId: GAMEPLAY_ENTITIES_OWNER_ID,
        state: {
          entities: entities.map((entity) => ({ ...entity, dimension: 'overworld' as const })),
          nextSerial: EntitySerial(entities.length),
        },
      }],
    })
  })

describe('explosion crater scenario', () => {
  it.effect('carves the powered radius, preserves bedrock, and leaves the next cell intact', () =>
    Effect.gen(function* () {
      const { commit, roster, stages, store } = yield* makeCraterScenario()
      yield* roster.api.spawn({
        kind: CREEPER_KIND,
        feetPosition: atPosition(creeperAt.x, creeperAt.y, creeperAt.z),
        healthPoints: EntityHealthPoints(CREEPER_MAX_HEALTH),
        behaviour: { _tag: 'Lit', burnedSecs: CREEPER_FUSE_SECS - 0.01 },
      })
      yield* syncGameplayEntityOwner(commit.coordinator, roster)

      yield* runFrame(stages)

      expect(yield* store.blockAt(creeperAt)).toBeUndefined()
      expect(yield* store.blockAt(resistantAt)).toBe(BEDROCK)
      expect(yield* store.blockAt(boundaryAt)).toBeUndefined()
      expect(yield* store.blockAt(outsideAt)).toBe(STONE)
      const entitySnapshot = yield* commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      expect(entitySnapshot.state.entities).toHaveLength(0)
    }),
  )
})
