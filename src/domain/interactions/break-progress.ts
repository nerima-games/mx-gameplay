/**
 * ONE RULE, ONE FILE (DN-GP-9): holding the button on a block accumulates
 * progress, and the block breaks when the progress is enough.
 *
 * The half of mining that `./break-block` does not do. That file answers "the
 * block is being removed, what happens" — the drop, the inventory, the store
 * write. This one answers "is it time yet", and the two are separate because
 * only this one has a memory: `breakBlock` is a function of the world, and this
 * is a function of the world AND of what the player was doing last frame.
 *
 * Ported from `interaction-break-progress.ts`, which is 22 lines with ZERO
 * IMPORTS — no vocabulary, no services, no `Effect`. That is unusual enough in
 * that codebase to be worth saying: the accumulator does not know what a block
 * is. It compares an opaque key and counts.
 *
 * ---------------------------------------------------------------------------
 * THE KEY IS OPAQUE AND THAT IS THE WHOLE MECHANISM
 * ---------------------------------------------------------------------------
 *
 * `blockKey` is a string this file never parses. Its only use is EQUALITY with
 * the key from the previous frame, and that single comparison is what makes
 * "look away and the progress resets" work — the rule everyone knows from
 * playing, and which nothing else in the file mentions.
 *
 * Kernel's `blockPositionKeyOf` is what a caller in this repository uses to make
 * one. Taking the key rather than a `BlockPosition` is the reference's choice and it
 * is kept: a position would invite this file to do arithmetic on coordinates,
 * and there is no arithmetic here that should ever depend on where the block is.
 *
 * ---------------------------------------------------------------------------
 * THREE EDGE CASES THE REFERENCE LEAVES OPEN, CLOSED HERE
 * ---------------------------------------------------------------------------
 *
 * The reference's condition is `input.breakTicks === 0 || newTicks >= input.breakTicks`.
 * Three inputs get through it and produce something nobody would want:
 *
 *   NEGATIVE `breakTicks` — `1 >= -5` is true, so it breaks instantly. That is
 *   the same answer as 0 and reads as correct, but it arrives by a different
 *   route and would keep working if the `=== 0` test were removed.
 *
 *   NON-FINITE `breakTicks` — `NaN` fails every comparison, so the block NEVER
 *   breaks and the tick counter grows without bound. A block that cannot be
 *   mined, with no error, for one bad hardness lookup.
 *
 *   FRACTIONAL `breakTicks` — 2.5 breaks on tick 3, which is right, but the
 *   `totalTicks` handed back is 2.5 and a progress bar drawn from it reads
 *   120% just before it completes.
 *
 * All three are clamped in `normaliseBreakTicks` below rather than in the
 * branch, so the branch stays the reference's and the corrections are one
 * readable function.
 */

/** How far along the player is, and on which block. */
export type BreakProgressState = {
  /** Opaque. Compared for equality and never parsed. See the header. */
  readonly blockKey: string
  /** Ticks accumulated so far, at least 1. */
  readonly ticks: number
  /** Ticks this block needs in total. Whole and finite. */
  readonly totalTicks: number
}

export type AdvanceBreakProgressInput = {
  /** Last frame's progress, or `null` if the player was not mining. */
  readonly current: BreakProgressState | null
  /** The block being mined this frame. */
  readonly blockKey: string
  /** How many ticks this block needs. See `normaliseBreakTicks`. */
  readonly breakTicks: number
}

export type AdvanceBreakProgressResult = {
  /** Progress to carry into the next frame, or `null` when there is none. */
  readonly nextProgress: BreakProgressState | null
  /** Whether the caller should now run `./break-block`. */
  readonly shouldBreak: boolean
}

/**
 * The tick budget, made whole, finite and non-negative.
 *
 * `Math.ceil` and not `Math.round`: a block needing 2.5 ticks must not become
 * one needing 2, because the budget comes from a hardness divided by a tool
 * speed and rounding down makes every marginal tool exactly as good as the tier
 * above it.
 *
 * A NON-FINITE BUDGET BECOMES INSTANT, not infinite. Both are wrong inputs and
 * the choice is between a block that cannot be mined and one that mines at
 * once; the second is visible immediately and the first is a bug report about
 * "this stone is indestructible". The inert direction here is the loud one —
 * which is the opposite of the usual rule, and worth stating because of that.
 */
export const normaliseBreakTicks = (breakTicks: number): number =>
  Number.isFinite(breakTicks) ? Math.max(0, Math.ceil(breakTicks)) : 0

/** Progress against a block that needs no time at all. */
export const INSTANT_BREAK: AdvanceBreakProgressResult = {
  nextProgress: null,
  shouldBreak: true,
}

/**
 * Advance one frame of mining.
 *
 * ONE TICK PER CALL, and the caller decides what a tick is. The reference
 * increments by exactly 1 and takes no delta, which ties the mining rate to the
 * frame rate — a real defect, and NOT one this file can fix: the fix is to take
 * a `DeltaTimeSecs` and a ticks-per-second, and both of those are the frame's
 * to supply. Kernel's `domain/quantities.ts` is where that would arrive from.
 * Recorded here rather than silently reproduced.
 *
 * SWITCHING BLOCKS RESTARTS FROM ZERO rather than carrying the count across.
 * That is the rule the opaque key exists for, and it is why `current` is
 * consulted for its `blockKey` before its `ticks`.
 */
export const advanceBreakProgress = (
  input: AdvanceBreakProgressInput,
): AdvanceBreakProgressResult => {
  const totalTicks = normaliseBreakTicks(input.breakTicks)
  if (totalTicks === 0) {
    return INSTANT_BREAK
  }

  const sameBlock = input.current !== null && input.current.blockKey === input.blockKey
  const ticks = (sameBlock && input.current !== null ? input.current.ticks : 0) + 1

  return ticks >= totalTicks
    ? { nextProgress: null, shouldBreak: true }
    : { nextProgress: { blockKey: input.blockKey, ticks, totalTicks }, shouldBreak: false }
}

/**
 * How far along, in `[0, 1]`, for something that draws a bar.
 *
 * SEPARATE FROM THE STATE rather than a field on it, because it is a view
 * concern and this repository does not own views — mx-ui does. Exposing the two
 * counts and a function to combine them lets the bar live there without this
 * file growing an opinion about how progress is shown.
 *
 * Clamped, so a state built by hand cannot produce a bar past its end.
 */
export const breakProgressFraction = (state: BreakProgressState): number =>
  state.totalTicks <= 0 ? 1 : Math.min(1, Math.max(0, state.ticks / state.totalTicks))
