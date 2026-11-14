import { describe, expect, it } from '@effect/vitest'
import fc from 'fast-check'
import { makeTimeService } from '@nerima-games/mc-sim'
import { DeltaTimeSecs, blockPositionKeyOf } from '@nerima-games/mc-kernel'
import { Effect, Ref, Result } from 'effect'
import {
  carryOver,
  MAX_FLUID_DEFERRED_ATTEMPTS,
  splitBudget,
  type FluidWorkItem,
} from '../../src/domain/fluid-frontier'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { makeInventoryDouble } from '../support/inventory-service-double'
import { makePlayerServiceDouble } from '../support/player-service-double'
import { makeChunkStoreDouble, world } from '../support/chunk-store-double'
import { gameplayStages, makeGameplayFrameStateForOwner } from '../../src/stages/registration'
import { GAMEPLAY_STAGE_IDS } from '../../src/stages/stage-ids'
import { GAMEPLAY_VITALS_OWNER_ID } from '../../src/stages/gameplay-owner-registrations'
import { makeGameplayCommitServices } from '../support/transactional-stage-doubles'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { blockPosition } from '../support/coordinate-fixtures'
import { runFrame } from '../support/frame-runner'

const fluidSlice = Effect.gen(function* () {
  const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
  const unavailableStore: ChunkStoreApi = {
    ...store.api,
    getBlock: () => Effect.succeed({ _tag: 'ChunkNotLoaded' }),
  }
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const inventory = yield* makeInventoryDouble()
  const player = yield* makePlayerServiceDouble()
  const time = yield* makeTimeService()
  const commit = yield* makeGameplayCommitServices(unavailableStore, inventory.api)
  const state = yield* makeGameplayFrameStateForOwner({
    coordinator: commit.coordinator,
    vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
  })
  const stages = gameplayStages(state, unavailableStore, roster.api, inventory.api, player.api, time, undefined, undefined, {}, commit)
  const fluidStage = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fluids)
  if (fluidStage === undefined) throw new Error('the fluid stage was not registered')
  return { state, stages, fluidStage }
})

describe('environment fluid properties', () => {
  it('keeps budgeted work and carry-over as a complete, bounded frontier partition', () => {
    // Catches budget overruns and frontier entries lost or duplicated during allocation.
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({ id: fc.integer({ min: -64, max: 64 }), kind: fc.constantFrom('water', 'lava') }),
          { selector: (item) => item.id, maxLength: 64 },
        ),
        fc.integer({ min: 0, max: 96 }),
        fc.boolean(),
        (entries, budget, lavaTickActive) => {
          const frontier: ReadonlyArray<FluidWorkItem> = entries.map(({ id, kind }) => ({
            key: blockPositionKeyOf(blockPosition(0, id, 0)),
            kind,
          }))
          const split = splitBudget(frontier, { budget, lavaTickActive })
          if (Result.isFailure(split)) return false
          const retained = carryOver(frontier, split.success)
          const partition = [...split.success.work, ...retained]
          const identify = (item: FluidWorkItem): string => `${item.kind}:${item.key}`
          const water = frontier.filter((item) => item.kind === 'water')
          const lava = frontier.filter((item) => item.kind === 'lava')
          const waterWork = water.slice(0, Math.floor(budget / 2))
          const lavaWork = lavaTickActive
            ? lava.slice(0, budget - waterWork.length)
            : []

          expect(split.success.work.length).toBeLessThanOrEqual(budget)
          expect(split.success.work.filter((item) => item.kind === 'water').length).toBeLessThanOrEqual(
            Math.floor(budget / 2),
          )
          expect(split.success.work).toStrictEqual([...waterWork, ...lavaWork])
          if (!lavaTickActive) {
            expect(split.success.work.filter((item) => item.kind === 'lava')).toStrictEqual([])
          }
          expect(new Set(partition.map(identify)).size).toBe(frontier.length)
          expect(partition.map(identify).sort()).toStrictEqual(frontier.map(identify).sort())
        },
      ),
    )
  })

  it('rejects every explicit budget outside the nonnegative safe-integer range', () => {
    fc.assert(
      fc.property(fc.double(), (budget) => {
        const result = splitBudget([], { budget, lavaTickActive: true })
        const valid = Number.isSafeInteger(budget) && budget >= 0
        return valid ? Result.isSuccess(result) : Result.isFailure(result)
      }),
    )
  })

  it('retries an unloaded fluid only through its configured attempt limit', async () => {
    // Catches an off-by-one that either drops fluid early or retries it forever.
    const { state, stages } = await Effect.runPromise(fluidSlice)
    const key = blockPositionKeyOf(blockPosition(0, 64, 0))

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: MAX_FLUID_DEFERRED_ATTEMPTS }),
        async (deferred) => {
          await Effect.runPromise(Ref.set(state.fluidFrontier, [{ key, kind: 'water', deferred }]))
          await Effect.runPromise(runFrame(stages, DeltaTimeSecs(1 / 60)))

          const retry = (await Effect.runPromise(Ref.get(state.fluidFrontier))).find(
            (item) => item.key === key,
          )
          if (deferred < MAX_FLUID_DEFERRED_ATTEMPTS) {
            expect(retry?.deferred).toBe(deferred + 1)
          } else {
            expect(retry).toBeUndefined()
          }
        },
      ),
    )
  })
})
