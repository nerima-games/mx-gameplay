/**
 * The `InventoryService` mirror is pinned against mc-sim's real interface.
 *
 * ---------------------------------------------------------------------------
 * What this file is defending against
 * ---------------------------------------------------------------------------
 *
 * `domain/inventory-port.ts` is a temporary local copy of a service that lives
 * in another repository, and its header promises that deleting it and
 * repointing every import at `@nerima-games/mc-sim` will typecheck. Nothing but
 * a test can enforce that promise, and — as with `test/chunk-store-mirror.test.ts`
 * and `test/entity-manager-mirror.test.ts` — the failure mode if it goes
 * unenforced is not a compile error.
 *
 * Effect resolves Tags BY THEIR TEXTUAL KEY. Both copies use
 * `'@nerima-games/mc-sim/InventoryService'`, so in any bundle containing two of
 * them — mc-compose depends on both mx-gameplay and, transitively, mc-sim — a
 * `Layer` built against a narrow mirror satisfies the wide tag and every method
 * the narrow copy omitted is `undefined` at the point of use.
 *
 * `InventoryService` is a `Context.Tag` CLASS, so this mirror carries the
 * NOMINAL hazard as well: mc-sim's copy and this one are two nominal types
 * denoting one service, and TypeScript cannot see the shape drift. That is the
 * `ChunkStore` situation rather than the `EntityManager` one, and it is why the
 * two-direction assignment below has to restate the whole api rather than
 * assert a subset.
 *
 * ---------------------------------------------------------------------------
 * THE NUMBERS POINT IN OPPOSITE DIRECTIONS, AND THAT IS PINNED BEHAVIOURALLY
 * ---------------------------------------------------------------------------
 *
 * `add` answers with what did NOT fit and `remove` with what WAS taken. Both
 * are `(item, count) => Effect<number>`, so no assignment in this file can tell
 * them apart, and a mirror that swapped them would pass every structural check
 * here and silently make a full inventory look like a successful deposit. So
 * the polarity is asserted against `test/support/inventory-service-double.ts`,
 * whose stacking rule is transcribed from mc-sim's `addItem`.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, type Layer } from 'effect'
import { MAX_STACK_COUNT, type StackCount } from '../domain/frame-contract'
import {
  InventoryService,
  type CraftGrid,
  type CraftResult,
  type Inventory,
  type InventoryServiceApi,
  type Ingredient,
  type ItemStack,
  type MissingIngredient,
  type PatternCell,
  type Recipe,
  type RecipeId,
  type RecipeMatch,
  type RecipePattern,
  type RecipeTable,
  type ShapedRecipe,
  type ShapelessRecipe,
  type Slot,
} from '../domain/inventory-port'
import type { ItemType } from '../domain/item-vocabulary'
import {
  brimming,
  emptySlots,
  INVENTORY_SLOT_COUNT,
  makeInventoryDouble,
} from './support/inventory-service-double'

/**
 * mc-sim's `InventoryServiceApi`, restated from
 * `mc-sim/application/inventory-service.ts`.
 *
 * Written out rather than imported because mc-sim is not published — which is
 * the same reason the mirror exists at all. When it is published, this alias
 * becomes `import type { InventoryServiceApi } from '@nerima-games/mc-sim'` and
 * every assertion below keeps its meaning unchanged.
 *
 * There is NO deliberate widening here, unlike the `ChunkStore` mirror's
 * `Chunk.biomes`. Every member is transcribed exactly, and so is every type the
 * members name — which is what makes the two assignments below check the whole
 * surface rather than most of it. That completeness is the reason this
 * repository now carries `Recipe`, `CraftGrid` and `CraftResult` at all; see
 * `domain/inventory-port.ts`'s header on the price and why it is now worth
 * paying.
 */
type SimInventoryServiceApi = {
  readonly add: (item: ItemType, count: number) => Effect.Effect<number>
  readonly remove: (item: ItemType, count: number) => Effect.Effect<number>
  readonly countOf: (item: ItemType) => Effect.Effect<number>
  readonly snapshot: Effect.Effect<Inventory>
  readonly restore: (inventory: Inventory) => Effect.Effect<number>
  readonly reset: Effect.Effect<void>
  readonly recipes: Effect.Effect<RecipeTable>
  readonly previewCraft: (grid: CraftGrid) => Effect.Effect<RecipeMatch>
  readonly craft: (grid: CraftGrid) => Effect.Effect<CraftResult>
}

/**
 * The crafting vocabulary `InventoryServiceApi` names, restated from
 * `mc-sim/domain/recipe.ts` and `mc-sim/domain/crafting.ts`.
 *
 * NOTHING IN THIS REPOSITORY READS ANY OF IT, which is precisely why it is
 * restated here rather than left to the api assignment above. TypeScript checks
 * a type it can reach; `RecipeTable` is reachable through `recipes`, but
 * `ShapedRecipe.pattern`'s cells are four hops down and a mirror that dropped a
 * member of `RecipePattern` would still satisfy the api assignment as long as
 * the two sides were spelled the same way — which they would be, because the
 * mirror is where they are spelled. Restating them separately is what makes
 * this a comparison rather than a reflection.
 */
type SimItemStack = { readonly item: ItemType; readonly count: StackCount }
type SimSlot = SimItemStack | undefined
type SimInventory = { readonly slots: ReadonlyArray<SimSlot> }
type SimRecipeId = string
type SimIngredient = { readonly _tag: 'Exact'; readonly item: ItemType }
type SimPatternCell = SimIngredient | undefined
type SimRecipePattern = {
  readonly width: number
  readonly height: number
  readonly cells: ReadonlyArray<SimPatternCell>
}
type SimShapedRecipe = {
  readonly _tag: 'Shaped'
  readonly id: SimRecipeId
  readonly pattern: SimRecipePattern
  readonly output: SimItemStack
}
type SimShapelessRecipe = {
  readonly _tag: 'Shapeless'
  readonly id: SimRecipeId
  readonly ingredients: ReadonlyArray<SimIngredient>
  readonly output: SimItemStack
}
type SimRecipe = SimShapedRecipe | SimShapelessRecipe
type SimRecipeTable = ReadonlyArray<SimRecipe>
type SimCraftGrid = {
  readonly width: number
  readonly height: number
  readonly cells: ReadonlyArray<SimSlot>
}
type SimRecipeMatch =
  | { readonly _tag: 'Match'; readonly recipe: SimRecipe; readonly output: SimItemStack }
  | { readonly _tag: 'NoMatch' }
type SimMissingIngredient = { readonly item: ItemType; readonly short: number }
type SimCraftResult =
  | { readonly _tag: 'Crafted'; readonly recipeId: SimRecipeId; readonly output: SimItemStack }
  | { readonly _tag: 'NoMatch' }
  | { readonly _tag: 'MissingIngredients'; readonly missing: ReadonlyArray<SimMissingIngredient> }
  | { readonly _tag: 'NoRoom' }

const COBBLESTONE: ItemType = 'cobblestone'
const DIAMOND: ItemType = 'diamond'

describe('the InventoryService mirror', () => {
  it.effect('matches mc-sim’s interface in BOTH directions', () =>
    Effect.sync(() => {
      // The assertions ARE the assignments. A method added, removed or
      // re-signed on either side stops the build here rather than at the
      // repoint — and, more importantly, rather than at runtime with an
      // `undefined` method.
      const asSim = (api: InventoryServiceApi): SimInventoryServiceApi => api
      const asMirror = (api: SimInventoryServiceApi): InventoryServiceApi => api

      expect(typeof asSim).toBe('function')
      expect(typeof asMirror).toBe('function')
    }),
  )

  it.effect('mirrors the whole crafting vocabulary the api names, in BOTH directions', () =>
    Effect.sync(() => {
      // Sixteen assignments, none of which this repository's rules need. See
      // the note on `SimItemStack` above for why they are separate from the api
      // assignment rather than implied by it.
      const stack = (value: ItemStack): SimItemStack => value
      const stackBack = (value: SimItemStack): ItemStack => value
      const slot = (value: Slot): SimSlot => value
      const slotBack = (value: SimSlot): Slot => value
      const inventory = (value: Inventory): SimInventory => value
      const inventoryBack = (value: SimInventory): Inventory => value
      const recipeId = (value: RecipeId): SimRecipeId => value
      const recipeIdBack = (value: SimRecipeId): RecipeId => value
      const ingredient = (value: Ingredient): SimIngredient => value
      const ingredientBack = (value: SimIngredient): Ingredient => value
      const patternCell = (value: PatternCell): SimPatternCell => value
      const patternCellBack = (value: SimPatternCell): PatternCell => value
      const pattern = (value: RecipePattern): SimRecipePattern => value
      const patternBack = (value: SimRecipePattern): RecipePattern => value
      const shaped = (value: ShapedRecipe): SimShapedRecipe => value
      const shapedBack = (value: SimShapedRecipe): ShapedRecipe => value
      const shapeless = (value: ShapelessRecipe): SimShapelessRecipe => value
      const shapelessBack = (value: SimShapelessRecipe): ShapelessRecipe => value
      const recipe = (value: Recipe): SimRecipe => value
      const recipeBack = (value: SimRecipe): Recipe => value
      const table = (value: RecipeTable): SimRecipeTable => value
      const tableBack = (value: SimRecipeTable): RecipeTable => value
      const grid = (value: CraftGrid): SimCraftGrid => value
      const gridBack = (value: SimCraftGrid): CraftGrid => value
      const match = (value: RecipeMatch): SimRecipeMatch => value
      const matchBack = (value: SimRecipeMatch): RecipeMatch => value
      const missing = (value: MissingIngredient): SimMissingIngredient => value
      const missingBack = (value: SimMissingIngredient): MissingIngredient => value
      const result = (value: CraftResult): SimCraftResult => value
      const resultBack = (value: SimCraftResult): CraftResult => value

      for (const converter of [
        stack, stackBack, slot, slotBack, inventory, inventoryBack,
        recipeId, recipeIdBack, ingredient, ingredientBack,
        patternCell, patternCellBack, pattern, patternBack,
        shaped, shapedBack, shapeless, shapelessBack, recipe, recipeBack,
        table, tableBack, grid, gridBack, match, matchBack,
        missing, missingBack, result, resultBack,
      ]) {
        expect(typeof converter).toBe('function')
      }
    }),
  )

  it.effect('uses mc-sim’s tag key, character for character', () =>
    Effect.sync(() => {
      // If this string drifts, Effect resolves two different services and the
      // failure is a missing method at runtime in a bundle neither repository
      // tested alone.
      expect(InventoryService.key).toBe('@nerima-games/mc-sim/InventoryService')
    }),
  )

  it.effect('a Layer built from the mirror is a Layer for the tag', () =>
    Effect.sync(() => {
      // The compile-time half of the tag-key hazard: whatever this repository
      // builds must be usable where mc-sim's `InventoryServiceLayer` is.
      const asLayer = (layer: Layer.Layer<InventoryService>): Layer.Layer<InventoryService> => layer
      expect(typeof asLayer).toBe('function')
    }),
  )

  it.effect('does not leak into this package’s published surface', () =>
    Effect.gen(function* () {
      // `index.ts` deliberately omits this module, exactly as it omits
      // `domain/entity-manager-port.ts` and `domain/chunk-store-port.ts`.
      // Re-exporting another repository's service would make deleting the
      // stand-in a breaking change for consumers of mx-gameplay.
      const barrel = yield* Effect.promise(() => import('../index'))
      expect(Object.keys(barrel)).not.toContain('InventoryService')

      // The crafting vocabulary in particular. It is mirrored HERE because the
      // api names it, and re-exporting it would make mx-gameplay look like a
      // repository that has an opinion about recipes.
      const port = yield* Effect.promise(() => import('../domain/inventory-port'))
      expect(Object.keys(port)).toStrictEqual(['InventoryService'])
    }),
  )

  it.effect('hands back only what mc-sim’s barrel can replace', () =>
    Effect.gen(function* () {
      // `./chunk-store-port`'s lesson, applied before it can bite: `ItemType`
      // and `StackCount` are NOT declared in the mirror, because mc-sim's
      // barrel deliberately does not re-export its own kernel mirror. A
      // `StackCount` here would be a symbol `@nerima-games/mc-sim` cannot hand
      // back on deletion day — the exact shape of the four capability
      // predicates that sat in the `ChunkStore` mirror for as long as they
      // existed.
      const port = yield* Effect.promise(() => import('../domain/inventory-port'))
      expect(Object.keys(port)).not.toContain('StackCount')
      expect(Object.keys(port)).not.toContain('MAX_STACK_COUNT')
      expect(Object.keys(port)).not.toContain('ITEM_TYPES')

      // ...and they come from the mirrors kernel's barrel DOES replace.
      const kernelScalars = yield* Effect.promise(() => import('../domain/frame-contract'))
      expect(Object.keys(kernelScalars)).toContain('StackCount')
      expect(Object.keys(kernelScalars)).toContain('MAX_STACK_COUNT')
    }),
  )
})

describe('the two numbers on this interface point in opposite directions', () => {
  it.effect('`add` answers with what did NOT fit, and 0 is the success case', () =>
    Effect.gen(function* () {
      const inventory = yield* makeInventoryDouble()

      // An empty inventory takes everything.
      expect(yield* inventory.api.add(COBBLESTONE, 3)).toBe(0)
      expect(yield* inventory.api.countOf(COBBLESTONE)).toBe(3)

      // A brimming one takes nothing, and says how much it refused. This is the
      // branch `stages/registration.ts` turns into `leftoverItems`, and a
      // mirror that read the number as a success flag would drop it silently.
      const full = yield* makeInventoryDouble(brimming(COBBLESTONE))
      expect(yield* full.api.add(COBBLESTONE, 7)).toBe(7)
      expect(yield* full.api.countOf(COBBLESTONE)).toBe(INVENTORY_SLOT_COUNT * MAX_STACK_COUNT)
    }),
  )

  it.effect('`remove` answers with what WAS taken, and 0 is the failure case', () =>
    Effect.gen(function* () {
      const inventory = yield* makeInventoryDouble()

      // Nothing there: zero taken. The same literal `add` uses for total
      // success, on a method one line away in the same interface.
      expect(yield* inventory.api.remove(DIAMOND, 1)).toBe(0)

      yield* inventory.api.add(DIAMOND, 5)
      expect(yield* inventory.api.remove(DIAMOND, 2)).toBe(2)
      // Short stock is a PARTIAL answer rather than a refusal.
      expect(yield* inventory.api.remove(DIAMOND, 9)).toBe(3)
      expect(yield* inventory.api.countOf(DIAMOND)).toBe(0)
    }),
  )

  it.effect('partial stacks are topped up before empty slots are opened', () =>
    Effect.gen(function* () {
      // mc-sim's stacking rule, and the reason the double transcribes it: an
      // implementation that opened a new slot per `add` would never overflow,
      // so the leftover branch above would be unreachable and this file would
      // be asserting a number nothing can produce.
      const inventory = yield* makeInventoryDouble()

      yield* inventory.api.add(COBBLESTONE, 1)
      yield* inventory.api.add(COBBLESTONE, 1)

      const snapshot = yield* inventory.api.snapshot
      expect(snapshot.slots[0]).toStrictEqual({ item: COBBLESTONE, count: 2 })
      expect(snapshot.slots[1]).toBeUndefined()
      expect(snapshot.slots).toHaveLength(INVENTORY_SLOT_COUNT)
    }),
  )

  it.effect('a quantity that is not a quantity leaves NOTHING behind', () =>
    Effect.gen(function* () {
      // mc-sim's asymmetry, transcribed rather than simplified: a rejected
      // count is reported as leftover, because 2.5 items asked for is 2.5 not
      // placed — EXCEPT when it is not finite, because a `NaN` leftover is a
      // number every caller downstream would believe. Preview finding F5 in
      // mc-sim's handwriting.
      const inventory = yield* makeInventoryDouble()

      expect(yield* inventory.api.add(COBBLESTONE, 2.5)).toBe(2.5)
      expect(yield* inventory.api.add(COBBLESTONE, Number.NaN)).toBe(0)
      expect(yield* inventory.api.add(COBBLESTONE, Number.POSITIVE_INFINITY)).toBe(0)
      expect(yield* inventory.api.add(COBBLESTONE, -4)).toBe(0)
      expect(yield* inventory.api.countOf(COBBLESTONE)).toBe(0)

      // And the whole inventory is untouched — the same array, in fact.
      expect((yield* inventory.api.snapshot).slots).toStrictEqual(emptySlots())
    }),
  )

  it.effect('the four crafting members refuse rather than answering plausibly', () =>
    Effect.gen(function* () {
      // The discipline `test/support/chunk-store-double.ts` applies to `load`.
      // A double that half-implemented `matchRecipe` would let a test in this
      // repository assert a match nobody computes.
      const inventory = yield* makeInventoryDouble()

      const refusals: ReadonlyArray<Effect.Effect<unknown>> = [
        inventory.api.recipes,
        inventory.api.previewCraft({ width: 2, height: 2, cells: [] }),
        inventory.api.craft({ width: 2, height: 2, cells: [] }),
        inventory.api.restore({ slots: [] }),
      ]

      for (const refusal of refusals) {
        expect((yield* Effect.exit(refusal))._tag).toBe('Failure')
      }
    }),
  )
})
