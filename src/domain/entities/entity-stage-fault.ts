import type { EntityId, EntityKind, MobMovementFailure } from '@nerima-games/mc-sim'
import type { Position } from '@nerima-games/mc-kernel'
import type { EntityWorldCellPosition, EntityWorldQueryFailure } from './entity-world-cell.js'
import type { MobStateRepairFailure } from '../mob/mob-ecosystem.js'

export type EntityWorldFaultTarget =
  | Readonly<{ _tag: 'Cell'; cell: EntityWorldCellPosition }>
  | Readonly<{ _tag: 'Entity'; entityId: EntityId }>
  | Readonly<{ _tag: 'Position'; position: Position }>

export type EntityStageFault =
  | Readonly<{
      _tag: 'EntityWorldDataFault'
      source: 'UndeadDaylight' | 'MobMovement' | 'ProjectileLineOfSight' | 'ProjectileStep' | 'TntExplosion'
      target: EntityWorldFaultTarget
      failure: EntityWorldQueryFailure
    }>
  | Readonly<{
      _tag: 'MobBehaviourRepairFault'
      entityId: EntityId
      entityKind: EntityKind
      failure: MobStateRepairFailure
    }>
  | Readonly<{
      _tag: 'MobMovementExecutionFault'
      entityId: EntityId
      reason: 'invalid-state' | 'invalid-goal'
    }>
  | Readonly<{
      _tag: 'MobMovementExecutionFault'
      entityId: EntityId
      reason: 'simulation-rejected' | 'step-failed'
      failure: MobMovementFailure
    }>
