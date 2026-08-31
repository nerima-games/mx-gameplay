/**
 * `droppedItemMetadataFromBehaviour` and `isDroppedItemPickupEligible` —
 * lowered from the composing app's `dropped-item-metadata.ts` and
 * `dropped-item-pickup.ts` into `domain/entities/dropped-item.ts` alongside the
 * behaviour they read.
 *
 * `pickupDroppedItems`'s own frame-gate scenario in `dropped-item-melee.test.ts`
 * already exercises `isDroppedItemPickupEligible`'s two branches end to end;
 * this file adds it as a direct, named unit so the boundary (`currentFrame ===
 * eligibleFromFrame`, the frame it becomes eligible) is pinned on the function
 * itself, not only through the roster sweep that happens to call it.
 */
import { describe, expect, it } from '@effect/vitest'
import { durabilityForItem } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import {
  droppedItemMetadataFromBehaviour,
  isDroppedItemPickupEligible,
  spawnDroppedItem,
} from '../src/domain/entities/dropped-item'
import {
  hostileMobSnapshot,
  STEADY_ENDERMAN,
  type DroppedItemBehaviour,
  type MobBehaviour,
} from '../src/domain/entities/mob-frame'
import { makeEntityManagerDouble } from './support/entity-manager-double'

const origin = { x: 0, y: 0, z: 0 }

describe('isDroppedItemPickupEligible', () => {
  it('is eligible with no eligible-from frame at all', () => {
    expect(isDroppedItemPickupEligible(0, undefined)).toBe(true)
  })

  it('is not yet eligible one frame before its eligible frame', () => {
    expect(isDroppedItemPickupEligible(7, 8)).toBe(false)
  })

  it('is eligible exactly on its eligible frame', () => {
    expect(isDroppedItemPickupEligible(8, 8)).toBe(true)
  })

  it('is eligible any frame after its eligible frame', () => {
    expect(isDroppedItemPickupEligible(100, 8)).toBe(true)
  })
})

describe('droppedItemMetadataFromBehaviour', () => {
  it('is empty for a behaviour that is not a dropped item at all', () => {
    expect(droppedItemMetadataFromBehaviour(undefined)).toStrictEqual({})
    expect(droppedItemMetadataFromBehaviour(hostileMobSnapshot(STEADY_ENDERMAN))).toStrictEqual({})
    expect(droppedItemMetadataFromBehaviour('not an object')).toStrictEqual({})
  })

  it('is empty for a bare dropped item carrying neither a name nor enchantments', () => {
    const bare: DroppedItemBehaviour = {
      _tag: 'DroppedItem', item: 'gunpowder', count: 1, durability: null,
    }
    expect(droppedItemMetadataFromBehaviour(bare)).toStrictEqual({})
  })

  it('reports a custom name alone', () => {
    const named: DroppedItemBehaviour = {
      _tag: 'DroppedItem', item: 'gunpowder', count: 1, durability: null, customName: 'Boom',
    }
    expect(droppedItemMetadataFromBehaviour(named)).toStrictEqual({ customName: 'Boom' })
  })

  it('reports an empty enchantment list as a KNOWN fact, distinct from absence', () => {
    const knownUnenchanted: DroppedItemBehaviour = {
      _tag: 'DroppedItem', item: 'gunpowder', count: 1, durability: null, enchantments: [],
    }
    expect(droppedItemMetadataFromBehaviour(knownUnenchanted)).toStrictEqual({
      enchantedItem: { item: 'gunpowder', durability: null, enchantments: [] },
    })
  })

  it('reports a real enchantment and a name together', () => {
    const durability = durabilityForItem('wooden_pickaxe')
    const behaviour: DroppedItemBehaviour = {
      _tag: 'DroppedItem',
      item: 'wooden_pickaxe',
      count: 1,
      durability,
      customName: 'Old Faithful',
      enchantments: [{ id: 'unbreaking', level: 1 }],
    }
    expect(droppedItemMetadataFromBehaviour(behaviour)).toStrictEqual({
      customName: 'Old Faithful',
      enchantedItem: {
        item: 'wooden_pickaxe',
        durability,
        enchantments: [{ id: 'unbreaking', level: 1 }],
      },
    })
  })

  it('is empty for a behaviour that fails validation (blank name)', () => {
    const blankNamed = {
      _tag: 'DroppedItem', item: 'gunpowder', count: 1, durability: null, customName: '   ',
    }
    expect(droppedItemMetadataFromBehaviour(blankNamed)).toStrictEqual({})
  })

  it.effect('round-trips through spawnDroppedItem: a rename and enchantments survive onto the roster', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const durability = durabilityForItem('wooden_pickaxe')

      const spawned = yield* spawnDroppedItem(roster.api, {
        item: 'wooden_pickaxe',
        count: 1,
        at: origin,
        customName: 'Old Faithful',
        enchantments: [{ id: 'unbreaking', level: 1 }],
      })

      expect(droppedItemMetadataFromBehaviour(spawned.behaviour)).toStrictEqual({
        customName: 'Old Faithful',
        enchantedItem: {
          item: 'wooden_pickaxe',
          durability,
          enchantments: [{ id: 'unbreaking', level: 1 }],
        },
      })
    }),
  )
})
