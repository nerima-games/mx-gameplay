/**
 * A stationary player for the mining-site preview.
 *
 * `./roster.ts`'s argument applies here unchanged: a working `PlayerService`
 * built in this repository would be mx-gameplay implementing mc-sim's service,
 * and the preview exists to exercise mx-gameplay's rules rather than to
 * reimplement its parents. So this holds the two fields the frame reads and
 * refuses everything else.
 *
 * WHY IT IS NOT `refuse` ALL THE WAY DOWN, unlike the roster. `stepPortalTravel`
 * reads `pose` and `dimension` EVERY FRAME — that is what being wired means — so
 * a refusing `pose` would kill the first frame of a preview that has nothing to
 * do with portals. The mining site has no portal blocks in it, so `moveTo` and
 * `setDimension` are never reached; they are implemented rather than refused
 * anyway, because a preview that dies the day someone adds obsidian to a
 * scenario is a worse diagnostic than one that quietly walks through.
 */
import { Effect, Ref } from 'effect'
import { PositionAxis } from '@nerima-games/mc-kernel'
import type { Dimension } from '@nerima-games/mc-worldgen'
import type { PlayerPose, PlayerServiceApi } from '@nerima-games/mc-sim'

const refuse = <A>(what: string): Effect.Effect<A> =>
  Effect.die(
    `preview-mining-site: ${what} — this preview does not own the player's camera, and mx-gameplay must not implement mc-sim's service. See apps/preview-mining-site/player.ts.`,
  )

/** Standing at the origin at sea level, which is where the site is dug. */
const STANDING_POSE: PlayerPose = {
  feetPosition: { x: PositionAxis(0), y: PositionAxis(64), z: PositionAxis(0) },
  yawRadians: 0,
  pitchRadians: 0,
}

export const makePreviewPlayer: Effect.Effect<PlayerServiceApi> = Effect.gen(function* () {
  const pose = yield* Ref.make<PlayerPose>(STANDING_POSE)
  const dimension = yield* Ref.make<Dimension>('overworld')

  return {
    pose: Ref.get(pose),
    dimension: Ref.get(dimension),
    look: () => refuse('look'),
    moveTo: (feetPosition) => Ref.update(pose, (current) => ({ ...current, feetPosition })),
    setDimension: (next) => Ref.set(dimension, next),
    cameraPose: refuse('cameraPose'),
    restore: (next, nextDimension) =>
      Effect.andThen(Ref.set(pose, next), Ref.set(dimension, nextDimension)),
    snapshot: refuse('snapshot'),
    replicatedCandidate: refuse('replicatedCandidate'),
    submitReplicatedCandidate: () => refuse('submitReplicatedCandidate'),
    reset: Effect.andThen(Ref.set(pose, STANDING_POSE), Ref.set(dimension, 'overworld')),
  }
})
