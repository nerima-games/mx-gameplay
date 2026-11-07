import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import { capabilityOfBlockId } from '@nerima-games/mc-kernel'
import { SCENARIOS } from '../apps/preview-mining-site/scenarios'
import { buildStatsReport, isFallingMassConserved } from '../apps/preview-mining-site/stats'
import { GRAVEL, SAND, type WorldSpec } from '../apps/preview-mining-site/world'
import { blockLoot, NO_TOOL } from '../src/domain/interactions/block-loot'

const FALLING_TARGET_COUNT = 3

const expectedItemCount = (cells: WorldSpec['cells']): number => {
  const targets = [...cells]
    .filter(([, , block]) => Result.getOrUndefined(capabilityOfBlockId(block, 'fallsWhenUnsupported')) === true)
    .sort(([leftX, leftY], [rightX, rightY]) => leftX - rightX || rightY - leftY)
    .slice(0, FALLING_TARGET_COUNT)

  return targets.reduce(
    (total, [, , block]) =>
      total + blockLoot(block, NO_TOOL, [0.1]).reduce((count, item) => count + item.count, 0),
    0,
  )
}

describe('preview mining mass conservation', () => {
  // Catches Result<boolean> capability objects being counted as true in the F-mass check.
  it.effect('counts actual falling blocks and their mined items in every scenario', () =>
    Effect.gen(function* () {
      const report = yield* buildStatsReport
      const title = 'sand and gravel are neither duplicated nor lost by a cascade'
      const checkIndex = report.findIndex((line) => line.includes(title))
      const check = report[checkIndex]
      expect(check).toBe(`[ ok ] ${title}`)

      const rows = report.slice(checkIndex + 2, checkIndex + 2 + SCENARIOS.length)
      expect(rows.map((line) => line.trim().split(/\s+/)[0])).toStrictEqual(
        SCENARIOS.map((scenario) => scenario.name),
      )

      const expectedCounts = SCENARIOS.map((scenario) => expectedItemCount(scenario.build().cells))
      expect(expectedCounts).toStrictEqual(SCENARIOS.map(() => FALLING_TARGET_COUNT))

      for (const [index, row] of rows.entries()) {
        const columns = row.trim().split(/\s+/)
        const expected = expectedCounts[index]
        expect(columns[3]).toBe(String(expected))
        expect(columns[columns.length - 1]).toBe('conserved')
      }
    }),
  )

  it('counts inventory and dropped-item sinks and rejects a deliberately lost sand block', () => {
    const sandItems = blockLoot(SAND, NO_TOOL).reduce((total, item) => total + item.count, 0)
    const gravelItems = blockLoot(GRAVEL, NO_TOOL, [0.1]).reduce((total, item) => total + item.count, 0)

    expect([sandItems, gravelItems]).toStrictEqual([1, 1])
    expect(isFallingMassConserved({ before: sandItems, after: 0, inventory: sandItems, dropped: 0 })).toBe(true)
    expect(isFallingMassConserved({ before: sandItems, after: 0, inventory: 0, dropped: sandItems })).toBe(true)
    expect(isFallingMassConserved({ before: sandItems, after: 0, inventory: 0, dropped: 0 })).toBe(false)
  })
})
