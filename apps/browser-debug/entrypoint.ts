import { Effect } from 'effect'

export const runBrowserDebugEffect = <A, E>(effect: Effect.Effect<A, E>): A =>
  Effect.runSync(effect)
