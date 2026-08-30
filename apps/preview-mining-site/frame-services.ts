/**
 * The context this preview runs stages in.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * A preview is a HOST. It merges no layers and sorts no cross-repository stage
 * graph — mc-compose does that — but it does the one host-shaped thing that
 * cannot be delegated: it decides what a stage may assume is present when it
 * runs. `FrameServicesLayer` is that decision, written down.
 *
 * `domain/frame-contract.ts` used to alias `FrameServices` to `never`, so this
 * layer could stay `Layer.empty`. Wave 1 (W1-M3) deleted that mirror and
 * repointed every importer at `@nerima-games/mc-kernel`, whose own alias is
 * `ClockPort`. Every `stage.run(dt)` this preview performs is now an
 * `Effect<void, never, ClockPort>`, which `Effect.runPromise` in `main.ts`
 * cannot run unless this layer discharges it — so it stopped being empty.
 *
 * A SEPARATE declaration from `test/support/frame-services.ts` on purpose, and
 * not an import of it: `tsconfig.preview.json` deliberately does not include
 * `test/**`, because the proof that the shipped rules are platform-free depends
 * on these projects staying apart. Two declarations, one substitution each.
 *
 * DO NOT SIMPLIFY THE CALL SITES. Every `Effect.provide(FrameServicesLayer)`
 * pipe is load-bearing now that the layer actually discharges `ClockPort`.
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
import { EpochMillis, FixedClockLayer, MonotonicTimeSecs, type FrameServices } from '@nerima-games/mc-kernel'

/**
 * Everything a stage may assume is present when this preview runs it.
 *
 * `FrameServices` is kernel's `ClockPort` now that the mirror is repointed
 * (Wave 1, W1-M3). This preview's own clock (`Site.frame * FRAME_DELTA`, never
 * `Date.now()`) is not wired through here yet, so this hands stages the same
 * deterministic fixed clock the test harness uses rather than leave the type
 * undischarged; see the header above for why a real clock belongs here later.
 */
export const FrameServicesLayer: Layer.Layer<FrameServices> = FixedClockLayer({
  monotonicSecs: MonotonicTimeSecs(0),
  wallClockEpochMillis: EpochMillis(0),
})
