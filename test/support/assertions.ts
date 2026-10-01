export const defined = <T>(value: T | undefined, name = 'value'): T => {
  if (value === undefined) throw new Error(`${name} was undefined`)
  return value
}

export const errorMessage = (value: unknown): string => {
  if (value instanceof Error) return value.message
  if (typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string') {
    return value.message
  }
  return String(value)
}
