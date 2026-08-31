/**
 * ONE RULE, ONE FILE (DN-GP-9): does the currently selected hotbar slot hold
 * something placeable, and if so, what?
 *
 * Lowered from the composing app's `player-experience.ts` — the one export of
 * that file that is this repository's: `../../stages/registration.ts`'s
 * `HOTBAR_ACTIONS`/`selectedHotbarAfterInput` neighbours in the same source
 * file are mc-sim's (appendix L: "interaction-hotbar-handler,
 * selected-hotbar-slot | mc-sim"), since deciding WHICH slot is selected is
 * inventory state, not a gameplay rule. This file only answers the next
 * question, once a slot is already selected: is what is in it something
 * `./place-block.ts` could ever act on.
 *
 * GENERIC OVER THE ITEM TYPE AND THE PLACEABILITY GUARD, deliberately: the
 * composing app calls this with `mc-kernel`'s `isPlaceableItem`, but nothing
 * here needs that specific guard by name, and hard-coding it would make this
 * file the one interaction rule in the directory that cannot be tested
 * without also standing up the block vocabulary.
 */
export type HotbarSlot<Item> =
  | {
      readonly item: Item
      readonly count: number
    }
  | undefined

/**
 * TOTAL: an out-of-range index, an empty slot, a zero-or-negative count, or
 * an item the guard rejects are all "nothing to place" rather than a thrown
 * error — the caller is a per-frame poll of whatever the player is currently
 * holding, and every one of those is an ordinary frame, not an exceptional
 * one.
 *
 * `requestPlacement` IS NOT CALLED except on the one path where the slot,
 * count, and guard all agree there is something to place — the caller may
 * safely treat a call to it as itself the sole trigger of an actual placement
 * attempt.
 */
export const requestPlacementFromSelectedSlot = <Item, PlaceableItem extends Item>(
  slots: ReadonlyArray<HotbarSlot<Item>>,
  selectedHotbarIndex: number,
  isPlaceable: (item: Item) => item is PlaceableItem,
  requestPlacement: (item: PlaceableItem) => void,
): boolean => {
  const selected = slots[selectedHotbarIndex]
  if (selected === undefined || selected.count <= 0 || !isPlaceable(selected.item)) {
    return false
  }

  requestPlacement(selected.item)
  return true
}
