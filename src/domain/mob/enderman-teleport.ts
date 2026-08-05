/**
 * ONE RULE, ONE FILE (DN-GP-9): when an enderman teleports, and how far it goes.
 *
 * Ported from `<reference-impl>/packages/entity/domain/mob/enderman-teleport.ts`
 * — every constant and every comparison below is that file's, and its oracle
 * (`<reference-impl>/packages/entity/test/enderman-teleport.test.ts`) is what
 * `test/mob.test.ts` enumerates. docs/porting.md §4: move the tests first, do not
 * reinvent the specification.
 *
 * plan.md §3.11 names this as the second of four mob behaviours 「クリーパー起爆・
 * エンダーマンテレポート・シュルカー・ドラゴン」. `./creeper-fuse` was the first
 * because it is a state machine with a timer; this is the second because it is a
 * DECISION WITH NO STATE AT ALL — the whole of it is "should it, and to where",
 * and both halves are total functions of numbers somebody else measured.
 *
 * ---------------------------------------------------------------------------
 * Deciding WHERE is a rule. Moving there is not — and the reference proves it
 * ---------------------------------------------------------------------------
 *
 * `./explosion`'s header refuses to carry a position on the grounds that a
 * coordinate vocabulary is not this repository's. The same refusal here would
 * normally cost the interesting half of the rule, because a teleport is a
 * position. It does not, and the reason is a discovery about the reference
 * rather than a concession:
 *
 *     computeEndermanTeleportTarget(_position, targetPosition, randomAttempts)
 *                                   ^^^^^^^^^
 *
 * The enderman's OWN position is unused (`enderman-teleport.ts:28`, underscored
 * by its author). Every candidate is built as `targetPosition + offset`
 * (:37-41) and then validated by measuring it back against `targetPosition`
 * (:43, `isValidTeleportTarget`), so the distance the rule tests is exactly the
 * magnitude of the offset it just generated. The position cancels.
 *
 * What is left when it cancels is this file: a function from rolls to an OFFSET
 * IN BLOCKS. The host adds it to whichever position it anchored on and has lost
 * nothing — the reference's own oracle asserts `{x: 116, y: 64, z: -20}` for an
 * anchor of `{x: 100, y: 64, z: -20}` and rolls `[0.75, 0.5]`
 * (`test/enderman-teleport.test.ts:22-26`), which is this file's
 * `{ xBlocks: 16, zBlocks: 0 }` plus that anchor, digit for digit.
 *
 * ---------------------------------------------------------------------------
 * The anchor is part of the answer, because the reference gets it wrong quietly
 * ---------------------------------------------------------------------------
 *
 * The reference calls `computeEndermanTeleportTarget` from two places and passes
 * a DIFFERENT anchor to each:
 *
 *   damaged  `entity-manager-damage-enderman.ts:16-20` anchors on the enderman
 *            (`entity.position` twice) — it jumps 8-32 blocks away from where it
 *            was standing. An escape.
 *   chasing  `entity-manager-ai-enderman-teleport.ts:30-34` anchors on the
 *            PLAYER (`ctx.playerPosition`) — it jumps to 8-32 blocks from you,
 *            from however far away it was. A free approach, not an escape.
 *
 * Nothing in the reference records that those are different, because the
 * argument that decides it is the one the function ignores. Rename the second
 * parameter and the enderman's behaviour changes with no test to notice. Here
 * the anchor is a FIELD OF THE VERDICT, chosen by the reason, so the two call
 * sites become two branches of one rule that a reader can see disagreeing.
 *
 * ---------------------------------------------------------------------------
 * There is no vertical component, and that is recorded rather than repaired
 * ---------------------------------------------------------------------------
 *
 * `enderman-teleport.ts:39` copies `targetPosition.y` into the candidate. The
 * teleport is purely horizontal RELATIVE TO THE ANCHOR, and no code anywhere in
 * the reference asks whether the destination is inside a block, above a drop, or
 * in lava. An enderman that teleports to the player's anchor therefore arrives
 * at the PLAYER's altitude, 8 to 32 blocks away — which on any terrain at all is
 * usually underground or in mid-air.
 *
 * This file returns a HORIZONTAL OFFSET and says nothing about `y`, which is the
 * honest shape: a host that can ask mc-worldgen for a surface has everything it
 * needs, and a host that cannot is not handed a `y` this rule invented. The
 * ground check itself is a `ChunkStoreApi` question and is on the arena's
 * missing list with that destination.
 *
 * ---------------------------------------------------------------------------
 * What the reference does NOT gate this on
 * ---------------------------------------------------------------------------
 *
 * Vanilla endermen teleport out of water and rain, teleport in daylight, and
 * teleport when a player looks at them. The reference has exactly ONE of those
 * (the look, and it is anger rather than teleport — `enderman-anger.ts`), and
 * its teleport rule has none: the triggers below are damage, being stuck, and a
 * per-frame chance while chasing, and that is the whole list.
 *
 * Water and daylight are not added here. Both would need a fact this rule cannot
 * get honestly — the block at the enderman's own cell (a kernel capability
 * question this repository has no flag for; `../chunk-store-port` has
 * `isReplaceable` and `validSpawnSurface`, and neither means "submerged") and
 * the SKY light at it (mc-worldgen's grid, distinct from the block light
 * `./hostile-spawn` already takes). Inventing either would be inventing a
 * measurement, so they are on the arena's missing list with those destinations.
 */

/**
 * Nearest a teleport may land to its anchor, in blocks.
 *
 * `<reference-impl>/packages/entity/domain/mob/enderman-teleport.ts:3`.
 * INCLUSIVE: the test is `distance >= TELEPORT_MIN_RANGE` (:24).
 */
export const ENDERMAN_TELEPORT_MIN_BLOCKS = 8

/**
 * Furthest, in blocks. `enderman-teleport.ts:4`, and also INCLUSIVE (:24).
 *
 * It is used twice: as the acceptance bound, and as the half-width of the square
 * the offsets are drawn from (:13-14, `roll * MAX * 2 - MAX`). The two uses being
 * the same constant is why roughly a quarter of all attempts are rejected — the
 * corners of a 64-block square lie outside a 32-block circle — and why the rule
 * needs sixteen tries rather than one.
 */
export const ENDERMAN_TELEPORT_MAX_BLOCKS = 32

/** How many offsets are tried before giving up. `enderman-teleport.ts:5`. */
export const ENDERMAN_TELEPORT_ATTEMPTS = 16

/**
 * Chance a HURT enderman teleports away. `enderman-teleport.ts:7`, strict `<`.
 *
 * In the reference this number never runs: its only damage-side caller is
 * `entity-manager-damage-enderman.ts:14`, which passes a hard-coded roll of `0`,
 * and `0 < 0.3` is always true. A damaged enderman there teleports EVERY time,
 * and the 30% is documentation of an intention rather than a behaviour. See
 * `test/mob.test.ts`, which pins the boundary this file restores.
 */
export const ENDERMAN_DAMAGE_TELEPORT_CHANCE = 0.3

/**
 * Chance a chasing enderman teleports on any given frame.
 * `enderman-teleport.ts:8`, strict `<`.
 */
export const ENDERMAN_CHASE_TELEPORT_CHANCE = 0.05

/**
 * Frames of being stuck after which it teleports unconditionally.
 * `enderman-teleport.ts:9`, and the comparison is STRICTLY GREATER (:55) — its
 * oracle pins 40 as no and 41 as yes (`test/enderman-teleport.test.ts:56-59`).
 *
 * FRAMES, not seconds, and that is the reference's and not a translation. It is
 * the one number in `domain/mob/` that is frame-rate dependent: `./creeper-fuse`
 * takes a `DeltaTimeSecs` precisely so that 1.5 seconds means 1.5 seconds on any
 * machine, while forty of the host's frames are two seconds at 20 Hz and a
 * quarter of a second at 144. Converting it would need this repository to know
 * the host's cadence, which it does not and must not; porting it unchanged at
 * least keeps the divergence visible in the name.
 */
export const ENDERMAN_STUCK_TELEPORT_TICKS = 40

/**
 * What a teleport is measured FROM.
 *
 * `self` is an escape — 8 to 32 blocks from where the enderman stands. `target`
 * is an approach — 8 to 32 blocks from the player, from any starting distance
 * whatsoever. The reference uses one of each and records neither; see the module
 * header.
 */
export type TeleportAnchor = 'self' | 'target'

/** Why it wants to go, which is also what it is running from or towards. */
export type TeleportReason =
  /** It was hit this step. `enderman-teleport.ts:54`. */
  | 'damaged'
  /** It has been unable to move for too long. `:55`. */
  | 'stuck'
  /** Nothing in particular — the per-frame chase roll. `:56`. */
  | 'restless'
  /** Water harms endermen, so an immersed one immediately seeks dry ground. */
  | 'water'
  /** Direct daylight is another environmental escape trigger. */
  | 'daylight'

export type EndermanTeleportUrge =
  | { readonly _tag: 'Stay' }
  | {
      readonly _tag: 'Teleport'
      readonly reason: TeleportReason
      readonly anchor: TeleportAnchor
    }

const STAY: EndermanTeleportUrge = { _tag: 'Stay' }

/**
 * What this rule is allowed to know, and nothing more.
 *
 * Three fields, all somebody else's: whether a blow landed (mc-sim's combat
 * lane), how long it has been wedged (mc-sim's `stuckTicks`, which it already
 * keeps — `entity-manager-ai-enderman-teleport.ts:25,52`), and one number in
 * `[0, 1)`. As in `./mob-drop`, THE ROLL IS A PARAMETER: there is no
 * `Math.random()` in `domain/`, and `test/mob.test.ts` asserts that by reading
 * these sources.
 */
export type EndermanSenses = {
  readonly damagedThisStep: boolean
  /** Consecutive host frames it has failed to move. */
  readonly stuckTicks: number
  /** One roll in `[0, 1)`. */
  readonly roll: number
  /** Optional world senses; omitted by hosts that cannot observe the environment. */
  readonly inWater?: boolean
  readonly exposedToDaylight?: boolean
}

/**
 * Should it go, and from where?
 *
 * TOTAL. A roll that is not a number fails every threshold (`NaN < 0.3` is
 * `false`) and a `stuckTicks` that is not a number fails the stuck test, so a
 * broken measurement leaves the enderman where it is — the inert direction, and
 * the one that cannot teleport a mob on top of a player by accident.
 *
 * DAMAGE SHORT-CIRCUITS. A hurt enderman that fails its 30% roll answers `Stay`
 * even if it has been stuck for a hundred frames: `enderman-teleport.ts:54`
 * returns from the damage branch rather than falling through, and its oracle
 * asserts exactly that with `shouldEndermanTeleport(true, 100, 0.3) === false`
 * (`test/enderman-teleport.test.ts:53`). Worth pinning, because collapsing the
 * three branches into one `||` reads better and is a different rule.
 */
export const endermanTeleportUrge = (senses: EndermanSenses): EndermanTeleportUrge => {
  if (senses.damagedThisStep) {
    // Away from ITSELF: this is the flinch, and the reference anchors it on
    // `entity.position` (`entity-manager-damage-enderman.ts:16-18`).
    return senses.roll < ENDERMAN_DAMAGE_TELEPORT_CHANCE
      ? { _tag: 'Teleport', reason: 'damaged', anchor: 'self' }
      : STAY
  }

  if (senses.inWater === true) {
    return { _tag: 'Teleport', reason: 'water', anchor: 'self' }
  }

  if (senses.exposedToDaylight === true) {
    return { _tag: 'Teleport', reason: 'daylight', anchor: 'self' }
  }

  if (senses.stuckTicks > ENDERMAN_STUCK_TELEPORT_TICKS) {
    return { _tag: 'Teleport', reason: 'stuck', anchor: 'target' }
  }

  return senses.roll < ENDERMAN_CHASE_TELEPORT_CHANCE
    ? { _tag: 'Teleport', reason: 'restless', anchor: 'target' }
    : STAY
}

/**
 * Where it lands, as a displacement from the anchor. No `y` — see the header.
 */
export type TeleportOffset = {
  readonly xBlocks: number
  readonly zBlocks: number
}

/**
 * One roll to one axis. `enderman-teleport.ts:13-14`, unchanged:
 * `clamp(roll) * 32 * 2 - 32`, so `0` is -32 blocks, `0.5` is 0 and `1` is +32.
 *
 * `undefined` for a roll that is not a number. The reference instead runs it
 * through `Math.max(0, Math.min(1, value))` (:11), which is total but not inert:
 * `Math.min(1, Infinity)` is `1`, so an infinite roll from a broken generator
 * becomes a legal offset of exactly +32 blocks — the LONGEST teleport the rule
 * can produce. That is the preview's finding F5 shape once more (a non-number
 * travelling through arithmetic with no opinion about it), and the direction it
 * fails in is the wrong one. Here a roll that is not a number fails its attempt.
 */
const offsetFromRoll = (roll: number | undefined): number | undefined =>
  roll === undefined || !Number.isFinite(roll)
    ? undefined
    : Math.max(0, Math.min(1, roll)) * ENDERMAN_TELEPORT_MAX_BLOCKS * 2 -
      ENDERMAN_TELEPORT_MAX_BLOCKS

/**
 * The reference's acceptance test (`enderman-teleport.ts:22-25`), in offsets.
 * Both bounds inclusive.
 */
const withinTeleportBand = (xBlocks: number, zBlocks: number): boolean => {
  const distance = Math.hypot(xBlocks, zBlocks)

  return (
    distance >= ENDERMAN_TELEPORT_MIN_BLOCKS && distance <= ENDERMAN_TELEPORT_MAX_BLOCKS
  )
}

/**
 * The first offset out of sixteen tries that lands in the band, or `undefined`.
 *
 * `rolls` is read two at a time — `rolls[2n]` is the x roll of attempt `n` and
 * `rolls[2n + 1]` its z roll (`enderman-teleport.ts:33-34`) — so a full search
 * wants 32 of them. RUNNING OUT ENDS THE SEARCH: the reference returns `null` the
 * moment either index is missing (:35) rather than treating a short array as
 * sixteen failures, and its oracle drives that with a two-element array
 * (`test/enderman-teleport.test.ts:23`).
 *
 * `undefined` means IT STAYS PUT. Sixteen offsets can all miss — every roll pair
 * near `(0.5, 0.5)` puts the candidate on top of the anchor — and the reference's
 * own oracle pins the all-`0.5` case as no teleport at all (:34-38). A rule that
 * always found somewhere would have to widen the band to do it.
 *
 * TOTAL and deterministic: the same rolls always give the same offset.
 */
export const endermanTeleportOffset = (
  rolls: ReadonlyArray<number>,
): TeleportOffset | undefined => {
  for (let attempt = 0; attempt < ENDERMAN_TELEPORT_ATTEMPTS; attempt += 1) {
    const xRoll = rolls[attempt * 2]
    const zRoll = rolls[attempt * 2 + 1]

    // Out of rolls. Not "no valid offset" — the caller did not supply enough to
    // find out, and saying so is the reference's behaviour as well as the honest
    // one.
    if (xRoll === undefined || zRoll === undefined) {
      return undefined
    }

    const xBlocks = offsetFromRoll(xRoll)
    const zBlocks = offsetFromRoll(zRoll)

    if (xBlocks !== undefined && zBlocks !== undefined && withinTeleportBand(xBlocks, zBlocks)) {
      return { xBlocks, zBlocks }
    }
  }

  return undefined
}

/** An integer block position used by the loaded-world teleport snapshot. */
export type EndermanTeleportPosition = {
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * One observed cell. Absence is deliberately different from air: it means the
 * candidate crosses a load boundary and must be refused.
 */
export type EndermanTeleportCell = {
  readonly position: EndermanTeleportPosition
  readonly block: string
  readonly solid: boolean
}

/** Every geometrically valid landing, preserving the rule's deterministic order. */
export const endermanTeleportCandidates = (
  current: EndermanTeleportPosition,
  anchor: EndermanTeleportPosition,
  rolls: ReadonlyArray<number>,
): ReadonlyArray<EndermanTeleportPosition> => {
  const candidates: Array<EndermanTeleportPosition> = []

  for (let attempt = 0; attempt < ENDERMAN_TELEPORT_ATTEMPTS; attempt += 1) {
    const xBlocks = offsetFromRoll(rolls[attempt * 2])
    const zBlocks = offsetFromRoll(rolls[attempt * 2 + 1])
    if (xBlocks === undefined || zBlocks === undefined) break
    if (!withinTeleportBand(xBlocks, zBlocks)) continue
    candidates.push({ x: anchor.x + xBlocks, y: current.y, z: anchor.z + zBlocks })
  }

  return candidates
}

/** The floor and body cells needed to decide every candidate in one world snapshot. */
export const endermanTeleportCandidateCells = (
  current: EndermanTeleportPosition,
  anchor: EndermanTeleportPosition,
  rolls: ReadonlyArray<number>,
): ReadonlyArray<EndermanTeleportPosition> =>
  endermanTeleportCandidates(current, anchor, rolls).flatMap((destination) => [
    { ...destination, y: destination.y - 1 },
    destination,
    { ...destination, y: destination.y + 1 },
  ])

const DANGEROUS_TELEPORT_BLOCKS = new Set([
  'water',
  'lava',
  'fire',
  'cactus',
  'magma_block',
  'campfire',
  'sweet_berry_bush',
])

const positionKey = (position: EndermanTeleportPosition): string =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

/**
 * Finds the first safe destination in roll order. All three cells must be in
 * the caller's loaded snapshot: solid safe floor, then two blocks of air.
 * Failure returns `current` by identity, making a rejected teleport inert.
 */
export const resolveSafeEndermanTeleport = (
  current: EndermanTeleportPosition,
  anchor: EndermanTeleportPosition,
  rolls: ReadonlyArray<number>,
  cells: ReadonlyArray<EndermanTeleportCell>,
): EndermanTeleportPosition => {
  const cellByPosition = new Map(cells.map((cell) => [positionKey(cell.position), cell]))

  for (const destination of endermanTeleportCandidates(current, anchor, rolls)) {
    const floor = cellByPosition.get(positionKey({ ...destination, y: destination.y - 1 }))
    const feet = cellByPosition.get(positionKey(destination))
    const head = cellByPosition.get(positionKey({ ...destination, y: destination.y + 1 }))
    const safeFloor =
      floor !== undefined && floor.solid && !DANGEROUS_TELEPORT_BLOCKS.has(floor.block)
    const clearBody =
      feet?.block === 'air' &&
      head?.block === 'air' &&
      !DANGEROUS_TELEPORT_BLOCKS.has(feet.block) &&
      !DANGEROUS_TELEPORT_BLOCKS.has(head.block)

    if (safeFloor && clearBody) return destination
  }

  return current
}
