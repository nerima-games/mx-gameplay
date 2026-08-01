import type { DeltaTimeSecs } from '../frame-contract'
import { TNT_EXPLOSION_POWER, type Explosion } from './explosion'

export const PRIMED_TNT_FUSE_SECS = 4

export type PrimedTnt = {
  readonly _tag: 'PrimedTnt'
  readonly burnedSecs: number
}

export const FRESH_PRIMED_TNT: PrimedTnt = { _tag: 'PrimedTnt', burnedSecs: 0 }

export type PrimedTntStep = {
  readonly tnt: PrimedTnt
  readonly explosion?: Explosion
}

export const stepPrimedTnt = (tnt: PrimedTnt, dt: DeltaTimeSecs): PrimedTntStep => {
  const burnedSecs = tnt.burnedSecs + Math.max(0, Number(dt))
  if (burnedSecs >= PRIMED_TNT_FUSE_SECS) {
    return {
      tnt: { _tag: 'PrimedTnt', burnedSecs },
      explosion: { source: 'tnt', power: TNT_EXPLOSION_POWER },
    }
  }

  return burnedSecs === tnt.burnedSecs
    ? { tnt }
    : { tnt: { _tag: 'PrimedTnt', burnedSecs } }
}

export const isPrimedTnt = (value: unknown): value is PrimedTnt => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { readonly _tag?: unknown; readonly burnedSecs?: unknown }
  return candidate._tag === 'PrimedTnt' &&
    typeof candidate.burnedSecs === 'number' &&
    Number.isFinite(candidate.burnedSecs) &&
    candidate.burnedSecs >= 0
}
