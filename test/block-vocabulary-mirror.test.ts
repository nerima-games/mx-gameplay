/**
 * The kernel capability mirror is pinned against mc-kernel's real table.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists, and why it is not `chunk-store-mirror.test.ts`
 * ---------------------------------------------------------------------------
 *
 * `domain/block-vocabulary.ts` is a temporary local copy of declarations that
 * live in mc-kernel, and its header promises that deleting it and repointing
 * every import at `@nerima-games/mc-kernel` will typecheck. Every mirror in the
 * organisation has a `*-mirror.test.ts` that pins its transcription; this is
 * that file for the kernel-sourced block vocabulary, and mc-dev-meta's
 * `MIRROR_SPECS` now lists the module it covers.
 *
 * The assertions below were in `./chunk-store-mirror.test.ts` until the four
 * predicates moved. That was the wrong home and the wrongness was not cosmetic:
 * `domain/chunk-store-port.ts` mirrors MC-WORLDGEN, mc-worldgen exports none of
 * `fallsWhenUnsupported`, `isReplaceable`, `validSpawnSurface` or
 * `canSupportAttachments`, and so the repoint that file promises would have
 * deleted all four rather than repointing them. A test sitting in that file
 * looked like coverage of a promise it was not able to check.
 *
 * ---------------------------------------------------------------------------
 * What these assertions can and cannot see
 * ---------------------------------------------------------------------------
 *
 * They pin THE TRANSCRIPTION, not the source. mc-kernel is not a dependency of
 * this repository and cannot be until it is published, so nothing here can
 * compare a set against `capabilityOfBlockId`. That comparison is
 * mc-dev-meta's `pnpm check:mirrors`, which imports both packages and diffs the
 * accepted sets over every representable id — and it is the check that found
 * `lava` missing from `REPLACEABLE_IDS` while this repository stayed green.
 *
 * So the value of the assertions below is narrow and worth stating: they catch a
 * careless local edit, and they record WHY each membership is what it is, so
 * that the next person to "tidy" a negative list has to argue with a comment
 * first.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  canSupportAttachments,
  fallsWhenUnsupported,
  isReplaceable,
  validSpawnSurface,
} from '../domain/block-vocabulary'

describe('the kernel capability mirror', () => {
  it.effect('does not leak into this package\'s published surface', () =>
    Effect.gen(function* () {
      // `index.ts` deliberately omits this module, exactly as it omits
      // `domain/chunk-store-port.ts` and `domain/frame-contract.ts`.
      // Re-exporting another repository's vocabulary would make deleting the
      // stand-in a breaking change for every consumer of mx-gameplay.
      const barrel = yield* Effect.promise(() => import('../index'))
      expect(Object.keys(barrel)).not.toContain('fallsWhenUnsupported')
      expect(Object.keys(barrel)).not.toContain('canSupportAttachments')
    }),
  )

  it.effect('reads capabilities, and knows about exactly the ids kernel says carry them', () =>
    Effect.sync(() => {
      // Transcribed from mc-kernel's `BLOCK_REGISTRY`: sand is 5, gravel is 8,
      // and they are the only two rows with `fallsWhenUnsupported`.
      expect(fallsWhenUnsupported(5)).toBe(true)
      expect(fallsWhenUnsupported(8)).toBe(true)
      expect(fallsWhenUnsupported(2)).toBe(false)
      expect(fallsWhenUnsupported(0)).toBe(false)

      // air, water AND lava. Not stone, and not glass — `replaceable` is not
      // "non-solid", which kernel's audit §4.9 spends a section on.
      //
      // Lava is here because it was MISSING, and this assertion could not see
      // that: it pins what the mirror transcribes, not what mc-kernel's registry
      // says. mc-dev-meta's `pnpm check:mirrors` found the disagreement by
      // importing both and diffing all 256 ids — that check is the one that
      // guards this set, and this one only guards against a careless local edit.
      expect(isReplaceable(0)).toBe(true)
      expect(isReplaceable(6)).toBe(true)
      expect(isReplaceable(11)).toBe(true)
      expect(isReplaceable(2)).toBe(false)
    }),
  )

  it.effect('validSpawnSurface is a NEGATIVE set, so it defaults to true like kernel’s', () =>
    Effect.sync(() => {
      // The capability whose kernel default is `true`
      // (`TRUE_BY_DEFAULT_CAPABILITY_FLAGS` — the reference stored
      // `NON_SPAWN_SURFACE_BLOCK_IDS` rather than the complement). Transcribing
      // the negative set is what makes the two properties below hold without a
      // second line of code.
      expect(validSpawnSurface(2)).toBe(true) // stone
      expect(validSpawnSurface(5)).toBe(true) // sand — falling, and still ground
      expect(validSpawnSurface(0)).toBe(false) // air
      expect(validSpawnSurface(6)).toBe(false) // water
      expect(validSpawnSurface(11)).toBe(false) // lava

      // kernel's audit §4.9: SOLID FOR COLLISION and still not a spawn surface.
      // If a future edit collapses this into a `solid` test, these two flip and
      // mobs start spawning in the canopy — the bug
      // `block-collision-predicates.ts:18-21` records from the other direction.
      expect(validSpawnSurface(10)).toBe(false) // oak_leaves
      expect(validSpawnSurface(13)).toBe(false) // glass

      // oak_log. This one was WRONG in both the mirror and kernel until the
      // reference was re-read: `NON_SPAWN_SURFACE_BLOCK_IDS` lists WOOD, and
      // `VILLAGE_NON_GROUND_IDS` lists it again. Nothing caught it because the
      // mirror check probed only `fallsWhenUnsupported` and `replaceable` — two
      // agreeing transcriptions of a third capability are not evidence.
      expect(validSpawnSurface(9)).toBe(false)

      // The blocks kernel's roster added that the reference's negative list
      // names. Spot-checked across the groups rather than exhaustively: the
      // exhaustive comparison is `pnpm check:mirrors`, which now probes this
      // capability over every representable id.
      expect(validSpawnSurface(18)).toBe(false) // ladder
      expect(validSpawnSurface(19)).toBe(false) // cobweb
      expect(validSpawnSurface(21)).toBe(false) // dandelion
      expect(validSpawnSurface(28)).toBe(false) // lily_pad
      expect(validSpawnSurface(33)).toBe(false) // cactus — collides, still not ground
      expect(validSpawnSurface(34)).toBe(false) // pressure_plate

      // ...and the ones the reference's list OMITS, which must stay `true`.
      // These are the assertions that fail if someone "completes" the negative
      // set by intuition: a rail is passable and is still, per the reference, a
      // legal place for a mob to stand.
      expect(validSpawnSurface(29)).toBe(true) // kelp
      expect(validSpawnSurface(30)).toBe(true) // seagrass
      expect(validSpawnSurface(31)).toBe(true) // rail
      expect(validSpawnSurface(32)).toBe(true) // powered_rail
      expect(validSpawnSurface(35)).toBe(true) // stone_slab

      // Total, and defaulting to "ordinary opaque cube" exactly as kernel's
      // `capabilityOfBlockId` does for an id it cannot name.
      expect(validSpawnSurface(200)).toBe(true)
    }),
  )

  it.effect('canSupportAttachments is a SECOND negative set, and not the spawn one', () =>
    Effect.sync(() => {
      // The fourth capability, and the one whose absence from `MIRROR_SPECS`
      // exposed the whole defect: it had no probe row, so it was the only one of
      // the four that `pnpm check:mirrors` compared against mc-worldgen's barrel
      // rather than exempting — and mc-worldgen does not export it.
      //
      // kernel's second `true`-by-default flag (`BLOCK_CAPABILITY_DEFAULTS`),
      // transcribed as `NON_SUPPORTING_IDS` because the reference stores
      // `NON_SUPPORTING_BLOCK_TYPES` (`block-support.ts:47-61`).
      expect(canSupportAttachments(2)).toBe(true) // stone
      expect(canSupportAttachments(0)).toBe(false) // air — nothing to attach to
      expect(canSupportAttachments(6)).toBe(false) // water
      expect(canSupportAttachments(11)).toBe(false) // lava

      // THE ROW WHERE THE TWO NEGATIVE SETS PART, and the reason collapsing them
      // is forbidden. kernel's audit §4.9 names this pair: a mob may stand on
      // snow, and a torch may not be planted in it.
      expect(validSpawnSurface(7)).toBe(true)
      expect(canSupportAttachments(7)).toBe(false)

      // ...and the mirror image. Leaves, a log and glass are valid supports and
      // are not ground, so a `solid` test would get both columns wrong in
      // opposite directions.
      expect(canSupportAttachments(9)).toBe(true) // oak_log
      expect(canSupportAttachments(10)).toBe(true) // oak_leaves
      expect(canSupportAttachments(13)).toBe(true) // glass

      // The reference's `NON_SUPPORTING_BLOCK_TYPES` DOES contain rails and
      // cactus, where `NON_SPAWN_SURFACE_BLOCK_IDS` does not contain the rails.
      // Two lists, two memberships, transcribed rather than reasoned about.
      expect(canSupportAttachments(31)).toBe(false) // rail
      expect(canSupportAttachments(32)).toBe(false) // powered_rail
      expect(validSpawnSurface(31)).toBe(true) // ...and still legal ground

      // DELIBERATELY ABSENT from the negative set, so these stay `true`:
      // passable blocks the reference's list does not name.
      expect(canSupportAttachments(18)).toBe(true) // ladder
      expect(canSupportAttachments(19)).toBe(true) // cobweb
      expect(canSupportAttachments(29)).toBe(true) // kelp
      expect(canSupportAttachments(30)).toBe(true) // seagrass

      // Total, defaulting to "ordinary opaque cube" for a byte this build cannot
      // name, exactly as `capabilityOfBlockId` does.
      expect(canSupportAttachments(200)).toBe(true)
    }),
  )
})
