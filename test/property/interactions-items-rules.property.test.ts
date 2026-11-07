import { describe, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import {
  AttackRangeDistance,
  type BlockType,
  EntityHealthPoints,
  EntityId,
} from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import { HungerPoints, type Entity } from '@nerima-games/mc-sim'
import { resolveFoodUse } from '../../src/domain/interactions/eat-food'
import {
  INERT_ITEM,
  resolveInteractionIntent,
  type InteractionSnapshot,
} from '../../src/domain/interactions/interaction-intent'
import { meleeTarget, type MeleeAttackRequest } from '../../src/domain/interactions/melee-attack'
import {
  rightClickRoute,
  ROUTED_BLOCKS,
  type RightClickRoute,
} from '../../src/domain/interactions/right-click-target'
import {
  enderPearlDisplacement,
  enderPearlDistance,
} from '../../src/domain/interactions/throw-ender-pearl'
import {
  ARMOR_SLOTS,
  prepareUnequipTopmost,
  type Equipment,
} from '../../src/domain/interactions/unequip-armor'
import { BOW_TARGET_CENTER_Y_OFFSET } from '../../src/domain/interactions/bow-shot'
import { type MobBehaviour } from '../../src/domain/entities/mob-frame'
import { ZOMBIE_KIND } from '../../src/domain/mob/hostile-combat'
import { blockPosition, position } from '../support/coordinate-fixtures'
import { ITEM_TYPES, type ItemType } from '@nerima-games/mc-kernel'

const inertSnapshot: InteractionSnapshot = {
  paused: false,
  isSpectator: false,
  leftClick: false,
  mouseHeld: false,
  middleClick: false,
  rightClick: false,
  rightMouseHeld: false,
  redstoneFlags: {},
  held: INERT_ITEM,
  chargeStartedAtSecs: null,
}

const optionalItem = FastCheck.oneof(
  FastCheck.constant(undefined),
  FastCheck.constantFrom(...ITEM_TYPES),
)

const EXPECTED_ROUTE_KIND: Partial<Record<BlockType, RightClickRoute['kind']>> = {
  chest: 'storage',
  shulker_box: 'storage',
  dispenser: 'storage',
  hopper: 'storage',
  crafting_table: 'craftingTable',
  furnace: 'furnace',
  bed: 'bed',
  enchanting_table: 'enchantingTable',
  anvil: 'anvil',
  door: 'door',
  door_open: 'door',
} as const

const equipmentFor = (
  helmet: ItemType | undefined,
  chestplate: ItemType | undefined,
  leggings: ItemType | undefined,
  boots: ItemType | undefined,
): Equipment => ({
  ...(helmet === undefined ? {} : { helmet }),
  ...(chestplate === undefined ? {} : { chestplate }),
  ...(leggings === undefined ? {} : { leggings }),
  ...(boots === undefined ? {} : { boots }),
})

describe('interaction and item-use properties', () => {
  it('suppresses every generated interaction while paused or spectating', () => {
    // Fails if any mouse input can start a world action while interaction is disabled.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.boolean(),
        FastCheck.boolean(),
        FastCheck.array(FastCheck.boolean(), { minLength: 5, maxLength: 5 }),
        (paused, isSpectator, inputs) => {
          const [leftClick, mouseHeld, middleClick, rightClick, rightMouseHeld] = inputs
          const hasInput = inputs.some((pressed) => pressed)
          const intent = resolveInteractionIntent({
            ...inertSnapshot,
            paused,
            isSpectator,
            leftClick: leftClick ?? false,
            mouseHeld: mouseHeld ?? false,
            middleClick: middleClick ?? false,
            rightClick: rightClick ?? false,
            rightMouseHeld: rightMouseHeld ?? false,
          })

          return paused || isSpectator ? !intent.canInteract : intent.canInteract === hasInput
        },
      ),
    )
  })

  it('consumes one potato below the hunger cap and none at the cap', () => {
    // Fails if hunger at its exact maximum still consumes food or a valid meal removes multiple items.
    FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 0, max: 20 }), (hungerPoints) => {
        const outcome = resolveFoodUse({
          held: 'potato',
          vitals: {
            healthPoints: EntityHealthPoints(20),
            hungerPoints: HungerPoints(hungerPoints),
            maxHungerPoints: HungerPoints(20),
          },
        })

        return hungerPoints === 20
          ? outcome._tag === 'full'
          : outcome._tag === 'consume' && outcome.count === 1
      }),
    )
  })

  it('round-trips the first occupied armor slot without losing the other slots', () => {
    // Fails if removing and restoring the selected slot changes equipment or skips a higher slot.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.tuple(optionalItem, optionalItem, optionalItem, optionalItem),
        ([helmet, chestplate, leggings, boots]) => {
          const equipment = equipmentFor(helmet, chestplate, leggings, boots)
          const result = prepareUnequipTopmost(equipment)
          if (Result.isFailure(result)) return false

          const expectedSlot = ARMOR_SLOTS.find((slot) => equipment[slot] !== undefined)
          const preparation = result.success
          if (expectedSlot === undefined) {
            return preparation._tag === 'NothingWorn' &&
              ARMOR_SLOTS.every((slot) => preparation.nextEquipment[slot] === equipment[slot])
          }
          if (preparation._tag !== 'Unequip') return false
          if (preparation.slot !== expectedSlot) return false

          const restored = { ...preparation.nextEquipment, [preparation.slot]: preparation.item }
          return preparation.nextEquipment[preparation.slot] === undefined &&
            ARMOR_SLOTS.every((slot) =>
              slot === preparation.slot || preparation.nextEquipment[slot] === equipment[slot],
            ) &&
            ARMOR_SLOTS.every((slot) => restored[slot] === equipment[slot])
        },
      ),
    )
  })

  it('routes every generated interaction block without changing its target position', () => {
    // Fails if routing drops a clicked position or returns an absent route for a supported block.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.constantFrom(...ROUTED_BLOCKS),
        FastCheck.integer({ min: -1000, max: 1000 }),
        FastCheck.integer({ min: 0, max: 255 }),
        FastCheck.integer({ min: -1000, max: 1000 }),
        (block, x, y, z) => {
          const at = blockPosition(x, y, z)
          const route = rightClickRoute(at, block)
          return route !== undefined &&
            route.at === at &&
            route.kind === EXPECTED_ROUTE_KIND[block]
        },
      ),
    )
  })

  it('normalizes pearl directions and clamps every finite hit distance', () => {
    // Fails if a nonzero aim is not normalized to the hit distance or a finite hit exceeds the cap.
    FastCheck.assert(
      FastCheck.property(
        FastCheck.tuple(
          FastCheck.double({ min: -10, max: 10, noNaN: true }),
          FastCheck.double({ min: -10, max: 10, noNaN: true }),
          FastCheck.double({ min: -10, max: 10, noNaN: true }),
          FastCheck.double({ min: 0.1, max: 10, noNaN: true }),
          FastCheck.oneof(
            FastCheck.constant(undefined),
            FastCheck.double({ min: -100, max: 100, noNaN: true }),
          ),
        ),
        ([dirX, dirY, dirZ, scale, hitDistance]) => {
          const displacement = enderPearlDisplacement(dirX, dirY, dirZ, hitDistance)
          const scaledX = dirX * scale
          const scaledY = dirY * scale
          const scaledZ = dirZ * scale
          const scaled = enderPearlDisplacement(scaledX, scaledY, scaledZ, hitDistance)
          const directionMagnitude = Math.max(Math.abs(dirX), Math.abs(dirY), Math.abs(dirZ))
          const scaledMagnitude = Math.max(Math.abs(scaledX), Math.abs(scaledY), Math.abs(scaledZ))
          if (directionMagnitude === 0) return displacement === undefined && scaled === undefined
          if (displacement === undefined) return false

          const directionX = dirX / directionMagnitude
          const directionY = dirY / directionMagnitude
          const directionZ = dirZ / directionMagnitude
          const directionLength = Math.hypot(directionX, directionY, directionZ)
          const close = (left: number, right: number) => Math.abs(left - right) < 1e-9
          const distance = enderPearlDistance(hitDistance)
          const originalMatchesDirection = close(displacement.x, directionX / directionLength * distance) &&
            close(displacement.y, directionY / directionLength * distance) &&
            close(displacement.z, directionZ / directionLength * distance) &&
            close(Math.hypot(displacement.x, displacement.y, displacement.z), distance)
          if (!originalMatchesDirection) return false
          // IEEE-754 can round Number.MIN_VALUE * 0.1 to zero, which is the rejected zero direction.
          if (scaledMagnitude === 0) return scaled === undefined
          if (scaled === undefined) return false

          const scaledDirectionX = scaledX / scaledMagnitude
          const scaledDirectionY = scaledY / scaledMagnitude
          const scaledDirectionZ = scaledZ / scaledMagnitude
          const scaledDirectionLength = Math.hypot(scaledDirectionX, scaledDirectionY, scaledDirectionZ)
          const scaledMatchesDirection = close(scaled.x, scaledDirectionX / scaledDirectionLength * distance) &&
            close(scaled.y, scaledDirectionY / scaledDirectionLength * distance) &&
            close(scaled.z, scaledDirectionZ / scaledDirectionLength * distance) &&
            close(Math.hypot(scaled.x, scaled.y, scaled.z), distance)
          if (!scaledMatchesDirection) return false

          // Underflow can change a represented direction; require scale invariance only when it is preserved.
          const sameRepresentedDirection = close(directionX / directionLength, scaledDirectionX / scaledDirectionLength) &&
            close(directionY / directionLength, scaledDirectionY / scaledDirectionLength) &&
            close(directionZ / directionLength, scaledDirectionZ / scaledDirectionLength)
          return !sameRepresentedDirection ||
            close(displacement.x, scaled.x) &&
            close(displacement.y, scaled.y) &&
            close(displacement.z, scaled.z)
        },
      ),
      {
        examples: [
          [[0, 0, -5e-324, 0.1, undefined]],
          [[0, -5e-324, 5e-324, 0.1, undefined]],
        ],
      },
    )
  })
})

describe('melee target boundary property', () => {
  const request: Omit<MeleeAttackRequest, 'hitDistance'> = {
    origin: position(0, 64, 0),
    direction: position(0, 0, 1),
    reach: AttackRangeDistance(3),
    damage: 1,
  }

  it('treats a block hit at the target distance as an occluder', () => {
    // Fails if an entity tied with or behind the block ray still receives a melee hit.
    FastCheck.assert(
      FastCheck.property(FastCheck.double({ min: 1, max: 2.9, noNaN: true }), (depth) => {
        const target: Entity<MobBehaviour> = {
          id: EntityId('property-melee-target'),
          kind: ZOMBIE_KIND,
          feetPosition: position(0, 64 - BOW_TARGET_CENTER_Y_OFFSET, depth),
          healthPoints: EntityHealthPoints(20),
          behaviour: undefined,
        }
        const candidates = [target]
        const hit = meleeTarget(candidates, request)
        if (hit === undefined) return false

        const tied = meleeTarget(candidates, { ...request, hitDistance: hit.distance })
        const clear = meleeTarget(candidates, { ...request, hitDistance: hit.distance + 0.001 })
        return tied === undefined && clear?.id === target.id
      }),
    )
  })
})
