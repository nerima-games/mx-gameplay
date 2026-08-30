/**
 * `domain/interactions/right-click-target.ts` — right-click routing.
 *
 * The reference's eight cases are here, PLUS the two its suite leaves
 * uncovered: `anvil` has no test there at all, and of the two door blocks only
 * `DOOR_OPEN` is exercised. Both gaps were found by counting the branches
 * against the cases rather than by reading the test names — which is the only
 * way that class of gap shows up.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  DOOR_BLOCKS,
  ROUTED_BLOCKS,
  STORAGE_BLOCKS,
  rightClickRoute,
  type RightClickRoute,
} from '../src/domain/interactions/right-click-target'
import { BLOCK_TYPES, type BlockType } from '@nerima-games/mc-kernel'
import type { BlockPosition } from '../src/domain/chunk-store-port'

const AT: BlockPosition = { x: 12, y: 70, z: -3 }

const kindOf = (block: BlockType): RightClickRoute['kind'] | undefined =>
  rightClickRoute(AT, block)?.kind

describe('the routes the reference tests', () => {
  it.effect('a chest routes to storage', () =>
    Effect.sync(() => {
      expect(rightClickRoute(AT, 'chest')).toStrictEqual({
        kind: 'storage',
        at: AT,
        block: 'chest',
      })
    }),
  )

  it.effect('a shulker box uses the storage route and preserves its block type', () =>
    Effect.sync(() => {
      expect(kindOf('shulker_box')).toBe(kindOf('chest'))
      expect(rightClickRoute(AT, 'shulker_box')).toStrictEqual({
        kind: 'storage',
        at: AT,
        block: 'shulker_box',
      })
    }),
  )

  it.effect('storage routes narrow to the concrete container block', () =>
    Effect.sync(() => {
      for (const block of ['chest', 'shulker_box', 'dispenser', 'hopper'] as const) {
        const route = rightClickRoute(AT, block)
        expect(route?.kind).toBe('storage')
        expect(route?.kind === 'storage' && route.block).toBe(block)
      }
    }),
  )

  it.effect('crafting table, furnace, bed, enchanting table each route to themselves', () =>
    Effect.sync(() => {
      expect(kindOf('crafting_table')).toBe('craftingTable')
      expect(kindOf('furnace')).toBe('furnace')
      expect(kindOf('bed')).toBe('bed')
      expect(kindOf('enchanting_table')).toBe('enchantingTable')
    }),
  )

  it.effect('an open door routes, and says which door block it was', () =>
    Effect.sync(() => {
      expect(rightClickRoute(AT, 'door_open')).toStrictEqual({
        kind: 'door',
        at: AT,
        block: 'door_open',
      })
    }),
  )

  it.effect('an unroutable block yields undefined', () =>
    Effect.sync(() => {
      expect(rightClickRoute(AT, 'stone')).toBeUndefined()
      expect(rightClickRoute(AT, 'dirt')).toBeUndefined()
    }),
  )

  it.effect('an unknown block yields undefined rather than throwing', () =>
    Effect.sync(() => {
      // `undefined` reaches here from an unloaded chunk. A rule that threw
      // would take down the frame for one cell at the edge of the world.
      expect(rightClickRoute(AT, undefined)).toBeUndefined()
    }),
  )
})

describe('the two branches the reference never tests', () => {
  it.effect('GAP IN THE SOURCE SUITE: anvil has no case there at all', () =>
    Effect.sync(() => {
      // Counting the reference's eight `it(` against its seven branches is what
      // surfaced this. A branch with no test is not a branch anyone has checked
      // — and this one is a single `===` that a rename would silently kill.
      expect(rightClickRoute(AT, 'anvil')).toStrictEqual({ kind: 'anvil', at: AT })
    }),
  )

  it.effect('GAP IN THE SOURCE SUITE: the CLOSED door routes too', () =>
    Effect.sync(() => {
      // The reference exercises only `DOOR_OPEN`. A version that matched just
      // that literal passes its whole suite, and closed doors silently stop
      // opening — the state a door spends most of its time in.
      expect(rightClickRoute(AT, 'door')).toStrictEqual({ kind: 'door', at: AT, block: 'door' })
    }),
  )

  it.effect('both door blocks route, and each reports itself', () =>
    Effect.sync(() => {
      for (const door of DOOR_BLOCKS) {
        const route = rightClickRoute(AT, door)
        expect(route?.kind).toBe('door')
        expect(route?.kind === 'door' && route.block).toBe(door)
      }
    }),
  )
})

describe('totality', () => {
  it.effect('every routed block yields a route, and no other block does', () =>
    Effect.sync(() => {
      // Both directions, over the whole 120-literal vocabulary. The second half
      // is the one that catches an over-broad predicate — a `block.includes()`
      // instead of an equality would route `oak_door`-shaped names nobody meant.
      const routed = new Set<BlockType>(ROUTED_BLOCKS)

      for (const block of BLOCK_TYPES) {
        const route = rightClickRoute(AT, block)
        expect(route === undefined).toBe(!routed.has(block))
      }
    }),
  )

  it.effect('REGRESSION: most blocks are NOT routable', () =>
    Effect.sync(() => {
      // Guards the totality test from passing because everything routes.
      const routable = BLOCK_TYPES.filter((block) => rightClickRoute(AT, block) !== undefined)

      expect(routable.length).toBe(ROUTED_BLOCKS.length)
      expect(routable.length).toBeLessThan(BLOCK_TYPES.length / 2)
    }),
  )

  it.effect('no block yields two routes, because the dispatch is ordered once', () =>
    Effect.sync(() => {
      // The property the route union buys over one predicate per block: the
      // order lives here, not at each call site, so two callers cannot disagree
      // about a block that matches twice.
      expect(new Set(ROUTED_BLOCKS).size).toBe(ROUTED_BLOCKS.length)
      expect(STORAGE_BLOCKS.has('door')).toBe(false)
    }),
  )

  it.effect('the position is passed through untouched', () =>
    Effect.sync(() => {
      // This file does no coordinate arithmetic. Asserted by identity so that
      // adding any would fail here rather than somewhere downstream.
      const route = rightClickRoute(AT, 'furnace')
      expect(route?.at).toBe(AT)
    }),
  )
})
