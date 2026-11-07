import { createHash } from 'node:crypto'

type CanonicalValue = readonly unknown[]

const compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const encode = (value: unknown, ancestors: WeakSet<object>): CanonicalValue => {
  if (value === null) return ['null']

  switch (typeof value) {
    case 'undefined':
      return ['undefined']
    case 'boolean':
      return ['boolean', value]
    case 'string':
      return ['string', value]
    case 'number':
      return [
        'number',
        Number.isNaN(value)
          ? 'NaN'
          : value === Number.POSITIVE_INFINITY
            ? 'Infinity'
            : value === Number.NEGATIVE_INFINITY
              ? '-Infinity'
              : Object.is(value, -0)
                ? '-0'
                : value.toString(),
      ]
    case 'bigint':
      return ['bigint', value.toString()]
    case 'symbol':
    case 'function':
      throw new TypeError('Gameplay state contains a value that cannot be serialized.')
    case 'object':
      break
    default:
      throw new TypeError('Gameplay state contains an unsupported value.')
  }

  if (ancestors.has(value)) {
    throw new TypeError('Gameplay state contains a cycle.')
  }

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return ['array', value.map((entry) => encode(entry, ancestors))]
    }

    if (value instanceof Map) {
      const entries = Array.from(value, ([key, entry]) => [
        encode(key, ancestors),
        encode(entry, ancestors),
      ] as const)
      entries.sort((left, right) => compare(JSON.stringify(left), JSON.stringify(right)))
      return ['map', entries]
    }

    if (value instanceof Set) {
      const entries = Array.from(value, (entry) => encode(entry, ancestors))
      entries.sort((left, right) => compare(JSON.stringify(left), JSON.stringify(right)))
      return ['set', entries]
    }

    if (value instanceof DataView) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      return ['data-view', Array.from(bytes)]
    }

    if (ArrayBuffer.isView(value)) {
      const entries = value as unknown as ArrayLike<unknown>
      return [
        'typed-array',
        value.constructor.name,
        Array.from({ length: entries.length }, (_, index) => encode(entries[index], ancestors)),
      ]
    }

    if (value instanceof ArrayBuffer) {
      return ['array-buffer', Array.from(new Uint8Array(value))]
    }

    if (value instanceof Error) {
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError('Gameplay state contains an unsupported symbol property.')
      }
      const properties = Object.getOwnPropertyNames(value)
        .filter((key) => key !== 'stack')
        .sort(compare)
        .map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, key)
          if (descriptor === undefined || !('value' in descriptor)) {
            throw new TypeError('Gameplay state contains an accessor property.')
          }
          return [key, encode(descriptor.value, ancestors)] as const
        })
      return ['error', value.name, value.message, properties]
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Gameplay state contains an unsupported object type.')
    }

    const record = value as Record<string, unknown>
    if (Object.getOwnPropertySymbols(record).length > 0) {
      throw new TypeError('Gameplay state contains an unsupported symbol property.')
    }
    const properties = Object.getOwnPropertyNames(record)
      .sort(compare)
      .map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(record, key)
        if (descriptor === undefined || !('value' in descriptor)) {
          throw new TypeError('Gameplay state contains an accessor property.')
        }
        return [key, encode(descriptor.value, ancestors)] as const
      })
    return ['object', properties]
  } finally {
    ancestors.delete(value)
  }
}

/**
 * Hash gameplay snapshots with insertion-order-independent Map and Set encoding.
 * Finite floats use JavaScript's shortest round-trippable decimal form; -0,
 * non-finite numbers, and other primitive types receive distinct tags.
 */
export const hashGameplayState = (state: unknown): string => {
  const serialized = JSON.stringify(encode(state, new WeakSet()))
  if (serialized === undefined) {
    throw new TypeError('Gameplay state did not produce a serialized value.')
  }
  return createHash('sha256').update(serialized).digest('hex')
}
