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
 * `Effect.void` there, and its README says plainly that this means the preview
 * running is not evidence that the stage works. This preview is under no such handicap
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
 *     `breakBlock`, PLACING one goes through `placeBlock`, the item in the HUD
 *     came out of `domain/interactions/block-loot.ts` and therefore out of
 *     kernel's drop table, the queue in the `queue` view is the actual
 *     `FallingBlockQueue`, and the read and write counters are the actual store
 *     calls.
 *   - It is NOT evidence about anything unimplemented. `gameplay:fluids` cycles
 *     a frontier and propagates nothing, and there is no mob here (`./roster.ts`
 *     on why the roster is empty and refuses to grow). See README.md, "What is
 *     not here".
 *
 * ---------------------------------------------------------------------------
 * `p` IS A RULE NOW, AND WHAT THAT CHANGED IS WORTH READING
 * ---------------------------------------------------------------------------
 *
 * This file used to carry a `pokeBlock` that wrote the store directly, with a
 * headed paragraph saying it deliberately did NOT call `disturb` — 「Poking the
 * store shows exactly what the missing rule would have to remember to do, which
 * is more useful than a placement that pretended to work」.
 *
 * `domain/interactions/place-block.ts` exists, so `p` submits a real request
 * into `pendingPlacements` and the stage services it. THE PREDICTION HELD: what
 * the missing rule had to remember was the `disturb`, and that is one line in
 * `stages/registration.ts`. `pokeBlock` is kept and renamed `poke`, because the
 * stats harness needs a way to arrange a world that no rule would produce, and
 * because the CONTRAST — a poke that changes nothing else against a placement
 * that starts a cascade — is the thing the screen can now show.
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
import { below as belowOf, positionKeyOf } from '../../domain/block-position-key'
import { type BlockId, type BlockPosition } from '../../domain/chunk-store-port'
import {
  blockIdOf,
  blockOfPlaceableItem,
  fallsWhenUnsupported,
  type HarvestTier,
  type PlaceableItemType,
} from '../../domain/block-vocabulary'
import { FALLING_BLOCK_MOVES_PER_TICK } from '../../domain/falling-block'
import { DeltaTimeSecs, type StageRegistration } from '../../domain/frame-contract'
import { NO_TOOL, type BlockLootContext, type MinedItem } from '../../domain/interactions/block-loot'
import { isSupportSensitiveOfBlock, placementVerdict } from '../../domain/interactions/place-block'
import type { PositionKey } from '../../domain/position-key'
import { INITIAL_WEATHER, type WeatherState } from '../../domain/weather'
import type { IgnitionItemType } from '../../domain/interactions/use-flint-and-steel'
import {
  gameplayStages,
  makeGameplayFrameState,
  requestItemUse as enqueueItemUse,
  type GameplayFrameState,
  type PlacementRequest,
} from '../../stages/registration'
import { GAMEPLAY_STAGE_IDS } from '../../stages/stage-ids'
import { FrameServicesLayer } from './frame-services'
import { makePreviewInventory, type PreviewInventory } from './inventory'
import { emptyPreviewRoster } from './roster'
import { makePreviewPlayer } from './player'
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
  /** Break and placement requests submitted into the inboxes before this frame ran. */
  readonly requested: number
  readonly pendingBefore: number
  readonly examined: number
  readonly moved: number
  readonly pendingAfter: number
  readonly reads: number
  readonly writes: number
  /**
   * The `add` calls the interactions stage made this frame. Items, not block
   * ids, and no longer an outbox: `domain/interactions/block-loot.ts` produced
   * them and `stages/registration.ts` handed each one to mc-sim's
   * `InventoryService`. See `./inventory.ts`'s `takeDepositLog`.
   */
  readonly mined: ReadonlyArray<MinedItem>
  /**
   * What the inventory REFUSED, drained out of `state.leftoverItems`.
   *
   * Almost always empty, and that is what makes it worth a column: a non-zero
   * entry is an item the player earned and does not have, waiting for a
   * dropped-item entity this repository cannot spawn yet.
   */
  readonly leftover: ReadonlyArray<MinedItem>
  /** What placement took off the stack. */
  readonly spent: ReadonlyArray<PlaceableItemType>
  /** Falling blocks currently hanging with a replaceable cell below them. */
  readonly floating: number
}

export type Site = {
  readonly world: PreviewWorld
  readonly inventoryService: PreviewInventory
  readonly state: GameplayFrameState
  readonly stages: ReadonlyArray<StageRegistration>
  readonly spec: WorldSpec
  readonly bounds: { readonly width: number; readonly height: number }
  frame: number
  /**
   * WHAT MC-SIM HOLDS, refreshed from `snapshot` at the end of every frame.
   *
   * This used to be the preview's own tally — a `Map` this file added the
   * `minedItems` outbox into and subtracted `consumedItems` from — under a
   * comment saying 「This is the preview playing mc-sim's `InventoryService.add`
   * / `.remove` pair」. It is playing the service for real now (`./inventory.ts`),
   * so the number the HUD prints is the number the service would answer, by the
   * service's stacking rule, and a stack that did not fit is missing from it
   * rather than silently included.
   *
   * It stays a plain `Map` field because the HUD and `--stats` read it
   * synchronously; it is a PROJECTION, refreshed in `stepFrame`, and writing to
   * it would change nothing.
   */
  inventory: ReadonlyMap<string, number>
  /** The weather the host is feeding back in, drained out of `weatherAdvanced`. */
  weather: WeatherState
  /** What the host is telling the rules the player is holding. Mirrors `state.heldTool`. */
  tool: BlockLootContext
  trace: ReadonlyArray<FrameRow>
  note: string
  scenario: string
  /** Requests submitted but not yet consumed by a frame. */
  submitted: number
}

/**
 * What `placementVerdict` answers: a refusal, or permission with the id.
 *
 * Named here rather than exported from the rule because it is the rule's
 * RETURN type and not one of its nouns — `place-block.ts` spells it inline for
 * the same reason `breakBlock` does not name `Effect<BreakOutcome>`.
 */
export type PlacementVerdict = ReturnType<typeof placementVerdict>

/** Total items held, counting stack sizes. The number the HUD prints. */
export const inventorySize = (site: Site): number =>
  [...site.inventory.values()].reduce((total, count) => total + count, 0)

/** How many of one item the host is holding. */
export const inventoryCount = (site: Site, item: string): number => site.inventory.get(item) ?? 0

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
    const inventoryService = yield* makePreviewInventory()
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
    const previewPlayer = yield* makePreviewPlayer
    const stages = schedule(
      gameplayStages(state, world.api, emptyPreviewRoster, inventoryService.api, previewPlayer),
    )

    return {
      world,
      inventoryService,
      state,
      stages,
      spec,
      bounds,
      frame: 0,
      inventory: new Map<string, number>(),
      weather: INITIAL_WEATHER,
      tool: NO_TOOL,
      trace: [],
      note: '',
      scenario,
      submitted: 0,
    }
  })

/**
 * The tiers the `t` key walks, in order.
 *
 * IT STARTS AT BARE HANDS, which is the same default `stages/registration.ts`
 * gives `heldTool` and is chosen for the same reason: the tool gate's REFUSAL is
 * the half of the loot table that is invisible from a screenshot, so the screen
 * opens on it rather than on the answer that looks like it always worked.
 */
export const TOOL_TIERS: ReadonlyArray<HarvestTier> = ['none', 'wooden', 'stone', 'iron', 'diamond']

/** Fortune levels the `f` key walks. 0 is no enchantment at all. */
export const FORTUNE_LEVELS: ReadonlyArray<number> = [0, 1, 2, 3]

/**
 * What the host says the player is swinging.
 *
 * This is the preview playing `InventoryService` again — the selected hotbar
 * slot and whatever is enchanted on it — and it is one `Ref.set` because
 * `heldTool` is an INBOX the stage reads within the frame that wrote it.
 */
export const setHeldTool = (site: Site, tool: BlockLootContext): Effect.Effect<void> =>
  Effect.map(Ref.set(site.state.heldTool, tool), () => {
    site.tool = tool
    site.note = `holding ${describeTool(tool)}`
  })

/** `wooden pickaxe, fortune II` — what the HUD prints. */
export const describeTool = (tool: BlockLootContext): string => {
  const parts = [
    tool.heldTier === undefined || tool.heldTier === 'none' ? 'bare hands' : `${tool.heldTier} tool`,
    ...(tool.silkTouch === true ? ['silk touch'] : []),
    ...((tool.fortuneLevel ?? 0) > 0 ? [`fortune ${String(tool.fortuneLevel ?? 0)}`] : []),
  ]
  return parts.join(', ')
}

/** Queue a break at this position. One of the two ways a rule is asked to act. */
export const requestBreak = (site: Site, position: BlockPosition): Effect.Effect<void> =>
  Effect.map(
    Ref.update(site.state.pendingBreaks, (queue) => [...queue, positionKeyOf(position)]),
    () => {
      site.submitted += 1
      site.note = `queued break at ${positionKeyOf(position)}`
    },
  )

/**
 * Queue a placement at this position. The other one.
 *
 * THE HOST DOES NOT CHECK THE INVENTORY, and that gap is deliberate rather than
 * missing. `placeBlock` consumes an item and reports which; whether the player
 * HAD one is a question about mc-sim's `InventoryService`, and a preview that
 * enforced it would be inventing the stack-size half of a service it is only
 * standing in for. What the HUD does instead is print the running total, so a
 * player watching it go negative is watching the missing check.
 */
export const requestPlace = (
  site: Site,
  position: BlockPosition,
  heldItem: PlaceableItemType,
): Effect.Effect<void> =>
  Effect.map(
    Ref.update(site.state.pendingPlacements, (queue): ReadonlyArray<PlacementRequest> => [
      ...queue,
      { positionKey: positionKeyOf(position), heldItem },
    ]),
    () => {
      site.submitted += 1
      site.note = `queued place of ${heldItem} at ${positionKeyOf(position)}`
    },
  )

/**
 * Queue an ITEM USE at this position. The third way a rule is asked to act.
 *
 * plan.md §3.11's responsibility 1 names three verbs and this screen could only
 * do two of them; `docs/testing.md` §3-1 recorded the third as
 * 「アイテム使用が無い」. `i` is that row closing.
 *
 * NO DRY RUN, unlike `requestPlace`'s `previewPlacement`, and the difference is
 * not an inconsistency. A placement's refusals are decided by
 * `placementVerdict`, which is PURE and separate from the writes, so asking it
 * twice costs nothing. Portal detection has no such split — mc-worldgen's
 * `detectNetherPortal` is the decision, and the only rule that runs it here is
 * the one that also fills the interior. Running it twice would light the portal
 * twice, which is the exact defect the note on `previewPlacement` warns about
 * from the other side.
 *
 * So the screen queues, the stage acts, and what the player reads is the WORLD:
 * a `%` where they clicked means the frame was valid, a `*` means it was not and
 * a fire went in instead. That is a better demonstration than a printed tag,
 * because the fall-through from one rule to the other is the thing worth seeing.
 */
export const requestItemUse = (
  site: Site,
  position: BlockPosition,
  heldItem: IgnitionItemType,
): Effect.Effect<void> =>
  Effect.map(
    enqueueItemUse(site.state, `preview:${String(site.submitted + 1)}`, position, heldItem),
    () => {
      site.submitted += 1
      site.note = `queued use of ${heldItem} at ${positionKeyOf(position)}`
    },
  )

/**
 * Ask the placement rule what it WOULD do, without writing anything.
 *
 * The stage drops every refusal — `run` returns void and there is nowhere in a
 * frame to report a diagnostic to (`stages/registration.ts` says so where it
 * drops them) — and the reasons are the interesting part of this rule: three of
 * its four refusals are places the reference implementation got it wrong. So the
 * screen asks for the verdict and prints it, which is the same thing the arena
 * screen does with `canHostileSpawnAt`'s refusal reasons.
 *
 * IT CALLS `placementVerdict` AND NOT `placeBlock`, and that is the whole reason
 * the rule exposes the decision separately from the writes. `placeBlock` WRITES
 * when it says yes, so a dry run built on it would place the block here and
 * again when the stage serviced the queued request — one keystroke, two blocks,
 * and only one of them accounted for in the inventory.
 */
export const previewPlacement = (
  site: Site,
  position: BlockPosition,
  heldItem: PlaceableItemType,
): Effect.Effect<PlacementVerdict> =>
  Effect.gen(function* () {
    const request = { position, heldItem }
    const target = yield* site.world.api.getBlock(position)
    const block = blockIdOf(blockOfPlaceableItem(heldItem))
    const supportBelow =
      block !== undefined && isSupportSensitiveOfBlock(block)
        ? yield* site.world.api.getBlock(belowOf(position))
        : undefined

    return placementVerdict(request, target, supportBelow)
  })

/**
 * Write a cell directly, WITHOUT a rule.
 *
 * There IS a place-block rule now (`requestPlace` above), so this is no longer
 * standing in for one. It is kept for the one thing a rule cannot do: arrange a
 * world that no rule would produce. `--stats` uses it to build the arrangements
 * its checks are about, and the `e` key uses it to erase without mining — which
 * is the contrast that makes the placement visible, because a poke deliberately
 * does NOT `disturb` and a placement does.
 */
export const poke = (site: Site, position: BlockPosition, block: BlockId): void => {
  site.world.poke(position, block)
  site.note =
    block === AIR
      ? `erased ${positionKeyOf(position)} directly in the store — no rule ran, nothing was disturbed`
      : `poked ${positionKeyOf(position)} directly in the store — no rule ran, nothing was disturbed`
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

    // The weather INBOX, written before the stages run. This is the host's
    // half of the pair `stages/registration.ts` argues for: the repository that
    // owns the value writes it at the top of the frame, the rule says what it
    // becomes, and the host writes it back below. Here the owner is this
    // preview, because no repository owns weather yet.
    yield* Ref.set(site.state.weather, site.weather)
    // The tool INBOX, for the same reason and in the same place: the host
    // overwrites it every frame from whoever owns the inventory.
    yield* Ref.set(site.state.heldTool, site.tool)

    // A host provides the context its stages run in; see `./frame-services.ts`
    // for why a layer that is empty today is written down rather than omitted.
    yield* Effect.forEach(site.stages, (stage) => stage.run(FRAME_DELTA), { discard: true }).pipe(
      Effect.provide(FrameServicesLayer),
    )

    // WHAT THE MINING HALF DOES NOW: nothing. The stage already called
    // `InventoryService.add` for every stack it mined, inside the frame, so
    // there is no `minedItems` to drain — the log below is a RECORD of those
    // calls and not a queue of work the host still owes.
    const mined = yield* site.inventoryService.takeDepositLog

    // ...and the one Ref that survived the wiring: what `add` REFUSED. This is
    // drained rather than accumulated because the frame tape reports per frame,
    // and it is reported rather than ignored because an entry here is an item
    // the player earned and does not have. `stages/registration.ts` says why it
    // cannot yet be a dropped-item entity.
    const leftover = yield* Ref.getAndSet<ReadonlyArray<MinedItem>>(site.state.leftoverItems, [])

    // THE OTHER DIRECTION IS STILL A LIST, and the host still pays for it.
    // `stages/registration.ts` declines to call `remove` from the stage,
    // because `placeBlock` has already written the cell by then and a `remove`
    // that came back `0` would leave the player a block they never had. So the
    // charge happens HERE, after the fact, which is exactly the defect that
    // paragraph is about — visible on this screen as a count that can go
    // negative, and not fixable from a host.
    const spent = yield* Ref.getAndSet<ReadonlyArray<PlaceableItemType>>(
      site.state.consumedItems,
      [],
    )
    for (const item of spent) {
      yield* site.inventoryService.api.remove(item, 1)
    }

    // The HUD's number, refreshed from the SERVICE rather than tallied here.
    site.inventory = yield* site.inventoryService.held

    // The weather OUTBOX, read after. `undefined` means the stage did not run,
    // which cannot happen here and is answered with "keep what we had" rather
    // than with a default — a default would silently reset a countdown.
    const advanced = yield* Ref.get(site.state.weatherAdvanced)
    if (advanced !== undefined) {
      site.weather = advanced
    }

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
      leftover,
      spent,
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
      const breaks = yield* Ref.get(site.state.pendingBreaks)
      const placements = yield* Ref.get(site.state.pendingPlacements)
      if (pending === 0 && breaks.length === 0 && placements.length === 0) {
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
