import type { EntityKind, MobPathProfile } from '@nerima-games/mc-sim'
import { BlockLength } from '@nerima-games/mc-physics'

type EntityBodyDimensions = Pick<MobPathProfile, 'width' | 'height'>
type EntityEyeDimensions = EntityBodyDimensions & Readonly<{ eyeHeight: BlockLength }>
export const PLAYER_DIMENSIONS: EntityEyeDimensions = {
  width: BlockLength(0.6), height: BlockLength(1.8), eyeHeight: BlockLength(1.62),
}
export const ENDERMAN_DIMENSIONS: EntityEyeDimensions = {
  width: BlockLength(0.6), height: BlockLength(2.9), eyeHeight: BlockLength(2.55),
}

// These are the gameplay's existing body sizes, shared by projectile and movement queries.
export const entityDimensionsOf = (kind: EntityKind): EntityBodyDimensions => {
  if (kind === 'spider') return { width: BlockLength(1.4), height: BlockLength(0.9) }
  if (kind === 'chicken') return { width: BlockLength(0.4), height: BlockLength(0.7) }
  if (kind === 'cow' || kind === 'sheep') return { width: BlockLength(0.9), height: BlockLength(1.4) }
  if (kind === 'pig') return { width: BlockLength(0.9), height: BlockLength(0.9) }
  if (kind === 'enderman') return ENDERMAN_DIMENSIONS
  return PLAYER_DIMENSIONS
}

export const entityMovementDimensionsOf = (kind: EntityKind): EntityBodyDimensions => {
  const dimensions = entityDimensionsOf(kind)
  return kind === 'zombie' || kind === 'skeleton' || kind === 'zombified_piglin'
    ? { ...dimensions, height: BlockLength(1.95) }
    : dimensions
}
