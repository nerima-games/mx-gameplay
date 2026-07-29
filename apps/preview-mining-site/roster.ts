/**
 * The preview's mc-sim roster.
 *
 * Mining can now turn inventory overflow into dropped-item entities, so an
 * empty adapter that refuses `spawn` would no longer exercise the shipped
 * frame. Use mc-sim's real in-memory service instead of duplicating it here.
 */
import { makeEntityManager } from '@nerima-games/mc-sim'
import type { Effect } from 'effect'
import type { EntityManagerApi } from '../../domain/entity-manager-port'
import type { MobBehaviour } from '../../domain/entities/mob-frame'

export const makePreviewRoster: Effect.Effect<EntityManagerApi<MobBehaviour>> =
  makeEntityManager<MobBehaviour>()
