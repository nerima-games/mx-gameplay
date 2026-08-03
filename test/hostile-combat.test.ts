import { describe, expect, it } from '@effect/vitest'
import { EntityId, EntityKind, type Entity } from '../src/domain/entity-manager-port'
import {
  CREEPER_LOCOMOTION,
  pursueHorizontally,
  resolveHostileContacts,
  resolvePlayerBlastDamage,
  ZOMBIE_KIND,
  ZOMBIE_LOCOMOTION,
} from '../src/domain/mob/hostile-combat'

const zombie = (x: number): Entity<undefined> => ({
  id: EntityId('zombie:1'),
  kind: ZOMBIE_KIND,
  feetPosition: { x, y: 64, z: 0 },
  healthPoints: 20,
  behaviour: undefined,
})

describe('hostile locomotion', () => {
  it('moves horizontally by at most speed * dt and preserves altitude', () => {
    expect(
      pursueHorizontally(
        { x: 10, y: 70, z: 0 },
        { x: 0, y: 20, z: 0 },
        0.5,
        ZOMBIE_LOCOMOTION,
      ),
    ).toStrictEqual({ x: 8.85, y: 70, z: 0 })
  })

  it('stops at the kind-specific engagement distance', () => {
    const target = { x: 0, y: 64, z: 0 }
    expect(pursueHorizontally({ x: 2, y: 64, z: 0 }, target, 1, CREEPER_LOCOMOTION)).toStrictEqual({
      x: 2,
      y: 64,
      z: 0,
    })
  })
})

describe('player damage resolution', () => {
  it('emits zombie contact damage once per cooldown interval', () => {
    const target = { x: 0, y: 64, z: 0 }
    const first = resolveHostileContacts([zombie(1)], target, 0.25, new Map())
    expect(first.damages).toHaveLength(1)
    expect(first.damages[0]).toMatchObject({
      _tag: 'HostileContact',
      source: 'zombie:1',
      kind: 'zombie',
      damage: { amount: 3, cause: 'mob' },
    })

    const cooling = resolveHostileContacts([zombie(1)], target, 0.5, first.cooldowns)
    expect(cooling.damages).toStrictEqual([])
    const ready = resolveHostileContacts([zombie(1)], target, 0.5, cooling.cooldowns)
    expect(ready.damages).toHaveLength(1)
  })

  it('attributes explosion damage to the detonating mob', () => {
    expect(
      resolvePlayerBlastDamage(
        [
          {
            source: EntityId('creeper:1'),
            kind: EntityKind('creeper'),
            at: { x: 0, y: 64, z: 0 },
            explosion: { source: 'creeper', power: 3 },
          },
        ],
        { x: 2, y: 64, z: 0 },
      ),
    ).toStrictEqual([
      {
        _tag: 'Explosion',
        source: 'creeper:1',
        kind: 'creeper',
        at: { x: 0, y: 64, z: 0 },
        explosion: { source: 'creeper', power: 3 },
        damage: { amount: 24, cause: 'explosion' },
      },
    ])
  })
})
