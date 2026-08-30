import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import { makeSite, stepFrame } from '../apps/preview-mining-site/site'
import { EntityId } from '@nerima-games/mc-sim'
import { StageId } from '@nerima-games/mc-kernel'
import {
  CREEPER_KIND,
  isDroppedItemBehaviour,
  type MobDropEvent,
  type MobExperienceEvent,
} from '../src/domain/entities/mob-frame'

describe('preview mob reward host bridge', () => {
  it.effect('materialises death drops and credits XP exactly once', () =>
    Effect.gen(function* () {
      const site = yield* makeSite(
        { cells: [], loadedChunks: ['0,0'], z: 0 },
        { width: 1, height: 1 },
        'mob-rewards',
      )
      const at = { x: 1, y: 64, z: 0 }
      const source = EntityId('dead-creeper')
      const drop: MobDropEvent = {
        item: 'gunpowder',
        count: 2,
        source,
        kind: CREEPER_KIND,
        at,
      }
      const experience: MobExperienceEvent = {
        source,
        kind: CREEPER_KIND,
        at,
        amount: 5,
      }
      let emitted = false
      const stagedSite = {
        ...site,
        stages: [
          {
            id: StageId('gameplay:test:mob-rewards'),
            run: () => {
              if (emitted) return Effect.void
              emitted = true
              return Effect.all(
                [
                  Ref.set(site.state.mobDrops, [drop]),
                  Ref.set(site.state.mobExperience, [experience]),
                ],
                { discard: true },
              )
            },
          },
        ],
      }

      yield* stepFrame(stagedSite)

      const entitiesAfterFirstDrain = yield* stagedSite.roster.entities
      const droppedItem = entitiesAfterFirstDrain.find((entity) =>
        isDroppedItemBehaviour(entity.behaviour),
      )
      expect(droppedItem?.feetPosition).toStrictEqual(at)
      expect(droppedItem?.behaviour).toMatchObject({
        _tag: 'DroppedItem',
        item: 'gunpowder',
        count: 2,
      })
      expect(stagedSite.experience).toBe(5)
      expect(stagedSite.experienceLedger).toStrictEqual([experience])
      expect(yield* Ref.get(stagedSite.state.mobDrops)).toStrictEqual([])
      expect(yield* Ref.get(stagedSite.state.mobExperience)).toStrictEqual([])

      yield* stepFrame(stagedSite)

      expect(yield* stagedSite.roster.count).toBe(1)
      expect(stagedSite.experience).toBe(5)
      expect(stagedSite.experienceLedger).toStrictEqual([experience])
    }),
  )
})
