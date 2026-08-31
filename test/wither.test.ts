import { describe, expect, it } from '@effect/vitest'
import { WITHER_MAX_HEALTH, WITHER_SPAWN_CHARGE_SECS, type BlockCell } from '@nerima-games/mc-sim'
import type { Position } from '@nerima-games/mc-kernel'
import {
  advanceWitherRuntime,
  damageRuntimeWither,
  initialWitherRuntimeState,
  isValidWitherRuntimeSnapshot,
  matchRuntimeWitherSummon,
  restoreWitherRuntime,
  snapshotWitherRuntime,
  summonRuntimeWither,
  WITHER_MELEE_DAMAGE,
  WITHER_MELEE_INTERVAL_SECS,
  WITHER_MELEE_RANGE,
  WITHER_RANGED_INTERVAL_SECS,
  WITHER_SKULL_MAX_AGE_SECS,
  type WitherRuntimeState,
} from '../src/domain/boss/wither'

const origin: Position = { x: 0, y: 64, z: 0 }
const neverHitsWorld = () => false

describe('summonRuntimeWither', () => {
  it('assigns sequential ids and starts each wither charging', () => {
    const first = summonRuntimeWither(initialWitherRuntimeState(), 'overworld', origin)
    const second = summonRuntimeWither(first, 'overworld', { x: 10, y: 64, z: 10 })
    expect(second.withers.map((w) => w.id)).toStrictEqual(['wither-1', 'wither-2'])
    expect(second.withers.every((w) => w.state.phase === 'charging')).toBe(true)
    expect(second.withers.every((w) => w.state.healthPoints === WITHER_MAX_HEALTH)).toBe(true)
  })
})

describe('matchRuntimeWitherSummon', () => {
  it('finds an x-axis structure when the placed skull is the LEFT (non-centre) one', () => {
    const base: BlockCell = { x: 10, y: 4, z: 20 }
    const soulBlocks = new Set([
      '10,4,20', '10,5,20', '11,5,20', '9,5,20',
    ])
    const skulls = new Set(['9,6,20', '10,6,20', '11,6,20'])
    const blockAt = (cell: BlockCell): string | undefined => {
      const key = `${String(cell.x)},${String(cell.y)},${String(cell.z)}`
      if (soulBlocks.has(key)) return 'soul_sand'
      if (skulls.has(key)) return 'wither_skeleton_skull'
      return 'air'
    }

    // The player placed the LEFT skull (x offset -1), not the structure's
    // canonical base — this only passes if the loop tries more than the
    // trivial "placedSkull is the centre skull" candidate.
    const match = matchRuntimeWitherSummon({ x: 9, y: 6, z: 20 }, blockAt)

    expect(match).toStrictEqual({
      axis: 'x',
      spawnPosition: { x: 10.5, y: 5, z: 20.5 },
      consumedBlocks: expect.arrayContaining([base]),
    })
  })

  it('finds nothing when no candidate base completes the structure', () => {
    expect(matchRuntimeWitherSummon({ x: 0, y: 6, z: 0 }, () => 'air')).toBeUndefined()
  })
})

describe('damageRuntimeWither', () => {
  const airborne = (): WitherRuntimeState => {
    const summoned = summonRuntimeWither(initialWitherRuntimeState(), 'overworld', origin)
    // Clear the charging phase so damage actually applies (damageWither
    // ignores every hit while charging).
    return advanceWitherRuntime(summoned, 'overworld', origin, WITHER_SPAWN_CHARGE_SECS, neverHitsWorld).state
  }

  it('reduces health without removing the wither for a non-lethal hit', () => {
    const state = airborne()
    const id = state.withers[0]!.id
    const result = damageRuntimeWither(state, id, 50, 'melee')
    expect(result.death).toBeUndefined()
    expect(result.state.withers).toHaveLength(1)
    expect(result.state.withers[0]?.state.healthPoints).toBe(WITHER_MAX_HEALTH - 50)
  })

  it('removes the wither and reports a death descriptor for a lethal hit', () => {
    const state = airborne()
    const id = state.withers[0]!.id
    const result = damageRuntimeWither(state, id, WITHER_MAX_HEALTH, 'melee')
    expect(result.death).toBeDefined()
    expect(result.death?.drop).toStrictEqual({ item: 'nether_star', count: 1, position: expect.anything() })
    expect(result.state.withers).toStrictEqual([])
  })

  it('leaves an unmatched id and every other wither untouched', () => {
    const state = airborne()
    const result = damageRuntimeWither(state, 'not-a-real-id', 999, 'melee')
    expect(result.death).toBeUndefined()
    expect(result.state.withers).toStrictEqual(state.withers)
  })
})

describe('advanceWitherRuntime', () => {
  it('does nothing offensive while charging: no skull, no melee, cooldowns untouched', () => {
    const summoned = summonRuntimeWither(initialWitherRuntimeState(), 'overworld', origin)
    const result = advanceWitherRuntime(summoned, 'overworld', origin, 1, neverHitsWorld)
    expect(result.state.skulls).toStrictEqual([])
    expect(result.meleeDamage).toBe(0)
    expect(result.state.withers[0]?.state.phase).toBe('charging')
    expect(result.state.withers[0]?.rangedCooldownSecs).toBe(WITHER_RANGED_INTERVAL_SECS)
  })

  it('leaves a wither and skull in a different dimension untouched', () => {
    const summoned = summonRuntimeWither(initialWitherRuntimeState(), 'nether', origin)
    const result = advanceWitherRuntime(summoned, 'overworld', origin, 100, neverHitsWorld)
    expect(result.state.withers).toStrictEqual(summoned.withers)
    expect(result.explosions).toStrictEqual([])
  })

  it('launches a skull the instant the ranged cooldown is exhausted, once charging finishes within the same frame', () => {
    const summoned = summonRuntimeWither(initialWitherRuntimeState(), 'overworld', origin)
    const target = { x: 100, y: 64, z: 0 }
    // activeDelta = (charge-clearing delta) - WITHER_SPAWN_CHARGE_SECS, and
    // it must reach WITHER_RANGED_INTERVAL_SECS to fire within this one call.
    const deltaSecs = WITHER_SPAWN_CHARGE_SECS + WITHER_RANGED_INTERVAL_SECS
    const result = advanceWitherRuntime(summoned, 'overworld', target, deltaSecs, neverHitsWorld)

    expect(result.state.withers[0]?.state.phase).not.toBe('charging')
    expect(result.state.withers[0]?.shotsFired).toBe(1)
    expect(result.state.skulls.length + result.explosions.length).toBeGreaterThan(0)
    expect(result.state.skulls[0]?.descriptor.variant).toBe('normal')
  })

  it('every third shot is the blue variant', () => {
    const summoned = summonRuntimeWither(initialWitherRuntimeState(), 'overworld', origin)
    const target = { x: 100, y: 64, z: 0 }
    // Clear charging and fire shot 1 (normal), then re-fire twice more,
    // resetting the ranged cooldown fully each time so shots 2 and 3 land in
    // separate frames — shot 3 (shotsFired % 3 === 0) must be blue.
    let state = advanceWitherRuntime(
      summoned, 'overworld', target, WITHER_SPAWN_CHARGE_SECS + WITHER_RANGED_INTERVAL_SECS, neverHitsWorld,
    ).state
    for (let shot = 2; shot <= 3; shot += 1) {
      const advanced = advanceWitherRuntime(state, 'overworld', target, WITHER_RANGED_INTERVAL_SECS, neverHitsWorld)
      state = advanced.state
      expect(state.withers[0]?.shotsFired).toBe(shot)
    }
    const thirdShot = state.skulls.find((skull) => skull.id.endsWith('-3'))
    expect(thirdShot?.descriptor.variant).toBe('blue')

    // Round-trips a blue skull through the same validator every restored
    // save goes through, so `isWitherSkullVariant`'s 'blue' arm is pinned by
    // a real snapshot rather than only by the descriptor's own field.
    expect(isValidWitherRuntimeSnapshot(snapshotWitherRuntime(state))).toBe(true)
  })

  it('treats a non-finite deltaSecs as no time passing', () => {
    const summoned = summonRuntimeWither(initialWitherRuntimeState(), 'overworld', origin)
    for (const deltaSecs of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = advanceWitherRuntime(summoned, 'overworld', origin, deltaSecs, neverHitsWorld)
      expect(result.state.withers[0]?.state.chargeRemainingSecs).toBe(WITHER_SPAWN_CHARGE_SECS)
      expect(result.meleeDamage).toBe(0)
      expect(result.explosions).toStrictEqual([])
    }
  })

  it('deals melee damage exactly once per interval once the target is in range', () => {
    // Wither summoned AT the target position: distance is 0, well within
    // WITHER_MELEE_RANGE. The clearing frame must run STRICTLY past
    // WITHER_SPAWN_CHARGE_SECS — activeDelta (the post-charge remainder) is
    // what ticks the melee cooldown, and at exactly the charge duration
    // there is no remainder left to tick it with.
    const summoned = summonRuntimeWither(initialWitherRuntimeState(), 'overworld', origin)
    const cleared = advanceWitherRuntime(
      summoned, 'overworld', origin, WITHER_SPAWN_CHARGE_SECS + WITHER_MELEE_INTERVAL_SECS, neverHitsWorld,
    )
    expect(cleared.meleeDamage).toBe(WITHER_MELEE_DAMAGE)

    // Immediately again, before the melee cooldown has refilled: no second hit.
    const tooSoon = advanceWitherRuntime(cleared.state, 'overworld', origin, WITHER_MELEE_INTERVAL_SECS - 0.1, neverHitsWorld)
    expect(tooSoon.meleeDamage).toBe(0)

    // After the remaining cooldown: hits again.
    const nextHit = advanceWitherRuntime(tooSoon.state, 'overworld', origin, 0.1, neverHitsWorld)
    expect(nextHit.meleeDamage).toBe(WITHER_MELEE_DAMAGE)
  })

  it('does not melee a target outside WITHER_MELEE_RANGE', () => {
    const summoned = summonRuntimeWither(initialWitherRuntimeState(), 'overworld', origin)
    const farTarget = { x: origin.x + WITHER_MELEE_RANGE + 10, y: origin.y, z: origin.z }
    const result = advanceWitherRuntime(summoned, 'overworld', farTarget, WITHER_SPAWN_CHARGE_SECS, neverHitsWorld)
    expect(result.meleeDamage).toBe(0)
  })

  describe('skull flight', () => {
    const launchedSkull = () => {
      const summoned = summonRuntimeWither(initialWitherRuntimeState(), 'overworld', origin)
      // Far enough that melee never triggers; a skull launches once charging clears.
      const target = { x: origin.x + 30, y: origin.y, z: origin.z }
      const launch = advanceWitherRuntime(
        summoned, 'overworld', target,
        WITHER_SPAWN_CHARGE_SECS + WITHER_RANGED_INTERVAL_SECS,
        neverHitsWorld,
      )
      return { state: launch.state, target }
    }

    it('explodes on a direct hit near the target', () => {
      const { state, target } = launchedSkull()
      expect(state.skulls).not.toStrictEqual([])

      // The hit check compares the skull's POST-MOVEMENT position for the
      // frame against the target's radius, not a continuous ray along the
      // frame's travel — so one huge frame can overshoot the 0.8-block hit
      // window entirely. Small steps (0.5 blocks each, well under the
      // window) guarantee some step's landing position falls inside it,
      // rather than jumping over the target in a single bound.
      let current = state
      let explosions: ReturnType<typeof advanceWitherRuntime>['explosions'] = []
      for (let i = 0; i < 100 && explosions.length === 0; i += 1) {
        const step = advanceWitherRuntime(current, 'overworld', target, 0.05, neverHitsWorld)
        current = step.state
        explosions = step.explosions
      }

      expect(explosions.length).toBeGreaterThan(0)
      expect(current.skulls).toStrictEqual([])
    })

    it('explodes when skullHitsWorld reports terrain in the way', () => {
      const { state, target } = launchedSkull()
      const result = advanceWitherRuntime(state, 'overworld', target, 0.01, () => true)
      expect(result.explosions).toHaveLength(1)
      expect(result.state.skulls).toStrictEqual([])
    })

    it('despawns without an explosion once it exceeds WITHER_SKULL_MAX_AGE_SECS', () => {
      const { state } = launchedSkull()
      // Aim the "advance" target far away so the skull's own flight never
      // reaches it before ageing out.
      const distantTarget = { x: 100_000, y: 64, z: 100_000 }
      const result = advanceWitherRuntime(state, 'overworld', distantTarget, WITHER_SKULL_MAX_AGE_SECS + 1, neverHitsWorld)
      expect(result.explosions).toStrictEqual([])
      expect(result.state.skulls).toStrictEqual([])
    })

    it('leaves a skull in a different dimension untouched', () => {
      const { state } = launchedSkull()
      const result = advanceWitherRuntime(state, 'nether', origin, 5, neverHitsWorld)
      expect(result.state.skulls).toStrictEqual(state.skulls)
    })
  })
})

describe('snapshotWitherRuntime / restoreWitherRuntime', () => {
  it('round-trips a runtime with a wither and a skull', () => {
    const summoned = summonRuntimeWither(initialWitherRuntimeState(), 'overworld', origin)
    const target = { x: origin.x + 30, y: origin.y, z: origin.z }
    const withSkull = advanceWitherRuntime(
      summoned, 'overworld', target,
      WITHER_SPAWN_CHARGE_SECS + WITHER_RANGED_INTERVAL_SECS,
      neverHitsWorld,
    ).state

    const snapshot = snapshotWitherRuntime(withSkull)
    expect(isValidWitherRuntimeSnapshot(snapshot)).toBe(true)
    const restored = restoreWitherRuntime(snapshot)

    expect(restored.nextWitherId).toBe(withSkull.nextWitherId)
    expect(restored.nextSkullId).toBe(withSkull.nextSkullId)
    expect(restored.withers).toHaveLength(withSkull.withers.length)
    expect(restored.withers[0]?.id).toBe(withSkull.withers[0]?.id)
    expect(restored.withers[0]?.state.healthPoints).toBe(withSkull.withers[0]?.state.healthPoints)
    expect(restored.skulls).toStrictEqual(withSkull.skulls)
  })

  it('restores the empty runtime for an undefined snapshot', () => {
    expect(restoreWitherRuntime(undefined)).toStrictEqual(initialWitherRuntimeState())
  })
})

describe('isValidWitherRuntimeSnapshot', () => {
  const validSnapshot = () => snapshotWitherRuntime(
    summonRuntimeWither(initialWitherRuntimeState(), 'overworld', origin),
  )

  it('accepts a snapshot this file itself produced', () => {
    expect(isValidWitherRuntimeSnapshot(validSnapshot())).toBe(true)
  })

  it('rejects a non-object', () => {
    expect(isValidWitherRuntimeSnapshot('not an object')).toBe(false)
    expect(isValidWitherRuntimeSnapshot(null)).toBe(false)
  })

  it('rejects a snapshot with an extra top-level key', () => {
    expect(isValidWitherRuntimeSnapshot({ ...validSnapshot(), extra: 1 })).toBe(false)
  })

  it('rejects a snapshot with a missing top-level key', () => {
    const { skulls: _skulls, ...rest } = validSnapshot()
    expect(isValidWitherRuntimeSnapshot(rest)).toBe(false)
  })

  it('rejects a wither entry with an invalid phase', () => {
    const snapshot = validSnapshot()
    const corrupted = {
      ...snapshot,
      withers: [{
        ...snapshot.withers[0],
        snapshot: {
          ...snapshot.withers[0]!.snapshot,
          state: { ...snapshot.withers[0]!.snapshot.state, phase: 'not-a-phase' },
        },
      }],
    }
    expect(isValidWitherRuntimeSnapshot(corrupted)).toBe(false)
  })

  it('rejects a skull whose id is blank', () => {
    const withSkull = advanceWitherRuntime(
      summonRuntimeWither(initialWitherRuntimeState(), 'overworld', origin),
      'overworld',
      { x: origin.x + 30, y: origin.y, z: origin.z },
      WITHER_SPAWN_CHARGE_SECS + WITHER_RANGED_INTERVAL_SECS,
      neverHitsWorld,
    ).state
    const snapshot = snapshotWitherRuntime(withSkull)
    const corrupted = { ...snapshot, skulls: [{ ...snapshot.skulls[0]!, id: '   ' }] }
    expect(isValidWitherRuntimeSnapshot(corrupted)).toBe(false)
  })
})
