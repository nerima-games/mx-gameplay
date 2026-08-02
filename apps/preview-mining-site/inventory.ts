/** A preview adapter over mx-gameplay's canonical recipe-enabled inventory. */
import type { InventoryServiceApi } from '@nerima-games/mc-sim'
import { Effect, Ref } from 'effect'
import { makeInMemoryInventory } from '../../src/domain/in-memory-inventory'

export { INVENTORY_SLOT_COUNT } from '../../src/domain/in-memory-inventory'

type ItemType = Parameters<InventoryServiceApi['add']>[0]

export type InventoryDeposit = {
  readonly item: ItemType
  readonly count: number
}

export type PreviewInventory = {
  /** Handed to `gameplayStages`, which takes the API rather than the tag. */
  readonly api: InventoryServiceApi
  /** Held totals projected from the canonical inventory snapshot for the HUD. */
  readonly held: Effect.Effect<ReadonlyMap<string, number>>
  /** The `add` calls made since the last drain. */
  readonly takeDepositLog: Effect.Effect<ReadonlyArray<InventoryDeposit>>
}

export const makePreviewInventory = (): Effect.Effect<PreviewInventory> =>
  Effect.gen(function* () {
    const inventory = yield* makeInMemoryInventory()
    const deposits = yield* Ref.make<ReadonlyArray<InventoryDeposit>>([])
    const depositMutex = yield* Effect.makeSemaphore(1)

    const api: InventoryServiceApi = {
      ...inventory,
      add: (item, count) =>
        depositMutex.withPermits(1)(
          Effect.gen(function* () {
            const result = yield* inventory.add(item, count)
            yield* Ref.update(deposits, (current) => [...current, { item, count }])
            return result
          }),
        ),
    }

    return {
      api,
      held: Effect.map(inventory.snapshot, (snapshot) => {
        const totals = new Map<string, number>()
        for (const slot of snapshot.slots) {
          if (slot !== undefined) {
            totals.set(slot.item, (totals.get(slot.item) ?? 0) + slot.count)
          }
        }
        return totals
      }),
      takeDepositLog: depositMutex.withPermits(1)(Ref.getAndSet(deposits, [])),
    }
  })
