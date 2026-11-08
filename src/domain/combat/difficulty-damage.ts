import { DamageAmountSchema } from '@nerima-games/mc-kernel'
import { Result, Schema } from 'effect'
import type { SurvivalDifficulty } from '../survival-hunger.js'

const DifficultySchema = Schema.Literals(['peaceful', 'easy', 'normal', 'hard'])

const DifficultyDamageInputSchema = Schema.Struct({
  amount: DamageAmountSchema,
  difficulty: DifficultySchema,
})

export const DifficultyDamageResultSchema: Schema.ConstraintDecoder<number> = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
)

export type DifficultyDamageError = 'invalid-input' | 'invalid-result'

export const difficultyDamageAmount = (
  amount: number,
  difficulty: SurvivalDifficulty,
): number => {
  if (difficulty === 'peaceful') return 0
  if (difficulty === 'easy') return Math.min(amount, amount / 2 + 1)
  if (difficulty === 'normal') return amount
  return amount * 1.5
}

export const scaleDifficultyDamage = (
  input: unknown,
): Result.Result<number, DifficultyDamageError> => {
  const decoded = Schema.decodeUnknownResult(DifficultyDamageInputSchema, {
    onExcessProperty: 'error',
  })(input)
  if (Result.isFailure(decoded)) return Result.fail('invalid-input')

  const result = Schema.decodeUnknownResult(DifficultyDamageResultSchema)(
    difficultyDamageAmount(decoded.success.amount, decoded.success.difficulty),
  )
  if (Result.isFailure(result)) return Result.fail('invalid-result')
  return Result.succeed(result.success)
}
