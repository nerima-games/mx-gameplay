export type MutableDirection2 = {
  x: number
  z: number
}

export type MutableDirection3 = {
  x: number
  y: number
  z: number
}

export const normalizeDirection2 = (
  x: number,
  z: number,
  output: MutableDirection2,
): MutableDirection2 | undefined => {
  const scale = Math.max(Math.abs(x), Math.abs(z))
  if (scale === 0) return undefined

  const scaledX = x / scale
  const scaledZ = z / scale
  const length = Math.hypot(scaledX, scaledZ)
  output.x = scaledX / length
  output.z = scaledZ / length
  return output
}

export const normalizeDirection3 = (
  x: number,
  y: number,
  z: number,
  output: MutableDirection3,
): MutableDirection3 | undefined => {
  const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
  if (scale === 0) return undefined

  const scaledX = x / scale
  const scaledY = y / scale
  const scaledZ = z / scale
  const length = Math.hypot(scaledX, scaledY, scaledZ)
  output.x = scaledX / length
  output.y = scaledY / length
  output.z = scaledZ / length
  return output
}
