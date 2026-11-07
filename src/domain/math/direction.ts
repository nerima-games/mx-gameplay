import { Schema } from 'effect'

export const DirectionComponentSchema: Schema.brand<typeof Schema.Number, 'DirectionComponent'> =
  Schema.Number.pipe(Schema.brand('DirectionComponent'))

export type DirectionComponent = Schema.Schema.Type<typeof DirectionComponentSchema>

const decodeDirectionComponent = Schema.decodeUnknownSync(DirectionComponentSchema)

export const directionComponent = (value: unknown): DirectionComponent => decodeDirectionComponent(value)

export type MutableDirection2 = {
  x: DirectionComponent
  z: DirectionComponent
}

export type MutableDirection3 = {
  x: DirectionComponent
  y: DirectionComponent
  z: DirectionComponent
}

export const normalizeDirection2 = (
  x: DirectionComponent,
  z: DirectionComponent,
  output: MutableDirection2,
): MutableDirection2 | undefined => {
  const scale = Math.max(Math.abs(x), Math.abs(z))
  if (scale === 0) return undefined

  const scaledX = x / scale
  const scaledZ = z / scale
  const length = Math.hypot(scaledX, scaledZ)
  output.x = directionComponent(scaledX / length)
  output.z = directionComponent(scaledZ / length)
  return output
}

export const normalizeDirection3 = (
  x: DirectionComponent,
  y: DirectionComponent,
  z: DirectionComponent,
  output: MutableDirection3,
): MutableDirection3 | undefined => {
  const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
  if (scale === 0) return undefined

  const scaledX = x / scale
  const scaledY = y / scale
  const scaledZ = z / scale
  const length = Math.hypot(scaledX, scaledY, scaledZ)
  output.x = directionComponent(scaledX / length)
  output.y = directionComponent(scaledY / length)
  output.z = directionComponent(scaledZ / length)
  return output
}
