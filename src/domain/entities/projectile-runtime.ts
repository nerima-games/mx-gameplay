import type {
  ProjectileLaunchOutcome,
  ProjectileLaunchRequest,
  ProjectileServiceApi,
  ProjectileServiceError,
  ProjectileStepOutcome,
  ProjectileStepRequest,
} from '@nerima-games/mc-sim'
import type { Effect } from 'effect'

/** The sim-owned projectile operations exposed to gameplay callers. */
export type ProjectileRuntime = Pick<ProjectileServiceApi, 'launch' | 'step'>

/**
 * Keep projectile identity, physics results, commits, and events in mc-sim.
 * This adapter only narrows its public surface for domain callers.
 */
export const makeProjectileRuntime = (
  service: ProjectileRuntime,
): ProjectileRuntime => ({
  launch: (request: ProjectileLaunchRequest): Effect.Effect<ProjectileLaunchOutcome, ProjectileServiceError> =>
    service.launch(request),
  step: (request: ProjectileStepRequest): Effect.Effect<ProjectileStepOutcome, ProjectileServiceError> =>
    service.step(request),
})
