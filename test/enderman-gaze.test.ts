import { describe, expect, it } from '@effect/vitest'
import { PositionAxis, position, RandomSeed, DeltaTimeSecs, EntityHealthPoints, EntitySerial } from '@nerima-games/mc-kernel'
import { EntityId, EntityKind } from '@nerima-games/mc-sim'
import { Result } from 'effect'
import { isLookingAtEnderman } from '../src/domain/mob/enderman-gaze.js'
import { hostileMobSnapshot, isHostileMobSnapshot, planMobRosterSweep, repairMobBehaviour, STEADY_ENDERMAN, type MobRoster } from '../src/domain/entities/mob-frame.js'

const at = (x: number, y: number, z: number) => position(PositionAxis(x), PositionAxis(y), PositionAxis(z))
const player = EntityId('mx-gameplay:player-avatar')
const mob = EntityId('test:enderman')
const roster = (): MobRoster => ({ entities: [{
  id: mob, kind: EntityKind('enderman'), feetPosition: at(0, 64, 8),
  healthPoints: EntityHealthPoints(40), behaviour: hostileMobSnapshot(STEADY_ENDERMAN),
}], nextSerial: EntitySerial(1) })
const tick = (current: MobRoster, looking: boolean, target = player) => planMobRosterSweep(current, {
  target: at(0, 64, 0), dt: DeltaTimeSecs(0.05),
  endermanGaze: { target, looking: new Set(looking ? [mob] : []) },
}, RandomSeed(3))

describe('enderman gaze', () => {
  it('aims from the player eye to the enderman eye in the player yaw convention', () => {
    expect(isLookingAtEnderman(at(0, 0, 0), 0, -Math.atan(0.93 / 8), at(0, 0, 8))).toEqual(Result.succeed(true))
    expect(isLookingAtEnderman(at(0, 0, 0), Math.PI, 0, at(0, -0.93, 8))).toEqual(Result.succeed(false))
    expect(isLookingAtEnderman(at(0, 0, 0), Math.PI / 2, 0, at(-8, -0.93, 0))).toEqual(Result.succeed(true))
  })

  it('includes exactly 64 blocks measured between feet and excludes the next distance', () => {
    for (const distance of [63.999999, 64, 64.000001]) {
      expect(isLookingAtEnderman(at(0, 0, 0), 0, -Math.atan(0.93 / distance), at(0, 0, distance)))
        .toEqual(Result.succeed(distance <= 64))
    }
  })

  it('uses the strict angular boundary at an eye distance of ten blocks', () => {
    const boundary = Math.acos(0.9975)
    for (const [angle, expected] of [[boundary - 1e-7, true], [boundary, false], [boundary + 1e-7, false]] as const) {
      expect(isLookingAtEnderman(at(0, 0, 0), angle, 0, at(0, -0.93, 10))).toEqual(Result.succeed(expected))
    }
  })

  it('rejects invalid geometry and a directionless coincident eye', () => {
    expect(isLookingAtEnderman(at(0, 0, 0), Number.NaN, 0, at(0, 0, 8))).toEqual(Result.fail('invalid-gaze-input'))
    expect(isLookingAtEnderman(at(0, 2.55, 0), 0, 0, at(0, 1.62, 0))).toEqual(Result.succeed(false))
  })

  it('requires five consecutive ticks, resets a candidate, and retains established hostility', () => {
    let current = roster()
    for (let i = 1; i <= 4; i += 1) {
      const step = tick(current, true)
      current = step.roster
      expect(current.entities[0]?.behaviour).toMatchObject({ endermanAnger: { target: player, stareTicks: i } })
      expect(step.teleports).toEqual([])
    }
    current = tick(current, false).roster
    expect(current.entities[0]?.behaviour).not.toHaveProperty('endermanAnger')
    for (let i = 0; i < 5; i += 1) current = tick(current, true).roster
    current = tick(current, false).roster
    expect(current.entities[0]?.behaviour).toMatchObject({ endermanAnger: { target: player, stareTicks: 5 } })
  })

  it('restarts a candidate when the observed target changes', () => {
    const first = tick(roster(), true).roster
    const second = tick(first, true, EntityId('test:other-player')).roster
    expect(second.entities[0]?.behaviour).toMatchObject({ endermanAnger: { target: 'test:other-player', stareTicks: 1 } })
  })

  it('adds gaze state to a legacy raw flinch and migrates omitted legacy flinch with anger', () => {
    const initial = roster()
    const raw = { ...initial, entities: initial.entities.map((entity) => ({ ...entity, behaviour: STEADY_ENDERMAN })) }
    expect(tick(raw, true).roster.entities[0]?.behaviour).toMatchObject({
      _tag: 'HostileMob', endermanAnger: { stareTicks: 1 },
    })
    const legacy = { _tag: 'HostileMob', ageTicks: 0, persistent: false, named: false, tamed: false,
      endermanAnger: { target: player, stareTicks: 2, attackCooldownTicks: 0 },
    }
    expect(repairMobBehaviour(EntityKind('enderman'), legacy)).toEqual({ ...legacy, behaviour: STEADY_ENDERMAN })
  })

  it('rejects malformed persisted anger and preserves valid snapshot metadata', () => {
    const state = hostileMobSnapshot(STEADY_ENDERMAN, { endermanAnger: { target: player, stareTicks: 4, attackCooldownTicks: 0 } })
    expect(repairMobBehaviour(EntityKind('enderman'), state)).toBe(state)
    for (const value of [null, undefined, { target: '', stareTicks: 1, attackCooldownTicks: 0 },
      { target: player, stareTicks: 6, attackCooldownTicks: 0 }]) {
      const invalid = { ...state, endermanAnger: value }
      expect(isHostileMobSnapshot(invalid)).toBe(false)
      expect(repairMobBehaviour(EntityKind('enderman'), invalid)).toMatchObject({ _tag: 'MobBehaviourRepairFault' })
    }
    expect(repairMobBehaviour(EntityKind('zombie'), state)).toMatchObject({ _tag: 'MobBehaviourRepairFault' })
  })
})
