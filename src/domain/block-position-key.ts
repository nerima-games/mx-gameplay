/** Coordinate key conversion for gameplay's scheduling boundary. */
import {
  adjacentBlockPosition,
  blockPosition,
  horizontalBlockNeighbours,
} from '@nerima-games/mc-kernel'
import type { BlockPosition } from './chunk-store-port.js'
import { positionKey, type PositionKey } from './position-key.js'

export const positionKeyOf = (position: BlockPosition): PositionKey =>
  positionKey(`${String(position.x)},${String(position.y)},${String(position.z)}`)

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
  const values = parts.map(Number)
  const valid = parts.length === 3 && values.every(Number.isSafeInteger)
  return valid ? { x: values[0]!, y: values[1]!, z: values[2]! } : { x: Number.NaN, y: Number.NaN, z: Number.NaN }
}

/** The cell directly below `position`. */
const kernelPosition = (position: BlockPosition) => blockPosition(position.x, position.y, position.z)

export const below = (position: BlockPosition): BlockPosition =>
  adjacentBlockPosition(kernelPosition(position), 'down')

/** The cell directly above `position`. */
export const above = (position: BlockPosition): BlockPosition =>
  adjacentBlockPosition(kernelPosition(position), 'up')

/**
 * The four cells beside `position` on the horizontal plane, in `-x, +x, -z, +z`
 * order.
 *
 * ALWAYS FOUR, and that is where it differs from the reference implementation's
 * `localHorizontalNeighbors` (`packages/world/domain/block-placement-rules.ts`),
 * which filters out any neighbour whose CHUNK-LOCAL coordinate leaves the chunk:
 *
 *     .filter((column) => lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE)
 *
 * That filter is not a rule about the world, it is an artefact of that
 * function's caller holding one `Chunk` and being unable to read past its edge —
 * and it changes the ANSWER. A cactus placed against a chunk boundary is checked
 * on two or three sides instead of four there, so it can be placed with a stone
 * block flush against it, and a sugar cane at the boundary cannot see the water
 * that is one cell away in the next chunk. Both are position-dependent
 * placement rules, which is the kind of bug a player reports as "it only works
 * sometimes".
 *
 * This repository has no such limitation, because a rule here reads through
 * `./chunk-store-port`'s `ChunkStore` and a cell in the next chunk is one more
 * call. `test/rules.test.ts` pins the chunk-edge case from both sides.
 *
 * The ORDER is fixed and is part of the contract: two runs of one scenario must
 * issue the same store calls in the same sequence (plan.md §5.1-3), and a test
 * that counts reads is otherwise counting an iteration order nobody wrote down.
 */
export const horizontalNeighbours = (position: BlockPosition): ReadonlyArray<BlockPosition> =>
  horizontalBlockNeighbours(kernelPosition(position))
