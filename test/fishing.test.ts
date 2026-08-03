import { describe, expect, it } from '@effect/vitest'
import {
  addItem,
  countOf,
  durability,
  emptyInventory,
  equipmentItem,
  itemStack,
  type EquipmentItem,
} from '@nerima-games/mc-sim'
import {
  advanceFishing,
  cancelFishing,
  castFishing,
  fishingPhase,
  reelFishing,
  FISHING_BITE_WINDOW_SECS,
  FISHING_MAX_WAIT_SECS,
  FISHING_MIN_WAIT_SECS,
  type FishingEnvironment,
  type FishingRolls,
  type FishingSession,
} from '../src/domain/interactions/fishing'

const CLEAR_OPEN_WATER: FishingEnvironment = {
  hasWater: true,
  hasSkyAccess: true,
  isRaining: false,
  isOpenWater: true,
}

const DEFAULT_ROLLS: FishingRolls = {
  wait: 0,
  category: 0,
  item: 0,
}

const fishingRod = (current = 64): EquipmentItem =>
  equipmentItem(itemStack('fishing_rod', 1), durability(current, 64))

const castSession = (
  environment: FishingEnvironment = CLEAR_OPEN_WATER,
  rolls: FishingRolls = DEFAULT_ROLLS,
  currentDurability = 64,
): FishingSession => {
  const result = castFishing(fishingRod(currentDurability), environment, rolls)
  if (result._tag !== 'Cast') throw new Error(`Expected Cast, received ${result._tag}`)
  return result.session
}

describe('castFishing', () => {
  it('requires a valid fishing rod and water', () => {
    expect(castFishing(null, CLEAR_OPEN_WATER, DEFAULT_ROLLS)).toEqual({ _tag: 'InvalidRod' })
    expect(
      castFishing(equipmentItem(itemStack('bow', 1)), CLEAR_OPEN_WATER, DEFAULT_ROLLS),
    ).toEqual({ _tag: 'InvalidRod' })
    expect(
      castFishing(fishingRod(), { ...CLEAR_OPEN_WATER, hasWater: false }, DEFAULT_ROLLS),
    ).toEqual({ _tag: 'NoWater' })
  })

  it('rejects each non-normalised roll without sampling anything else', () => {
    expect(castFishing(fishingRod(), CLEAR_OPEN_WATER, { ...DEFAULT_ROLLS, wait: -0.01 })).toEqual({
      _tag: 'InvalidRoll',
      roll: 'wait',
      value: -0.01,
    })
    expect(
      castFishing(fishingRod(), CLEAR_OPEN_WATER, {
        ...DEFAULT_ROLLS,
        category: Number.NaN,
      }),
    ).toMatchObject({ _tag: 'InvalidRoll', roll: 'category' })
    expect(castFishing(fishingRod(), CLEAR_OPEN_WATER, { ...DEFAULT_ROLLS, item: 1.01 })).toEqual({
      _tag: 'InvalidRoll',
      roll: 'item',
      value: 1.01,
    })
  })

  it('maps wait rolls inclusively from five to thirty seconds', () => {
    expect(castSession(CLEAR_OPEN_WATER, { ...DEFAULT_ROLLS, wait: 0 }).waitSecs).toBe(
      FISHING_MIN_WAIT_SECS,
    )
    expect(castSession(CLEAR_OPEN_WATER, { ...DEFAULT_ROLLS, wait: 1 }).waitSecs).toBe(
      FISHING_MAX_WAIT_SECS,
    )
  })

  it('accelerates only rain with sky access by twenty percent', () => {
    const rolls = { ...DEFAULT_ROLLS, wait: 1 }
    expect(castSession({ ...CLEAR_OPEN_WATER, isRaining: true }, rolls).waitSecs).toBe(24)
    expect(
      castSession({ ...CLEAR_OPEN_WATER, isRaining: true, hasSkyAccess: false }, rolls).waitSecs,
    ).toBe(30)
    expect(castSession({ ...CLEAR_OPEN_WATER, hasSkyAccess: false }, rolls).waitSecs).toBe(30)
  })

  it('copies the rod and rolls into a deterministic session', () => {
    const rod = fishingRod()
    const rolls = { ...DEFAULT_ROLLS }
    const result = castFishing(rod, CLEAR_OPEN_WATER, rolls)
    if (result._tag !== 'Cast') throw new Error('Expected Cast')

    expect(result.session.rod).toEqual(rod)
    expect(result.session.rod).not.toBe(rod)
    expect(result.session.rolls).toEqual(rolls)
    expect(result.session.rolls).not.toBe(rolls)
    expect(result.session.biteWindowSecs).toBe(FISHING_BITE_WINDOW_SECS)
  })
})

describe('advanceFishing', () => {
  it('uses inclusive bite start and exclusive bite end boundaries', () => {
    const session = castSession()

    const waiting = advanceFishing(session, FISHING_MIN_WAIT_SECS - 0.01, { hasWater: true })
    expect(waiting._tag).toBe('Waiting')
    if (waiting._tag !== 'Waiting') throw new Error('Expected Waiting')
    expect(fishingPhase(waiting.session)).toBe('waiting')

    const bite = advanceFishing(session, FISHING_MIN_WAIT_SECS, { hasWater: true })
    expect(bite._tag).toBe('Bite')
    if (bite._tag !== 'Bite') throw new Error('Expected Bite')
    expect(fishingPhase(bite.session)).toBe('bite')

    const escaped = advanceFishing(session, FISHING_MIN_WAIT_SECS + FISHING_BITE_WINDOW_SECS, {
      hasWater: true,
    })
    expect(escaped._tag).toBe('Escaped')
    if (escaped._tag !== 'Escaped') throw new Error('Expected Escaped')
    expect(fishingPhase(escaped.session)).toBe('escaped')
  })

  it('accumulates duration without changing captured rolls or open-water state', () => {
    const session = castSession(CLEAR_OPEN_WATER, { wait: 0.5, category: 0.96, item: 0.75 })
    const first = advanceFishing(session, 4, { hasWater: true })
    if (first._tag !== 'Waiting') throw new Error('Expected Waiting')
    const second = advanceFishing(first.session, 4, { hasWater: true })
    if (second._tag !== 'Waiting') throw new Error('Expected Waiting')

    expect(second.session.elapsedSecs).toBe(8)
    expect(second.session.rolls).toEqual(session.rolls)
    expect(second.session.openWater).toBe(true)
  })

  it('rejects negative and non-finite durations without changing the session', () => {
    const session = castSession()
    expect(advanceFishing(session, -1, { hasWater: true })).toEqual({
      _tag: 'InvalidDuration',
      durationSecs: -1,
      session,
    })
    expect(advanceFishing(session, Number.POSITIVE_INFINITY, { hasWater: true })).toEqual({
      _tag: 'InvalidDuration',
      durationSecs: Number.POSITIVE_INFINITY,
      session,
    })
  })

  it('losing water cancels without rod wear', () => {
    const session = castSession()
    const result = advanceFishing(session, 3, { hasWater: false })
    expect(result).toEqual({
      _tag: 'Cancelled',
      reason: 'LostWater',
      rod: fishingRod(),
    })
  })
})

describe('cancelFishing', () => {
  it('player cancellation returns an unworn copy of the rod', () => {
    const session = castSession()
    const result = cancelFishing(session)
    expect(result).toEqual({ _tag: 'Cancelled', reason: 'Player', rod: fishingRod() })
    expect(result.rod).not.toBe(session.rod)
  })
})

describe('reelFishing', () => {
  it('wears the rod on an early reel and on a late reel', () => {
    const session = castSession()
    expect(reelFishing(session)).toEqual({ _tag: 'ReeledTooEarly', rod: fishingRod(63) })

    const escaped = advanceFishing(session, 7, { hasWater: true })
    if (escaped._tag !== 'Escaped') throw new Error('Expected Escaped')
    expect(reelFishing(escaped.session)).toEqual({ _tag: 'ReeledTooLate', rod: fishingRod(63) })
  })

  it('wears the rod on a catch and breaks it at zero remaining durability', () => {
    const session = castSession(CLEAR_OPEN_WATER, DEFAULT_ROLLS, 1)
    const bite = advanceFishing(session, 5, { hasWater: true })
    if (bite._tag !== 'Bite') throw new Error('Expected Bite')

    expect(reelFishing(bite.session)).toEqual({
      _tag: 'Caught',
      loot: { category: 'fish', item: 'cod', count: 1 },
      rod: null,
    })
  })

  it('uses exact category boundaries and the full item-roll interval', () => {
    const catchFor = (category: number, item: number, isOpenWater = true) => {
      const session = castSession(
        { ...CLEAR_OPEN_WATER, isOpenWater },
        { wait: 0, category, item },
      )
      return reelFishing({ ...session, elapsedSecs: session.waitSecs })
    }

    expect(catchFor(0.849, 0)).toMatchObject({
      _tag: 'Caught',
      loot: { category: 'fish', item: 'cod' },
    })
    expect(catchFor(0.85, 1)).toMatchObject({
      _tag: 'Caught',
      loot: { category: 'junk', item: 'lily_pad' },
    })
    expect(catchFor(0.95, 0)).toMatchObject({
      _tag: 'Caught',
      loot: { category: 'treasure', item: 'name_tag' },
    })
    expect(catchFor(1, 1)).toMatchObject({
      _tag: 'Caught',
      loot: { category: 'treasure', item: 'enchanted_book' },
    })
  })

  it('falls back from treasure to fish outside open water using the same item roll', () => {
    const session = castSession(
      { ...CLEAR_OPEN_WATER, isOpenWater: false },
      { wait: 0, category: 0.95, item: 1 },
    )
    expect(reelFishing({ ...session, elapsedSecs: session.waitSecs })).toMatchObject({
      _tag: 'Caught',
      loot: { category: 'fish', item: 'pufferfish' },
    })
  })

  it('returns an inventory-compatible ItemType/count loot value', () => {
    const session = castSession()
    const result = reelFishing({ ...session, elapsedSecs: session.waitSecs })
    if (result._tag !== 'Caught') throw new Error('Expected Caught')

    const added = addItem(emptyInventory(), result.loot.item, result.loot.count)
    expect(added.leftover).toBe(0)
    expect(countOf(added.inventory, result.loot.item)).toBe(1)
  })
})
