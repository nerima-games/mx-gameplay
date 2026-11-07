import type { Weather } from '../../src/domain/weather.js'

export const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4] as const
export type PlaybackSpeed = (typeof SPEED_OPTIONS)[number]

export type BrowserDebugState = {
  scenarioId: string | null
  play: boolean
  speed: PlaybackSpeed
  panel: boolean
  seed: number
  frame: number
  time: number
  weather: Weather
}

export type UrlIssue = {
  readonly key: string
  readonly replacement: string
}

export type ParsedUrlState = {
  readonly state: BrowserDebugState
  readonly issues: ReadonlyArray<UrlIssue>
}

const DEFAULTS = {
  play: false,
  speed: 1,
  panel: true,
  seed: 1,
  frame: 0,
  time: 6000,
  weather: 'clear',
} satisfies Omit<BrowserDebugState, 'scenarioId'>

const MAX_SEED = 4_294_967_295
export const MAX_FRAME = 100_000
const MAX_TIME = 23_999

const parseInteger = (raw: string, minimum: number, maximum: number): number | undefined => {
  if (!/^(0|[1-9]\d*)$/.test(raw)) {
    return undefined
  }
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : undefined
}

export const parseUrlState = (
  search: string,
  scenarioIds: ReadonlyArray<string>,
  defaultScenarioId: string,
): ParsedUrlState => {
  const params = new URLSearchParams(search)
  const issues: UrlIssue[] = []
  const scenarioSet = new Set(scenarioIds)

  const scalar = (key: string, fallback: string): string | undefined => {
    const values = params.getAll(key)
    if (values.length === 0) {
      return undefined
    }
    if (values.length !== 1) {
      issues.push({ key, replacement: fallback })
      return undefined
    }
    return values[0]
  }

  const parseValue = <T>(
    key: string,
    fallback: T,
    fallbackLabel: string,
    parse: (raw: string) => T | undefined,
  ): T => {
    const raw = scalar(key, fallbackLabel)
    if (raw === undefined) {
      return fallback
    }
    const parsed = parse(raw)
    if (parsed === undefined) {
      issues.push({ key, replacement: fallbackLabel })
      return fallback
    }
    return parsed
  }

  const scenarioValues = params.getAll('scenario')
  let scenarioId: string | null = defaultScenarioId
  if (scenarioValues.length > 1) {
    scenarioId = null
    issues.push({ key: 'scenario', replacement: 'stopped (no scenario selected)' })
  } else if (scenarioValues.length === 1) {
    const candidate = scenarioValues[0]
    if (candidate !== undefined && scenarioSet.has(candidate)) {
      scenarioId = candidate
    } else {
      scenarioId = null
      issues.push({ key: 'scenario', replacement: 'stopped (no scenario selected)' })
    }
  }

  const play = parseValue('play', DEFAULTS.play, '0', (raw) => {
    if (raw === '0') return false
    if (raw === '1') return true
    return undefined
  })
  const speed = parseValue('speed', DEFAULTS.speed, String(DEFAULTS.speed), (raw) => {
    return SPEED_OPTIONS.find((option) => String(option) === raw)
  })
  const panel = parseValue('panel', DEFAULTS.panel, '1', (raw) => {
    if (raw === '0') return false
    if (raw === '1') return true
    return undefined
  })
  const seed = parseValue('seed', DEFAULTS.seed, String(DEFAULTS.seed), (raw) =>
    parseInteger(raw, 0, MAX_SEED),
  )
  const frame = parseValue('frame', DEFAULTS.frame, String(DEFAULTS.frame), (raw) =>
    parseInteger(raw, 0, MAX_FRAME),
  )
  const time = parseValue('time', DEFAULTS.time, String(DEFAULTS.time), (raw) =>
    parseInteger(raw, 0, MAX_TIME),
  )
  const weather = parseValue('weather', DEFAULTS.weather, DEFAULTS.weather, (raw): Weather | undefined =>
    raw === 'clear' || raw === 'rain' || raw === 'thunder' ? raw : undefined,
  )

  const knownKeys = new Set(['scenario', 'play', 'speed', 'panel', 'seed', 'frame', 'time', 'weather'])
  for (const key of new Set(params.keys())) {
    if (!knownKeys.has(key)) {
      issues.push({ key, replacement: 'ignored' })
    }
  }

  return {
    state: { scenarioId, play, speed, panel, seed, frame, time, weather },
    issues,
  }
}

export const serializeUrlState = (state: BrowserDebugState): string => {
  const params = new URLSearchParams()
  if (state.scenarioId !== null) params.set('scenario', state.scenarioId)
  params.set('play', state.play ? '1' : '0')
  params.set('speed', String(state.speed))
  params.set('panel', state.panel ? '1' : '0')
  params.set('seed', String(state.seed))
  params.set('frame', String(state.frame))
  params.set('time', String(state.time))
  params.set('weather', state.weather)
  return `?${params.toString()}`
}
