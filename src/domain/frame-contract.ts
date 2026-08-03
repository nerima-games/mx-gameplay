/**
 * The frame / module composition contract (plan.md §4.1), restated locally.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AND WHEN IT DIES
 * ---------------------------------------------------------------------------
 *
 * These declarations belong to `@nerima-games/mc-kernel` (`domain/frame.ts`,
 * `domain/identifiers.ts`, `domain/quantities.ts`). This repository does not
 * import them, because the roll-out is bottom-up publish-then-pin: nothing is on
 * GitHub Packages yet, so there is no version of kernel to depend on. Declaring
 * a dependency we cannot install would leave a skeleton that does not build.
 *
 * So the contract is restated here, deliberately character-identical to kernel's
 * copy in the parts that matter (`StageRegistration`, the brands' predicates and
 * error messages), and this file is DELETED the moment mc-kernel is published:
 *
 *     import type { StageRegistration } from '@nerima-games/mc-kernel'
 *
 * The one intentional divergence is `FrameServices`; see its note below.
 *
 * Nothing else in this repository may restate a kernel type. A second local copy
 * of, say, `BlockType` would be a fork of the vocabulary rather than a stand-in
 * for it, and the whole point of kernel (plan.md §3.1) is that the vocabulary has
 * exactly one home.
 */
import type { Effect, Layer } from 'effect'
import { Brand, Context } from 'effect'
/**
 * `Position` is kernel vocabulary. Importing it directly keeps this module from
 * becoming a second declaration of a type it does not own.
 */
import type { Position } from '@nerima-games/mc-kernel'

/**
 * Identifies a frame stage. Stage ids are the vertices of the per-frame ordering
 * graph and are STRINGS ON PURPOSE: `after: [StageId('sim:physics')]` expresses
 * "run me after mc-sim's physics" without importing anything from mc-sim's stage
 * module, and `after: [StageId('redstone:tick')]` would express an ordering
 * relative to a sibling experience module without creating a dependency edge to
 * it (plan.md §2.3-1, §2.3-3).
 *
 * Convention: `<owning-repo-suffix>:<stage>`. Everything this repository owns is
 * prefixed `gameplay:`.
 */
export type StageId = string & Brand.Brand<'StageId'>

export const StageId = Brand.refined<StageId>(
  (value) => value.trim().length > 0,
  (value) => Brand.error(`StageId must be a non-blank string, received ${JSON.stringify(value)}`),
)

/**
 * Elapsed simulation time for one frame, in seconds.
 *
 * Non-negative and finite. A zero delta is legal and must be handled by stages
 * rather than rejected — which for gameplay means "advance nothing", not
 * "divide by dt".
 */
export type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>

export const DeltaTimeSecs = Brand.refined<DeltaTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`DeltaTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

/**
 * Maximum items in one inventory stack.
 *
 * PROVISIONAL in kernel, and its note is worth carrying: vanilla stack limits
 * are per-item (64 / 16 / 1) and the per-item table belongs to the inventory
 * repository. Kernel only fixes the upper bound of the representable range.
 */
export const MAX_STACK_COUNT = 64

/**
 * Number of items in one inventory stack. Integer in [0, MAX_STACK_COUNT].
 *
 * ---------------------------------------------------------------------------
 * WHY A STACK COUNT IS IN A FILE CALLED `frame-contract`
 * ---------------------------------------------------------------------------
 *
 * Because of the rule the mirrors in this repository are sorted by, which is
 * WHOSE MODULE THE SYMBOL COMES FROM — `domain/portal-frame-port.ts`'s header
 * states it as 「one mirror per source module; any number of them per package」.
 * `StackCount` is `mc-kernel/domain/quantities.ts`, which is one of the three
 * kernel modules THIS file already mirrors (see the header) and is where
 * `DeltaTimeSecs` immediately above it comes from too. A second file mirroring
 * the same module would be two mirrors of one source, which is the arrangement
 * that rule exists to prevent — and it would put one half of `quantities.ts` in
 * `MIRROR_SPECS` and the other half outside it.
 *
 * It arrived with `./inventory-port`, which needs it for mc-sim's `ItemStack`.
 * The alternative considered and rejected was declaring it there: mc-sim's
 * barrel does NOT re-export its own kernel mirror, so a `StackCount` inside a
 * mirror of mc-sim would be a symbol that mc-sim cannot hand back on the day
 * that file is deleted — which is precisely the broken repoint promise
 * `./chunk-store-port`'s header records finding in its own capability
 * predicates. mc-KERNEL's barrel exports it; this is the file kernel's barrel
 * replaces.
 *
 * THE REFINEMENT IS TRANSCRIBED, not re-decided, for `DeltaTimeSecs`' reason: a
 * brand is keyed by its STRING, so `Brand.Brand<'StackCount'>` here and in
 * kernel are ONE TYPE however differently the two constructors validate. The
 * mc-physics defect `test/stage-registration.test.ts` records is exactly a
 * mirror refining to a tighter range than kernel's. mc-dev-meta's
 * `pnpm check:mirrors` probes both constructors over a sample grid whose `63`,
 * `64` and `65` rows were chosen for this boundary.
 */
export type StackCount = number & Brand.Brand<'StackCount'>

export const StackCount = Brand.refined<StackCount>(
  (value) => Number.isInteger(value) && value >= 0 && value <= MAX_STACK_COUNT,
  (value) => Brand.error(`StackCount must be an integer in [0, ${MAX_STACK_COUNT}], received ${value}`),
)

/**
 * A reading from a monotonic clock, in seconds.
 *
 * Monotonic means: never decreases, and is unaffected by wall-clock
 * adjustments. The origin is unspecified — only differences are meaningful.
 * Obtain it from `ClockPort`, never from a global.
 *
 * THE REFINEMENT IS TRANSCRIBED, for `StackCount`'s reason above and with the
 * same consequence: `Brand.Brand<'MonotonicTimeSecs'>` here and in kernel are
 * ONE TYPE however differently the two constructors validate.
 */
export type MonotonicTimeSecs = number & Brand.Brand<'MonotonicTimeSecs'>

export const MonotonicTimeSecs = Brand.refined<MonotonicTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`MonotonicTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

/**
 * A wall-clock reading: milliseconds since the Unix epoch.
 *
 * Use this only for things a human will read or that must survive a save/load
 * round trip. Never use it to measure durations — it can jump backwards.
 * Obtain it from `ClockPort`, never from a global.
 *
 * NOTHING IN THIS REPOSITORY READS IT, and it is here anyway because
 * `ClockService` names it. See that type's note on why a narrower `ClockService`
 * is the one shape a mirror of a Port must never take.
 */
export type EpochMillis = number & Brand.Brand<'EpochMillis'>

export const EpochMillis = Brand.refined<EpochMillis>(
  (value) => Number.isSafeInteger(value),
  (value) => Brand.error(`EpochMillis must be a safe integer number of milliseconds, received ${value}`),
)

// ---------------------------------------------------------------------------
// The clock Port — mirrors mc-kernel/domain/clock.ts
//
// THIS SECTION REVERSES A REFUSAL THIS FILE USED TO STATE, and the reversal is
// recorded rather than quietly performed because two other files cite the old
// text by name.
//
// The old `FrameServices` note said: 「Restating `ClockPort` locally would mean
// constructing a second `Context.Tag` with the same textual identifier as
// kernel's — two tags that look identical and are not, which is a far worse
// failure than a narrower type.」 `stages/registration.ts` cites that sentence
// TWICE, once for `targetPosition` and once for `timeOfDay`, as the reason
// `PlayerService` and `TimeService` 「cannot be mirrored whole」.
//
// The premise is wrong, and the repository that had to get it right says so.
// mc-compose's `domain/kernel-vocabulary.ts` mirrors this Port whole and states
// the mechanism: 「Effect resolves Tags by their TEXTUAL KEY, so a mirror built
// from `'@nerima-games/mc-kernel/ClockPort'` IS kernel's service at runtime.
// That is what makes the mirror sound」. Two tags carrying one key are not two
// services; they are one service and two nominal spellings of it, which is
// exactly the situation `./chunk-store-port` and `./inventory-port` already live
// in for `ChunkStore` and `InventoryService` and defend with a two-direction
// assignment test.
//
// mc-compose also names what the mx-* refusal actually rested on, and it was
// never safety: 「restating a `Context.Tag` they never construct would buy them
// nothing」. That was true while nothing here needed the noun. It stopped being
// true when `@nerima-games/mc-sim` arrived, because `PlayerServiceApi.cameraPose` has
// `ClockPort` IN ITS TYPE — so the choice is no longer "name the tag or don't",
// it is "name the tag or ship a narrow mirror of a `Context.Tag`", and the
// second is the hazard `./chunk-store-port` exists to refuse.
//
// WHAT IS NOT REVERSED: `FrameServices` stays `never`. Its own argument was
// always separate and is untouched — this repository authors stages and does not
// provide them, an `Effect<void, never, never>` is assignable wherever
// `Effect<void, never, ClockPort>` is wanted, and widening it would be a
// breaking change for whoever BUILDS the runtime. Naming a tag in a mirrored
// signature and requiring it from every stage are different acts.
//
// AND DN-GP-8 IS UNTOUCHED. Nothing here reads a clock. `monotonicSecs`,
// `wallClockEpochMillis`, `fixedClock` and `FixedClockLayer` are kernel's and
// are deliberately NOT mirrored: a function absent from a public contract is a
// compile error at its call site, never an `undefined` at run time. Only the Tag
// and the shape it resolves to are here,
// because only those two carry the textual-key hazard.
// ---------------------------------------------------------------------------

/**
 * What `ClockPort` resolves to.
 *
 * MIRRORED WHOLE, and this is the one type in this file where narrowing is a
 * runtime defect rather than a smaller surface. mc-compose states it: 「a
 * narrower `ClockService` would satisfy the same tag with a field missing, and
 * the hole would open in a repository that never saw this file」. Both members
 * are here even though this repository reads neither.
 */
export type ClockService = {
  /** Monotonic reading. Only differences between readings are meaningful. */
  readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>
  /** Wall-clock reading. Never use for durations. */
  readonly wallClockEpochMillis: Effect.Effect<EpochMillis>
}

/**
 * The clock Port, named so that `@nerima-games/mc-sim` can transcribe `cameraPose`.
 *
 * THE KEY IS KERNEL'S AND IS ASSERTED AS A LITERAL by
 * `test/kernel-clock-mirror.test.ts`. It is `'@nerima-games/mc-kernel/ClockPort'`
 * and not this repository's, because it denotes kernel's service — the same
 * rule `./inventory-port`'s tag follows, with the same consequence if it drifts:
 * resolution silently finds nothing while both repositories typecheck.
 */
export class ClockPort extends Context.Tag('@nerima-games/mc-kernel/ClockPort')<ClockPort, ClockService>() {}

// ---------------------------------------------------------------------------
// Camera pose — mirrors mc-kernel/domain/camera.ts
// ---------------------------------------------------------------------------

/**
 * The camera pose, as a value.
 *
 * Here for `@nerima-games/mc-sim`'s `cameraPose` and for nothing else — no rule in this
 * repository reads a pose. `snapshotAgeSecs` and `forwardVector`, kernel's and
 * mc-sim's functions over it, are NOT mirrored for the reason the clock section
 * above gives.
 *
 * plan.md §4.3 / §5.1-2: mc-sim owns the truth and mc-render mirrors it. The
 * type has no setter and must never grow one.
 */
export type CameraPoseSnapshot = {
  /** Eye position in continuous world space. */
  readonly position: Position
  /** Rotation about the Y (up) axis, radians. Not normalised — consumers wrap if they care. */
  readonly yawRadians: number
  /** Rotation about the local right axis, radians. Positive looks up. */
  readonly pitchRadians: number
  /**
   * Monotonic reading taken when the simulation produced this pose.
   * Sourced from `ClockPort` — never from a global clock.
   */
  readonly capturedAtSecs: MonotonicTimeSecs
}

/**
 * The context every frame stage may assume is present.
 *
 * kernel aliases this to `ClockPort`; here it is `never`, and that is a
 * deliberate divergence rather than an oversight. It is NOT the divergence it
 * used to be: the tag is now named directly above, so the reason is no longer
 * 「this repository will not spell `ClockPort`」 but the narrower and more
 * durable one below.
 *
 * `never` is forward-compatible in the direction that matters: an
 * `Effect<void, never, never>` is assignable wherever `Effect<void, never,
 * ClockPort>` is wanted, so every stage written against this file keeps
 * typechecking when the alias is replaced by the kernel import. Widening
 * `FrameServices` is a breaking change for whoever BUILDS the runtime, never for
 * stage authors — see kernel's note on the same alias, and mc-compose's, which
 * is the repository that has to discharge the requirement and therefore sets its
 * own alias to `ClockPort`.
 */
export type FrameServices = never

/**
 * One unit of per-frame work, contributed by a repository.
 *
 * `after` declares ORDERING EDGES ONLY. It is not a dependency on the named
 * stage existing, and it is not a request for a position in the sequence: the
 * total order over all stages from all modules is resolved solely by mc-compose
 * (plan.md §2.3-3, §4.2). A module that tried to declare its own absolute
 * position would be making a decision it cannot make correctly, because it
 * cannot see the other modules.
 *
 * Reproduced verbatim from plan.md §4.1, `interface` and all — hence the
 * `@typescript-eslint/consistent-type-definitions` exemption noted in
 * .oxlintrc.json. Keeping the spec and the code character-identical is worth more
 * than local style consistency.
 */
export interface StageRegistration {
  readonly id: StageId
  readonly after?: ReadonlyArray<StageId>
  readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>
}

/**
 * A repository's contribution to a running game.
 *
 * `ROut`      — services this module provides.
 * `E`         — errors that can occur while *building* those services.
 * `RIn`       — services this module needs to be given in order to build.
 * `RRegister` — services this module needs in order to REGISTER its stages.
 *
 * ---------------------------------------------------------------------------
 * `frameStages` is an Effect, and this repository is part of why
 * ---------------------------------------------------------------------------
 *
 * kernel declared it `ReadonlyArray<StageRegistration>` — a VALUE — until the
 * vertical-slice spike. A value has no context, so a module had no moment at
 * which it could acquire a service in order to BUILD a stage, and the only
 * remaining channel was `run` — which forced every service any stage touched
 * into `FrameServices`, and that in turn forced kernel to name mc-sim's and
 * mc-render's services. The tier model (plan.md §2.2) forbids that outright.
 *
 * `stages/registration.ts` in this repository had already run into it: it
 * exported an `Effect.Effect<ReadonlyArray<StageRegistration>>` with a comment
 * saying it "is NOT yet a `GameModule`" because the service set could not be
 * named. It was the right shape all along, and the contract has caught up.
 *
 * `RRegister` is separate from `RIn` because the two are genuinely different
 * sets — mc-render acquires `InputService` to register its input stage, and
 * `InputService` is a service mc-render PROVIDES rather than one it needs to be
 * given. It defaults to `never` so the common module still reads as three
 * parameters, which is exactly how this repository writes its own.
 *
 * The error channel of `frameStages` stays `never`, unlike the Layer's: a
 * module that can fail to come up says so in `E`, where a host already has to
 * handle it.
 */
export interface GameModule<ROut, E, RIn, RRegister = never> {
  readonly layers: Layer.Layer<ROut, E, RIn>
  readonly frameStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, RRegister>
}
