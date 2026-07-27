/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-sim`'s `InventoryService`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * mc-sim is a legitimate `dependencies` edge for this repository (plan.md §2.1:
 * `gameplay --> sim`), so — exactly like `./entity-manager-port` — this mirror
 * is not standing in for a forbidden import, only for an unpublished one.
 * plan.md §6 Step 3 publishes bottom-up and nothing is on GitHub Packages yet,
 * so `pnpm check:deps` would reject an import of a package absent from
 * `package.json#dependencies`.
 *
 * WHEN mc-sim IS PUBLISHED:
 *   1. add `@nerima-games/mc-sim` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './inventory-port'` at `'@nerima-games/mc-sim'`.
 *
 * It is NOT re-exported from `index.ts`, for the reason `./entity-manager-port`
 * and `./chunk-store-port` are not: re-exporting another repository's service
 * would make deleting the stand-in a breaking change for consumers of
 * mx-gameplay. `InventoryService` and `InventoryServiceApi` are nonetheless
 * VISIBLE to a consumer, because they appear in the type of
 * `makeGameplayStages`, so they show up in the "Supporting declarations"
 * section of `api-lock.md` precisely as `ChunkStore` and `EntityManagerApi` do.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE MINING SEAM, AND IT WAS DECLARED UNWIRABLE ON TWO GROUNDS
 * ---------------------------------------------------------------------------
 *
 * 「Mining a block puts an item in your inventory」 is plan.md §2.3-1's worked
 * example and was the join mc-compose could not write. Two reasons were given
 * and BOTH are dead:
 *
 *   - A TYPE MISMATCH. `BreakOutcome.yielded` is a chunk buffer BYTE and
 *     mc-sim's `add` took an `ItemId = string`, so the two ends met at a type
 *     that could not be wrong and therefore could not be right. Kernel published
 *     `ItemType`, mc-sim deleted `ItemId` outright rather than retargeting it,
 *     and `./interactions/block-loot.ts` was written against kernel's table —
 *     so the byte becomes a `MinedItem { item: ItemType; count: number }` before
 *     it gets here, and mc-sim's `add(item: ItemType, count: number)` takes
 *     exactly that. No adapter and no cast. mc-sim's own comment on `add` says
 *     the same thing from the other side.
 *
 *   - NO DEPOSIT CALL SITE. True, and self-inflicted: the stage appended to a
 *     `Ref` because there was no service to call. There is one now, and it is
 *     below.
 *
 * ---------------------------------------------------------------------------
 * Why the WHOLE api is mirrored when TWO members are all that is used
 * ---------------------------------------------------------------------------
 *
 * `./chunk-store-port`'s header states the rule and the reason: Effect resolves
 * Tags by their TEXTUAL KEY, so a `Layer` built against a narrow mirror
 * satisfies the wide Tag and every omitted method reads `undefined` in a
 * repository that never saw this file. A narrower mirror is not "less of the
 * vocabulary", it is a silent runtime hazard. `stages/registration.ts` calls
 * `add` and `remove`; all nine members are here, and
 * `test/inventory-mirror.test.ts` pins the shape in both directions and the key
 * literally.
 *
 * THAT RULE HAS A PRICE AND THIS FILE IS IT. `stages/registration.ts` used to
 * decline to mirror this service in as many words —
 *
 *     `InventoryServiceApi` names `Inventory`, `RecipeTable`, `CraftGrid`,
 *     `RecipeMatch` and `CraftResult`, so mirroring it honestly means restating
 *     mc-sim's crafting vocabulary in a repository that has no crafting rule to
 *     justify it. The roster was worth that price because the stage cannot
 *     iterate mobs without it; the outbox works today.
 *
 * — and `apps/preview-mining-site/screens.ts` recorded it as a known gap. The
 * arithmetic changed rather than the argument: the outbox did NOT work, it only
 * postponed. Every item a player mined sat in a list that nothing on the far
 * side of this repository had been written to drain, and a list a host must
 * remember to drain is an inventory that silently empties. So the crafting
 * vocabulary is transcribed below, in full, and it is DEAD WEIGHT ON PURPOSE:
 * nothing in this repository reads `Recipe`, `CraftGrid` or `CraftResult`, and
 * nothing is meant to. They are here so that `InventoryServiceApi` can be
 * complete, and they are deleted with this file.
 *
 * ---------------------------------------------------------------------------
 * `add` RESOLVES TO THE LEFTOVER, WHICH IS NOT A SUCCESS FLAG
 * ---------------------------------------------------------------------------
 *
 * The single most misreadable thing on this interface, so it is stated three
 * times: at the member, in `stages/registration.ts`, and here. `add` answers
 * with the number that did NOT fit. `0` means everything landed. mc-sim's own
 * comment names this repository as the caller and says what it is for —
 * 「The caller in mx-gameplay turns it into a dropped-item entity」 — and a
 * leftover that is discarded rather than accounted for is an item the player
 * watched disappear. `stages/registration.ts` records what happens to it today
 * and why it is not yet an entity.
 *
 * `remove` is the mirror image and is not the same shape: it answers with the
 * number ACTUALLY TAKEN, so `0` there is total failure and the full count is
 * total success. Two methods on one interface whose numbers point in opposite
 * directions is exactly the sort of thing a narrow mirror gets away with, and
 * `test/inventory-mirror.test.ts` pins both directions against a double.
 *
 * `restore` RETURNS A NUMBER TOO AND IT IS THE LEFTOVER, not a repair count.
 * That is worth naming because the sibling mirror sets the opposite
 * expectation: `EntityManagerApi.restore` answers with a `RosterRepair` — what
 * had to be FIXED — while this one answers in `add`'s currency, what had no
 * room. mc-sim's note goes further: `normaliseInventory` also DISCARDS slots
 * whose item is not in kernel's roster and reports that separately, and the
 * discard count is deliberately NOT folded into this number, because a leftover
 * can become an entity on the ground and a discard cannot. Nothing in this
 * repository calls `restore` — the world-load path is the host's — but a rule
 * author who assumed the two `restore`s meant the same thing would be wrong in
 * the direction that deletes items.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS RENAMED, and one symbol is imported rather than declared
 * ---------------------------------------------------------------------------
 *
 * A mirror that renames a symbol typechecks, passes every local test, and
 * yields a name that does not exist on repoint day. Every type below carries
 * mc-sim's spelling; none of them collided with a local one, so the rule that a
 * collision moves the LOCAL name was not needed here.
 *
 * `ItemType` comes from `./item-vocabulary` and `StackCount` from
 * `./frame-contract`, rather than being declared here, and the test is the one
 * `./chunk-store-port` records: WHOSE BARREL REPLACES THE SYMBOL. mc-sim's
 * barrel deliberately does not re-export its own `domain/kernel-vocabulary.ts`
 * — a consumer must take the vocabulary from kernel, or the mirror becomes a
 * second source of truth — so neither name comes back from
 * `@nerima-games/mc-sim` on the day this file dies. Both come back from
 * `@nerima-games/mc-kernel`, and both live in the mirrors kernel's barrel
 * replaces. Declaring them here would be the defect `./chunk-store-port`'s
 * header records: four symbols sitting in a mirror whose source did not have
 * them, under a header promising a repoint that would have deleted them.
 *
 * ---------------------------------------------------------------------------
 * What is NOT mirrored, and why that is not a narrowing
 * ---------------------------------------------------------------------------
 *
 * `mc-sim/domain/inventory.ts`, `domain/recipe.ts` and `domain/crafting.ts`
 * also export the PURE functions over these values — `emptyInventory`,
 * `itemStack`, `slotAt`, `countOf`, `isEmpty`, `addItem`, `removeItem`,
 * `normaliseInventory`, `craftGrid`, `cellAt`, `exactly`, `shapedRecipe`,
 * `shapelessRecipe`, `matchRecipe`, `conflictsIn`, `craftFromGrid`,
 * `STARTER_RECIPES`, `INVENTORY_SLOT_COUNT` — and none of them is here. This is
 * `./entity-manager-port`'s argument unchanged: they carry no Tag, so they
 * carry none of the hazard above. A function absent from a mirror is a compile
 * error at its call site, never an `undefined` at run time. This repository
 * calls the SERVICE, and the service is complete.
 *
 * `AddOutcome`, `RemoveOutcome`, `NormaliseOutcome` and `CraftOutcome` are
 * absent for the same reason with one extra step: they are the return types of
 * those pure functions and appear nowhere in `InventoryServiceApi`, because the
 * service unwraps each one into the number or result the caller wanted. A
 * mirror of them would be vocabulary with no signature to sit in.
 */
import { Context, type Effect } from 'effect'
import type { StackCount } from './frame-contract'
import type { ItemType } from './item-vocabulary'

// ---------------------------------------------------------------------------
// Stacks and slots — mirrors mc-sim/domain/inventory.ts
// ---------------------------------------------------------------------------

/** An item and how many of it. */
export type ItemStack = {
  readonly item: ItemType
  readonly count: StackCount
}

/** A slot is either empty (`undefined`) or holds a stack. */
export type Slot = ItemStack | undefined

/**
 * The whole inventory, as one value. This is what a save file holds.
 *
 * mc-sim's invariant, which this repository must not assume it can restore: a
 * normalised inventory has exactly `INVENTORY_SLOT_COUNT` slots and no stack
 * outside [0, `MAX_STACK_COUNT`]. `restore` is what re-establishes it, and the
 * defect that made it necessary is recorded there — a two-slot save turned a
 * 36-slot player into a two-slot one and the next 872 mined blocks went on the
 * floor with no symptom but a full inventory.
 */
export type Inventory = {
  readonly slots: ReadonlyArray<Slot>
}

// ---------------------------------------------------------------------------
// Recipes — mirrors mc-sim/domain/recipe.ts
//
// DEAD WEIGHT ON PURPOSE. No rule in this repository reads any of it; see the
// header on why a partial mirror of a Tag's api is worse than a complete one.
// The comments are mc-sim's, shortened where they argue decisions that were
// made in that repository and cannot be revisited here.
// ---------------------------------------------------------------------------

/** A recipe's identity. Namespaced `mc-sim:`, and load-bearing: it is the ambiguity tie-break. */
export type RecipeId = string

/** What a single grid cell must contain. */
export type Ingredient = { readonly _tag: 'Exact'; readonly item: ItemType }

/** An empty cell inside a shaped pattern — a hole the player must leave empty. */
export type PatternCell = Ingredient | undefined

/** A shaped recipe's pattern, row-major, with the empty border already trimmed. */
export type RecipePattern = {
  readonly width: number
  readonly height: number
  readonly cells: ReadonlyArray<PatternCell>
}

export type ShapedRecipe = {
  readonly _tag: 'Shaped'
  readonly id: RecipeId
  readonly pattern: RecipePattern
  readonly output: ItemStack
}

export type ShapelessRecipe = {
  readonly _tag: 'Shapeless'
  readonly id: RecipeId
  readonly ingredients: ReadonlyArray<Ingredient>
  readonly output: ItemStack
}

export type Recipe = ShapedRecipe | ShapelessRecipe

/** A recipe registry. An array, not a Map: matching is a scan by shape, never a lookup by id. */
export type RecipeTable = ReadonlyArray<Recipe>

/**
 * A crafting grid as laid out by the player, row-major.
 *
 * Cells are `Slot` and not `ItemType`, because that is what a grid holds: the
 * player drops a stack of 12 planks into a cell and one is spent.
 */
export type CraftGrid = {
  readonly width: number
  readonly height: number
  readonly cells: ReadonlyArray<Slot>
}

export type RecipeMatch =
  | { readonly _tag: 'Match'; readonly recipe: Recipe; readonly output: ItemStack }
  | { readonly _tag: 'NoMatch' }

// ---------------------------------------------------------------------------
// Crafting — mirrors mc-sim/domain/crafting.ts
// ---------------------------------------------------------------------------

export type MissingIngredient = {
  readonly item: ItemType
  /** How many more are needed than the inventory holds. Always positive. */
  readonly short: number
}

/**
 * Why a craft did or did not happen.
 *
 * The three failures are distinct on purpose: `NoMatch` is "this layout makes
 * nothing" and belongs to the recipe table, while the other two are "it makes
 * something and you cannot have it", which a screen must say differently.
 */
export type CraftResult =
  | { readonly _tag: 'Crafted'; readonly recipeId: RecipeId; readonly output: ItemStack }
  | { readonly _tag: 'NoMatch' }
  | { readonly _tag: 'MissingIngredients'; readonly missing: ReadonlyArray<MissingIngredient> }
  | { readonly _tag: 'NoRoom' }

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export type InventoryServiceApi = {
  /**
   * Insert items. Resolves to the number that did NOT fit.
   *
   * NOT A SUCCESS FLAG. `0` means everything landed; anything else is items
   * the player earned and does not have. See the module header, and
   * `stages/registration.ts` for what this repository does with it.
   */
  readonly add: (item: ItemType, count: number) => Effect.Effect<number>
  /** Take items. Resolves to the number ACTUALLY TAKEN — the opposite polarity to `add`. */
  readonly remove: (item: ItemType, count: number) => Effect.Effect<number>
  readonly countOf: (item: ItemType) => Effect.Effect<number>
  readonly snapshot: Effect.Effect<Inventory>
  /**
   * Install a saved inventory. THE WORLD-LOAD PATH, and the host's, not this
   * repository's.
   *
   * Resolves to the LEFTOVER, in `add`'s currency — not to a repair count, and
   * NOT to the number of slots discarded for holding an item this build cannot
   * name. See the module header on why the sibling mirror's `restore` sets the
   * opposite expectation.
   */
  readonly restore: (inventory: Inventory) => Effect.Effect<number>
  /** Empty the inventory. A NEW world, not a reloaded one. */
  readonly reset: Effect.Effect<void>
  readonly recipes: Effect.Effect<RecipeTable>
  readonly previewCraft: (grid: CraftGrid) => Effect.Effect<RecipeMatch>
  readonly craft: (grid: CraftGrid) => Effect.Effect<CraftResult>
}

/**
 * The tag key is `'@nerima-games/mc-sim/InventoryService'` — mc-sim's, not this
 * repository's, because it denotes mc-sim's service. Changing this string
 * breaks resolution silently at runtime while typechecking cleanly, so
 * `test/inventory-mirror.test.ts` asserts it literally.
 *
 * A `Context.Tag` CLASS, like `./chunk-store-port`'s `ChunkStore` and unlike
 * `./entity-manager-port`'s `EntityManager`: the service value type carries no
 * parameter, so mc-sim declares it as a class and so does this. That brings the
 * nominal hazard back — mc-sim's copy and this one are two nominal types
 * denoting one service, and the shape can drift where TypeScript cannot see it,
 * which is what the two-direction assignment in the test is for.
 */
export class InventoryService extends Context.Tag('@nerima-games/mc-sim/InventoryService')<
  InventoryService,
  InventoryServiceApi
>() {}
