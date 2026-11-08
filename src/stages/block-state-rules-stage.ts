import { Effect, Ref } from 'effect'
import type { StageRegistration } from '@nerima-games/mc-kernel'
import {
  applyBlockStateRule,
  blockStateWorldPortForChunkStore,
  type BlockStateRuleResult,
} from '../domain/interactions/block-state-rules.js'
import type { GameplayFrameState } from './registration-core.js'
import type { ChunkStoreApi } from '@nerima-games/mc-worldgen'
import { GAMEPLAY_STAGE_IDS } from './stage-ids.js'

export const makeBlockStateRulesStage = (
  state: GameplayFrameState,
  store: ChunkStoreApi,
): StageRegistration => ({
  id: GAMEPLAY_STAGE_IDS.blockStateRules,
  after: [GAMEPLAY_STAGE_IDS.interactions],
  run: () => Effect.gen(function* () {
    const requests = yield* Ref.getAndSet(state.pendingBlockStateRules, [])
    if (requests.length === 0) return

    const port = blockStateWorldPortForChunkStore(store)
    const results: Array<BlockStateRuleResult> = []
    for (const request of requests) {
      results.push({
        requestId: request.requestId,
        outcome: yield* applyBlockStateRule(port, request),
      })
    }
    yield* Ref.update(state.blockStateRuleResults, (pending) => [...pending, ...results])
  }),
})
