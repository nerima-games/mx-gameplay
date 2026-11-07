import type { ScenarioDefinition } from './contract.js'
import { crossAreaScenarios } from './scenarios/cross-area.js'
import { environmentScenarios } from './scenarios/environment.js'
import { interactionsBlockScenarios } from './scenarios/interactions-blocks.js'
import { interactionsItemScenarios } from './scenarios/interactions-items.js'
import { mobScenarios } from './scenarios/mobs.js'
import { playerSystemScenarios } from './scenarios/player-systems.js'
import { previewScenarios } from './scenarios/preview-demo.js'
import { vehiclePortalScenarios } from './scenarios/vehicles-portals.js'

export const SCENARIOS: ReadonlyArray<ScenarioDefinition> = [
  ...interactionsBlockScenarios,
  ...interactionsItemScenarios,
  ...mobScenarios,
  ...vehiclePortalScenarios,
  ...playerSystemScenarios,
  ...environmentScenarios,
  ...crossAreaScenarios,
  ...previewScenarios,
]

const ids = new Set<string>()
for (const scenario of SCENARIOS) {
  if (ids.has(scenario.id)) {
    throw new Error(`browser-debug: duplicate scenario id "${scenario.id}"`)
  }
  ids.add(scenario.id)
}

const defaults = SCENARIOS.filter((scenario) => scenario.isDefault)
if (defaults.length !== 1) {
  throw new Error(`browser-debug: expected exactly one default scenario, found ${defaults.length}`)
}

const defaultScenario = defaults[0]
if (defaultScenario === undefined) {
  throw new Error('browser-debug: default scenario disappeared during registry validation')
}

export const DEFAULT_SCENARIO_ID: string = defaultScenario.id

export const scenarioById = (id: string): ScenarioDefinition | undefined =>
  SCENARIOS.find((scenario) => scenario.id === id)
