import { Effect, Ref } from 'effect'
import type { StageRegistration } from '@nerima-games/mc-kernel'
import {
  applyBlockStateRule,
  type BlockStateRuleResult,
} from '../domain/interactions/block-state-rules.js'
import type { GameplayFrameState } from './registration-core.js'
import type { GameplayBlockStateWorldApi } from './gameplay-block-state-world.js'
import { GAMEPLAY_STAGE_IDS } from './stage-ids.js'

export const makeBlockStateRulesStage = (
  state: GameplayFrameState,
  worldPort: GameplayBlockStateWorldApi | undefined,
): StageRegistration => ({
  id: GAMEPLAY_STAGE_IDS.blockStateRules,
  after: [GAMEPLAY_STAGE_IDS.interactions],
  run: () => Effect.gen(function* () {
    const requests = yield* Ref.getAndSet(state.pendingBlockStateRules, [])
    if (requests.length === 0) return

    const results: Array<BlockStateRuleResult> = []
    for (const request of requests) {
      const dimensionPort = worldPort?.forDimension(request.dimension)
      results.push({
        requestId: request.requestId,
        outcome: dimensionPort === undefined
          ? { _tag: 'PortUnavailable', position: request.position }
          : yield* applyBlockStateRule(dimensionPort, request),
      })
    }
    yield* Ref.update(state.blockStateRuleResults, (pending) => [...pending, ...results])
  }),
})
