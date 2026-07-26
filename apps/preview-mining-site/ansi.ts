/**
 * Colour, in the smallest form that does the job.
 *
 * A dev application, not shipped API.
 *
 * ---------------------------------------------------------------------------
 * Why there is no colour library here
 * ---------------------------------------------------------------------------
 *
 * `pnpm check:deps` gates `apps/` exactly like `domain/` (`SCAN_ROOTS`,
 * `scripts/check-dependency-whitelist.ts:262`), and a dependency added for a dev
 * tool is still a dependency in the lockfile that CI installs. Two dozen lines
 * of escape sequences are cheaper than that. mc-worldgen's terrain preview and
 * mx-redstone's circuit board both reached the same conclusion and neither added
 * one either.
 *
 * ---------------------------------------------------------------------------
 * Why colour is threaded rather than read from a global
 * ---------------------------------------------------------------------------
 *
 * `--ascii` exists so a frame can be pasted into an issue or a commit message.
 * A world full of `ESC[38;2;…m` would defeat that entirely, so every renderer
 * here takes a `Style` and `PLAIN_STYLE` turns every call into the identity.
 * That also keeps the renderers pure functions of their arguments, which is what
 * makes `--once` produce byte-identical output for the same world.
 *
 * Adapted from mx-redstone's `apps/preview-circuit-board/ansi.ts`. The two are
 * deliberately separate copies: these are independent repositories, and a shared
 * preview harness would be a cross-repository dependency created for the
 * convenience of dev tooling — exactly the edge `pnpm check:deps` exists to
 * refuse.
 */

export type Rgb = readonly [number, number, number]

/**
 * ESC (0x1B).
 *
 * Built with `String.fromCharCode` rather than written as a literal, so no raw
 * control byte sits in a source file that `grep`, `git diff` and the dependency
 * gate's source masker all have to read.
 */
export const ESC: string = String.fromCharCode(27)

export const RESET = `${ESC}[0m`

const foreground = (color: Rgb): string =>
  `${ESC}[38;2;${String(color[0])};${String(color[1])};${String(color[2])}m`

const background = (color: Rgb): string =>
  `${ESC}[48;2;${String(color[0])};${String(color[1])};${String(color[2])}m`

/**
 * How a renderer emits colour.
 *
 * `cell` exists separately from `paint` because the world is drawn one character
 * at a time and the cursor is drawn as a reversed cell; expressing that as
 * "foreground + background" rather than "text + escape soup" keeps the world
 * renderer readable.
 */
export type Style = {
  readonly paint: (text: string, color: Rgb) => string
  readonly cell: (text: string, color: Rgb, backdrop: Rgb | undefined) => string
  readonly bold: (text: string) => string
  readonly dim: (text: string) => string
}

export const ANSI_STYLE: Style = {
  paint: (text, color) => `${foreground(color)}${text}${RESET}`,
  cell: (text, color, backdrop) =>
    `${backdrop === undefined ? '' : background(backdrop)}${foreground(color)}${text}${RESET}`,
  bold: (text) => `${ESC}[1m${text}${ESC}[22m`,
  dim: (text) => `${ESC}[2m${text}${ESC}[22m`,
}

export const PLAIN_STYLE: Style = {
  paint: (text) => text,
  cell: (text) => text,
  bold: (text) => text,
  dim: (text) => text,
}

/** Interpolate between two colours. Used for the sky ramp on the time screen. */
export const mix = (low: Rgb, high: Rgb, amount: number): Rgb => {
  const t = Math.min(Math.max(amount, 0), 1)
  return [
    Math.round(low[0] + (high[0] - low[0]) * t),
    Math.round(low[1] + (high[1] - low[1]) * t),
    Math.round(low[2] + (high[2] - low[2]) * t),
  ]
}

export const padEnd = (text: string, width: number): string =>
  text.length >= width ? text : text + ' '.repeat(width - text.length)

export const padStart = (text: string, width: number): string =>
  text.length >= width ? text : ' '.repeat(width - text.length) + text
