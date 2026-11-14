/**
 * Deterministic frame-local rolls for gameplay rules.
 *
 * Stages draw rolls from the frame seed and advance it, so identical frame
 * inputs replay the same outcomes. Multiplayer assumes the server owns this
 * seed. This package does not enforce that boundary; a separate multiplayer
 * server-authority review (MP1) must verify it.
 */

import { Result } from 'effect'

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

export type FrameRollFailure = Readonly<{
  _tag: 'InvalidFrameRollInput'
  field: 'seed' | 'count' | 'index' | 'batch'
}>

const invalidInput = (field: FrameRollFailure['field']): FrameRollFailure => ({
  _tag: 'InvalidFrameRollInput',
  field,
})

/**
 * Map a finite seed to the generator's legal state, `[1, MODULUS - 1]`. Zero is
 * an absorbing state, so it maps to `1`.
 */
export const normaliseSeed = (seed: number): Result.Result<number, FrameRollFailure> => {
  if (!Number.isFinite(seed)) {
    return Result.fail(invalidInput('seed'))
  }
  const folded = Math.abs(Math.trunc(seed)) % MODULUS
  return Result.succeed(folded === 0 ? 1 : folded)
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
export const nextRoll = (seed: number): Result.Result<RollDraw, FrameRollFailure> => {
  const normalised = normaliseSeed(seed)
  if (Result.isFailure(normalised)) return Result.fail(normalised.failure)
  const state = (MULTIPLIER * normalised.success) % MODULUS

  return Result.succeed({ roll: (state - 1) / MODULUS, seed: state })
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
export const drawRolls = (seed: number, count: number): Result.Result<RollBatch, FrameRollFailure> => {
  const normalised = normaliseSeed(seed)
  if (Result.isFailure(normalised)) return Result.fail(normalised.failure)
  if (!Number.isSafeInteger(count) || count < 0) {
    return Result.fail(invalidInput('count'))
  }
  if (count === 0) return Result.succeed({ rolls: NO_ROLLS, seed })

  const rolls: Array<number> = []
  let current = seed
  for (let index = 0; index < count; index += 1) {
    const draw = nextRoll(current)
    if (Result.isFailure(draw)) return Result.fail(draw.failure)
    rolls.push(draw.success.roll)
    current = draw.success.seed
  }

  return Result.succeed({ rolls, seed: current })
}

/**
 * The roll a batch holds at a valid index.
 *
 * The batch and index are checked so an absent roll cannot be mistaken for a
 * zero, which passes chance gates.
 */
export const rollAt = (batch: RollBatch, index: number): Result.Result<number, FrameRollFailure> => {
  if (typeof batch !== 'object' || batch === null || !Array.isArray(batch.rolls)) {
    return Result.fail(invalidInput('batch'))
  }
  if (!Number.isFinite(index) || !Number.isInteger(index) || index < 0 || index >= batch.rolls.length) {
    return Result.fail(invalidInput('index'))
  }
  const roll = batch.rolls[index]
  return roll === undefined
    ? Result.fail(invalidInput('index'))
    : Result.succeed(roll)
}
