import { describe, expect, it } from 'vitest'
import {
  FIRE_BURN_DURATION_TICKS,
  FIRE_DAMAGE_INTERVAL_TICKS,
  FIRE_FRAME_TICK_BUDGET,
  FIRE_LIFECYCLE_SNAPSHOT_VERSION,
  FIRE_NATURAL_LIFETIME_TICKS,
  FIRE_TICK_INTERVAL_SECS,
  FIRE_UNAVAILABLE_BLOCK,
  FIRE_UNLOADED_RETRY_LIMIT,
  FIRE_WORK_BUDGET,
  advanceFireLifecycle,
  extinguishFire,
  isFireLifecycleSnapshot,
  makeFireLifecycleSnapshot,
  makeFireLifecycleState,
  restoreFireLifecycleSnapshot,
  type FireCell,
  type FireLifecycleState,
} from '../src/domain/fire-lifecycle'

const fire = { position: { x: 0, y: 1, z: 0 }, block: 'fire', exposedToSky: true }
const coveredFire = { ...fire, exposedToSky: false }
const wood = { position: { x: 1, y: 1, z: 0 }, block: 'oak_planks' }
const stoneBelow = { position: { x: 0, y: 0, z: 0 }, block: 'stone' }

describe('fire lifecycle', () => {
  it('is deterministic and independent of active/cell order across seeds', () => {
    const secondFire = { position: { x: 10, y: 1, z: 0 }, block: 'fire' }
    const secondWood = { position: { x: 9, y: 1, z: 0 }, block: 'oak_planks' }
    for (let seed = 0; seed < 64; seed += 1) {
      const state = makeFireLifecycleState([fire.position, secondFire.position], seed)
      const reversed = { ...state, fires: [...state.fires].reverse() }
      const cells = [fire, wood, secondFire, secondWood]
      expect(advanceFireLifecycle(state, cells, 'clear')).toStrictEqual(
        advanceFireLifecycle(reversed, [...cells].reverse(), 'clear'),
      )
    }
  })

  it('deduplicates active positions and shared spread targets', () => {
    const rightFire = { position: { x: 2, y: 1, z: 0 }, block: 'fire' }
    const state = makeFireLifecycleState([fire.position, fire.position, rightFire.position], 1)
    expect(state.fires).toHaveLength(2)
    const step = advanceFireLifecycle(state, [fire, rightFire, wood], 'clear')
    expect(step.mutations.filter((mutation) => mutation.block === 'fire')).toHaveLength(1)
    expect(step.state.fires.filter((active) => active.position.x === 1)).toHaveLength(1)
  })

  it('does not spread across an unloaded boundary omitted from the snapshot', () => {
    const step = advanceFireLifecycle(makeFireLifecycleState([fire.position], 1), [fire], 'clear')
    expect(step.mutations).toStrictEqual([])
  })

  it('retains unavailable fire for a bounded number of retries', () => {
    const unavailable = [{ ...fire, block: FIRE_UNAVAILABLE_BLOCK }]
    let state = makeFireLifecycleState([fire.position], 1)
    for (let retry = 1; retry <= FIRE_UNLOADED_RETRY_LIMIT; retry += 1) {
      const step = advanceFireLifecycle(state, unavailable, 'clear')
      expect(step.mutations).toStrictEqual([])
      expect(step.state.fires).toStrictEqual([
        { position: fire.position, ageTicks: 0, unloadedRetries: retry },
      ])
      state = step.state
    }
    expect(advanceFireLifecycle(state, unavailable, 'clear').state.fires).toStrictEqual([])
  })

  it('rain extinguishes only sky-exposed fire', () => {
    const state = makeFireLifecycleState([fire.position], 1)
    expect(advanceFireLifecycle(state, [fire], 'rain').mutations).toStrictEqual([
      { position: fire.position, block: 'air' },
    ])
    expect(advanceFireLifecycle(state, [coveredFire], 'rain').state.fires).toHaveLength(1)
  })

  it('water replacement and support loss clear logical fire', () => {
    const state = makeFireLifecycleState([fire.position], 1)
    expect(advanceFireLifecycle(state, [{ ...fire, block: 'water' }], 'clear')).toMatchObject({
      state: { fires: [] },
      mutations: [],
    })
    expect(advanceFireLifecycle(state, [fire, { ...stoneBelow, block: 'air' }], 'clear')).toMatchObject({
      state: { fires: [] },
      mutations: [{ position: fire.position, block: 'air' }],
    })
  })

  it('breaks position ties on y and then on z, not only on x', () => {
    // `compare`'s three-term `||` chain: two fires that share x need the y
    // term to order them, and two that share x AND y need the z term.
    const sameX = makeFireLifecycleState([
      { x: 0, y: 2, z: 0 },
      { x: 0, y: 1, z: 0 },
    ], 1)
    expect(sameX.fires.map((active) => active.position)).toStrictEqual([
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 2, z: 0 },
    ])

    const sameXY = makeFireLifecycleState([
      { x: 0, y: 1, z: 2 },
      { x: 0, y: 1, z: 1 },
    ], 1)
    expect(sameXY.fires.map((active) => active.position)).toStrictEqual([
      { x: 0, y: 1, z: 1 },
      { x: 0, y: 1, z: 2 },
    ])
  })

  it('manual extinguish removes only the selected fire', () => {
    const other = { x: 4, y: 1, z: 0 }
    const state = makeFireLifecycleState([fire.position, other], 1)
    expect(extinguishFire(state, fire.position).fires).toStrictEqual([
      { position: other, ageTicks: 0 },
    ])
  })

  it('consumes fuel on spread and naturally extinguishes', () => {
    let state = makeFireLifecycleState([fire.position], 1)
    const spread = advanceFireLifecycle(state, [fire, wood], 'clear')
    expect(spread.mutations).toContainEqual({ position: wood.position, block: 'fire' })
    state = makeFireLifecycleState([fire.position], 1)
    for (let tick = 0; tick < FIRE_NATURAL_LIFETIME_TICKS; tick += 1) {
      state = advanceFireLifecycle(state, [fire], 'clear').state
    }
    expect(state.fires).toStrictEqual([])
  })

  it('applies difficulty damage on cadence and continues burning after contact', () => {
    const contact = {
      id: 'mob:1',
      kind: 'entity' as const,
      position: fire.position,
      alive: true,
    }
    const first = advanceFireLifecycle(
      makeFireLifecycleState([fire.position], 1),
      [coveredFire, stoneBelow],
      'clear',
      [contact],
      'hard',
    )
    expect(first.entityDamages).toStrictEqual([
      { actorId: 'mob:1', at: fire.position, damage: { amount: 2, cause: 'in_fire' } },
    ])
    expect(first.state.burningActors).toStrictEqual([{
      id: 'mob:1',
      kind: 'entity',
      position: fire.position,
      remainingTicks: FIRE_BURN_DURATION_TICKS - 1,
      damageCooldownTicks: FIRE_DAMAGE_INTERVAL_TICKS - 1,
    }])

    const away = { ...contact, position: { x: 5, y: 1, z: 0 } }
    const second = advanceFireLifecycle(first.state, [coveredFire, stoneBelow], 'clear', [away], 'hard')
    expect(second.entityDamages).toStrictEqual([])
    expect(second.state.burningActors?.[0]).toMatchObject({
      position: away.position,
      remainingTicks: FIRE_BURN_DURATION_TICKS - 2,
      damageCooldownTicks: FIRE_DAMAGE_INTERVAL_TICKS - 2,
    })
  })

  it('a due damage tick after leaving the fire cell is caused by on_fire, not in_fire', () => {
    // Distinct from the "applies difficulty damage on cadence" case above,
    // where the actor is standing ON the fire cell at the moment of the tick
    // (`in_fire`). Here `position` is nowhere in `cells`, so the actor is
    // burning but not currently touching fire — the armour-bypassing case.
    const state: FireLifecycleState = {
      fires: [],
      seed: 1,
      burningActors: [{
        id: 'mob:1',
        kind: 'entity',
        position: { x: 5, y: 1, z: 0 },
        remainingTicks: 10,
        damageCooldownTicks: 0,
      }],
    }
    const contact = { id: 'mob:1', kind: 'entity' as const, position: { x: 5, y: 1, z: 0 }, alive: true }

    const step = advanceFireLifecycle(state, [], 'clear', [contact], 'hard')

    expect(step.entityDamages).toStrictEqual([
      { actorId: 'mob:1', at: contact.position, damage: { amount: 2, cause: 'on_fire' } },
    ])
  })

  it('a due damage tick while standing in the fire cell is caused by in_fire, not on_fire', () => {
    const state: FireLifecycleState = {
      fires: [{ position: fire.position, ageTicks: 0 }],
      seed: 1,
      burningActors: [{
        id: 'mob:1',
        kind: 'entity',
        position: fire.position,
        remainingTicks: 10,
        damageCooldownTicks: 0,
      }],
    }
    const contact = { id: 'mob:1', kind: 'entity' as const, position: fire.position, alive: true }

    const step = advanceFireLifecycle(state, [coveredFire, stoneBelow], 'clear', [contact], 'hard')

    expect(step.entityDamages).toStrictEqual([
      { actorId: 'mob:1', at: contact.position, damage: { amount: 2, cause: 'in_fire' } },
    ])
  })

  it('re-ignition refreshes duration while preserving a due damage tick', () => {
    const state: FireLifecycleState = {
      ...makeFireLifecycleState([fire.position], 1),
      burningActors: [{
        id: 'mob:1',
        kind: 'entity',
        position: fire.position,
        remainingTicks: 1,
        damageCooldownTicks: 0,
      }],
    }
    const step = advanceFireLifecycle(state, [coveredFire, stoneBelow], 'clear', [{
      id: 'mob:1',
      kind: 'entity',
      position: fire.position,
    }])
    expect(step.entityDamages).toHaveLength(1)
    expect(step.state.burningActors?.[0]?.remainingTicks).toBe(FIRE_BURN_DURATION_TICKS - 1)
  })

  it('an actor whose burn duration lapses stops burning without dying or being doused', () => {
    // Distinct from the water/rain/death paths below: here the actor is
    // present in `contacts` (so its remaining ticks are decremented, unlike
    // the "deferred" case) and is not standing in a fire cell (so it is not
    // re-ignited to full duration first). One tick of decrement exhausts it.
    const burning: FireLifecycleState = {
      fires: [],
      seed: 1,
      burningActors: [{
        id: 'mob:1',
        kind: 'entity',
        position: fire.position,
        remainingTicks: 1,
        damageCooldownTicks: 0,
      }],
    }
    const contact = { id: 'mob:1', kind: 'entity' as const, position: fire.position, alive: true }

    const step = advanceFireLifecycle(burning, [], 'clear', [contact])

    expect(step.state.burningActors).toStrictEqual([])
  })

  it('water, rain exposure and death clear burning state while deferred actors remain stable', () => {
    const burning: FireLifecycleState = {
      fires: [],
      seed: 1,
      burningActors: [{
        id: 'mob:1',
        kind: 'entity',
        position: fire.position,
        remainingTicks: 10,
        damageCooldownTicks: 0,
      }],
    }
    const contact = { id: 'mob:1', kind: 'entity' as const, position: fire.position }
    expect(advanceFireLifecycle(burning, [], 'clear', [{ ...contact, inWater: true }]).state.burningActors)
      .toStrictEqual([])
    expect(advanceFireLifecycle(burning, [], 'rain', [{ ...contact, exposedToSky: true }]).state.burningActors)
      .toStrictEqual([])
    expect(advanceFireLifecycle(burning, [], 'clear', [{ ...contact, alive: false }]).state.burningActors)
      .toStrictEqual([])
    expect(advanceFireLifecycle(burning, [], 'clear', []).state.burningActors).toStrictEqual(
      burning.burningActors,
    )
  })

  it('peaceful keeps the burn timer but suppresses damage', () => {
    const step = advanceFireLifecycle(
      makeFireLifecycleState([fire.position], 1),
      [coveredFire, stoneBelow],
      'clear',
      [{ id: 'player', kind: 'player', position: fire.position }],
      'peaceful',
    )
    expect(step.damages).toStrictEqual([])
    expect(step.state.burningActors?.[0]).toMatchObject({
      remainingTicks: FIRE_BURN_DURATION_TICKS - 1,
      damageCooldownTicks: 0,
    })
  })

  it('emits ordered legacy contact damage events for live fire', () => {
    const step = advanceFireLifecycle(makeFireLifecycleState([fire.position], 1), [fire], 'clear', [fire.position])
    expect(step.damages).toStrictEqual([
      { _tag: 'FireContact', at: fire.position, damage: { amount: 1, cause: 'in_fire' } },
    ])
  })

  it('snapshots and restores isolated, bounded, versioned state', () => {
    const state: FireLifecycleState = {
      ...makeFireLifecycleState([fire.position], -1),
      burningActors: [{
        id: 'player',
        kind: 'player',
        position: fire.position,
        remainingTicks: 5,
        damageCooldownTicks: 2,
      }],
    }
    const snapshot = makeFireLifecycleSnapshot(state, 99)
    expect(snapshot.version).toBe(FIRE_LIFECYCLE_SNAPSHOT_VERSION)
    expect(snapshot.tickAccumulatorSecs).toBe(FIRE_TICK_INTERVAL_SECS * FIRE_FRAME_TICK_BUDGET)
    expect(snapshot.fires[0]?.position).not.toBe(state.fires[0]?.position)
    expect(snapshot.burningActors[0]?.position).not.toBe(state.burningActors?.[0]?.position)
    expect(isFireLifecycleSnapshot(snapshot)).toBe(true)
    expect(isFireLifecycleSnapshot({ ...snapshot, version: 2 })).toBe(false)
    expect(isFireLifecycleSnapshot({ ...snapshot, fires: [{ ageTicks: -1 }] })).toBe(false)

    const restored = restoreFireLifecycleSnapshot(snapshot)
    expect(restored.state).toStrictEqual({
      fires: snapshot.fires,
      burningActors: snapshot.burningActors,
      seed: snapshot.seed,
    })
    expect(restored.state.fires[0]?.position).not.toBe(snapshot.fires[0]?.position)
    expect(makeFireLifecycleSnapshot(state, Number.NaN).tickAccumulatorSecs).toBe(0)
  })

  it('rejects a bare null snapshot without touching its shape', () => {
    expect(isFireLifecycleSnapshot(null)).toBe(false)
  })

  it('validates unloadedRetries when present, and both burning-actor kinds', () => {
    const base = makeFireLifecycleSnapshot(makeFireLifecycleState([fire.position], 1), 0)
    const validFire = { ...base.fires[0]!, unloadedRetries: 2 }
    const invalidFire = { ...base.fires[0]!, unloadedRetries: -1 }
    const entityActor = {
      id: 'mob:1',
      kind: 'entity' as const,
      position: fire.position,
      remainingTicks: 5,
      damageCooldownTicks: 0,
    }
    const invalidKindActor = { ...entityActor, kind: 'zombie' }

    expect(isFireLifecycleSnapshot({ ...base, fires: [validFire] })).toBe(true)
    expect(isFireLifecycleSnapshot({ ...base, fires: [invalidFire] })).toBe(false)
    expect(isFireLifecycleSnapshot({ ...base, burningActors: [entityActor] })).toBe(true)
    expect(isFireLifecycleSnapshot({ ...base, burningActors: [invalidKindActor] })).toBe(false)
  })

  it('bounds per-tick fire work and preserves deferred fires', () => {
    const positions = Array.from({ length: FIRE_WORK_BUDGET + 1 }, (_, index) => ({
      x: index * 3,
      y: 1,
      z: 0,
    }))
    const cells: FireCell[] = positions.flatMap((position) => [
      { position, block: 'fire' },
      { position: { ...position, y: 0 }, block: 'stone' },
    ])
    const step = advanceFireLifecycle(makeFireLifecycleState(positions, 1), cells, 'clear')
    expect(step.state.fires).toHaveLength(FIRE_WORK_BUDGET + 1)
    expect(step.state.fires.slice(0, FIRE_WORK_BUDGET).every((active) => active.ageTicks === 1)).toBe(true)
    expect(step.state.fires[FIRE_WORK_BUDGET]?.ageTicks).toBe(0)
  })
})
