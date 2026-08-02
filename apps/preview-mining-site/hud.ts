/**
 * The status lines under the picture, and the help overlay.
 *
 * A dev application, not shipped API.
 *
 * `HUD_ROWS` is exported because the frame budget has to be computed before the
 * HUD is rendered, and a hard-coded 5 in two places is how a preview ends up
 * scrolling by one line on every keystroke.
 */
import { padEnd, type Style } from './ansi'
import { USAGE } from './options'
import type { ScreenName, ViewMode } from './render'
import { describeTool, type Site } from './site'
import { BLOCKS, glyphOf, type Glyph } from './world'
import type { BlockId } from '../../src/domain/chunk-store-port'

export const HUD_ROWS = 5

export type HudState = {
  readonly screen: ScreenName
  readonly view: ViewMode
  readonly cursor: { readonly x: number; readonly y: number }
  readonly palette: BlockId
  readonly runFrames: number
  readonly clipped: boolean
}

/**
 * `cobblestone x3, sand x2` — the host's stacks.
 *
 * IT NAMES ITEMS AND NOT BLOCKS NOW, and that difference is the whole of what
 * `domain/interactions/block-loot.ts` changed on this screen. This function used
 * to take `ReadonlyArray<BlockId>` and run each id through `glyphOf`, which is
 * how a HUD ends up printing "stone" for a swing that in vanilla yields
 * cobblestone: the id WAS the item. Now the keys are `ItemType` strings that
 * came out of kernel's drop table, so mining stone with a pickaxe prints
 * `cobblestone` and mining it bare-handed prints nothing at all.
 *
 * Zero-count stacks are hidden because the inventory service is authoritative;
 * placement reserves an item before changing the world and cannot make a stack
 * negative.
 */
const summariseInventory = (inventory: ReadonlyMap<string, number>): string => {
  const stacks = [...inventory.entries()].filter(([, count]) => count !== 0)

  return stacks.length === 0
    ? '(empty)'
    : stacks.map(([item, count]) => `${item} x${String(count)}`).join(', ')
}

export const buildHud = (hud: HudState, site: Site, style: Style): ReadonlyArray<string> => {
  const calls = site.world.calls()
  const palette: Glyph = glyphOf(hud.palette)

  return [
    style.dim('-'.repeat(72)),
    [
      style.bold(`frame ${padEnd(String(site.frame), 5)}`),
      `screen ${padEnd(hud.screen, 7)}`,
      `view ${padEnd(hud.view, 10)}`,
      `cursor ${padEnd(`${String(hud.cursor.x)},${String(hud.cursor.y)},${String(site.spec.z)}`, 12)}`,
      // "hold" and not "poke": the palette is what `p` PLACES now, through the
      // rule, and `e` is the only key left that writes the store directly.
      `hold ${padEnd(palette.name, 8)}`,
      `n=${String(hud.runFrames)}`,
    ].join(' '),
    [
      `last frame: reads ${padEnd(String(calls.reads), 5)}`,
      `writes ${padEnd(String(calls.writes), 5)}`,
      `resident ${padEnd(site.world.loadedChunkKeys().join(' '), 12)}`,
      `inventory ${summariseInventory(site.inventory)}`,
    ].join(' '),
    style.dim(`scenario ${padEnd(site.scenario, 16)}holding ${describeTool(site.tool)}`),
    site.note === '' ? style.dim('?  help') : style.paint(site.note, [226, 202, 130]),
    ...(hud.clipped
      ? [style.paint('the world is wider or taller than this window — resize, or use --width/--height', [235, 160, 90])]
      : []),
  ].slice(0, HUD_ROWS + (hud.clipped ? 1 : 0))
}

export const buildHelp = (style: Style): ReadonlyArray<string> =>
  [style.bold('preview-mining-site'), '', ...USAGE, '', style.dim('any key returns')]

export const buildNotes = (
  style: Style,
  notes: ReadonlyArray<string>,
  title: string,
): ReadonlyArray<string> => [style.bold(title), ...notes.map((note) => style.dim(`  · ${note}`))]

/** The palette legend, printed once by `--once` so a pasted frame is readable. */
export const buildLegend = (style: Style): string =>
  style.dim(
    'legend  ' +
      BLOCKS.map((entry) => `${entry.glyph}=${entry.name}`).join('  ') +
      '  /=chunk not loaded  (shaded cell = in the falling-block queue)',
  )
