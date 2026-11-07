import { BlockAxis, blockPosition } from '@nerima-games/mc-kernel'
import { DEFAULT_SCENARIO, scenarioByName } from '../../preview-mining-site/scenarios.js'
import { requestBreak, stepFrame } from '../../preview-mining-site/site.js'
import { runBrowserDebugEffect } from '../entrypoint.js'
import { mountGameplayScenario, type ScenarioDefinition } from '../contract.js'

const previewScenario = scenarioByName(DEFAULT_SCENARIO)
if (previewScenario === undefined) {
  throw new Error(`browser-debug: missing preview scenario "${DEFAULT_SCENARIO}"`)
}

export const previewScenarios: ReadonlyArray<ScenarioDefinition> = [
  {
    id: 'preview-sand-column',
    title: 'Preview: falling sand column',
    area: 'preview',
    isDefault: true,
    mount: (context) => {
      const target = blockPosition(BlockAxis(6), BlockAxis(2), BlockAxis(0))
      return mountGameplayScenario(context, {
        world: previewScenario.build(),
        bounds: { width: previewScenario.minWidth, height: previewScenario.minHeight },
        actions: [
          {
            id: 'break-sand-support',
            label: 'Break sand support',
            perform: (site) => {
              runBrowserDebugEffect(requestBreak(site, target))
              runBrowserDebugEffect(stepFrame(site))
            },
          },
        ],
        unsupported: [
          'Equipment, hotbar, and status-effect snapshots are not wired into the preview demo.',
          'The preview demo produces no death-cause or audio-cue events.',
          'The preview exposes frame totals, but not before/after deltas for individual stages.',
          'The preview Site does not expose the player pose for observation.',
        ],
        observe: () => ({ playerPosition: 'unavailable (preview Site does not expose player pose)' }),
      })
    },
  },
]
