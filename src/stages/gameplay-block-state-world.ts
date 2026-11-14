import type { Dimension, WorldRevision } from '@nerima-games/mc-kernel'
import type { ReplicatedOwnerCandidate } from '@nerima-games/mc-sim'
import { Context } from 'effect'
import type { BlockStateWorldPort } from '../domain/interactions/block-state-rules.js'

export type GameplayBlockStateWorldApi = Readonly<{
  /**
   * Bind reads and writes to one dimension. The returned port must read the
   * current block state and commit every stateful edit with C7 `WorldWritePort`
   * semantics. Owner changes supplied here share that commit with the block
   * edits; `expectedWorldRevision` must be checked by the same transaction.
   * The host adapter obtains the dimension revision from its world coordinator
   * when it builds the C7 batch.
   */
  forDimension: (
    dimension: Dimension,
    ownerChanges?: ReadonlyArray<ReplicatedOwnerCandidate>,
    expectedWorldRevision?: WorldRevision,
  ) => BlockStateWorldPort
}>

/** Host adapter for state reads and C7 stateful edits, including owner changes in one commit. */
const GameplayBlockStateWorldBase: Context.ServiceClass<
  GameplayBlockStateWorld,
  'mx-gameplay/GameplayBlockStateWorld',
  GameplayBlockStateWorldApi
> = Context.Service<GameplayBlockStateWorld, GameplayBlockStateWorldApi>()('mx-gameplay/GameplayBlockStateWorld')

export class GameplayBlockStateWorld extends GameplayBlockStateWorldBase {}
