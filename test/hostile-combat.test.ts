import { describe, expect, it } from '@effect/vitest'
import { EntityId, EntityKind, type Entity } from '@nerima-games/mc-sim'
import {
  CREEPER_LOCOMOTION,
  pursueHorizontally,
  resolveHostileContacts,
  resolvePlayerBlastDamage,
  ZOMBIE_KIND,
  ZOMBIE_LOCOMOTION,
  type HostileLocomotion,
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

  it('does not move without a target, with a non-finite dt, or with a non-positive dt', () => {
    const from = { x: 5, y: 10, z: 5 }
    const target = { x: 20, y: 10, z: 5 }
    expect(pursueHorizontally(from, undefined, 1, ZOMBIE_LOCOMOTION)).toStrictEqual(from)
    expect(pursueHorizontally(from, target, Number.NaN, ZOMBIE_LOCOMOTION)).toStrictEqual(from)
    expect(pursueHorizontally(from, target, 0, ZOMBIE_LOCOMOTION)).toStrictEqual(from)
    expect(pursueHorizontally(from, target, -1, ZOMBIE_LOCOMOTION)).toStrictEqual(from)
  })

  it('does not move when the locomotion has no speed to spend', () => {
    // `distanceMoved <= 0` is reachable only through the locomotion's own
    // numbers — `dt` and `distance` are already positive by this point — so a
    // stalled mob (speed zero) is the one caller that can produce it.
    const stalled: HostileLocomotion = { speedBlocksPerSecond: 0, stoppingDistanceBlocks: 1 }
    const from = { x: 0, y: 10, z: 0 }
    expect(pursueHorizontally(from, { x: 10, y: 10, z: 0 }, 1, stalled)).toStrictEqual(from)
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

  it('without a target, no damage is emitted but a non-finite dt still leaves cooldowns untouched', () => {
    const cooldowns = new Map([[EntityId('zombie:9'), 0.5]])
    const result = resolveHostileContacts([zombie(1)], undefined, Number.NaN, cooldowns)
    expect(result.damages).toStrictEqual([])
    // `elapsed` fell back to zero, so nothing was subtracted from the
    // cooldown that was already ticking down.
    expect(result.cooldowns.get(EntityId('zombie:9'))).toBe(0.5)
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

  it('drops a blast whose damage falls off to zero at distance, rather than reporting a zero-amount event', () => {
    // The only prior blast test is close enough to always damage — the
    // `damage.amount > 0` filter's FALSE arm, a blast too far away to hurt at
    // all, had never fired.
    expect(
      resolvePlayerBlastDamage(
        [
          {
            source: EntityId('creeper:3'),
            kind: EntityKind('creeper'),
            at: { x: 0, y: 64, z: 0 },
            explosion: { source: 'creeper', power: 3 },
          },
        ],
        { x: 100, y: 64, z: 0 },
      ),
    ).toStrictEqual([])
  })

  it('returns no blast damage without a target', () => {
    expect(
      resolvePlayerBlastDamage(
        [
          {
            source: EntityId('creeper:2'),
            kind: EntityKind('creeper'),
            at: { x: 0, y: 64, z: 0 },
            explosion: { source: 'creeper', power: 3 },
          },
        ],
        undefined,
      ),
    ).toStrictEqual([])
  })
})
