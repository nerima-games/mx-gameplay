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
import { AIR_BLOCK_ID, type BlockPosition } from '../domain/chunk-store-port'
import {
  CREEPER_KIND,
  ENDERMAN_KIND,
  HOSTILE_KINDS,
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
import { drawRolls } from '../domain/frame-rolls'
import {
  MAX_SPAWN_DISTANCE_BLOCKS,
  MIN_SPAWN_DISTANCE_BLOCKS,
} from '../domain/mob/hostile-spawn'
import { DeltaTimeSecs } from '../domain/frame-contract'
import { GAMEPLAY_STAGE_IDS } from '../stages/stage-ids'
import { gameplayStages, makeGameplayFrameState } from '../stages/registration'
import {
  lightWorld,
  makeChunkStoreDouble,
  STONE,
  world,
  type LightLevels,
} from './support/chunk-store-double'
import { FrameServicesLayer } from './support/frame-services'
import { makeEntityManagerDouble } from './support/entity-manager-double'

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
      expect(yield* store.calls).toStrictEqual({ reads: SPAWN_RING_CELLS * 4, writes: 0 })
    }),
  )

  it.effect('does not pay for the light of a cell whose blocks it could not read', () =>
    Effect.gen(function* () {
      // Three reads, then a `continue`. The light query is the expensive one —
      // it is the one that can relight a chunk — so spending it on a cell that
      // has already failed would be the one avoidable cost in the loop.
      const { store, found } = yield* searchIn(FLOORED_WORLD, [])

      expect(found.unreadable).toBe(SPAWN_RING_CELLS)
      expect(yield* store.calls).toStrictEqual({ reads: SPAWN_RING_CELLS * 3, writes: 0 })
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
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, store.api, roster.api)

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

  it.effect('does not run in daylight, so a paced search costs nothing at noon', () =>
    Effect.gen(function* () {
      // `hostileSpawnsAllowed` is CALLED as a pre-gate, not re-derived — see the
      // comment at the call site, which argues this against
      // `domain/mob/hostile-spawn.ts`'s 「a third opinion in this file would be
      // the second half of that bug」. What is skipped is 256 store reads to be
      // told `daylight` sixty-four times.
      const store = yield* makeChunkStoreDouble(FLOORED_WORLD, RESIDENT_CHUNKS)
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const state = yield* makeGameplayFrameState
      const stages = gameplayStages(state, store.api, roster.api)

      yield* Ref.set(state.targetPosition, PLAYER)
      yield* Ref.set(state.timeOfDay, 0.5)

      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)
      for (let frame = 0; frame < 10; frame += 1) {
        yield* entities?.run(DeltaTimeSecs(0.25)) ?? Effect.void
      }

      expect(yield* roster.api.count).toBe(0)
      // Not one store call, across ten frames and eight would-be searches.
      expect(yield* store.calls).toStrictEqual({ reads: 0, writes: 0 })
    }).pipe(Effect.provide(FrameServicesLayer)),
  )
})
