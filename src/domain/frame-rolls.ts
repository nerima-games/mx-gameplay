/**
 * Deterministic frame-local rolls for gameplay rules.
 *
 * Stages draw rolls from the frame seed and advance it, so identical frame
 * inputs replay the same outcomes. Multiplayer assumes the server owns this
 * seed. This package does not enforce that boundary; a separate multiplayer
 * server-authority review (MP1) must verify it.
 */

/**
 * Prime modulus used by the Park–Miller generator.
 */
const MODULUS = 2_147_483_647

/** Park–Miller generator multiplier. */
const MULTIPLIER = 16_807

/**
 * Fixed initial seed for each frame state.
 */
export const DEFAULT_ROLL_SEED = 20_260_727

/**
 * Map a seed to the generator's legal state, `[1, MODULUS - 1]`. Zero is an
 * absorbing state, so it maps to `1`; non-finite seeds also map to `1`.
 */
export const normaliseSeed = (seed: number): number => {
  if (!Number.isFinite(seed)) {
    return 1
  }
  const folded = Math.abs(Math.trunc(seed)) % MODULUS
  return folded === 0 ? 1 : folded
}

/** One roll, and the seed to keep for the next one. */
export type RollDraw = {
  /** In `[0, 1)`, which is the interval every rule in `domain/mob/` documents. */
  readonly roll: number
  readonly seed: number
}

/**
 * Draw one roll.
 *
 * The roll is `(x - 1) / MODULUS` rather than `x / MODULUS` or
 * `(x - 1) / (MODULUS - 1)`. The first would never yield 0 and the last would
 * yield exactly 1 on the largest state — and a roll of 1 is outside the interval
 * every consumer documents, which `./mob/mob-drop`'s `rollCount` would turn into
 * a count one past the end of its range.
 */
export const nextRoll = (seed: number): RollDraw => {
  const state = (MULTIPLIER * normaliseSeed(seed)) % MODULUS

  return { roll: (state - 1) / MODULUS, seed: state }
}

/** Several rolls at once, and the seed to keep. */
export type RollBatch = {
  readonly rolls: ReadonlyArray<number>
  readonly seed: number
}

const NO_ROLLS: ReadonlyArray<never> = []

/**
 * Draw `count` rolls in order. A zero count does not allocate or advance the seed.
 */
export const drawRolls = (seed: number, count: number): RollBatch => {
  if (!Number.isFinite(count) || count <= 0) {
    return { rolls: NO_ROLLS, seed }
  }

  const rolls: Array<number> = []
  let current = seed
  for (let index = 0; index < Math.floor(count); index += 1) {
    const draw = nextRoll(current)
    rolls.push(draw.roll)
    current = draw.seed
  }

  return { rolls, seed: current }
}

/**
 * The roll a batch holds at `index`, or 0 when it holds none there.
 *
 * TOTAL, and it exists so that the fallback is written ONCE. Every consumer
 * reads `batch.rolls[n]` with an `n` its own call to `drawRolls` guaranteed —
 * and `noUncheckedIndexedAccess` still types that read `number | undefined`, so
 * each site grew its own `?? 0`. Four of them, in `./entities/mob-spawn-search`
 * and `../stages/registration`, none reachable at its own site, each one a
 * branch permanently red in the coverage report. The four could not disagree
 * about the VALUE, but they could and did disagree about whether the question
 * was worth asking, which is how a formality becomes four unexamined guards.
 *
 * Reading past the end is not a hypothetical: `drawRolls(seed, 0)` returns the
 * empty batch on purpose, and `./interactions/block-loot` documents the same
 * out-of-range reading as a deliberate calling convention — 「a test that means
 * "every bonus line fires" should be able to say so by passing nothing」.
 *
 * 0 rather than `undefined` because every rule downstream documents its input as
 * a number in `[0, 1)` and 0 is inside it. Note which way that falls: a roll of
 * 0 PASSES a chance gate, so a caller that forgot to draw gets the most generous
 * answer, not the least. That is the opposite of the inert direction and it is
 * the direction `block-loot` already chose deliberately for the same reason —
 * the only production caller draws its budget from `drawRolls`, so an absent
 * roll means a test wrote one on purpose.
 */
export const rollAt = (batch: RollBatch, index: number): number => batch.rolls[index] ?? 0
