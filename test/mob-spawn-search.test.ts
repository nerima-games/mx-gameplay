/**
 * The spawn search: the ring that offers cells to `domain/mob/hostile-spawn.ts`.
 *
 * This is the loop two headers predicted and neither could write. `MobSpawnAttempt`
 * named the two missing measurements — mc-worldgen's block light and mc-sim's
 * hour — and `ARENA_MISSING` carried a row saying the same thing. The light
 * query now exists; the hour arrives as an argument.
 *
 * What is tested here is the SEARCH and not the rule. `canHostileSpawnAt` has its
 * own oracle in `test/mob.test.ts`, pinned against the reference's; this file
 * asserts that the cells offered to it are the right cells, gathered honestly,
 * at a cost that can be stated.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import { AIR_BLOCK_ID, type BlockPosition, type ChunkStoreApi } from '../domain/chunk-store-port'
import type { Position } from '../domain/entity-manager-port'
import {
  CREEPER_KIND,
  ENDERMAN_KIND,
  HOSTILE_KINDS,
  MAX_HOSTILE_COUNT,
  type MobBehaviour,
} from '../domain/entities/mob-frame'
import {
  searchSpawnCandidates,
  SPAWN_RING_ANGLES,
  SPAWN_RING_CELLS,
  SPAWN_RING_RADII,
  SPAWN_RING_RADIUS_STEPS,
  SPAWN_SEARCH_ROLLS,
} from '../domain/entities/mob-spawn-search'
import { drawRolls, rollAt } from '../domain/frame-rolls'
import { DESPAWN_DISTANCE_BLOCKS, despawnVerdict } from '../domain/mob/hostile-despawn'
import {
  MAX_SPAWN_DISTANCE_BLOCKS,
  MIN_SPAWN_DISTANCE_BLOCKS,
} from '../domain/mob/hostile-spawn'
import { DeltaTimeSecs } from '../domain/frame-contract'
import { GAMEPLAY_STAGE_IDS } from '../stages/stage-ids'
import {
  gameplayStages,
  HOSTILE_SPAWN_INTERVAL_SECS,
  makeGameplayFrameState,
} from '../stages/registration'
import {
  lightWorld,
  makeChunkStoreDouble,
  STONE,
  world,
  type LightLevels,
} from './support/chunk-store-double'
import { FrameServicesLayer } from './support/frame-services'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { makePlayerServiceDouble } from './support/player-service-double'
import { makeInventoryDouble } from './support/inventory-service-double'

// ---------------------------------------------------------------------------
// A world big enough for the ring to land in.
//
// The outermost radius is `MAX_SPAWN_DISTANCE_BLOCKS`, so every chunk within 40
// blocks of the player has to be resident or the search reports `unreadable`
// instead of offering anything. That is itself a property worth testing, and it
// is — separately, below.
// ---------------------------------------------------------------------------

const PLAYER = { x: 0.5, y: 64, z: 0.5 }
const FLOOR_Y = 63
const MIDNIGHT = 0

/** Chunk keys covering -48..47 on both axes, which contains the whole ring. */
const RESIDENT_CHUNKS: ReadonlyArray<string> = (() => {
  const keys: Array<string> = []
  for (let cx = -3; cx <= 3; cx += 1) {
    for (let cz = -3; cz <= 3; cz += 1) {
      keys.push(`${String(cx)},${String(cz)}`)
    }
  }
  return keys
})()

/** Stone at y = 63 across the whole area, air above it. */
const FLOORED_WORLD = (() => {
  const cells: Array<readonly [BlockPosition, number]> = []
  for (let x = -48; x <= 47; x += 1) {
    for (let z = -48; z <= 47; z += 1) {
      cells.push([{ x, y: FLOOR_Y, z }, STONE] as const)
    }
  }
  return world(cells)
})()

const searchIn = (
  blocks: ReadonlyMap<string, number>,
  loaded: ReadonlyArray<string>,
  lights: ReadonlyMap<string, LightLevels> = new Map(),
  seed = 1,
  timeOfDay = MIDNIGHT,
) =>
  Effect.gen(function* () {
    const store = yield* makeChunkStoreDouble(blocks, loaded, lights)
    const found = yield* searchSpawnCandidates(store.api, PLAYER, timeOfDay, seed)
    return { store, found }
  })

describe('the spawn ring', () => {
  it.effect('is the reference’s sixteen angles by four radii', () =>
    Effect.sync(() => {
      // `mob-spawner-helpers.ts:9-18`. The product is what the roll budget and
      // the store-call cost are both derived from, so it is pinned rather than
      // left implicit in two places.
      expect(SPAWN_RING_ANGLES).toBe(16)
      expect(SPAWN_RING_RADII).toBe(4)
      expect(SPAWN_RING_CELLS).toBe(64)
    }),
  )

  it.effect('takes its radii from the RULE’s band rather than from four literals', () =>
    Effect.sync(() => {
      // The property that matters is not the numbers, it is the derivation: a
      // change to `MIN_SPAWN_DISTANCE_BLOCKS` or `MAX_SPAWN_DISTANCE_BLOCKS`
      // must move the ring with it. A search that probed outside the band the
      // rule enforces would refuse everything it found and look like a broken
      // spawner.
      expect(SPAWN_RING_RADIUS_STEPS[0]).toBe(MIN_SPAWN_DISTANCE_BLOCKS)
      expect(SPAWN_RING_RADIUS_STEPS[SPAWN_RING_RADII - 1]).toBe(MAX_SPAWN_DISTANCE_BLOCKS)
      expect(SPAWN_RING_RADIUS_STEPS).toStrictEqual([16, 24, 32, 40])
    }),
  )

  it.effect('offers one candidate per cell when the whole ring is readable', () =>
    Effect.gen(function* () {
      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS)

      expect(found.attempts.length).toBe(SPAWN_RING_CELLS)
      expect(found.unreadable).toBe(0)
    }),
  )

  it.effect('places every candidate on the floor, with two cells of room above it', () =>
    Effect.gen(function* () {
      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS)

      for (const attempt of found.attempts) {
        // The plane is the PLAYER's feet altitude — see the module header on why
        // this is a divergence from the reference's column scan and what it
        // costs. Here the floor is at 63 and the player at 64, so the ground
        // block really is stone.
        expect(attempt.feetPosition.y).toBe(Math.floor(PLAYER.y))
        expect(attempt.candidate.groundBlock).toBe(STONE)
        expect(attempt.candidate.footBlock).toBe(AIR_BLOCK_ID)
        expect(attempt.candidate.headBlock).toBe(AIR_BLOCK_ID)
      }
    }),
  )

  it.effect('measures the distance from the CELL, not from the radius that produced it', () =>
    Effect.gen(function* () {
      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS)

      for (const attempt of found.attempts) {
        const measured = Math.hypot(
          attempt.feetPosition.x - PLAYER.x,
          attempt.feetPosition.z - PLAYER.z,
        )
        // Exactly the distance to the cell the mob would stand in. Reporting the
        // radius instead would be the search lying to the rule about the one
        // fact the rule cannot check for itself.
        expect(attempt.candidate.distanceToPlayerBlocksXZ).toBeCloseTo(measured, 10)
      }
    }),
  )

  it.effect('stays inside the rule’s band, allowing for the flooring', () =>
    Effect.gen(function* () {
      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS)

      for (const attempt of found.attempts) {
        // Flooring a continuous ring position moves a cell by up to one block on
        // each axis, so the true distance can fall a little outside the radius
        // it came from. It must not fall FAR outside: a candidate at 45 would be
        // refused `too-far` every time and would be pure waste.
        expect(attempt.candidate.distanceToPlayerBlocksXZ).toBeGreaterThan(
          MIN_SPAWN_DISTANCE_BLOCKS - 2,
        )
        expect(attempt.candidate.distanceToPlayerBlocksXZ).toBeLessThan(
          MAX_SPAWN_DISTANCE_BLOCKS + 2,
        )
      }
    }),
  )

  it.effect('SPANS the four radii — every step is actually probed, not just the inner one', () =>
    Effect.gen(function* () {
      // FOUND BY A MUTATION, and it was the one the loop's own comment predicted.
      // Replacing the per-step radius with `MIN_SPAWN_DISTANCE_BLOCKS` — a ring
      // that probes 16 blocks four times over and never looks past it — passed
      // every other test in this file. The count is still 64, the band assertion
      // still holds (16 is inside it), the store-call cost is unchanged, and the
      // rule refuses nothing extra. In a running game it is a spawner that only
      // ever produces mobs in a tight circle, which is visible to a player and to
      // nothing else here.
      //
      // The assertion is over the STEPS rather than over four literals, so it
      // moves with `SPAWN_RING_RADIUS_STEPS` the way the ring does. Each step is
      // matched within one block on each axis, which is the most flooring a
      // continuous ring position can cost.
      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS)

      const distances = found.attempts.map((attempt) => attempt.candidate.distanceToPlayerBlocksXZ)

      for (const step of SPAWN_RING_RADIUS_STEPS) {
        const reached = distances.filter((distance) => Math.abs(distance - step) <= Math.SQRT2)
        // One per angle, which is also the claim that the ring is not lopsided:
        // a rotation applies to the angle and must not drop a radius.
        expect(reached.length).toBe(SPAWN_RING_ANGLES)
      }

      // …and nothing was probed OUTSIDE the steps, which is the other half: a
      // ring that reached every step and also a fifth would still pass above.
      for (const distance of distances) {
        const nearest = Math.min(
          ...SPAWN_RING_RADIUS_STEPS.map((step) => Math.abs(distance - step)),
        )
        expect(nearest).toBeLessThanOrEqual(Math.SQRT2)
      }
    }),
  )

  /*
   * PORTED ORACLE.
   * `<reference-impl>/packages/entity/test/mob/mob-spawner-helpers.test.ts:6-13`
   * (「keeps the spawn position on the player ring around the cursor angle」),
   * read against `packages/entity/application/mob/mob-spawner-helpers.ts:9-18`.
   *
   * The reference asserts ONE point of its ring and that point carries the whole
   * turn: at cursor 4 the spawn lands at `z = pz + 16` with `x` unchanged.
   * Cursor 4 is a quarter of sixteen, so a quarter of the way round is due +Z —
   * which is only true if the sixteen angles are spread over `2 * Math.PI`, if
   * `x` takes the cosine and `z` the sine, and if the inner radius is
   * `MIN_SPAWN_DISTANCE`. One assertion, three facts.
   *
   * FOUND BY A MUTATION, and it is the one this file could not see. Halving the
   * turn — `((angleIndex + rotation) / SPAWN_RING_ANGLES) * Math.PI` — left all
   * 409 tests in this repository green. The count is still 64, all four radii
   * are still reached sixteen times each, the band still holds and the store
   * cost is unchanged; the sixteen angles are simply crowded into a SEMICIRCLE.
   * In a running game that is a spawner that never puts a mob behind the player,
   * and the tests above cannot say so because every one of them is about
   * distance and none is about bearing.
   *
   * The transcription is checked against the reference's own numbers first, so
   * that what follows is a comparison with the reference rather than with
   * itself: a formula copied out of the implementation under test would agree
   * with any mutation of it.
   */
  it.effect('turns a FULL circle, which is the reference’s ring and not half of it', () =>
    Effect.gen(function* () {
      // `mob-spawner-helpers.ts:9-18`, transcribed. The reference ties angle and
      // radius to ONE cursor (`cursor % 16` and `cursor % 4`); this repository
      // separates them into an angle index and a radius, so the transcription
      // takes the two apart and the rotation — which the reference does not have
      // — is added where its `cursor % 16` sits.
      const referenceRingPosition = (
        angleIndex: number,
        radiusIndex: number,
        rotation: number,
      ): { readonly x: number; readonly z: number } => {
        const angle = ((angleIndex + rotation) / SPAWN_RING_ANGLES) * Math.PI * 2
        const distance = MIN_SPAWN_DISTANCE_BLOCKS + radiusIndex * 8

        return {
          x: PLAYER.x + Math.cos(angle) * distance,
          z: PLAYER.z + Math.sin(angle) * distance,
        }
      }

      // THE REFERENCE'S ASSERTED POINT, at its own rotation of zero: cursor 4,
      // radius step 0. `expect(spawnPosition.x).toBeCloseTo(playerPosition.x)`
      // and `expect(spawnPosition.z).toBeCloseTo(playerPosition.z + 16)`.
      const quarterTurn = referenceRingPosition(4, 0, 0)
      expect(quarterTurn.x).toBeCloseTo(PLAYER.x, 10)
      expect(quarterTurn.z).toBeCloseTo(PLAYER.z + MIN_SPAWN_DISTANCE_BLOCKS, 10)

      // ...and the reference's radii, which its `MIN + (cursor % 4) * 8` spells
      // as arithmetic and this repository derives from the rule's band. The two
      // agree, and that agreement is what makes the transcription above usable
      // as an oracle for the cells below.
      expect(
        SPAWN_RING_RADIUS_STEPS.map((_, index) => MIN_SPAWN_DISTANCE_BLOCKS + index * 8),
      ).toStrictEqual([...SPAWN_RING_RADIUS_STEPS])

      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS)
      const rotation = rollAt(drawRolls(1, SPAWN_SEARCH_ROLLS), 0)

      expect(found.attempts.length).toBe(SPAWN_RING_CELLS)

      for (const [cellIndex, attempt] of found.attempts.entries()) {
        const angleIndex = Math.floor(cellIndex / SPAWN_RING_RADII)
        const radiusIndex = cellIndex % SPAWN_RING_RADII
        const expected = referenceRingPosition(angleIndex, radiusIndex, rotation)

        // `Math.floor` and not a tolerance: the search floors the continuous
        // ring position to a cell and the reference's formula is the position it
        // floors. An off-by-one here would be a real disagreement about which
        // cell a bearing names, not rounding noise.
        expect(attempt.feetPosition.x).toBe(Math.floor(expected.x))
        expect(attempt.feetPosition.z).toBe(Math.floor(expected.z))
      }
    }),
  )

  /*
   * PORTED ORACLE.
   * `<reference-impl>/packages/entity/test/mob/mob-spawner-rules.test.ts:18-20`
   * (「rejects positions that would immediately despawn in 3D」), read against
   * `packages/entity/application/mob/mob-spawner-rules.ts:18-19`.
   *
   * The reference's spawn test is XZ and its despawn guard is 3D, so a candidate
   * 16 blocks away horizontally and `DESPAWN_DISTANCE` blocks UP passes the band
   * and is swept on arrival. Its oracle asserts that the spawner refuses it.
   *
   * THIS REPOSITORY SPLIT THE TWO ACROSS A BOUNDARY, so the claim moved with the
   * Y. `domain/mob/hostile-spawn.ts` gates on the horizontal distance alone and
   * says so («The band is HORIZONTAL (XZ) in the reference; the vertical
   * component enters only the 128-block despawn guard, which is not ported»), so
   * the rule CANNOT make this refusal — the fact it would need is not in
   * `SpawnCandidate`. The obligation therefore lands on the SEARCH, which is the
   * only thing here that chooses a Y at all.
   *
   * `test/mob.test.ts` already pins the horizontal half of the same agreement
   * (「nothing this repository can SPAWN is ever swept on the frame it spawns」,
   * asserting `MAX_SPAWN_DISTANCE_BLOCKS < DESPAWN_DISTANCE_BLOCKS`). That test
   * cannot see the vertical half, because a rule with no Y in its arguments
   * cannot be asked about one.
   */
  it.effect('offers no cell that the sweep would take on arrival — the reference’s 3D check, moved', () =>
    Effect.gen(function* () {
      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS)

      expect(found.attempts.length).toBe(SPAWN_RING_CELLS)

      for (const attempt of found.attempts) {
        // THE FULL 3D DISTANCE, which is the whole point: the band the rule
        // enforces is `Math.hypot(x, z)` and this is `Math.hypot(x, y, z)`. A
        // search that put its candidates on a plane far from the player would
        // satisfy every XZ assertion in this file and hand the sweep a mob per
        // cell.
        const distance3d = Math.hypot(
          attempt.feetPosition.x - PLAYER.x,
          attempt.feetPosition.y - PLAYER.y,
          attempt.feetPosition.z - PLAYER.z,
        )

        // `persistent: false`, which is the interesting direction: a mob exempt
        // from the sweep would be kept whatever the distance, and the claim
        // would be about the exemption instead of about the ring.
        expect(
          despawnVerdict({ distanceToPlayerBlocks: distance3d, persistent: false }),
        ).toStrictEqual({ _tag: 'Keep' })
        expect(distance3d).toBeLessThan(DESPAWN_DISTANCE_BLOCKS)
      }
    }),
  )

  it.effect('carries the hour it was given, unchanged', () =>
    Effect.gen(function* () {
      // The search does not gate on time — the RULE does, and
      // `domain/mob/hostile-spawn.ts`'s header is emphatic that a second opinion
      // here would be half of the reference's death-loop bug. So a daytime hour
      // still produces candidates; they are refused one layer up.
      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, new Map(), 1, 0.5)

      expect(found.attempts.length).toBe(SPAWN_RING_CELLS)
      for (const attempt of found.attempts) {
        expect(attempt.candidate.timeOfDay).toBe(0.5)
      }
    }),
  )
})

describe('what the search reads', () => {
  it.effect('reports BLOCK light, and is not fooled by a bright sky', () =>
    Effect.gen(function* () {
      // THE DISTINCTION THE TWO GRIDS EXIST FOR. At night the sky grid still
      // holds whatever the sun left in it, and the rule gates on block light
      // alone; a search that passed `sky` through would refuse every open-air
      // cell as `too-bright` and hostiles would only ever spawn indoors.
      const lit: Array<readonly [BlockPosition, LightLevels]> = []
      for (let x = -48; x <= 47; x += 1) {
        for (let z = -48; z <= 47; z += 1) {
          lit.push([{ x, y: 64, z }, { sky: 15, block: 3 }] as const)
        }
      }

      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, lightWorld(lit))

      expect(found.attempts.length).toBe(SPAWN_RING_CELLS)
      for (const attempt of found.attempts) {
        expect(attempt.candidate.blockLight).toBe(3)
      }
    }),
  )

  it.effect('counts an unreadable cell rather than offering it as air', () =>
    Effect.gen(function* () {
      // NOTHING IS RESIDENT. The first draft of this test loaded the player's
      // own chunk on the assumption that a ring starting 16 blocks out could not
      // reach back into it — and three of the sixty-four cells do, because a
      // chunk is 16 blocks WIDE and the ring's inner radius is measured from a
      // point inside it. The blocks are still in the map either way; what makes
      // a cell unreadable is residency, so the honest setup is an empty one.
      //
      // `ChunkNotLoaded` is not air and is not darkness. The mirror's
      // `BlockReading` header records the falling-sand version of this mistake
      // (「told the cell below it is air, falls out of the world」); the spawner's
      // version puts a mob in ungenerated space.
      const { found } = yield* searchIn(FLOORED_WORLD, [])

      expect(found.attempts.length).toBe(0)
      expect(found.unreadable).toBe(SPAWN_RING_CELLS)
    }),
  )

  it.effect('costs a stated number of store calls, which is what makes the cadence checkable', () =>
    Effect.gen(function* () {
      // Three blocks and one light per cell. This number is why
      // `stages/registration.ts` paces the search at `HOSTILE_SPAWN_INTERVAL_SECS`
      // instead of running it per frame, and why the light query's own note warns
      // that a read after a write may relight a chunk.
      //
      // AN EXACT COUNT, not a bound. A bound would not notice the ring quietly
      // gaining a fifth read per cell, which is 64 extra store calls every 0.3s.
      const { store, found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS)

      expect(found.attempts.length).toBe(SPAWN_RING_CELLS)
      expect(yield* store.calls).toStrictEqual({ reads: SPAWN_RING_CELLS * 4, writes: 0, peeks: 0 })
    }),
  )

  it.effect('does not pay for the light of a cell whose blocks it could not read', () =>
    Effect.gen(function* () {
      // Three reads, then a `continue`. The light query is the expensive one —
      // it is the one that can relight a chunk — so spending it on a cell that
      // has already failed would be the one avoidable cost in the loop.
      const { store, found } = yield* searchIn(FLOORED_WORLD, [])

      expect(found.unreadable).toBe(SPAWN_RING_CELLS)
      expect(yield* store.calls).toStrictEqual({ reads: SPAWN_RING_CELLS * 3, writes: 0, peeks: 0 })
    }),
  )

  it.effect('a cell whose BLOCKS read but whose LIGHT does not is unreadable, not dark', () =>
    Effect.gen(function* () {
      // THE TWO QUERIES ARE INDEPENDENT, and the test above cannot say so: it
      // makes the whole chunk absent, so the blocks and the light fail together
      // and the light half is never reached. This one keeps the world exactly as
      // the passing case has it — floored, resident, every block readable — and
      // fails only `getLight`.
      //
      // The failure it refuses is the one `LightReading` is three-valued to
      // prevent, and it is the more dangerous direction of the two. An
      // unreadable BLOCK offers a mob a cell in ungenerated space, which the
      // rule then refuses as `not-a-surface`; an unreadable LIGHT read as
      // darkness offers a cell that looks like a legal pitch-black floor, which
      // the rule ACCEPTS. `getLight`'s own note in `domain/chunk-store-port.ts`
      // names the moment this happens — a read after a write, when a chunk is
      // mid-relight — so it is a real state and not a hypothetical one.
      //
      // The count is the assertion rather than the emptiness: `unreadable` is
      // reported precisely so a caller can tell "nothing was suitable" from
      // "nothing could be looked at", and this is the second of those with the
      // world of the first.
      const store = yield* makeChunkStoreDouble(FLOORED_WORLD, RESIDENT_CHUNKS)
      const blind: ChunkStoreApi = {
        ...store.api,
        getLight: () => Effect.succeed({ _tag: 'ChunkNotLoaded' as const }),
      }

      const found = yield* searchSpawnCandidates(blind, PLAYER, MIDNIGHT, 1)

      expect(found.attempts.length).toBe(0)
      expect(found.unreadable).toBe(SPAWN_RING_CELLS)
      // The budget is still drawn in full — the search consumed its rolls
      // whether or not it could see anything, which is the rule that keeps the
      // sequence independent of how much a frame managed to read.
      expect(found.seed).toBe(drawRolls(1, SPAWN_SEARCH_ROLLS).seed)
    }),
  )

  it.effect('never writes', () =>
    Effect.gen(function* () {
      // A search is a question. The day it places a torch to check something, it
      // has stopped being one.
      const { store } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS)
      expect((yield* store.calls).writes).toBe(0)
    }),
  )
})

describe('the search’s randomness', () => {
  it.effect('advances the seed by exactly SPAWN_SEARCH_ROLLS and by no more', () =>
    Effect.gen(function* () {
      // `domain/frame-rolls.ts`'s rule: the sequence must depend on WHAT
      // happened, not on how much work something did. A budget drawn up front
      // keeps the next mob's loot independent of how many candidates this search
      // happened to reject.
      const seed = 12_345
      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, new Map(), seed)

      expect(SPAWN_SEARCH_ROLLS).toBe(1 + SPAWN_RING_CELLS)
      expect(found.seed).toBe(drawRolls(seed, SPAWN_SEARCH_ROLLS).seed)
    }),
  )

  it.effect('draws the WHOLE budget even when every cell is unreadable', () =>
    Effect.gen(function* () {
      // The half that makes the property above worth having. A search that drew
      // per surviving candidate would advance the seed differently depending on
      // how much of the world was loaded, so a player walking towards an
      // unloaded area would silently reshuffle every later roll in the frame.
      const seed = 999
      const { found } = yield* searchIn(FLOORED_WORLD, [], new Map(), seed)

      expect(found.attempts.length).toBe(0)
      expect(found.seed).toBe(drawRolls(seed, SPAWN_SEARCH_ROLLS).seed)
    }),
  )

  it.effect('rotates the ring, so two seeds do not offer the same cells forever', () =>
    Effect.gen(function* () {
      // A FIXED ring offers the same 64 cells every attempt, so a world whose 64
      // cells all fail is a world in which nothing ever spawns — deterministic
      // and invisible. One roll per attempt is the smallest fix that removes it.
      const first = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, new Map(), 1)
      const second = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, new Map(), 777_777)

      const cellsOf = (attempts: ReadonlyArray<{ readonly feetPosition: { x: number; z: number } }>) =>
        attempts.map((attempt) => `${String(attempt.feetPosition.x)},${String(attempt.feetPosition.z)}`)

      expect(cellsOf(first.found.attempts)).not.toStrictEqual(cellsOf(second.found.attempts))
    }),
  )

  it.effect('is deterministic: one seed always searches the same ring', () =>
    Effect.gen(function* () {
      // plan.md §5.1-3 — two runs of one scenario must draw the same numbers.
      // This is the property `Math.random()` in the search would destroy, and it
      // is why `domain/frame-rolls.ts` exists.
      const first = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, new Map(), 42)
      const second = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, new Map(), 42)

      expect(first.found.attempts).toStrictEqual(second.found.attempts)
      expect(first.found.seed).toBe(second.found.seed)
    }),
  )

  it.effect('picks kinds from HOSTILE_KINDS, and reaches both of them', () =>
    Effect.gen(function* () {
      // The roster is the one the population cap sums over, so a kind cannot be
      // spawnable without being counted. Reaching BOTH matters: a `Math.floor`
      // that could never produce the last index would make the enderman
      // unspawnable and nothing else would notice.
      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, new Map(), 31_337)

      const kinds = new Set(found.attempts.map((attempt) => attempt.kind))
      for (const kind of kinds) {
        expect(HOSTILE_KINDS).toContain(kind)
      }
      expect(kinds.has(CREEPER_KIND)).toBe(true)
      expect(kinds.has(ENDERMAN_KIND)).toBe(true)
    }),
  )
})

describe('the cells the rule then refuses', () => {
  it.effect('offers a lit cell and lets the RULE call it too bright', () =>
    Effect.gen(function* () {
      // The search has no opinion about brightness. It reports what it read, and
      // `canHostileSpawnAt` compares against `HOSTILE_SPAWN_SPAWN_MAX` — which is
      // the shape `domain/mob/hostile-spawn.ts` asks for: 「a total function from
      // facts to a decision, with the facts gathered by somebody else」.
      const lit: Array<readonly [BlockPosition, LightLevels]> = []
      for (let x = -48; x <= 47; x += 1) {
        for (let z = -48; z <= 47; z += 1) {
          lit.push([{ x, y: 64, z }, { sky: 0, block: 15 }] as const)
        }
      }

      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, lightWorld(lit))

      // Still sixty-four candidates. The search did not filter them.
      expect(found.attempts.length).toBe(SPAWN_RING_CELLS)
      expect(found.attempts.every((attempt) => attempt.candidate.blockLight === 15)).toBe(true)
    }),
  )

  it.effect('offers an obstructed cell rather than pre-filtering it', () =>
    Effect.gen(function* () {
      // A world that is solid at the feet cell as well as the floor. The search
      // must report the stone it found; the `obstructed` test is the rule's, and
      // a second copy of it here would be untested and would drift.
      const solid: Array<readonly [BlockPosition, number]> = []
      for (let x = -48; x <= 47; x += 1) {
        for (let z = -48; z <= 47; z += 1) {
          solid.push([{ x, y: FLOOR_Y, z }, STONE] as const)
          solid.push([{ x, y: 64, z }, STONE] as const)
        }
      }

      const { found } = yield* searchIn(world(solid), RESIDENT_CHUNKS)

      expect(found.attempts.length).toBe(SPAWN_RING_CELLS)
      expect(found.attempts.every((attempt) => attempt.candidate.footBlock === STONE)).toBe(true)
    }),
  )

  it.effect('reads the light at the FOOT cell, which is where the mob’s body would be', () =>
    Effect.gen(function* () {
      // The rule's field is documented as 「Block light at the body cell」. Reading
      // the ground cell instead would measure the brightness of the inside of a
      // rock, which is 0 for every solid floor in the world — so every cell would
      // read dark and `too-bright` would never fire.
      const oneCellLit = lightWorld([[{ x: 0, y: 64, z: 0 }, { sky: 0, block: 9 }]])
      const store = yield* makeChunkStoreDouble(FLOORED_WORLD, RESIDENT_CHUNKS, oneCellLit)

      const reading = yield* store.api.getLight({ x: 0, y: 64, z: 0 })
      expect(reading).toStrictEqual({ _tag: 'Light', sky: 0, block: 9 })

      const ground = yield* store.api.getLight({ x: 0, y: FLOOR_Y, z: 0 })
      expect(ground).toStrictEqual({ _tag: 'Light', sky: 0, block: 0 })

      // And the search asks about the foot cell: every candidate sits at
      // `feetPosition.y`, and the light it carries is the light at that Y.
      const found = yield* searchSpawnCandidates(store.api, PLAYER, MIDNIGHT, 5)
      expect(found.attempts.every((attempt) => attempt.feetPosition.y === 64)).toBe(true)
    }),
  )
})

describe('the search inside the frame', () => {
  it.effect('is what the ARENA_MISSING row was waiting for, end to end', () =>
    Effect.gen(function* () {
      // The whole point of the exercise: a dark night world with a stone floor
      // and a player in it produces mobs, through the real stage, with nobody
      // hand-feeding a candidate into the inbox.
      const store = yield* makeChunkStoreDouble(FLOORED_WORLD, RESIDENT_CHUNKS)
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const inventory = yield* makeInventoryDouble()
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api)

      // Midnight is the default, so only the player has to be supplied — which
      // is the same one line a host writes for the creeper's ignition range.
      yield* Ref.set(state.targetPosition, PLAYER)
      expect(yield* Ref.get(state.timeOfDay)).toBe(MIDNIGHT)

      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)
      expect(entities).toBeDefined()

      // Two frames of 0.25s reaches the 0.3s cadence exactly once.
      yield* entities?.run(DeltaTimeSecs(0.25)) ?? Effect.void
      expect(yield* roster.api.count).toBe(0)

      yield* entities?.run(DeltaTimeSecs(0.25)) ?? Effect.void
      expect(yield* roster.api.count).toBeGreaterThan(0)

      // ...and the cap held on the way. Every mob on the roster is a hostile
      // this repository names, with the health and the behaviour its kind says.
      const entries = yield* roster.api.entities
      for (const entity of entries) {
        expect(HOSTILE_KINDS).toContain(entity.kind)
        expect(entity.behaviour).toBeDefined()
      }
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('an OFFERED cell and a SEARCHED ring in one frame are ONE stream against the cap', () =>
    Effect.gen(function* () {
      // The concatenation, and the only frame in which it happens: the inbox has
      // something in it AND the 0.3s cadence comes due on the same tick. Every
      // other test has one or the other — the vertical slice puts the world at
      // noon so the search cannot run, and the end-to-end case above feeds
      // nothing into the inbox — so this arm had never executed.
      //
      // WHY IT IS ONE LIST AND NOT TWO PASSES. `applySpawnAttempts` applies
      // `MAX_HOSTILE_COUNT` against a census it takes as it goes. Run twice, each
      // pass starts from the count the other left, and a frame holding one
      // offered cell and a full ring can spawn one mob PAST the cap — sixteen
      // from the ring, then the offered one against a census that was taken
      // before any of them. One stream cannot do that, and sixty-four candidates
      // plus one is the shape that shows it: the cap is what stops this frame,
      // not the supply.
      //
      // AND THE ORDER IS THE HOST'S FIRST. `offered` leads the concatenation, so
      // a cell somebody asked for is not silently outbid by a ring that happened
      // to be full — which is the failure mode of the other concatenation order
      // and would be invisible in a count.
      const store = yield* makeChunkStoreDouble(FLOORED_WORLD, RESIDENT_CHUNKS)
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const inventory = yield* makeInventoryDouble()
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api)

      const offeredAt: Position = { x: -20, y: 64, z: -20 }
      yield* Ref.set(state.targetPosition, PLAYER)
      yield* Ref.set(state.spawnAttempts, [
        {
          candidate: {
            groundBlock: STONE,
            footBlock: AIR_BLOCK_ID,
            headBlock: AIR_BLOCK_ID,
            blockLight: 0,
            timeOfDay: MIDNIGHT,
            distanceToPlayerBlocksXZ: 20,
          },
          kind: CREEPER_KIND,
          feetPosition: offeredAt,
        },
      ])

      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)
      // One frame that reaches the cadence, so the ring runs and the inbox is
      // drained in the same pass.
      yield* entities?.run(DeltaTimeSecs(HOSTILE_SPAWN_INTERVAL_SECS)) ?? Effect.void

      const entries = yield* roster.api.entities
      // The cap held over the COMBINED supply of 65 candidates.
      expect(entries.length).toBe(MAX_HOSTILE_COUNT)
      // The host's cell was taken, and taken first.
      expect(entries[0]?.feetPosition).toStrictEqual(offeredAt)
      // The inbox was drained rather than left to be re-offered next frame.
      expect(yield* Ref.get(state.spawnAttempts)).toStrictEqual([])
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('does not run in daylight, so a paced search costs nothing at noon', () =>
    Effect.gen(function* () {
      // `hostileSpawnsAllowed` is CALLED as a pre-gate, not re-derived — see the
      // comment at the call site, which argues this against
      // `domain/mob/hostile-spawn.ts`'s 「a third opinion in this file would be
      // the second half of that bug」. What is skipped is 256 store reads to be
      // told `daylight` sixty-four times.
      const store = yield* makeChunkStoreDouble(FLOORED_WORLD, RESIDENT_CHUNKS)
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble()
      const inventory = yield* makeInventoryDouble()
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api)

      yield* Ref.set(state.targetPosition, PLAYER)
      yield* Ref.set(state.timeOfDay, 0.5)

      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)
      for (let frame = 0; frame < 10; frame += 1) {
        yield* entities?.run(DeltaTimeSecs(0.25)) ?? Effect.void
      }

      expect(yield* roster.api.count).toBe(0)
      // Not one store call, across ten frames and eight would-be searches.
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0, peeks: 0 })
    }).pipe(Effect.provide(FrameServicesLayer)),
  )
})
