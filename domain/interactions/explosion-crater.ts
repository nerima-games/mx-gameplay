/**
 * ONE RULE, ONE FILE (DN-GP-9): an explosion removes the blocks inside its
 * crater radius.
 *
 * ---------------------------------------------------------------------------
 * This file is where `../mob/explosion.ts` said it would be
 * ---------------------------------------------------------------------------
 *
 * That file computes how hard a blast hits and refuses, in a headed section, to
 * compute the crater as well:
 *
 *     The crater is NOT here, and it is not an oversight: it is a rule that
 *     WRITES BLOCKS, so it belongs next to `../interactions/break-block.ts` with
 *     a `ChunkStoreApi`, and it must feed `disturb` (`../falling-block`) or a
 *     blast under a desert leaves the sand hanging — which is DN-GP-1's cascade,
 *     arriving from a new direction.
 *
 * Both halves of that sentence are the whole of this file: it takes a store, and
 * it returns the positions it changed so that the caller can `disturb` them. It
 * returns them rather than enqueueing them itself for the same reason
 * `breakBlock` returns `Broken.yielded` rather than pushing to an inventory —
 * the queue is `stages/registration.ts`'s frame-local scratch and a rule that
 * reached into it would be a second writer of it.
 *
 * ---------------------------------------------------------------------------
 * TWO DIFFERENT RADII, and this is the OTHER one
 * ---------------------------------------------------------------------------
 *
 * `../mob/explosion.ts` warns about exactly this call site: the reference damages
 * entities out to `power * 2` = 6 blocks and destroys blocks out to
 * `Math.floor(power)` = 3
 * (`<reference-impl>/packages/app/application/frame/stages/placement-geometry.ts:14-26`,
 * a solid Euclidean sphere set to AIR). Those are different numbers for the same
 * event and the temptation is to reach for `explosionRadius`, which is the damage
 * one. `craterRadius` below is deliberately in this file rather than beside it,
 * so that a reader who has `explosionRadius` in scope has to notice that they are
 * calling something else.
 *
 * ---------------------------------------------------------------------------
 * `ChunkNotLoaded` is not air, here as everywhere
 * ---------------------------------------------------------------------------
 *
 * Every one of the four write outcomes is decided explicitly below, because
 * `StageRegistration.run` has no error channel to put a fifth answer in. The one
 * worth naming is `Unchanged`: a crater cell that was already air did not dirty
 * the chunk, so it must not enter the falling-block queue either. A blast in open
 * sky would otherwise enqueue a hundred-odd positions that have nothing above
 * them, and the per-tick budget would then spend the next four ticks discovering
 * that — the exact workload shape `../falling-block`'s header exists to prevent,
 * paid on a different trigger.
 *
 * ---------------------------------------------------------------------------
 * What this rule does NOT do
 * ---------------------------------------------------------------------------
 *
 * BLAST RESISTANCE. Vanilla stops a blast at obsidian and bedrock, and kernel's
 * capability audit has no `blastResistance` flag for `../chunk-store-port` to
 * transcribe. Inventing a block list here is precisely the scatter plan.md §3.1
 * measured (`blockTypeToIndex('SAND')` in 229 places), and the reference has no
 * such test either — its sphere sets every cell to AIR. So it is ported as it
 * stands and named on the arena's missing list, where it arrives as one row in
 * kernel's table and no edit here.
 *
 * RAY-CAST EXPOSURE. Vanilla's crater is ragged because each cell's chance to
 * break is a function of a ray from the centre. The reference's is a plain
 * sphere; docs/porting.md §4 makes the reference the specification, and a
 * "better" crater is the kind of change that should arrive with a measurement.
 *
 * DROPS FROM DESTROYED BLOCKS. Vanilla drops a fraction of them. That is a
 * question for kernel's `BlockDrop` and a roll, and it is the same shape as
 * `../mob/mob-drop`; nothing consumes it yet, so it is not invented here.
 */
import { Effect } from 'effect'
import { positionKeyOf } from '../block-position-key'
import { AIR_BLOCK_ID, type BlockPosition, type ChunkStoreApi } from '../chunk-store-port'
import type { PositionKey } from '../position-key'

/**
 * How far a blast destroys blocks, as opposed to how far it hurts.
 *
 * `<reference-impl>/packages/app/application/frame/stages/placement-geometry.ts:14-26`:
 * `Math.floor(power)`. Three blocks for a creeper, against the six that
 * `explosionRadius` reports for damage. TOTAL: a power that is not a number, or
 * is negative, has no crater at all rather than a `NaN` bound that would make
 * every loop below run zero times by accident instead of on purpose.
 */
export const craterRadius = (power: number): number =>
  Number.isFinite(power) ? Math.max(0, Math.floor(power)) : 0

/**
 * The cells a blast of this power removes, centred on `centre`.
 *
 * PURE, TOTAL and deterministic, and separate from the writes for that reason:
 * the geometry is the part worth enumerating in a test, and the store call is
 * the part that is worth counting. The order is the nested loop's — y outermost,
 * then x, then z — so two runs disturb the same positions in the same order,
 * which is what keeps `../falling-block`'s insertion-ordered queue an oracle.
 *
 * A SOLID Euclidean sphere, `dx² + dy² + dz² <= r²`, which is the reference's
 * shape. Note that the comparison is against the SQUARED radius rather than
 * against `Math.hypot`: the coordinates are integers, so the squared form is
 * exact and the boundary cell at exactly `r` is included without depending on
 * how a square root rounded.
 */
export const craterCells = (
  centre: BlockPosition,
  power: number,
): ReadonlyArray<BlockPosition> => {
  const radius = craterRadius(power)
  if (radius <= 0 || !Number.isFinite(centre.x) || !Number.isFinite(centre.y) || !Number.isFinite(centre.z)) {
    return []
  }

  const cells: Array<BlockPosition> = []
  const limit = radius * radius

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (dx * dx + dy * dy + dz * dz <= limit) {
          cells.push({ x: centre.x + dx, y: centre.y + dy, z: centre.z + dz })
        }
      }
    }
  }

  return cells
}

/**
 * Carve the crater, and report what actually changed.
 *
 * The returned keys are the caller's input to `disturb`: only the cells whose
 * write came back `Written`, so a blast in open sky reports nothing and enqueues
 * nothing. See the module header on `Unchanged`.
 *
 * ONE store call per cell and no reads — the same discipline `breakBlock`
 * states: `setBlock` returns the block it replaced, so asking first would be a
 * TOCTOU as well as a doubling of the cost. A creeper's crater is 123 cells, and
 * it is paid on the frame a creeper detonates and on no other; the cascade it
 * starts is bounded separately by `FALLING_BLOCK_MOVES_PER_TICK`.
 */
export const carveExplosionCrater = (
  store: ChunkStoreApi,
  centre: BlockPosition,
  power: number,
): Effect.Effect<ReadonlyArray<PositionKey>> =>
  Effect.gen(function* () {
    const disturbed: Array<PositionKey> = []

    for (const cell of craterCells(centre, power)) {
      const outcome = yield* store.setBlock(cell, AIR_BLOCK_ID)

      switch (outcome._tag) {
        case 'Written': {
          disturbed.push(positionKeyOf(cell))
          break
        }

        // The cell was already air: the write did not dirty the chunk, so it
        // must not enter the falling-block queue either.
        case 'Unchanged':
        // Not this session's to touch. Not an error — the blast reached the
        // edge of the resident area, or the bottom of the world — and `run`
        // has no error channel to put one in anyway.
        case 'ChunkNotLoaded':
        case 'OutOfWorld': {
          break
        }
      }
    }

    return disturbed
  })
