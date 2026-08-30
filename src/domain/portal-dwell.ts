/**
 * WHEN a portal fires. Four seconds of standing in it, then four before it may
 * fire again.
 *
 * This is plan.md §3.11's 「遷移の**発火**」 — the clause that names the moment,
 * as distinct from 「ポータル成立条件」 (the obsidian frame, which is
 * mc-worldgen's `domain/portal-frame.ts` and this repository's mirror of it) and
 * as distinct from where the traveller comes out (mc-worldgen's
 * `domain/nether-travel.ts`). It is a TIMER: two durations and a state machine
 * over them, holding no coordinate and naming no entity.
 *
 * ---------------------------------------------------------------------------
 * What this file is the other half of, and what it deliberately stops short of
 * ---------------------------------------------------------------------------
 *
 * `docs/testing.md` §3-1 records the reference's `physics-stage-portal.ts` as
 * ⬜ 「mc-sim の名簿と次元サービス待ち」. That file does three things and only one
 * of them was ever waiting:
 *
 *   THE DWELL AND THE COOLDOWN — `PORTAL_ACTIVATION_SECS` and
 *   `PORTAL_REENTRY_COOLDOWN_SECS` and the arithmetic over them. THIS FILE.
 *   Nothing in it is a roster: it takes a boolean saying whether the traveller
 *   is standing in a portal block and a frame delta, and answers whether to
 *   travel. `stepCreeperFuse` in `./mob/creeper-fuse.ts` has the same shape,
 *   takes the same brand, and was never thought to need mc-sim.
 *
 *   WHERE THE TRAVELLER COMES OUT — the 8:1 scaling, the search for an existing
 *   portal, the layout to build when there is none. mc-worldgen's
 *   `domain/nether-link.ts` and `domain/nether-travel.ts`, landed alongside this
 *   file. Also not a roster; also never waiting.
 *
 *   PUTTING THE TRAVELLER THERE — genuinely blocked, and NOT on the thing the
 *   row names. See `stepPortalDwell`'s note, which names the two missing symbols
 *   rather than a category.
 *
 * ---------------------------------------------------------------------------
 * Why a tagged state and not the reference's two `Ref`s
 * ---------------------------------------------------------------------------
 *
 * The reference holds `portalSecsRef` and `portalCooldownSecsRef`
 * (`packages/app/application/frame/stages/physics-stage-portal.ts:35-38`), two
 * numbers whose four combinations encode three states — and the fourth, a
 * cooldown running WHILE a dwell accumulates, is unreachable only because the
 * cooldown branch returns early. A pair of numbers cannot say that; a union can,
 * and `./mob/creeper-fuse.ts` already made this call for the fuse for the same
 * reason: 「exactly once」 becomes a property of the machine rather than of the
 * order in which a caller happens to read two refs.
 *
 * The states are also what a host would have to save, and the answer is that it
 * would not: a dwell is scratch, like `../domain/frame-rolls`' seed and unlike
 * `timeOfDaySecs`. A reload that drops it costs the traveller the four seconds
 * they had already stood there, and no saved noun disagrees with anything.
 *
 * ---------------------------------------------------------------------------
 * The two constants, and the fact that neither is justified
 * ---------------------------------------------------------------------------
 *
 * BOTH ARE TRANSCRIBED AND NEITHER IS JUSTIFIED, in the sense mc-worldgen's
 * `domain/portal-frame.ts` bounds note defines and `docs/testing.md` §4-b asks
 * for. They are the reference's literals at
 * `packages/app/application/frame/stages/physics-stage-portal.ts:10` and `:11`.
 * I could not derive either from anything in the reference implementation or in
 * this repository, and a recollection of the vanilla survival delay is not a
 * derivation.
 *
 * What CAN be said precisely is thinner than the numbers and is the part worth
 * writing down:
 *
 *   THEY ARE EQUAL IN THE REFERENCE, AND THAT IS NOT LOAD-BEARING. Two separate
 *   constants that happen to hold 4.0 is what the reference declares, and
 *   nothing in the arithmetic requires them to agree. They are kept separate
 *   here so that changing one does not silently change the other — the same call
 *   `./day-night.ts` makes by keeping `TWILIGHT_BAND` out of `isNight`.
 *
 *   THE ACTIVATION DELAY MUST BE POSITIVE OR THE PORTAL IS INSTANT. A zero would
 *   make `stepPortalDwell` fire on the first frame a traveller touches the
 *   block, which is a different rule, not a faster one.
 *
 *   THE COOLDOWN MUST BE POSITIVE OR TRAVEL OSCILLATES. Arriving inside the
 *   destination portal means standing in a portal block on the very next frame;
 *   without a cooldown the traveller bounces between dimensions every four
 *   seconds forever. THIS is why the cooldown exists at all, and it is the one
 *   thing about these two numbers that is an argument rather than a citation.
 *
 * `test/portal-dwell.test.ts` asserts `> 0` on both rather than `=== 4`, so that
 * correcting a transcribed number is not a test edit — the same convention
 * mc-worldgen's `test/portal-frame.test.ts` uses for its two unjustified bounds.
 */
import type { DeltaTimeSecs } from '@nerima-games/mc-kernel'

/**
 * How long a traveller must stand in a portal block before it fires.
 *
 * `physics-stage-portal.ts:10`. Transcribed, not justified — see the header.
 */
export const PORTAL_ACTIVATION_SECS = 4.0

/**
 * How long after arriving a portal refuses to fire again.
 *
 * `physics-stage-portal.ts:11`. Transcribed, not justified — but see the header
 * on why a cooldown of SOME length is required rather than merely pleasant.
 */
export const PORTAL_REENTRY_COOLDOWN_SECS = 4.0

/**
 * Where a traveller is in the four-second wait.
 *
 * Three states, against the reference's two numbers. `Cooling` never holds a
 * dwell and `Standing` never holds a cooldown, which is the combination the
 * reference's early return makes unreachable and this type makes unwritable.
 */
export type PortalDwell =
  /** Not standing in a portal, and not just arrived from one. */
  | { readonly _tag: 'Outside' }
  /** Standing in a portal, `dwelledSecs` into the wait. */
  | { readonly _tag: 'Standing'; readonly dwelledSecs: number }
  /** Just travelled; the portal will not fire again for `remainingSecs`. */
  | { readonly _tag: 'Cooling'; readonly remainingSecs: number }

/** The state a traveller who has never been near a portal is in. */
export const OUTSIDE_PORTAL: PortalDwell = { _tag: 'Outside' }

/** One frame of the wait. */
export type PortalDwellStep = {
  readonly dwell: PortalDwell
  /**
   * Did the portal fire on this frame?
   *
   * A BOOLEAN AND NOT A DESTINATION, deliberately. Nothing in this file knows
   * where the traveller is, so it cannot say where they come out — that is
   * mc-worldgen's `resolveNetherTravel`, and the caller that owns a position
   * calls it. Returning a coordinate here would mean this rule had acquired one,
   * which is the boundary the whole file is arranged around.
   *
   * True on EXACTLY ONE frame per crossing: the step that produces it also moves
   * the state to `Cooling`, and `Cooling` cannot produce another. That is the
   * same 「exactly once」 property `./mob/creeper-fuse.ts` gets from making
   * `Detonated` terminal.
   */
  readonly travels: boolean
}

/**
 * Begin or continue a dwell, and fire if it has reached the threshold.
 *
 * `>=` and OVERSHOOT COUNTS, transcribed from `physics-stage-portal.ts:50`: a
 * frame long enough to skip past four seconds fires on that frame rather than
 * deferring to the next. `./mob/creeper-fuse.ts` transcribes the same decision
 * from the same reference for the same reason — a lag spike must not change what
 * the rules do.
 */
const dwell = (dwelledSecs: number): PortalDwellStep =>
  dwelledSecs >= PORTAL_ACTIVATION_SECS
    ? { dwell: { _tag: 'Cooling', remainingSecs: PORTAL_REENTRY_COOLDOWN_SECS }, travels: true }
    : { dwell: { _tag: 'Standing', dwelledSecs }, travels: false }

/**
 * Advance one traveller's portal timer by one frame.
 *
 * TOTAL and pure. The same three arguments always produce the same step, so
 * `test/portal-dwell.test.ts` enumerates the machine rather than sampling it —
 * and there is no clock in it, which `pnpm check:deps` enforces (DN-GP-8) and
 * which plan.md §5.1-3 makes the precondition for using the reference's numbers
 * as an oracle at all.
 *
 * `inPortal` is a BOOLEAN because answering it needs a position and a block
 * read, and this repository can do only the second: `./chunk-window.ts` turns an
 * `Effect`-shaped store into the synchronous accessor a caller needs, and the
 * position it must be given belongs to mc-sim. Taking the answer rather than
 * computing it is the same injection `./mob/creeper-fuse.ts` uses for
 * `distanceToTargetBlocks` — 「a MEASUREMENT mc-sim takes, not a quantity this
 * repository owns」.
 *
 * `dt = 0` is legal and ADVANCES NOTHING rather than being rejected: a frame may
 * be scheduled twice inside one clock tick (kernel's `domain/quantities.ts`), and a dwell
 * that accrued on a zero delta would fire sooner on a faster machine.
 *
 * ---------------------------------------------------------------------------
 * WHAT A CALLER STILL CANNOT DO WITH A `travels: true`, NAMED
 * ---------------------------------------------------------------------------
 *
 * `docs/testing.md` §3-1 says the missing thing is 「mc-sim の名簿」. It is not,
 * and the correction is worth having in the code rather than only in the
 * document, because the roster is the fifth category in this repository to have
 * been named as a blocker and then not been one.
 *
 * MOVING THE TRAVELLER IS NOT MISSING. The reference does not touch the roster
 * to move a player — it calls `gameState.respawn(plan.destination)`
 * (`physics-stage-portal.ts:63`), and mc-sim's equivalent EXISTS AND IS
 * PUBLISHED: `PlayerServiceApi.moveTo(feetPosition: Position): Effect<void>`,
 * `mc-sim/application/player-service.ts:25`, re-exported from mc-sim's barrel at
 * `index.ts:40`. What this repository lacks is a MIRROR of that service — it
 * mirrors `EntityManager` and `InventoryService` and not `PlayerService` — which
 * is a file nobody has written, not a method nobody has.
 *
 * WHAT IS GENUINELY MISSING IS THE DIMENSION, and it is missing everywhere. The
 * reference's crossing sets it three times over
 * (`physics-stage-portal.ts:59-61`): `netherService.setDimension`,
 * `chunkManagerService.setActiveDimension`, `entityManager.setActiveDimension`.
 * Measured across the workspace, none of those exists and neither does the noun
 * they carry:
 *
 *   - `grep -rn "Dimension" mc-kernel/domain/*.ts` returns nothing. There is no
 *     kernel vocabulary for which world a thing is in, so `Dimension` is a word
 *     this organisation has not agreed on — mc-worldgen's
 *     `domain/nether-travel.ts` declares one PROVISIONALLY and keeps it off its
 *     own barrel for exactly that reason.
 *   - `grep -rn "setActiveDimension\|activeDimension" mc-sim` returns nothing.
 *     `EntityManagerApi<S>` has ten members and not one of them names a world.
 *   - There is no `NetherService` anywhere, so 「どの次元に居るのか」 and 「その
 *     次元にどんなポータルがあるか」 have no owner. mc-worldgen's
 *     `docs/responsibility.md` §6 already flagged the second half of that when it
 *     placed `findNearestPortal`: the search takes its candidates as a PARAMETER
 *     precisely because 「『世界に存在するポータルの一覧』を所有するのが誰かは
 *     別問題で、それはまだ誰にも割り当てられていない」.
 *
 * So the row is a MISSING NOUN with no owner, not a service someone else has
 * already built. It is an ownership decision — plausibly mc-kernel's, on the
 * grounds that make it the owner of `BlockType` — and until it is made, a
 * `travels: true` has nowhere to travel to.
 */
export const stepPortalDwell = (
  current: PortalDwell,
  inPortal: boolean,
  dt: DeltaTimeSecs,
): PortalDwellStep => {
  switch (current._tag) {
    // The cooldown is checked FIRST and does not consult `inPortal`, which is
    // the reference's early return (`physics-stage-portal.ts:36-40`) and not an
    // omission: a traveller arrives standing inside the destination portal, so a
    // cooldown that let a dwell accrue underneath it would fire again the
    // instant it expired. The frame on which the cooldown reaches zero accrues
    // nothing; the next one may begin a dwell.
    case 'Cooling': {
      // ONE guard and not two. This read `Math.max(0, ...)` and then asked
      // `> 0` below, which is the same question twice: a clamped zero and a
      // negative both leave through the same arm, so no input could tell the
      // two spellings apart and no mutation of the clamp could be killed. The
      // ternary is where the decision actually is, so the clamp is gone rather
      // than left as unfalsifiable reassurance.
      const remainingSecs = current.remainingSecs - dt

      return { dwell: remainingSecs > 0 ? { _tag: 'Cooling', remainingSecs } : OUTSIDE_PORTAL, travels: false }
    }

    // Entering and dwelling are ONE step, not two. The reference adds `deltaTime`
    // to a dwell of zero on the very frame it finds the traveller in the block
    // (`physics-stage-portal.ts:47-49`); splitting them would cost a frame on
    // every crossing and diverge from the numbers this file is ported from.
    case 'Outside': {
      return inPortal ? dwell(dt) : { dwell: current, travels: false }
    }

    // Stepping out FORGETS the wait entirely rather than draining it —
    // `physics-stage-portal.ts:99` sets the ref to 0. The same shape as a
    // creeper's fuse going out, and a decision rather than an omission: a
    // traveller who steps out at 3.9 seconds starts again from zero.
    case 'Standing': {
      return inPortal ? dwell(current.dwelledSecs + dt) : { dwell: OUTSIDE_PORTAL, travels: false }
    }

    /* v8 ignore start -- exhaustiveness safety net over PortalDwell's `_tag` union
     * ('Outside' | 'Standing' | 'Cooling'), a closed union every case above already
     * covers; no input can reach this arm. */
    default: {
      const exhaustive: never = current
      return exhaustive
    }
    /* v8 ignore stop */
  }
}
