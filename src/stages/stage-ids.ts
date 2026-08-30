/**
 * Every `StageId` this repository writes down, in one file.
 *
 * Two kinds live here and the distinction is the point:
 *
 *   - `GAMEPLAY_STAGE_IDS` — stages mx-gameplay OWNS and registers.
 *   - `UPSTREAM_STAGE_IDS` — stages owned by somebody else that mx-gameplay
 *     names in an `after` constraint.
 *
 * A stage id is a string, so naming one creates no import and no dependency
 * edge. That is exactly why they must be collected here rather than scattered:
 * an `after` edge is invisible to the dependency-whitelist gate, so the only way
 * to review "who does mx-gameplay claim to run after" is to be able to read the
 * whole answer at once. `test/stage-registration.test.ts` reads this file and
 * fails if an edge points at a sibling experience module.
 */
import { StageId } from '@nerima-games/mc-kernel'

/**
 * Stages owned by mx-gameplay.
 *
 * These are the `interactions`, `entities`, End encounter, `fluids` and `time/weather`
 * slots of the standard skeleton in plan.md §4.2:
 *
 *     input -> simulation(physics -> interactions -> entities -> fluids ->
 *     redstone -> time/weather) -> camera-mirror -> chunk-sync -> render ->
 *     post-fx -> hud-sync
 *
 * mx-gameplay fills those gameplay slots; mx-redstone fills
 * `redstone`; mc-sim fills `physics`; mc-render fills `input`, `render` and
 * `post-fx`; mx-ui fills `hud-sync`. NOBODY declares the skeleton itself —
 * mc-compose does (plan.md §2.3-3).
 */
export const GAMEPLAY_STAGE_IDS: {
  readonly vehicles: StageId
  readonly interactions: StageId
  readonly fire: StageId
  readonly survivalHunger: StageId
  readonly entities: StageId
  readonly enderDragon: StageId
  readonly fluids: StageId
  readonly timeWeather: StageId
} = {
  /** Rail and water vehicle integration after physics has advanced. */
  vehicles: StageId('gameplay:vehicles'),
  /**
   * Break / place / item use / mob interaction. The ~40 one-rule-per-file
   * handlers of plan.md §3.11 all run inside this single stage; they are many
   * files and one registration, because the frame contract is what mc-compose
   * sees and it should see one thing per responsibility.
   */
  interactions: StageId('gameplay:interactions'),
  /** Deterministic block fire, burning actors, and extinguishing. */
  fire: StageId('gameplay:fire'),
  /** Survival hunger, regeneration, and starvation after activity resolution. */
  survivalHunger: StageId('gameplay:survival-hunger'),
  /** Mob AI, drops, and the falling-block cascade. */
  entities: StageId('gameplay:entities'),
  /** Ender Dragon encounter progression while the player is in the End. */
  enderDragon: StageId('gameplay:ender-dragon'),
  /** Budgeted fluid propagation. */
  fluids: StageId('gameplay:fluids'),
  /** Day/night advance and weather transitions. */
  timeWeather: StageId('gameplay:time-weather'),
} as const

/**
 * Stages owned by OTHER repositories that mx-gameplay orders itself against.
 *
 * Exactly one entry, and it is deliberately the minimum. plan.md §4.2 puts
 * gameplay's stages after `input` as well, but `input` already precedes
 * `sim:physics`, so declaring it here would add a redundant edge — and a
 * redundant edge is a claim about the global order, which this repository is
 * not entitled to make (plan.md §2.3-3). Declare what your own correctness
 * needs; let mc-compose have the rest.
 *
 * `sim:physics` is a stage of mc-sim, a declared parent of this repository. The
 * frame contract does NOT require that: an `after` edge naming an absent stage
 * is scheduled as if the edge were absent, so a module may order itself against
 * something it does not depend on. mx-gameplay simply has no reason to.
 */
export const UPSTREAM_STAGE_IDS: {
  readonly simPhysics: StageId
} = {
  /**
   * Interactions read the player's post-integration position: raycasting for a
   * block target against a stale position is how you mine the wrong cell while
   * moving.
   */
  simPhysics: StageId('sim:physics'),
} as const

/**
 * The `<repo>:` prefixes belonging to the four experience modules (plan.md
 * §2.2).
 *
 * Used by the regression test that enforces §2.3-1's zero-edge rule at the
 * ordering level as well as the import level. An `after: [StageId('ui:hud-sync')]`
 * would pass `pnpm check:deps` — it is a string — while still coupling
 * mx-gameplay's frame position to mx-ui's existence. The test closes that gap.
 */
export const EXPERIENCE_MODULE_STAGE_PREFIXES = ['gameplay:', 'redstone:', 'ui:', 'multiplayer:'] as const

/** This repository's own prefix, excluded when checking for sibling edges. */
export const OWN_STAGE_PREFIX = 'gameplay:'
