/**
 * WHERE RANDOMNESS ENTERS A FRAME, and the only place it may.
 *
 * ---------------------------------------------------------------------------
 * The rules take rolls; something has to produce them
 * ---------------------------------------------------------------------------
 *
 * `./mob/mob-drop` and `./mob/enderman-teleport` both take their randomness as
 * an ARGUMENT — a number in `[0, 1)` — and `test/mob.test.ts` enforces that by
 * reading their sources and failing on `Math.random`. That is the right shape
 * for a rule and it leaves a question the rules deliberately do not answer:
 * where does the number come from when the stage actually runs one?
 *
 * Four candidate answers were available and three of them are wrong here.
 *
 *   `Math.random()`               Banned by the source check, and rightly:
 *                                 plan.md §5.1-3 makes determinism the
 *                                 precondition for using the reference's tests
 *                                 as an oracle, and the reference's own drop
 *                                 behaviour cannot be replayed for exactly this
 *                                 reason (`interaction-mob-drops.ts:18` reads
 *                                 the global generator).
 *
 *   Effect's `Random` service     A service in the context. `StageRegistration.run`
 *                                 has `FrameServices` as its context and
 *                                 `FrameServices` is kernel's — today `never`
 *                                 (`./frame-contract`). A stage that demanded
 *                                 `Random` there would be asking kernel to widen
 *                                 the one alias plan.md §6 wants frozen at 1.0.0,
 *                                 in order to obtain a number.
 *
 *   A roll per entity from mc-sim `EntityState` has three fields and none of them is
 *                                 a generator. Adding one would make mc-sim the
 *                                 owner of a rules-tier concern, which is the
 *                                 boundary `domain/entity.ts` is built to hold.
 *
 *   A SEED IN THE FRAME STATE     What this file is. The seed is drawn from at
 *                                 the moment a rule consults a roll and at no
 *                                 other, so a frame is a pure function of its
 *                                 inputs and its seed, and two runs of one
 *                                 scenario produce the same drops.
 *
 * mc-worldgen threads a seed for the same reason and `./mob/mob-drop`'s header
 * names it as the model 「the way mc-worldgen threads a seed」. This is the
 * consumer side of that sentence.
 *
 * ---------------------------------------------------------------------------
 * The seed is frame-local scratch, and it passes the save-file test
 * ---------------------------------------------------------------------------
 *
 * `stages/registration.ts` asks one question of every `Ref` it holds: would a
 * save file need it? A generator's position is not a fact about the world. A
 * reload restarts the sequence, and the only observable consequence is which
 * numbers a kill that has not happened yet will draw — no saved noun disagrees
 * with anything, which is the property `timeOfDaySecs` failed.
 *
 * What a save file WOULD need is a world seed, and that is mc-worldgen's noun
 * rather than a second one invented here. When it is published, the frame's seed
 * is derived from it and this file's function does not change.
 *
 * ---------------------------------------------------------------------------
 * Which generator, and the one thing to know about it
 * ---------------------------------------------------------------------------
 *
 * Lehmer / Park-Miller "MINSTD": `x' = 16807 * x mod (2^31 - 1)`. Three
 * properties decide it over the usual bit-twiddling alternatives:
 *
 *   - EVERY INTERMEDIATE IS EXACT IN A DOUBLE. `16807 * (2^31 - 2)` is about
 *     3.6e13, comfortably inside 2^53, so there is no coercion to int32 anywhere
 *     and the sequence is identical in every JavaScript engine. A generator whose
 *     reproducibility depends on wraparound semantics is a generator whose
 *     reproducibility has to be argued for.
 *   - It is one line, and a reader can check it against a citation rather than
 *     against a comment.
 *   - It uses no bitwise operator, which `oxlint.json`'s `no-bitwise` would
 *     otherwise have to be suppressed for — and a suppression comment in the one
 *     file that produces randomness is exactly the kind of thing nobody reads.
 *
 * The cost, stated rather than discovered: MINSTD has poor high-dimensional
 * uniformity — successive triples fall on a lattice of about 2953 planes. That is
 * irrelevant to "does this drop pass a 50% gate" and would matter to terrain, so
 * the trigger for replacing it is a rule that draws many rolls and cares how they
 * correlate. Nothing in `domain/` does; `./mob/mob-drop`'s creeper table never
 * consults a roll at all.
 */

/**
 * The modulus. `2^31 - 1`, prime, which is what makes the multiplier's orbit
 * cover every value in `[1, m - 1]` exactly once before repeating.
 */
const MODULUS = 2_147_483_647

/** The multiplier. Park & Miller's, and a primitive root of `MODULUS`. */
const MULTIPLIER = 16_807

/**
 * The seed every frame state starts from.
 *
 * A LITERAL and not a clock reading, which is the whole point: two runs of one
 * scenario replay identically, and `Date.now()` is banned by
 * `scripts/check-dependency-whitelist.ts` anyway (DN-GP-8). The value is
 * arbitrary; it is written as a number rather than as `1` so that a reader does
 * not mistake it for a placeholder that somebody meant to replace.
 */
export const DEFAULT_ROLL_SEED = 20_260_727

/**
 * Fold any number at all into the generator's legal state, `[1, MODULUS - 1]`.
 *
 * TOTAL. Zero is the generator's fixed point — `16807 * 0 mod m` is `0` forever —
 * so it is mapped to `1` rather than accepted, and a seed that is not a number
 * lands on the same value instead of poisoning every roll after it with `NaN`.
 * That is the inert direction and it is the one `./mob/mob-drop`'s `clampRoll`
 * takes for the same reason: the preview's finding F5 is a non-number travelling
 * through arithmetic that had no opinion about it.
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
 * Draw `count` rolls in order.
 *
 * A count of zero draws nothing, advances nothing and allocates nothing — the
 * shared empty array — because the common case on the frame path is a sweep in
 * which nothing died. Drawing "just in case" would make the sequence depend on
 * how many mobs existed rather than on what happened to them, and a scenario
 * that spawns one extra pig would then get different gunpowder.
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
