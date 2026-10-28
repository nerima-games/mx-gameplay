import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  ProjectileServiceFailure,
  type ProjectileLaunchOutcome,
  type ProjectileLaunchRequest,
  type ProjectileServiceError,
  type ProjectileStepOutcome,
  type ProjectileStepRequest,
} from '@nerima-games/mc-sim'
import { makeProjectileRuntime } from '../src/domain/entities/projectile-runtime'

describe('projectile runtime', () => {
  it('delegates launch and step to mc-sim and preserves its typed failures', () => {
    const launchFailure = new ProjectileServiceFailure({ reason: 'invalid-launch' })
    const stepFailure = new ProjectileServiceFailure({ reason: 'unknown-projectile' })
    const launchEffect = Effect.fail(launchFailure)
    const stepEffect = Effect.fail(stepFailure)
    const launchRequest = {} as ProjectileLaunchRequest
    const stepRequest = {} as ProjectileStepRequest
    let receivedLaunch: ProjectileLaunchRequest | undefined
    let receivedStep: ProjectileStepRequest | undefined
    const runtime = makeProjectileRuntime({
      launch: (request): Effect.Effect<ProjectileLaunchOutcome, ProjectileServiceError> => {
        receivedLaunch = request
        return launchEffect
      },
      step: (request): Effect.Effect<ProjectileStepOutcome, ProjectileServiceError> => {
        receivedStep = request
        return stepEffect
      },
    })

    expect(runtime.launch(launchRequest)).toBe(launchEffect)
    expect(runtime.step(stepRequest)).toBe(stepEffect)
    expect(receivedLaunch).toBe(launchRequest)
    expect(receivedStep).toBe(stepRequest)
  })
})
