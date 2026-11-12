import type { CollisionShape } from '@nerima-games/mc-kernel'

type LocalCollisionBox = readonly [number, number, number, number, number, number]
type LocalCollisionBoxes = readonly [] | readonly [LocalCollisionBox]

export const LOCAL_COLLISION_BOXES_BY_SHAPE: Record<CollisionShape, LocalCollisionBoxes> = {
  full: [[0, 0, 0, 1, 1, 1]],
  none: [],
  slab: [[0, 0, 0, 1, 0.5, 1]],
  cactus: [[1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16]],
  pressurePlate: [[0, 0, 0, 1, 1 / 16, 1]],
}
