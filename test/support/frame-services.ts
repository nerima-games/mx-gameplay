/**
 * The context a frame stage runs in, for tests.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * `domain/frame-contract.ts` used to alias `FrameServices` to `never`, so this
 * layer could stay `Layer.empty` — the mirror's whole point was that mc-kernel
 * was unpublished. Wave 1 (W1-M3) deleted that mirror and repointed every
 * importer at `@nerima-games/mc-kernel`, whose own alias is `ClockPort`
 * (settled at the vertical-slice spike, `domain/frame.ts`'s header). Every
 * `stage.run(dt)` in this repository's tests is now an
 * `Effect<void, never, ClockPort>`, which `it.effect` cannot run unless a test
 * context was given a clock — so this layer stopped being empty and started
 * providing kernel's own deterministic fixed clock.
 *
 * The preview under `apps/preview-mining-site/` carries its own copy of this
 * declaration and NOT an import of this one, because `tsconfig.preview.json`
 * deliberately does not include `test/**` — see that file's header on why the
 * preview is a separate project. Two declarations, one substitution each.
 *
 * DO NOT SIMPLIFY THE CALL SITES. Every `Effect.provide(FrameServicesLayer)`
 * pipe is load-bearing now that the layer actually discharges `ClockPort` —
 * removing one reopens the exact compile error the repoint fixed.
 *
 * ---------------------------------------------------------------------------
 * Why a layer and not a hand-rolled clock
 * ---------------------------------------------------------------------------
 *
 * Nothing here may read a wall clock. plan.md §5.1-3 bans it and
 * `pnpm check:deps` enforces it, and a test clock is precisely where somebody
 * reaches for `Date.now()` on the grounds that it is only a test. This
 * repository already holds that line where it costs something:
 * `test/stage-registration.test.ts` carries a named regression saying no stage
 * advances the hour, and the whole falling-block and fluid cascade is driven by
 * accumulated `dt`. Kernel ships `FixedClockLayer` so that a deterministic
 * clock never has to be written by hand again; this file takes kernel's rather
 * than writing its own.
 */
import { Layer } from 'effect'
import { EpochMillis, FixedClockLayer, MonotonicTimeSecs, type FrameServices } from '@nerima-games/mc-kernel'

/**
 * Everything a stage of this repository may assume is present when it runs.
 *
 * `FrameServices` is kernel's `ClockPort` now that the mirror is repointed
 * (Wave 1, W1-M3), so this hands every test stage a deterministic fixed clock
 * rather than the `Layer.empty` this declaration used to be.
 */
export const FrameServicesLayer: Layer.Layer<FrameServices> = FixedClockLayer({
  monotonicSecs: MonotonicTimeSecs(0),
  wallClockEpochMillis: EpochMillis(0),
})
