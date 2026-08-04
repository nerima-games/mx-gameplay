import { isItemType, type ItemType } from '@nerima-games/mc-kernel'

export type VillagerProfession = 'farmer' | 'toolsmith'

export type VillagerTradeOffer = {
  readonly id: string
  readonly input: { readonly item: ItemType; readonly count: number }
  readonly output: { readonly item: ItemType; readonly count: number }
  readonly uses: number
  readonly maxUses: number
}

export type Villager = {
  readonly id: string
  readonly profession: VillagerProfession
  readonly offers: ReadonlyArray<VillagerTradeOffer>
}

export type VillagerTradeState = {
  readonly villagers: ReadonlyArray<Villager>
  readonly restockElapsedSecs: number
}

export const VILLAGER_RESTOCK_INTERVAL_SECS = 300

const OFFER_TABLE: Record<VillagerProfession, ReadonlyArray<Omit<VillagerTradeOffer, 'id' | 'uses'>>> = {
  farmer: [
    { input: { item: 'wheat', count: 20 }, output: { item: 'emerald', count: 1 }, maxUses: 16 },
    { input: { item: 'potato', count: 26 }, output: { item: 'emerald', count: 1 }, maxUses: 16 },
  ],
  toolsmith: [
    { input: { item: 'coal', count: 15 }, output: { item: 'emerald', count: 1 }, maxUses: 12 },
    { input: { item: 'emerald', count: 4 }, output: { item: 'iron_pickaxe', count: 1 }, maxUses: 12 },
  ],
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isVillagerProfession = (value: unknown): value is VillagerProfession =>
  value === 'farmer' || value === 'toolsmith'

const isPositiveCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const isTradeStack = (
  value: unknown,
): value is { readonly item: ItemType; readonly count: number } =>
  isRecord(value) &&
  typeof value['item'] === 'string' &&
  isItemType(value['item']) &&
  isPositiveCount(value['count'])

const isVillagerTradeOffer = (value: unknown): value is VillagerTradeOffer =>
  isRecord(value) &&
  typeof value['id'] === 'string' &&
  isTradeStack(value['input']) &&
  isTradeStack(value['output']) &&
  isPositiveCount(value['maxUses']) &&
  typeof value['uses'] === 'number' &&
  Number.isSafeInteger(value['uses']) &&
  value['uses'] >= 0 &&
  value['uses'] <= value['maxUses']

export const isValidVillagerTradeState = (
  value: unknown,
): value is VillagerTradeState => {
  if (
    !isRecord(value) ||
    typeof value['restockElapsedSecs'] !== 'number' ||
    !Number.isFinite(value['restockElapsedSecs']) ||
    value['restockElapsedSecs'] < 0 ||
    value['restockElapsedSecs'] >= VILLAGER_RESTOCK_INTERVAL_SECS ||
    !Array.isArray(value['villagers'])
  ) {
    return false
  }

  const villagerIds = new Set<string>()
  return value['villagers'].every((villager) => {
    if (
      !isRecord(villager) ||
      typeof villager['id'] !== 'string' ||
      villagerIds.has(villager['id']) ||
      !isVillagerProfession(villager['profession']) ||
      !Array.isArray(villager['offers'])
    ) {
      return false
    }

    const offerIds = new Set<string>()
    for (const offer of villager['offers']) {
      if (!isVillagerTradeOffer(offer) || offerIds.has(offer.id)) return false
      offerIds.add(offer.id)
    }

    villagerIds.add(villager['id'])
    return true
  })
}

const hash = (value: string): number => {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619)
  }
  return result >>> 0
}

export const makeVillager = (id: string, profession: VillagerProfession): Villager => {
  const templates = OFFER_TABLE[profession]
  const offset = hash(id) % templates.length
  return {
    id,
    profession,
    offers: templates.map((_, index) => {
      const template = templates[(index + offset) % templates.length]!
      return { ...template, id: `${id}:${index}`, uses: 0 }
    }),
  }
}

export const emptyVillagerTradeState = (): VillagerTradeState => ({
  villagers: [],
  restockElapsedSecs: 0,
})

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0

const isVillagerProfession = (value: unknown): value is VillagerProfession =>
  value === 'farmer' || value === 'toolsmith'

const isValidTradeStack = (value: unknown): value is VillagerTradeOffer['input'] =>
  isRecord(value)
  && typeof value['item'] === 'string'
  && isItemType(value['item'])
  && isPositiveInteger(value['count'])

const isValidVillagerTradeOffer = (value: unknown): value is VillagerTradeOffer => {
  if (!isRecord(value)) return false
  const id = value['id']
  const uses = value['uses']
  const maxUses = value['maxUses']
  return typeof id === 'string'
    && id.length > 0
    && isValidTradeStack(value['input'])
    && isValidTradeStack(value['output'])
    && typeof uses === 'number'
    && Number.isFinite(uses)
    && Number.isInteger(uses)
    && uses >= 0
    && isPositiveInteger(maxUses)
    && uses <= maxUses
}

/** Validates an untrusted saved villager-trading snapshot before restoring gameplay state. */
export const isValidVillagerTradeState = (value: unknown): value is VillagerTradeState => {
  const villagers = isRecord(value) ? value['villagers'] : undefined
  const restockElapsedSecs = isRecord(value) ? value['restockElapsedSecs'] : undefined
  if (!Array.isArray(villagers)) return false
  if (typeof restockElapsedSecs !== 'number' || !Number.isFinite(restockElapsedSecs)) return false
  if (restockElapsedSecs < 0 || restockElapsedSecs >= VILLAGER_RESTOCK_INTERVAL_SECS) return false
  const villagerIds = new Set<string>()
  return villagers.every((villager) => {
    if (!isRecord(villager)) return false
    const id = villager['id']
    const offers = villager['offers']
    if (typeof id !== 'string' || id.length === 0) return false
    if (!isVillagerProfession(villager['profession']) || !Array.isArray(offers)) return false
    if (villagerIds.has(id)) return false
    const offerIds = new Set<string>()
    const validOffers = offers.every((offer) => {
      if (!isValidVillagerTradeOffer(offer) || offerIds.has(offer.id)) return false
      offerIds.add(offer.id)
      return true
    })
    if (!validOffers) return false
    villagerIds.add(id)
    return true
  })
}

export const addVillager = (state: VillagerTradeState, villager: Villager): VillagerTradeState => ({
  ...state,
  villagers: [...state.villagers.filter((current) => current.id !== villager.id), villager],
})

export const useVillagerOffer = (
  state: VillagerTradeState,
  villagerId: string,
  offerId: string,
): VillagerTradeState | undefined => {
  const villager = state.villagers.find((candidate) => candidate.id === villagerId)
  const offer = villager?.offers.find((candidate) => candidate.id === offerId)
  if (villager === undefined || offer === undefined || offer.uses >= offer.maxUses) return undefined
  return {
    ...state,
    villagers: state.villagers.map((candidate) =>
      candidate.id !== villagerId
        ? candidate
        : {
            ...candidate,
            offers: candidate.offers.map((candidateOffer) =>
              candidateOffer.id === offerId
                ? { ...candidateOffer, uses: candidateOffer.uses + 1 }
                : candidateOffer,
            ),
          },
    ),
  }
}

export const advanceVillagerRestock = (
  state: VillagerTradeState,
  deltaTimeSecs: number,
): VillagerTradeState => {
  const elapsed = state.restockElapsedSecs + Math.max(0, deltaTimeSecs)
  if (elapsed < VILLAGER_RESTOCK_INTERVAL_SECS) return { ...state, restockElapsedSecs: elapsed }
  return {
    villagers: state.villagers.map((villager) => ({
      ...villager,
      offers: villager.offers.map((offer) => ({ ...offer, uses: 0 })),
    })),
    restockElapsedSecs: elapsed % VILLAGER_RESTOCK_INTERVAL_SECS,
  }
}

export const copyVillagerTradeState = (state: VillagerTradeState): VillagerTradeState => ({
  restockElapsedSecs: state.restockElapsedSecs,
  villagers: state.villagers.map((villager) => ({
    ...villager,
    offers: villager.offers.map((offer) => ({
      ...offer,
      input: { ...offer.input },
      output: { ...offer.output },
    })),
  })),
})
