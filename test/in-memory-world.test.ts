import { describe, expect, it } from '@effect/vitest'
import { BlockId } from '@nerima-games/mc-kernel'
import { Effect, Result } from 'effect'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import {
  makeGeneratedWorld,
  makeInMemoryWorld,
  solidityFromStore,
  targetabilityFromStore,
} from '../src/domain/in-memory-world'
import { blockPosition, chunkCoord } from './support/coordinate-fixtures'

describe('in-memory world input boundaries', () => {
  it.effect('returns typed failures for explicitly undefined world options', () =>
    Effect.gen(function* () {
      const inMemoryOptions = [
        { options: { world: undefined }, field: 'world' },
        { options: { spawnPose: undefined }, field: 'spawnPose' },
        { options: { dimension: undefined }, field: 'dimension' },
        { options: { inventory: undefined }, field: 'inventory' },
        { options: { vitals: undefined }, field: 'vitals' },
      ]
      for (const { options, field } of inMemoryOptions) {
        const result = yield* Effect.result(makeInMemoryWorld(options as never))
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({ _tag: 'WorldInputFailure', field, reason: 'undefined' })
        }
      }

      const generatedOptions = [
        { options: { seed: undefined }, field: 'seed' },
        { options: { spawnX: undefined }, field: 'spawnX' },
        { options: { spawnZ: undefined }, field: 'spawnZ' },
        { options: { chunkSource: undefined }, field: 'chunkSource' },
        { options: { yawRadians: undefined }, field: 'yawRadians' },
        { options: { pitchRadians: undefined }, field: 'pitchRadians' },
        { options: { dimension: undefined }, field: 'dimension' },
        { options: { inventory: undefined }, field: 'inventory' },
        { options: { vitals: undefined }, field: 'vitals' },
      ]
      for (const { options, field } of generatedOptions) {
        const result = yield* Effect.result(makeGeneratedWorld(options as never))
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({ _tag: 'WorldInputFailure', field, reason: 'undefined' })
        }
      }
    }),
  )

  it.effect('returns typed failures for invalid generated seed and spawn coordinates', () =>
    Effect.gen(function* () {
      const cases = [
        { options: { seed: Number.NaN }, field: 'seed' },
        { options: { spawnX: Number.POSITIVE_INFINITY }, field: 'spawnX' },
        { options: { spawnZ: Number.NaN }, field: 'spawnZ' },
      ]
      for (const { options, field } of cases) {
        const result = yield* Effect.result(makeGeneratedWorld(options as never))
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({ _tag: 'WorldInputFailure', field, reason: 'invalid' })
        }
      }
    }),
  )

  it.effect('returns a typed failure for invalid block values in world contents', () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(makeInMemoryWorld({
        world: {
          blocks: new Map([['0,0,0', undefined]]),
          loaded: [],
        },
      } as never))

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: 'WorldInputFailure',
          field: 'world.blocks',
          reason: 'invalid',
        })
      }
    }),
  )

  it.effect('returns typed failures for malformed world cell and loaded-chunk keys', () =>
    Effect.gen(function* () {
      const badCell = yield* Effect.result(makeInMemoryWorld<MobBehaviour>({
        world: {
          blocks: new Map([['1,2,0.5', BlockId(3)]]),
          loaded: [],
        },
      }))
      expect(Result.isFailure(badCell)).toBe(true)
      if (Result.isFailure(badCell)) {
        expect(badCell.failure).toMatchObject({
          _tag: 'WorldInputFailure',
          field: 'world.blocks',
          reason: 'invalid',
        })
      }

      const badChunk = yield* Effect.result(makeInMemoryWorld<MobBehaviour>({
        world: { blocks: new Map(), loaded: ['0,9007199254740992'] },
      }))
      expect(Result.isFailure(badChunk)).toBe(true)
      if (Result.isFailure(badChunk)) {
        expect(badChunk.failure).toMatchObject({
          _tag: 'WorldInputFailure',
          field: 'world.loaded',
          reason: 'invalid',
        })
      }
    }),
  )

  it.effect('treats invalid block coordinates as solid and untargetable', () =>
    Effect.gen(function* () {
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        world: {
          blocks: new Map([['0,0,0', BlockId(2)]]),
          loaded: ['0,0'],
        },
      })
      const isSolid = solidityFromStore(world.chunkStore)
      const isTargetable = targetabilityFromStore(world.chunkStore)

      expect(Result.getOrThrow(isSolid({ x: Number.NaN, y: 0, z: 0 }))).toBe(true)
      expect(isTargetable(Number.NaN, 0, 0)).toBe(false)
      expect(isTargetable(0, 0, 0)).toBe(true)
    }),
  )

  it.effect('returns a typed failure for an unregistered block instead of treating it as collision', () =>
    Effect.gen(function* () {
      const unknownBlock = BlockId(65_535)
      const world = yield* makeInMemoryWorld<MobBehaviour>({
        world: {
          blocks: new Map([['5,5,5', unknownBlock]]),
          loaded: ['0,0'],
        },
      })

      const result = solidityFromStore(world.chunkStore)({ x: 5, y: 5, z: 5 })

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: 'EntityWorldUnregisteredBlockId',
          blockId: unknownBlock,
          cell: { x: 5, y: 5, z: 5 },
        })
      }
    }),
  )
})
