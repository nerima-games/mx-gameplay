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
import * as FastCheck from 'fast-check'
import { position as atPosition } from './support/coordinate-fixtures'
import {
  EntityId,
  makeTimeService,
  type EntityKind,
  type EntityRoster,
} from '@nerima-games/mc-sim'
import { Effect, Ref, Result, Schema } from 'effect'
import { AIR_BLOCK_ID, BlockAxis, BlockId, DeltaTimeSecs, EntitySerial, InterpolationFraction, RandomSeed, SimulationTick, blockPosition as makeBlockPosition, type BlockPosition, type Position } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT, type ChunkStoreApi, type Dimension, type ReadonlyChunk } from '@nerima-games/mc-worldgen'
import {
  CREEPER_KIND,
  ENDERMAN_KIND,
  HOSTILE_KINDS,
  initialBehaviourOfKind,
  MAX_PASSIVE_COUNT,
  maxHealthOfKind,
  planSpawnAttemptsOnRoster,
  type MobBehaviour,
} from '../src/domain/entities/mob-frame'
import {
  searchSpawnCandidates,
  SPAWN_RING_ANGLES,
  SPAWN_RING_CELLS,
  SPAWN_RING_RADII,
  SPAWN_RING_RADIUS_INSET_BLOCKS,
  SPAWN_RING_RADIUS_STEPS,
  SPAWN_SEARCH_ROLLS,
} from '../src/domain/entities/mob-spawn-search'
import { drawRolls as drawRollsResult, rollAt as rollAtResult } from '../src/domain/frame-rolls'
import { isNight as isNightResult } from '../src/domain/day-night'
import { DESPAWN_DISTANCE_BLOCKS, despawnVerdict as despawnVerdictResult } from '../src/domain/mob/hostile-despawn'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat'
import { NETHER_HOSTILE_KINDS, PASSIVE_MOB_KINDS } from '../src/domain/mob/mob-ecosystem'
import {
  HOSTILE_SPAWN_SETTINGS,
  hostileSpawnSearchDue,
  MOB_BIOME_SPAWN_TABLE,
  MAX_SPAWN_DISTANCE_BLOCKS,
  MIN_SPAWN_DISTANCE_BLOCKS,
  SkyLightLevel,
} from '../src/domain/mob/hostile-spawn'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GameplayEntityRosterSchema,
} from '../src/stages/gameplay-owner-registrations'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import {
  gameplayStages,
  makeGameplayFrameState,
  drainGameplayEntityStageFaults,
} from '../src/stages/registration'
import {
  HOSTILE_SPAWN_INTERVAL_TICKS,
  PASSIVE_SPAWN_BATCH_SIZE,
} from '../src/stages/registration-core'
import {
  blockKey,
  biomeWorld,
  lightWorld,
  makeChunkStoreDouble,
  STONE,
  world,
  type LightLevels,
} from './support/chunk-store-double'
import { FrameServicesLayer } from './support/frame-services'
import { runFrame, runFrames } from './support/frame-runner'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { makePlayerServiceDouble, SPAWN_POSE } from './support/player-service-double'
import { makeInventoryDouble } from './support/inventory-service-double'
import { makeGameplayCommitServices } from './support/transactional-stage-doubles'

const drawRolls = (...args: Parameters<typeof drawRollsResult>) => Result.getOrThrow(drawRollsResult(...args))
const rollAt = (...args: Parameters<typeof rollAtResult>) => Result.getOrThrow(rollAtResult(...args))
const isNight = (timeOfDay: number) => Result.getOrThrow(isNightResult(timeOfDay))
const despawnVerdict = (...args: Parameters<typeof despawnVerdictResult>) =>
  Result.getOrThrow(despawnVerdictResult(...args))

// ---------------------------------------------------------------------------
// A world big enough for the ring to land in.
//
// The outermost radius is `MAX_SPAWN_DISTANCE_BLOCKS`, so every chunk within 40
// blocks of the player has to be resident or the search reports `unreadable`
// instead of offering anything. That is itself a property worth testing, and it
// is — separately, below.
// ---------------------------------------------------------------------------

const blockPosition = (x: number, y: number, z: number): BlockPosition =>
  makeBlockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))

const PLAYER = atPosition(0.5, 64, 0.5 )
const FLOOR_Y = 63
const MIDNIGHT = InterpolationFraction(0.9)

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
  const cells: Array<readonly [BlockPosition, BlockId]> = []
  for (let x = -48; x <= 47; x += 1) {
    for (let z = -48; z <= 47; z += 1) {
      cells.push([blockPosition(x, FLOOR_Y, z), STONE] as const)
    }
  }
  return world(cells)
})()

const NETHER_BIOME_WORLD = biomeWorld(
  Array.from({ length: 96 * 96 }, (_, index) => {
    const x = index % 96 - 48
    const z = Math.floor(index / 96) - 48
    return [blockPosition(x, 0, z), 'NETHER'] as const
  }),
)

const CAVE_FLOORED_WORLD = (() => {
  const cells: Array<readonly [BlockPosition, BlockId]> = []
  for (let x = -48; x <= 47; x += 1) {
    for (let z = -48; z <= 47; z += 1) {
      cells.push([blockPosition(x, FLOOR_Y, z), STONE] as const)
      cells.push([blockPosition(x, 30, z), STONE] as const)
    }
  }
  return world(cells)
})()

const TEST_TICKS_PER_DAY = 24_000
const NIGHT_DISTRIBUTION_SEEDS = [1, 42, 2026] as const
const brightSkyAt = (y: number) => lightWorld(
  Array.from({ length: 96 * 96 }, (_, index) => {
    const x = index % 96 - 48
    const z = Math.floor(index / 96) - 48
    return [blockPosition(x, y, z), { sky: 15, block: 0 }] as const
  }),
)
const BRIGHT_SURFACE_LIGHT = brightSkyAt(64)
const DISTRIBUTION_FLOOR_Y = 251
const DISTRIBUTION_WORLD = world(
  Array.from({ length: 96 * 96 }, (_, index) => {
    const x = index % 96 - 48
    const z = Math.floor(index / 96) - 48
    return [blockPosition(x, DISTRIBUTION_FLOOR_Y, z), STONE] as const
  }),
)
const DISTRIBUTION_LIGHT = brightSkyAt(DISTRIBUTION_FLOOR_Y + 1)
const DISTRIBUTION_PLAYER = atPosition(0.5, DISTRIBUTION_FLOOR_Y - 15, 0.5)

const searchIn = (
  blocks: ReadonlyMap<string, BlockId>,
  loaded: ReadonlyArray<string>,
  lights: ReadonlyMap<string, LightLevels> = new Map(),
  seed = 1,
  timeOfDay = MIDNIGHT,
  mode: 'hostile' | 'passive' = 'hostile',
  dimension: Dimension = 'overworld',
) =>
  Effect.gen(function* () {
    const store = yield* makeChunkStoreDouble(blocks, loaded, lights)
    const found = yield* searchSpawnCandidates(store.api, PLAYER, timeOfDay, RandomSeed(seed), dimension, mode)
    return { store, found }
  })

const makeStageHarness = (
  blocks: ReadonlyMap<string, BlockId>,
  lights: ReadonlyMap<string, LightLevels>,
  playerFeet: Position,
  initialRoster?: EntityRoster<MobBehaviour>,
) =>
  Effect.gen(function* () {
    const store = yield* makeChunkStoreDouble(blocks, RESIDENT_CHUNKS, lights)
    const roster = initialRoster === undefined
      ? yield* makeEntityManagerDouble<MobBehaviour>()
      : yield* makeEntityManagerDouble(initialRoster)
    const playerPose = { ...SPAWN_POSE, feetPosition: playerFeet }
    const player = yield* makePlayerServiceDouble(playerPose)
    const inventory = yield* makeInventoryDouble()
    const time = yield* makeTimeService()
    const state = yield* makeGameplayFrameState
    const commit = yield* makeGameplayCommitServices(store.api, inventory.api, {
      playerPose,
      ...(initialRoster === undefined ? {} : { entities: initialRoster }),
    })
    const stages = gameplayStages(
      state,
      store.api,
      roster.api,
      inventory.api,
      player.api,
      time,
      undefined,
      undefined,
      {},
      commit,
    )
    return { store, roster, time, state, commit, stages }
  })

const seededRoster = (
  kind: EntityKind,
  count: number,
  feetAt: (index: number) => Position,
): EntityRoster<MobBehaviour> => ({
  entities: Array.from({ length: count }, (_, index) => ({
    id: EntityId(`seeded-${kind}-${String(index)}`),
    kind,
    feetPosition: feetAt(index),
    healthPoints: maxHealthOfKind(kind),
    behaviour: initialBehaviourOfKind(kind),
  })),
  nextSerial: EntitySerial(count),
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
      expect(SPAWN_RING_RADIUS_STEPS[0]).toBe(MIN_SPAWN_DISTANCE_BLOCKS + SPAWN_RING_RADIUS_INSET_BLOCKS)
      expect(SPAWN_RING_RADIUS_STEPS[SPAWN_RING_RADII - 1]).toBe(MAX_SPAWN_DISTANCE_BLOCKS - SPAWN_RING_RADIUS_INSET_BLOCKS)
      expect(SPAWN_RING_RADIUS_INSET_BLOCKS).toBe(2)
      expect(SPAWN_RING_RADIUS_STEPS).toStrictEqual([26, 30, 34, 38])
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
        // A column scan finds the floor at y=63 and places feet at y=64.
        expect(attempt.feetPosition.y).toBe(64)
        expect(attempt.candidate.groundBlock).toBe(STONE)
        expect(attempt.candidate.footBlock).toBe(AIR_BLOCK_ID)
        expect(attempt.candidate.headBlock).toBe(AIR_BLOCK_ID)
      }
    }),
  )

  it.effect('finds a dark cave floor below a bright surface during daytime', () =>
    Effect.gen(function* () {
      const surfaceLight: Array<readonly [BlockPosition, LightLevels]> = []
      for (let x = -48; x <= 47; x += 1) {
        for (let z = -48; z <= 47; z += 1) {
          surfaceLight.push([blockPosition(x, 64, z), { sky: 15, block: 0 }] as const)
        }
      }
      const { found } = yield* searchIn(
        CAVE_FLOORED_WORLD,
        RESIDENT_CHUNKS,
        lightWorld(surfaceLight),
        3,
        InterpolationFraction(0.5),
      )

      expect(found.attempts).toHaveLength(SPAWN_RING_CELLS)
      expect(found.attempts.every(({ feetPosition }) => feetPosition.y === 31)).toBe(true)
      expect(found.attempts.every(({ candidate }) => candidate.skyLight === 0)).toBe(true)
    }),
  )

  it.effect('the registered entity stage spawns from the dark cave below a bright daytime surface', () =>
    Effect.gen(function* () {
      const { time, state, commit, stages, store } = yield* makeStageHarness(
        CAVE_FLOORED_WORLD,
        BRIGHT_SURFACE_LIGHT,
        PLAYER,
      )
      yield* Ref.set(state.passiveInitialSpawnPending, false)
      yield* time.setTimeOfDay(InterpolationFraction(0.5))

      yield* runFrames(stages, HOSTILE_SPAWN_INTERVAL_TICKS, DeltaTimeSecs(0.05))

      const ownerAfter = yield* commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const entries = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(ownerAfter.state).entities
      const hostiles = entries.filter(({ kind }) => HOSTILE_KINDS.includes(kind))
      expect(hostiles).toHaveLength(1)
      expect(hostiles[0]?.feetPosition.y).toBe(31)
      expect(yield* Ref.get(state.lastHostileSpawnTick)).toBe(HOSTILE_SPAWN_INTERVAL_TICKS)
      expect((yield* store.calls).peeks).toBeGreaterThan(0)
    }),
  )

  it.effect('the registered entity stage drains unregistered spawn-surface faults and completes the tick', () =>
    Effect.gen(function* () {
      const unknownBlock = BlockId(65_535)
      const unknownWorld = world(Array.from({ length: 96 * 96 }, (_, index) => {
        const x = index % 96 - 48
        const z = Math.floor(index / 96) - 48
        return [blockPosition(x, FLOOR_Y, z), unknownBlock] as const
      }))
      const { time, state, stages } = yield* makeStageHarness(
        unknownWorld,
        DISTRIBUTION_LIGHT,
        DISTRIBUTION_PLAYER,
      )
      yield* time.setTimeOfDay(MIDNIGHT)
      yield* Ref.set(state.passiveInitialSpawnPending, false)
      yield* Ref.set(state.tickCount, HOSTILE_SPAWN_INTERVAL_TICKS)
      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)
      yield* entities?.run(DeltaTimeSecs(0)) ?? Effect.void

      const faults = yield* drainGameplayEntityStageFaults(state)
      expect(faults.length).toBeGreaterThan(0)
      expect(faults.every((fault) =>
        fault._tag === 'EntityWorldDataFault' && fault.source === 'MobSpawnSearch' &&
        fault.failure._tag === 'EntityWorldUnregisteredBlockId' && fault.failure.blockId === unknownBlock,
      )).toBe(true)
    }).pipe(Effect.provide(FrameServicesLayer)),
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
        expect(attempt.candidate.distanceToPlayerBlocksXZ).toBeGreaterThan(
          MIN_SPAWN_DISTANCE_BLOCKS - Number.EPSILON,
        )
        expect(attempt.candidate.distanceToPlayerBlocksXZ).toBeLessThan(
          MAX_SPAWN_DISTANCE_BLOCKS + Number.EPSILON,
        )
      }
    }),
  )

  it.effect('SPANS the four radii — every step is actually probed, not just the inner one', () =>
    Effect.gen(function* () {
      // FOUND BY A MUTATION, and it was the one the loop's own comment predicted.
      // Replacing the per-step radius with the inner radius — a ring that probes
      // the same circle four times and never looks farther — passed
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
        const distance = MIN_SPAWN_DISTANCE_BLOCKS + SPAWN_RING_RADIUS_INSET_BLOCKS +
          ((MAX_SPAWN_DISTANCE_BLOCKS - MIN_SPAWN_DISTANCE_BLOCKS - SPAWN_RING_RADIUS_INSET_BLOCKS * 2) * radiusIndex) /
            (SPAWN_RING_RADII - 1)

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
      expect(quarterTurn.z).toBeCloseTo(PLAYER.z + MIN_SPAWN_DISTANCE_BLOCKS + SPAWN_RING_RADIUS_INSET_BLOCKS, 10)

      expect(SPAWN_RING_RADIUS_STEPS[0]).toBe(MIN_SPAWN_DISTANCE_BLOCKS + SPAWN_RING_RADIUS_INSET_BLOCKS)
      expect(SPAWN_RING_RADIUS_STEPS[SPAWN_RING_RADII - 1]).toBe(MAX_SPAWN_DISTANCE_BLOCKS - SPAWN_RING_RADIUS_INSET_BLOCKS)

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
      // The daytime fraction is carried to the rule, which combines it with raw
      // sky light rather than treating time as a global hostile gate.
      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, new Map(), 1, InterpolationFraction(0.5))

      expect(found.attempts.length).toBe(SPAWN_RING_CELLS)
      for (const attempt of found.attempts) {
        expect(attempt.candidate.timeOfDay).toBe(0.5)
      }
    }),
  )
})

describe('spawn search input validation', () => {
  it.effect('rejects every invalid target coordinate, time fraction, and present optional value', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(new Map(), [])
      const anyNumber = FastCheck.double({ noNaN: false, noDefaultInfinity: false })

      FastCheck.assert(FastCheck.property(anyNumber, (x) => {
        const result = Effect.runSync(Effect.result(searchSpawnCandidates(
          store.api,
          { ...PLAYER, x } as Position,
          MIDNIGHT,
          RandomSeed(1),
        )))
        return Result.isFailure(result) === !Number.isFinite(x)
      }))
      FastCheck.assert(FastCheck.property(anyNumber, (timeOfDay) => {
        const result = Effect.runSync(Effect.result(searchSpawnCandidates(
          store.api,
          PLAYER,
          timeOfDay as never,
          RandomSeed(1),
        )))
        const valid = Number.isFinite(timeOfDay) && timeOfDay >= 0 && timeOfDay < 1
        return Result.isFailure(result) === !valid
      }))

      expect(Result.isFailure(Effect.runSync(Effect.result(searchSpawnCandidates(
        store.api,
        PLAYER,
        MIDNIGHT,
        RandomSeed(1),
        undefined as unknown as Dimension,
      ))))).toBe(true)
      expect(Result.isFailure(Effect.runSync(Effect.result(searchSpawnCandidates(
        store.api,
        PLAYER,
        MIDNIGHT,
        RandomSeed(1),
        'overworld',
        undefined as never,
      ))))).toBe(true)
      expect(Result.isFailure(Effect.runSync(Effect.result(searchSpawnCandidates(
        store.api,
        PLAYER,
        MIDNIGHT,
        RandomSeed(1),
        'invalid' as unknown as Dimension,
      ))))).toBe(true)
    }),
  )
})

describe('fixed-seed one-night spawn distribution', () => {
  const runNight = (initialSeed: number) => Effect.gen(function* () {
    let seed = initialSeed
    let lastSearchTick = 0
    const store = yield* makeChunkStoreDouble(
      DISTRIBUTION_WORLD,
      RESIDENT_CHUNKS,
      DISTRIBUTION_LIGHT,
    )
    let roster: EntityRoster<MobBehaviour> = {
      entities: [],
      nextSerial: EntitySerial(0),
    }

    const intervalTicks = HOSTILE_SPAWN_SETTINGS.normal.intervalTicks
    let firstNightSearchTick = intervalTicks
    while (
      firstNightSearchTick <= TEST_TICKS_PER_DAY &&
      !isNight(firstNightSearchTick / TEST_TICKS_PER_DAY)
    ) {
      firstNightSearchTick += intervalTicks
    }
    const skippedDaySearches = firstNightSearchTick / intervalTicks - 1
    seed = drawRolls(seed, skippedDaySearches * SPAWN_SEARCH_ROLLS).seed
    for (let tick = firstNightSearchTick; tick <= TEST_TICKS_PER_DAY; tick += intervalTicks) {
      // This harness never despawns; after the cap, later night ticks cannot change the count under test.
      if (roster.entities.length >= HOSTILE_SPAWN_SETTINGS.normal.maxPopulation) break
      const due = Result.getOrThrow(hostileSpawnSearchDue(
        SimulationTick(tick),
        SimulationTick(lastSearchTick),
        'normal',
      ))
      if (!due) continue
      lastSearchTick = tick
      const timeOfDay = tick / TEST_TICKS_PER_DAY

      const found = yield* searchSpawnCandidates(
        store.api,
        DISTRIBUTION_PLAYER,
        InterpolationFraction(timeOfDay),
        RandomSeed(seed),
        'overworld',
        'hostile',
      )
      seed = found.seed
      const first = found.attempts[0]
      expect(first, `expected an eligible spawn candidate at tick ${String(tick)}`).toBeDefined()
      if (first === undefined) continue
      const planned = planSpawnAttemptsOnRoster(roster, [first], 'normal')
      if (Result.isSuccess(planned)) roster = planned.success.roster
    }

    return roster.entities.length
  })

  it.effect('replays the same full-night count vector across fixed seeds', () =>
    Effect.gen(function* () {
      const counts: Array<number> = []
      for (const seed of NIGHT_DISTRIBUTION_SEEDS) {
        counts.push(yield* runNight(seed))
      }
      const firstSeedReplay = yield* runNight(NIGHT_DISTRIBUTION_SEEDS[0])

      expect(counts).toStrictEqual([9, 9, 9])
      expect(firstSeedReplay).toBe(counts[0])
    }),
  )
})

describe('what the search reads', () => {
  it.effect('counts ring cells beyond the safe block grid as unreadable', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(FLOORED_WORLD, RESIDENT_CHUNKS)
      const farTarget = atPosition(Number.MAX_SAFE_INTEGER * 4, PLAYER.y, PLAYER.z)

      const found = yield* searchSpawnCandidates(store.api, farTarget, MIDNIGHT, RandomSeed(7))

      expect(found.attempts).toStrictEqual([])
      expect(found.unreadable).toBe(SPAWN_RING_CELLS)
      expect(found.worldFaults.every((fault) => fault._tag === 'EntityWorldCorruptBuffer')).toBe(true)
      expect(yield* store.calls).toMatchObject({ reads: 0, writes: 0 })
    }),
  )

  it.effect('carries both raw sky light and block light into the rule', () =>
    Effect.gen(function* () {
      // Raw sky light stays high at night; time-of-day admits this exposed cell.
      const lit: Array<readonly [BlockPosition, LightLevels]> = []
      for (let x = -48; x <= 47; x += 1) {
        for (let z = -48; z <= 47; z += 1) {
          lit.push([blockPosition(x, 64, z), { sky: 15, block: 0 }] as const)
        }
      }

      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, lightWorld(lit), 1, InterpolationFraction(0.9))

      expect(found.attempts.length).toBe(SPAWN_RING_CELLS)
      for (const attempt of found.attempts) {
        expect(attempt.candidate.blockLight).toBe(0)
        expect(attempt.candidate.skyLight).toBe(15)
      }

      const rejected = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, lightWorld(
        lit.map(([cell]) => [cell, { sky: 15, block: 1 }] as const),
      ), 1, InterpolationFraction(0.9))
      expect(rejected.found.attempts).toHaveLength(0)
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

  it.effect('counts a chunk with an unreadable block buffer rather than treating it as air', () =>
    Effect.gen(function* () {
      const store = yield* makeChunkStoreDouble(FLOORED_WORLD, RESIDENT_CHUNKS)
      const blocks = new Proxy(new Uint16Array(CHUNK_HEIGHT * 256), {
        get: (target, property) => typeof property === 'string' && /^\d+$/.test(property)
          ? undefined
          : Reflect.get(target, property, target),
      })
      const api: ChunkStoreApi = {
        ...store.api,
        peek: (coord) => Effect.succeed({
          coord,
          blocks,
          biomes: Array.from({ length: 256 }, () => 'PLAINS' as const),
        } satisfies ReadonlyChunk),
      }

      const found = yield* searchSpawnCandidates(api, PLAYER, MIDNIGHT, RandomSeed(7))

      expect(found.attempts).toStrictEqual([])
      expect(found.unreadable).toBe(SPAWN_RING_CELLS)
    }),
  )

  it.effect('reports the missing foot and head cells at their own buffer indices', () =>
    Effect.gen(function* () {
      for (const { missingY, expectedY } of [
        { missingY: CHUNK_HEIGHT - 2, expectedY: CHUNK_HEIGHT - 2 },
        { missingY: CHUNK_HEIGHT - 1, expectedY: CHUNK_HEIGHT - 1 },
      ]) {
        const blocks = new Proxy(new Uint16Array(CHUNK_HEIGHT * 256), {
          get: (target, property) => {
            if (typeof property === 'string' && /^\d+$/.test(property)) {
              const index = Number(property)
              if (index % CHUNK_HEIGHT === missingY) return undefined
            }
            return Reflect.get(target, property, target)
          },
        })
        const store = yield* makeChunkStoreDouble(FLOORED_WORLD, RESIDENT_CHUNKS)
        const api: ChunkStoreApi = {
          ...store.api,
          peek: (coord) => Effect.succeed({
            coord,
            blocks,
            biomes: Array.from({ length: 256 }, () => 'PLAINS' as const),
          } satisfies ReadonlyChunk),
        }

        const found = yield* searchSpawnCandidates(api, PLAYER, MIDNIGHT, RandomSeed(7))
        const fault = found.worldFaults[0]

        expect(found.attempts).toStrictEqual([])
        expect(found.unreadable).toBe(SPAWN_RING_CELLS)
        expect(fault).toMatchObject({
          _tag: 'EntityWorldCorruptBuffer',
          cell: { y: BlockAxis(expectedY) },
        })
        if (fault?._tag === 'EntityWorldCorruptBuffer') {
          expect(fault.index % CHUNK_HEIGHT).toBe(expectedY)
          expect(fault.length).toBe(CHUNK_HEIGHT * 256)
        }
      }
    }),
  )

  it.effect('counts malformed chunk dimensions and missing biome data as unreadable', () =>
    Effect.gen(function* () {
      const readableBlocks = new Uint16Array(CHUNK_HEIGHT * 256)
      const readableBiomes = Array.from({ length: 256 }, () => 'PLAINS' as const)
      const missingBiome = new Proxy(readableBiomes, {
        get: (target, property, receiver) => typeof property === 'string' && Number.isInteger(Number(property))
          ? undefined
          : Reflect.get(target, property, receiver),
      })
      const malformedChunks: ReadonlyArray<Readonly<{
        chunkForCoord: (coord: ReadonlyChunk['coord']) => ReadonlyChunk
        hasBlockFault: boolean
      }>> = [
        { chunkForCoord: (coord) => ({ coord, blocks: readableBlocks, biomes: [] }), hasBlockFault: false },
        { chunkForCoord: (coord) => ({ coord, blocks: readableBlocks, biomes: missingBiome }), hasBlockFault: false },
        {
          chunkForCoord: (coord) => ({
            coord,
            blocks: new Uint16Array(CHUNK_HEIGHT * 256 - 1),
            biomes: readableBiomes,
          }),
          hasBlockFault: true,
        },
      ]

      for (const { chunkForCoord, hasBlockFault } of malformedChunks) {
        const store = yield* makeChunkStoreDouble(FLOORED_WORLD, RESIDENT_CHUNKS)
        const api: ChunkStoreApi = {
          ...store.api,
          peek: (coord) => Effect.succeed(chunkForCoord(coord)),
        }
        const found = yield* searchSpawnCandidates(api, PLAYER, MIDNIGHT, RandomSeed(7))

        expect(found.attempts).toStrictEqual([])
        expect(found.unreadable).toBe(SPAWN_RING_CELLS)
        expect(found.worldFaults.some((fault) => fault._tag === 'EntityWorldCorruptBuffer')).toBe(hasBlockFault)
      }
    }),
  )

  it.effect('returns an unregistered block id as a typed world fault', () =>
    Effect.gen(function* () {
      const unknownBlock = BlockId(65_535)
      const unknownWorld = world(Array.from({ length: 96 * 96 }, (_, index) => {
        const x = index % 96 - 48
        const z = Math.floor(index / 96) - 48
        return [blockPosition(x, FLOOR_Y, z), unknownBlock] as const
      }))
      const { found } = yield* searchIn(unknownWorld, RESIDENT_CHUNKS)

      expect(found.attempts).toStrictEqual([])
      expect(found.worldFaults.length).toBeGreaterThan(0)
      expect(found.worldFaults.every((fault) =>
        fault._tag === 'EntityWorldUnregisteredBlockId' && fault.blockId === unknownBlock,
      )).toBe(true)
      expect(found.seed).toBe(drawRolls(1, SPAWN_SEARCH_ROLLS).seed)
    }),
  )

  it.effect('does not search passive candidates in the Nether', () =>
    Effect.gen(function* () {
      const { store, found } = yield* searchIn(
        FLOORED_WORLD,
        RESIDENT_CHUNKS,
        new Map(),
        7,
        MIDNIGHT,
        'passive',
        'nether',
      )

      expect(found.attempts).toStrictEqual([])
      expect(found.unreadable).toBe(0)
      expect((yield* store.calls).peeks).toBeGreaterThan(0)
    }),
  )

  it.effect('does not read the End and spawns Endermen from Nether search candidates', () =>
    Effect.gen(function* () {
      const end = yield* searchIn(
        FLOORED_WORLD,
        RESIDENT_CHUNKS,
        new Map(),
        7,
        MIDNIGHT,
        'hostile',
        'end',
      )
      expect(end.found.attempts).toStrictEqual([])
      expect(end.found.unreadable).toBe(0)
      expect((yield* end.store.calls).peeks).toBe(0)

      const overworld = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, new Map(), 7)
      expect(overworld.found.attempts.some(({ kind }) => kind === ENDERMAN_KIND)).toBe(true)

      const netherStore = yield* makeChunkStoreDouble(
        FLOORED_WORLD,
        RESIDENT_CHUNKS,
        new Map(),
        NETHER_BIOME_WORLD,
      )
      const netherFound = yield* searchSpawnCandidates(
        netherStore.api,
        PLAYER,
        MIDNIGHT,
        RandomSeed(7),
        'nether',
      )
      expect(netherFound.attempts).toHaveLength(SPAWN_RING_CELLS)
      expect(netherFound.attempts.every(({ kind, candidate }) =>
        NETHER_HOSTILE_KINDS.some((netherKind) => netherKind === kind) &&
        candidate.dimension === 'nether',
      )).toBe(true)
      const endermanAttempt = netherFound.attempts.find(({ kind }) => kind === ENDERMAN_KIND)
      expect(endermanAttempt).toBeDefined()
      if (endermanAttempt === undefined) return

      const spawned = planSpawnAttemptsOnRoster(
        { entities: [], nextSerial: EntitySerial(0) },
        [endermanAttempt],
        'normal',
      )
      expect(Result.isSuccess(spawned)).toBe(true)
      if (Result.isSuccess(spawned)) {
        expect(spawned.success.roster.entities.map(({ kind }) => kind)).toContain(ENDERMAN_KIND)
      }
      expect(netherFound.unreadable).toBe(0)
      expect((yield* netherStore.calls).peeks).toBeGreaterThan(0)
    }),
  )

  it.effect('keeps scanning below an obstructed column without offering it', () =>
    Effect.gen(function* () {
      const rotation = rollAt(drawRolls(7, SPAWN_SEARCH_ROLLS), 0)
      const angle = (rotation / SPAWN_RING_ANGLES) * 2 * Math.PI
      const radius = MIN_SPAWN_DISTANCE_BLOCKS + SPAWN_RING_RADIUS_INSET_BLOCKS
      const blockedX = Math.floor(PLAYER.x + radius * Math.cos(angle))
      const blockedZ = Math.floor(PLAYER.z + radius * Math.sin(angle))
      const blockedWorld = new Map(FLOORED_WORLD)
      for (let y = 31; y <= 255; y += 1) {
        blockedWorld.set(blockKey(blockPosition(blockedX, y, blockedZ)), STONE)
      }

      const { found } = yield* searchIn(blockedWorld, RESIDENT_CHUNKS, new Map(), 7)

      expect(found.attempts.length).toBeGreaterThan(0)
      expect(found.attempts.some(({ feetPosition }) =>
        feetPosition.x === blockedX && feetPosition.z === blockedZ,
      )).toBe(false)
    }),
  )

  it.effect('costs a stated number of store calls, which is what makes the cadence checkable', () =>
    Effect.gen(function* () {
      // Each sampled column comes from a cached chunk snapshot; one selected
      // foot-cell light reading crosses the store API.
      //
      // AN EXACT COUNT, not a bound. A bound would not notice the ring quietly
      // gaining an extra store read per cell.
      const { store, found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS)

      expect(found.attempts.length).toBe(SPAWN_RING_CELLS)
      const calls = yield* store.calls
      expect(calls.reads).toBe(SPAWN_RING_CELLS)
      expect(calls.writes).toBe(0)
      expect(calls.peeks).toBeGreaterThan(0)
    }),
  )

  it.effect('does not pay for the light of a cell whose blocks it could not read', () =>
    Effect.gen(function* () {
      // Three reads, then a `continue`. The light query is the expensive one —
      // it is the one that can relight a chunk — so spending it on a cell that
      // has already failed would be the one avoidable cost in the loop.
      const { store, found } = yield* searchIn(FLOORED_WORLD, [])

      expect(found.unreadable).toBe(SPAWN_RING_CELLS)
      const calls = yield* store.calls
      expect(calls.reads).toBe(0)
      expect(calls.writes).toBe(0)
      expect(calls.peeks).toBeGreaterThan(0)
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
      // the rule ACCEPTS. `getLight`'s own note in `@nerima-games/mc-worldgen`
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

      const found = yield* searchSpawnCandidates(blind, PLAYER, MIDNIGHT, RandomSeed(1))

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

  it.effect('picks kinds from HOSTILE_KINDS, and reaches all of them', () =>
    Effect.gen(function* () {
      // The roster is the one the population cap sums over, so a kind cannot be
      // spawnable without being counted. Reaching every kind matters: a `Math.floor`
      // that could never produce the last index would make the zombie
      // unspawnable and nothing else would notice.
      const { found } = yield* searchIn(FLOORED_WORLD, RESIDENT_CHUNKS, new Map(), 31_337)

      const kinds = new Set(found.attempts.map((attempt) => attempt.kind))
      for (const kind of kinds) {
        expect(HOSTILE_KINDS).toContain(kind)
      }
      expect(kinds.has(CREEPER_KIND)).toBe(true)
      expect(kinds.has(ENDERMAN_KIND)).toBe(true)
      expect(kinds.has(ZOMBIE_KIND)).toBe(true)
    }),
  )
})

describe('the search filters unsuitable floors before offering them', () => {
  it.effect('skips a bright surface during daylight', () =>
    Effect.gen(function* () {
      // The daytime surface is skipped, while the rule still accepts a low-sky
      // cave candidate (covered above).
      const lit: Array<readonly [BlockPosition, LightLevels]> = []
      for (let x = -48; x <= 47; x += 1) {
        for (let z = -48; z <= 47; z += 1) {
          lit.push([blockPosition(x, 64, z), { sky: 15, block: 0 }] as const)
        }
      }

      const { found } = yield* searchIn(
        FLOORED_WORLD,
        RESIDENT_CHUNKS,
        lightWorld(lit),
        1,
        InterpolationFraction(0.5),
      )

      expect(found.attempts).toHaveLength(0)
      expect(found.unreadable).toBe(0)
    }),
  )

  it.effect('finds the top valid floor above a short column obstruction', () =>
    Effect.gen(function* () {
      // The scan treats each non-air block as a potential floor and uses the
      // first valid topmost one.
      const solid: Array<readonly [BlockPosition, BlockId]> = []
      for (let x = -48; x <= 47; x += 1) {
        for (let z = -48; z <= 47; z += 1) {
          solid.push([blockPosition(x, FLOOR_Y, z), STONE] as const)
          solid.push([blockPosition(x, 64, z), STONE] as const)
        }
      }

      const { found } = yield* searchIn(world(solid), RESIDENT_CHUNKS)

      expect(found.attempts.length).toBe(SPAWN_RING_CELLS)
      expect(found.attempts.every((attempt) => attempt.feetPosition.y === 65)).toBe(true)
      expect(found.attempts.every((attempt) => attempt.candidate.groundBlock === STONE)).toBe(true)
    }),
  )

  it.effect('reads the light at the FOOT cell, which is where the mob’s body would be', () =>
    Effect.gen(function* () {
      // The rule's field is documented as 「Block light at the body cell」. Reading
      // the ground cell instead would measure the brightness of the inside of a
      // rock, which is 0 for every solid floor in the world — so every cell would
      // read dark and `too-bright` would never fire.
      const store = yield* makeChunkStoreDouble(FLOORED_WORLD, RESIDENT_CHUNKS)
      const lightPositions: Array<BlockPosition> = []
      const observed: ChunkStoreApi = {
        ...store.api,
        getLight: (position) => Effect.map(
          store.api.getLight(position),
          (light) => {
            lightPositions.push(position)
            return light
          },
        ),
      }
      const found = yield* searchSpawnCandidates(observed, PLAYER, MIDNIGHT, RandomSeed(5))
      expect(found.attempts).toHaveLength(SPAWN_RING_CELLS)
      expect(lightPositions).toHaveLength(SPAWN_RING_CELLS)
      expect(lightPositions.every(({ y }) => y === 64)).toBe(true)
    }),
  )
})

describe('the search inside the frame', () => {
  it.effect('spawns from a daytime cave on the 30th registered stage pass', () =>
    Effect.gen(function* () {
      const { store, time, state, commit, stages } = yield* makeStageHarness(
        CAVE_FLOORED_WORLD,
        BRIGHT_SURFACE_LIGHT,
        PLAYER,
      )
      yield* Ref.set(state.passiveInitialSpawnPending, false)
      yield* time.setTimeOfDay(InterpolationFraction(0.5))

      // `entities` runs before `fluids`; the shared tick counter therefore
      // still reads 28 inside `entities` on pass 29. It uses that upcoming
      // pass number for cadence and stores the same value after a successful search.
      yield* runFrames(stages, 29, DeltaTimeSecs(0.05))
      expect(yield* Ref.get(state.tickCount)).toBe(29)
      expect(yield* Ref.get(state.lastHostileSpawnTick)).toBe(0)

      const beforeSearch = yield* commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      expect(Schema.decodeUnknownSync(GameplayEntityRosterSchema)(beforeSearch.state).entities)
        .toHaveLength(0)

      yield* runFrame(stages, DeltaTimeSecs(0.05))
      expect(yield* Ref.get(state.tickCount)).toBe(HOSTILE_SPAWN_INTERVAL_TICKS)
      expect(yield* Ref.get(state.lastHostileSpawnTick)).toBe(HOSTILE_SPAWN_INTERVAL_TICKS)
      expect(yield* time.timeOfDay).toBeGreaterThanOrEqual(0.5)
      expect(yield* time.timeOfDay).toBeLessThan(0.55)

      const afterSearch = yield* commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const entries = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(afterSearch.state).entities
      expect(entries).toHaveLength(1)
      for (const entity of entries) {
        expect(entity.feetPosition.y).toBe(31)
        expect(MOB_BIOME_SPAWN_TABLE.PLAINS).toContain(entity.kind)
        expect(HOSTILE_KINDS).toContain(entity.kind)
        expect(entity.healthPoints).toBe(maxHealthOfKind(entity.kind))
        expect(entity.behaviour).toStrictEqual(initialBehaviourOfKind(entity.kind))
        const distance = Math.hypot(
          entity.feetPosition.x - PLAYER.x,
          entity.feetPosition.z - PLAYER.z,
        )
        expect(distance).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE_BLOCKS)
        expect(distance).toBeLessThanOrEqual(MAX_SPAWN_DISTANCE_BLOCKS)
      }

      const calls = yield* store.calls
      expect(calls.reads).toBeGreaterThan(0)
      expect(calls.peeks).toBeGreaterThan(0)
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('an offered cell and cadence search share one ordered attempt stream', () =>
    Effect.gen(function* () {
      // The concatenation, and the only frame in which it happens: the inbox has
      // something in it AND the tick cadence comes due on the same tick. Every
      // other test has one or the other — the vertical slice puts the world at
      // noon so the search cannot run, and the end-to-end case above feeds
      // nothing into the inbox — so this arm had never executed.
      //
      // AND THE ORDER IS THE HOST'S FIRST. `offered` leads the concatenation, so
      // a cell somebody asked for is not silently outbid by a ring that happened
      // to be full — which is the failure mode of the other concatenation order
      // and would be invisible in a count.
      const store = yield* makeChunkStoreDouble(FLOORED_WORLD, RESIDENT_CHUNKS)
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const playerPose = { ...SPAWN_POSE, feetPosition: PLAYER }
      const player = yield* makePlayerServiceDouble(playerPose)
      const inventory = yield* makeInventoryDouble()
      const time = yield* makeTimeService()
      const state = yield* makeGameplayFrameState
      const commit = yield* makeGameplayCommitServices(store.api, inventory.api, { playerPose })
      const stages = gameplayStages(state, store.api, roster.api, inventory.api, player.api, time, undefined, undefined, {}, commit)

      const offeredAt: Position = atPosition(-20, 64, -20 )
      yield* time.setTimeOfDay(MIDNIGHT)
      yield* Ref.set(state.spawnAttempts, [
        {
          candidate: {
            groundBlock: STONE,
            footBlock: AIR_BLOCK_ID,
            headBlock: AIR_BLOCK_ID,
            blockLight: 0,
            skyLight: SkyLightLevel(0),
            biome: 'PLAINS',
            timeOfDay: MIDNIGHT,
            distanceToPlayerBlocksXZ: 30,
          },
          kind: CREEPER_KIND,
          feetPosition: offeredAt,
        },
      ])

      const entities = stages.find((stage) => stage.id === GAMEPLAY_STAGE_IDS.entities)
      yield* Ref.set(state.tickCount, HOSTILE_SPAWN_INTERVAL_TICKS)
      yield* entities?.run(DeltaTimeSecs(0)) ?? Effect.void

      const ownerAfter = yield* commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const entries = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(ownerAfter.state).entities
      // The one offered attempt and one cadence attempt share a single pass.
      expect(entries.length).toBe(2)
      // The host's cell was taken, and taken first.
      expect(entries[0]?.feetPosition).toStrictEqual(offeredAt)
      // The inbox was drained rather than left to be re-offered next frame.
      expect(yield* Ref.get(state.spawnAttempts)).toStrictEqual([])
    }).pipe(Effect.provide(FrameServicesLayer)),
  )

  it.effect('enforces the normal hostile cap on the 30th and 60th registered passes', () =>
    Effect.gen(function* () {
      const initialRoster = seededRoster(CREEPER_KIND, 8, (index) =>
        atPosition(26 + index, DISTRIBUTION_FLOOR_Y + 1, 0.5),
      )
      const { time, state, commit, stages } = yield* makeStageHarness(
        DISTRIBUTION_WORLD,
        DISTRIBUTION_LIGHT,
        DISTRIBUTION_PLAYER,
        initialRoster,
      )
      yield* Ref.set(state.passiveInitialSpawnPending, false)
      yield* time.setTimeOfDay(MIDNIGHT)

      yield* runFrames(stages, HOSTILE_SPAWN_INTERVAL_TICKS, DeltaTimeSecs(0.05))

      expect(yield* Ref.get(state.lastHostileSpawnTick)).toBe(HOSTILE_SPAWN_INTERVAL_TICKS)
      expect(yield* Ref.get(state.tickCount)).toBe(HOSTILE_SPAWN_INTERVAL_TICKS)
      const afterFirstSearch = yield* commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      expect(Schema.decodeUnknownSync(GameplayEntityRosterSchema)(afterFirstSearch.state).entities)
        .toHaveLength(HOSTILE_SPAWN_SETTINGS.normal.maxPopulation)

      yield* runFrames(stages, HOSTILE_SPAWN_INTERVAL_TICKS, DeltaTimeSecs(0.05))

      expect(yield* Ref.get(state.tickCount)).toBe(60)
      expect(yield* Ref.get(state.lastHostileSpawnTick)).toBe(60)
      const ownerAfter = yield* commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const entries = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(ownerAfter.state).entities
      expect(entries).toHaveLength(HOSTILE_SPAWN_SETTINGS.normal.maxPopulation)
      expect(entries.every(({ kind }) => HOSTILE_KINDS.includes(kind))).toBe(true)
    }),
  )

  it.effect('does not search or spawn hostiles in Peaceful after the due interval', () =>
    Effect.gen(function* () {
      const { store, time, state, commit, stages } = yield* makeStageHarness(
        DISTRIBUTION_WORLD,
        DISTRIBUTION_LIGHT,
        DISTRIBUTION_PLAYER,
      )
      yield* Ref.set(state.passiveInitialSpawnPending, false)
      yield* state.survivalHunger.setDifficulty('peaceful')
      yield* time.setTimeOfDay(MIDNIGHT)

      yield* runFrames(
        stages,
        HOSTILE_SPAWN_SETTINGS.peaceful.intervalTicks,
        DeltaTimeSecs(0.05),
      )

      expect(yield* Ref.get(state.tickCount)).toBe(HOSTILE_SPAWN_SETTINGS.peaceful.intervalTicks)
      expect(yield* Ref.get(state.lastHostileSpawnTick)).toBe(0)
      const ownerAfter = yield* commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      expect(Schema.decodeUnknownSync(GameplayEntityRosterSchema)(ownerAfter.state).entities)
        .toStrictEqual([])
      expect((yield* store.calls).peeks).toBe(0)
    }),
  )

  it.effect('uses the initial daylight passive search and respects its roster cap', () =>
    Effect.gen(function* () {
      const passiveKind = PASSIVE_MOB_KINDS[0]
      const initialRoster = seededRoster(passiveKind, MAX_PASSIVE_COUNT - PASSIVE_SPAWN_BATCH_SIZE, (index) =>
        atPosition(26 + index, DISTRIBUTION_FLOOR_Y + 1, 0.5),
      )
      const { store, time, state, commit, stages } = yield* makeStageHarness(
        DISTRIBUTION_WORLD,
        DISTRIBUTION_LIGHT,
        DISTRIBUTION_PLAYER,
        initialRoster,
      )
      yield* time.setTimeOfDay(InterpolationFraction(0.5))

      yield* runFrames(stages, 1, DeltaTimeSecs(0.05))

      expect(yield* Ref.get(state.tickCount)).toBe(1)
      expect(yield* Ref.get(state.lastPassiveSpawnTick)).toBe(1)
      expect(yield* Ref.get(state.passiveInitialSpawnPending)).toBe(false)
      const ownerAfter = yield* commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const entries = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(ownerAfter.state).entities
      expect(entries).toHaveLength(MAX_PASSIVE_COUNT)
      expect(entries.every(({ kind }) =>
        PASSIVE_MOB_KINDS.includes(kind as (typeof PASSIVE_MOB_KINDS)[number]),
      )).toBe(true)

      const calls = yield* store.calls
      expect(calls.reads).toBeGreaterThan(0)
      expect(calls.peeks).toBeGreaterThan(0)
      expect(calls.writes).toBe(0)
    }),
  )

  it.effect('runs the periodic passive search at stage pass 400 after the initial batch', () =>
    Effect.gen(function* () {
      const passiveKind = PASSIVE_MOB_KINDS[0]
      const initialRoster = seededRoster(passiveKind, 1, () =>
        atPosition(26, DISTRIBUTION_FLOOR_Y + 1, 0.5),
      )
      const { store, time, state, commit, stages } = yield* makeStageHarness(
        DISTRIBUTION_WORLD,
        DISTRIBUTION_LIGHT,
        DISTRIBUTION_PLAYER,
        initialRoster,
      )
      yield* time.setTimeOfDay(InterpolationFraction(0.5))
      yield* Ref.set(state.passiveInitialSpawnPending, false)
      yield* Ref.set(state.lastPassiveSpawnTick, 0)
      yield* Ref.set(state.lastHostileSpawnTick, SimulationTick(399))
      yield* Ref.set(state.tickCount, 399)

      yield* runFrame(stages, DeltaTimeSecs(0.05))

      expect(yield* Ref.get(state.tickCount)).toBe(400)
      expect(yield* Ref.get(state.lastPassiveSpawnTick)).toBe(400)
      expect(yield* Ref.get(state.passiveInitialSpawnPending)).toBe(false)
      const ownerAfter = yield* commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const entries = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(ownerAfter.state).entities
      expect(entries.length).toBeGreaterThan(1)
      expect(entries.every(({ kind }) =>
        PASSIVE_MOB_KINDS.includes(kind as (typeof PASSIVE_MOB_KINDS)[number]),
      )).toBe(true)

      const calls = yield* store.calls
      expect(calls.reads).toBeGreaterThan(0)
      expect(calls.peeks).toBeGreaterThan(0)
    }),
  )

  it.effect('combines hostile and passive candidates when both searches are due on the same pass', () =>
    Effect.gen(function* () {
      const { time, state, commit, stages } = yield* makeStageHarness(
        CAVE_FLOORED_WORLD,
        BRIGHT_SURFACE_LIGHT,
        PLAYER,
      )
      yield* Ref.set(state.tickCount, 1199)
      yield* Ref.set(state.lastHostileSpawnTick, SimulationTick(1170))
      yield* Ref.set(state.lastPassiveSpawnTick, SimulationTick(800))
      yield* Ref.set(state.passiveInitialSpawnPending, false)
      yield* time.setTimeOfDay(InterpolationFraction(0.5))

      yield* runFrame(stages, DeltaTimeSecs(0.05))

      const ownerAfter = yield* commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      const entries = Schema.decodeUnknownSync(GameplayEntityRosterSchema)(ownerAfter.state).entities
      expect(entries.some(({ kind }) => HOSTILE_KINDS.includes(kind))).toBe(true)
      expect(entries.some(({ kind }) => PASSIVE_MOB_KINDS.includes(kind as (typeof PASSIVE_MOB_KINDS)[number]))).toBe(true)
      expect(yield* Ref.get(state.lastHostileSpawnTick)).toBe(1200)
      expect(yield* Ref.get(state.lastPassiveSpawnTick)).toBe(1200)
    }),
  )
})
