/**
 * The join between the two vocabularies this repository borrows: the SCHEDULING
 * key (`./position-key`) and the WORLD position (`./chunk-store-port`).
 *
 * ---------------------------------------------------------------------------
 * PLACEHOLDER. It dies with the two files it joins.
 * ---------------------------------------------------------------------------
 *
 * `FallingBlockQueue` and the fluid frontier schedule work by an opaque string
 * because they never navigate — they only remember. The rules that DO navigate
 * need the three numbers back, and this is the only place in the repository
 * that turns one into the other. Kernel owns `Position` and will own its key
 * encoding (plan.md §3.1); when it is published this file is deleted and its
 * two functions come from there, exactly as `./frame-contract`,
 * `./position-key` and `./chunk-store-port` do.
 *
 * Keeping the encoding in ONE function is the point. The reference
 * implementation spelled `${x},${y},${z}` at every call site, and a repository
 * that does that cannot change the encoding at all — a key written by one rule
 * and read by another is a wire format with no owner.
 *
 * NOT re-exported from `index.ts`, for the reason its two neighbours are not:
 * it is somebody else's vocabulary wearing this repository's file name.
 */
import type { BlockPosition } from './chunk-store-port'
import type { PositionKey } from './position-key'

export const positionKeyOf = (position: BlockPosition): PositionKey =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

/**
 * The inverse, for keys produced by `positionKeyOf`.
 *
 * TOTAL, and deliberately so: `StageRegistration.run` has no error channel, so
 * a rule handed a malformed key has nowhere to report it. A malformed key
 * yields `NaN` coordinates rather than `0` ones, and a `NaN` position reads as
 * `ChunkNotLoaded` or `OutOfWorld` from the store — the rule then skips it,
 * which is the safe outcome. Defaulting the missing components to zero would
 * instead point the rule at the origin of the world and quietly break a block
 * there.
 */
export const positionOfKey = (key: PositionKey): BlockPosition => {
  const parts = key.split(',')
  return { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) }
}

/** The cell directly below `position`. */
export const below = (position: BlockPosition): BlockPosition => ({
  x: position.x,
  y: position.y - 1,
  z: position.z,
})

/** The cell directly above `position`. */
export const above = (position: BlockPosition): BlockPosition => ({
  x: position.x,
  y: position.y + 1,
  z: position.z,
})
