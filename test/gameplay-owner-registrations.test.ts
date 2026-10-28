import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import { EntityId, EntityKind, EntityHealthPoints } from '@nerima-games/mc-sim'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_FISHING_OWNER_ID,
  GameplayEntityRosterSchema,
  gameplayOwnerRegistrations,
} from '../src/stages/gameplay-owner-registrations.js'

describe('gameplay replicated owner registrations', () => {
  it.effect('registers entity and fishing owners for composition', () =>
    Effect.sync(() => {
      const owners = gameplayOwnerRegistrations()

      expect(owners.map((owner) => owner.ownerId)).toContain(GAMEPLAY_ENTITIES_OWNER_ID)
      expect(owners.map((owner) => owner.ownerId)).toContain(GAMEPLAY_FISHING_OWNER_ID)
    }),
  )

  it.effect('decodes the entity roster through its public strict schema', () =>
    Effect.sync(() => {
      const valid = Schema.decodeUnknownResult(GameplayEntityRosterSchema)({
        entities: [{
          id: EntityId('creeper-0'),
          kind: EntityKind('creeper'),
          feetPosition: { x: 0, y: 64, z: 0 },
          healthPoints: EntityHealthPoints(20),
          behaviour: {
            _tag: 'HostileMob',
            behaviour: { _tag: 'Dormant' },
            ageTicks: 0,
            persistent: false,
            named: false,
            tamed: false,
          },
        }],
        nextSerial: 1,
      })

      expect(Result.isSuccess(valid)).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(GameplayEntityRosterSchema)({ entities: [] }))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(GameplayEntityRosterSchema)({
        entities: [],
        nextSerial: null,
      }))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(GameplayEntityRosterSchema)({
        entities: [{
          id: EntityId('creeper-0'),
          kind: EntityKind('creeper'),
          feetPosition: { x: 0, y: 64, z: 0 },
          healthPoints: EntityHealthPoints(20),
          behaviour: null,
        }],
        nextSerial: 1,
      }))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(GameplayEntityRosterSchema)({
        entities: [{
          id: EntityId('creeper-0'),
          kind: EntityKind('creeper'),
          feetPosition: { x: 0, y: 64, z: 0 },
          healthPoints: EntityHealthPoints(20),
        }],
        nextSerial: 1,
      }))).toBe(true)
    }),
  )
})
