/**
 * A minimal stand-in for the part of mc-compose that runs a frame.
 *
 * ---------------------------------------------------------------------------
 * Why the tests do not just call the stages in array order
 * ---------------------------------------------------------------------------
 *
 * The array `gameplayStages` returns is not a schedule (plan.md §2.3-3, and
 * `test/stage-registration.test.ts` proves it by reversing the array). A
 * scenario test that iterated the array would be asserting against an order no
 * consumer is obliged to use, and would keep passing if the `after` edges were
 * deleted — which is precisely the thing that must not be deletable, because
 * "a block broken in `interactions` falls in `entities`" is only true if the
 * ordering constraint holds.
 *
 * So this resolves the constraints instead, the way mc-compose will: a
 * topological sort over the declared `after` edges, with dangling edges ignored
 * (an edge to a stage nobody registered is scheduled as if it were absent —
 * that is what lets a module order itself against an optional peer). Ties are
 * broken by input order, so the result is deterministic and a scenario test
 * stays an oracle.
 *
 * It lives in `test/` and NOT in the shipped source. A `sortStages` export from
 * this repository would be it claiming a decision it cannot make correctly,
 * because it cannot see the other three experience modules; `test/public-api.test.ts`
 * asserts that no such export exists.
 */
import { Effect } from 'effect'
import { DeltaTimeSecs, type StageRegistration } from '../../domain/frame-contract'

/** One frame's worth of simulated time, as a 60 Hz loop would produce it. */
export const FRAME_DELTA = DeltaTimeSecs(1 / 60)

export const schedule = (
  stages: ReadonlyArray<StageRegistration>,
): ReadonlyArray<StageRegistration> => {
  const registered = new Set(stages.map((stage) => stage.id))
  const emitted = new Set<string>()
  const ordered: Array<StageRegistration> = []

  while (ordered.length < stages.length) {
    const next = stages.find(
      (stage) =>
        !emitted.has(stage.id) &&
        (stage.after ?? []).every((edge) => !registered.has(edge) || emitted.has(edge)),
    )

    if (next === undefined) {
      throw new Error(
        'frame-runner: the declared `after` edges contain a cycle, so no legal schedule exists.',
      )
    }

    emitted.add(next.id)
    ordered.push(next)
  }

  return ordered
}

export const runFrame = (
  stages: ReadonlyArray<StageRegistration>,
  dt: DeltaTimeSecs = FRAME_DELTA,
): Effect.Effect<void> =>
  Effect.forEach(schedule(stages), (stage) => stage.run(dt), { discard: true })

export const runFrames = (
  stages: ReadonlyArray<StageRegistration>,
  frames: number,
  dt: DeltaTimeSecs = FRAME_DELTA,
): Effect.Effect<void> =>
  Effect.forEach(Array.from({ length: frames }, (_, index) => index), () => runFrame(stages, dt), {
    discard: true,
  })
