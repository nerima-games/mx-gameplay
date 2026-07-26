/**
 * The mining site: this repository's real stages, run against a real store.
 *
 * A dev application, not shipped API.
 *
 * ---------------------------------------------------------------------------
 * Nothing here reimplements a rule
 * ---------------------------------------------------------------------------
 *
 * That is the whole design constraint. `mx-redstone`'s circuit-board preview had
 * to carry an `applyPistons` of its own, because `redstone:effects` is still
 * `Effect.void`, and its README says plainly that this means the preview running
 * is not evidence that the stage works. This preview is under no such handicap
 * for the part it claims: `stepFrame` below calls `gameplayStages(...)` — the
 * exported registrations — through a topological sort of their own `after`
 * edges, and every block that moves on screen moved because
 * `domain/entities/falling-block-move.ts` moved it through
 * `domain/chunk-store-port.ts`.
 *
 * The consequences are worth stating in both directions:
 *
 *   - What you see IS evidence about `gameplay:interactions` and
 *     `gameplay:entities`. Breaking a block on screen goes through
 *     `breakBlock`, the item in the HUD came out of the write's `previous`, the
 *     queue in the `queue` view is the actual `FallingBlockQueue`, and the read
 *     and write counters are the actual store calls.
 *   - It is NOT evidence about anything unimplemented. `gameplay:time-weather`
 *     is `Effect.void` (`stages/registration.ts:293`); the `time` screen drives
 *     `domain/day-night.ts` directly and says so. `gameplay:fluids` cycles a
 *     frontier and propagates nothing; there is no placement rule, no drop
 *     table and no mob. See README.md, "What is not here".
 *
 * ---------------------------------------------------------------------------
 * The scheduler
 * ---------------------------------------------------------------------------
 *
 * The array `gameplayStages` returns is not a schedule (plan.md §2.3-3). A
 * preview that ran it in array order would be showing an order no consumer is
 * obliged to use, and would keep working if the `after` edges were deleted —
 * which is exactly the thing that must not be deletable, because "a block broken
 * in `interactions` falls in `entities` in the SAME frame" is only true if the
 * ordering constraint holds. So `schedule` below resolves the constraints, the
 * way mc-compose will. It is a third copy of the same twelve lines that
 * `test/support/frame-runner.ts` holds; that is deliberate rather than lazy,
 * because a `sortStages` exported from this repository would be it claiming a
 * decision it cannot make correctly (`test/public-api.test.ts` asserts no such
 * export exists).
 */
import { Effect, Ref } from 'effect'
import { positionKeyOf } from '../../domain/block-position-key'
import { fallsWhenUnsupported, type BlockId, type BlockPosition } from '../../domain/chunk-store-port'
import { FALLING_BLOCK_MOVES_PER_TICK } from '../../domain/falling-block'
import { DeltaTimeSecs, type StageRegistration } from '../../domain/frame-contract'
import type { PositionKey } from '../../domain/position-key'
import {
  gameplayStages,
  makeGameplayFrameState,
  type GameplayFrameState,
} from '../../stages/registration'
import { GAMEPLAY_STAGE_IDS } from '../../stages/stage-ids'
import { emptyPreviewRoster } from './roster'
import { AIR, floatingBlocks, makePreviewWorld, type PreviewWorld, type WorldSpec } from './world'

/**
 * One frame's worth of simulated time, as a 60 Hz loop would produce it.
 *
 * A CONSTANT, and that is the point: `run(dt)` takes the delta as an argument
 * (docs/testing.md §5), so the preview never has to read a clock to advance the
 * world. `dt` is not used by any stage this repository has written yet, which is
 * itself worth knowing and is reported by `--stats`.
 */
export const FRAME_DELTA = DeltaTimeSecs(1 / 60)

export const schedule = (
  stages: ReadonlyArray<StageRegistration>,
): ReadonlyArray<StageRegistration> => {
  const registered = new Set(stages.map((stage) => stage.id))
  const emitted = new Set<string>()
  const ordered: Array<StageRegistration> = []

  while (ordered.length < stages.length) {
    const next = stages.find(
      (stage) =>
        !emitted.has(stage.id) &&
        (stage.after ?? []).every((edge) => !registered.has(edge) || emitted.has(edge)),
    )

    if (next === undefined) {
      throw new Error('preview-mining-site: the declared `after` edges contain a cycle')
    }

    emitted.add(next.id)
    ordered.push(next)
  }

  return ordered
}

/**
 * What one frame did.
 *
 * `examined` and `moved` are recorded separately on purpose. `takeBatch`'s
 * budget bounds POSITIONS EXAMINED; `FALLING_BLOCK_MOVES_PER_TICK` is named for
 * MOVES APPLIED. Whether those two numbers are the same is a question about the
 * cascade's shape that no unit test asks, and the `timeline` view puts them next
 * to each other so a reader can see the answer rather than assume it.
 */
export type FrameRow = {
  readonly frame: number
  /** Break requests submitted into the inbox before this frame ran. */
  readonly requested: number
  readonly pendingBefore: number
  readonly examined: number
  readonly moved: number
  readonly pendingAfter: number
  readonly reads: number
  readonly writes: number
  readonly mined: ReadonlyArray<BlockId>
  /** Falling blocks currently hanging with a replaceable cell below them. */
  readonly floating: number
}

export type Site = {
  readonly world: PreviewWorld
  readonly state: GameplayFrameState
  readonly stages: ReadonlyArray<StageRegistration>
  readonly spec: WorldSpec
  readonly bounds: { readonly width: number; readonly height: number }
  frame: number
  /** Items the host has drained out of `minedItems`. */
  inventory: ReadonlyArray<BlockId>
  trace: ReadonlyArray<FrameRow>
  note: string
  scenario: string
  /** Break requests submitted but not yet consumed by a frame. */
  submitted: number
}

export const positionAt = (site: Site, x: number, y: number): BlockPosition => ({
  x,
  y,
  z: site.spec.z,
})

const allCells = (site: Site): ReadonlyArray<BlockPosition> => {
  const cells: Array<BlockPosition> = []
  for (let x = 0; x < site.bounds.width; x += 1) {
    for (let y = 0; y < site.bounds.height; y += 1) {
      cells.push(positionAt(site, x, y))
    }
  }
  return cells
}

export const makeSite = (
  spec: WorldSpec,
  bounds: { readonly width: number; readonly height: number },
  scenario: string,
): Effect.Effect<Site> =>
  Effect.gen(function* () {
    const world = yield* makePreviewWorld(spec)
    const state = yield* makeGameplayFrameState
    // The stages, from the shipped factory. `makeGameplayStages` would acquire
    // the tags from Layers; `gameplayStages` takes the state and the APIs
    // directly, which is what lets this app hold the inboxes and the outboxes —
    // the Refs that stand in for services nobody has published yet. The preview
    // is the host that drains them, exactly as the comment there describes.
    //
    // The roster is EMPTY AND REFUSES TO GROW; see `./roster.ts` for why a
    // working one here would be mx-gameplay implementing mc-sim's service. The
    // mining site has no mobs, so the mob half of `gameplay:entities` sweeps
    // nothing every frame and costs nothing — which is the same claim the idle
    // frame makes about blocks.
    const stages = schedule(gameplayStages(state, world.api, emptyPreviewRoster))

    return {
      world,
      state,
      stages,
      spec,
      bounds,
      frame: 0,
      inventory: [],
      trace: [],
      note: '',
      scenario,
      submitted: 0,
    }
  })

/** Queue a break at this position. The ONLY way a rule is asked to do anything. */
export const requestBreak = (site: Site, position: BlockPosition): Effect.Effect<void> =>
  Effect.map(
    Ref.update(site.state.pendingBreaks, (queue) => [...queue, positionKeyOf(position)]),
    () => {
      site.submitted += 1
      site.note = `queued break at ${positionKeyOf(position)}`
    },
  )

/**
 * Write a cell directly, WITHOUT a rule.
 *
 * There is no place-block rule in this repository — plan.md §3.11 lists ~40
 * interaction handlers and `domain/interactions/` holds exactly one — so the
 * `p` key cannot be "place, through the rules". Rather than draw a plausible
 * placement that simulates nothing, this pokes the store and SAYS SO in the
 * HUD, and it deliberately does NOT call `disturb`.
 *
 * That omission is the interesting part and it is why this function exists at
 * all. `domain/falling-block.ts:73-77` names placement among the callers that
 * must disturb; today nothing does, so a block placed under a sand column does
 * not make the column notice. Poking the store shows exactly what the missing
 * rule would have to remember to do, which is more useful than a placement that
 * pretended to work.
 */
export const pokeBlock = (site: Site, position: BlockPosition, block: BlockId): void => {
  site.world.poke(position, block)
  site.note =
    block === AIR
      ? `erased ${positionKeyOf(position)} directly in the store — no rule ran, nothing was disturbed`
      : `poked ${positionKeyOf(position)} directly in the store — there is no place-block rule; nothing was disturbed`
}

const pendingSize = (site: Site): Effect.Effect<number> =>
  Effect.map(Ref.get(site.state.fallingBlocks), (queue) => queue.pending.size)

/** Run one frame: every stage, in the order its `after` edges imply. */
export const stepFrame = (site: Site): Effect.Effect<FrameRow> =>
  Effect.gen(function* () {
    const requested = site.submitted
    site.submitted = 0
    const pendingBefore = yield* pendingSize(site)
    site.world.resetCalls()
    site.world.takeWriteLog()

    yield* Effect.forEach(site.stages, (stage) => stage.run(FRAME_DELTA), { discard: true })

    // Drain the outbox. `minedItems` is explicitly a list the HOST drains
    // (`stages/registration.ts:113-121`) and holds items for the width of one
    // frame; leaving it to grow would make this preview the second owner of an
    // inventory, which is the mistake that paragraph exists to prevent.
    const mined = yield* Ref.getAndSet<ReadonlyArray<BlockId>>(site.state.minedItems, [])
    site.inventory = [...site.inventory, ...mined]

    const pendingAfter = yield* pendingSize(site)
    const calls = site.world.calls()
    const writes = site.world.takeWriteLog()

    // A MOVE is "a falling material landed somewhere, and the write took".
    // Counting `Written` outcomes rather than halving the write total is what
    // keeps this honest: a break writes AIR (excluded by the predicate) and
    // `applyFallingBlocks` has a three-write restore path
    // (`domain/entities/falling-block-move.ts:174-178`) that halving would
    // misreport. The restore itself writes a falling material and would be
    // counted here; it is unreachable for the reason recorded at that line, and
    // `--stats` measures whether it stayed unreachable.
    const moved = writes.filter(
      (record) => record.outcome === 'Written' && fallsWhenUnsupported(record.block),
    ).length

    const row: FrameRow = {
      frame: site.frame,
      requested,
      pendingBefore,
      examined: Math.min(pendingBefore, FALLING_BLOCK_MOVES_PER_TICK),
      moved,
      pendingAfter,
      reads: calls.reads,
      writes: calls.writes,
      mined,
      floating: floatingBlocks(site.world, allCells(site)).length,
    }

    site.frame += 1
    site.trace = [...site.trace, row]
    return row
  })

export const runFrames = (site: Site, count: number): Effect.Effect<void> =>
  Effect.forEach(Array.from({ length: Math.max(0, count) }, (_, index) => index), () => stepFrame(site), {
    discard: true,
  })

export type SettleReport = {
  readonly frames: number
  /** True when the queue was still draining at the cap. */
  readonly gaveUp: boolean
  readonly cap: number
}

/**
 * Advance until the falling-block queue is empty and stays empty.
 *
 * This is the check DN-GP-1 is about, made watchable. A per-tick scan cannot
 * fail it — it has no queue to drain — so what this really measures is how many
 * frames the EVENT-DRIVEN cascade needs and whether it terminates by itself.
 * The cap is generous and its exhaustion is reported rather than hidden: a
 * cascade that will not settle is the finding, not an excuse to stop drawing.
 */
export const settle = (site: Site, cap = 512): Effect.Effect<SettleReport> =>
  Effect.gen(function* () {
    let frames = 0
    while (frames < cap) {
      const pending = yield* pendingSize(site)
      const inbox = yield* Ref.get(site.state.pendingBreaks)
      if (pending === 0 && inbox.length === 0) {
        return { frames, gaveUp: false, cap }
      }
      yield* stepFrame(site)
      frames += 1
    }
    return { frames, gaveUp: true, cap }
  })

/** Every position in the visible cross-section that holds a hanging falling block. */
export const floatingIn = (site: Site): ReadonlyArray<BlockPosition> =>
  floatingBlocks(site.world, allCells(site))

/** The pending queue, as coordinates, for the `queue` view. */
export const pendingPositions = (site: Site): Effect.Effect<ReadonlyArray<PositionKey>> =>
  Effect.map(Ref.get(site.state.fallingBlocks), (queue) => [...queue.pending])

export const STAGE_ORDER_LABEL = (site: Site): string =>
  site.stages
    .map((stage) => stage.id.replace('gameplay:', ''))
    .join(' -> ')

export const IDLE_STAGE_IDS = [
  GAMEPLAY_STAGE_IDS.fluids,
  GAMEPLAY_STAGE_IDS.timeWeather,
] as const
