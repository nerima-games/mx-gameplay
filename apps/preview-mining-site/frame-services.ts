/**
 * The context this preview runs stages in.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS, AND WHY IT LOOKS LIKE IT DOES NOTHING
 * ---------------------------------------------------------------------------
 *
 * A preview is a HOST. It merges no layers and sorts no cross-repository stage
 * graph — mc-compose does that — but it does the one host-shaped thing that
 * cannot be delegated: it decides what a stage may assume is present when it
 * runs. `FrameServicesLayer` is that decision, written down.
 *
 * It is empty today. `domain/frame-contract.ts` aliases `FrameServices` to
 * `never` because mc-kernel is unpublished and restating its `ClockPort` here
 * would mean a second `Context.Tag` carrying kernel's identifier string.
 * Kernel's own alias is `ClockPort`, so on the day that mirror is deleted and
 * its importers repointed at `@nerima-games/mc-kernel`, every `stage.run(dt)`
 * this preview performs stops being an `Effect<void, never, never>` and becomes
 * an `Effect<void, never, ClockPort>` — which `Effect.runPromise` in `main.ts`
 * cannot run.
 *
 * That is measured rather than predicted. mc-dev-meta's `pnpm check:repoint`
 * performs the repoint on a throwaway copy and compiles it; before this file
 * existed it reported two diagnostics in `tsconfig.preview.json`, at `stepFrame`
 * in `./site.ts` and at `buildStatsReport` in `./stats.ts`. Note that the second
 * is an AGGREGATION point and not a call site: the requirement reached it from
 * two separate places in that file, the frame-rate sweep and the
 * fluid-frontier race probe, and a count of diagnostics is therefore a floor on
 * the work rather than a measure of it. All three places now resolve through
 * this layer, so what remains is one diagnostic — this declaration — and the
 * fix is to replace `Layer.empty` with kernel's own fixed clock:
 *
 *     import { FixedClockLayer, MonotonicTimeSecs, EpochMillis } from '@nerima-games/mc-kernel'
 *
 *     export const FrameServicesLayer: Layer.Layer<FrameServices> = FixedClockLayer({
 *       monotonicSecs: MonotonicTimeSecs(0),
 *       wallClockEpochMillis: EpochMillis(0),
 *     })
 *
 * A SEPARATE declaration from `test/support/frame-services.ts` on purpose, and
 * not an import of it: `tsconfig.preview.json` deliberately does not include
 * `test/**`, because the proof that the shipped rules are platform-free depends
 * on these projects staying apart. Two declarations, one substitution each.
 *
 * DO NOT SIMPLIFY THE CALL SITES. Deleting an
 * `Effect.provide(FrameServicesLayer)` is invisible today — the layer is empty,
 * so providing it changes neither type nor behaviour — and silently re-opens
 * that call site on the day of the repoint.
 *
 * ---------------------------------------------------------------------------
 * The clock this preview will hand over is its own, and it already exists
 * ---------------------------------------------------------------------------
 *
 * `Site.frame` counts frames and every one of them is exactly `FRAME_DELTA`
 * long, so this preview already knows what time it is to the microsecond and
 * has never once asked the operating system. That is what makes `--stats`
 * reproducible and `--seed` mean anything. When this layer needs a real clock
 * it should serve `site.frame * FRAME_DELTA` rather than anything kernel's
 * `FixedClockLayer` would freeze — and under no circumstances `Date.now()`,
 * which plan.md §5.1-3 bans and `pnpm check:deps` refuses to compile.
 */
import { Layer } from 'effect'
import type { FrameServices } from '../../domain/frame-contract'

/**
 * Everything a stage may assume is present when this preview runs it.
 *
 * Empty today because `FrameServices` is `never` today. The TYPE is what
 * carries the intent: it tracks the contract rather than the current state of
 * the mirror, so widening the alias moves this declaration and nothing else.
 */
export const FrameServicesLayer: Layer.Layer<FrameServices> = Layer.empty
