import {
  EntityIdSchema,
  type EntityId,
  type ItemType,
  type ProjectileId,
  type SimulationTick,
} from '@nerima-games/mc-kernel'
import { Effect, Schema } from 'effect'
import {
  FishingStateSchema,
  ReplicatedOwnerIdSchema,
  WorldCommitCoordinator,
  isValidDurabilityForItem,
  type Durability,
  type EquipmentItem,
  type FishingServiceApi,
  type ReplicatedOwnerId,
  type WorldCommitCoordinatorError,
} from '@nerima-games/mc-sim'

export type FishingServiceCancelRequest = Readonly<{
  ownerId: ReplicatedOwnerId
  actor: EntityId
}>

export const FishingServiceCancelRequestSchema: Schema.ConstraintDecoder<
  FishingServiceCancelRequest
> = Schema.Struct({
  ownerId: ReplicatedOwnerIdSchema,
  actor: EntityIdSchema,
})

export type FishingServiceCancelResult =
  | { readonly _tag: 'Cancelled'; readonly actor: EntityId }
  | { readonly _tag: 'NotActive'; readonly actor: EntityId }

export const FishingServiceCancelResultSchema: Schema.ConstraintDecoder<
  FishingServiceCancelResult
> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Cancelled'), actor: EntityIdSchema }),
  Schema.Struct({ _tag: Schema.Literal('NotActive'), actor: EntityIdSchema }),
])

export const FISHING_ROD_ITEM = 'fishing_rod' as const
export const FISHING_MIN_WAIT_SECS = 5
export const FISHING_MAX_WAIT_SECS = 30
export const FISHING_BITE_WINDOW_SECS = 2
export const FISHING_RAIN_WAIT_MULTIPLIER = 0.8

export const FISHING_FISH_LOOT: ReadonlyArray<ItemType> = ['cod', 'salmon', 'tropical_fish', 'pufferfish']

export const FISHING_JUNK_LOOT: ReadonlyArray<ItemType> = [
  'bowl',
  'leather',
  'bone',
  'string',
  'stick',
  'lily_pad',
]

export const FISHING_TREASURE_LOOT: ReadonlyArray<ItemType> = ['name_tag', 'saddle', 'bow', 'enchanted_book']

export type FishingCategory = 'fish' | 'junk' | 'treasure'

export type FishingEnvironment = {
  readonly hasWater: boolean
  readonly hasSkyAccess: boolean
  readonly isRaining: boolean
  readonly isOpenWater: boolean
}

export type FishingRolls = {
  readonly wait: number
  readonly category: number
  readonly item: number
}

export type FishingRod = EquipmentItem & {
  readonly item: typeof FISHING_ROD_ITEM
  readonly durability: Durability
}

export type FishingLoot = {
  readonly category: FishingCategory
  readonly item: ItemType
  readonly count: 1
}

export type FishingSession = {
  readonly rod: FishingRod
  readonly elapsedSecs: number
  readonly waitSecs: number
  readonly biteWindowSecs: number
  readonly openWater: boolean
  readonly rolls: FishingRolls
}

export type FishingPhase = 'waiting' | 'bite' | 'escaped'

export type CastFishingResult =
  | { readonly _tag: 'Cast'; readonly session: FishingSession }
  | { readonly _tag: 'InvalidRod' }
  | { readonly _tag: 'NoWater' }
  | {
      readonly _tag: 'InvalidRoll'
      readonly roll: keyof FishingRolls
      readonly value: number
    }

export type AdvanceFishingResult =
  | { readonly _tag: 'Waiting'; readonly session: FishingSession }
  | { readonly _tag: 'Bite'; readonly session: FishingSession }
  | { readonly _tag: 'Escaped'; readonly session: FishingSession }
  | {
      readonly _tag: 'Cancelled'
      readonly reason: 'LostWater'
      readonly rod: FishingRod
    }
  | {
      readonly _tag: 'InvalidDuration'
      readonly durationSecs: number
      readonly session: FishingSession
    }

export type CancelFishingResult = {
  readonly _tag: 'Cancelled'
  readonly reason: 'Player'
  readonly rod: FishingRod
}

export type ReelFishingResult =
  | { readonly _tag: 'Caught'; readonly loot: FishingLoot; readonly rod: FishingRod | null }
  | { readonly _tag: 'ReeledTooEarly'; readonly rod: FishingRod | null }
  | { readonly _tag: 'ReeledTooLate'; readonly rod: FishingRod | null }
  | { readonly _tag: 'InvalidLoot' }

const isNormalisedRoll = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1

const copyRod = (rod: FishingRod): FishingRod => ({
  ...rod,
  durability: { ...rod.durability },
})

const isFishingRod = (item: EquipmentItem | null): item is FishingRod =>
  item !== null &&
  item.item === FISHING_ROD_ITEM &&
  item.count === 1 &&
  isValidDurabilityForItem(FISHING_ROD_ITEM, item.durability)

const waitSecsFor = (roll: number, environment: FishingEnvironment): number => {
  const base = FISHING_MIN_WAIT_SECS + roll * (FISHING_MAX_WAIT_SECS - FISHING_MIN_WAIT_SECS)
  return environment.isRaining && environment.hasSkyAccess
    ? base * FISHING_RAIN_WAIT_MULTIPLIER
    : base
}

const categoryFor = (roll: number, openWater: boolean): FishingCategory => {
  if (roll < 0.85) return 'fish'
  if (roll < 0.95) return 'junk'
  return openWater ? 'treasure' : 'fish'
}

const itemFor = (category: FishingCategory, roll: number): ItemType | undefined => {
  const items: ReadonlyArray<ItemType> =
    category === 'fish'
      ? FISHING_FISH_LOOT
      : category === 'junk'
        ? FISHING_JUNK_LOOT
        : FISHING_TREASURE_LOOT
  const index = Math.min(items.length - 1, Math.floor(roll * items.length))
  return items[index]
}

const lootFor = (session: FishingSession): FishingLoot | undefined => {
  const category = categoryFor(session.rolls.category, session.openWater)
  const item = itemFor(category, session.rolls.item)
  if (item === undefined) return undefined
  return {
    category,
    item,
    count: 1,
  }
}

const wearRod = (rod: FishingRod): FishingRod | null =>
  rod.durability.current === 1
    ? null
    : {
        ...rod,
        durability: {
          ...rod.durability,
          current: rod.durability.current - 1,
        },
      }

export const fishingPhase = (session: FishingSession): FishingPhase => {
  if (session.elapsedSecs < session.waitSecs) return 'waiting'
  if (session.elapsedSecs < session.waitSecs + session.biteWindowSecs) return 'bite'
  return 'escaped'
}

export const castFishing = (
  rod: EquipmentItem | null,
  environment: FishingEnvironment,
  rolls: FishingRolls,
): CastFishingResult => {
  if (!isFishingRod(rod)) return { _tag: 'InvalidRod' }
  if (!environment.hasWater) return { _tag: 'NoWater' }

  for (const roll of ['wait', 'category', 'item'] as const) {
    if (!isNormalisedRoll(rolls[roll])) {
      return { _tag: 'InvalidRoll', roll, value: rolls[roll] }
    }
  }

  return {
    _tag: 'Cast',
    session: {
      rod: copyRod(rod),
      elapsedSecs: 0,
      waitSecs: waitSecsFor(rolls.wait, environment),
      biteWindowSecs: FISHING_BITE_WINDOW_SECS,
      openWater: environment.isOpenWater,
      rolls: { ...rolls },
    },
  }
}

export const advanceFishing = (
  session: FishingSession,
  durationSecs: number,
  environment: Pick<FishingEnvironment, 'hasWater'>,
): AdvanceFishingResult => {
  if (!Number.isFinite(durationSecs) || durationSecs < 0) {
    return { _tag: 'InvalidDuration', durationSecs, session }
  }
  if (!environment.hasWater) {
    return { _tag: 'Cancelled', reason: 'LostWater', rod: copyRod(session.rod) }
  }

  const advanced = { ...session, elapsedSecs: session.elapsedSecs + durationSecs }
  const phase = fishingPhase(advanced)
  if (phase === 'waiting') return { _tag: 'Waiting', session: advanced }
  if (phase === 'bite') return { _tag: 'Bite', session: advanced }
  return { _tag: 'Escaped', session: advanced }
}

export const cancelFishing = (session: FishingSession): CancelFishingResult => ({
  _tag: 'Cancelled',
  reason: 'Player',
  rod: copyRod(session.rod),
})

export const reelFishing = (session: FishingSession): ReelFishingResult => {
  const rod = wearRod(session.rod)
  const phase = fishingPhase(session)
  if (phase === 'waiting') return { _tag: 'ReeledTooEarly', rod }
  if (phase === 'escaped') return { _tag: 'ReeledTooLate', rod }
  const loot = lootFor(session)
  return loot === undefined ? { _tag: 'InvalidLoot' } : { _tag: 'Caught', loot, rod }
}

export const castFishingWithService = (
  service: FishingServiceApi,
  actor: EntityId,
  bobber: ProjectileId,
): ReturnType<FishingServiceApi['cast']> => service.cast(actor, bobber)

export const biteFishingWithService = (
  service: FishingServiceApi,
  actor: EntityId,
): ReturnType<FishingServiceApi['bite']> => service.bite(actor)

export const reelFishingWithService = (
  service: FishingServiceApi,
  actor: EntityId,
  tick: SimulationTick,
): ReturnType<FishingServiceApi['reel']> => service.reel(actor, tick)

export const cancelFishingWithService = (
  request: FishingServiceCancelRequest,
): Effect.Effect<
  FishingServiceCancelResult,
  WorldCommitCoordinatorError,
  WorldCommitCoordinator
> =>
  Effect.gen(function* () {
    const coordinator = yield* WorldCommitCoordinator
    const snapshot = yield* coordinator.snapshot(request.ownerId, FishingStateSchema)
    const rods = snapshot.state.rods.filter((rod) => rod.actor !== request.actor)
    if (rods.length === snapshot.state.rods.length) {
      return { _tag: 'NotActive' as const, actor: request.actor }
    }

    yield* coordinator.commit({
      expectedRevision: snapshot.revision,
      expectedDimensions: [],
      changes: [{ ownerId: request.ownerId, state: { ...snapshot.state, rods } }],
    })

    return { _tag: 'Cancelled' as const, actor: request.actor }
  })
