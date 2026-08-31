/**
 * The wither boss encounter: summon detection, cooldown-gated ranged and melee
 * attacks, skull flight and impact, and the save-file round-trip — the layer
 * between mc-sim's per-wither state machine (`createWither`/`stepWither`/
 * `damageWither`, which knows nothing of ids, cooldowns, or a roster of more
 * than one wither) and a host that has to run a whole fight.
 *
 * Lowered from the composing app's `wither-runtime.ts`. Like `../entities/mob-frame.ts`
 * is the join between `../mob/`'s rules and mc-sim's entity roster, this file
 * is the join between mc-sim's wither state machine and the two collections a
 * fight actually needs: the withers themselves, and the skulls in flight
 * between them and their target. Neither collection is mc-sim's to hold — a
 * wither only ever fights one target (`stepWither`'s single `target`
 * parameter), so which target it is aimed at, how many wither there are, and
 * where their skulls currently sit are all this repository's own bookkeeping.
 */
import {
  createWither,
  damageWither,
  matchWitherSummon,
  restoreWither,
  serializeWither,
  stepWither,
  witherSkullProjectile,
  type BlockCell,
  type WitherDamageKind,
  type WitherDeathDescriptor,
  type WitherPhase,
  type WitherSkullProjectileDescriptor,
  type WitherSkullVariant,
  type WitherSnapshot,
  type WitherState,
} from '@nerima-games/mc-sim'
import type { Position } from '@nerima-games/mc-kernel'

export type RuntimeWither = Readonly<{
  id: string
  dimension: string
  state: WitherState
  rangedCooldownSecs: number
  meleeCooldownSecs: number
  shotsFired: number
}>

export type RuntimeWitherSkull = Readonly<{
  id: string
  ownerId: string
  dimension: string
  descriptor: WitherSkullProjectileDescriptor
  position: Position
  ageSecs: number
}>

export type WitherRuntimeState = Readonly<{
  nextWitherId: number
  nextSkullId: number
  withers: ReadonlyArray<RuntimeWither>
  skulls: ReadonlyArray<RuntimeWitherSkull>
}>

/** The save-file shape: `WitherState` replaced by mc-sim's own `serializeWither`/`restoreWither` snapshot. */
export type WitherRuntimeSnapshot = Readonly<{
  nextWitherId: number
  nextSkullId: number
  withers: ReadonlyArray<Readonly<{
    id: string
    dimension: string
    snapshot: WitherSnapshot
    rangedCooldownSecs: number
    meleeCooldownSecs: number
    shotsFired: number
  }>>
  skulls: ReadonlyArray<RuntimeWitherSkull>
}>

export type WitherExplosion = Readonly<{
  position: Position
  power: number
  destroysResistantBlocks: boolean
}>

export type WitherRuntimeAdvance = Readonly<{
  state: WitherRuntimeState
  explosions: ReadonlyArray<WitherExplosion>
  meleeDamage: number
}>

/** How often a wither may launch a skull, once past its charging phase. */
export const WITHER_RANGED_INTERVAL_SECS = 2

/** How often a wither may land its melee hit, once in range. */
export const WITHER_MELEE_INTERVAL_SECS = 1

export const WITHER_MELEE_RANGE = 2.25
export const WITHER_MELEE_DAMAGE = 8

/** A skull that has neither hit a target nor hit the world despawns after this long. */
export const WITHER_SKULL_MAX_AGE_SECS = 12

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactlyKeys = (value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

const isNonNegativeFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value)

const isPosition = (value: unknown): value is Position =>
  isRecord(value)
  && hasExactlyKeys(value, ['x', 'y', 'z'])
  && typeof value['x'] === 'number'
  && Number.isFinite(value['x'])
  && typeof value['y'] === 'number'
  && Number.isFinite(value['y'])
  && typeof value['z'] === 'number'
  && Number.isFinite(value['z'])

const isWitherPhase = (value: unknown): value is WitherPhase =>
  value === 'charging' || value === 'airborne' || value === 'armoured' || value === 'dead'

const isWitherSkullVariant = (value: unknown): value is WitherSkullVariant =>
  value === 'normal' || value === 'blue'

const isWitherSnapshot = (value: unknown): value is WitherSnapshot =>
  isRecord(value)
  && hasExactlyKeys(value, ['kind', 'version', 'state'])
  && value['kind'] === 'wither'
  && value['version'] === 1
  && isRecord(value['state'])
  && hasExactlyKeys(value['state'], ['phase', 'healthPoints', 'chargeRemainingSecs', 'feetPosition', 'velocity'])
  && isWitherPhase(value['state']['phase'])
  && isNonNegativeFiniteNumber(value['state']['healthPoints'])
  && isNonNegativeFiniteNumber(value['state']['chargeRemainingSecs'])
  && isPosition(value['state']['feetPosition'])
  && isPosition(value['state']['velocity'])

const isWitherSkullDescriptor = (value: unknown): value is WitherSkullProjectileDescriptor =>
  isRecord(value)
  && hasExactlyKeys(value, [
    'kind',
    'variant',
    'origin',
    'direction',
    'speed',
    'explosivePower',
    'destroysResistantBlocks',
  ])
  && value['kind'] === 'wither_skull'
  && isWitherSkullVariant(value['variant'])
  && isPosition(value['origin'])
  && isPosition(value['direction'])
  && isNonNegativeFiniteNumber(value['speed'])
  && isNonNegativeFiniteNumber(value['explosivePower'])
  && typeof value['destroysResistantBlocks'] === 'boolean'

const isRuntimeWitherSnapshot = (
  value: unknown,
): value is WitherRuntimeSnapshot['withers'][number] =>
  isRecord(value)
  && hasExactlyKeys(value, [
    'id',
    'dimension',
    'snapshot',
    'rangedCooldownSecs',
    'meleeCooldownSecs',
    'shotsFired',
  ])
  && isIdentifier(value['id'])
  && isIdentifier(value['dimension'])
  && isWitherSnapshot(value['snapshot'])
  && isNonNegativeFiniteNumber(value['rangedCooldownSecs'])
  && isNonNegativeFiniteNumber(value['meleeCooldownSecs'])
  && isNonNegativeSafeInteger(value['shotsFired'])

const isRuntimeWitherSkull = (value: unknown): value is RuntimeWitherSkull =>
  isRecord(value)
  && hasExactlyKeys(value, ['id', 'ownerId', 'dimension', 'descriptor', 'position', 'ageSecs'])
  && isIdentifier(value['id'])
  && isIdentifier(value['ownerId'])
  && isIdentifier(value['dimension'])
  && isWitherSkullDescriptor(value['descriptor'])
  && isPosition(value['position'])
  && isNonNegativeFiniteNumber(value['ageSecs'])

/**
 * Validates a wither runtime's save-file shape before `restoreWitherRuntime`
 * trusts it — exact-keys rather than merely present-keys throughout, so a
 * save produced by a newer version of this file with an extra field fails
 * loudly here rather than silently carrying an unread field forward.
 */
export const isValidWitherRuntimeSnapshot = (value: unknown): value is WitherRuntimeSnapshot =>
  isRecord(value)
  && hasExactlyKeys(value, ['nextWitherId', 'nextSkullId', 'withers', 'skulls'])
  && isNonNegativeSafeInteger(value['nextWitherId'])
  && isNonNegativeSafeInteger(value['nextSkullId'])
  && Array.isArray(value['withers'])
  && value['withers'].every(isRuntimeWitherSnapshot)
  && Array.isArray(value['skulls'])
  && value['skulls'].every(isRuntimeWitherSkull)

export const initialWitherRuntimeState = (): WitherRuntimeState => ({
  nextWitherId: 0,
  nextSkullId: 0,
  withers: [],
  skulls: [],
})

export const summonRuntimeWither = (
  runtime: WitherRuntimeState,
  dimension: string,
  position: Position,
): WitherRuntimeState => {
  const nextWitherId = runtime.nextWitherId + 1
  return {
    ...runtime,
    nextWitherId,
    withers: [...runtime.withers, {
      id: `wither-${String(nextWitherId)}`,
      dimension,
      state: createWither(position),
      rangedCooldownSecs: WITHER_RANGED_INTERVAL_SECS,
      meleeCooldownSecs: WITHER_MELEE_INTERVAL_SECS,
      shotsFired: 0,
    }],
  }
}

/**
 * The wither summon structure (soul sand/soil T, three wither skeleton
 * skulls) may be completed by placing the LAST skull anywhere on the T, so
 * this tries every position the just-placed skull could occupy — one skull
 * on top of a 3-wide base, one skull two blocks below that base at the
 * centre, one block left, one block right, one block toward each horizontal
 * neighbour — rather than assuming it landed at the canonical centre-top
 * position `matchWitherSummon` itself checks.
 */
export const matchRuntimeWitherSummon = (
  placedSkull: BlockCell,
  blockAt: (cell: BlockCell) => string | undefined,
): ReturnType<typeof matchWitherSummon> => {
  for (const base of [
    { x: placedSkull.x, y: placedSkull.y - 2, z: placedSkull.z },
    { x: placedSkull.x - 1, y: placedSkull.y - 2, z: placedSkull.z },
    { x: placedSkull.x + 1, y: placedSkull.y - 2, z: placedSkull.z },
    { x: placedSkull.x, y: placedSkull.y - 2, z: placedSkull.z - 1 },
    { x: placedSkull.x, y: placedSkull.y - 2, z: placedSkull.z + 1 },
  ]) {
    const match = matchWitherSummon(base, blockAt)
    if (match !== undefined) return match
  }
  return undefined
}

export const damageRuntimeWither = (
  runtime: WitherRuntimeState,
  id: string,
  amount: number,
  kind: WitherDamageKind,
): Readonly<{ state: WitherRuntimeState; death: WitherDeathDescriptor | undefined }> => {
  let death: WitherDeathDescriptor | undefined
  const withers = runtime.withers.flatMap((wither) => {
    if (wither.id !== id) return [wither]
    const result = damageWither(wither.state, amount, kind)
    death = result.death
    return result.death === undefined ? [{ ...wither, state: result.state }] : []
  })
  return { state: { ...runtime, withers }, death }
}

const distance = (left: Position, right: Position): number =>
  Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)

/**
 * One frame of every wither in `dimension`: steps mc-sim's state machine,
 * launches a skull when the ranged cooldown expires, lands a melee hit when
 * in range and off cooldown, and advances every skull already in flight —
 * newly-launched skulls included, in the same pass, so a skull launched this
 * frame still travels its own share of the frame's `deltaSecs` rather than
 * waiting a full frame to start moving.
 *
 * COOLDOWNS TICK ONLY WHILE THE WITHER CAN ACT: `stepWither`'s own charging
 * phase already burns real time before the fight starts, and ticking the
 * ranged/melee cooldowns during that same window would let them expire before
 * the wither can use them — so both cooldowns are decremented by
 * `activeDelta`, the portion of this frame spent NOT charging, not by the
 * frame's raw `deltaSecs`.
 */
export const advanceWitherRuntime = (
  runtime: WitherRuntimeState,
  dimension: string,
  target: Position,
  deltaSecs: number,
  skullHitsWorld: (from: RuntimeWitherSkull, to: Position) => boolean,
): WitherRuntimeAdvance => {
  const delta = Math.max(0, Number.isFinite(deltaSecs) ? deltaSecs : 0)
  const explosions: WitherExplosion[] = []
  const withers: RuntimeWither[] = []
  const launched: RuntimeWitherSkull[] = []
  const launchedDelta = new Map<string, number>()
  let nextSkullId = runtime.nextSkullId
  let meleeDamage = 0

  for (const wither of runtime.withers) {
    if (wither.dimension !== dimension) {
      withers.push(wither)
      continue
    }
    const activeDelta = wither.state.phase === 'charging'
      ? Math.max(0, delta - wither.state.chargeRemainingSecs)
      : delta
    const stepped = stepWither(wither.state, delta, target)
    if (stepped.spawnExplosion !== undefined) {
      explosions.push({ ...stepped.spawnExplosion, destroysResistantBlocks: false })
    }
    if (stepped.state.phase === 'charging' || stepped.state.phase === 'dead') {
      withers.push({ ...wither, state: stepped.state })
      continue
    }

    let rangedCooldownSecs = wither.rangedCooldownSecs - activeDelta
    let shotsFired = wither.shotsFired
    if (rangedCooldownSecs <= 0) {
      nextSkullId += 1
      shotsFired += 1
      const descriptor = witherSkullProjectile(
        { ...stepped.state.feetPosition, y: stepped.state.feetPosition.y + 2 },
        { ...target, y: target.y + 0.9 },
        shotsFired % 3 === 0 ? 'blue' : 'normal',
      )
      const skull: RuntimeWitherSkull = {
        id: `wither-skull-${String(nextSkullId)}`,
        ownerId: wither.id,
        dimension,
        descriptor,
        position: descriptor.origin,
        ageSecs: 0,
      }
      launched.push(skull)
      launchedDelta.set(skull.id, activeDelta)
      rangedCooldownSecs = WITHER_RANGED_INTERVAL_SECS
    }

    let meleeCooldownSecs = Math.max(0, wither.meleeCooldownSecs - activeDelta)
    if (meleeCooldownSecs === 0 && distance(stepped.state.feetPosition, target) <= WITHER_MELEE_RANGE) {
      meleeDamage += WITHER_MELEE_DAMAGE
      meleeCooldownSecs = WITHER_MELEE_INTERVAL_SECS
    }
    withers.push({ ...wither, state: stepped.state, rangedCooldownSecs, meleeCooldownSecs, shotsFired })
  }

  const skulls: RuntimeWitherSkull[] = []
  for (const skull of [...runtime.skulls, ...launched]) {
    if (skull.dimension !== dimension) {
      skulls.push(skull)
      continue
    }
    const movementDelta = launchedDelta.get(skull.id) ?? delta
    const position = {
      x: skull.position.x + skull.descriptor.direction.x * skull.descriptor.speed * movementDelta,
      y: skull.position.y + skull.descriptor.direction.y * skull.descriptor.speed * movementDelta,
      z: skull.position.z + skull.descriptor.direction.z * skull.descriptor.speed * movementDelta,
    }
    const ageSecs = skull.ageSecs + movementDelta
    const hitPlayer = distance(position, { ...target, y: target.y + 0.9 }) <= 0.8
    if (hitPlayer || skullHitsWorld(skull, position)) {
      explosions.push({
        position,
        power: skull.descriptor.explosivePower,
        destroysResistantBlocks: skull.descriptor.destroysResistantBlocks,
      })
    } else if (ageSecs < WITHER_SKULL_MAX_AGE_SECS) {
      skulls.push({ ...skull, position, ageSecs })
    }
  }

  return {
    state: { ...runtime, nextSkullId, withers, skulls },
    explosions,
    meleeDamage,
  }
}

export const snapshotWitherRuntime = (runtime: WitherRuntimeState): WitherRuntimeSnapshot => ({
  nextWitherId: runtime.nextWitherId,
  nextSkullId: runtime.nextSkullId,
  withers: runtime.withers.map((wither) => ({
    id: wither.id,
    dimension: wither.dimension,
    snapshot: serializeWither(wither.state),
    rangedCooldownSecs: wither.rangedCooldownSecs,
    meleeCooldownSecs: wither.meleeCooldownSecs,
    shotsFired: wither.shotsFired,
  })),
  skulls: runtime.skulls,
})

export const restoreWitherRuntime = (
  snapshot: WitherRuntimeSnapshot | undefined,
): WitherRuntimeState => snapshot === undefined
  ? initialWitherRuntimeState()
  : {
      nextWitherId: snapshot.nextWitherId,
      nextSkullId: snapshot.nextSkullId,
      withers: snapshot.withers.map((wither) => ({
        id: wither.id,
        dimension: wither.dimension,
        state: restoreWither(wither.snapshot),
        rangedCooldownSecs: wither.rangedCooldownSecs,
        meleeCooldownSecs: wither.meleeCooldownSecs,
        shotsFired: wither.shotsFired,
      })),
      skulls: snapshot.skulls,
    }
