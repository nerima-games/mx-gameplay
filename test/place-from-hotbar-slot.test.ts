import { describe, expect, it, vi } from '@effect/vitest'
import { requestPlacementFromSelectedSlot, type HotbarSlot } from '../src/domain/interactions/place-from-hotbar-slot'

type Item = 'dirt' | 'stick'
const isPlaceable = (item: Item): item is 'dirt' => item === 'dirt'

const slots: ReadonlyArray<HotbarSlot<Item>> = [
  { item: 'dirt', count: 5 },
  { item: 'stick', count: 3 },
  undefined,
  { item: 'dirt', count: 0 },
]

describe('requestPlacementFromSelectedSlot', () => {
  it('requests placement of a placeable item with a positive count', () => {
    const requestPlacement = vi.fn()
    expect(requestPlacementFromSelectedSlot(slots, 0, isPlaceable, requestPlacement)).toBe(true)
    expect(requestPlacement).toHaveBeenCalledExactlyOnceWith('dirt')
  })

  it('refuses an item the guard rejects, without calling requestPlacement', () => {
    const requestPlacement = vi.fn()
    expect(requestPlacementFromSelectedSlot(slots, 1, isPlaceable, requestPlacement)).toBe(false)
    expect(requestPlacement).not.toHaveBeenCalled()
  })

  it('refuses an empty slot', () => {
    const requestPlacement = vi.fn()
    expect(requestPlacementFromSelectedSlot(slots, 2, isPlaceable, requestPlacement)).toBe(false)
    expect(requestPlacement).not.toHaveBeenCalled()
  })

  it('refuses a placeable item with a zero count', () => {
    const requestPlacement = vi.fn()
    expect(requestPlacementFromSelectedSlot(slots, 3, isPlaceable, requestPlacement)).toBe(false)
    expect(requestPlacement).not.toHaveBeenCalled()
  })

  it('refuses an out-of-range index rather than throwing', () => {
    const requestPlacement = vi.fn()
    expect(requestPlacementFromSelectedSlot(slots, 99, isPlaceable, requestPlacement)).toBe(false)
    expect(requestPlacement).not.toHaveBeenCalled()
  })

  it('refuses a negative count', () => {
    const requestPlacement = vi.fn()
    const negative: ReadonlyArray<HotbarSlot<Item>> = [{ item: 'dirt', count: -1 }]
    expect(requestPlacementFromSelectedSlot(negative, 0, isPlaceable, requestPlacement)).toBe(false)
    expect(requestPlacement).not.toHaveBeenCalled()
  })
})
