import { describe, expect, it } from 'vitest'
import { advanceFireLifecycle, makeFireLifecycleState } from '../src/domain/fire-lifecycle'

const fire = { position: { x: 0, y: 1, z: 0 }, block: 'fire', exposedToSky: true }
const wood = { position: { x: 1, y: 1, z: 0 }, block: 'oak_planks' }

describe('fire lifecycle', () => {
  it('is deterministic and independent of active/cell order', () => {
    const state = makeFireLifecycleState([fire.position], 1)
    expect(advanceFireLifecycle(state, [fire, wood], 'clear')).toStrictEqual(
      advanceFireLifecycle({ ...state, fires: [...state.fires].reverse() }, [wood, fire], 'clear'),
    )
  })

  it('does not spread across an unloaded boundary omitted from the snapshot', () => {
    const step = advanceFireLifecycle(makeFireLifecycleState([fire.position], 1), [fire], 'clear')
    expect(step.mutations).toStrictEqual([])
  })

  it('rain extinguishes only sky-exposed fire', () => {
    const state = makeFireLifecycleState([fire.position], 1)
    expect(advanceFireLifecycle(state, [fire], 'rain').mutations).toStrictEqual([
      { position: fire.position, block: 'air' },
    ])
    expect(advanceFireLifecycle(state, [{ ...fire, exposedToSky: false }], 'rain').state.fires).toHaveLength(1)
  })

  it('consumes fuel on spread and naturally extinguishes', () => {
    let state = makeFireLifecycleState([fire.position], 1)
    const spread = advanceFireLifecycle(state, [fire, wood], 'clear')
    expect(spread.mutations).toContainEqual({ position: wood.position, block: 'fire' })
    state = makeFireLifecycleState([fire.position], 1)
    for (let tick = 0; tick < 8; tick += 1) state = advanceFireLifecycle(state, [fire], 'clear').state
    expect(state.fires).toStrictEqual([])
  })

  it('emits ordered contact damage events for live fire', () => {
    const step = advanceFireLifecycle(makeFireLifecycleState([fire.position], 1), [fire], 'clear', [fire.position])
    expect(step.damages).toStrictEqual([{ _tag: 'FireContact', at: fire.position, damage: { amount: 1, cause: 'fire' } }])
  })
})
