import type { EnchantmentTableRandom } from '@nerima-games/mc-sim'

// Not re-exported from the barrel: the interactions stage and `./enchantment`
// share this generator so both produce the same offers for one seed.

export const normalizeSeed = (seed: number): number =>
  Math.trunc(seed) >>> 0

export const mixSeed = (value: number): number => {
  let mixed = value >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad)
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97)
  return (mixed ^ (mixed >>> 15)) >>> 0
}

export const enchantmentTableRandomForSeed = (seed: number): EnchantmentTableRandom => {
  let state = normalizeSeed(seed)
  const next = (): number => {
    state = mixSeed((state + 0x9e3779b9) >>> 0)
    return state / 0x1_0000_0000
  }

  return {
    nextInt: (bound) => Math.floor(next() * bound),
    nextFloat: next,
  }
}
