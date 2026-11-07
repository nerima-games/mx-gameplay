import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

const root = resolve(process.argv[2] ?? process.cwd())
const catalogPath = resolve(root, 'scripts/verification-catalog.json')
const errors = []
const testFilePattern = /^test\/.+\.(?:test|spec)\.ts$/
const areaIdPattern = /^D-(?:0[1-9]|[12][0-9]|3[0-4])$/
const expectedAreaIds = Array.from({ length: 34 }, (_, index) => `D-${String(index + 1).padStart(2, '0')}`)
const angles = ['unit', 'property', 'determinism', 'integration', 'mutationStrength', 'browserScenario']
const crossAreaIds = Array.from({ length: 8 }, (_, index) => `cross-area-x-${String(index + 1).padStart(2, '0')}`)

function relativePath(path) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) {
    return undefined
  }
  const normalized = path.replaceAll('\\', '/')
  if (normalized.startsWith('../') || normalized === '..') {
    return undefined
  }
  return normalized
}

function pathExists(path) {
  const safePath = relativePath(path)
  if (safePath === undefined) {
    return false
  }
  const target = resolve(root, safePath)
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`
  return target === root || target.startsWith(rootPrefix) ? existsSync(target) : false
}

function listDomainFiles(directory, prefix = 'src/domain') {
  const entries = readdirSync(directory, { withFileTypes: true })
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  const files = []
  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name)
    const projectPath = `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...listDomainFiles(fullPath, projectPath))
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(projectPath)
    }
  }
  return files
}

function scenarioIdExists(path, scenarioId, registryImports) {
  const safePath = relativePath(path)
  if (safePath === undefined || pathExists(safePath) === false) {
    return false
  }
  const scenarioFile = safePath.slice('apps/browser-debug/scenarios/'.length)
  if (registryImports.has(scenarioFile.replace(/\.ts$/, '.js')) === false) {
    return false
  }
  const source = readFileSync(resolve(root, safePath), 'utf8')
  const idPattern = /^ {2,4}id:\s*['"]([^'"]+)['"]/gm
  const staticIds = Array.from(source.matchAll(idPattern), (match) => match[1])
  const hasPortalIdTemplate = /id:\s*`\$\{source\}-portal-travel`/.test(source)
  const generatedPortalIds = hasPortalIdTemplate
    ? Array.from(source.matchAll(/portalScenario\(\s*['"]([^'"]+)['"]/g), (match) => `${match[1]}-portal-travel`)
    : []
  return [...staticIds, ...generatedPortalIds].includes(scenarioId)
}

function validateEvidence(area, angle, entry, registryImports) {
  const label = `${area.id} ${angle}`
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`${label}: status entry must be an object`)
    return
  }
  if (typeof entry.status !== 'string' || entry.status.length === 0) {
    errors.push(`${label}: status is missing`)
  }

  if (angle === 'browserScenario') {
    if (Array.isArray(entry.scenarios) === false) {
      errors.push(`${label}: scenarios must be an array`)
      return
    }
    if (entry.scenarios.length === 0) {
      errors.push(`${label}: status needs a browser scenario path and id`)
    }
    for (const scenario of entry.scenarios) {
      if (scenario === null || typeof scenario !== 'object' || Array.isArray(scenario)) {
        errors.push(`${label}: browser scenario reference must be an object`)
        continue
      }
      const safePath = relativePath(scenario.path)
      if (safePath === undefined || safePath.startsWith('apps/browser-debug/scenarios/') === false || safePath.endsWith('.ts') === false) {
        errors.push(`${label}: invalid browser scenario path ${String(scenario.path)}`)
        continue
      }
      if (pathExists(safePath) === false) {
        errors.push(`${label}: missing scenario path ${safePath}`)
        continue
      }
      if (typeof scenario.id !== 'string' || scenarioIdExists(safePath, scenario.id, registryImports) === false) {
        errors.push(`${label}: missing browser scenario id ${String(scenario.id)} in ${safePath}`)
        continue
      }
      if (crossAreaIds.includes(scenario.id)) {
        seenCrossAreaIds.add(scenario.id)
      }
    }
    return
  }

  if (Array.isArray(entry.evidence) === false) {
    errors.push(`${label}: evidence must be an array`)
    return
  }
  const hasEvidence = entry.evidence.length > 0
  if (hasEvidence === false) {
    errors.push(`${label}: status needs at least one test path`)
  }
  for (const path of entry.evidence) {
    const safePath = relativePath(path)
    if (safePath === undefined || testFilePattern.test(safePath) === false) {
      errors.push(`${label}: invalid test path ${String(path)}`)
      continue
    }
    if (angle === 'property' && safePath.startsWith('test/property/') === false) {
      errors.push(`${label}: property evidence must be under test/property/: ${safePath}`)
    }
    if (angle === 'unit' && (safePath.startsWith('test/property/') || safePath.startsWith('test/scenario/'))) {
      errors.push(`${label}: unit evidence must be a unit test under test/: ${safePath}`)
    }
    if (angle === 'integration' && safePath.startsWith('test/scenario/') === false) {
      errors.push(`${label}: integration evidence must be under test/scenario/: ${safePath}`)
    }
    if (pathExists(safePath) === false) {
      errors.push(`${label}: missing test path ${safePath}`)
    }
  }
}

if (pathExists('src/domain') === false) {
  errors.push('Missing domain directory: src/domain')
}
if (pathExists('apps/browser-debug/scenario-registry.ts') === false) {
  errors.push('Missing browser scenario registry: apps/browser-debug/scenario-registry.ts')
}
if (pathExists('scripts/verification-catalog.json') === false) {
  errors.push('Missing catalog data: scripts/verification-catalog.json')
}

let catalog
try {
  catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
} catch (error) {
  errors.push(`Cannot read catalog JSON: ${error instanceof Error ? error.message : String(error)}`)
}
if (catalog !== undefined && (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog))) {
  errors.push('Catalog root must be an object')
  catalog = undefined
}

const seenCrossAreaIds = new Set()
if (catalog !== undefined) {
  if (Array.isArray(catalog.areas) === false) {
    errors.push('Catalog areas must be an array')
  }
  if (Array.isArray(catalog.files) === false) {
    errors.push('Catalog files must be an array')
  }

  const areas = Array.isArray(catalog.areas) ? catalog.areas : []
  const files = Array.isArray(catalog.files) ? catalog.files : []
  const areaIds = new Set()
  const registryPath = resolve(root, 'apps/browser-debug/scenario-registry.ts')
  const registryImports = new Set()
  if (existsSync(registryPath)) {
    const registry = readFileSync(registryPath, 'utf8')
    const importPattern = /from\s+['"]\.\/scenarios\/([^'"]+\.js)['"]/g
    for (const match of registry.matchAll(importPattern)) {
      registryImports.add(match[1])
    }
  }

  for (const area of areas) {
    if (area === null || typeof area !== 'object' || Array.isArray(area)) {
      errors.push('Catalog area row must be an object')
      continue
    }
    if (typeof area.id !== 'string' || areaIdPattern.test(area.id) === false) {
      errors.push(`Invalid catalog area id: ${String(area.id)}`)
      continue
    }
    if (areaIds.has(area.id)) {
      errors.push(`Catalog area listed twice: ${area.id}`)
    }
    areaIds.add(area.id)
    for (const angle of angles) {
      validateEvidence(area, angle, area[angle], registryImports)
    }
  }

  const domainRoot = resolve(root, 'src/domain')
  const domainFiles = existsSync(domainRoot) ? listDomainFiles(domainRoot) : []
  const rowsByFile = new Map()
  for (const row of files) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      errors.push('Catalog file row must be an object')
      continue
    }
    const file = relativePath(row.file)
    if (file === undefined || file.startsWith('src/domain/') === false || file.endsWith('.ts') === false) {
      errors.push(`Invalid catalog domain path: ${String(row.file)}`)
      continue
    }
    const rows = rowsByFile.get(file) ?? []
    rows.push(row)
    rowsByFile.set(file, rows)
    if (pathExists(file) === false) {
      errors.push(`Catalog lists missing domain file: ${file}`)
    }
    if (Array.isArray(row.catalogIds) === false || row.catalogIds.length === 0) {
      errors.push(`Catalog file has no area id: ${file}`)
    } else {
      for (const id of row.catalogIds) {
        if (areaIds.has(id) === false) {
          errors.push(`Catalog file ${file} references unknown area ${String(id)}`)
        }
      }
    }
  }

  for (const file of domainFiles) {
    const rows = rowsByFile.get(file) ?? []
    if (rows.length === 0) {
      errors.push(`Domain file is unlisted: ${file}`)
    } else if (rows.length > 1) {
      errors.push(`Domain file is listed more than once: ${file}`)
    }
  }
  for (const file of rowsByFile.keys()) {
    if (domainFiles.includes(file) === false) {
      errors.push(`Catalog lists missing domain file: ${file}`)
    }
  }

  for (const id of areaIds) {
    if (files.some((row) => Array.isArray(row.catalogIds) && row.catalogIds.includes(id)) === false) {
      errors.push(`Catalog area has no domain file: ${id}`)
    }
  }

  for (const id of expectedAreaIds) {
    if (areaIds.has(id) === false) {
      errors.push(`Catalog area is unlisted: ${id}`)
    }
  }

  for (const id of crossAreaIds) {
    if (seenCrossAreaIds.has(id) === false) {
      errors.push(`Missing cross-area browser scenario X-${id.slice(-2)}`)
    }
  }

  if (errors.length === 0) {
    const output = areas.map((area) => {
      const parts = angles.map((angle) => `${angle}=${area[angle].status}`)
      return `${area.id} ${parts.join(' ')}`
    })
    process.stdout.write(`Catalog valid: ${domainFiles.length} domain files mapped to ${areas.length} areas.\n`)
    process.stdout.write(`${output.join('\n')}\n`)
  }
}

if (errors.length > 0) {
  errors.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  for (const error of errors) {
    process.stderr.write(`${error}\n`)
  }
  process.exitCode = 1
}
