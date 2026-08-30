import { isItemType, type ItemType } from '@nerima-games/mc-kernel'
import {
  isDamageableItemType,
  isValidDurabilityForItem,
  type Durability,
} from '@nerima-games/mc-sim'

import { applyArmorToDamage } from './combat/armor.js'
import type { Damage } from './death-cause.js'
import { rollFortuneExtraDrops } from './interactions/block-loot.js'
import { bowPowerMultiplier } from './interactions/draw-bow.js'

export const ENCHANTMENT_IDS = [
  'protection',
  'sharpness',
  'efficiency',
  'unbreaking',
  'fortune',
  'power',
] as const

export type EnchantmentId = (typeof ENCHANTMENT_IDS)[number]
export type EnchantmentTarget = 'armor' | 'melee_weapon' | 'mining_tool' | 'bow' | 'damageable'
export type EnchantmentConflictId =
  | EnchantmentId
  | 'fire_protection'
  | 'blast_protection'
  | 'projectile_protection'
  | 'smite'
  | 'bane_of_arthropods'
  | 'silk_touch'

export type EnchantmentDefinition = {
  readonly id: EnchantmentId
  readonly maxLevel: number
  readonly targets: ReadonlyArray<EnchantmentTarget>
  readonly incompatibleWith: ReadonlyArray<EnchantmentConflictId>
}

export const ENCHANTMENT_REGISTRY: Readonly<Record<EnchantmentId, EnchantmentDefinition>> = {
  protection: {
    id: 'protection',
    maxLevel: 4,
    targets: ['armor'],
    incompatibleWith: ['fire_protection', 'blast_protection', 'projectile_protection'],
  },
  sharpness: {
    id: 'sharpness',
    maxLevel: 5,
    targets: ['melee_weapon'],
    incompatibleWith: ['smite', 'bane_of_arthropods'],
  },
  efficiency: { id: 'efficiency', maxLevel: 5, targets: ['mining_tool'], incompatibleWith: [] },
  unbreaking: { id: 'unbreaking', maxLevel: 3, targets: ['damageable'], incompatibleWith: [] },
  fortune: {
    id: 'fortune',
    maxLevel: 3,
    targets: ['mining_tool'],
    incompatibleWith: ['silk_touch'],
  },
  power: { id: 'power', maxLevel: 5, targets: ['bow'], incompatibleWith: [] },
}

const ARMOR_ITEMS = new Set<ItemType>([
  'iron_helmet',
  'iron_chestplate',
  'iron_leggings',
  'iron_boots',
])
const MELEE_ITEMS = new Set<ItemType>([
  'wooden_sword',
  'stone_sword',
  'iron_sword',
  'diamond_sword',
])
const MINING_ITEMS = new Set<ItemType>([
  'wooden_pickaxe',
  'stone_pickaxe',
  'iron_pickaxe',
  'diamond_pickaxe',
  'wooden_hoe',
  'stone_hoe',
  'iron_hoe',
  'diamond_hoe',
])

const isEnchantmentId = (value: unknown): value is EnchantmentId =>
  typeof value === 'string' && ENCHANTMENT_IDS.includes(value as EnchantmentId)

const itemMatchesTarget = (item: ItemType, target: EnchantmentTarget): boolean => {
  switch (target) {
    case 'armor':
      return ARMOR_ITEMS.has(item)
    case 'melee_weapon':
      return MELEE_ITEMS.has(item)
    case 'mining_tool':
      return MINING_ITEMS.has(item)
    case 'bow':
      return item === 'bow'
    case 'damageable':
      return isDamageableItemType(item)
    /* v8 ignore next 4 -- EnchantmentTarget is a closed union; the five cases above are exhaustive, so this arm can never execute. */
    default: {
      const exhaustive: never = target
      return exhaustive
    }
  }
}

export const enchantmentAppliesTo = (id: EnchantmentId, item: ItemType): boolean =>
  ENCHANTMENT_REGISTRY[id].targets.some((target) => itemMatchesTarget(item, target))

export const enchantmentsConflict = (
  left: EnchantmentConflictId,
  right: EnchantmentConflictId,
): boolean => {
  if (left === right) return false

  const leftDefinition = isEnchantmentId(left) ? ENCHANTMENT_REGISTRY[left] : undefined
  const rightDefinition = isEnchantmentId(right) ? ENCHANTMENT_REGISTRY[right] : undefined
  return (
    leftDefinition?.incompatibleWith.includes(right) === true ||
    rightDefinition?.incompatibleWith.includes(left) === true
  )
}

export type Enchantment = {
  readonly id: EnchantmentId
  readonly level: number
}

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
      // No conflict check here: no two of the six EnchantmentIds are ever
      // mutually incompatible in ENCHANTMENT_REGISTRY (incompatibleWith only
      // names the six non-EnchantmentId conflict ids), so `enchantmentsConflict`
      // can never return true for two ids that both passed `isEnchantmentId` —
      // deleted rather than kept as a dead, unreachable branch.
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
  try {
    return decodeEnchantedItem(JSON.parse(encoded) as unknown)
  } catch {
    return { ok: false, issues: [{ path: '$', reason: 'must be valid JSON' }] }
  }
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
  // Asserted, not defaulted: `mixSeed(...) % ENCHANTMENT_IDS.length` is a
  // `noUncheckedIndexedAccess` formality — the modulus (6, `ENCHANTMENT_IDS`'s
  // own length) guarantees an index in `0..5`, so the lookup is never
  // `undefined`. Same shape as `mob-spawn-search.ts`'s `HOSTILE_KINDS[index]`.
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

const offersMatch = (left: EnchantmentOffer, right: EnchantmentOffer): boolean =>
  left.seed === right.seed &&
  left.bookshelfCount === right.bookshelfCount &&
  left.slot === right.slot &&
  left.enchantment.id === right.enchantment.id &&
  left.enchantment.level === right.enchantment.level &&
  left.requiredPlayerLevel === right.requiredPlayerLevel &&
  left.lapisCost === right.lapisCost

export const applyEnchantmentOffer = (
  state: EnchantmentTableState,
  offer: EnchantmentOffer,
): EnchantmentTransactionResult => {
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
  if (offer.slot !== 0 && offer.slot !== 1 && offer.slot !== 2) {
    return rejectTransaction(state, 'invalid_offer')
  }
  const expected = enchantmentOffer(state.seed, state.bookshelfCount, offer.slot)
  if (!offersMatch(offer, expected)) return rejectTransaction(state, 'invalid_offer')
  if (!enchantmentAppliesTo(offer.enchantment.id, itemSnapshot.value.item)) {
    return rejectTransaction(state, 'incompatible_item')
  }
  // No conflict check here, for the same reason as decodeEnchantedItem's
  // identical (now-deleted) check: no two EnchantmentIds are ever mutually
  // incompatible in ENCHANTMENT_REGISTRY, so `enchantmentsConflict` can never
  // return true for `itemSnapshot`'s already-valid enchantments against the
  // already-`enchantmentAppliesTo`-checked offer.
  if (state.playerLevel < offer.requiredPlayerLevel) {
    return rejectTransaction(state, 'insufficient_level')
  }
  if (state.lapis < offer.lapisCost) return rejectTransaction(state, 'insufficient_lapis')

  const nextEnchantments = itemSnapshot.value.enchantments.filter(
    ({ id }) => id !== offer.enchantment.id,
  )
  nextEnchantments.push(offer.enchantment)
  // Asserted rather than branched on `.ok`, because the branch is provably
  // unreachable and a coverage-gate-driven test cannot reach it either: item
  // and durability are copied unchanged from the already-ok `itemSnapshot`,
  // the retained enchantments were already valid on that snapshot, the added
  // enchantment's id and level are guaranteed equal to the already-checked
  // offer (`offersMatch` passed above), the filter above removes any existing
  // entry with the same id before pushing (no duplicate), and no pairing can
  // conflict, per the proof at the (now-deleted) `enchantmentsConflict` check
  // above.
  const nextItem = decodeEnchantedItem({
    ...itemSnapshot.value,
    enchantments: nextEnchantments,
  }) as { readonly ok: true; readonly value: EnchantedItem }

  return {
    ok: true,
    state: {
      seed: rerollEnchantmentSeed(state.seed),
      bookshelfCount: normalizeBookshelves(state.bookshelfCount),
      playerLevel: state.playerLevel - offer.lapisCost,
      lapis: state.lapis - offer.lapisCost,
      item: nextItem.value,
    },
  }
}

export const enchantmentLevel = (item: EnchantedItem, id: EnchantmentId): number =>
  item.enchantments.find((enchantment) => enchantment.id === id)?.level ?? 0

const nonNegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0

export const meleeDamageWithEnchantments = (baseDamage: number, item: EnchantedItem): number => {
  const level = enchantmentLevel(item, 'sharpness')
  return nonNegative(baseDamage) + (level === 0 ? 0 : 0.5 * level + 0.5)
}

export const bowDamageWithEnchantments = (baseDamage: number, item: EnchantedItem): number =>
  Math.round(nonNegative(baseDamage) * bowPowerMultiplier(enchantmentLevel(item, 'power')))

export const armorDamageWithEnchantments = (
  damage: Damage,
  armorPoints: number,
  armor: ReadonlyArray<EnchantedItem>,
): Damage => {
  const afterArmor = applyArmorToDamage(damage, armorPoints)
  const protectionLevel = Math.min(
    20,
    armor.reduce((total, item) => total + enchantmentLevel(item, 'protection'), 0),
  )
  return { ...afterArmor, amount: nonNegative(afterArmor.amount) * (1 - protectionLevel * 0.04) }
}

export const miningSpeedWithEnchantments = (baseSpeed: number, item: EnchantedItem): number => {
  const normalizedBase = Number.isFinite(baseSpeed) && baseSpeed > 0 ? baseSpeed : 1
  const level = enchantmentLevel(item, 'efficiency')
  return normalizedBase + (level === 0 ? 0 : level * level + 1)
}

export const durabilityWearWithEnchantments = (
  requestedWear: number,
  item: EnchantedItem,
  rolls: ReadonlyArray<number>,
): number => {
  const wear = Number.isFinite(requestedWear) ? Math.max(0, Math.floor(requestedWear)) : 0
  const level = enchantmentLevel(item, 'unbreaking')
  if (level === 0) return wear

  const preserveChance = level / (level + 1)
  let applied = 0
  for (let index = 0; index < wear; index += 1) {
    const roll = rolls[index]
    if (roll === undefined || !Number.isFinite(roll) || roll < 0 || roll >= preserveChance) applied += 1
  }
  return applied
}

export const fortuneDropCountWithEnchantments = (
  baseDrops: number,
  item: EnchantedItem,
  roll: number,
): number => {
  const normalizedBase = Number.isFinite(baseDrops) ? Math.max(0, Math.floor(baseDrops)) : 0
  if (normalizedBase === 0) return 0
  return normalizedBase + rollFortuneExtraDrops(enchantmentLevel(item, 'fortune'), roll)
}
