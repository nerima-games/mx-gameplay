/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test'
import { DEFAULT_SCENARIO_ID, SCENARIOS } from '../apps/browser-debug/scenario-registry.js'
import {
  type BrowserErrors,
  expectNoBrowserErrors,
  openScenario,
  readLogicalFrame,
  statePanel,
  watchBrowserErrors,
} from './harness.js'

const browserErrorsByPage = new WeakMap<Page, BrowserErrors>()

test.beforeEach(({ page }) => {
  browserErrorsByPage.set(page, watchBrowserErrors(page))
})

test.afterEach(({ page }) => {
  const browserErrors = browserErrorsByPage.get(page)
  if (browserErrors !== undefined) expectNoBrowserErrors(browserErrors)
})

const defaultScenario = SCENARIOS.find((scenario) => scenario.id === DEFAULT_SCENARIO_ID)
if (defaultScenario === undefined) {
  throw new Error(`browser-debug: default scenario "${DEFAULT_SCENARIO_ID}" is not registered`)
}

const assertPanelChanges = async (
  page: Page,
  panel: Locator,
  previousState: string,
): Promise<string> => {
  if (await panel.innerText() === previousState) {
    await page.getByRole('button', { name: 'Step frame', exact: true }).click()
  }
  await expect.poll(() => panel.innerText()).not.toBe(previousState)
  return panel.innerText()
}

const runScenarioActions = async (
  page: Page,
  actionButtons: Locator,
  panel: Locator,
  previousState: string,
  actionCount: number,
  index = 0,
): Promise<void> => {
  if (index >= actionCount) return

  const actionButton = actionButtons.nth(index)
  await expect(actionButton).toBeVisible()
  await actionButton.click()
  const nextState = await assertPanelChanges(page, panel, previousState)
  return runScenarioActions(page, actionButtons, panel, nextState, actionCount, index + 1)
}

for (const scenario of SCENARIOS) {
  // Catches scenarios that fail to mount, render state, run actions, or report unavailable operations.
  test(`mounts ${scenario.id}, runs its actions, and renders state`, async ({ page }, testInfo) => {
    try {
      await openScenario(page, scenario)

      const selectedScenario = page.locator('#scenario-select')
      await expect(selectedScenario).toHaveValue(scenario.id)
      await expect(page.locator('#run-status')).toContainText(scenario.title)

      const canvasHasPaint = await page.locator('#world-canvas').evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) return false
        const context = element.getContext('2d')
        if (context === null) return false
        const pixels = context.getImageData(0, 0, element.width, element.height).data
        for (let alphaIndex = 3; alphaIndex < pixels.length; alphaIndex += 4) {
          if (pixels[alphaIndex] !== 0) return true
        }
        return false
      })
      expect(canvasHasPaint).toBe(true)

      const panel = statePanel(page)
      const initialState = await panel.innerText()
      const actionButtons = page.locator('#scenario-actions').getByRole('button')
      const actionCount = await actionButtons.count()
      if (actionCount === 0) {
        await page.getByRole('button', { name: 'Step frame', exact: true }).click()
        await expect.poll(() => panel.innerText()).not.toBe(initialState)
      } else {
        await runScenarioActions(page, actionButtons, panel, initialState, actionCount)
      }

      const unavailableSection = page.locator('.unsupported-section')
      if (await unavailableSection.count() > 0) {
        await expect(
          unavailableSection.getByRole('heading', { name: 'Unavailable in this scenario' }),
        ).toBeVisible()
        const unavailableReasons = unavailableSection.locator('li')
        await expect(unavailableReasons).not.toHaveCount(0)
        for (const reason of await unavailableReasons.allTextContents()) {
          expect(reason.trim().length).toBeGreaterThan(0)
        }
      }
    } finally {
      await page.screenshot({ path: testInfo.outputPath(`${scenario.id}.png`), fullPage: true })
    }
  })
}

// Catches a Play control that leaves the logical clock stopped.
test('Play advances the logical frame', async ({ page }) => {
  await openScenario(page, defaultScenario)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => readLogicalFrame(page)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
})

// Catches a Pause control that leaves the logical clock advancing.
test('Pause freezes the logical frame', async ({ page }) => {
  await openScenario(page, defaultScenario)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => readLogicalFrame(page)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  const pausedFrame = await readLogicalFrame(page)
  await page.waitForTimeout(100)
  await expect.poll(() => readLogicalFrame(page)).toBe(pausedFrame)
})

// Catches a Step frame control that advances by the wrong number of frames.
test('Step frame advances exactly one frame', async ({ page }) => {
  await openScenario(page, defaultScenario)
  await page.getByRole('button', { name: 'Step frame', exact: true }).click()
  await expect.poll(() => readLogicalFrame(page)).toBe(1)
})

// Catches Go to frame restoring a different logical frame than the requested one.
test('Go to frame loads the requested frame', async ({ page }) => {
  await openScenario(page, defaultScenario)
  await page.locator('#frame-input').fill('7')
  await page.getByRole('button', { name: 'Go to frame', exact: true }).click()
  await expect.poll(() => readLogicalFrame(page)).toBe(7)
})

// Catches Reset leaving a stale frame after rebuilding the scenario.
test('Reset returns the scenario to frame zero', async ({ page }) => {
  await openScenario(page, defaultScenario)
  await page.locator('#frame-input').fill('4')
  await page.getByRole('button', { name: 'Go to frame', exact: true }).click()
  await expect.poll(() => readLogicalFrame(page)).toBe(4)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect.poll(() => readLogicalFrame(page)).toBe(0)
})

// Catches URLs that cannot reproduce the selected logical frame after reload.
test('URL reload reproduces the same logical frame', async ({ page }) => {
  await openScenario(page, defaultScenario)
  await page.locator('#frame-input').fill('9')
  await page.getByRole('button', { name: 'Go to frame', exact: true }).click()
  const expectedFrame = await readLogicalFrame(page)

  await page.reload()
  await expect(page.locator('#scenario-select')).toHaveValue(defaultScenario.id)
  await expect(page.locator('#run-status')).toContainText(defaultScenario.title)
  await expect(statePanel(page).locator('.state-row').first()).toBeAttached()
  await expect(statePanel(page)).toHaveText(/\S/u)
  await expect.poll(() => readLogicalFrame(page)).toBe(expectedFrame)
})

// Catches an unknown scenario becoming a blank page or silently selecting another scenario.
test('unknown scenario shows the explicit not-found state', async ({ page }) => {
  await page.goto('/?scenario=unknown-scenario-for-e2e')
  await expect(page.locator('#run-status')).toHaveText(
    'No scenario is running. Choose a valid scenario to start.',
  )
  await expect(page.locator('#scenario-select')).toHaveValue('')
  await expect(page.getByRole('option', { name: 'Invalid scenario (stopped)' })).toBeAttached()
  await expect(page.getByRole('alert')).toContainText('scenario → stopped (no scenario selected)')
  await expect(page.locator('#app')).toContainText('Browser Debug')
})
