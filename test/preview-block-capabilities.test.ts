import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { blockPosition } from './support/coordinate-fixtures'
import { makeSite, requestBreak, stepFrame } from '../apps/preview-mining-site/site'
import { floatingBlocks, makePreviewWorld, restsOnSupport, AIR, SAND, STONE, WATER } from '../apps/preview-mining-site/world'

describe('preview mining block capabilities', () => {
  // bug it catches: a Result object made sand on stone appear unsupported.
  it.effect('recognizes stone as support beneath sand', () =>
    Effect.gen(function* () {
      const sand = blockPosition(0, 1, 0)
      const world = yield* makePreviewWorld({
        cells: [[0, 0, STONE], [0, 1, SAND]],
        loadedChunks: ['0,0'],
        z: 0,
      })

      expect(restsOnSupport(world, sand)).toBe(true)
      expect(floatingBlocks(world, [sand])).toStrictEqual([])
    }),
  )

  // bug it catches: Result truthiness classified supported stone as a falling block.
  it.effect('reports sand over air as floating without reporting a supported stone cell', () =>
    Effect.gen(function* () {
      const sand = blockPosition(0, 1, 0)
      const stone = blockPosition(1, 1, 0)
      const world = yield* makePreviewWorld({
        cells: [[0, 1, SAND], [1, 0, STONE], [1, 1, STONE]],
        loadedChunks: ['0,0'],
        z: 0,
      })

      expect(floatingBlocks(world, [sand, stone])).toStrictEqual([sand])
    }),
  )

  // bug it catches: Result truthiness classified replaceable water as a falling block.
  it.effect('lets sand float above replaceable water without reporting water as floating', () =>
    Effect.gen(function* () {
      const water = blockPosition(0, 0, 0)
      const sand = blockPosition(0, 1, 0)
      const stone = blockPosition(1, 1, 0)
      const world = yield* makePreviewWorld({
        cells: [[0, 0, WATER], [0, 1, SAND], [1, 0, STONE], [1, 1, STONE]],
        loadedChunks: ['0,0'],
        z: 0,
      })

      expect(restsOnSupport(world, sand)).toBe(false)
      expect(floatingBlocks(world, [water, sand, stone])).toStrictEqual([sand])
    }),
  )

  // bug it catches: Result truthiness counted a break's AIR write as a falling move.
  it.effect('counts no falling move when a non-falling block is broken', () =>
    Effect.gen(function* () {
      const target = blockPosition(1, 1, 0)
      const site = yield* makeSite(
        { cells: [[target.x, target.y, STONE]], loadedChunks: ['0,0'], z: 0 },
        { width: 4, height: 4 },
        'block-capability-moves',
      )

      yield* requestBreak(site, target)
      const row = yield* stepFrame(site)

      expect(site.world.peekBlock(target) ?? AIR).toBe(AIR)
      expect(row.moved).toBe(0)
    }),
  )
})
