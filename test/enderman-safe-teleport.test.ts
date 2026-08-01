import { describe, expect, it } from '@effect/vitest'
import {
  endermanTeleportUrge,
  resolveSafeEndermanTeleport,
  type EndermanTeleportCell,
  type EndermanTeleportPosition,
} from '../src/domain/mob/enderman-teleport'

const current = { x: 0, y: 64, z: 0 } as const
const anchor = { x: 100, y: 70, z: 100 } as const
const rolls = [0.75, 0.5, 0.5, 0.75] as const

const landing = (
  position: EndermanTeleportPosition,
  floor = 'stone',
): ReadonlyArray<EndermanTeleportCell> => [
  { position: { ...position, y: position.y - 1 }, block: floor, solid: true },
  { position, block: 'air', solid: false },
  { position: { ...position, y: position.y + 1 }, block: 'air', solid: false },
]

describe('safe enderman teleport', () => {
  it('chooses the first safe candidate in deterministic roll order', () => {
    const first = { x: 116, y: 64, z: 100 }
    const second = { x: 100, y: 64, z: 116 }
    const cells = [...landing(first), ...landing(second)]
    expect(resolveSafeEndermanTeleport(current, anchor, rolls, cells)).toStrictEqual(first)
    expect(resolveSafeEndermanTeleport(current, anchor, rolls, [...cells].reverse())).toStrictEqual(first)
  })

  it('skips an unsafe first candidate and preserves candidate order', () => {
    const first = { x: 116, y: 64, z: 100 }
    const second = { x: 100, y: 64, z: 116 }
    const cells = [
      ...landing(first).filter((cell) => cell.position.y !== first.y + 1),
      { position: { ...first, y: first.y + 1 }, block: 'stone', solid: true },
      ...landing(second),
    ]
    expect(resolveSafeEndermanTeleport(current, anchor, rolls, cells)).toStrictEqual(second)
  })

  it('requires loaded solid floor and two air cells', () => {
    const target = { x: 116, y: 64, z: 100 }
    expect(resolveSafeEndermanTeleport(current, anchor, rolls.slice(0, 2), landing(target))).toStrictEqual(target)
    expect(resolveSafeEndermanTeleport(current, anchor, rolls.slice(0, 2), landing(target).slice(1))).toBe(current)
    expect(resolveSafeEndermanTeleport(current, anchor, rolls.slice(0, 2), landing(target).slice(0, 2))).toBe(current)
  })

  it.each(['water', 'lava', 'fire', 'cactus', 'magma_block'])('refuses hazardous %s cells', (block) => {
    const target = { x: 116, y: 64, z: 100 }
    const cells = [...landing(target)]
    cells[1] = { position: target, block, solid: block === 'cactus' || block === 'magma_block' }
    expect(resolveSafeEndermanTeleport(current, anchor, rolls.slice(0, 2), cells)).toBe(current)
  })

  it('leaves position unchanged for invalid, exhausted, or out-of-band rolls', () => {
    expect(resolveSafeEndermanTeleport(current, anchor, [], [])).toBe(current)
    expect(resolveSafeEndermanTeleport(current, anchor, [Number.NaN, 0.5], [])).toBe(current)
    expect(resolveSafeEndermanTeleport(current, anchor, [0.5, 0.5], [])).toBe(current)
  })

  it('treats water and daylight as immediate self-anchored escape triggers', () => {
    const base = { damagedThisStep: false, stuckTicks: 0, roll: 0.99 }
    expect(endermanTeleportUrge({ ...base, inWater: true })).toStrictEqual({
      _tag: 'Teleport', reason: 'water', anchor: 'self',
    })
    expect(endermanTeleportUrge({ ...base, exposedToDaylight: true })).toStrictEqual({
      _tag: 'Teleport', reason: 'daylight', anchor: 'self',
    })
  })
})
