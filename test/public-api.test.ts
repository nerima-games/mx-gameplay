/**
 * The barrel is pinned explicitly.
 *
 * `index.ts` is what mc-compose imports. A re-export dropped from it is
 * invisible to every other test in this repository — they all import the
 * modules directly — while breaking the only consumer that matters. Same
 * reasoning as `mc-kernel/test/public-api.test.ts`.
 *
 * Note what this test does NOT say: that everything listed here is a CONTRACT.
 * mx-gameplay's contract is stage registration (docs/public-api.md); the domain
 * modules are exported because the previews and tests drive them. Pinning them
 * here keeps the barrel honest, not the API frozen.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import * as gameplay from '../index'
import { applyDamage } from '../domain/death-cause'
import { takeBatch } from '../domain/falling-block'
import { GAMEPLAY_STAGE_IDS } from '../stages/stage-ids'

describe('public API surface', () => {
  it.effect('re-exports the stage registration contract — the part mc-compose actually consumes', () =>
    Effect.sync(() => {
      const contract = [
        'gameplayStages',
        'makeGameplayStages',
        'makeGameplayFrameState',
        'GAMEPLAY_STAGE_IDS',
        'UPSTREAM_STAGE_IDS',
        'StageId',
        'DeltaTimeSecs',
      ]

      for (const name of contract) {
        expect(Object.keys(gameplay)).toContain(name)
      }
    }),
  )

  it.effect('re-exports the rule domain, which the previews and scenario tests drive directly', () =>
    Effect.sync(() => {
      const internal = [
        // falling blocks — event-driven, budgeted
        'FALLING_BLOCK_MOVES_PER_TICK',
        'emptyFallingBlockQueue',
        'disturb',
        'takeBatch',
        'settled',
        // fluids — frontier with a per-tick budget
        'DEFAULT_FLUID_FRONTIER_BUDGET',
        'splitBudget',
        'carryOver',
        // death — the cause travels to the message
        'DEATH_MESSAGES',
        'describeDeath',
        'MAX_HEALTH_POINTS',
        'fullHealth',
        'isDead',
        'applyDamage',
        'deathMessage',
        // stage helpers
        'LAVA_TICK_INTERVAL',
        'DEFAULT_DAY_LENGTH_SECS',
        'advanceTimeOfDay',
        'EXPERIENCE_MODULE_STAGE_PREFIXES',
        'OWN_STAGE_PREFIX',
      ]

      for (const name of internal) {
        expect(Object.keys(gameplay)).toContain(name)
      }
    }),
  )

  it.effect('exposes the same implementations through the barrel as through the modules', () =>
    Effect.sync(() => {
      expect(gameplay.applyDamage).toBe(applyDamage)
      expect(gameplay.takeBatch).toBe(takeBatch)
      expect(gameplay.GAMEPLAY_STAGE_IDS).toBe(GAMEPLAY_STAGE_IDS)
    }),
  )

  it.effect('REGRESSION: exports nothing that would let a consumer resolve a total stage order', () =>
    Effect.sync(() => {
      // plan.md §2.3-3. A `sortStages`, `stageOrder` or `framePipeline` export
      // here would be this repository claiming a decision that belongs to
      // mc-compose — and it would be claimed without being able to see the
      // other three modules' registrations.
      const forbidden = ['sortStages', 'stageOrder', 'totalOrder', 'framePipeline', 'runFrame']
      for (const name of forbidden) {
        expect(Object.keys(gameplay)).not.toContain(name)
      }
    }),
  )
})
