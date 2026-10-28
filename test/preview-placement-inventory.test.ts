import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { makeTimeService, PlayerStorageSnapshotSchema } from '@nerima-games/mc-sim'
import { blockPosition } from './support/coordinate-fixtures'
import { gameplayStages } from '../src/stages/registration'
import { makeGameplayCommitServices } from './support/transactional-stage-doubles'
import { makePreviewPlayer } from '../apps/preview-mining-site/player'
import { makeSite, requestPlace, schedule, stepFrame, type Site } from '../apps/preview-mining-site/site'
import { AIR, STONE } from '../apps/preview-mining-site/world'

const TARGET = blockPosition(2, 64, 0)

const withRegisteredPlayerStorage = (site: Site) =>
  Effect.gen(function* () {
    const player = yield* makePreviewPlayer
    const time = yield* makeTimeService()
    const commit = yield* makeGameplayCommitServices(site.world.api, site.inventoryService.api, {
      playerPose: yield* player.pose,
      dimension: yield* player.dimension,
    })
    const stages = schedule(gameplayStages(
      site.state,
      site.world.api,
      site.roster,
      site.inventoryService.api,
      player,
      time,
      undefined,
      undefined,
      {},
      commit,
    ))
    return { site: { ...site, stages }, commit }
  })

const ownerItemCount = (
  storage: Schema.Schema.Type<typeof PlayerStorageSnapshotSchema>,
  item: string,
): number => storage.inventory.slots.reduce(
  (total, slot) => total + (slot?.item === item ? slot.count : 0),
  0,
)

describe('preview placement inventory bridge', () => {
  it.effect('charges exactly one item for a successful placement', () =>
    Effect.gen(function* () {
      const base = yield* makeSite(
        { cells: [], loadedChunks: ['0,0'], z: 0 },
        { width: 4, height: 4 },
        'placement-inventory',
      )
      yield* base.inventoryService.api.add('stone', 2)
      const { site, commit } = yield* withRegisteredPlayerStorage(base)

      yield* requestPlace(site, TARGET, 'stone')
      const frame = yield* stepFrame(site)

      expect(site.world.peekBlock(TARGET)).toBe(STONE)
      expect(site.inventory.get('stone')).toBe(2)
      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      expect(ownerItemCount(Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(storage.state), 'stone')).toBe(1)
      expect(frame.spent).toStrictEqual(['stone'])
    }),
  )

  it.effect('does not place when the inventory is empty', () =>
    Effect.gen(function* () {
      const base = yield* makeSite(
        { cells: [], loadedChunks: ['0,0'], z: 0 },
        { width: 4, height: 4 },
        'placement-inventory',
      )
      const { site, commit } = yield* withRegisteredPlayerStorage(base)

      yield* requestPlace(site, TARGET, 'stone')
      const frame = yield* stepFrame(site)

      expect(site.world.peekBlock(TARGET) ?? AIR).toBe(AIR)
      expect(site.inventory.get('stone') ?? 0).toBe(0)
      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      expect(ownerItemCount(Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(storage.state), 'stone')).toBe(0)
      expect(frame.spent).toStrictEqual([])
    }),
  )

  it.effect('restores the reserved item when placement is refused', () =>
    Effect.gen(function* () {
      const base = yield* makeSite(
        { cells: [[TARGET.x, TARGET.y, STONE]], loadedChunks: ['0,0'], z: 0 },
        { width: 4, height: 4 },
        'placement-inventory',
      )
      yield* base.inventoryService.api.add('stone', 1)
      const { site, commit } = yield* withRegisteredPlayerStorage(base)

      yield* requestPlace(site, TARGET, 'stone')
      const frame = yield* stepFrame(site)

      expect(site.world.peekBlock(TARGET)).toBe(STONE)
      expect(site.inventory.get('stone')).toBe(1)
      const storage = yield* commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema)
      expect(ownerItemCount(Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(storage.state), 'stone')).toBe(1)
      expect(frame.spent).toStrictEqual([])
    }),
  )
})
