import type { ItemType } from '@nerima-games/mc-kernel'

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
