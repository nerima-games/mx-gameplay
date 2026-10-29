import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import {
  AngleRadians,
  DimensionIdSchema,
  DimensionRevisionSchema,
  EntityIdSchema,
  position,
  PositionAxis,
  ProjectileIdSchema,
  SimulationTickSchema,
  WorldRevisionSchema,
  DeltaTimeSecs,
} from '@nerima-games/mc-kernel'
import {
  ARROW_PROFILE,
  ProjectileServiceFailure,
  ProjectileServiceErrorSchema,
  type ProjectileLaunchOutcome,
  type ProjectileLaunchRequest,
  type ProjectileServiceError,
  type ProjectileStepOutcome,
  type ProjectileStepRequest,
} from '@nerima-games/mc-sim'
import { makeProjectileRuntime } from '../src/domain/entities/projectile-runtime'

const PROJECTILE_RUNTIME_FIXTURE = {
  source: 'https://github.com/nerima-games/mc-sim',
  version: 'mc-sim 0.6.0',
  edition: 'Java Edition 26.3',
} as const

const point = (x: number, y: number, z: number) =>
  position(PositionAxis(x), PositionAxis(y), PositionAxis(z))

const launchRequest: ProjectileLaunchRequest = {
  projectileId: Schema.decodeUnknownSync(ProjectileIdSchema)('runtime-fixture-arrow'),
  dimension: Schema.decodeUnknownSync(DimensionIdSchema)('overworld'),
  shooter: Schema.decodeUnknownSync(EntityIdSchema)('runtime-fixture-player'),
  tick: Schema.decodeUnknownSync(SimulationTickSchema)(1),
  expectedRevision: Schema.decodeUnknownSync(WorldRevisionSchema)(0),
  expectedDimensionRevision: Schema.decodeUnknownSync(DimensionRevisionSchema)(0),
  kind: 'projectile',
  position: point(0, 1.6, 0),
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: 1 as ProjectileLaunchRequest['speed'],
  profile: ARROW_PROFILE,
}

const stepRequest: ProjectileStepRequest = {
  projectileId: launchRequest.projectileId,
  tick: launchRequest.tick,
  expectedRevision: launchRequest.expectedRevision,
  expectedDimensionRevision: launchRequest.expectedDimensionRevision,
  deltaTime: DeltaTimeSecs(0.05),
  world: {
    blockBounds: () => [],
    entities: [],
    isInWater: () => false,
    bounds: {
      minX: PositionAxis(-16),
      minY: PositionAxis(-16),
      minZ: PositionAxis(-16),
      maxX: PositionAxis(16),
      maxY: PositionAxis(16),
      maxZ: PositionAxis(16),
    },
  },
  blockAddressOfHit: () => undefined,
}

describe(
  `projectile runtime (${PROJECTILE_RUNTIME_FIXTURE.source}; ${PROJECTILE_RUNTIME_FIXTURE.version}; ${PROJECTILE_RUNTIME_FIXTURE.edition})`,
  () => {
    it('delegates launch and step requests and preserves typed failures', () => {
      const launchFailure = new ProjectileServiceFailure({ reason: 'invalid-launch' })
      const stepFailure = new ProjectileServiceFailure({ reason: 'unknown-projectile' })
      const launchEffect = Effect.fail(launchFailure)
      const stepEffect = Effect.fail(stepFailure)
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
      expect(Schema.decodeUnknownResult(ProjectileServiceErrorSchema)(launchFailure)._tag).toBe('Success')
      expect(Schema.decodeUnknownResult(ProjectileServiceErrorSchema)(stepFailure)._tag).toBe('Success')
    })
  },
)
