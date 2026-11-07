import { describe, expect, it } from '@effect/vitest'
import fc from 'fast-check'
import { PositionAxis, position } from '@nerima-games/mc-kernel'
import { WITHER_MAX_HEALTH, WITHER_SPAWN_CHARGE_SECS } from '@nerima-games/mc-sim'
import { Result } from 'effect'
import {
  ENDERMAN_TELEPORT_ATTEMPTS,
  ENDERMAN_TELEPORT_MAX_BLOCKS,
  ENDERMAN_TELEPORT_MIN_BLOCKS,
  endermanTeleportOffset,
  resolveSafeEndermanTeleport,
} from '../../src/domain/mob/enderman-teleport'
import {
  CLOSED_SHELL,
  SHULKER_OPENING_TICKS,
  stepShulkerShell,
  type ShulkerShell,
} from '../../src/domain/mob/shulker-shell'
import {
  advanceWitherRuntime,
  damageRuntimeWither,
  initialWitherRuntimeState,
  summonRuntimeWither,
} from '../../src/domain/boss/wither'
import {
  ENDER_DRAGON_MAX_HEALTH,
  damageEnderDragonByPlayer,
  initialEnderDragonEncounter,
} from '../../src/domain/mob/ender-dragon-encounter'

const samePosition = (
  left: { readonly x: number; readonly y: number; readonly z: number },
  right: { readonly x: number; readonly y: number; readonly z: number },
): boolean => left.x === right.x && left.y === right.y && left.z === right.z

const witherPosition = (x: number, y: number, z: number) =>
  position(PositionAxis(x), PositionAxis(y), PositionAxis(z))

const expectSuccess = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

describe('special mob properties', () => {
  it('returns a valid Enderman offset when a valid roll follows rejected attempts', () => {
    // Catches accepting the zero-distance roll or exhausting the search before its valid candidate.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: ENDERMAN_TELEPORT_ATTEMPTS - 1 }),
        fc.integer({ min: 0, max: 24 }),
        (rejectedAttempts, radiusSteps) => {
          const rejectedRolls = Array.from({ length: rejectedAttempts }, () => [0.5, 0.5]).flat()
          const validXRoll = 0.625 + radiusSteps / 64
          const offset = endermanTeleportOffset([...rejectedRolls, validXRoll, 0.5])
          if (offset === undefined) return false

          const distance = Math.hypot(offset.xBlocks, offset.zBlocks)
          return (
            distance >= ENDERMAN_TELEPORT_MIN_BLOCKS &&
            distance <= ENDERMAN_TELEPORT_MAX_BLOCKS
          )
        },
      ),
    )
  })

  it('moves an Enderman only when every landing cell satisfies its safety condition', () => {
    // Catches dropping the solid-floor, clear-feet, or clear-head requirement.
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (solidFloor, clearFeet, clearHead) => {
        const current = { x: 0, y: 64, z: 0 }
        const anchor = { x: 100, y: 64, z: 100 }
        const destination = { x: 116, y: 64, z: 100 }
        const actual = resolveSafeEndermanTeleport(current, anchor, [0.75, 0.5], [
          {
            position: { ...destination, y: destination.y - 1 },
            block: solidFloor ? 'stone' : 'air',
            solid: solidFloor,
          },
          {
            position: destination,
            block: clearFeet ? 'air' : 'stone',
            solid: false,
          },
          {
            position: { ...destination, y: destination.y + 1 },
            block: clearHead ? 'air' : 'stone',
            solid: false,
          },
        ])

        const expected = solidFloor && clearFeet && clearHead ? destination : current
        return samePosition(actual, expected)
      }),
    )
  })

  it('rejects a solid Enderman landing floor made from a hazardous block', () => {
    // Catches removing a hazardous floor block from the teleport exclusion set.
    fc.assert(
      fc.property(
        fc.constantFrom(
          'water',
          'lava',
          'fire',
          'cactus',
          'magma_block',
          'campfire',
          'sweet_berry_bush',
        ),
        (floorBlock) => {
          const current = { x: 0, y: 64, z: 0 }
          const destination = { x: 116, y: 64, z: 100 }
          return resolveSafeEndermanTeleport(
            current,
            { x: 100, y: 64, z: 100 },
            [0.75, 0.5],
            [
              {
                position: { ...destination, y: destination.y - 1 },
                block: floorBlock,
                solid: true,
              },
              { position: destination, block: 'air', solid: false },
              { position: { ...destination, y: destination.y + 1 }, block: 'air', solid: false },
            ],
          ) === current
        },
      ),
    )
  })

  it('does not let a Shulker fire before its opening has completed', () => {
    // Catches an early opening threshold or firing without a target.
    fc.assert(
      fc.property(
        fc.boolean(),
        (hasTarget) => {
          let shell: ShulkerShell = CLOSED_SHELL

          for (let frame = 0; frame <= SHULKER_OPENING_TICKS; frame += 1) {
            const step = stepShulkerShell(shell, {
              hasTarget: true,
              damageTakenThisTick: 0,
              healthPoints: 20,
              maxHealthPoints: 20,
            })
            if (step.canFire) return false
            shell = step.shell
          }

          return stepShulkerShell(shell, {
            hasTarget,
            damageTakenThisTick: 0,
            healthPoints: 20,
            maxHealthPoints: 20,
          }).canFire === hasTarget
        },
      ),
    )
  })

  it('damages only the selected Wither and removes it only when the hit is lethal', () => {
    // Catches health underflow, a missed lethal removal, or damage leaking to another Wither.
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: 1, max: WITHER_MAX_HEALTH - 1 }),
          fc.integer({ min: WITHER_MAX_HEALTH, max: WITHER_MAX_HEALTH * 2 }),
        ),
        (damage) => {
          const first = summonRuntimeWither(
            initialWitherRuntimeState(),
            'overworld',
            witherPosition(0, 64, 0),
          )
          const summoned = summonRuntimeWither(first, 'overworld', witherPosition(10, 64, 0))
          const active = expectSuccess(
            advanceWitherRuntime(
              summoned,
              'overworld',
              witherPosition(100, 64, 0),
              WITHER_SPAWN_CHARGE_SECS,
              () => false,
            ),
          ).state
          const target = active.withers[0]
          const other = active.withers[1]
          if (target === undefined || other === undefined) return false

          const damaged = expectSuccess(damageRuntimeWither(active, target.id, damage, 'melee'))
          const survivingTarget = damaged.state.withers.find((wither) => wither.id === target.id)
          const lethal = damage >= target.state.healthPoints

          expect(damaged.state.withers.find((wither) => wither.id === other.id)).toStrictEqual(other)
          if (lethal) {
            return (
              damaged.death?.drop.item === 'nether_star' &&
              damaged.death.drop.count === 1 &&
              survivingTarget === undefined
            )
          }

          return (
            damaged.death === undefined &&
            survivingTarget !== undefined &&
            survivingTarget.state.healthPoints === target.state.healthPoints - damage
          )
        },
      ),
    )
  })

  it('clamps Ender Dragon health at death and emits each death reward once', () => {
    // Catches negative health after overkill and duplicate XP, portal, or egg rewards.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 1, max: ENDER_DRAGON_MAX_HEALTH }),
        (beforeDeath, afterDeathDamage) => {
          let state = initialEnderDragonEncounter()
          const rewardCounts = {
            xp: 0,
            portal: 0,
            egg: 0,
          }
          const damageSequence = [
            ...beforeDeath,
            ENDER_DRAGON_MAX_HEALTH,
            afterDeathDamage,
          ]

          for (const damage of damageSequence) {
            const result = damageEnderDragonByPlayer(state, damage)
            if (state.phase === 'dead') {
              if (result._tag !== 'Rejected' || result.reason !== 'dragon-defeated') return false
              continue
            }
            if (result._tag !== 'Applied') return false

            if (result.state.health < 0 || result.state.health > state.health) return false
            for (const event of result.events) {
              if (event._tag === 'ExperienceRewarded') rewardCounts.xp += 1
              if (event._tag === 'ExitPortalMaterializationRequested') rewardCounts.portal += 1
              if (event._tag === 'DragonEggRewarded') rewardCounts.egg += 1
            }
            state = result.state
          }

          return (
            state.phase === 'dead' &&
            state.health === 0 &&
            state.rewardEmitted &&
            rewardCounts.xp === 1 &&
            rewardCounts.portal === 1 &&
            rewardCounts.egg === 1
          )
        },
      ),
    )
  })
})
