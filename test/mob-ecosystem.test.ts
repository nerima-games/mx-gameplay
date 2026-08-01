import { describe, expect, it } from 'vitest'
import { EntityId, type Entity, type Position } from '../src/domain/entity-manager-port'
import {
  BLAZE_KIND,
  COW_KIND,
  ecosystemDimensionAllows,
  initialEcosystemMobState,
  propagatedPiglinProvocation,
  SKELETON_KIND,
  stepEcosystemMob,
  ZOMBIFIED_PIGLIN_KIND,
} from '../src/domain/mob/mob-ecosystem'

const position = (x: number, z = 0): Position => ({ x, y: 64, z })

describe('mob ecosystem', () => {
  it('restricts overworld and nether mobs to their dimensions', () => {
    expect(ecosystemDimensionAllows(COW_KIND, 'overworld')).toBe(true)
    expect(ecosystemDimensionAllows(COW_KIND, 'nether')).toBe(false)
    expect(ecosystemDimensionAllows(BLAZE_KIND, 'nether')).toBe(true)
    expect(ecosystemDimensionAllows(BLAZE_KIND, 'end')).toBe(false)
  })

  it('makes passive mobs flee a nearby player', () => {
    const step = stepEcosystemMob(COW_KIND, initialEcosystemMobState(), position(0), position(2), 1)

    expect(step.feetPosition.x).toBeLessThan(0)
    expect(step.attack).toBeUndefined()
  })

  it('lets skeletons attack at range and respects their cooldown', () => {
    const first = stepEcosystemMob(
      SKELETON_KIND,
      initialEcosystemMobState(),
      position(0),
      position(10),
      0.05,
    )
    const second = stepEcosystemMob(SKELETON_KIND, first.state, position(0), position(10), 0.05)

    expect(first.attack).toMatchObject({ mode: 'projectile', damage: 4 })
    expect(second.attack).toBeUndefined()
  })

  it('propagates provocation only to nearby zombified piglins', () => {
    const attackedId = EntityId('piglin-attacked')
    const nearbyId = EntityId('piglin-nearby')
    const distantId = EntityId('piglin-distant')
    const entities: ReadonlyArray<Entity<undefined>> = [
      { id: attackedId, kind: ZOMBIFIED_PIGLIN_KIND, feetPosition: position(0), healthPoints: 20, behaviour: undefined },
      { id: nearbyId, kind: ZOMBIFIED_PIGLIN_KIND, feetPosition: position(8), healthPoints: 20, behaviour: undefined },
      { id: distantId, kind: ZOMBIFIED_PIGLIN_KIND, feetPosition: position(20), healthPoints: 20, behaviour: undefined },
    ]

    expect(propagatedPiglinProvocation(entities, new Set([attackedId]))).toEqual(
      new Set([attackedId, nearbyId]),
    )
  })
})
