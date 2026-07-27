/**
 * The prebuilt mining sites.
 *
 * A dev application, not shipped API.
 *
 * Each one exists to make ONE claim checkable by eye. A scenario that does not
 * have an answer to "what would I see if this were broken" is decoration, so
 * every entry below carries `notes` saying what to watch and `--list` prints
 * them.
 *
 * The worlds are built as data (`[x, y, blockId]`) rather than drawn from a
 * string picture: a picture is read top-down and this world's `y` grows upward,
 * so an ASCII map would put the sky at `y = 0` and the first person to edit it
 * would build the world upside down.
 */
import type { BlockId } from '../../domain/chunk-store-port'
import { AIR, CHUNK_SIDE, GRAVEL, LAVA, SAND, STONE, WATER, type WorldSpec } from './world'

export type Scenario = {
  readonly name: string
  readonly title: string
  readonly notes: ReadonlyArray<string>
  readonly build: () => WorldSpec
  /** Where the cursor starts, and what `--auto-break` breaks. */
  readonly target: { readonly x: number; readonly y: number }
  readonly minWidth: number
  readonly minHeight: number
}

const Z = 0

/** A flat floor of stone from x0 to x1 inclusive, at height y. */
const floor = (x0: number, x1: number, y: number, block: BlockId = STONE) => {
  const cells: Array<readonly [number, number, BlockId]> = []
  for (let x = x0; x <= x1; x += 1) {
    cells.push([x, y, block])
  }
  return cells
}

/** A vertical run of `block` at column x, from y0 to y1 inclusive. */
const column = (x: number, y0: number, y1: number, block: BlockId) => {
  const cells: Array<readonly [number, number, BlockId]> = []
  for (let y = y0; y <= y1; y += 1) {
    cells.push([x, y, block])
  }
  return cells
}

const slab = (x0: number, x1: number, y0: number, y1: number, block: BlockId) => {
  const cells: Array<readonly [number, number, BlockId]> = []
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      cells.push([x, y, block])
    }
  }
  return cells
}

const RESIDENT_TWO_CHUNKS = ['0,0', '1,0']

export const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    name: 'sand-column',
    title: 'break the support under a sand column and watch it sink one cell per frame',
    notes: [
      'the queue view: one break enqueues ONE position, and every move enqueues two more',
      'the timeline: `moved` never exceeds 1 here, and `pending` returns to 0 by itself',
      'a column does not fall as a unit — a gap opens under the top block and travels up',
    ],
    build: (): WorldSpec => ({
      z: Z,
      loadedChunks: RESIDENT_TWO_CHUNKS,
      cells: [
        ...floor(0, 25, 0),
        ...floor(0, 25, 1),
        [6, 2, STONE],
        ...column(6, 3, 8, SAND),
        ...column(12, 2, 5, GRAVEL),
        [12, 1, STONE],
      ],
    }),
    target: { x: 6, y: 2 },
    minWidth: 26,
    minHeight: 12,
  },
  {
    name: 'wide-seam',
    title: 'a seam of stone under a slab: many disturbances at once, and the per-tick budget',
    notes: [
      'hold `b` across the seam, then `s` — this is the "TNT under a desert" burst',
      '`domain/falling-block.ts:53-60` bounds MOVES per tick at 32; watch `examined` vs `moved`',
      'the pending queue GROWS before it drains, because every move enqueues two positions',
    ],
    build: (): WorldSpec => ({
      z: Z,
      loadedChunks: RESIDENT_TWO_CHUNKS,
      cells: [
        ...floor(0, 25, 0),
        ...floor(0, 25, 1),
        ...floor(0, 25, 2),
        ...slab(0, 25, 3, 6, SAND),
      ],
    }),
    target: { x: 0, y: 2 },
    minWidth: 26,
    minHeight: 12,
  },
  {
    name: 'chunk-edge',
    title: 'the resident area stops at x=16: ChunkNotLoaded is NOT air (DN-GP-11)',
    notes: [
      'chunk 1,0 is not resident — the shaded columns are UNKNOWN, not empty',
      'sand at the edge is told nothing about the cell below it, so it does not fall out of the world',
      'a break aimed into the unloaded chunk yields no item and dirties nothing',
    ],
    build: (): WorldSpec => ({
      z: Z,
      loadedChunks: ['0,0'],
      cells: [
        ...floor(0, 25, 0),
        ...floor(0, 15, 1),
        [10, 2, STONE],
        ...column(10, 3, 6, SAND),
        ...column(15, 1, 5, SAND),
        ...column(17, 1, 5, SAND),
      ],
    }),
    target: { x: 10, y: 2 },
    minWidth: 26,
    minHeight: 12,
  },
  {
    name: 'lava-pit',
    title: 'sand into water and lava — both are `replaceable`, and lava once was not',
    notes: [
      'the mirror in `domain/block-vocabulary.ts` records lava MISSING from `REPLACEABLE_IDS`',
      'the symptom was exactly this: sand stopped on top of lava instead of sinking into it',
      'break the two supports and compare the water column with the lava column',
    ],
    build: (): WorldSpec => ({
      z: Z,
      loadedChunks: RESIDENT_TWO_CHUNKS,
      cells: [
        ...floor(0, 25, 0),
        ...slab(4, 8, 1, 3, WATER),
        ...slab(14, 18, 1, 3, LAVA),
        [6, 4, STONE],
        ...column(6, 5, 7, SAND),
        [16, 4, STONE],
        ...column(16, 5, 7, SAND),
      ],
    }),
    target: { x: 6, y: 4 },
    minWidth: 26,
    minHeight: 12,
  },
  {
    name: 'long-drop',
    title: 'one block, twelve cells of air: the cascade continues with no external event',
    notes: [
      'nothing re-dirties this column after the first frame — `settled` is what keeps it going',
      'exactly one move per frame all the way down; watch `->pend` stay at 2 and then hit 0',
      'this is the property a chunk-granular dirty channel cannot express (DN-GP-1)',
      'the two blocks at x=8 are hanging in the fixture and NOBODY disturbs them: an',
      'event-driven cascade never notices a world that was already inconsistent',
    ],
    build: (): WorldSpec => ({
      z: Z,
      loadedChunks: RESIDENT_TWO_CHUNKS,
      cells: [
        ...floor(0, 25, 0),
        [4, 13, STONE],
        [4, 14, SAND],
        [12, 13, STONE],
        [12, 14, GRAVEL],
        // Deliberately unsupported from the start, and deliberately not the
        // target: an already-inconsistent world stays inconsistent until
        // something disturbs it. That is the design, not a defect, and a
        // scenario that hid it would be hiding the whole point of `disturb`.
        [8, 9, SAND],
        [8, 10, SAND],
      ],
    }),
    target: { x: 4, y: 13 },
    minWidth: 26,
    minHeight: 16,
  },
]

export const DEFAULT_SCENARIO = 'sand-column'

export const SCENARIO_NAMES: ReadonlyArray<string> = SCENARIOS.map((scenario) => scenario.name)

export const scenarioByName = (name: string): Scenario | undefined =>
  SCENARIOS.find((scenario) => scenario.name === name)

/** Where the unloaded region starts in the `chunk-edge` scenario, for the HUD. */
export const CHUNK_BOUNDARY = CHUNK_SIDE

/** Every block id a scenario can contain, for the census oracle. */
export const SCENARIO_BLOCK_IDS: ReadonlyArray<BlockId> = [AIR, STONE, SAND, GRAVEL, WATER, LAVA]
