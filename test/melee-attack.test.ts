import { describe, expect, it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import { EntityHealthPoints, EntityId, SimulationTickSchema } from '@nerima-games/mc-kernel'
import { type Entity } from '@nerima-games/mc-sim'
import { position as atPosition } from './support/coordinate-fixtures'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat'
import {
  MeleeAttackPreparationSchema,
  meleeDamageForItem,
  prepareMeleeAttack,
} from '../src/domain/interactions/melee-attack'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'

const MELEE_PARITY_FIXTURE = {
  source: 'https://minecraft.wiki/w/Melee_attack',
  parity: 'https://raw.githubusercontent.com/takeokunn/ts-minecraft/main/docs/reference/vanilla-parity.md',
  edition: 'Java Edition 26.3',
} as const

const zombie: Entity<MobBehaviour> = {
  id: EntityId('zombie:melee-target'),
  kind: ZOMBIE_KIND,
  feetPosition: atPosition(0, 64, 2.5),
  healthPoints: EntityHealthPoints(20),
  behaviour: undefined,
}

describe('melee attack damage', () => {
  it('uses unarmed damage for empty hands and non-swords', () => {
    expect(meleeDamageForItem(undefined)).toBe(1)
    expect(meleeDamageForItem(null)).toBe(1)
    expect(meleeDamageForItem('bow')).toBe(1)
    expect(meleeDamageForItem('diamond_pickaxe')).toBe(1)
  })

  it(`maps each supported sword to its melee damage (${MELEE_PARITY_FIXTURE.source}, ${MELEE_PARITY_FIXTURE.edition})`, () => {
    expect(meleeDamageForItem('wooden_sword')).toBe(4)
    expect(meleeDamageForItem('gold_sword')).toBe(4)
    expect(meleeDamageForItem('stone_sword')).toBe(5)
    expect(meleeDamageForItem('iron_sword')).toBe(6)
    expect(meleeDamageForItem('diamond_sword')).toBe(7)
    expect(meleeDamageForItem('netherite_sword')).toBe(8)
  })

  it(`applies the parity critical multiplier (${MELEE_PARITY_FIXTURE.parity}, ${MELEE_PARITY_FIXTURE.edition})`, () => {
    expect(meleeDamageForItem('iron_sword', true)).toBe(9)
    expect(meleeDamageForItem(undefined, true)).toBe(1.5)
  })
})

describe('C2 melee preparation', () => {
  const actor = EntityId('melee-owner')
  const intent = { _tag: 'MeleeAttack', actor } as const
  const input = {
    tick: Schema.decodeUnknownSync(SimulationTickSchema)(12),
    dimension: 'overworld' as const,
    pose: { feetPosition: atPosition(0, 64, 0), yawRadians: 0, pitchRadians: 0 },
    entities: [zombie],
    heldItem: 'iron_sword' as const,
    critical: false,
  }

  it('uses the authoritative pose, reach, held item, and world candidates', () => {
    const result = prepareMeleeAttack(intent, input)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isFailure(result)) return
    const decoded = Schema.decodeUnknownResult(MeleeAttackPreparationSchema, {
      onExcessProperty: 'error',
    })(result.success)
    expect(Result.isSuccess(decoded)).toBe(true)
    expect(result.success.event).toMatchObject({
      _tag: 'EntityDamaged',
      entity: zombie.id,
      amount: 6,
      cause: 'mob',
    })
  })

  it('rejects a target behind the authoritative block ray without mutating inputs', () => {
    const snapshot = JSON.stringify({ input, zombie })
    const result = prepareMeleeAttack(intent, { ...input, blockDistance: 1 })

    expect(Result.isFailure(result)).toBe(true)
    expect(JSON.stringify({ input, zombie })).toBe(snapshot)
  })

  it('returns a typed failure or a strict finite event for arbitrary server ticks', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.double({ min: -1e12, max: 1e12, noNaN: false, noDefaultInfinity: false }),
        (rawTick) => {
          const result = prepareMeleeAttack(intent, {
            ...input,
            tick: rawTick as typeof input.tick,
          })
          if (Result.isFailure(result)) return true
          const decoded = Schema.decodeUnknownResult(MeleeAttackPreparationSchema, {
            onExcessProperty: 'error',
          })(result.success)
          return Result.isSuccess(decoded) &&
            Number.isFinite(decoded.success.event._tag === 'EntityDamaged' ? decoded.success.event.amount : Number.NaN) &&
            (decoded.success.event._tag !== 'EntityDamaged' || decoded.success.event.amount > 0)
        },
      ),
      { numRuns: 250 },
    )
  })
})
