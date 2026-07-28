/**
 * ONE RULE, ONE FILE (DN-GP-9): what the player's buttons MEAN this frame.
 *
 * The first thing the interaction path does, and the only part of it that is
 * pure boolean algebra. Every other rule in this directory asks the world
 * something; this one asks nothing and answers ten questions from the frame's
 * own inputs.
 *
 * Ported from `interaction-stage-intent.ts`.
 *
 * ---------------------------------------------------------------------------
 * KEYED ON WHAT THE HELD ITEM CAN DO, NOT ON WHAT IT IS CALLED
 * ---------------------------------------------------------------------------
 *
 * The reference asks `selectedHotbarItem === 'SHIELD'` and `=== 'BOW'`.
 * **`../item-vocabulary.ts` has neither `bow` nor `shield`** — nor `arrow` —
 * so those two comparisons are unwritable here, and a rule keyed on the names
 * would have to wait for mc-kernel's vocabulary to grow.
 *
 * `./draw-bow` already hit this and already answered it, and this file takes
 * the same answer rather than inventing a second one. Its header:
 *
 *   「the rule needs to know how strongly the bow is enchanted, not what the bow
 *    is CALLED ... A rule keyed on the item's name would be unwritable today; a
 *    rule keyed on the item's PROPERTIES is writable, testable and complete.」
 *
 * So `HeldItemCapabilities` below carries two booleans and no name. The host
 * decides which items charge and which block; this file decides what holding
 * one and pressing a button means. That is the injected-predicate shape this
 * project has four other instances of (`transparentBlockIds`, `IsRailAt`,
 * `BlockAt`, `QuadTile`), and it is the reason this rule can land today.
 *
 * IT IS NOT A WORKAROUND. Even with the literals present, `'BOW'` is the wrong
 * key: a crossbow, a trident and a charged item added later all want
 * `shouldStartBowCharge`, and each would be another `||` in a condition that is
 * already the widest in the file.
 *
 * ---------------------------------------------------------------------------
 * `shouldClearBowCharge` DOES NOT MENTION `paused`, AND THAT IS THE REFERENCE'S
 * ---------------------------------------------------------------------------
 *
 * Eight of the ten outputs guard on `paused` or `isSpectator` or both. Two do
 * not: `shouldResetBreakProgress` and `shouldClearBowCharge`. Transcribed as
 * they are, because both are CLEANUP — they undo state rather than starting an
 * action, and a pause that stopped the cleanup would leave a half-drawn bow
 * charging across the pause and fire it on resume.
 *
 * That asymmetry looks like an oversight and is not, which is exactly why it is
 * written down here rather than tidied.
 */

/**
 * The 13 redstone placement and toggle inputs, as one record.
 *
 * MIRRORED IN SHAPE FROM the reference's `RedstoneFlags`, and kept whole rather
 * than reduced to a single `hasRedstoneInput` boolean at the boundary — the
 * caller has to distribute them to mx-redstone afterwards anyway, and a rule
 * that collapsed them here would make the frame ask twice.
 *
 * `Partial` is deliberate. The reference's own test fixture builds only 8 of
 * the 13 and the missing 5 read as `undefined` in its OR chain — falsy, so its
 * tests pass, and the fixture has been out of sync with the type for as long as
 * both have existed. Accepting a partial record makes that legal rather than
 * accidental, and `anyRedstoneInput` treats absent as false explicitly.
 */
export type RedstoneInputFlags = Partial<{
  readonly placeWire: boolean
  readonly placeLever: boolean
  readonly placeButton: boolean
  readonly placeTorch: boolean
  readonly placePiston: boolean
  readonly placeObserver: boolean
  readonly placeHopper: boolean
  readonly placeRepeater: boolean
  readonly placeComparator: boolean
  readonly placeDispenser: boolean
  readonly toggleLever: boolean
  readonly pressButton: boolean
  readonly toggleTorch: boolean
}>

/** Every flag name, so the fold below cannot miss one the type declares. */
export const REDSTONE_INPUT_FLAGS = [
  'placeWire',
  'placeLever',
  'placeButton',
  'placeTorch',
  'placePiston',
  'placeObserver',
  'placeHopper',
  'placeRepeater',
  'placeComparator',
  'placeDispenser',
  'toggleLever',
  'pressButton',
  'toggleTorch',
] as const

/**
 * Is any redstone input asserted?
 *
 * FOLDED OVER THE NAME LIST rather than written as a 13-term `||`. The
 * reference spells the chain out, and that is how its fixture came to be
 * missing five terms without anybody noticing: a chain has no length anybody
 * can check. `test/interaction-intent.test.ts` asserts every declared flag can
 * turn this on, one at a time, which a chain cannot be tested for.
 */
export const anyRedstoneInput = (flags: RedstoneInputFlags): boolean =>
  REDSTONE_INPUT_FLAGS.some((flag) => flags[flag] === true)

/**
 * What the held item can do. NO ITEM NAME. See the header.
 */
export type HeldItemCapabilities = {
  /** Draws over time and releases — a bow, and later a crossbow or trident. */
  readonly charges: boolean
  /** Held up to block — a shield. */
  readonly blocks: boolean
}

/** Empty hand, or an item that does neither. */
export const INERT_ITEM: HeldItemCapabilities = { charges: false, blocks: false }

/** The frame's inputs, as this rule needs them. */
export type InteractionSnapshot = {
  readonly paused: boolean
  readonly isSpectator: boolean
  readonly leftClick: boolean
  readonly mouseHeld: boolean
  readonly middleClick: boolean
  readonly rightClick: boolean
  readonly rightMouseHeld: boolean
  readonly redstoneFlags: RedstoneInputFlags
  /** Capabilities of the selected hotbar item. See `HeldItemCapabilities`. */
  readonly held: HeldItemCapabilities
  /** When the charge began, or `null` if nothing is charging. */
  readonly chargeStartedAtSecs: number | null
}

/** What the frame should do about it. */
export type InteractionIntent = {
  readonly hasRedstoneInput: boolean
  readonly canInteract: boolean
  readonly shouldResetBreakProgress: boolean
  readonly shouldResetBlocking: boolean
  readonly shouldReleaseCharge: boolean
  readonly shouldStartCharge: boolean
  readonly shouldClearCharge: boolean
  readonly shouldBlock: boolean
}

/**
 * Resolve one frame's intent.
 *
 * TOTAL AND ALLOCATION-FREE apart from the result. It reads eight booleans, a
 * flag record and a nullable number, and returns eight booleans; there is
 * nothing here that can fail and nothing that can be absent.
 */
export const resolveInteractionIntent = (snapshot: InteractionSnapshot): InteractionIntent => {
  const hasRedstoneInput = anyRedstoneInput(snapshot.redstoneFlags)
  const active = !snapshot.paused && !snapshot.isSpectator

  return {
    hasRedstoneInput,

    canInteract:
      active &&
      (snapshot.leftClick ||
        snapshot.mouseHeld ||
        snapshot.middleClick ||
        snapshot.rightClick ||
        snapshot.rightMouseHeld ||
        hasRedstoneInput),

    // CLEANUP, so no `paused` guard. See the header.
    shouldResetBreakProgress: !snapshot.mouseHeld,

    shouldResetBlocking: !snapshot.rightMouseHeld || snapshot.isSpectator,

    shouldReleaseCharge: active && !snapshot.rightMouseHeld && snapshot.chargeStartedAtSecs !== null,

    shouldStartCharge:
      snapshot.rightMouseHeld && snapshot.held.charges && snapshot.chargeStartedAtSecs === null,

    // CLEANUP, so no `paused` guard. See the header.
    shouldClearCharge: !snapshot.rightMouseHeld && !snapshot.held.charges,

    shouldBlock: snapshot.rightMouseHeld && snapshot.held.blocks,
  }
}
