import { describe, expect, it } from '@effect/vitest'
import fc from 'fast-check'
import { AIR_BLOCK_ID, DeltaTimeSecs } from '@nerima-games/mc-kernel'
import { Effect } from 'effect'
import {
  DORMANT_FUSE,
  CREEPER_FUSE_SECS,
  stepCreeperFuse,
  type CreeperFuse,
} from '../../src/domain/mob/creeper-fuse'
import {
  DESPAWN_DISTANCE_BLOCKS,
  despawnVerdict,
} from '../../src/domain/mob/hostile-despawn'
import { canHostileSpawnAt } from '../../src/domain/mob/hostile-spawn'
import {
  initialEcosystemMobState,
  PASSIVE_MOB_KINDS,
  stepEcosystemMob,
} from '../../src/domain/mob/mob-ecosystem'
import { searchSpawnCandidates, SPAWN_RING_CELLS } from '../../src/domain/entities/mob-spawn-search'
import { makeChunkStoreDouble, STONE, world } from '../support/chunk-store-double'
import { blockPosition, position } from '../support/coordinate-fixtures'

const spawnWorld = world(
  Array.from({ length: 96 * 96 }, (_, index) => {
    const x = -48 + (index % 96)
    const z = -48 + Math.floor(index / 96)
    return [blockPosition(x, 63, z), STONE] as const
  }),
)

const spawnChunks = Array.from({ length: 7 * 7 }, (_, index) => {
  const x = -3 + (index % 7)
  const z = -3 + Math.floor(index / 7)
  return `${String(x)},${String(z)}`
})

describe('mob lifecycle properties', () => {
  it('keeps passive movement non-hostile, level, and bounded by elapsed time', () => {
    // Flee speed is capped at 3 blocks per second across the combined horizontal displacement.
    // The minimum-subnormal diagonal catches normalization losing unit length to rounding.
    fc.assert(
      fc.property(
        fc.constantFrom(...PASSIVE_MOB_KINDS),
        fc.record({
          x: fc.double({ min: -128, max: 128, noNaN: true, noDefaultInfinity: true }),
          y: fc.double({ min: 0, max: 255, noNaN: true, noDefaultInfinity: true }),
          z: fc.double({ min: -128, max: 128, noNaN: true, noDefaultInfinity: true }),
        }),
        fc.oneof(
          fc.constant(undefined),
          fc.record({
            x: fc.double({ min: -128, max: 128, noNaN: true, noDefaultInfinity: true }),
            y: fc.double({ min: 0, max: 255, noNaN: true, noDefaultInfinity: true }),
            z: fc.double({ min: -128, max: 128, noNaN: true, noDefaultInfinity: true }),
          }),
        ),
        fc.integer({ min: 0, max: 5_000 }),
        (kind, origin, target, elapsedMs) => {
          const self = position(origin.x, origin.y, origin.z)
          const targetPosition = target === undefined ? undefined : position(target.x, target.y, target.z)
          const deltaSecs = elapsedMs / 1_000
          const step = stepEcosystemMob(
            kind,
            initialEcosystemMobState(),
            self,
            targetPosition,
            deltaSecs,
          )

          const displacement = Math.hypot(
            step.feetPosition.x - self.x,
            step.feetPosition.z - self.z,
          )
          expect(step.attack).toBeUndefined()
          expect(step.jumping).toBe(false)
          expect(step.feetPosition.y).toBe(self.y)
          expect(displacement).toBeLessThanOrEqual(deltaSecs * 3 + 1e-9)
        },
      ),
      {
        examples: [[
          PASSIVE_MOB_KINDS[0],
          { x: 0, y: 0, z: 0 },
          { x: Number.MIN_VALUE, y: 0, z: -Number.MIN_VALUE },
          1,
        ]],
      },
    )
  })

  it('keeps hostiles through the inclusive despawn distance and removes those beyond it', () => {
    // Catches an off-by-one that despawns at the limit or keeps a mob past it.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 256 }), (distance) => {
        const verdict = (distanceToPlayerBlocks: number) =>
          despawnVerdict({ distanceToPlayerBlocks, persistent: false })

        expect(verdict(DESPAWN_DISTANCE_BLOCKS - 1)).toStrictEqual({ _tag: 'Keep' })
        expect(verdict(DESPAWN_DISTANCE_BLOCKS)).toStrictEqual({ _tag: 'Keep' })
        expect(verdict(DESPAWN_DISTANCE_BLOCKS + 1)).toStrictEqual({
          _tag: 'Despawn',
          reason: 'too-far',
        })
        expect(verdict(distance)._tag).toBe(
          distance > DESPAWN_DISTANCE_BLOCKS ? 'Despawn' : 'Keep',
        )
      }),
    )
  })

  it('refuses hostile spawn candidates only above the valid block-light limit', () => {
    // Catches an off-by-one light gate that rejects level 7 or admits level 8.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 15 }), (blockLight) => {
        const verdict = canHostileSpawnAt({
          groundBlock: STONE,
          footBlock: AIR_BLOCK_ID,
          headBlock: AIR_BLOCK_ID,
          blockLight,
          timeOfDay: 0.9,
          distanceToPlayerBlocksXZ: 20,
        })

        if (blockLight <= 7) {
          expect(verdict).toStrictEqual({ _tag: 'Spawn' })
        } else {
          expect(verdict).toStrictEqual({ _tag: 'Refused', reason: 'too-bright' })
        }
      }),
    )
  })

  it('offers a complete spawn ring on the floored player plane without immediate despawns', async () => {
    // Catches bad floor rounding, duplicate candidates, and spawn points swept on arrival.
    const store = await Effect.runPromise(makeChunkStoreDouble(spawnWorld, spawnChunks))

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 65_535 }),
        fc.double({ min: -4, max: 4, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -4, max: 4, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 64, max: 64.99, noNaN: true, noDefaultInfinity: true }),
        async (seed, x, z, y) => {
          const target = position(x, y, z)
          const found = await Effect.runPromise(
            searchSpawnCandidates(store.api, target, 0.9, seed),
          )
          const identities = new Set(
            found.attempts.map(({ feetPosition }) =>
              `${String(feetPosition.x)},${String(feetPosition.y)},${String(feetPosition.z)}`,
            ),
          )

          expect(found.unreadable).toBe(0)
          expect(found.attempts).toHaveLength(SPAWN_RING_CELLS)
          expect(identities.size).toBe(SPAWN_RING_CELLS)
          for (const attempt of found.attempts) {
            expect(attempt.feetPosition.y).toBe(Math.floor(target.y))
            expect(attempt.candidate.groundBlock).toBe(STONE)
            const distance3d = Math.hypot(
              attempt.feetPosition.x - target.x,
              attempt.feetPosition.y - target.y,
              attempt.feetPosition.z - target.z,
            )
            expect(despawnVerdict({ distanceToPlayerBlocks: distance3d, persistent: false }))
              .toStrictEqual({ _tag: 'Keep' })
          }
        },
      ),
    )
  })

  it('advances, cancels, and terminates a creeper fuse at most once', () => {
    // Catches fuse resets in range, failure to cancel out of range, and repeat or late detonation.
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ close: fc.boolean(), elapsedMs: fc.integer({ min: 0, max: 1_000 }) }),
          { maxLength: 16 },
        ),
        (frames) => {
          let fuse: CreeperFuse = DORMANT_FUSE
          let explosions = 0

          for (const frame of frames) {
            const previous = fuse
            const step = stepCreeperFuse(
              fuse,
              { distanceToTargetBlocks: frame.close ? 3 : 4 },
              DeltaTimeSecs(frame.elapsedMs / 1_000),
            )

            if (previous._tag === 'Detonated') {
              expect(step.fuse._tag).toBe('Detonated')
              expect(step.explosion).toBeUndefined()
            } else if (!frame.close) {
              expect(step.fuse).toStrictEqual(DORMANT_FUSE)
              expect(step.explosion).toBeUndefined()
            } else if (previous._tag === 'Lit' && step.fuse._tag === 'Lit') {
              expect(step.fuse.burnedSecs).toBeGreaterThanOrEqual(previous.burnedSecs)
            }

            if (step.fuse._tag === 'Lit') {
              expect(step.fuse.burnedSecs).toBeLessThan(CREEPER_FUSE_SECS)
            }
            if (step.explosion !== undefined) {
              explosions += 1
              expect(step.fuse._tag).toBe('Detonated')
            }
            fuse = step.fuse
          }

          const wasTerminal = fuse._tag === 'Detonated'
          const completion = stepCreeperFuse(
            fuse,
            { distanceToTargetBlocks: 3 },
            DeltaTimeSecs(CREEPER_FUSE_SECS),
          )
          if (wasTerminal) {
            expect(completion.explosion).toBeUndefined()
          } else {
            expect(completion.fuse._tag).toBe('Detonated')
            expect(completion.explosion).toBeDefined()
            explosions += 1
          }
          expect(explosions).toBeLessThanOrEqual(1)

          const afterTerminal = stepCreeperFuse(
            completion.fuse,
            { distanceToTargetBlocks: 0 },
            DeltaTimeSecs(0),
          )
          expect(afterTerminal.fuse._tag).toBe('Detonated')
          expect(afterTerminal.explosion).toBeUndefined()
        },
      ),
    )
  })
})
