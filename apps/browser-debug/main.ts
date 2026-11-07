import { createPlayback, type PlaybackController, type PlaybackState } from './playback.js'
import { DEFAULT_SCENARIO_ID, SCENARIOS, scenarioById } from './scenario-registry.js'
import { createStatePanel, type StatePanel } from './state-panel.js'
import { MAX_FRAME, parseUrlState, serializeUrlState, SPEED_OPTIONS, type BrowserDebugState, type UrlIssue } from './url-state.js'
import { drawWorldView, sliceRange, type SliceAxis } from './world-view.js'
import type { ScenarioAction, ScenarioDefinition, ScenarioMount } from './contract.js'

const app = document.querySelector<HTMLElement>('#app')
if (app === null) throw new Error('browser-debug: missing #app root')

app.innerHTML = `
  <header class="app-header">
    <div>
      <p class="eyebrow">mx-gameplay</p>
      <h1>Browser Debug</h1>
    </div>
    <p id="run-status" role="status" aria-live="polite"></p>
  </header>
  <section class="toolbar" aria-label="Scenario controls">
    <label>Scenario<select id="scenario-select"></select></label>
    <div class="playback-controls" aria-label="Playback">
      <button id="pause-button" type="button">Pause</button>
      <button id="step-button" type="button">Step frame</button>
      <button id="play-button" type="button">Play</button>
      <label>Speed<select id="speed-select"></select></label>
      <button id="reset-button" type="button">Reset</button>
    </div>
    <label>Seed<input id="seed-input" type="number" min="0" step="1"></label>
    <label>Frame<input id="frame-input" type="number" min="0" step="1"></label>
    <button id="frame-button" type="button">Go to frame</button>
    <label>Time<input id="time-input" type="range" min="0" max="23999" step="1"></label>
    <output id="time-output" for="time-input"></output>
    <label>Weather<select id="weather-select">
      <option value="clear">clear</option>
      <option value="rain">rain</option>
      <option value="thunder">thunder</option>
    </select></label>
    <label class="panel-toggle"><input id="panel-input" type="checkbox"> State panel</label>
  </section>
  <div id="url-alert" class="url-alert" role="alert" aria-live="assertive" hidden></div>
  <main class="debug-layout">
    <section class="world-column" aria-label="World view">
      <div class="world-toolbar">
        <label>Slice<select id="slice-select">
          <option value="xy">XY</option>
          <option value="xz">XZ</option>
        </select></label>
        <label>Layer<input id="layer-input" type="range" min="0" max="0" step="1"></label>
        <output id="layer-output" for="layer-input"></output>
        <span class="world-legend"><span class="loaded-swatch"></span> loaded <span class="unloaded-swatch"></span> unloaded</span>
      </div>
      <canvas id="world-canvas" width="960" height="560" aria-label="Two dimensional world slice"></canvas>
      <div id="scenario-root" class="scenario-root"></div>
      <div id="scenario-actions" class="scenario-actions" aria-label="Scenario actions"></div>
    </section>
    <div id="state-panel-host"></div>
  </main>
`

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`browser-debug: missing #${id}`)
  return node as T
}

const scenarioSelect = byId<HTMLSelectElement>('scenario-select')
const pauseButton = byId<HTMLButtonElement>('pause-button')
const stepButton = byId<HTMLButtonElement>('step-button')
const playButton = byId<HTMLButtonElement>('play-button')
const speedSelect = byId<HTMLSelectElement>('speed-select')
const resetButton = byId<HTMLButtonElement>('reset-button')
const seedInput = byId<HTMLInputElement>('seed-input')
const frameInput = byId<HTMLInputElement>('frame-input')
const frameButton = byId<HTMLButtonElement>('frame-button')
const timeInput = byId<HTMLInputElement>('time-input')
const timeOutput = byId<HTMLOutputElement>('time-output')
const weatherSelect = byId<HTMLSelectElement>('weather-select')
const panelInput = byId<HTMLInputElement>('panel-input')
const urlAlert = byId<HTMLDivElement>('url-alert')
const runStatus = byId<HTMLParagraphElement>('run-status')
const sliceSelect = byId<HTMLSelectElement>('slice-select')
const layerInput = byId<HTMLInputElement>('layer-input')
const layerOutput = byId<HTMLOutputElement>('layer-output')
const canvas = byId<HTMLCanvasElement>('world-canvas')
const scenarioRoot = byId<HTMLDivElement>('scenario-root')
const actionRoot = byId<HTMLDivElement>('scenario-actions')
const panelHost = byId<HTMLDivElement>('state-panel-host')

const scenarioOptions = document.createDocumentFragment()
for (const scenario of SCENARIOS) {
  const option = document.createElement('option')
  option.value = scenario.id
  option.textContent = scenario.title
  scenarioOptions.append(option)
}
scenarioSelect.append(scenarioOptions)
for (const speed of SPEED_OPTIONS) {
  const option = document.createElement('option')
  option.value = String(speed)
  option.textContent = `${String(speed)}×`
  speedSelect.append(option)
}

const parsed = parseUrlState(
  window.location.search,
  SCENARIOS.map((scenario) => scenario.id),
  DEFAULT_SCENARIO_ID,
)
const state: BrowserDebugState = { ...parsed.state }
let currentIssues: UrlIssue[] = [...parsed.issues]
let activeScenario = state.scenarioId === null ? undefined : scenarioById(state.scenarioId)
let mountedScenario: ScenarioMount | undefined
let playback: PlaybackController | undefined
let statePanel: StatePanel | undefined
let sliceAxis: SliceAxis = 'xy'
let sliceLayer = 0
let timeInputDirty = false
let actionHandlers: ReadonlyArray<{ button: HTMLButtonElement; listener: EventListener }> = []

const scenarioPlaceholder = document.createElement('option')
scenarioPlaceholder.value = ''
scenarioPlaceholder.textContent = state.scenarioId === null ? 'Invalid scenario (stopped)' : 'Choose scenario'
scenarioSelect.prepend(scenarioPlaceholder)

const updateAlert = (): void => {
  if (currentIssues.length === 0) {
    urlAlert.hidden = true
    urlAlert.replaceChildren()
    return
  }
  urlAlert.hidden = false
  urlAlert.replaceChildren()
  const title = document.createElement('strong')
  title.textContent = 'URL values were adjusted:'
  const list = document.createElement('ul')
  for (const issue of currentIssues) {
    const item = document.createElement('li')
    item.textContent = `${issue.key} → ${issue.replacement}`
    list.append(item)
  }
  urlAlert.append(title, list)
}

const updateUrl = (): void => {
  if (state.scenarioId === null) return
  const query = serializeUrlState(state)
  window.history.replaceState(null, '', `${window.location.pathname}${query}${window.location.hash}`)
}

const renderPlaybackControls = (playbackState: PlaybackState): void => {
  state.play = playbackState.playing
  state.speed = playbackState.speed
  pauseButton.disabled = !playbackState.playing
  playButton.disabled = playbackState.playing || state.frame >= MAX_FRAME
  stepButton.disabled = mountedScenario === undefined || state.frame >= MAX_FRAME
  resetButton.disabled = mountedScenario === undefined
  speedSelect.disabled = mountedScenario === undefined
  frameButton.disabled = mountedScenario === undefined
  frameInput.disabled = mountedScenario === undefined
  seedInput.disabled = mountedScenario === undefined
  timeInput.disabled = mountedScenario === undefined
  weatherSelect.disabled = mountedScenario === undefined
  updateUrl()
}

const render = (): void => {
  panelInput.checked = state.panel
  panelHost.hidden = !state.panel
  scenarioSelect.value = state.scenarioId ?? ''
  speedSelect.value = String(state.speed)
  seedInput.value = String(state.seed)
  frameInput.value = String(state.frame)
  if (!timeInputDirty) {
    timeInput.value = String(state.time)
    timeOutput.value = String(state.time)
  }
  weatherSelect.value = state.weather

  const hasScenario = mountedScenario !== undefined
  runStatus.textContent = activeScenario === undefined
    ? 'No scenario is running. Choose a valid scenario to start.'
    : `${activeScenario.title} · logical frame ${String(state.frame)}${state.frame >= MAX_FRAME ? ' · frame limit reached' : ''}`
  if (mountedScenario !== undefined) {
    const snapshot = mountedScenario.snapshot()
    if (!timeInputDirty) {
      timeInput.value = String(snapshot.timeOfDay)
      timeOutput.value = String(snapshot.timeOfDay)
    }
    weatherSelect.value = snapshot.weather
    drawWorldView(canvas, mountedScenario.site, sliceAxis, sliceLayer)
    statePanel?.render(snapshot)
  } else {
    const context = canvas.getContext('2d')
    context?.clearRect(0, 0, canvas.width, canvas.height)
    statePanel?.element.replaceChildren()
  }
  stepButton.disabled = !hasScenario || state.frame >= MAX_FRAME
  resetButton.disabled = !hasScenario
  frameButton.disabled = !hasScenario
  frameInput.disabled = !hasScenario
  seedInput.disabled = !hasScenario
  timeInput.disabled = !hasScenario
  weatherSelect.disabled = !hasScenario
  speedSelect.disabled = !hasScenario
  pauseButton.disabled = !hasScenario || state.play === false
  playButton.disabled = !hasScenario || state.play || state.frame >= MAX_FRAME
  updateUrl()
}

const clearActions = (): void => {
  for (const { button, listener } of actionHandlers) button.removeEventListener('click', listener)
  actionHandlers = []
  actionRoot.replaceChildren()
}

const actionListener = (action: ScenarioAction): EventListener => () => {
  if (mountedScenario === undefined) return
  action.perform(mountedScenario.site)
  render()
}

const renderActions = (): void => {
  clearActions()
  if (mountedScenario === undefined) return
  for (const action of mountedScenario.actions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = action.label
    const listener = actionListener(action)
    button.addEventListener('click', listener)
    actionRoot.append(button)
    actionHandlers = [...actionHandlers, { button, listener }]
  }
}

const setupSliceControl = (): void => {
  if (mountedScenario === undefined) return
  const range = sliceRange(mountedScenario.site, sliceAxis)
  layerInput.min = String(range.minimum)
  layerInput.max = String(range.maximum)
  sliceLayer = range.initial
  layerInput.value = String(sliceLayer)
  layerOutput.value = String(sliceLayer)
}

const disposeMountedScenario = (): void => {
  clearActions()
  mountedScenario?.dispose()
  mountedScenario = undefined
  scenarioRoot.replaceChildren()
}

const mountScenario = (scenario: ScenarioDefinition, targetFrame: number): void => {
  disposeMountedScenario()
  const root = document.createElement('div')
  scenarioRoot.append(root)
  mountedScenario = scenario.mount({
    root,
    scenarioId: scenario.id,
    seed: state.seed,
    time: state.time,
    weather: state.weather,
  })
  setupSliceControl()
  renderActions()
  for (let frame = 0; frame < targetFrame; frame += 1) mountedScenario.advance()
  state.frame = targetFrame
}

const installPlayback = (playing: boolean): void => {
  if (mountedScenario === undefined) {
    playback = undefined
    state.play = false
    return
  }
  state.play = playing
  playback = createPlayback({
    advance: () => {
      if (mountedScenario === undefined || state.frame >= MAX_FRAME) return false
      mountedScenario.advance()
      state.frame += 1
      return true
    },
    render,
    reset: () => {
      if (activeScenario === undefined) return
      mountScenario(activeScenario, 0)
      state.frame = 0
      state.play = false
      updateUrl()
    },
    stateChanged: renderPlaybackControls,
  }, { playing, speed: state.speed })
}

const restartScenario = (scenario: ScenarioDefinition, targetFrame: number, playing: boolean): void => {
  playback?.dispose()
  activeScenario = scenario
  state.scenarioId = scenario.id
  state.play = false
  mountScenario(scenario, targetFrame)
  installPlayback(playing)
  render()
  updateUrl()
}

const reportInputIssue = (key: string, replacement: string): void => {
  currentIssues = [...currentIssues, { key, replacement }]
  updateAlert()
}

const readBoundedInteger = (
  input: HTMLInputElement,
  minimum: number,
  maximum: number,
  key: string,
  fallback: number,
): number | undefined => {
  const value = Number(input.value)
  if (!/^(0|[1-9]\d*)$/.test(input.value) || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    input.value = String(fallback)
    reportInputIssue(key, String(fallback))
    return undefined
  }
  return value
}

scenarioSelect.addEventListener('change', () => {
  const scenario = scenarioById(scenarioSelect.value)
  if (scenario === undefined) return
  state.frame = 0
  restartScenario(scenario, 0, false)
})
pauseButton.addEventListener('click', () => playback?.pause())
stepButton.addEventListener('click', () => {
  playback?.stepFrame()
  updateUrl()
})
playButton.addEventListener('click', () => playback?.play())
speedSelect.addEventListener('change', () => {
  const speed = SPEED_OPTIONS.find((option) => String(option) === speedSelect.value)
  if (speed === undefined) {
    speedSelect.value = String(state.speed)
    reportInputIssue('speed', '1')
    return
  }
  playback?.setSpeed(speed)
})
resetButton.addEventListener('click', () => playback?.reset())
seedInput.addEventListener('change', () => {
  const seed = readBoundedInteger(seedInput, 0, 4_294_967_295, 'seed', state.seed)
  if (seed === undefined || activeScenario === undefined) return
  state.seed = seed
  restartScenario(activeScenario, state.frame, state.play)
})
frameButton.addEventListener('click', () => {
  const frame = readBoundedInteger(frameInput, 0, MAX_FRAME, 'frame', state.frame)
  if (frame === undefined || activeScenario === undefined) return
  playback?.pause()
  state.play = false
  restartScenario(activeScenario, frame, false)
})
timeInput.addEventListener('input', () => {
  timeInputDirty = true
  timeOutput.value = timeInput.value
})
timeInput.addEventListener('change', () => {
  const time = readBoundedInteger(timeInput, 0, 23_999, 'time', state.time)
  if (time === undefined) {
    timeInputDirty = false
    render()
    return
  }
  state.time = time
  timeInputDirty = false
  if (activeScenario !== undefined) restartScenario(activeScenario, state.frame, state.play)
})
weatherSelect.addEventListener('change', () => {
  const weather = weatherSelect.value
  if (weather !== 'clear' && weather !== 'rain' && weather !== 'thunder') {
    weatherSelect.value = state.weather
    reportInputIssue('weather', 'clear')
    return
  }
  state.weather = weather
  if (activeScenario !== undefined) restartScenario(activeScenario, state.frame, state.play)
})
panelInput.addEventListener('change', () => {
  state.panel = panelInput.checked
  render()
  updateUrl()
})
sliceSelect.addEventListener('change', () => {
  sliceAxis = sliceSelect.value === 'xz' ? 'xz' : 'xy'
  if (activeScenario !== undefined) setupSliceControl()
  render()
})
layerInput.addEventListener('input', () => {
  const layer = Number(layerInput.value)
  if (!Number.isSafeInteger(layer)) return
  sliceLayer = layer
  layerOutput.value = String(layer)
  render()
})

statePanel = createStatePanel()
panelHost.append(statePanel.element)
seedInput.value = String(state.seed)
frameInput.value = String(state.frame)
timeInput.value = String(state.time)
timeOutput.value = String(state.time)
weatherSelect.value = state.weather
panelInput.checked = state.panel
speedSelect.value = String(state.speed)
updateAlert()

if (activeScenario === undefined && state.scenarioId !== null) {
  state.scenarioId = null
  reportInputIssue('scenario', 'stopped (no scenario selected)')
}
if (activeScenario !== undefined) {
  mountScenario(activeScenario, state.frame)
  installPlayback(state.play)
  updateUrl()
}
render()
