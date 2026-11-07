import { BlockAxis, blockPosition } from '@nerima-games/mc-kernel'
import type { Site } from '../preview-mining-site/site.js'

export type SliceAxis = 'xy' | 'xz'

export type SliceRange = {
  readonly minimum: number
  readonly maximum: number
  readonly initial: number
}

const cellExtents = (site: Site) => {
  const cells = site.spec.cells
  const xs = cells.map(([x]) => x)
  const ys = cells.map(([, y]) => y)
  const zChunks = site.world.loadedChunkKeys().map((key) => Number(key.split(',')[1]))
  const minX = Math.min(0, ...xs)
  const maxX = Math.max(site.bounds.width - 1, ...xs)
  const minY = Math.min(0, ...ys)
  const maxY = Math.max(site.bounds.height - 1, ...ys)
  const minZ = zChunks.length > 0 ? Math.min(...zChunks) * 16 : site.spec.z
  const maxZ = zChunks.length > 0 ? (Math.max(...zChunks) + 1) * 16 - 1 : site.spec.z
  return { minX, maxX, minY, maxY, minZ, maxZ }
}

export const sliceRange = (site: Site, axis: SliceAxis): SliceRange => {
  const extents = cellExtents(site)
  return axis === 'xy'
    ? { minimum: extents.minZ, maximum: extents.maxZ, initial: site.spec.z }
    : { minimum: extents.minY, maximum: extents.maxY, initial: Math.min(Math.max(2, extents.minY), extents.maxY) }
}

const blockColor = (block: unknown): string => {
  const text = String(block)
  let hash = 0
  for (const character of text) hash = (hash * 31 + character.charCodeAt(0)) % 360
  return `hsl(${hash} 42% 52%)`
}

export const drawWorldView = (
  canvas: HTMLCanvasElement,
  site: Site,
  axis: SliceAxis,
  layer: number,
): void => {
  const context = canvas.getContext('2d')
  if (context === null) return

  const extents = cellExtents(site)
  const horizontalMin = extents.minX
  const horizontalMax = extents.maxX
  const verticalMin = axis === 'xy' ? extents.minY : extents.minZ
  const verticalMax = axis === 'xy' ? extents.maxY : extents.maxZ
  const columns = horizontalMax - horizontalMin + 1
  const rows = verticalMax - verticalMin + 1
  const cellSize = Math.max(5, Math.min((canvas.width - 56) / columns, (canvas.height - 64) / rows))
  const left = (canvas.width - columns * cellSize) / 2
  const top = (canvas.height - rows * cellSize) / 2

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#0d1117'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.font = '12px system-ui, sans-serif'
  context.fillStyle = '#c9d1d9'
  context.fillText(`${axis.toUpperCase()} slice · ${axis === 'xy' ? 'z' : 'y'} = ${layer}`, 12, 20)

  for (let x = horizontalMin; x <= horizontalMax; x += 1) {
    for (let vertical = verticalMin; vertical <= verticalMax; vertical += 1) {
      const position = axis === 'xy'
        ? blockPosition(BlockAxis(x), BlockAxis(vertical), BlockAxis(layer))
        : blockPosition(BlockAxis(x), BlockAxis(layer), BlockAxis(vertical))
      const cellX = left + (x - horizontalMin) * cellSize
      const cellY = top + (verticalMax - vertical) * cellSize
      context.fillStyle = site.world.isResident(position) ? '#16252a' : '#241b2a'
      context.fillRect(cellX, cellY, cellSize, cellSize)
      const block = site.world.peekBlock(position)
      if (block !== undefined) {
        context.fillStyle = blockColor(block)
        context.fillRect(cellX + 1, cellY + 1, cellSize - 2, cellSize - 2)
        if (cellSize >= 18) {
          context.fillStyle = '#101418'
          context.font = '10px system-ui, sans-serif'
          context.fillText(String(block), cellX + 3, cellY + Math.min(cellSize - 3, 13))
        }
      }
      context.strokeStyle = '#34414a'
      context.strokeRect(cellX, cellY, cellSize, cellSize)
    }
  }

  context.fillStyle = '#8b949e'
  context.font = '11px system-ui, sans-serif'
  context.fillText(`x ${horizontalMin}–${horizontalMax}`, 12, canvas.height - 12)
}
