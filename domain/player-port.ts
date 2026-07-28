/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-sim`'s `PlayerService`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * mc-sim is a legitimate `dependencies` edge for this repository (plan.md §2.1:
 * `gameplay --> sim`), so — exactly like `./entity-manager-port` and
 * `./inventory-port` — this mirror is not standing in for a forbidden import,
 * only for an unpublished one. plan.md §6 Step 3 publishes bottom-up and nothing
 * is on GitHub Packages yet, so `pnpm check:deps` would reject an import of a
 * package absent from `package.json#dependencies`.
 *
 * WHEN mc-sim IS PUBLISHED:
 *   1. add `@nerima-games/mc-sim` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './player-port'` at `'@nerima-games/mc-sim'`.
 *
 * It is NOT re-exported from `index.ts`, for the reason `./entity-manager-port`,
 * `./inventory-port` and `./chunk-store-port` are not: re-exporting another
 * repository's service would make deleting the stand-in a breaking change for
 * consumers of mx-gameplay.
 *
 * UNLIKE those three it is not visible through `api-lock.md` either, because
 * nothing in `stages/registration.ts` names it yet. That is not tidiness, it is
 * the state of the row this file was written for — see THE JOIN THIS DOES NOT
 * CLOSE below.
 *
 * ---------------------------------------------------------------------------
 * THE BLOCKER THIS FILE DISSOLVES, AND THE ONE IT DOES NOT
 * ---------------------------------------------------------------------------
 *
 * `docs/testing.md` §3-1's last ⬜ is the reference's `physics-stage-portal.ts`
 * APPLICATION — 「プレイヤーをそこへ置き、次元を切り替える」. It used to be
 * charged to 「mc-sim の名簿」, and `domain/portal-dwell.ts` already recorded that
 * as the FIFTH category named as a blocker in this repository and then found not
 * to be one: the reference does not touch the roster to move a player, it calls
 * `gameState.respawn(pos)` (`physics-stage-portal.ts:63`), and mc-sim's
 * equivalent exists and is published — `PlayerServiceApi.moveTo(feetPosition)`,
 * `mc-sim/application/player-service.ts:25`, on the barrel at `index.ts:40`.
 *
 * What was missing was this file, and only this file. It is now written.
 *
 * THAT DOES NOT MAKE THE ROW GREEN, and the remaining half is a REFUSAL THAT
 * HOLDS rather than a sixth category. It names a symbol, and the symbol does not
 * exist: see the note on `moveTo`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE COULD NOT BE WRITTEN BEFORE, AND WHAT CHANGED
 * ---------------------------------------------------------------------------
 *
 * `stages/registration.ts` declined it twice in as many words — 「`PlayerService`
 * .cameraPose` requires `ClockPort` and `domain/frame-contract.ts` names
 * restating `ClockPort` locally as 「a far worse failure than a narrower type」.
 * So the port that would carry it cannot be mirrored whole, and a narrow mirror
 * of a `Context.Tag` is the hazard `domain/chunk-store-port.ts` exists to
 * refuse」 — and said the same of `TimeService` for `timeOfDay`.
 *
 * That reasoning was sound given its premise and the premise was wrong.
 * `./frame-contract`'s clock section now carries the correction and mc-compose's
 * evidence for it: a `Context.Tag` built from kernel's textual key IS kernel's
 * service at runtime, which is the property `./chunk-store-port` and
 * `./inventory-port` already rely on for `ChunkStore` and `InventoryService`.
 * The mx-* refusal rested on utility rather than safety — mc-compose:
 * 「restating a `Context.Tag` they never construct would buy them nothing」 — and
 * `cameraPose` is what made it buy something.
 *
 * So the choice this file faced was never "name `ClockPort` or don't". It was
 * "name it, or ship a narrow mirror of a `Context.Tag`", and the second is the
 * hazard. `ClockPort` is named, in the kernel mirror where kernel's barrel can
 * replace it, and `cameraPose` below is transcribed whole.
 *
 * ---------------------------------------------------------------------------
 * Why the WHOLE api is mirrored when ONE member is what the row wanted
 * ---------------------------------------------------------------------------
 *
 * `./chunk-store-port`'s header states the rule and the reason: Effect resolves
 * Tags by their TEXTUAL KEY, so a `Layer` built against a narrow mirror
 * satisfies the wide Tag and every omitted method reads `undefined` in a
 * repository that never saw this file. A narrower mirror is not "less of the
 * vocabulary", it is a silent runtime hazard. All six members are here — and
 * today NONE of them is called, which makes this the first mirror in the
 * repository whose completeness is its entire content.
 *
 * `PlayerService` is a `Context.Tag` CLASS, like `ChunkStore` and
 * `InventoryService` and unlike `./entity-manager-port`'s `EntityManager`: the
 * service value type carries no parameter, so mc-sim declares it as a class and
 * so does this. That brings the nominal hazard — mc-sim's copy and this one are
 * two nominal types denoting one service, and the shape can drift where
 * TypeScript cannot see it, which is what the two-direction assignment in
 * `test/player-mirror.test.ts` is for.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS RENAMED, and two symbols are imported rather than declared
 * ---------------------------------------------------------------------------
 *
 * A mirror that renames a symbol typechecks, passes every local test, and yields
 * a name that does not exist on repoint day. Every type below carries mc-sim's
 * spelling. `PlayerPose` did not collide with a local name, so the rule that a
 * collision moves the LOCAL name was not needed.
 *
 * `CameraPoseSnapshot` and `ClockPort` come from `./frame-contract`, and the
 * test is the one `./chunk-store-port` records: WHOSE BARREL REPLACES THE
 * SYMBOL. Both are mc-KERNEL's, and mc-sim's barrel deliberately does not
 * re-export its own kernel mirror — so neither comes back from
 * `@nerima-games/mc-sim` on the day this file dies. Both come back from
 * `@nerima-games/mc-kernel`, which is the barrel `./frame-contract` is replaced
 * by. Declaring them here would be the defect `./chunk-store-port`'s header
 * records: symbols sitting in a mirror whose source did not have them, under a
 * header promising a repoint that would have deleted them.
 *
 * `Position` is imported for the same reason and from the WRONG FILE, and that
 * is a defect this change inherits rather than introduces —
 * `./frame-contract`'s import note names it and says why it is not fixed here.
 *
 * `PlayerPose` IS declared below, and the same test says why that is right
 * rather than inconsistent: it is `mc-sim/domain/camera-pose.ts`, mc-sim's own
 * module, and mc-sim's barrel DOES re-export it (`index.ts:24`,
 * `export * from './domain/camera-pose'`).
 *
 * ---------------------------------------------------------------------------
 * What is NOT mirrored, and why that is not a narrowing
 * ---------------------------------------------------------------------------
 *
 * `mc-sim/domain/camera-pose.ts` also exports the PURE functions and constants
 * over these values — `PITCH_EPSILON`, `PITCH_MAX_RADIANS`, `PITCH_MIN_RADIANS`,
 * `EYE_LEVEL_OFFSET`, `INITIAL_PLAYER_POSE`, `clampPitch`, `applyLook`,
 * `withFeetPosition`, `cameraPoseOf`, `forwardVector`, `snapshotAgeSecs` — and
 * none of them is here. This is `./entity-manager-port`'s argument unchanged:
 * they carry no Tag, so they carry none of the hazard above. A function absent
 * from a mirror is a compile error at its call site, never an `undefined` at run
 * time.
 *
 * `makePlayerService` and `PlayerServiceLayer` are absent for a second reason on
 * top of that one: this repository CONSUMES the tag and must never provide it. A
 * layer constructor here would be an invitation to build a second authority for
 * the player's pose, which is the inversion `mc-sim/domain/camera-pose.ts`
 * exists to prevent.
 *
 * ---------------------------------------------------------------------------
 * THE JOIN THIS DOES NOT CLOSE, and the exact member that is missing
 * ---------------------------------------------------------------------------
 *
 * With this file present the three parts of a portal crossing are:
 *
 *   WHEN   `./portal-dwell`'s `stepPortalDwell` — here, landed, tested.
 *   WHERE  mc-worldgen's `resolveNetherTravel` — there, landed, tested.
 *   APPLY  `moveTo` below — mirrored, callable.
 *
 * and the join still cannot be written. It is not blocked on a mirror and not on
 * a roster; it is blocked on a NOUN WITH NO OWNER, and the block sits at BOTH
 * ends of the middle step. `resolveNetherTravel`'s signature is the measurement:
 *
 *     resolveNetherTravel(
 *       from: Dimension,                        <- nothing can answer this
 *       playerPos: BlockPosition,
 *       knownPortals: ReadonlyArray<BlockPosition>,   <- nor this
 *       searchRadius?: number,
 *     ): PortalTravelPlan                       <- and nothing can receive
 *                                                  `plan.toDimension`
 *
 *   - `from` HAS NO SOURCE. `PlayerServiceApi` below has six members and not one
 *     of them names a world; `EntityManagerApi<S>` has ten and neither does any
 *     of those. Measured across the workspace: `grep -rn "Dimension"
 *     mc-kernel/domain` returns nothing, `grep -rn "Dimension"` over mc-sim's
 *     `domain/`, `application/` and `index.ts` returns nothing, and there is no
 *     `NetherService` anywhere. The reference sets the dimension three times per
 *     crossing (`physics-stage-portal.ts:59-61`: `netherService.setDimension`,
 *     `chunkManagerService.setActiveDimension`,
 *     `entityManager.setActiveDimension`) and none of the three exists.
 *
 *   - `knownPortals` HAS NO OWNER EITHER, and that was already on the books
 *     before this file: mc-worldgen's `docs/responsibility.md` §6 placed
 *     `findNearestPortal` with its candidates as a PARAMETER precisely because
 *     「『世界に存在するポータルの一覧』を所有するのが誰かは別問題で、それはまだ
 *     誰にも割り当てられていない」. `resolveNetherTravel`'s own note adds the
 *     hazard: the list must be the DESTINATION dimension's, and no type can
 *     check that because a `BlockPosition` does not say which world it is in.
 *
 *   - `resolveNetherTravel` IS NOT ON mc-worldgen's BARREL, so there is nothing
 *     here to mirror even if the two arguments could be produced. Its `Dimension`
 *     is declared 「PROVISIONALLY」 and kept off `index.ts` deliberately, so that
 *     「A consumer cannot come to depend on the spelling because no consumer can
 *     see it」. A mirror of it would be this repository depending on exactly the
 *     spelling that file refuses to publish.
 *
 * SO `moveTo` ALONE IS WORSE THAN NOTHING, which is the reason the wiring is
 * absent rather than partial. A `travels: true` with a made-up `from` yields a
 * destination in the OTHER world's coordinate frame; calling `moveTo` with it
 * teleports the player to a scaled point in a world that was never switched,
 * with the same chunks around them. That is not this join minus one piece, it is
 * a defect wearing the join's shape — and it would be a rule this repository
 * invented, which is what `mx-gameplay` refused to do for buckets and shears.
 *
 * THE MISSING MEMBER, NAMED AS PRECISELY AS IT CAN BE: there is no
 * `PlayerServiceApi.dimension` and no `PlayerServiceApi.setDimension`, and no
 * member of any other mc-sim service holds one — the noun `Dimension` is
 * unspelled in mc-kernel and in mc-sim, so the missing thing is an OWNERSHIP
 * DECISION and not an unwritten method. `./portal-dwell`'s `stepPortalDwell`
 * note and mc-worldgen's `domain/nether-travel.ts` both nominate mc-kernel, on
 * the grounds that make it the owner of `BlockType`. Until that is decided a
 * `travels: true` has nowhere to travel to, and this mirror is the half of the
 * row that could be finished.
 */
import { Context, type Effect } from 'effect'
import type { Position } from './entity-manager-port'
import type { CameraPoseSnapshot, ClockPort } from './frame-contract'

// ---------------------------------------------------------------------------
// Pose — mirrors mc-sim/domain/camera-pose.ts
// ---------------------------------------------------------------------------

/**
 * Player pose, as the simulation holds it.
 *
 * Note `feetPosition`, not `position`. plan.md §3.4 records that in the
 * reference EVERY "things are floating" bug was a mismatch between a feet-origin
 * convention and an AABB-centre convention. The field name carries the
 * convention so that a mistake reads wrongly at the call site — which is also
 * why `moveTo`'s parameter below keeps mc-sim's name.
 */
export type PlayerPose = {
  readonly feetPosition: Position
  readonly yawRadians: number
  readonly pitchRadians: number
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export type PlayerServiceApi = {
  readonly pose: Effect.Effect<PlayerPose>
  /** Rotate the view. Pitch is clamped; yaw is not wrapped. */
  readonly look: (deltaYaw: number, deltaPitch: number) => Effect.Effect<PlayerPose>
  /**
   * Move to a feet-origin position. The name carries the coordinate convention.
   *
   * THIS IS THE MEMBER THE PORTAL ROW WAS WAITING FOR, and it takes a POSITION
   * AND NOT A DIMENSION — which is the whole of the remaining blocker, stated in
   * one signature. See the module header: a destination resolved by
   * mc-worldgen's `resolveNetherTravel` is in the other world's frame, so
   * performing it with this method and nothing else moves the player without
   * moving the world.
   */
  readonly moveTo: (feetPosition: Position) => Effect.Effect<void>
  /**
   * The snapshot mc-render mirrors. Stamped from `ClockPort`.
   *
   * NOTHING IN THIS REPOSITORY MAY CALL IT, and it is transcribed with its
   * requirement intact anyway — `Effect<CameraPoseSnapshot, never, ClockPort>`,
   * not `Effect<CameraPoseSnapshot>`. Dropping the `R` channel is the narrowing
   * that would make this a mirror of five members and a lie, and it is the exact
   * defect mc-compose's `domain/kernel-vocabulary.ts` records paying for: 「The
   * previous local `StageRegistration` dropped the R channel entirely
   * (`Effect<void>`); R does not erase itself」.
   *
   * mc-sim's own comment says why the requirement is visible rather than
   * discharged inside: 「making the clock dependency visible in the type is what
   * stops someone "simplifying" this into a `Date.now()` call」. DN-GP-8 bans the
   * same call here, and `pnpm check:deps` enforces it.
   */
  readonly cameraPose: Effect.Effect<CameraPoseSnapshot, never, ClockPort>
  readonly restore: (pose: PlayerPose) => Effect.Effect<void>
  /** Return to the fresh-world pose. Required for re-entrant world loads. */
  readonly reset: Effect.Effect<void>
}

/**
 * The tag key is `'@nerima-games/mc-sim/PlayerService'` — mc-sim's, not this
 * repository's, because it denotes mc-sim's service. Changing this string breaks
 * resolution silently at runtime while typechecking cleanly, so
 * `test/player-mirror.test.ts` asserts it literally.
 *
 * A `Context.Tag` CLASS, like `./chunk-store-port`'s `ChunkStore` and
 * `./inventory-port`'s `InventoryService`, and unlike `./entity-manager-port`'s
 * `EntityManager`: the service value type carries no parameter, so mc-sim
 * declares it as a class and so does this. That brings the nominal hazard back —
 * mc-sim's copy and this one are two nominal types denoting one service, and the
 * shape can drift where TypeScript cannot see it, which is what the
 * two-direction assignment in the test is for.
 */
export class PlayerService extends Context.Tag('@nerima-games/mc-sim/PlayerService')<
  PlayerService,
  PlayerServiceApi
>() {}
