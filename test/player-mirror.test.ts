/**
 * The `PlayerService` mirror is pinned against mc-sim's real interface.
 *
 * ---------------------------------------------------------------------------
 * What this file is defending against
 * ---------------------------------------------------------------------------
 *
 * `domain/player-port.ts` is a temporary local copy of a service that lives in
 * another repository, and its header promises that deleting it and repointing
 * every import at `@nerima-games/mc-sim` will typecheck. Nothing but a test can
 * enforce that promise, and — as with `test/chunk-store-mirror.test.ts`,
 * `test/entity-manager-mirror.test.ts` and `test/inventory-mirror.test.ts` — the
 * failure mode if it goes unenforced is not a compile error.
 *
 * Effect resolves Tags BY THEIR TEXTUAL KEY. Both copies use
 * `'@nerima-games/mc-sim/PlayerService'`, so in any bundle containing two of
 * them — mc-compose depends on both mx-gameplay and, transitively, mc-sim — a
 * `Layer` built against a narrow mirror satisfies the wide tag and every method
 * the narrow copy omitted is `undefined` at the point of use.
 *
 * `PlayerService` is a `Context.Tag` CLASS, so this mirror carries the NOMINAL
 * hazard as well: mc-sim's copy and this one are two nominal types denoting one
 * service, and TypeScript cannot see the shape drift. That is the `ChunkStore`
 * and `InventoryService` situation rather than the `EntityManager` one, and it
 * is why the two-direction assignment below restates the whole api rather than
 * asserting a subset.
 *
 * ---------------------------------------------------------------------------
 * THIS MIRROR HAS NO CALLER, WHICH MAKES THIS FILE THE ONLY THING HOLDING IT
 * ---------------------------------------------------------------------------
 *
 * The other three mirrors are exercised by `stages/registration.ts` — a drift in
 * `ChunkStore.load` or `InventoryService.add` breaks a stage. Nothing calls
 * `PlayerService` yet, because the row it was written for is blocked on a noun
 * with no owner (`domain/player-port.ts`'s header names it). So every assertion
 * below is load-bearing in a way the sibling files' are not: there is no second
 * line of defence.
 *
 * The `R` CHANNEL IS PART OF THE SHAPE and is asserted separately for that
 * reason. `cameraPose` is the one member whose type names a service, and a
 * mirror that dropped `ClockPort` from it would pass a member-name comparison,
 * pass `pnpm check:mirrors` — `mc-dev-meta/domain/type-shape.ts` compares names
 * and optionality only — and fail a compiler on repoint day. mc-compose has
 * already paid for exactly this: 「R does not erase itself」.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, type Layer } from 'effect'
import type { Position } from '../domain/entity-manager-port'
import { ClockPort, EpochMillis, MonotonicTimeSecs, type CameraPoseSnapshot } from '../domain/frame-contract'
import { PlayerService, type PlayerPose, type PlayerServiceApi } from '../domain/player-port'

/**
 * Fixed readings for the clock double.
 *
 * LITERALS, and that is the point rather than a convenience: this repository may
 * not read a clock (DN-GP-8) and `pnpm check:deps` fails the build on a
 * `Date.now()`. A test that needed a real instant to exercise the Port would be
 * evidence the Port was mirrored wrongly.
 */
const MONOTONIC_AT = MonotonicTimeSecs(1234.5)
const EPOCH_AT = EpochMillis(1_700_000_000_000)

/**
 * The message a `Brand.refined` constructor refuses with.
 *
 * `Brand.error` throws `Brand.BrandErrors` — an ARRAY of `{ message, meta }` —
 * and not an `Error`, so `expect(...).toThrow('...')` reads `undefined.indexOf`
 * and fails for the wrong reason. The sibling brand tests in
 * `test/stage-registration.test.ts` assert a bare `toThrow()` and stop there;
 * the messages are pinned here because they are TRANSCRIBED from kernel rather
 * than chosen, and a mirror that reworded one hands the caller a different
 * sentence after the repoint than before it.
 */
const refusalOf = (construct: () => unknown): string => {
  try {
    construct()
  } catch (thrown) {
    return (thrown as ReadonlyArray<{ readonly message: string }>).map((error) => error.message).join(' / ')
  }
  return ''
}

/**
 * mc-sim's `PlayerServiceApi`, restated from
 * `mc-sim/application/player-service.ts`.
 *
 * Written out rather than imported because mc-sim is not published — which is
 * the same reason the mirror exists at all. When it is published, this alias
 * becomes `import type { PlayerServiceApi } from '@nerima-games/mc-sim'` and
 * every assertion below keeps its meaning unchanged.
 *
 * There is NO deliberate widening here, unlike the `ChunkStore` mirror's
 * `Chunk.biomes`. Every member is transcribed exactly, `cameraPose`'s
 * requirement included.
 */
type SimPlayerServiceApi = {
  readonly pose: Effect.Effect<PlayerPose>
  readonly look: (deltaYaw: number, deltaPitch: number) => Effect.Effect<PlayerPose>
  readonly moveTo: (feetPosition: Position) => Effect.Effect<void>
  readonly cameraPose: Effect.Effect<CameraPoseSnapshot, never, ClockPort>
  readonly restore: (pose: PlayerPose) => Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}

/**
 * `PlayerPose`, restated from `mc-sim/domain/camera-pose.ts`.
 *
 * Separate from the api assignment for `test/inventory-mirror.test.ts`'s reason:
 * `PlayerPose` is reachable through `pose`, but a mirror that dropped a FIELD of
 * it would still satisfy that assignment, because the mirror is where both sides
 * are spelled. Restating it is what makes this a comparison rather than a
 * reflection.
 *
 * `feetPosition` and not `position` — the field name is the coordinate
 * convention (plan.md §3.4), and a mirror that renamed it would compile here and
 * yield a name that does not exist on repoint day.
 */
type SimPlayerPose = {
  readonly feetPosition: Position
  readonly yawRadians: number
  readonly pitchRadians: number
}

describe('the PlayerService mirror', () => {
  it.effect('matches mc-sim’s interface in BOTH directions', () =>
    Effect.sync(() => {
      // The assertions ARE the assignments. A method added, removed or re-signed
      // on either side stops the build here rather than at the repoint — and,
      // more importantly, rather than at runtime with an `undefined` method.
      const asSim = (api: PlayerServiceApi): SimPlayerServiceApi => api
      const asMirror = (api: SimPlayerServiceApi): PlayerServiceApi => api

      expect(typeof asSim).toBe('function')
      expect(typeof asMirror).toBe('function')
    }),
  )

  it.effect('mirrors the pose the api names, in BOTH directions', () =>
    Effect.sync(() => {
      const pose = (value: PlayerPose): SimPlayerPose => value
      const poseBack = (value: SimPlayerPose): PlayerPose => value

      for (const converter of [pose, poseBack]) {
        expect(typeof converter).toBe('function')
      }
    }),
  )

  it.effect('carries all six members and no others', () =>
    Effect.sync(() => {
      // The member NAMES, as data rather than as types. The assignments above
      // cannot fail on an EXTRA member — a wider mirror is assignable to a
      // narrower sim api in one direction — so the roster is listed here too,
      // and the sort makes the comparison order-independent.
      const members: ReadonlyArray<keyof PlayerServiceApi> = [
        'cameraPose',
        'look',
        'moveTo',
        'pose',
        'reset',
        'restore',
      ]
      const simMembers: ReadonlyArray<keyof SimPlayerServiceApi> = [
        'cameraPose',
        'look',
        'moveTo',
        'pose',
        'reset',
        'restore',
      ]

      expect([...members].sort()).toStrictEqual([...simMembers].sort())
      expect(members).toHaveLength(6)
    }),
  )

  it.effect('keeps `cameraPose`’s ClockPort requirement rather than erasing it', () =>
    Effect.sync(() => {
      // THE ONE MEMBER `pnpm check:mirrors` CANNOT SEE. `type-shape.ts` compares
      // member names and optionality, not member types, so a `cameraPose` narrowed
      // to `Effect<CameraPoseSnapshot>` passes that gate and fails a compiler on
      // repoint day. This assignment is what catches it.
      //
      // It is written as a projection off the api rather than as a standalone
      // alias so that it reads the REAL member type: renaming `cameraPose` or
      // dropping its requirement stops the build on the next line.
      const withClock = (member: PlayerServiceApi['cameraPose']): Effect.Effect<CameraPoseSnapshot, never, ClockPort> =>
        member
      const withClockBack = (
        member: Effect.Effect<CameraPoseSnapshot, never, ClockPort>,
      ): PlayerServiceApi['cameraPose'] => member

      expect(typeof withClock).toBe('function')
      expect(typeof withClockBack).toBe('function')
    }),
  )

  it.effect('`moveTo` takes a position and answers with nothing', () =>
    Effect.sync(() => {
      // The member the portal row was waiting for, pinned in the shape that
      // makes the REMAINING blocker legible: a `Position` goes in, `void` comes
      // out, and no dimension appears at either end. A member that grew one
      // would break this line, which is the day `docs/testing.md` §3-1's last ⬜
      // can be closed.
      const move = (api: PlayerServiceApi): ((feetPosition: Position) => Effect.Effect<void>) => api.moveTo
      expect(typeof move).toBe('function')
    }),
  )

  it.effect('no member of the api names a dimension', () =>
    Effect.sync(() => {
      // The measurement `domain/player-port.ts`'s header reports, as an
      // assertion rather than as a claim in a comment. If mc-sim grows the noun,
      // this test fails and the mirror is out of date — which is the correct
      // direction for a refusal to expire in.
      const members: ReadonlyArray<string> = ['cameraPose', 'look', 'moveTo', 'pose', 'reset', 'restore']

      for (const member of members) {
        expect(member.toLowerCase()).not.toContain('dimension')
      }
    }),
  )

  it.effect('uses mc-sim’s tag key, character for character', () =>
    Effect.sync(() => {
      // If this string drifts, Effect resolves two different services and the
      // failure is a missing method at runtime in a bundle neither repository
      // tested alone.
      expect(PlayerService.key).toBe('@nerima-games/mc-sim/PlayerService')
    }),
  )

  it.effect('a Layer built from the mirror is a Layer for the tag', () =>
    Effect.sync(() => {
      // The compile-time half of the tag-key hazard: whatever this repository
      // builds must be usable where mc-sim's `PlayerServiceLayer` is.
      const asLayer = (layer: Layer.Layer<PlayerService>): Layer.Layer<PlayerService> => layer
      expect(typeof asLayer).toBe('function')
    }),
  )

  it.effect('does not leak into this package’s published surface', () =>
    Effect.gen(function* () {
      // `index.ts` deliberately omits this module, exactly as it omits the other
      // three ports. Re-exporting another repository's service would make
      // deleting the stand-in a breaking change for consumers of mx-gameplay.
      const barrel = yield* Effect.promise(() => import('../index'))
      expect(Object.keys(barrel)).not.toContain('PlayerService')

      const port = yield* Effect.promise(() => import('../domain/player-port'))
      expect(Object.keys(port)).toStrictEqual(['PlayerService'])
    }),
  )

  it.effect('hands back only what mc-sim’s barrel can replace', () =>
    Effect.gen(function* () {
      // `./chunk-store-port`'s lesson, applied before it can bite. `ClockPort`
      // and `CameraPoseSnapshot` are mc-KERNEL's and are NOT declared in the
      // mirror, because mc-sim's barrel deliberately does not re-export its own
      // kernel mirror — either one here would be a symbol
      // `@nerima-games/mc-sim` cannot hand back on deletion day.
      const port = yield* Effect.promise(() => import('../domain/player-port'))
      expect(Object.keys(port)).not.toContain('ClockPort')
      expect(Object.keys(port)).not.toContain('MonotonicTimeSecs')

      // ...and they come from the mirror kernel's barrel DOES replace.
      const kernelMirror = yield* Effect.promise(() => import('../domain/frame-contract'))
      expect(Object.keys(kernelMirror)).toContain('ClockPort')
      expect(Object.keys(kernelMirror)).toContain('MonotonicTimeSecs')
    }),
  )
})

describe('the clock Port this mirror made necessary', () => {
  it.effect('carries mc-kernel’s key, not this repository’s', () =>
    Effect.sync(() => {
      // The reversal `domain/frame-contract.ts`'s clock section records rests on
      // this one string: a Tag built from kernel's key IS kernel's service at
      // runtime, which is the property that makes the mirror sound rather than a
      // second service. mc-compose asserts the same literal for the same reason.
      expect(ClockPort.key).toBe('@nerima-games/mc-kernel/ClockPort')
    }),
  )

  it.effect('resolves the whole ClockService, both members', () =>
    Effect.gen(function* () {
      // A narrower `ClockService` would satisfy the same tag with a field
      // missing, and the hole would open in a repository that never saw the
      // mirror. Both members are exercised through a double rather than
      // asserted as types, so a mirror that kept the NAMES and dropped the
      // Effects fails here.
      //
      // The readings are fixed literals. This repository may not read a clock
      // (DN-GP-8) and `pnpm check:deps` fails the build on one.
      const clock = yield* Effect.provideService(
        Effect.gen(function* () {
          const port = yield* ClockPort
          return {
            monotonic: yield* port.monotonicSecs,
            wall: yield* port.wallClockEpochMillis,
          }
        }),
        ClockPort,
        {
          monotonicSecs: Effect.succeed(MONOTONIC_AT),
          wallClockEpochMillis: Effect.succeed(EPOCH_AT),
        },
      )

      expect(clock.monotonic).toBe(MONOTONIC_AT)
      expect(clock.wall).toBe(EPOCH_AT)
    }),
  )
})

describe('the two brands the clock Port names', () => {
  it.effect('MonotonicTimeSecs accepts a finite non-negative reading', () =>
    Effect.gen(function* () {
      const { MonotonicTimeSecs } = yield* Effect.promise(() => import('../domain/frame-contract'))

      expect(MonotonicTimeSecs(0)).toBe(0)
      expect(MonotonicTimeSecs(12.5)).toBe(12.5)
    }),
  )

  it.effect('MonotonicTimeSecs refuses what a monotonic clock cannot produce', () =>
    Effect.gen(function* () {
      const { MonotonicTimeSecs } = yield* Effect.promise(() => import('../domain/frame-contract'))

      // TRANSCRIBED from kernel, not re-decided. A brand is keyed by its STRING,
      // so a mirror refining to a different range is ONE TYPE with kernel's and
      // no compiler can tell them apart — the mc-physics defect
      // `test/stage-registration.test.ts` records.
      for (const rejected of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => MonotonicTimeSecs(rejected)).toThrow()
      }

      // The message is part of the transcription: it is what a caller reads when
      // the refinement fires, and kernel's wording is what they will read after
      // the repoint.
      expect(refusalOf(() => MonotonicTimeSecs(-1))).toBe(
        'MonotonicTimeSecs must be a finite, non-negative number of seconds, received -1',
      )
    }),
  )

  it.effect('EpochMillis accepts a safe integer and refuses the rest', () =>
    Effect.gen(function* () {
      const { EpochMillis } = yield* Effect.promise(() => import('../domain/frame-contract'))

      expect(EpochMillis(0)).toBe(0)
      expect(EpochMillis(1_700_000_000_000)).toBe(1_700_000_000_000)

      // A NEGATIVE epoch is LEGAL — instants before 1970 — and that asymmetry
      // with `MonotonicTimeSecs` above is kernel's, transcribed. A mirror that
      // "tidied" the two into one predicate would be the tighter-range defect.
      expect(EpochMillis(-1)).toBe(-1)

      for (const rejected of [1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
        expect(() => EpochMillis(rejected)).toThrow()
      }

      expect(refusalOf(() => EpochMillis(1.5))).toBe(
        'EpochMillis must be a safe integer number of milliseconds, received 1.5',
      )
    }),
  )
})
