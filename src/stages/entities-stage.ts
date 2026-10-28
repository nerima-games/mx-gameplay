import {
  DROPPED_ITEM_PICKUP_RADIUS,
  Effect,
  GAMEPLAY_STAGE_IDS,
  HOSTILE_SPAWN_INTERVAL_SECS,
  NO_ATTEMPTS,
  Ref,
  applyFallingBlocks,
  applySpawnAttempts,
  disturb,
  hostileSpawnsAllowed,
  pickupDroppedItems,
  resolveArmoredPlayerDamages,
  resolveBlasts,
  resolveEndermanTeleportProbes,
  resolveHostileContacts,
  resolvePlayerBlastDamage,
  rollCasualtyDrops,
  rollSelfDestructDrops,
  searchSpawnCandidates,
  settled,
  sweepMobs,
  takeBatch,
} from './registration-core.js'
import type {
  GameplayStageContext,
  MobSpawnAttempt,
  StageRegistration,
} from './registration-core.js'

export const makeEntitiesStage = (context: GameplayStageContext): StageRegistration => {
  const { state, store, roster, inventory, player, time, options } = context
  return {
    id: GAMEPLAY_STAGE_IDS.entities,
    after: [GAMEPLAY_STAGE_IDS.survivalHunger],
    // Entities run after interactions because a mob's reaction is to the world
    // as the player just left it — reversing the two makes a creeper respond to
    // last frame's block placement, which reads as lag rather than as a bug.
    // It is also what lets a block broken this frame start falling this frame.
    //
    // Mob state lives in mc-sim's roster, so this stage sweeps it through
    // `domain/entities/mob-frame.ts` rather than keeping a duplicate local Ref.
    //
    // The order below is the frame's, and the two halves are not independent: a
    // creeper's crater writes blocks, which `disturb`s them, which the
    // falling-block pass then picks up IN THE SAME FRAME. That is the
    // event-driven discipline `domain/falling-block.ts` is about, reached from a
    // new direction — the blast never scans, it reports the cells it actually
    // emptied.
    run: (dt) =>
      Effect.orDie(Effect.gen(function* () {
        if (options.mobSimulation !== false) {
        // ---- mobs ----------------------------------------------------------
        //
        // One sweep: despawn what is out of range, burn every creeper's fuse,
        // plan enderman teleports, resolve their safe landings, collect blasts. A mob this
        // repository has no rule for costs one closure call and a shared object;
        // see `mob-frame.ts` on why the step record is the allocation only this
        // side can remove.
        //
        // THE SEED IS READ BEFORE AND WRITTEN AFTER, which is the one place in
        // this stage that is not a `Ref.modify`, and `mob-frame.ts`'s header
        // argues it rather than assuming it: the sweep is an Effect over the
        // roster, so there is no pure function to hand `Ref.modify`, and the
        // window it opens is one in which two frames would already be sweeping a
        // single roster. The drop roll below stays atomic because it can.
        const targetPosition = (yield* player.pose).feetPosition
        const { attacks, blasts, teleports, seed: sweptSeed } = yield* sweepMobs(
          roster,
          { target: targetPosition, dt },
          yield* Ref.get(state.rollSeed),
        )
        // Unconditional, and cheaper than testing whether it moved: a sweep that
        // drew nothing hands back the seed it was given, so this writes the same
        // number it read on every idle frame.
        yield* Ref.set(state.rollSeed, sweptSeed)

        if (teleports.length > 0) {
          yield* resolveEndermanTeleportProbes(roster, store, teleports)
        }

        if (attacks.length > 0) {
          // No `playerDamages.length > 0` guard: `resolveArmoredPlayerDamages`
          // is `Effect.forEach` over its input with no filtering (unlike the
          // blast path below, which filters through `resolvePlayerBlastDamage`
          // first), so its output is always the same length as `attacks`,
          // which this `if` has already proven non-empty.
          const playerDamages = yield* resolveArmoredPlayerDamages(
            inventory,
            attacks.map((attack) => ({
              _tag: 'HostileContact' as const,
              source: attack.source,
              kind: attack.attackerKind,
              at: attack.at,
              damage: { amount: attack.damage, cause: 'mob' as const },
            })),
          )
          yield* Ref.update(state.playerDamages, (items) => [...items, ...playerDamages])
        }

        if (blasts.length > 0) {
          const { casualties, disturbed } = yield* resolveBlasts(roster, store, blasts)

          // Creeper drop behavior is defined by `domain/mob/mob-drop.ts`.
          // No `playerDamages.length > 0` guard: every `Blast` in `blasts`
          // comes from THIS stage's own creeper self-detonation in `sweepMobs`,
          // gated by `stepCreeperFuse`'s `withinIgnitionRange`
          // (`domain/mob/creeper-fuse.ts`) on both the `Lit` and the
          // detonating step — so `blast.at` is always within
          // `CREEPER_IGNITION_RANGE_BLOCKS` (3) of `targetPosition`, the same
          // 3D `distanceBetween` metric `resolvePlayerBlastDamage` measures
          // against. The smallest explosion radius this rule produces
          // (`explosionRadius(CREEPER_EXPLOSION_POWER)`, power 3) is 6 blocks
          // — strictly larger than the 3-block ignition gate — so the player
          // is always inside blast range when a creeper the sweep itself lit
          // detonates. `resolvePlayerBlastDamage`'s own filter can return
          // empty (its unit test proves it, for a blast built independently
          // of any ignition gate); this call site can never hand it one.
          const playerDamages = yield* resolveArmoredPlayerDamages(
            inventory,
            resolvePlayerBlastDamage(blasts, targetPosition),
          )
          yield* Ref.update(state.playerDamages, (items) => [...items, ...playerDamages])

          const selfDestruct = blasts.flatMap(rollSelfDestructDrops)

          // `Ref.modify`, so the seed is read, advanced and written in one step.
          // A split read/write here would let two frames draw the same rolls,
          // which is worse than a non-deterministic generator: it is a
          // deterministic wrong one.
          const drops = yield* Ref.modify(state.rollSeed, (seed) => {
            const rolled = rollCasualtyDrops(casualties, seed)
            return [rolled.drops, rolled.seed] as const
          })

          if (selfDestruct.length > 0 || drops.length > 0) {
            yield* Ref.update(state.mobDrops, (items) => [...items, ...selfDestruct, ...drops])
          }

          // THE ONLY WAY BLOCK WORK ENTERS FROM A BLAST. `disturbed` holds the
          // cells whose write came back `Written` and nothing else, so a blast
          // in open sky enqueues nothing — the same rule the interactions stage
          // applies to a break that changed nothing.
          if (disturbed.length > 0) {
            yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, disturbed))
          }
        }

        if (options.droppedItemPickup !== false) {
        yield* pickupDroppedItems(
          roster,
          inventory,
          targetPosition,
          DROPPED_ITEM_PICKUP_RADIUS,
          yield* Ref.get(state.tickCount),
        )
        }

        const contact = resolveHostileContacts(
          yield* roster.entities,
          targetPosition,
          dt,
          yield* Ref.get(state.hostileContactCooldowns),
        )
        yield* Ref.set(state.hostileContactCooldowns, contact.cooldowns)
        if (contact.damages.length > 0) {
          const playerDamages = yield* resolveArmoredPlayerDamages(inventory, contact.damages)
          yield* Ref.update(state.playerDamages, (items) => [...items, ...playerDamages])
        }

        // ---- the spawn search ----------------------------------------------
        //
        // ON A CADENCE, NOT EVERY FRAME. `domain/entities/mob-spawn-search.ts`
        // makes 256 store calls for a full ring — three blocks and a light per
        // cell — and `@nerima-games/mc-worldgen` records that a light read
        // after a block write may relight a whole chunk. Running that at 20 Hz
        // is DN-GP-1 rebuilt: work proportional to the world on every frame
        // whether or not anything changed. The reference paces its spawner at
        // `SPAWN_INTERVAL_SECS = 0.3` for the same reason and this is that
        // number.
        //
        // `Ref.modify` so the accumulator is read, advanced and written in one
        // step. It SUBTRACTS the interval rather than resetting to zero, so a
        // long frame does not silently lose the remainder and the cadence stays
        // 0.3s on average rather than 0.3s-or-more.
        const searchDue = yield* Ref.modify(state.spawnClockSecs, (elapsed) => {
          const next = elapsed + dt
          return next >= HOSTILE_SPAWN_INTERVAL_SECS
            ? ([true, next - HOSTILE_SPAWN_INTERVAL_SECS] as const)
            : ([false, next] as const)
        })

        // `getAndSet` rather than get-then-set, for `pendingBreaks`' reason: a
        // candidate offered between the two steps would be dropped silently.
        const offered = yield* Ref.getAndSet<ReadonlyArray<MobSpawnAttempt>>(
          state.spawnAttempts,
          [],
        )

        let searched: ReadonlyArray<MobSpawnAttempt> = NO_ATTEMPTS
        const hour = yield* time.timeOfDay
        const dimension = yield* player.dimension

        // Reuse the time rule from `canHostileSpawnAt` to skip searches whose
        // hostile candidates would all be rejected. Empty rosters still search
        // for passive repopulation; the Nether bypasses this time gate.
        const hostileSearch = dimension === 'nether' || hostileSpawnsAllowed(hour)
        const passiveRepopulationSearch = !hostileSearch && (yield* roster.count) === 0
        if (searchDue && (hostileSearch || passiveRepopulationSearch)) {
          const found = yield* searchSpawnCandidates(
            store,
            targetPosition,
            hour,
            yield* Ref.get(state.rollSeed),
            dimension,
          )
          // The seed advanced by exactly `SPAWN_SEARCH_ROLLS`, and only because a
          // search ran. A frame that skipped it leaves the generator where it
          // found it, which is `domain/frame-rolls.ts`'s rule that the sequence
          // depends on what happened rather than on how many frames passed.
          // Daylight repopulation must not perturb the shared combat/weather
          // sequence. Once it succeeds the non-empty roster gates it off.
          if (hostileSearch) yield* Ref.set(state.rollSeed, found.seed)
          searched = found.attempts
        }

        // Concatenated rather than run as two passes, so that the population cap
        // sees ONE stream of candidates. Two passes would each apply the cap
        // against a census taken inside their own loop, and a frame holding one
        // offered cell and a full ring could spawn one more mob than
        // `MAX_HOSTILE_COUNT` allows.
        const attempts =
          searched.length === 0 ? offered : offered.length === 0 ? searched : [...offered, ...searched]

        if (attempts.length > 0) {
          // `run` returns void, so refusal details from these attempts are not
          // reported to a caller.
          yield* Effect.orDie(applySpawnAttempts(roster, attempts))
        }
        }

        // ---- falling blocks ------------------------------------------------
        //
        // `Ref.modify` rather than get-then-set: plan.md §3.8 lists TOCTOU on a
        // Ref among the reference's recurring Effect-level mistakes.
        // Read-modify-write as two steps is a race the moment anything else
        // forks — and something else always does, because `disturb` is called
        // by every rule that writes a block, including the crater above.
        const batch = yield* Ref.modify(state.fallingBlocks, (queue) => {
          const { batch: taken, rest } = takeBatch(queue)
          return [taken, rest] as const
        })

        // An idle tick stops HERE, without touching the store. This is the
        // whole of DN-GP-1: the reference implementation read ~7M blocks at
        // this point whether or not anything had moved. The mob half above is
        // held to the same standard by the same test — an idle frame's sweep
        // returns the roster it was given, hands every mob the SAME step object,
        // and makes no store call at all.
        if (batch.length === 0) {
          return
        }

        const { destinations } = yield* applyFallingBlocks(store, batch)

        // `update`, not `set`: the store writes above may have caused other
        // rules to disturb positions while this tick was running, and a `set`
        // would erase them.
        if (destinations.length > 0) {
          yield* Ref.update(state.fallingBlocks, (queue) => settled(queue, destinations))
        }
      })),
  }
}
