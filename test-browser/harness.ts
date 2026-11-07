import { expect, type Locator, type Page } from '@playwright/test'

export type ScenarioIdentity = {
  readonly id: string
  readonly title: string
}

export type BrowserErrors = {
  readonly pageErrors: Array<string>
  readonly consoleErrors: Array<{ readonly text: string; readonly locationUrl: string }>
  readonly httpErrors: Array<string>
  readonly favicon404Urls: Set<string>
}

export const scenarioUrl = (scenarioId: string): string => {
  const params = new URLSearchParams({ scenario: scenarioId })
  return `/?${params.toString()}`
}

export const statePanel = (page: Page): Locator => page.locator('aside[aria-label="Gameplay state"]')

export const watchBrowserErrors = (page: Page): BrowserErrors => {
  const errors: BrowserErrors = {
    pageErrors: [],
    consoleErrors: [],
    httpErrors: [],
    favicon404Urls: new Set<string>(),
  }

  page.on('pageerror', (error) => errors.pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.consoleErrors.push({ text: message.text(), locationUrl: message.location().url })
    }
  })
  page.on('response', (response) => {
    if (response.status() < 400) return

    const responseUrl = response.url()
    const isFavicon404 = response.status() === 404 && new URL(responseUrl).pathname === '/favicon.ico'
    if (isFavicon404) {
      errors.favicon404Urls.add(responseUrl)
      return
    }

    errors.httpErrors.push(`${String(response.status())} ${responseUrl}`)
  })

  return errors
}

export const expectNoBrowserErrors = (errors: BrowserErrors): void => {
  const consoleErrors = errors.consoleErrors.filter(
    ({ locationUrl }) => !errors.favicon404Urls.has(locationUrl),
  )
  expect(errors.pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(errors.httpErrors).toEqual([])
}

export const openScenario = async (page: Page, scenario: ScenarioIdentity): Promise<void> => {
  await page.goto(scenarioUrl(scenario.id))
  await expect(page.locator('#scenario-select')).toHaveValue(scenario.id)
  await expect(page.locator('#run-status')).toContainText(scenario.title)

  const panel = statePanel(page)
  await expect(panel).toBeVisible()
  await expect(panel.locator('.state-row').first()).toBeAttached()
  await expect(panel).toHaveText(/\S/u)
}

export const readLogicalFrame = async (page: Page): Promise<number> => {
  const status = await page.locator('#run-status').textContent()
  const frameText = /logical frame (\d+)/u.exec(status ?? '')?.[1]
  if (frameText === undefined) {
    throw new Error(`browser-debug: logical frame is missing from status: ${status ?? ''}`)
  }
  return Number(frameText)
}
