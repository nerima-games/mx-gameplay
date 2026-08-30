import { describe, expect, it } from '@effect/vitest'
import { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import { TNT_EXPLOSION_POWER } from '../src/domain/mob/explosion'
import {
  FRESH_PRIMED_TNT,
  PRIMED_TNT_FUSE_SECS,
  isPrimedTnt,
  stepPrimedTnt,
} from '../src/domain/mob/primed-tnt'

describe('primed TNT', () => {
  it('preserves the fuse until four seconds have elapsed', () => {
    const waiting = stepPrimedTnt(FRESH_PRIMED_TNT, DeltaTimeSecs(PRIMED_TNT_FUSE_SECS - 0.01))
    expect(waiting.explosion).toBeUndefined()

    const exploded = stepPrimedTnt(waiting.tnt, DeltaTimeSecs(0.01))
    expect(exploded.explosion).toStrictEqual({ source: 'tnt', power: TNT_EXPLOSION_POWER })
  })

  it('rejects invalid persisted fuse state', () => {
    expect(isPrimedTnt({ _tag: 'PrimedTnt', burnedSecs: Number.NaN })).toBe(false)
    expect(isPrimedTnt({ _tag: 'PrimedTnt', burnedSecs: -1 })).toBe(false)
    expect(isPrimedTnt(FRESH_PRIMED_TNT)).toBe(true)
  })
})
