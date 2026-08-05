/**
 * ONE RULE, ONE FILE (DN-GP-9): how hard an explosion hits, and what it is
 * called when it kills you.
 *
 * `./creeper-fuse` decides WHEN a creeper goes off. This decides HOW HARD, and
 * the two are separate files for the same reason the reference separates them
 * (`packages/entity/domain/mob/creeper-fuse.ts` versus
 * `packages/entity/domain/explosion.ts` + `explosion-resolution.ts`): the fuse
 * is a creeper's, and the blast is not. TNT and a charged creeper carry the
 * reference's other two powers (`explosion.ts:4-6`) through this same formula,
 * so a second source is a constant rather than a copy of the falloff.
 *
 * ---------------------------------------------------------------------------
 * The falloff is ported, not invented (docs/porting.md §4)
 * ---------------------------------------------------------------------------
 *
 * `packages/entity/domain/explosion-resolution.ts:4,17-23`, reproduced below
 * unchanged. plan.md §8 says to use the reference as the specification and
 * 「ゼロから仕様を再発明しない」, and a damage curve is exactly the kind of thing a
 * rewrite gets subtly wrong: any monotone decreasing function "looks right" in a
 * preview, and only the numbers say whether a player survives at three blocks.
 * `packages/entity/test/explosion.test.ts:20-43` pins four of those numbers for
 * a creeper, and `test/mob.test.ts` ports all four.
 *
 * The curve is quadratic in the normalised distance and floored to an integer,
 * so it has two properties worth naming because a linear replacement has
 * neither: it is HARSH near the centre (43 damage at zero against 20 maximum
 * health — a creeper in your face kills a full-health player outright) and it
 * never yields zero anywhere inside the radius (the `+ 1`), so "just inside the
 * blast" is always at least one point of damage rather than a rounding artefact.
 *
 * ---------------------------------------------------------------------------
 * TWO DIFFERENT RADII, with block destruction implemented by the crater stage
 * ---------------------------------------------------------------------------
 *
 * The reference has an explosion damage entities out to `power * 2` = 6 blocks
 * and destroy blocks out to `Math.floor(power)` = 3
 * (`packages/app/application/frame/stages/placement-geometry.ts:14-26`, a solid
 * Euclidean sphere set to AIR). Those are different numbers for the same event,
 * and whoever ports the crater must not reach for the one in this file.
 *
 * The crater is implemented in its own stage because it is a rule that WRITES
 * BLOCKS, so it belongs next to `../interactions/break-block.ts` with a
 * `ChunkStoreApi`, and it must feed `disturb` (`../falling-block`) or a blast
 * under a desert leaves the sand hanging — which is DN-GP-1's cascade, arriving
 * from a new direction. `apps/preview-mining-site` names it as missing rather
 * than this file half-doing it.
 *
 * ---------------------------------------------------------------------------
 * The cause is not optional (DN-GP-3)
 * ---------------------------------------------------------------------------
 *
 * `explosionDamageAt` returns a `Damage`, never a bare number, and there is no
 * overload that returns one. plan.md §3.11: 「死因はドロップせず死亡メッセージまで
 * 運ぶ(参照実装では全死亡が「You died.」になるバグがあった)」. The reference's own
 * post-mortem (`physics-stage-health.ts:32-34`) blames an intermediate helper
 * written as `(amount: number) => …`, and an explosion is precisely the event
 * such a helper gets written for — a number arrives from a formula, and the
 * word "explosion" is somewhere else entirely. Here the two cannot be separated,
 * so the death screen reads "You blew up."
 *
 * The reference agrees about the word: `EXPLOSION_DAMAGE_CAUSE` is
 * `{ kind: 'explosion' }` (`packages/entity/application/explosion-service.ts:9`)
 * and its `DEATH_MESSAGES` maps it to the same sentence this repository's
 * `../death-cause` does.
 */
import type { Damage } from '../death-cause'

/**
 * What set the blast off.
 *
 * A union of one, exactly as the reference's `ExplosionSource`
 * (`packages/entity/domain/explosion.ts:8`) is. It is a union rather than a
 * string because the next member is `'tnt'`, and because a host draining
 * explosions wants to know which sound to play and which entity to blame — the
 * blast itself is identical.
 */
export type ExplosionSource = 'creeper' | 'tnt'

/**
 * An explosion that is happening.
 *
 * NO POSITION, unlike the reference's `ExplosionEvent`
 * (`packages/entity/domain/explosion.ts:10-14`). The position of the creeper
 * that produced it is mc-sim's fact and the host already has it — it is the
 * host that decided this creeper was three blocks from the player in the first
 * place (`./creeper-fuse`'s `CreeperSenses`). Carrying it here would mean this
 * repository restating a coordinate vocabulary it does not own, to hand a
 * number back to the only party that could have supplied it.
 */
export type Explosion = {
  readonly source: ExplosionSource
  readonly power: number
}

/** A creeper's power. `packages/entity/domain/explosion.ts:4`. */
export const CREEPER_EXPLOSION_POWER = 3

/** A lightning-charged creeper's power. */
export const CHARGED_CREEPER_EXPLOSION_POWER = 6

/** A primed TNT block's power. */
export const TNT_EXPLOSION_POWER = 4

/**
 * How far the blast reaches, for DAMAGE.
 *
 * `packages/entity/domain/explosion-resolution.ts:4`: `power * 2`. Six blocks
 * for a creeper — twice the three-block crater, and four times the three-block
 * ignition range, which is why backing out of ignition range is not the same as
 * being safe.
 */
export const explosionRadius = (power: number): number => power * 2

/**
 * The reference's curve, unchanged.
 *
 * `exposure` is the fraction of the blast that reaches the target — 1 is full
 * line of sight and is the reference's default (`computeExplosionDamageAt`,
 * `explosion-resolution.ts:30-35`). This repository has no occlusion rule and
 * therefore never passes anything else; the parameter is kept because dropping
 * it would silently change the curve for whoever ports raycast exposure, and
 * because `packages/entity/test/explosion.test.ts` pins a value at 0.5.
 *
 * TOTAL. A non-finite distance is outside every radius (`NaN > 1` is `false`,
 * so the guard is written to catch it explicitly rather than by luck), and a
 * power of zero has a zero radius and does nothing.
 */
export const explosionDamageAmount = (
  power: number,
  distanceToCentre: number,
  exposure: number = 1,
): number => {
  const diameter = explosionRadius(power)
  if (!Number.isFinite(distanceToCentre) || diameter <= 0) {
    return 0
  }

  const normalised = Math.max(0, distanceToCentre) / diameter
  if (normalised > 1) {
    return 0
  }

  const impact = (1 - normalised) * exposure

  return Math.floor(((impact * impact + impact) / 2) * 7 * diameter + 1)
}

/**
 * The blast's damage AND its cause, which is the only shape this repository
 * hands out. See the module header.
 *
 * A zero amount still carries `explosion`: dropping the cause when the amount
 * happens to be zero is how the optional argument gets reintroduced, one guard
 * clause at a time.
 */
export const explosionDamageAt = (
  explosion: Explosion,
  distanceToCentre: number,
  exposure: number = 1,
): Damage => ({
  amount: explosionDamageAmount(explosion.power, distanceToCentre, exposure),
  cause: 'explosion',
})
