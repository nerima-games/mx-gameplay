import { describe, expect, it } from '@effect/vitest'
import {
  DESPAWN_DISTANCE_BLOCKS,
  RANDOM_DESPAWN_CHANCE,
  RANDOM_DESPAWN_MIN_AGE_TICKS,
  RANDOM_DESPAWN_MIN_DISTANCE_BLOCKS,
  despawnVerdict,
  type DespawnCandidate,
} from '../src/domain/mob/hostile-despawn'

const candidate = (overrides: Partial<DespawnCandidate> = {}): DespawnCandidate => ({
  distanceToPlayerBlocks: 64,
  persistent: false,
  difficulty: 'normal',
  ageTicks: RANDOM_DESPAWN_MIN_AGE_TICKS + 1,
  randomRoll: 0,
  ...overrides,
})

describe('complete hostile despawn rule', () => {
  it('uses a strict immediate despawn distance boundary', () => {
    expect(despawnVerdict(candidate({ distanceToPlayerBlocks: DESPAWN_DISTANCE_BLOCKS }))).toStrictEqual({
      _tag: 'Despawn', reason: 'natural',
    })
    expect(
      despawnVerdict(candidate({
        distanceToPlayerBlocks: DESPAWN_DISTANCE_BLOCKS + 0.001,
        ageTicks: 0,
        randomRoll: 1,
      })),
    ).toStrictEqual({ _tag: 'Despawn', reason: 'too-far' })
  })

  it('keeps mobs at the random distance and age boundaries', () => {
    expect(despawnVerdict(candidate({ distanceToPlayerBlocks: RANDOM_DESPAWN_MIN_DISTANCE_BLOCKS }))).toStrictEqual({
      _tag: 'Keep',
    })
    expect(despawnVerdict(candidate({ ageTicks: RANDOM_DESPAWN_MIN_AGE_TICKS }))).toStrictEqual({
      _tag: 'Keep',
    })
  })

  it('uses the supplied roll deterministically with a strict probability boundary', () => {
    const input = candidate({ randomRoll: RANDOM_DESPAWN_CHANCE - Number.EPSILON })
    expect(despawnVerdict(input)).toStrictEqual({ _tag: 'Despawn', reason: 'natural' })
    expect(despawnVerdict(input)).toStrictEqual({ _tag: 'Despawn', reason: 'natural' })
    expect(despawnVerdict(candidate({ randomRoll: RANDOM_DESPAWN_CHANCE }))).toStrictEqual({ _tag: 'Keep' })
    expect(
      despawnVerdict({
        distanceToPlayerBlocks: 64,
        persistent: false,
        difficulty: 'normal',
        ageTicks: RANDOM_DESPAWN_MIN_AGE_TICKS + 1,
      }),
    ).toStrictEqual({ _tag: 'Keep' })
  })

  it.each([
    ['persistent', { persistent: true }],
    ['named', { named: true }],
    ['tamed', { tamed: true }],
  ] as const)('keeps %s mobs from distance and natural despawning', (_label, exemption) => {
    expect(
      despawnVerdict(candidate({ distanceToPlayerBlocks: DESPAWN_DISTANCE_BLOCKS + 1, ...exemption })),
    ).toStrictEqual({ _tag: 'Keep' })
  })

  it('removes hostile mobs in peaceful difficulty', () => {
    expect(despawnVerdict(candidate({ difficulty: 'peaceful', persistent: true }))).toStrictEqual({
      _tag: 'Despawn', reason: 'peaceful',
    })
  })

  it('keeps mobs when there is no player and does not consume or invent a roll', () => {
    expect(
      despawnVerdict(candidate({ distanceToPlayerBlocks: undefined, randomRoll: 0 })),
    ).toStrictEqual({ _tag: 'Keep' })
  })
})
