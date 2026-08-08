/**
 * ITEM USE — the third verb of plan.md §3.11's responsibility 1, which
 * `docs/testing.md` §3-1 recorded as 「アイテム使用が無い」.
 *
 * `domain/interactions/ignite-portal.ts`, `./ignite-fire.ts` and the dispatch
 * between them, plus the ignition half of responsibility 6.
 *
 * ---------------------------------------------------------------------------
 * What these tests are FOR, beyond "it works"
 * ---------------------------------------------------------------------------
 *
 * The portal rule takes a shortcut — it reads chunk buffers instead of cells —
 * and a shortcut is exactly the kind of thing that passes a happy-path test and
 * fabricates a portal in unloaded space. So the assertions come in pairs
 * throughout: a frame that lights AND the same frame at a chunk edge that
 * reports `ChunkNotLoaded` rather than `NoFrame`; a fall-through to fire AND the
 * two answers that must NOT fall through.
 *
 * `test/portal-frame-mirror.test.ts` owns the detector's own behaviour. Nothing
 * here re-tests it.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { blockIdOf } from '../src/domain/block-vocabulary'
import { AIR_BLOCK_ID, type BlockId, type BlockPosition } from '../src/domain/chunk-store-port'
import { igniteFire } from '../src/domain/interactions/ignite-fire'
import { PORTAL_WINDOW_RADIUS, ignitePortal } from '../src/domain/interactions/ignite-portal'
import { TNT_BLOCK_ID, igniteTnt } from '../src/domain/interactions/ignite-tnt'
import {
  IGNITION_ITEM_TYPES,
  isIgnitionItem,
  useFlintAndSteel,
} from '../src/domain/interactions/use-flint-and-steel'
import { MAX_PORTAL_WIDTH, generatePortalLayout } from '../src/domain/portal-frame-port'
import { chunkCoordsAround } from '../src/domain/chunk-window'
import { ITEM_TYPES } from '../src/domain/item-vocabulary'
import { makeChunkStoreDouble, world, STONE } from './support/chunk-store-double'
import type { BlockWriteOutcome, ChunkStoreApi } from '../src/domain/chunk-store-port'

/**
 * A store that answers the read honestly and then changes its mind.
 *
 * `test/place-block.test.ts` introduced this for the same window and states the
 * argument: both ignition rules read, decide, and write, and between those two
 * calls the world belongs to somebody else. The double cannot produce it — its
 * `getBlock` and `setBlock` consult one map, so they always agree, and agreeing
 * is precisely what a race does not do.
 *
 * It is spelled again here rather than shared, for the reason
 * `test/support/chunk-store-double.ts`'s header gives about the preview: a
 * helper two test files depend on becomes a third implementation nobody audits.
 */
const storeThatChangesItsMind = (honest: ChunkStoreApi, onWrite: BlockWriteOutcome): ChunkStoreApi => ({
  ...honest,
  setBlock: () => Effect.succeed(onWrite),
})

const OBSIDIAN = blockIdOf('obsidian') ?? 40
const NETHER_PORTAL = blockIdOf('nether_portal') ?? 118
const FIRE = blockIdOf('fire') ?? 119
const TNT = TNT_BLOCK_ID ?? 46

/** Bottom-left interior cell of the test portal. Chunk (0, 1) of the double. */
const ORIGIN: BlockPosition = { x: 4, y: 64, z: 20 }

/** Every chunk the window will peek, so that nothing is unreadable by accident. */
const residentAround = (centre: BlockPosition): ReadonlyArray<string> =>
  chunkCoordsAround(centre, PORTAL_WINDOW_RADIUS).map(
    (coord) => `${String(coord.cx)},${String(coord.cz)}`,
  )

const portalEntries = (
  origin: BlockPosition,
  width: number,
  height: number,
): ReadonlyArray<readonly [BlockPosition, BlockId]> => {
  const layout = generatePortalLayout(origin, 'x', width, height)
  return layout.frame.map((cell) => [cell, OBSIDIAN] as const)
}

describe('ignitePortal', () => {
  it.effect('lights every interior cell of a valid frame, and reports them', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(
        world(portalEntries(ORIGIN, 2, 3)),
        residentAround(ORIGIN),
      )

      const outcome = yield* ignitePortal(store.api, ORIGIN)

      expect(outcome._tag).toBe('Lit')
      if (outcome._tag !== 'Lit') return
      expect(outcome.frame.width).toBe(2)
      expect(outcome.frame.height).toBe(3)
      expect(outcome.cells).toHaveLength(6)

      // The world actually changed, and it changed to kernel's block rather
      // than to a byte this test picked.
      for (const cell of outcome.cells) {
        expect(yield* store.blockAt(cell)).toBe(NETHER_PORTAL)
      }
      expect(blockIdOf('nether_portal')).toBe(NETHER_PORTAL)
    }),
  )

  it.effect('costs peeks and writes, and NOT a `getBlock` per probed cell', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(
        world(portalEntries(ORIGIN, 2, 3)),
        residentAround(ORIGIN),
      )

      yield* ignitePortal(store.api, ORIGIN)

      // THE COST ARGUMENT, ASSERTED. `domain/chunk-window.ts`'s header rejects
      // the per-cell version at 3,872 store reads per right-click; this is the
      // measurement that keeps the rejection true. Six writes, one per interior
      // cell; zero cell reads.
      const calls = yield* store.calls
      expect(calls.reads).toBe(0)
      expect(calls.writes).toBe(6)
      expect(calls.peeks).toBe(chunkCoordsAround(ORIGIN, PORTAL_WINDOW_RADIUS).length)
    }),
  )

  it.effect('lights the largest legal portal', () =>
    Effect.gen(function* () {
      const origin: BlockPosition = { x: 4, y: 64, z: 20 }
      const store = yield* makeChunkStoreDouble(
        world(portalEntries(origin, MAX_PORTAL_WIDTH, 3)),
        residentAround(origin),
      )

      const outcome = yield* ignitePortal(store.api, origin)

      expect(outcome._tag).toBe('Lit')
      if (outcome._tag !== 'Lit') return
      expect(outcome.cells).toHaveLength(MAX_PORTAL_WIDTH * 3)
    }),
  )

  it.effect('lights the largest legal portal from its FAR END, which is what the window radius is for', () =>
    Effect.gen(function* () {
      // THE TEST ABOVE DOES NOT BRACKET THE RADIUS, and a mutation run proved
      // it: shrinking `PORTAL_WINDOW_RADIUS` by one left it green. Detection
      // walks LEFT from the ignition cell, and a portal ignited at its
      // bottom-left corner never walks anywhere — the ring is one cell away.
      //
      // Igniting the RIGHT-most interior cell of a maximum-width portal is what
      // makes the walk go the full distance: twenty cells to the left edge, one
      // more to the ring. A window narrower than that silently refuses a portal
      // a player legitimately built, and refuses it only when they light the
      // wrong end of it — which is the shape of bug that gets reported as
      // "portals sometimes do not work".
      //
      // The origin is chosen so the far reach crosses a chunk boundary; inside
      // one chunk the whole radius question is invisible because `peek` returns
      // everything.
      const origin: BlockPosition = { x: 16, y: 64, z: 20 }
      const ignition: BlockPosition = { x: origin.x + MAX_PORTAL_WIDTH - 1, y: origin.y, z: origin.z }
      const store = yield* makeChunkStoreDouble(
        world(portalEntries(origin, MAX_PORTAL_WIDTH, 3)),
        residentAround(ignition),
      )

      const outcome = yield* ignitePortal(store.api, ignition)

      expect(outcome._tag).toBe('Lit')
      if (outcome._tag !== 'Lit') return
      expect(outcome.frame.width).toBe(MAX_PORTAL_WIDTH)
      expect(outcome.cells).toHaveLength(MAX_PORTAL_WIDTH * 3)
    }),
  )

  it.effect('answers NoFrame where there is no ring, without writing anything', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), residentAround(ORIGIN))

      const outcome = yield* ignitePortal(store.api, ORIGIN)

      expect(outcome).toStrictEqual({ _tag: 'NoFrame' })
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  it.effect('answers NoFrame for a portal that is ALREADY lit', () =>
    Effect.gen(function* () {
      const layout = generatePortalLayout(ORIGIN, 'x', 2, 3)
      const store = yield* makeChunkStoreDouble(
        world([
          ...portalEntries(ORIGIN, 2, 3),
          ...layout.interior.map((cell) => [cell, NETHER_PORTAL] as const),
        ]),
        residentAround(ORIGIN),
      )

      // Detection returns `None` when the ignition cell is not AIR, which is
      // why the rule never has to name the portal block in order to notice one.
      // Without this, holding the button re-writes six cells every frame.
      expect(yield* ignitePortal(store.api, ORIGIN)).toStrictEqual({ _tag: 'NoFrame' })
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  it.effect('answers NoFrame when the cell clicked is the RING and not the hole', () =>
    Effect.gen(function* () {
      // THE GUARD THIS IS ABOUT IS ONE LINE — `blockAt(ignition) !== AIR` — and
      // a mutation run is what found that nothing covered it. Deleting it leaves
      // the already-lit case answering `NoFrame` anyway (a portal-block anchor
      // measures a zero-width interior), so the obvious test is equivalent.
      //
      // THIS input is not. Anchored on the middle of the bottom edge, the walk
      // upward lands exactly on the interior's bottom row, measures 2 x 3, and
      // detection ACCEPTS — so without the guard, clicking the obsidian ring
      // lights the portal, and clicking a wall lights whatever hole is above it.
      const store = yield* makeChunkStoreDouble(
        world(portalEntries(ORIGIN, 2, 3)),
        residentAround(ORIGIN),
      )
      const ringCell: BlockPosition = { x: ORIGIN.x, y: ORIGIN.y - 1, z: ORIGIN.z }

      expect(yield* ignitePortal(store.api, ringCell)).toStrictEqual({ _tag: 'NoFrame' })
      expect((yield* store.calls).writes).toBe(0)

      // ...and through the dispatch, the fall-through arm refuses it too,
      // because the cell holds obsidian. One click on the frame changes nothing.
      const outcome = yield* useFlintAndSteel(store.api, ringCell, 'flint_and_steel')
      expect(outcome).toStrictEqual({
        _tag: 'Fire',
        outcome: { _tag: 'Occupied', existing: OBSIDIAN },
      })
    }),
  )

  it.effect('answers ChunkNotLoaded, NOT NoFrame, when the frame reaches into an absent chunk', () =>
    Effect.gen(function* () {
      // A portal straddling the chunk boundary at x = 16, with only the western
      // chunk resident. "I could not see" and "there is nothing here" are
      // different things to tell the player, and only the first is worth
      // retrying — `domain/interactions/ignite-portal.ts` checks the counter
      // FIRST for exactly this case.
      const origin: BlockPosition = { x: 14, y: 64, z: 20 }
      const store = yield* makeChunkStoreDouble(world(portalEntries(origin, 4, 3)), ['0,1'])

      expect(yield* ignitePortal(store.api, origin)).toStrictEqual({ _tag: 'ChunkNotLoaded' })
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  it.effect('an unreadable chunk can only REFUSE a frame, never manufacture one', () =>
    Effect.gen(function* () {
      // The dangerous direction, asserted directly. `UNREADABLE_BLOCK` is
      // neither air nor obsidian, so unloaded space cannot become the interior
      // of a portal and cannot become its ring.
      const store = yield* makeChunkStoreDouble(world([]), [])

      const outcome = yield* ignitePortal(store.api, ORIGIN)

      expect(outcome).toStrictEqual({ _tag: 'ChunkNotLoaded' })
      expect((yield* store.calls).writes).toBe(0)
    }),
  )
})

describe('igniteFire', () => {
  const target: BlockPosition = { x: 2, y: 64, z: 3 }

  it.effect('puts kernel’s fire block into an air cell', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])

      expect(yield* igniteFire(store.api, target)).toStrictEqual({ _tag: 'Lit', position: target })
      expect(yield* store.blockAt(target)).toBe(FIRE)
      expect(blockIdOf('fire')).toBe(FIRE)
    }),
  )

  it.effect('refuses a cell that is not air, and writes nothing', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([[target, STONE]]), ['0,0'])

      expect(yield* igniteFire(store.api, target)).toStrictEqual({ _tag: 'Occupied', existing: STONE })
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  it.effect('refuses WATER and LAVA although `isReplaceable` admits both', () =>
    Effect.gen(function* () {
      // The one place this rule deliberately disagrees with `placeBlock`. Fire
      // in water goes out on a tick nothing has written yet; fire in lava is a
      // keystroke that deletes a source block. `domain/interactions/ignite-fire.ts`
      // asks for AIR and nothing else, which is the reference's own test.
      for (const fluid of ['water', 'lava'] as const) {
        const id = blockIdOf(fluid)
        expect(id).toBeDefined()
        const store = yield* makeChunkStoreDouble(world([[target, id ?? 0]]), ['0,0'])

        expect(yield* igniteFire(store.api, target)).toStrictEqual({
          _tag: 'Occupied',
          existing: id,
        })
      }
    }),
  )

  it.effect('reports ChunkNotLoaded and OutOfWorld apart from each other', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])

      expect(yield* igniteFire(store.api, { x: 200, y: 64, z: 3 })).toStrictEqual({
        _tag: 'ChunkNotLoaded',
      })
      expect(yield* igniteFire(store.api, { x: 2, y: -1, z: 3 })).toStrictEqual({
        _tag: 'OutOfWorld',
      })
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  describe('the window between the read and the write', () => {
    it.effect('a write that comes back `Unchanged` is Occupied — the read’s answer, one instruction late', () =>
      Effect.gen(function* () {
        const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
        const raced = storeThatChangesItsMind(store.api, { _tag: 'Unchanged', previous: FIRE })

        // `existing` comes from the STORE's `previous` rather than from the
        // rule's own idea of what is there, which is what makes the answer a
        // report instead of a restatement of an expired reading.
        expect(yield* igniteFire(raced, target)).toStrictEqual({ _tag: 'Occupied', existing: FIRE })
      }),
    )

    it.effect('a write that comes back ChunkNotLoaded or OutOfWorld keeps the two apart', () =>
      Effect.gen(function* () {
        // Two tags rather than one shared "it did not happen":
        // `ChunkNotLoaded` is temporary and a caller may retry it, `OutOfWorld`
        // never becomes true and a caller that retried would spin.
        const store = yield* makeChunkStoreDouble(world([]), ['0,0'])

        expect(
          yield* igniteFire(storeThatChangesItsMind(store.api, { _tag: 'ChunkNotLoaded' }), target),
        ).toStrictEqual({ _tag: 'ChunkNotLoaded' })
        expect(
          yield* igniteFire(storeThatChangesItsMind(store.api, { _tag: 'OutOfWorld' }), target),
        ).toStrictEqual({ _tag: 'OutOfWorld' })
      }),
    )
  })
})

describe('igniteTnt', () => {
  const target: BlockPosition = { x: 2, y: 64, z: 3 }

  it.effect('lights a TNT block and removes it', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([[target, TNT]]), ['0,0'])

      expect(yield* igniteTnt(store.api, target)).toStrictEqual({ _tag: 'Lit' })
      expect(yield* store.blockAt(target)).toBe(AIR_BLOCK_ID)
    }),
  )

  it.effect('refuses a block that is not TNT, and writes nothing', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([[target, STONE]]), ['0,0'])

      expect(yield* igniteTnt(store.api, target)).toStrictEqual({ _tag: 'NotTnt' })
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  it.effect('reports ChunkNotLoaded and OutOfWorld from the read, apart from each other', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])

      expect(yield* igniteTnt(store.api, { x: 200, y: 64, z: 3 })).toStrictEqual({
        _tag: 'ChunkNotLoaded',
      })
      expect(yield* igniteTnt(store.api, { x: 2, y: -1, z: 3 })).toStrictEqual({
        _tag: 'OutOfWorld',
      })
      expect((yield* store.calls).writes).toBe(0)
    }),
  )

  describe('the window between the read and the write', () => {
    it.effect('a write that comes back ChunkNotLoaded or OutOfWorld is reported as-is, not as ChangedBeforeWrite', () =>
      Effect.gen(function* () {
        const store = yield* makeChunkStoreDouble(world([[target, TNT]]), ['0,0'])

        expect(
          yield* igniteTnt(storeThatChangesItsMind(store.api, { _tag: 'ChunkNotLoaded' }), target),
        ).toStrictEqual({ _tag: 'ChunkNotLoaded' })
        expect(
          yield* igniteTnt(storeThatChangesItsMind(store.api, { _tag: 'OutOfWorld' }), target),
        ).toStrictEqual({ _tag: 'OutOfWorld' })
      }),
    )

    it.effect('a write that comes back Unchanged is ChangedBeforeWrite — something else already removed the TNT', () =>
      Effect.gen(function* () {
        const store = yield* makeChunkStoreDouble(world([[target, TNT]]), ['0,0'])
        const raced = storeThatChangesItsMind(store.api, { _tag: 'Unchanged', previous: TNT })

        expect(yield* igniteTnt(raced, target)).toStrictEqual({ _tag: 'ChangedBeforeWrite' })
      }),
    )

    it.effect('a Written outcome whose `previous` disagrees with TNT is ChangedBeforeWrite too', () =>
      Effect.gen(function* () {
        // The read saw TNT, but by the time the write landed the cell held
        // something else — a second player broke it in the same window. The
        // write still happened (`Written`), so this is NOT the `Unchanged`
        // case above; it is caught by the `previous !== TNT_BLOCK_ID` half of
        // the same guard.
        const store = yield* makeChunkStoreDouble(world([[target, TNT]]), ['0,0'])
        const raced = storeThatChangesItsMind(store.api, {
          _tag: 'Written',
          previous: STONE,
          chunk: { cx: 0, cz: 0 },
        })

        expect(yield* igniteTnt(raced, target)).toStrictEqual({ _tag: 'ChangedBeforeWrite' })
      }),
    )
  })
})

describe('ignitePortal, when the store changes its mind mid-fill', () => {
  it.effect('reports only the cells whose write actually landed', () =>
    Effect.gen(function* () {
      // Detection proved all six cells were air, so none of the three
      // non-`Written` arms is reachable from a green tree — they are DECIDED
      // rather than asserted away because the window is real, and this is the
      // evidence that the decision is the one written down. A `Lit` with six
      // cells here would mean the rule reports what it INTENDED rather than
      // what it did.
      const store = yield* makeChunkStoreDouble(
        world(portalEntries(ORIGIN, 2, 3)),
        residentAround(ORIGIN),
      )
      const raced = storeThatChangesItsMind(store.api, { _tag: 'ChunkNotLoaded' })

      const outcome = yield* ignitePortal(raced, ORIGIN)

      expect(outcome._tag).toBe('Lit')
      if (outcome._tag !== 'Lit') return
      expect(outcome.frame.interior).toHaveLength(6)
      expect(outcome.cells).toStrictEqual([])
    }),
  )
})

describe('useFlintAndSteel — the order of the two arms', () => {
  it.effect('removes TNT before trying portal or fire', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(
        world([[ORIGIN, TNT]]),
        residentAround(ORIGIN),
      )

      const outcome = yield* useFlintAndSteel(store.api, ORIGIN, 'flint_and_steel')

      expect(outcome).toStrictEqual({ _tag: 'Tnt', outcome: { _tag: 'Lit' } })
      expect(yield* store.blockAt(ORIGIN)).toBe(AIR_BLOCK_ID)
    }),
  )

  it.effect('names two items, both of which are on kernel’s roster', () =>
    Effect.sync(() => {
      // The line `domain/interactions/use-flint-and-steel.ts` draws: the NAMES
      // are kernel's and the RULE is this repository's. A literal that is not on
      // kernel's roster would be this repository inventing vocabulary, which is
      // why the eight other item uses in the reference are not here.
      for (const item of IGNITION_ITEM_TYPES) {
        expect(ITEM_TYPES).toContain(item)
        expect(isIgnitionItem(item)).toBe(true)
      }
      expect(isIgnitionItem('stick')).toBe(false)
      expect(isIgnitionItem('stone')).toBe(false)
    }),
  )

  it.effect('tries the portal first: a finished frame lights instead of catching fire', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(
        world(portalEntries(ORIGIN, 2, 3)),
        residentAround(ORIGIN),
      )

      const outcome = yield* useFlintAndSteel(store.api, ORIGIN, 'flint_and_steel')

      expect(outcome._tag).toBe('Portal')
      // The failure this ordering prevents, asserted on the world rather than
      // on the tag: fire-first puts a flame in the middle of a finished portal
      // and the player never gets one.
      expect(yield* store.blockAt(ORIGIN)).toBe(NETHER_PORTAL)
    }),
  )

  it.effect('falls through to fire when there is no frame', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), residentAround(ORIGIN))

      const outcome = yield* useFlintAndSteel(store.api, ORIGIN, 'fire_charge')

      expect(outcome).toStrictEqual({ _tag: 'Fire', outcome: { _tag: 'Lit', position: ORIGIN } })
      expect(yield* store.blockAt(ORIGIN)).toBe(FIRE)
    }),
  )

  it.effect('does NOT fall through on ChunkNotLoaded — the second arm cannot see either', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(world([]), [])

      const outcome = yield* useFlintAndSteel(store.api, ORIGIN, 'flint_and_steel')

      expect(outcome).toStrictEqual({ _tag: 'Portal', outcome: { _tag: 'ChunkNotLoaded' } })
      // TNT-first costs one cell read. Portal then refuses from its chunk
      // window, and the fire arm is never asked for a second cell read.
      expect((yield* store.calls).reads).toBe(1)
    }),
  )

  it.effect('both arms spell success `Lit`, which is what lets the stage test one tag', () =>
    Effect.gen(function* () {
      const portalStore = yield* makeChunkStoreDouble(
        world(portalEntries(ORIGIN, 2, 3)),
        residentAround(ORIGIN),
      )
      const fireStore = yield* makeChunkStoreDouble(world([]), residentAround(ORIGIN))

      const lit = yield* useFlintAndSteel(portalStore.api, ORIGIN, 'flint_and_steel')
      const burned = yield* useFlintAndSteel(fireStore.api, ORIGIN, 'flint_and_steel')

      expect(lit.outcome._tag).toBe('Lit')
      expect(burned.outcome._tag).toBe('Lit')
    }),
  )

  it.effect('an air cell in an unlit frame is still just air until it is lit', () =>
    Effect.gen(function* () {
      // Guards the claim in `ignitePortal`'s header that the interior is AIR
      // before ignition — if the fixture built portal blocks, every test above
      // would be asserting on a world that could not exist.
      const store = yield* makeChunkStoreDouble(
        world(portalEntries(ORIGIN, 2, 3)),
        residentAround(ORIGIN),
      )
      const reading = yield* store.api.getBlock(ORIGIN)

      expect(reading).toStrictEqual({ _tag: 'Block', block: AIR_BLOCK_ID })
    }),
  )
})
