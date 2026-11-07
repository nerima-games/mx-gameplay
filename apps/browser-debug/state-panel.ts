import type { ScenarioSnapshot } from './contract.js'

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  return node
}

const valueText = (value: unknown): string => {
  if (value === undefined) return 'unavailable'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? String(value)
}

const labeledValue = (label: string, value: unknown): HTMLElement => {
  const row = element('div', 'state-row')
  const name = element('strong')
  name.textContent = label
  const content = element('pre')
  content.textContent = valueText(value)
  row.append(name, content)
  return row
}

export type StatePanel = {
  readonly element: HTMLElement
  readonly render: (snapshot: ScenarioSnapshot) => void
  readonly dispose: () => void
}

export const createStatePanel = (): StatePanel => {
  const root = element('aside', 'state-panel')
  root.setAttribute('aria-label', 'Gameplay state')

  const entitiesSection = element('section')
  const entitiesHeading = element('h2')
  entitiesHeading.textContent = 'Entities'
  const entitySelect = element('select')
  entitySelect.setAttribute('aria-label', 'Select entity')
  const entityDetails = element('pre', 'entity-details')
  entitiesSection.append(entitiesHeading, entitySelect, entityDetails)

  const playerSection = element('section')
  const playerHeading = element('h2')
  playerHeading.textContent = 'Player'
  playerSection.append(playerHeading)

  const worldSection = element('section')
  const worldHeading = element('h2')
  worldHeading.textContent = 'World and environment'
  const chunkList = element('ul')
  const time = element('p')
  const weather = element('p')
  worldSection.append(worldHeading, time, weather, chunkList)

  const outputsSection = element('section')
  const outputsHeading = element('h2')
  outputsHeading.textContent = 'Gameplay outputs'
  outputsSection.append(outputsHeading)

  const traceSection = element('section')
  const traceHeading = element('h2')
  traceHeading.textContent = 'Stage frame log'
  const stageOrder = element('p', 'stage-order')
  const traceTable = element('table')
  const traceHeader = element('thead')
  const traceHeaderRow = element('tr')
  for (const heading of ['Frame', 'Reads', 'Writes', 'Moved', 'Drops']) {
    const cell = element('th')
    cell.textContent = heading
    traceHeaderRow.append(cell)
  }
  traceHeader.append(traceHeaderRow)
  const traceBody = element('tbody')
  traceTable.append(traceHeader, traceBody)
  traceSection.append(traceHeading, stageOrder, traceTable)

  const unsupportedSection = element('section', 'unsupported-section')
  const unsupportedHeading = element('h2')
  unsupportedHeading.textContent = 'Unavailable in this scenario'
  const unsupportedList = element('ul')
  unsupportedSection.append(unsupportedHeading, unsupportedList)

  root.append(entitiesSection, playerSection, worldSection, outputsSection, traceSection, unsupportedSection)

  let selectedEntity = '0'
  let lastSnapshot: ScenarioSnapshot | undefined
  const updateEntityDetails = (): void => {
    entityDetails.textContent = lastSnapshot?.entities[Number(selectedEntity)] ?? 'No entities in this scenario.'
  }
  const onEntityChange = (): void => {
    selectedEntity = entitySelect.value
    updateEntityDetails()
  }
  entitySelect.addEventListener('change', onEntityChange)

  const render = (snapshot: ScenarioSnapshot): void => {
    lastSnapshot = snapshot
    const previousSelection = selectedEntity
    entitySelect.replaceChildren()
    snapshot.entities.forEach((_, index) => {
      const option = element('option')
      option.value = String(index)
      option.textContent = `Entity ${index + 1}`
      entitySelect.append(option)
    })
    if (snapshot.entities.length === 0) {
      const option = element('option')
      option.value = '0'
      option.textContent = 'No entities'
      entitySelect.append(option)
    }
    selectedEntity = snapshot.entities[Number(previousSelection)] === undefined ? '0' : previousSelection
    entitySelect.value = selectedEntity
    updateEntityDetails()

    time.textContent = `Time of day: ${String(snapshot.timeOfDay)}`
    weather.textContent = `Weather: ${snapshot.weather}`

    playerSection.replaceChildren(playerHeading,
      labeledValue('Position', snapshot.playerPosition),
      labeledValue('Health, hunger, saturation, exhaustion', snapshot.vitals),
      labeledValue('Experience', snapshot.experience),
      labeledValue('Inventory', snapshot.inventory),
      labeledValue('Equipment', snapshot.equipment),
      labeledValue('Hotbar', snapshot.hotbar),
      labeledValue('Status effects', snapshot.statusEffects),
    )

    chunkList.replaceChildren()
    if (snapshot.chunks.length === 0) {
      const item = element('li')
      item.textContent = 'No chunks were declared.'
      chunkList.append(item)
    }
    for (const chunk of snapshot.chunks) {
      const item = element('li')
      item.textContent = `${chunk.key}: ${chunk.loaded ? 'loaded' : 'unloaded'}`
      chunkList.append(item)
    }

    outputsSection.replaceChildren(outputsHeading,
      labeledValue('Drops', snapshot.drops),
      labeledValue('Death causes', snapshot.deathCauses),
      labeledValue('Audio cue IDs', snapshot.audioCueIds),
    )

    stageOrder.textContent = snapshot.stageNames.length === 0
      ? 'No stages are registered.'
      : `Order: ${snapshot.stageNames.join(' → ')}`
    traceBody.replaceChildren()
    for (const row of [...snapshot.trace.slice(-12)].reverse()) {
      const tableRow = element('tr')
      const values = [row.frame, row.reads, row.writes, row.moved, row.dropped.length]
      for (const value of values) {
        const cell = element('td')
        cell.textContent = String(value)
        tableRow.append(cell)
      }
      traceBody.append(tableRow)
    }

    unsupportedList.replaceChildren()
    if (snapshot.unsupported.length === 0) {
      const item = element('li')
      item.textContent = 'None declared.'
      unsupportedList.append(item)
    }
    for (const message of snapshot.unsupported) {
      const item = element('li')
      item.textContent = message
      unsupportedList.append(item)
    }
  }

  return {
    element: root,
    render,
    dispose: () => entitySelect.removeEventListener('change', onEntityChange),
  }
}
