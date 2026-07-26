/**
 * ONE RULE, ONE FILE (DN-GP-9): when a mob stops existing because nobody is
 * near it.
 *
 * The counterpart to `./hostile-spawn`, and deliberately shaped like it: a total
 * function from facts about ONE mob to a verdict with a reason. The two rules
 * are the ends of a mob's life and they are the two ends of one budget — a
 * spawner that never stopped and a sweep that never ran would fill a world, and
 * `./hostile-spawn`'s header lists despawning among the things it does not
 * decide. This is that half.
 *
 * Ported from `<reference-impl>/packages/entity/domain/mob/entity-manager-utils.ts:54-69`
 * with its constant from `.../spawner-config.ts:4`, and its oracle is
 * `.../test/mob/entity-manager-utils.test.ts:252-285` — six cases, of which the
 * boundary one ("returns false when entity is exactly at max distance
 * boundary", :266-270) is the one that could not have been read off the code.
 *
 * ---------------------------------------------------------------------------
 * The two rules fail in OPPOSITE directions, and that is the whole design
 * ---------------------------------------------------------------------------
 *
 * `./hostile-spawn` answers an unmeasurable candidate with `Refused`. This one
 * answers an unmeasurable mob with `Despawn`. Those look like a disagreement
 * about `NaN` and are the same decision: BOTH ANSWERS REMOVE A MOB. The inert
 * direction for a spawn rule is not to make one, and the inert direction for a
 * sweep is to take one away, so a broken measurement can never be the reason a
 * population grows.
 *
 * The reference gets there too and by a different route: `shouldDespawnEntity`
 * opens with `!isFinitePosition(entity.position) || !isFiniteVelocity(...)` and
 * returns `true` (:59-61). It is despawning a mob whose coordinates have stopped
 * being numbers because there is nothing else to do with one, which is the same
 * observation the preview's finding F5 makes about health.
 *
 * ---------------------------------------------------------------------------
 * There is NO time bound here, because the reference has none
 * ---------------------------------------------------------------------------
 *
 * Vanilla despawns on distance AND on time: past 128 blocks instantly, between
 * 32 and 128 at random once a mob has existed for 600 ticks, and never inside
 * 24. The reference implements the first of those three and nothing else — its
 * sweep is `despawnFarEntities(playerPos, DESPAWN_DISTANCE)`
 * (`application/mob/mob-maintenance.ts:60`) and there is no age on an entity to
 * bound.
 *
 * That is ported as it stands rather than completed. docs/porting.md §4 makes
 * the reference the specification, and the missing two thirds are not a detail:
 * an age-based despawn needs a mob to HAVE an age, which is a field on mc-sim's
 * roster entry, and a random despawn needs a roll this rule would have to be
 * handed. Both are on the arena's missing list with those destinations. What is
 * here is the whole of what the reference decides.
 *
 * ---------------------------------------------------------------------------
 * `persistent` is a flag, and it is a flag for `./hostile-spawn`'s reason
 * ---------------------------------------------------------------------------
 *
 * The reference exempts one mob by name: `if (entity.type === 'Villager') return
 * false` (:66), because a village-bound villager despawning at 128 blocks would
 * fight the village's own respawn at 160 and thrash. Right behaviour, and the
 * wrong place to spell it — naming a mob type in a rule is how
 * `blockTypeToIndex('SAND')` reached 229 call sites (plan.md §3.1), and
 * `./hostile-spawn` refuses the identical temptation for blocks by asking
 * kernel's capability instead of listing ids.
 *
 * So the rule takes `persistent` and the roster decides who is. Making a second
 * mob persistent should be one field on its definition and no edit in this file.
 */

/**
 * Past this many blocks from the nearest player, a mob is swept.
 *
 * `<reference-impl>/packages/entity/domain/mob/spawner-config.ts:4`. The
 * comparison is STRICTLY GREATER (`entity-manager-utils.ts:68`, on squared
 * distances), so a mob at exactly 128 blocks is KEPT.
 *
 * Worth reading against `./hostile-spawn`'s band: spawns land 16 to 40 blocks
 * away and the sweep starts at 128, so there are 88 blocks of slack in which a
 * mob that has wandered off is neither despawned nor replaced. That gap is what
 * stops a player who walks in a straight line from towing a permanent cloud of
 * newly spawned hostiles behind them.
 */
export const DESPAWN_DISTANCE_BLOCKS = 128

/**
 * Everything the rule needs about one mob, and nothing it does not.
 *
 * Two fields, both the host's. Note what is absent: there is no entity id, no
 * position, and no mob type — a distance is a MEASUREMENT mc-sim takes, exactly
 * as in `./creeper-fuse`'s `CreeperSenses`, and the sweep that iterates the
 * roster is mc-sim's loop calling this once per entry.
 */
export type DespawnCandidate = {
  /**
   * Blocks to the nearest player, measured in THREE dimensions.
   *
   * 3D, unlike `./hostile-spawn`'s horizontal band: the reference's despawn test
   * is `distanceToPlayerSq` over x, y and z (`entity-manager-utils.ts:68`) while
   * its spawn band is XZ only (`mob-spawner-rules.ts:8-14`). The two really are
   * measured differently and collapsing them would move the sweep line under a
   * player standing on a cliff.
   *
   * `undefined` means THERE IS NO PLAYER — no player in this world, or none in
   * this dimension. It is not a very large distance. See `despawnVerdict`.
   */
  readonly distanceToPlayerBlocks: number | undefined
  /**
   * Is this mob exempt from distance despawning?
   *
   * A property of the roster entry, not of this rule. `entity-manager-utils.ts:66`
   * spells it as a villager; see the module header.
   */
  readonly persistent: boolean
}

/** Why a mob was swept, or why it was left alone. */
export type DespawnReason =
  /** Further than 128 blocks from the nearest player. */
  | 'too-far'
  /**
   * The distance is not a number. `entity-manager-utils.ts:59-61` reaches this
   * from a position or a velocity that has stopped being finite.
   */
  | 'unmeasurable'

export type DespawnVerdict =
  | { readonly _tag: 'Keep' }
  | { readonly _tag: 'Despawn'; readonly reason: DespawnReason }

const KEEP: DespawnVerdict = { _tag: 'Keep' }

/**
 * Should this mob stop existing?
 *
 * TOTAL, deterministic, and ORDERED, and the order is the reference's rather
 * than the tidy one. The finiteness check runs BEFORE the persistence exemption
 * (`entity-manager-utils.ts:59` before :66), so a PERSISTENT MOB WITH A BROKEN
 * POSITION IS STILL SWEPT. That is the right way round — an exemption from a
 * distance rule is not an exemption from being a number — and it is invisible in
 * the reference's code, so `test/mob.test.ts` pins it.
 *
 * `undefined` distance answers `Keep`. A world with no player has nobody to be
 * far from, and "remove every mob" is a different decision with a different
 * trigger: the reference spells that one `despawnAllEntities`
 * (`application/mob/entity-manager-lifecycle.ts:46`) and reaches it from the
 * mobs-disabled switch, never from this rule. Answering `Despawn` here would
 * quietly empty a server between two players logging in.
 */
export const despawnVerdict = (candidate: DespawnCandidate): DespawnVerdict => {
  const distance = candidate.distanceToPlayerBlocks

  if (distance === undefined) {
    return KEEP
  }

  // Before the exemption. See above.
  if (!Number.isFinite(distance)) {
    return { _tag: 'Despawn', reason: 'unmeasurable' }
  }

  if (candidate.persistent) {
    return KEEP
  }

  return distance > DESPAWN_DISTANCE_BLOCKS ? { _tag: 'Despawn', reason: 'too-far' } : KEEP
}
