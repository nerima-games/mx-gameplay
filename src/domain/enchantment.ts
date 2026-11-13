import { Brand, Result, Schema } from 'effect'
import {
  isItemType,
  RandomSeed,
  type ExperienceAmount,
  type ItemType,
  type RandomSeed as RandomSeedValue,
} from '@nerima-games/mc-kernel'
import {
  EnchantmentLevel,
  NonNegativeTickCount,
  type EnchantmentLevel as EnchantmentLevelValue,
  type InterpolationFraction as InterpolationFractionValue,
  type NonNegativeTickCount as NonNegativeTickCountValue,
} from '@nerima-games/mc-kernel/domain/quantities'
import {
  SUPPORTED_VANILLA_ENCHANTMENT_IDS,
  SUPPORTED_VANILLA_ENCHANTMENT_RULES,
  type SupportedVanillaEnchantmentId,
} from '@nerima-games/mc-kernel/domain/enchantment'
import {
  enchantmentsComponent,
  type EnchantmentsComponent,
} from '@nerima-games/mc-kernel/domain/item-enchantments'
import {
  enchantmentTableOutputItemOf as simEnchantmentTableOutputItemOf,
  generateEnchantmentTableOffers as generateEnchantmentTableOffersWithSim,
  isDamageableItemType,
  isValidDurabilityForItem,
  type Durability,
  type EnchantmentTableError,
  type EnchantmentTableItem,
  type EnchantmentTableOffers,
  type EnchantmentTableRandom,
  EnchantmentTableOfferSchema as SimEnchantmentTableOfferSchema,
  type EquipmentSlot,
} from '@nerima-games/mc-sim'

import { applyArmorPointsToDamage, type ArmorPoints } from './combat/armor-mitigation.js'
import type { Damage } from './death-cause.js'
import { bowPowerMultiplier } from './interactions/draw-bow.js'

export const ENCHANTMENT_IDS: typeof SUPPORTED_VANILLA_ENCHANTMENT_IDS =
  SUPPORTED_VANILLA_ENCHANTMENT_IDS

export type EnchantmentId = SupportedVanillaEnchantmentId
export type EnchantmentTarget = 'armor' | 'melee_weapon' | 'mining_tool' | 'bow' | 'damageable'
export type EnchantmentConflictId = EnchantmentId

type SharedEnchantmentRule = (typeof SUPPORTED_VANILLA_ENCHANTMENT_RULES)[number]
export type EnchantmentDefinition = SharedEnchantmentRule & {
  /** Compatibility metadata derived from the shared item applicability table. */
  readonly targets: ReadonlyArray<EnchantmentTarget>
}

const targetsForItems = (items: ReadonlyArray<ItemType>): ReadonlyArray<EnchantmentTarget> => {
  const targets = new Set<EnchantmentTarget>()
  if (items.some((item) => /_(helmet|chestplate|leggings|boots)$/.test(item))) targets.add('armor')
  if (items.some((item) => item.endsWith('_sword'))) targets.add('melee_weapon')
  if (items.some((item) => /_(pickaxe|hoe)$/.test(item) || item === 'shears')) {
    targets.add('mining_tool')
  }
  if (items.includes('bow')) targets.add('bow')
  if (items.some(isDamageableItemType)) targets.add('damageable')
  return [...targets]
}

export const ENCHANTMENT_REGISTRY: Readonly<Record<EnchantmentId, EnchantmentDefinition>> =
  Object.fromEntries(
    SUPPORTED_VANILLA_ENCHANTMENT_RULES.map((rule) => [
      rule.id,
      { ...rule, targets: targetsForItems(rule.applicableItems) },
    ]),
  ) as Record<EnchantmentId, EnchantmentDefinition>

const isEnchantmentId = (value: unknown): value is EnchantmentId =>
  typeof value === 'string' && ENCHANTMENT_IDS.includes(value as EnchantmentId)

export const enchantmentAppliesTo = (id: EnchantmentId, item: ItemType): boolean =>
  ENCHANTMENT_REGISTRY[id].applicableItems.includes(item)

export const enchantmentsConflict = (
  left: EnchantmentConflictId,
  right: EnchantmentConflictId,
): boolean => {
  if (left === right) return false

  return (
    ENCHANTMENT_REGISTRY[left].incompatibleWith.includes(right) ||
    ENCHANTMENT_REGISTRY[right].incompatibleWith.includes(left)
  )
}

export type Enchantment = {
  readonly id: EnchantmentId
  readonly level: number
}

export type EnchantmentDamageMultiplier = number & Brand.Brand<'EnchantmentDamageMultiplier'>
export const EnchantmentDamageMultiplierSchema: Schema.Codec<EnchantmentDamageMultiplier, number> =
  Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })).pipe(
    Schema.brand('EnchantmentDamageMultiplier'),
  )

export type SweepingEdgeDamageMultiplier = number & Brand.Brand<'SweepingEdgeDamageMultiplier'>
export const SweepingEdgeDamageMultiplierSchema: Schema.Codec<SweepingEdgeDamageMultiplier, number> =
  Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })).pipe(
    Schema.brand('SweepingEdgeDamageMultiplier'),
  )

export type EnchantmentChance = number & Brand.Brand<'EnchantmentChance'>
export const EnchantmentChanceSchema: Schema.Codec<EnchantmentChance, number> =
  Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })).pipe(
    Schema.brand('EnchantmentChance'),
  )

export type KnockbackStrength = number & Brand.Brand<'KnockbackStrength'>
export const KnockbackStrengthSchema: Schema.Codec<KnockbackStrength, number> =
  Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('KnockbackStrength'))

export type FrostWalkerFreezeRadius = number & Brand.Brand<'FrostWalkerFreezeRadius'>
export const FrostWalkerFreezeRadiusSchema: Schema.Codec<FrostWalkerFreezeRadius, number> =
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('FrostWalkerFreezeRadius'))

export type MendingDurabilityRepairPoints = number & Brand.Brand<'MendingDurabilityRepairPoints'>
export const MendingDurabilityRepairPointsSchema: Schema.Codec<MendingDurabilityRepairPoints, number> =
  Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.brand('MendingDurabilityRepairPoints'),
  )

export type MendingExperiencePoints = number & Brand.Brand<'MendingExperiencePoints'>
export const MendingExperiencePointsSchema: Schema.Codec<MendingExperiencePoints, number> =
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })).pipe(
    Schema.brand('MendingExperiencePoints'),
  )
const makeMendingExperiencePoints = Brand.make<MendingExperiencePoints>(
  (value) => Number.isSafeInteger(value) && value >= 0,
)

export type EnchantedItem = {
  readonly item: ItemType
  readonly durability: Durability | null
  readonly enchantments: ReadonlyArray<Enchantment>
}

export type EnchantedItemValidationIssue = {
  readonly path: string
  readonly reason: string
}

export type EnchantedItemResult =
  | { readonly ok: true; readonly value: EnchantedItem }
  | { readonly ok: false; readonly issues: ReadonlyArray<EnchantedItemValidationIssue> }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const canonicalEnchantments = (
  enchantments: ReadonlyArray<Enchantment>,
): ReadonlyArray<Enchantment> =>
  [...enchantments]
    .sort((left, right) => ENCHANTMENT_IDS.indexOf(left.id) - ENCHANTMENT_IDS.indexOf(right.id))
    .map(({ id, level }) => ({ id, level }))

export const decodeEnchantedItem = (value: unknown): EnchantedItemResult => {
  const issues: Array<EnchantedItemValidationIssue> = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '$', reason: 'must be an object' }] }

  const itemValue = value['item']
  const item = typeof itemValue === 'string' && isItemType(itemValue) ? itemValue : undefined
  if (item === undefined) issues.push({ path: 'item', reason: 'must be a known item type' })

  const durabilityValue = value['durability']
  let durability: Durability | null | undefined
  if (durabilityValue === null) {
    durability = null
  } else if (isRecord(durabilityValue)) {
    const current = durabilityValue['current']
    const max = durabilityValue['max']
    if (typeof current === 'number' && typeof max === 'number') durability = { current, max }
  }
  if (durability === undefined) {
    issues.push({ path: 'durability', reason: 'must be null or a durability object' })
  } else if (item !== undefined) {
    if (isDamageableItemType(item)) {
      if (durability === null || !isValidDurabilityForItem(item, durability)) {
        issues.push({ path: 'durability', reason: 'does not match the item durability catalog' })
      }
    } else if (durability !== null) {
      issues.push({ path: 'durability', reason: 'must be null for a non-damageable item' })
    }
  }

  const enchantmentsValue = value['enchantments']
  const enchantments: Array<Enchantment> = []
  if (!Array.isArray(enchantmentsValue)) {
    issues.push({ path: 'enchantments', reason: 'must be an array' })
  } else {
    const seen = new Set<EnchantmentId>()
    for (const [index, enchantmentValue] of enchantmentsValue.entries()) {
      if (!isRecord(enchantmentValue)) {
        issues.push({ path: `enchantments.${index}`, reason: 'must be an object' })
        continue
      }
      const idValue = enchantmentValue['id']
      const levelValue = enchantmentValue['level']
      if (!isEnchantmentId(idValue)) {
        issues.push({ path: `enchantments.${index}.id`, reason: 'must be a registered enchantment' })
        continue
      }
      if (
        typeof levelValue !== 'number' ||
        !Number.isSafeInteger(levelValue) ||
        levelValue < 1 ||
        levelValue > ENCHANTMENT_REGISTRY[idValue].maxLevel
      ) {
        issues.push({ path: `enchantments.${index}.level`, reason: 'must be within the level cap' })
        continue
      }
      if (seen.has(idValue)) {
        issues.push({ path: `enchantments.${index}.id`, reason: 'must be unique' })
        continue
      }
      if (item !== undefined && !enchantmentAppliesTo(idValue, item)) {
        issues.push({ path: `enchantments.${index}.id`, reason: 'does not apply to this item' })
        continue
      }
      if ([...seen].some((previousId) => enchantmentsConflict(idValue, previousId))) {
        issues.push({ path: `enchantments.${index}.id`, reason: 'conflicts with another enchantment' })
        continue
      }
      seen.add(idValue)
      enchantments.push({ id: idValue, level: levelValue })
    }
  }

  if (issues.length > 0 || item === undefined || durability === undefined) {
    return { ok: false, issues }
  }
  return {
    ok: true,
    value: { item, durability: durability === null ? null : { ...durability }, enchantments: canonicalEnchantments(enchantments) },
  }
}

export const validateEnchantedItem = (value: unknown): value is EnchantedItem =>
  decodeEnchantedItem(value).ok

export const snapshotEnchantedItem = (item: EnchantedItem): EnchantedItemResult =>
  decodeEnchantedItem(item)

export type EnchantedItemEncodingResult =
  | { readonly ok: true; readonly encoded: string }
  | { readonly ok: false; readonly issues: ReadonlyArray<EnchantedItemValidationIssue> }

export const encodeEnchantedItem = (item: EnchantedItem): EnchantedItemEncodingResult => {
  const snapshot = snapshotEnchantedItem(item)
  return snapshot.ok
    ? { ok: true, encoded: JSON.stringify(snapshot.value) }
    : { ok: false, issues: snapshot.issues }
}

export const decodeEnchantedItemSnapshot = (encoded: string): EnchantedItemResult => {
  const parsed = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown))(encoded)
  return Result.isFailure(parsed)
    ? { ok: false, issues: [{ path: '$', reason: 'must be valid JSON' }] }
    : decodeEnchantedItem(parsed.success)
}

export type EnchantmentTableSlot = 0 | 1 | 2

export type EnchantmentOffer = {
  readonly seed: number
  readonly bookshelfCount: number
  readonly slot: EnchantmentTableSlot
  readonly enchantment: Enchantment
  readonly requiredPlayerLevel: number
  readonly lapisCost: 1 | 2 | 3
}

const normalizeSeed = (seed: number): number =>
  Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
const normalizeBookshelves = (bookshelves: number): number =>
  Number.isFinite(bookshelves) ? Math.min(15, Math.max(0, Math.floor(bookshelves))) : 0

const mixSeed = (value: number): number => {
  let mixed = value >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad)
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97)
  return (mixed ^ (mixed >>> 15)) >>> 0
}

export const rerollEnchantmentSeed = (seed: number): number =>
  mixSeed(normalizeSeed(seed) + 0x9e3779b9)

export const enchantmentOffer = (
  seed: number,
  bookshelfCount: number,
  slot: EnchantmentTableSlot,
): EnchantmentOffer => {
  const normalizedSeed = normalizeSeed(seed)
  const shelves = normalizeBookshelves(bookshelfCount)
  const slotSeed = mixSeed(normalizedSeed ^ Math.imul(slot + 1, 0x85ebca6b) ^ shelves)
  const base = 1 + shelves + (slotSeed % (shelves + 1))
  const requiredPlayerLevel =
    slot === 0
      ? Math.max(1, Math.floor(base / 3))
      : slot === 1
        ? Math.max(1, Math.floor((base * 2) / 3) + 1)
        : Math.max(1, Math.min(30, Math.max(shelves * 2, base)))
  // The modulus uses the shared registry length, so every shared ID can appear.
  const id = ENCHANTMENT_IDS[mixSeed(slotSeed + 1) % ENCHANTMENT_IDS.length]!
  const maxLevel = ENCHANTMENT_REGISTRY[id].maxLevel
  const level = Math.min(maxLevel, Math.max(1, 1 + Math.floor(requiredPlayerLevel / 6)))

  return {
    seed: normalizedSeed,
    bookshelfCount: shelves,
    slot,
    enchantment: { id, level },
    requiredPlayerLevel,
    lapisCost: (slot + 1) as 1 | 2 | 3,
  }
}

export const enchantmentOffers = (
  seed: number,
  bookshelfCount: number,
): readonly [EnchantmentOffer, EnchantmentOffer, EnchantmentOffer] => [
  enchantmentOffer(seed, bookshelfCount, 0),
  enchantmentOffer(seed, bookshelfCount, 1),
  enchantmentOffer(seed, bookshelfCount, 2),
]

const enchantmentTableRandomForSeed = (seed: number): EnchantmentTableRandom => {
  let state = normalizeSeed(seed)
  const next = (): number => {
    state = mixSeed((state + 0x9e3779b9) >>> 0)
    return state / 0x1_0000_0000
  }

  return {
    nextInt: (bound) => Math.floor(next() * bound),
    nextFloat: next,
  }
}

export type EnchantmentBookshelfCount = number & Brand.Brand<'EnchantmentBookshelfCount'>
export const EnchantmentBookshelfCountSchema: Schema.Codec<EnchantmentBookshelfCount, number> = Schema.Int
  .check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
  .pipe(Schema.brand('EnchantmentBookshelfCount'))
export const EnchantmentTableShelfCountSchema: Schema.Codec<EnchantmentBookshelfCount, number> = Schema.Int
  .check(Schema.isBetween({ minimum: 0, maximum: 15 }))
  .pipe(Schema.brand('EnchantmentBookshelfCount'))
export const generateEnchantmentTableOffersForItem = (
  item: EnchantmentTableItem,
  seed: RandomSeedValue,
  bookshelfCount: EnchantmentBookshelfCount,
): Result.Result<EnchantmentTableOffers, EnchantmentTableError> =>
  generateEnchantmentTableOffersWithSim({
    item,
    bookshelfCount,
    random: enchantmentTableRandomForSeed(seed),
  })

export const enchantmentTableResultItemOf = (item: EnchantmentTableItem): ItemType =>
  simEnchantmentTableOutputItemOf(item)

export type EnchantmentTableState = {
  readonly seed: number
  readonly bookshelfCount: number
  readonly playerLevel: number
  readonly lapis: number
  readonly item: EnchantedItem | null
}

export type EnchantmentRejectionReason =
  | 'invalid_state'
  | 'no_item'
  | 'invalid_item'
  | 'invalid_offer'
  | 'incompatible_item'
  | 'conflicting_enchantment'
  | 'insufficient_level'
  | 'insufficient_lapis'

export type EnchantmentTransactionResult =
  | { readonly ok: true; readonly state: EnchantmentTableState }
  | { readonly ok: false; readonly state: EnchantmentTableState; readonly reason: EnchantmentRejectionReason }

const rejectTransaction = (
  state: EnchantmentTableState,
  reason: EnchantmentRejectionReason,
): EnchantmentTransactionResult => ({ ok: false, state, reason })

const legacyOffersMatch = (left: EnchantmentOffer, right: EnchantmentOffer): boolean =>
  left.seed === right.seed &&
  left.bookshelfCount === right.bookshelfCount &&
  left.slot === right.slot &&
  left.enchantment.id === right.enchantment.id &&
  left.enchantment.level === right.enchantment.level &&
  left.requiredPlayerLevel === right.requiredPlayerLevel &&
  left.lapisCost === right.lapisCost

const tableOffersMatch = (
  left: Readonly<{
    readonly levelCost: number
    readonly lapisCost: 1 | 2 | 3
    readonly enchantments: ReadonlyArray<Readonly<{ readonly id: string; readonly level: number }>>
  }>,
  right: Readonly<{
    readonly levelCost: number
    readonly lapisCost: 1 | 2 | 3
    readonly enchantments: ReadonlyArray<Readonly<{ readonly id: string; readonly level: number }>>
  }>,
): boolean =>
  left.levelCost === right.levelCost &&
  left.lapisCost === right.lapisCost &&
  left.enchantments.length === right.enchantments.length &&
  left.enchantments.every(({ id, level }, index) => {
    const expected = right.enchantments[index]
    return expected !== undefined && expected.id === id && expected.level === level
  })

const LegacyEnchantmentOfferSchema = Schema.Struct({
  seed: Schema.Int,
  bookshelfCount: Schema.Int,
  slot: Schema.Literals([0, 1, 2]),
  enchantment: Schema.Struct({
    id: Schema.Literals(ENCHANTMENT_IDS),
    level: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 255 })),
  }),
  requiredPlayerLevel: Schema.Int.check(Schema.isGreaterThan(0)),
  lapisCost: Schema.Literals([1, 2, 3]),
})
const EnchantmentOfferInputSchema = Schema.Union([
  LegacyEnchantmentOfferSchema,
  SimEnchantmentTableOfferSchema,
])

export const applyEnchantmentOffer = (
  state: EnchantmentTableState,
  input: unknown,
): EnchantmentTransactionResult => {
  const decodedOffer = Schema.decodeUnknownResult(EnchantmentOfferInputSchema)(input)
  if (Result.isFailure(decodedOffer)) return rejectTransaction(state, 'invalid_offer')
  const offer = decodedOffer.success
  if (state.item === null) return rejectTransaction(state, 'no_item')
  if (
    !Number.isSafeInteger(state.playerLevel) ||
    state.playerLevel < 0 ||
    !Number.isSafeInteger(state.lapis) ||
    state.lapis < 0
  ) {
    return rejectTransaction(state, 'invalid_state')
  }
  const itemSnapshot = snapshotEnchantedItem(state.item)
  if (!itemSnapshot.ok) return rejectTransaction(state, 'invalid_item')
  let offeredEnchantments: ReadonlyArray<Enchantment>
  let requiredPlayerLevel: number
  if ('enchantments' in offer) {
    const seed = Result.getOrUndefined(RandomSeed.result(state.seed))
    const bookshelfCount = Result.getOrUndefined(
      Schema.decodeUnknownResult(EnchantmentTableShelfCountSchema)(state.bookshelfCount),
    )
    if (seed === undefined || bookshelfCount === undefined) return rejectTransaction(state, 'invalid_state')
    const slot = (offer.lapisCost - 1) as EnchantmentTableSlot
    const expected = Result.getOrUndefined(
      Result.map(
        generateEnchantmentTableOffersForItem(itemSnapshot.value.item, seed, bookshelfCount),
        (offers) => offers[slot],
      ),
    )
    if (expected === undefined || !tableOffersMatch(offer, expected)) {
      return rejectTransaction(state, 'invalid_offer')
    }
    offeredEnchantments = offer.enchantments
    requiredPlayerLevel = Math.max(offer.levelCost, offer.lapisCost)
  } else {
    const expected = enchantmentOffer(state.seed, state.bookshelfCount, offer.slot)
    if (!legacyOffersMatch(offer, expected)) return rejectTransaction(state, 'invalid_offer')
    offeredEnchantments = [offer.enchantment]
    requiredPlayerLevel = offer.requiredPlayerLevel
  }
  if (offeredEnchantments.length === 0 || offeredEnchantments.some(({ id }) =>
    !enchantmentAppliesTo(id, itemSnapshot.value.item),
  )) {
    return rejectTransaction(state, 'incompatible_item')
  }
  if (offeredEnchantments.some(({ id }, index) =>
    itemSnapshot.value.enchantments.some((existing) => enchantmentsConflict(id, existing.id)) ||
    offeredEnchantments.slice(index + 1).some((next) => enchantmentsConflict(id, next.id)),
  )) {
    return rejectTransaction(state, 'conflicting_enchantment')
  }
  if (state.playerLevel < requiredPlayerLevel) {
    return rejectTransaction(state, 'insufficient_level')
  }
  if (state.lapis < offer.lapisCost) return rejectTransaction(state, 'insufficient_lapis')

  const nextEnchantments = itemSnapshot.value.enchantments.filter(
    ({ id }) => !offeredEnchantments.some((enchantment) => enchantment.id === id),
  )
  nextEnchantments.push(...offeredEnchantments)
  const nextItem: EnchantedItem = {
    ...itemSnapshot.value,
    enchantments: canonicalEnchantments(nextEnchantments),
  }

  return {
    ok: true,
    state: {
      seed: rerollEnchantmentSeed(state.seed),
      bookshelfCount: normalizeBookshelves(state.bookshelfCount),
      playerLevel: state.playerLevel - offer.lapisCost,
      lapis: state.lapis - offer.lapisCost,
      item: nextItem,
    },
  }
}

export type EnchantmentSource = EnchantedItem | EnchantmentsComponent | ReadonlyArray<Enchantment>

const isEnchantedItemSource = (source: EnchantmentSource): source is EnchantedItem =>
  !Array.isArray(source) &&
  typeof source === 'object' &&
  source !== null &&
  'item' in source &&
  typeof source.item === 'string' &&
  isItemType(source.item)

const validLevel = (value: unknown): EnchantmentLevelValue =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 255
    ? EnchantmentLevel(value)
    : EnchantmentLevel(0)

/** Read one level from a gameplay item, an enchantment list, or a kernel component. */
export const enchantmentLevel = (
  source: EnchantmentSource,
  id: EnchantmentId,
): EnchantmentLevelValue => {
  if (Array.isArray(source)) {
    return validLevel(
      (source as ReadonlyArray<Enchantment>).find((enchantment) => enchantment.id === id)?.level,
    )
  }
  if (isEnchantedItemSource(source)) {
    return validLevel(source.enchantments.find((enchantment) => enchantment.id === id)?.level)
  }
  const component = source as EnchantmentsComponent
  return validLevel(component[`minecraft:${id}`] ?? component[id])
}

/** Convert the gameplay list representation into the kernel's namespaced component map. */
export const enchantmentComponentOf = (
  item: EnchantedItem,
): ReturnType<typeof enchantmentsComponent> =>
  enchantmentsComponent(Object.fromEntries(
    item.enchantments.map(({ id, level }) => [`minecraft:${id}`, level]),
  ))

const nonNegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0

export type EnchantmentDamageTarget = 'undead' | 'arthropod' | 'other'

export const meleeDamageWithEnchantments = (
  baseDamage: number,
  source: EnchantmentSource,
  target: EnchantmentDamageTarget = 'other',
): number => {
  const sharpness = enchantmentLevel(source, 'sharpness')
  const smite = target === 'undead' ? enchantmentLevel(source, 'smite') : 0
  const bane = target === 'arthropod' ? enchantmentLevel(source, 'bane_of_arthropods') : 0
  return (
    nonNegative(baseDamage) +
    (sharpness === 0 ? 0 : 0.5 * sharpness + 0.5) +
    2.5 * (smite + bane)
  )
}

export const bowDamageWithEnchantments = (baseDamage: number, source: EnchantmentSource): number =>
  Math.ceil(nonNegative(baseDamage) * bowPowerMultiplier(enchantmentLevel(source, 'power')))

export type EnchantmentDamageCategory =
  | 'generic'
  | 'fire'
  | 'explosion'
  | 'projectile'
  | 'fall'
  | 'unprotected'

const damageCategory = (damage: Damage): EnchantmentDamageCategory => {
  if (damage.cause === 'fall' || damage.cause === 'ender_pearl') return 'fall'
  if (damage.cause === 'starvation' || damage.cause === 'void' || damage.cause === 'generic') {
    return 'unprotected'
  }
  if (damage.cause === 'explosion') return 'explosion'
  if (damage.cause === 'projectile') return 'projectile'
  if (damage.cause === 'lava' || damage.cause === 'in_fire' || damage.cause === 'on_fire') {
    return 'fire'
  }
  return 'generic'
}

/** Vanilla's capped EPF reduction as a remaining-damage multiplier. */
export const enchantmentProtectionFactor = (
  armor: ReadonlyArray<EnchantmentSource>,
  category: EnchantmentDamageCategory,
): EnchantmentDamageMultiplier => {
  if (category === 'unprotected') return 1 as EnchantmentDamageMultiplier
  const epf = armor.reduce((total, source) => {
    const protection = enchantmentLevel(source, 'protection')
    const fire = category === 'fire' ? 2 * enchantmentLevel(source, 'fire_protection') : 0
    const blast = category === 'explosion' ? 2 * enchantmentLevel(source, 'blast_protection') : 0
    const projectile = category === 'projectile'
      ? 2 * enchantmentLevel(source, 'projectile_protection')
      : 0
    const fall = category === 'fall' ? 3 * enchantmentLevel(source, 'feather_falling') : 0
    return total + protection + fire + blast + projectile + fall
  }, 0)
  return (1 - Math.min(20, epf) / 25) as EnchantmentDamageMultiplier
}

export const armorDamageWithEnchantments = (
  damage: Damage,
  armorPoints: ArmorPoints,
  armor: ReadonlyArray<EnchantmentSource>,
): Damage => {
  const afterArmor = applyArmorPointsToDamage(damage, armorPoints as ArmorPoints)
  return {
    ...afterArmor,
    amount: nonNegative(afterArmor.amount) * enchantmentProtectionFactor(armor, damageCategory(damage)),
  }
}

export const miningSpeedWithEnchantments = (
  baseSpeed: number,
  source: EnchantmentSource,
  suitableTool = true,
): number => {
  const normalizedBase = Number.isFinite(baseSpeed) && baseSpeed > 0 ? baseSpeed : 1
  const level = suitableTool ? enchantmentLevel(source, 'efficiency') : 0
  return normalizedBase + (level === 0 ? 0 : level * level + 1)
}

export type DurabilityItemKind = 'tool' | 'armor'

const isArmorItem = (source: EnchantmentSource): boolean =>
  isEnchantedItemSource(source) && /_(helmet|chestplate|leggings|boots)$/.test(source.item)

export const durabilityWearWithEnchantments = (
  requestedWear: number,
  source: EnchantmentSource,
  rolls: ReadonlyArray<number>,
  itemKind: DurabilityItemKind = isArmorItem(source) ? 'armor' : 'tool',
): number => {
  const wear = Number.isFinite(requestedWear) ? Math.max(0, Math.floor(requestedWear)) : 0
  const level = enchantmentLevel(source, 'unbreaking')
  if (level === 0) return wear

  const preserveNumerator = itemKind === 'armor' ? 2 * level : level
  const preserveDenominator = (itemKind === 'armor' ? 5 : 1) * (level + 1)
  let applied = 0
  for (let index = 0; index < wear; index += 1) {
    const roll = rolls[index]
    if (
      roll === undefined ||
      !Number.isFinite(roll) ||
      roll < 0 ||
      roll >= 1 ||
      roll * preserveDenominator >= preserveNumerator
    ) {
      applied += 1
    }
  }
  return applied
}

export const fortuneDropCountWithEnchantments = (
  baseDrops: number,
  source: EnchantmentSource,
  roll: number,
): number => {
  const normalizedBase = Number.isFinite(baseDrops) ? Math.max(0, Math.floor(baseDrops)) : 0
  const level = enchantmentLevel(source, 'fortune')
  if (normalizedBase === 0 || level === 0 || !Number.isFinite(roll) || roll < 0 || roll >= 1) {
    return normalizedBase
  }
  const extraMultiplier = Math.max(0, Math.floor(roll * (level + 2)) - 1)
  return normalizedBase * (extraMultiplier + 1)
}

export const fireAspectDurationTicks = (source: EnchantmentSource): NonNegativeTickCountValue =>
  NonNegativeTickCount(80 * enchantmentLevel(source, 'fire_aspect'))

export const lootingLevel = (source: EnchantmentSource): EnchantmentLevelValue =>
  enchantmentLevel(source, 'looting')

export const luckOfTheSeaLevel = (source: EnchantmentSource): EnchantmentLevelValue =>
  enchantmentLevel(source, 'luck_of_the_sea')

export const silkTouchEnabled = (source: EnchantmentSource): boolean =>
  enchantmentLevel(source, 'silk_touch') > 0

export const infinityPreventsArrowConsumption = (source: EnchantmentSource): boolean =>
  enchantmentLevel(source, 'infinity') > 0

export const flameDurationTicks = (source: EnchantmentSource): NonNegativeTickCountValue =>
  NonNegativeTickCount(enchantmentLevel(source, 'flame') > 0 ? 100 : 0)

export const knockbackLevel = (source: EnchantmentSource): EnchantmentLevelValue =>
  enchantmentLevel(source, 'knockback')

export const punchKnockbackBonus = (source: EnchantmentSource): KnockbackStrength =>
  (3 * enchantmentLevel(source, 'punch')) as KnockbackStrength

export const sweepingEdgeDamageMultiplier = (source: EnchantmentSource): SweepingEdgeDamageMultiplier => {
  const level = enchantmentLevel(source, 'sweeping_edge')
  return (level === 0 ? 0 : level / (level + 1)) as SweepingEdgeDamageMultiplier
}

export const respirationAirConsumptionChance = (source: EnchantmentSource): EnchantmentChance =>
  (1 / (enchantmentLevel(source, 'respiration') + 1)) as EnchantmentChance

export const respirationBonusAirTicks = (source: EnchantmentSource): NonNegativeTickCountValue =>
  NonNegativeTickCount(300 * enchantmentLevel(source, 'respiration'))

export const aquaAffinityEnabled = (source: EnchantmentSource): boolean =>
  enchantmentLevel(source, 'aqua_affinity') > 0

export const depthStriderLevel = (source: EnchantmentSource): EnchantmentLevelValue =>
  enchantmentLevel(source, 'depth_strider')

export const soulSpeedLevel = (source: EnchantmentSource): EnchantmentLevelValue =>
  enchantmentLevel(source, 'soul_speed')

export const swiftSneakLevel = (source: EnchantmentSource): EnchantmentLevelValue =>
  enchantmentLevel(source, 'swift_sneak')

export const thornsRetaliationChance = (source: EnchantmentSource): EnchantmentChance =>
  (0.15 * enchantmentLevel(source, 'thorns')) as EnchantmentChance

export const bindingCurseBlocksRemoval = (source: EnchantmentSource): boolean =>
  enchantmentLevel(source, 'binding_curse') > 0

export const vanishingCurseRemovesOnDeath = (source: EnchantmentSource): boolean =>
  enchantmentLevel(source, 'vanishing_curse') > 0

export const lureWaitReductionTicks = (source: EnchantmentSource): NonNegativeTickCountValue =>
  NonNegativeTickCount(100 * enchantmentLevel(source, 'lure'))

export const frostWalkerFreezeRadius = (source: EnchantmentSource): FrostWalkerFreezeRadius => {
  const level = enchantmentLevel(source, 'frost_walker')
  return (level === 0 ? 0 : 2 + level) as FrostWalkerFreezeRadius
}

export const mendingDurabilityRepairPoints = (experiencePoints: MendingExperiencePoints): MendingDurabilityRepairPoints =>
  (2 * (Number.isFinite(experiencePoints) ? Math.max(0, Math.floor(experiencePoints)) : 0)) as MendingDurabilityRepairPoints

const mendingExperiencePointsResult = (value: number): Result.Result<MendingExperiencePoints, Brand.BrandError> =>
  makeMendingExperiencePoints.result(value)

export type MendingRepairSlot =
  | 'main_hand'
  | EquipmentSlot
  | `inventory:${number}`
  | `equipment:${EquipmentSlot}`

export type MendingRepairCandidate = {
  readonly slot: MendingRepairSlot
  readonly durability: Durability | null
  readonly enchantments: EnchantmentSource
}

export type MendingRepairResult = {
  readonly repairedCandidate: MendingRepairCandidate | undefined
  readonly selectedSlot: MendingRepairSlot | undefined
  readonly xpConsumed: MendingExperiencePoints
  readonly xpRemaining: MendingExperiencePoints
}

/** Choose one damaged Mending candidate; callers supply only held or equipped items. */
export const mendOneItemFromExperience = (
  candidates: ReadonlyArray<MendingRepairCandidate>,
  orbExperience: ExperienceAmount,
  roll: InterpolationFractionValue,
): Result.Result<MendingRepairResult, Brand.BrandError> => {
  const xp = Number.isFinite(orbExperience) ? Math.max(0, Math.floor(orbExperience)) : 0
  if (xp === 0 || !Number.isFinite(roll) || roll < 0 || roll >= 1) {
    return Result.gen(function* () {
      return {
        repairedCandidate: undefined,
        selectedSlot: undefined,
        xpConsumed: yield* mendingExperiencePointsResult(0),
        xpRemaining: yield* mendingExperiencePointsResult(xp),
      }
    })
  }

  const eligible = candidates.filter(({ durability, enchantments }) =>
    durability !== null &&
    Number.isSafeInteger(durability.current) &&
    Number.isSafeInteger(durability.max) &&
    durability.current >= 0 &&
    durability.max > durability.current &&
    enchantmentLevel(enchantments, 'mending') > 0,
  )
  if (eligible.length === 0) {
    return Result.gen(function* () {
      return {
        repairedCandidate: undefined,
        selectedSlot: undefined,
        xpConsumed: yield* mendingExperiencePointsResult(0),
        xpRemaining: yield* mendingExperiencePointsResult(xp),
      }
    })
  }

  const selected = eligible[Math.floor(roll * eligible.length)]!
  const selectedDurability = selected.durability!

  const missing = selectedDurability.max - selectedDurability.current
  return Result.gen(function* () {
    const experiencePoints = yield* mendingExperiencePointsResult(xp)
    const repaired = Math.min(missing, mendingDurabilityRepairPoints(experiencePoints))
    const xpConsumed = Math.ceil(repaired / 2)
    const repairedCandidate: MendingRepairCandidate = {
      ...selected,
      durability: { ...selectedDurability, current: selectedDurability.current + repaired },
    }
    return {
      repairedCandidate,
      selectedSlot: selected.slot,
      xpConsumed: yield* mendingExperiencePointsResult(xpConsumed),
      xpRemaining: yield* mendingExperiencePointsResult(xp - xpConsumed),
    }
  })
}
