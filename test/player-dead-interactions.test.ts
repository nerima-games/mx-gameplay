import { describe, expect, it } from '@effect/vitest'
import { emptyFurnaceState, makeTimeService } from '@nerima-games/mc-sim'
import { Effect, Ref } from 'effect'
import { positionKeyOf } from '../src/domain/block-position-key'
import { type MobBehaviour } from '../src/domain/entities/mob-frame'
import { DeltaTimeSecs } from '../src/domain/frame-contract'
import {
  drainBlockPlacementResults,
  drainBlockUseResults,
  drainBowShotResults,
  drainItemUseResults,
  drainMeleeAttackResults,
  drainVillagerTradeResults,
  gameplayStages,
  makeGameplayFrameState,
  requestBlockBreak,
  requestBlockPlacement,
  requestBlockPlacementCommand,
  requestBlockUse,
  requestBowShot,
  requestFurnaceAdvance,
  requestItemUse,
  requestMeleeAttack,
  requestVillagerTrade,
  setPlayerDead,
} from '../src/stages/registration'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import { makeChunkStoreDouble, STONE, world } from './support/chunk-store-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { FrameServicesLayer } from './support/frame-services'
import { makeInventoryDouble } from './support/inventory-service-double'
import { makePlayerServiceDouble } from './support/player-service-double'

const cell = { x: 1, y: 64, z: 1 }
const shot = {
  origin: { x: 0, y: 64, z: 0 },
  dirX: 0,
  dirY: 0,
  dirZ: 1,
  chargeSecs: 1,
  inventory: { mode: 'creative', slotIndex: 0 },
} as const
const melee = {
  origin: { x: 0, y: 64, z: 0 },
  direction: { x: 0, y: 0, z: 1 },
  reach: 3,
  damage: 4,
}

const scene = Effect.gen(function* () {
  const state = yield* makeGameplayFrameState
  const store = yield* makeChunkStoreDouble(world([[cell, STONE]]), ['0,0'])
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const player = yield* makePlayerServiceDouble()
  const inventory = yield* makeInventoryDouble()
  const time = yield* makeTimeService()
  const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api, time)
  const interactions = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)!
  const runInteractions = interactions.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
  return { state, store, inventory, runInteractions }
})

describe('dead-player interaction boundary', () => {
  it.effect('drains a mixed queue, rejects only correlated work, and has no side effects', () =>
    Effect.gen(function* () {
      const { state, store, inventory, runInteractions } = yield* scene
      yield* setPlayerDead(state, true)

      yield* requestBlockBreak(state, cell)
      yield* requestBlockPlacementCommand(state, {
        requestId: 'place',
        positionKey: positionKeyOf({ x: 2, y: 64, z: 1 }),
        heldItem: 'sand',
      })
      yield* requestBlockPlacement(state, {
        positionKey: positionKeyOf({ x: 3, y: 64, z: 1 }),
        heldItem: 'sand',
      })
      yield* requestBlockUse(state, 'use-block', cell)
      yield* requestItemUse(state, 'use-item', cell, 'flint_and_steel')
      yield* requestBowShot(state, 'bow', shot)
      yield* requestBowShot(state, shot)
      yield* requestMeleeAttack(state, { requestId: 'melee', ...melee })
      yield* requestMeleeAttack(state, melee)
      yield* Ref.set(state.pendingPearlThrows, [{ ...shot }])
      yield* requestVillagerTrade(state, {
        requestId: 'trade',
        villagerId: 'villager',
        offerId: 'offer',
      })

      yield* runInteractions

      expect(yield* drainBlockPlacementResults(state)).toStrictEqual([
        {
          requestId: 'place',
          success: false,
          consumed: false,
          replayed: false,
          outcome: { _tag: 'PlayerDead' },
        },
      ])
      expect(yield* drainBlockUseResults(state)).toStrictEqual([
        { requestId: 'use-block', success: false, outcome: 'PlayerDead' },
      ])
      expect(yield* drainItemUseResults(state)).toStrictEqual([
        { requestId: 'use-item', success: false, outcome: 'PlayerDead' },
      ])
      expect(yield* drainBowShotResults(state)).toStrictEqual([
        { requestId: 'bow', success: false, outcome: 'PlayerDead' },
      ])
      expect(yield* drainMeleeAttackResults(state)).toStrictEqual([
        { requestId: 'melee', success: false, outcome: 'PlayerDead' },
      ])
      expect(yield* drainVillagerTradeResults(state)).toStrictEqual([
        {
          requestId: 'trade',
          villagerId: 'villager',
          offerId: 'offer',
          _tag: 'Rejected',
          reason: 'PlayerDead',
        },
      ])

      expect(yield* Ref.get(state.pendingBreaks)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingPlacements)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingBlockUses)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingBowShots)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingMeleeAttacks)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingPearlThrows)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingVillagerTrades)).toStrictEqual([])
      expect(yield* Ref.get(state.enderPearlOutcomes)).toStrictEqual([])
      expect(yield* Ref.get(state.consumedItems)).toStrictEqual([])
      expect(yield* Ref.get(state.usedItems)).toStrictEqual([])
      expect(yield* inventory.withdrawals).toStrictEqual([])
      expect(yield* inventory.deposits).toStrictEqual([])
      expect(yield* store.api.getBlock(cell)).toStrictEqual({ _tag: 'Block', block: STONE })

      expect(yield* drainBlockPlacementResults(state)).toStrictEqual([])
      expect(yield* drainBlockUseResults(state)).toStrictEqual([])
      expect(yield* drainItemUseResults(state)).toStrictEqual([])
      expect(yield* drainBowShotResults(state)).toStrictEqual([])
      expect(yield* drainMeleeAttackResults(state)).toStrictEqual([])
      expect(yield* drainVillagerTradeResults(state)).toStrictEqual([])
    }),
  )

  it.effect('preserves placement replay and bow duplicate request contracts while dead', () =>
    Effect.gen(function* () {
      const { state, runInteractions } = yield* scene
      yield* setPlayerDead(state, true)
      const placement = {
        requestId: 'same-placement',
        positionKey: positionKeyOf({ x: 2, y: 64, z: 1 }),
        heldItem: 'sand' as const,
      } as const

      yield* requestBlockPlacementCommand(state, placement)
      yield* requestBowShot(state, 'same-bow', shot)
      yield* runInteractions
      expect(yield* drainBlockPlacementResults(state)).toMatchObject([
        { requestId: 'same-placement', replayed: false, outcome: { _tag: 'PlayerDead' } },
      ])
      expect(yield* drainBowShotResults(state)).toStrictEqual([
        { requestId: 'same-bow', success: false, outcome: 'PlayerDead' },
      ])

      yield* requestBlockPlacementCommand(state, placement)
      yield* requestBlockPlacementCommand(state, {
        ...placement,
        positionKey: positionKeyOf({ x: 4, y: 64, z: 1 }),
      })
      yield* requestBowShot(state, 'same-bow', shot)
      yield* runInteractions
      expect(yield* drainBlockPlacementResults(state)).toMatchObject([
        { requestId: 'same-placement', replayed: true, outcome: { _tag: 'PlayerDead' } },
        { requestId: 'same-placement', replayed: true, outcome: { _tag: 'RequestIdConflict' } },
      ])
      expect(yield* drainBowShotResults(state)).toStrictEqual([
        { requestId: 'same-bow', success: false, outcome: 'DuplicateRequest' },
      ])
    }),
  )

  it.effect('continues autonomous furnace item use while rejecting player item use', () =>
    Effect.gen(function* () {
      const { state, runInteractions } = yield* scene
      yield* setPlayerDead(state, true)
      yield* requestItemUse(state, 'player-use', cell, 'flint_and_steel')
      yield* requestFurnaceAdvance(state, 'furnace', emptyFurnaceState(), 10)

      yield* runInteractions

      expect(yield* drainItemUseResults(state)).toMatchObject([
        { requestId: 'player-use', success: false, outcome: 'PlayerDead' },
        { action: 'AdvanceFurnace', requestId: 'furnace', success: false },
      ])
      expect(yield* Ref.get(state.pendingItemUses)).toStrictEqual([])
    }),
  )
})
