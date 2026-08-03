import { Brand } from 'effect'

/** Canonical coordinate key for gameplay work queues. */
export type PositionKey = string & Brand.Brand<'GameplayPositionKey'>

export const positionKey = (value: string): PositionKey => value as PositionKey
