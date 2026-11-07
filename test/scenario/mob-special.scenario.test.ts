import { describe, expect, it } from '@effect/vitest'
import { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import { Effect } from 'effect'
import { makeInMemoryWorld } from '../../src/domain/in-memory-world'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import {
  ENDER_DRAGON_CONTACT_DAMAGE,
  ENDER_DRAGON_DEATH_XP,
  ENDER_DRAGON_MAX_HEALTH,
} from '../../src/domain/mob/ender-dragon-encounter'
import { gameplayStages, makeGameplayFrameState } from '../../src/stages/registration'
import { GAMEPLAY_STAGE_IDS } from '../../src/stages/stage-ids'
import { makeGameplayCommitServices } from '../support/transactional-stage-doubles'
import { runFrame } from '../support/frame-runner'

describe('special mob gameplay scenarios', () => {
  it.effect('advances the Ender Dragon stage and delivers its terminal rewards once', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld<MobBehaviour>({ dimension: 'end' })
      const state = yield* makeGameplayFrameState
      const playerPose = yield* world.player.pose
      const dimension = yield* world.player.dimension
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory, {
        playerPose,
        dimension,
      })
      const stages = gameplayStages(
        state,
        world.chunkStore,
        world.entities,
        world.inventory,
        world.player,
        world.time,
        undefined,
        undefined,
        {},
        commit,
      )
      const dragonStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.enderDragon)
      if (dragonStage === undefined) throw new Error('gameplayStages must register the Ender Dragon stage')

      yield* runFrame(stages, DeltaTimeSecs(14))

      expect(yield* state.enderDragonEncounter.snapshot).toMatchObject({
        phase: 'charging',
        phaseTimerSecs: 0,
        health: ENDER_DRAGON_MAX_HEALTH,
        rewardEmitted: false,
      })
      expect(yield* state.enderDragonEncounter.drainEvents).toStrictEqual([
        { _tag: 'PlayerDamaged', amount: ENDER_DRAGON_CONTACT_DAMAGE },
      ])

      const death = yield* state.enderDragonEncounter.damageByPlayer(ENDER_DRAGON_MAX_HEALTH)
      expect(death._tag).toBe('Applied')
      expect(yield* state.enderDragonEncounter.snapshot).toMatchObject({
        phase: 'dead',
        health: 0,
        rewardEmitted: true,
      })
      const deathEvents = yield* state.enderDragonEncounter.drainEvents
      expect(deathEvents).toContainEqual({
        _tag: 'ExperienceRewarded',
        amount: ENDER_DRAGON_DEATH_XP,
      })
      expect(deathEvents.filter((event) => event._tag === 'ExperienceRewarded')).toHaveLength(1)
      expect(deathEvents.filter((event) => event._tag === 'ExitPortalMaterializationRequested')).toHaveLength(1)
      expect(deathEvents.filter((event) => event._tag === 'DragonEggRewarded')).toHaveLength(1)
      expect(yield* state.enderDragonEncounter.drainEvents).toStrictEqual([])

      yield* runFrame(stages, DeltaTimeSecs(14))
      expect(yield* state.enderDragonEncounter.snapshot).toMatchObject({
        phase: 'dead',
        health: 0,
        rewardEmitted: true,
      })
      expect(yield* state.enderDragonEncounter.drainEvents).toStrictEqual([])
    }),
  )
})
