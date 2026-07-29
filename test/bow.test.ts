/**
 * The bow: plan.md §3.11's first responsibility, the item-use half.
 *
 * The first three `describe`s are the reference's oracle
 * (`<reference-impl>/packages/entity/test/bow-resolution.test.ts`) transcribed,
 * one `it` per `it` and the `file:line` on each — docs/porting.md §4: move the
 * tests first, do not reinvent the specification. Everything after them is this
 * repository's, and each block says what it is for: a divergence from the
 * reference, a decision the reference does not record, or the executable form of
 * an ownership argument docs/responsibility.md §5-1 makes in prose.
 *
 * THE FILE EXISTS AT ALL because docs/testing.md §3-1 row 1's second clause was
 * measured and found false — the bow spawns no projectile, in the reference or
 * here. `domain/interactions/draw-bow.ts`'s header carries the measurement.
 */
import { describe, expect, it } from '@effect/vitest'
import { makeTimeService } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import {
  bowCharge,
  bowDamage,
  bowPowerMultiplier,
  canFireBow,
  BOW_FULL_CHARGE_SECS,
  BOW_MAX_DAMAGE,
  BOW_MAX_RANGE,
  BOW_MIN_CHARGE_SECS,
  BOW_MIN_DAMAGE,
  PLAIN_BOW,
} from '../domain/interactions/draw-bow'
import {
  shotBlockedByTerrain,
  shotTarget,
  BOW_AIM_EPSILON_SQUARED,
  BOW_LINE_OF_SIGHT_EPSILON,
  BOW_LINE_OF_SIGHT_STEP,
  BOW_TARGET_CENTER_Y_OFFSET,
  BOW_TARGET_RADIUS,
  type IsArrowBlockedAt,
  type ShotCandidate,
} from '../domain/interactions/bow-shot'
import { knockbackDirection, KNOCKBACK_EPSILON } from '../domain/interactions/knockback'
import { resolveBowHits, type MobBehaviour } from '../domain/entities/mob-frame'
import { EntityId, EntityKind, type EntityRoster } from '../domain/entity-manager-port'
import { gameplayStages, makeGameplayFrameState, requestBowShot } from '../stages/registration'
import { makeChunkStoreDouble } from './support/chunk-store-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { makePlayerServiceDouble } from './support/player-service-double'
import { makeInventoryDouble } from './support/inventory-service-double'
import { runFrame } from './support/frame-runner'
import { Ref } from 'effect'

const EYE = { x: 0, y: 64, z: 0 }

/** A candidate standing at `(x, y, z)`, feet origin. */
const standing = (id: string, x: number, y: number, z: number): ShotCandidate => ({
  id: EntityId(id),
  feetPosition: { x, y, z },
})

/** A world in which the listed cells stop an arrow. */
const blockedAt = (cells: ReadonlyArray<readonly [number, number, number]>): IsArrowBlockedAt => {
  const set = new Set(cells.map(([x, y, z]) => `${String(x)},${String(y)},${String(z)}`))
  return (wx, wy, wz) => set.has(`${String(wx)},${String(wy)},${String(wz)}`)
}

const NOTHING_BLOCKS: IsArrowBlockedAt = () => false

// ---------------------------------------------------------------------------
// The reference's oracle, transcribed
// ---------------------------------------------------------------------------

describe('bowCharge — <reference-impl>/packages/entity/test/bow-resolution.test.ts', () => {
  it('returns 0 for zero time held (:16-18)', () => {
    expect(bowCharge(0)).toBe(0)
  })

  it('returns 1.0 exactly at full charge duration (:20-22)', () => {
    expect(bowCharge(BOW_FULL_CHARGE_SECS)).toBe(1.0)
  })

  it('clamps to 1.0 when held beyond full charge duration (:24-26)', () => {
    expect(bowCharge(BOW_FULL_CHARGE_SECS * 5)).toBe(1.0)
  })

  it('returns 0.5 at half the full charge duration (:28-30)', () => {
    expect(bowCharge(BOW_FULL_CHARGE_SECS / 2)).toBeCloseTo(0.5)
  })

  it('returns a value in (0, 1] for a partial hold (:32-36)', () => {
    const charge = bowCharge(BOW_MIN_CHARGE_SECS)
    expect(charge).toBeGreaterThan(0)
    expect(charge).toBeLessThanOrEqual(1)
  })
})

describe('bowDamage — the reference oracle', () => {
  it('returns BOW_MIN_DAMAGE at charge = 0 (:40-42)', () => {
    expect(bowDamage(0)).toBe(BOW_MIN_DAMAGE)
  })

  it('returns BOW_MAX_DAMAGE at charge = 1 (:44-46)', () => {
    expect(bowDamage(1)).toBe(BOW_MAX_DAMAGE)
  })

  it('clamps negative charge to BOW_MIN_DAMAGE (:48-50)', () => {
    expect(bowDamage(-1)).toBe(BOW_MIN_DAMAGE)
  })

  it('clamps charge > 1 to BOW_MAX_DAMAGE (:52-54)', () => {
    expect(bowDamage(2)).toBe(BOW_MAX_DAMAGE)
  })

  it('uses quadratic scaling: half charge is well below half max damage (:56-60)', () => {
    // c=0.5 -> c^2=0.25 -> 1 + 0.25*8 = 3, not 5.
    expect(bowDamage(0.5)).toBe(3)
    expect(bowDamage(0.5)).toBeLessThan((BOW_MIN_DAMAGE + BOW_MAX_DAMAGE) / 2)
  })
})

describe('canFireBow — the reference oracle', () => {
  it('refuses a hold shorter than the minimum', () => {
    expect(canFireBow(BOW_MIN_CHARGE_SECS / 2)).toBe(false)
  })

  it('fires at exactly the minimum: the comparison is INCLUSIVE (bow-resolution.ts:19)', () => {
    expect(canFireBow(BOW_MIN_CHARGE_SECS)).toBe(true)
  })

  it('fires for any longer hold', () => {
    expect(canFireBow(BOW_FULL_CHARGE_SECS * 10)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// This repository's: divergences and undocumented decisions
// ---------------------------------------------------------------------------

describe('bowCharge — DIVERGENCE: clamped at the bottom too', () => {
  /**
   * The reference is `Math.min(secsHeld / FULL, 1.0)` with no lower clamp
   * (`bow-resolution.ts:8`), so a negative hold yields a negative charge there.
   * Its oracle never tests one. See `bowCharge`'s doc comment.
   */
  it('DIVERGENCE: a negative hold is no draw, where the reference returns a negative charge', () => {
    expect(bowCharge(-5)).toBe(0)
  })

  it('a non-finite hold is no draw, INCLUDING an infinite one', () => {
    // Infinity is not finite, so it takes the same inert branch as NaN rather
    // than clamping to a full draw. That is deliberate: an infinite hold comes
    // from a broken clock, and a broken clock must not produce the STRONGEST
    // shot the weapon has. The reference's `Math.min(Infinity, 1)` is 1, so this
    // is a DIVERGENCE and it is the inert direction.
    expect(bowCharge(Number.NaN)).toBe(0)
    expect(bowCharge(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('never leaves [0, 1], which is the interval its name claims', () => {
    for (const secs of [-100, -1, 0, 0.01, 0.2, 0.5, 1, 2, 1e6]) {
      const charge = bowCharge(secs)
      expect(charge).toBeGreaterThanOrEqual(0)
      expect(charge).toBeLessThanOrEqual(1)
    }
  })
})

describe('canFireBow — totality the reference does not state', () => {
  it('a broken clock does not fire', () => {
    expect(canFireBow(Number.NaN)).toBe(false)
  })

  it('is NOT the same question as "did it draw at all"', () => {
    // A hold between zero and the minimum draws a positive charge and still
    // must not fire. Collapsing the two bounds makes every touch a shot.
    const tap = BOW_MIN_CHARGE_SECS / 2
    expect(bowCharge(tap)).toBeGreaterThan(0)
    expect(canFireBow(tap)).toBe(false)
  })
})

describe('bowPowerMultiplier — the +1 the reference never evaluates at level 0', () => {
  /**
   * `enchantment.ts:32-33` is `1.0 + 0.25 * (level + 1)`, which is 1.25 at level
   * zero — a bonus for an enchantment that is not there. The reference never
   * reaches that case because it applies the multiplier only when a POWER object
   * exists. See `bowPowerMultiplier`'s doc comment: this is the discontinuity a
   * reader who "simplifies" the formula would erase.
   */
  it('no Power is exactly 1, NOT the formula value of 1.25', () => {
    expect(bowPowerMultiplier(undefined)).toBe(1)
    expect(bowPowerMultiplier(0)).toBe(1)
    expect(bowPowerMultiplier(0)).not.toBe(1.25)
  })

  it('Power I is 1.5, which IS the reference formula at level 1', () => {
    expect(bowPowerMultiplier(1)).toBe(1.5)
  })

  it('Power II is 1.75', () => {
    expect(bowPowerMultiplier(2)).toBe(1.75)
  })

  it('a negative or non-finite level is no Power', () => {
    expect(bowPowerMultiplier(-3)).toBe(1)
    expect(bowPowerMultiplier(Number.NaN)).toBe(1)
  })

  it('an unenchanted bow does the reference damage, not 25% more', () => {
    expect(bowDamage(1, PLAIN_BOW)).toBe(BOW_MAX_DAMAGE)
    expect(bowDamage(1, { powerLevel: 0 })).toBe(BOW_MAX_DAMAGE)
  })

  it('a full-draw Power I shot agrees with the reference digit for digit', () => {
    // Reference: round(round(9) * 1.5) = 14. Here: round(9 * 1.5) = 14.
    expect(bowDamage(1, { powerLevel: 1 })).toBe(14)
  })

  it('a non-finite charge does minimum damage rather than NaN damage', () => {
    // A NaN would reach `applyDamage`, make healthPoints NaN, and `isDead`
    // reads NaN as ALIVE — an immortal mob. See `bowDamage`'s doc comment.
    expect(bowDamage(Number.NaN)).toBe(BOW_MIN_DAMAGE)
    expect(Number.isFinite(bowDamage(Number.NaN))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The hitscan
// ---------------------------------------------------------------------------

describe('shotTarget — the cylinder', () => {
  it('hits a mob straight ahead', () => {
    const hit = shotTarget([standing('a', 0, 63.1, 10)], EYE, 0, 0, 1)
    expect(hit?.id).toBe('a')
    expect(hit?.distance).toBeCloseTo(10)
  })

  it('the aim point is the feet plus BOW_TARGET_CENTER_Y_OFFSET, not the feet', () => {
    // Feet at y=64-0.9 puts the CENTRE exactly at eye height, so the
    // perpendicular distance is zero and the shot is dead on.
    const centred = standing('a', 0, 64 - BOW_TARGET_CENTER_Y_OFFSET, 10)
    expect(shotTarget([centred], EYE, 0, 0, 1)?.id).toBe('a')
  })

  it('misses a mob further from the ray than BOW_TARGET_RADIUS', () => {
    const justOutside = BOW_TARGET_RADIUS + 0.01
    const inside = BOW_TARGET_RADIUS - 0.01
    const y = 64 - BOW_TARGET_CENTER_Y_OFFSET
    expect(shotTarget([standing('a', justOutside, y, 10)], EYE, 0, 0, 1)).toBeUndefined()
    expect(shotTarget([standing('a', inside, y, 10)], EYE, 0, 0, 1)?.id).toBe('a')
  })

  it('misses a mob past the reach, and hits one exactly at it', () => {
    const y = 64 - BOW_TARGET_CENTER_Y_OFFSET
    expect(shotTarget([standing('a', 0, y, BOW_MAX_RANGE + 1)], EYE, 0, 0, 1)).toBeUndefined()
    expect(shotTarget([standing('a', 0, y, BOW_MAX_RANGE)], EYE, 0, 0, 1)?.id).toBe('a')
  })

  it('A BOW DOES NOT SHOOT BACKWARDS: a mob behind the player is not a target', () => {
    // `alongRay < 0` in `attack-targeting.ts:36`. Dropping that half of the
    // guard is invisible in a forward-facing test and lets every shot hit
    // whatever is behind you.
    const y = 64 - BOW_TARGET_CENTER_Y_OFFSET
    expect(shotTarget([standing('a', 0, y, -10)], EYE, 0, 0, 1)).toBeUndefined()
  })

  it('takes the NEAREST of several in the crosshair', () => {
    const y = 64 - BOW_TARGET_CENTER_Y_OFFSET
    const hit = shotTarget(
      [standing('far', 0, y, 30), standing('near', 0, y, 5), standing('mid', 0, y, 12)],
      EYE,
      0,
      0,
      1,
    )
    expect(hit?.id).toBe('near')
  })

  it('TIES GO TO THE FIRST IN THE ROSTER — the comparison is strict < (attack-targeting.ts:42)', () => {
    // The reference does not record which of two equidistant mobs is hit. It is
    // pinned here so that a change to `<=` fails a named test.
    const y = 64 - BOW_TARGET_CENTER_Y_OFFSET
    const hit = shotTarget([standing('first', 0, y, 10), standing('second', 0, y, 10)], EYE, 0, 0, 1)
    expect(hit?.id).toBe('first')
  })

  it('hits nothing when the roster is empty', () => {
    expect(shotTarget([], EYE, 0, 0, 1)).toBeUndefined()
  })
})

describe('shotTarget — the ownership argument, executable', () => {
  /**
   * docs/responsibility.md §5-1 decides a symbol by asking whether the MAGNITUDE
   * of a velocity reaches the answer. It does not here, and this is that claim in
   * the form `test/rail.test.ts` gives it for `isAscendingAhead`. Add a term that
   * reads the magnitude — a minimum draw speed, say — and this goes red before
   * the code lands.
   */
  it('scaling the aim direction by any positive factor cannot change the answer', () => {
    // A genuinely three-component aim, so that every axis is scaled and none of
    // the multiplications is a no-op.
    const aim = { x: 0.2, y: 0.1, z: 1 }
    const length = Math.hypot(aim.x, aim.y, aim.z)
    const along = (id: string, t: number): ShotCandidate =>
      standing(
        id,
        EYE.x + (aim.x / length) * t,
        EYE.y + (aim.y / length) * t - BOW_TARGET_CENTER_Y_OFFSET,
        EYE.z + (aim.z / length) * t,
      )
    const candidates = [along('far', 20), along('near', 8)]

    const answers = [1, 0.001, 2, 17, 1e6].map((scale) =>
      shotTarget(candidates, EYE, aim.x * scale, aim.y * scale, aim.z * scale),
    )

    expect(answers[0]?.id).toBe('near')
    for (const answer of answers) {
      expect(answer?.id).toBe(answers[0]?.id)
      expect(answer?.distance).toBeCloseTo(answers[0]?.distance ?? -1)
    }
  })

  it('DIVERGENCE: a degenerate aim hits nothing, where the reference hits the nearest mob', () => {
    // `THREE.Vector3.normalize()` of a zero vector yields zero, after which
    // every projection is zero and the nearest mob within the radius is struck
    // regardless of where the bow pointed. See `shotTarget`'s doc comment.
    const y = 64 - BOW_TARGET_CENTER_Y_OFFSET
    expect(shotTarget([standing('a', 0, y, 0.5)], EYE, 0, 0, 0)).toBeUndefined()
  })

  it('the deadband is BOW_AIM_EPSILON_SQUARED, on the SQUARED length', () => {
    const y = 64 - BOW_TARGET_CENTER_Y_OFFSET
    const candidates = [standing('a', 0, y, 10)]
    // Just inside the deadband: refused. Comfortably outside: aims.
    const tiny = Math.sqrt(BOW_AIM_EPSILON_SQUARED) / 2
    expect(shotTarget(candidates, EYE, 0, 0, tiny)).toBeUndefined()
    expect(shotTarget(candidates, EYE, 0, 0, 1e-6)?.id).toBe('a')
  })

  it('non-finite inputs hit nothing, explicitly rather than by luck', () => {
    const y = 64 - BOW_TARGET_CENTER_Y_OFFSET
    const candidates = [standing('a', 0, y, 10)]
    expect(shotTarget(candidates, EYE, Number.NaN, 0, 1)).toBeUndefined()
    expect(shotTarget(candidates, { x: Number.NaN, y: 64, z: 0 }, 0, 0, 1)).toBeUndefined()
    expect(shotTarget(candidates, EYE, 0, 0, 1, Number.NaN)).toBeUndefined()
  })

  it('a candidate with a non-finite position is never nearest', () => {
    const y = 64 - BOW_TARGET_CENTER_Y_OFFSET
    const hit = shotTarget(
      [standing('broken', Number.NaN, y, 1), standing('real', 0, y, 10)],
      EYE,
      0,
      0,
      1,
    )
    expect(hit?.id).toBe('real')
  })
})

// ---------------------------------------------------------------------------
// Line of sight
// ---------------------------------------------------------------------------

describe('shotBlockedByTerrain', () => {
  it('an open line is not blocked', () => {
    expect(shotBlockedByTerrain(NOTHING_BLOCKS, EYE, { x: 0, y: 64, z: 10 })).toBe(false)
  })

  it('a wall between the two blocks the shot', () => {
    const wall = blockedAt([[0, 64, 5]])
    expect(shotBlockedByTerrain(wall, EYE, { x: 0, y: 64, z: 10 })).toBe(true)
  })

  it("THE SHOOTER'S OWN CELL DOES BLOCK, and the endpoint exclusion does not save it", () => {
    // The walk starts at step 1 (`interaction-bow-handler.ts:80`), so the eye
    // POINT is not sampled — but the step is 0.1 blocks, so the first ten
    // samples of this shot still floor into the shooter's own cell. A player
    // whose eye is inside a blocking cell cannot fire. This is the reference's
    // behaviour as well as this one's, and it is pinned rather than repaired;
    // see `shotBlockedByTerrain`'s doc comment on why.
    const ownCell = blockedAt([[0, 64, 0]])
    expect(shotBlockedByTerrain(ownCell, EYE, { x: 0, y: 64, z: 10 })).toBe(true)
  })

  it("THE TARGET'S CELL DOES NOT BLOCK, because the walk stops before t reaches 1 (:81-82)", () => {
    const targetCell = blockedAt([[0, 64, 10]])
    expect(shotBlockedByTerrain(targetCell, EYE, { x: 0, y: 64, z: 10 })).toBe(false)
  })

  it('a zero-length shot is not blocked (:77)', () => {
    expect(shotBlockedByTerrain(blockedAt([[0, 64, 0]]), EYE, EYE)).toBe(false)
  })

  it('non-finite endpoints are NOT blocked — the permissive direction, argued in the doc comment', () => {
    expect(shotBlockedByTerrain(blockedAt([[0, 64, 5]]), EYE, { x: Number.NaN, y: 64, z: 10 })).toBe(
      false,
    )
  })

  it('KNOWN LIMIT: it is a sampling rate, so a clipped corner passes', () => {
    // BOW_LINE_OF_SIGHT_STEP is 0.1, which is ten samples per block and not a
    // traversal. A shot that crosses a corner for less than a tenth of a block
    // never lands a sample in it. This pins the LIMITATION so that the day a
    // DDA replaces the march, this test goes red and the comment in
    // `bow-shot.ts` has to be rewritten rather than quietly becoming false.
    expect(BOW_LINE_OF_SIGHT_STEP).toBe(0.1)
    const corner = blockedAt([[1, 64, 1]])
    // A line from (0.95, 64, 0) to (0.95, 64, 10) clips x=1 nowhere; a line
    // grazing the corner of the cell below does the same at this resolution.
    expect(shotBlockedByTerrain(corner, { x: 0.95, y: 64.5, z: 0 }, { x: 0.95, y: 64.5, z: 10 })).toBe(
      false,
    )
  })

  it('the epsilon biases a boundary sample into the higher cell', () => {
    expect(BOW_LINE_OF_SIGHT_EPSILON).toBe(1e-6)
    // Travelling exactly along the x=1 plane reads cell x=1 rather than x=0.
    const probed: Array<number> = []
    const recorder: IsArrowBlockedAt = (wx) => {
      probed.push(wx)
      return false
    }
    shotBlockedByTerrain(recorder, { x: 1, y: 64.5, z: 0 }, { x: 1, y: 64.5, z: 3 })
    expect(probed.every((x) => x === 1)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Knockback — the half that is a rule
// ---------------------------------------------------------------------------

describe('knockbackDirection', () => {
  it('points horizontally away from the attacker, as a unit vector', () => {
    const direction = knockbackDirection(3, 4)
    expect(direction._tag).toBe('Away')
    if (direction._tag === 'Away') {
      expect(direction.x).toBeCloseTo(0.6)
      expect(direction.z).toBeCloseTo(0.8)
      expect(Math.hypot(direction.x, direction.z)).toBeCloseTo(1)
    }
  })

  it('a point-blank hit pops STRAIGHT UP rather than dividing by zero (combat-resolution.ts:113)', () => {
    expect(knockbackDirection(0, 0)).toStrictEqual({ _tag: 'StraightUp' })
  })

  it('DIVERGENCE: a near-zero offset is also straight up, where the reference tests === 0', () => {
    // The reference normalises an offset of a ten-thousandth of a block into a
    // full-strength shove in a direction that is floating-point noise.
    const tiny = KNOCKBACK_EPSILON / 2
    expect(knockbackDirection(tiny, tiny)._tag).toBe('StraightUp')
    expect(knockbackDirection(KNOCKBACK_EPSILON * 10, 0)._tag).toBe('Away')
  })

  it('non-finite offsets pop straight up rather than producing a NaN direction', () => {
    expect(knockbackDirection(Number.NaN, 1)._tag).toBe('StraightUp')
    expect(knockbackDirection(1, Number.POSITIVE_INFINITY)._tag).toBe('StraightUp')
  })

  it('SCALE-INVARIANT under positive factors: docs/responsibility.md §5-1, executable', () => {
    const answers = [1, 0.001, 5, 1e7].map((scale) => knockbackDirection(3 * scale, 4 * scale))
    for (const answer of answers) {
      expect(answer._tag).toBe('Away')
      if (answer._tag === 'Away' && answers[0]?._tag === 'Away') {
        expect(answer.x).toBeCloseTo(answers[0].x)
        expect(answer.z).toBeCloseTo(answers[0].z)
      }
    }
  })

  it('the sign convention is the reference\'s: away from the attacker', () => {
    // `entity.position - camera.position` (`interaction-bow-handler.ts:122-125`),
    // so a target to the +x of the shooter is shoved further +x.
    const direction = knockbackDirection(1, 0)
    expect(direction._tag === 'Away' && direction.x).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

const rosterOf = (
  entities: ReadonlyArray<{ id: string; kind: string; health: number }>,
): EntityRoster<MobBehaviour> => ({
  entities: entities.map((entity) => ({
    id: EntityId(entity.id),
    kind: EntityKind(entity.kind),
    feetPosition: { x: 0, y: 64, z: 0 },
    healthPoints: entity.health,
    behaviour: undefined,
  })),
  nextSerial: entities.length,
})

describe('resolveBowHits', () => {
  it.effect('takes health off the entity that was hit and nobody else', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>(
        rosterOf([
          { id: 'shot', kind: 'creeper', health: 20 },
          { id: 'bystander', kind: 'creeper', health: 20 },
        ]),
      )

      const casualties = yield* resolveBowHits(roster.api, [{ id: EntityId('shot'), damage: 9 }])

      expect(casualties).toStrictEqual([])
      const snapshot = yield* roster.api.snapshot
      expect(snapshot.entities.find((e) => e.id === 'shot')?.healthPoints).toBe(11)
      expect(snapshot.entities.find((e) => e.id === 'bystander')?.healthPoints).toBe(20)
    }),
  )

  it.effect('a lethal hit despawns and reports a casualty', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>(
        rosterOf([{ id: 'doomed', kind: 'creeper', health: 5 }]),
      )

      const casualties = yield* resolveBowHits(roster.api, [{ id: EntityId('doomed'), damage: 9 }])

      expect(casualties).toStrictEqual([
        { id: 'doomed', kind: 'creeper', at: { x: 0, y: 64, z: 0 } },
      ])
      expect((yield* roster.api.snapshot).entities).toStrictEqual([])
    }),
  )

  it.effect('TWO ARROWS IN ONE FRAME BOTH LAND: the damage is summed, not applied twice over', () =>
    Effect.gen(function* () {
      // ONE sweep for every hit, which is `resolveBlasts`' argument: a mob that
      // dies to the first of two shots must still have been reached by the
      // second, or the two orders give different answers.
      const roster = yield* makeEntityManagerDouble<MobBehaviour>(
        rosterOf([{ id: 'target', kind: 'creeper', health: 15 }]),
      )

      const casualties = yield* resolveBowHits(roster.api, [
        { id: EntityId('target'), damage: 9 },
        { id: EntityId('target'), damage: 9 },
      ])

      expect(casualties).toStrictEqual([
        { id: 'target', kind: 'creeper', at: { x: 0, y: 64, z: 0 } },
      ])
      expect((yield* roster.calls).sweeps).toBe(1)
    }),
  )

  it.effect('no hits sweeps nothing at all', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>(
        rosterOf([{ id: 'a', kind: 'creeper', health: 20 }]),
      )

      expect(yield* resolveBowHits(roster.api, [])).toStrictEqual([])
      expect((yield* roster.calls).sweeps).toBe(0)
    }),
  )

  it.effect('a hit for no damage, or for a broken one, sweeps nothing', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>(
        rosterOf([{ id: 'a', kind: 'creeper', health: 20 }]),
      )

      const casualties = yield* resolveBowHits(roster.api, [
        { id: EntityId('a'), damage: 0 },
        { id: EntityId('a'), damage: Number.NaN },
      ])

      expect(casualties).toStrictEqual([])
      expect((yield* roster.calls).sweeps).toBe(0)
      expect((yield* roster.api.snapshot).entities[0]?.healthPoints).toBe(20)
    }),
  )

  it.effect('a hit on an id that is not on the roster changes nothing', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManagerDouble<MobBehaviour>(
        rosterOf([{ id: 'a', kind: 'creeper', health: 20 }]),
      )

      const casualties = yield* resolveBowHits(roster.api, [{ id: EntityId('ghost'), damage: 9 }])

      expect(casualties).toStrictEqual([])
      expect((yield* roster.api.snapshot).entities[0]?.healthPoints).toBe(20)
    }),
  )

  it.effect('IT ARMS THE FLINCH: a shot enderman remembers being hit', () =>
    Effect.gen(function* () {
      // `resolveBlasts`' note said 「a projectile has no producer」 and therefore
      // that a blast was the only blow that could arm the flinch. The bow is
      // that producer. `../mob/enderman-teleport.ts`'s `damaged` branch is now
      // reachable from a weapon.
      const roster = yield* makeEntityManagerDouble<MobBehaviour>({
        entities: [
          {
            id: EntityId('ender'),
            kind: EntityKind('enderman'),
            feetPosition: { x: 0, y: 64, z: 0 },
            healthPoints: 40,
            behaviour: { _tag: 'Steady' },
          },
        ],
        nextSerial: 1,
      })

      yield* resolveBowHits(roster.api, [{ id: EntityId('ender'), damage: 9 }])

      const survivor = (yield* roster.api.snapshot).entities[0]
      expect(survivor?.healthPoints).toBe(31)
      expect(survivor?.behaviour).toStrictEqual({ _tag: 'Struck' })
    }),
  )
})

// ---------------------------------------------------------------------------
// The wiring, through the shipped stages
// ---------------------------------------------------------------------------

/** A frame with the shipped stages over the three doubles and a given roster. */
const scene = (initial: EntityRoster<MobBehaviour>) =>
  Effect.gen(function* () {
    const store = yield* makeChunkStoreDouble(new Map<string, number>(), ['0,0'])
    const roster = yield* makeEntityManagerDouble<MobBehaviour>(initial)
    const player = yield* makePlayerServiceDouble()
    const inventory = yield* makeInventoryDouble()
    const time = yield* makeTimeService()
    const state = yield* makeGameplayFrameState
    return {
      roster,
      state,
      inventory,
      stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api, time),
    }
  })

/** A mob standing dead ahead of `EYE`, at the centre of the crosshair. */
const AHEAD: EntityRoster<MobBehaviour> = {
  entities: [
    {
      id: EntityId('target'),
      kind: EntityKind('creeper'),
      feetPosition: { x: 0, y: 64 - BOW_TARGET_CENTER_Y_OFFSET, z: 10 },
      healthPoints: 20,
      behaviour: undefined,
    },
  ],
  nextSerial: 1,
}

describe('gameplay:interactions — the bow arm', () => {
  it.effect('requestBowShot appends to the public inbox', () =>
    Effect.gen(function* () {
      const { state } = yield* scene(AHEAD)
      const request = {
        origin: EYE,
        dirX: 0,
        dirY: 0,
        dirZ: 1,
        chargeSecs: BOW_FULL_CHARGE_SECS,
      }

      yield* requestBowShot(state, request)

      expect(yield* Ref.get(state.pendingBowShots)).toStrictEqual([request])
    }),
  )

  it.effect('A FULL DRAW REACHES THE ROSTER: nine health points off the mob in the crosshair', () =>
    Effect.gen(function* () {
      // This is the assertion the whole change exists for. The rules were
      // reachable-in-principle before it and unreachable in fact, which
      // docs/testing.md records as a state this repository has repeatedly had
      // to fix.
      const { state, roster, stages } = yield* scene(AHEAD)
      yield* Ref.set(state.pendingBowShots, [
        { origin: EYE, dirX: 0, dirY: 0, dirZ: 1, chargeSecs: BOW_FULL_CHARGE_SECS },
      ])

      yield* runFrame(stages)

      expect((yield* roster.api.snapshot).entities[0]?.healthPoints).toBe(20 - BOW_MAX_DAMAGE)
    }),
  )

  it.effect('A TAP IS NOT A SHOT: a hold below the minimum leaves the roster untouched', () =>
    Effect.gen(function* () {
      const { state, roster, stages } = yield* scene(AHEAD)
      yield* Ref.set(state.pendingBowShots, [
        { origin: EYE, dirX: 0, dirY: 0, dirZ: 1, chargeSecs: BOW_MIN_CHARGE_SECS / 2 },
      ])

      yield* runFrame(stages)

      expect((yield* roster.api.snapshot).entities[0]?.healthPoints).toBe(20)
      expect(yield* Ref.get(state.bowKnockbacks)).toStrictEqual([])
    }),
  )

  it.effect('a partial draw does the quadratic damage, not the full one', () =>
    Effect.gen(function* () {
      const { state, roster, stages } = yield* scene(AHEAD)
      yield* Ref.set(state.pendingBowShots, [
        { origin: EYE, dirX: 0, dirY: 0, dirZ: 1, chargeSecs: BOW_FULL_CHARGE_SECS / 2 },
      ])

      yield* runFrame(stages)

      // charge 0.5 -> 3 damage, and NOT 5.
      expect((yield* roster.api.snapshot).entities[0]?.healthPoints).toBe(17)
    }),
  )

  it.effect('Power on the bow travels from the request to the damage', () =>
    Effect.gen(function* () {
      const { state, roster, stages } = yield* scene(AHEAD)
      yield* Ref.set(state.pendingBowShots, [
        {
          origin: EYE,
          dirX: 0,
          dirY: 0,
          dirZ: 1,
          chargeSecs: BOW_FULL_CHARGE_SECS,
          powerLevel: 1,
        },
      ])

      yield* runFrame(stages)

      // round(9 * 1.5) = 14, so 20 - 14 = 6.
      expect((yield* roster.api.snapshot).entities[0]?.healthPoints).toBe(6)
    }),
  )

  it.effect('a kill puts the mob\'s loot in the drops outbox', () =>
    Effect.gen(function* () {
      const { state, roster, stages } = yield* scene({
        entities: [{ ...AHEAD.entities[0]!, healthPoints: 5 }],
        nextSerial: 1,
      })
      yield* Ref.set(state.pendingBowShots, [
        { origin: EYE, dirX: 0, dirY: 0, dirZ: 1, chargeSecs: BOW_FULL_CHARGE_SECS },
      ])

      yield* runFrame(stages)

      expect((yield* roster.api.snapshot).entities).toStrictEqual([])
      // A creeper's gunpowder goes through the same outbox a blast kill uses.
      expect(yield* Ref.get(state.mobDrops)).not.toStrictEqual([])
    }),
  )

  it.effect('the shove is computed and parked, because nothing here can deliver it', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* scene(AHEAD)
      yield* Ref.set(state.pendingBowShots, [
        { origin: EYE, dirX: 0, dirY: 0, dirZ: 1, chargeSecs: BOW_FULL_CHARGE_SECS },
      ])

      yield* runFrame(stages)

      const shoves = yield* Ref.get(state.bowKnockbacks)
      expect(shoves).toHaveLength(1)
      expect(shoves[0]?.id).toBe('target')
      // Straight ahead of the shooter, so straight away from them on +z.
      expect(shoves[0]?.direction).toStrictEqual({ _tag: 'Away', x: 0, z: 1 })
    }),
  )

  it.effect('a miss changes nothing and parks nothing', () =>
    Effect.gen(function* () {
      const { state, roster, stages } = yield* scene(AHEAD)
      yield* Ref.set(state.pendingBowShots, [
        // Aimed straight up, at nothing.
        { origin: EYE, dirX: 0, dirY: 1, dirZ: 0, chargeSecs: BOW_FULL_CHARGE_SECS },
      ])

      yield* runFrame(stages)

      expect((yield* roster.api.snapshot).entities[0]?.healthPoints).toBe(20)
      expect(yield* Ref.get(state.bowKnockbacks)).toStrictEqual([])
    }),
  )

  it.effect('THE INBOX IS DRAINED, so one shot is serviced once', () =>
    Effect.gen(function* () {
      const { state, roster, stages } = yield* scene(AHEAD)
      yield* Ref.set(state.pendingBowShots, [
        { origin: EYE, dirX: 0, dirY: 0, dirZ: 1, chargeSecs: BOW_FULL_CHARGE_SECS },
      ])

      yield* runFrame(stages)
      yield* runFrame(stages)

      expect(yield* Ref.get(state.pendingBowShots)).toStrictEqual([])
      expect((yield* roster.api.snapshot).entities[0]?.healthPoints).toBe(20 - BOW_MAX_DAMAGE)
    }),
  )

  it.effect('an idle frame parks nothing and leaves the roster alone', () =>
    Effect.gen(function* () {
      const { state, roster, stages } = yield* scene(AHEAD)

      yield* runFrame(stages)

      expect((yield* roster.api.snapshot).entities[0]?.healthPoints).toBe(20)
      expect(yield* Ref.get(state.bowKnockbacks)).toStrictEqual([])
    }),
  )

  it.effect('THE BOW FIRES FOR FREE, and that is the recorded gap rather than a defect', () =>
    Effect.gen(function* () {
      // `BowShotRequest`'s header: consuming an ARROW and damaging the BOW's
      // slot both name items `domain/item-vocabulary.ts` has no word for. The
      // inventory is not touched, and this test says so out loud so that the
      // day the three words arrive it fails and has to be rewritten rather than
      // the gap being discovered by a player with infinite arrows.
      const { state, inventory, stages } = yield* scene(AHEAD)
      yield* Ref.set(state.pendingBowShots, [
        { origin: EYE, dirX: 0, dirY: 0, dirZ: 1, chargeSecs: BOW_FULL_CHARGE_SECS },
      ])

      yield* runFrame(stages)

      expect(yield* inventory.withdrawals).toStrictEqual([])
    }),
  )
})

describe('shotBlockedByTerrain — the walk never oversteps the target', () => {
  it('every sample lies strictly between the endpoints, so no `t >= 1` guard is needed', () => {
    // `shotBlockedByTerrain` deletes the reference's `if (t >= 1) break` on the
    // grounds that `ceil(d / s) - 1 < d / s` for every positive `d`. This is
    // that claim, driven over distances chosen to stress the ceiling: exact
    // multiples of the step, just above one, and just below one.
    for (const distance of [0.05, 0.1, 0.15, 1, 1.0000001, 2.5, 7, 49.9, 50]) {
      const seen: Array<number> = []
      const recorder: IsArrowBlockedAt = (_wx, _wy, wz) => {
        seen.push(wz)
        return false
      }
      shotBlockedByTerrain(recorder, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0.5, y: 64.5, z: distance + 0.5 })
      for (const z of seen) {
        // Floored cell indices, so the last one must be below the target cell.
        expect(z).toBeLessThanOrEqual(Math.floor(distance + 0.5))
      }
    }
  })
})
