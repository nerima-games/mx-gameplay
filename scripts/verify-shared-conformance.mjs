import { spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const [rulesRootArgument, baseShaArgument, ...extraArguments] =
  process.argv.slice(2)

if (
  rulesRootArgument === undefined ||
  baseShaArgument === undefined ||
  extraArguments.length > 0
) {
  console.error(
    'Usage: node scripts/verify-shared-conformance.mjs <rules-root> <base-sha>',
  )
  process.exit(2)
}

const baseSha = baseShaArgument.toLowerCase()
if (!/^[0-9a-f]{40}$/.test(baseSha)) {
  console.error('The conformance base SHA must contain exactly 40 hex digits.')
  process.exit(2)
}

const repositoryRoot = process.cwd()
const rulesRoot = resolve(repositoryRoot, rulesRootArgument)
const categories = ['core', 'effect3', 'public-api']
const groupConfigs = new Map(
  categories.map((category) => [
    category,
    join(rulesRoot, category, 'sgconfig.yml'),
  ]),
)

for (const requiredPath of [
  join(rulesRoot, 'sgconfig.yml'),
  ...groupConfigs.values(),
]) {
  if (!existsSync(requiredPath)) {
    console.error(`Missing pinned shared conformance config: ${requiredPath}`)
    process.exit(2)
  }
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  })

  if (result.error !== undefined) {
    throw new Error(`${command} could not run: ${result.error.message}`)
  }
  if (result.signal !== null) {
    throw new Error(`${command} was interrupted by ${result.signal}`)
  }
  return result
}

function runSharedRuleTests() {
  const result = run('ast-grep', [
    'test',
    '--config',
    join(rulesRoot, 'sgconfig.yml'),
  ])

  if (result.stdout !== '') process.stdout.write(result.stdout)
  if (result.stderr !== '') process.stderr.write(result.stderr)
  if (result.status !== 0) {
    throw new Error(
      `Pinned shared ast-grep tests failed with exit status ${result.status}`,
    )
  }
}

function scan(category, targetRoot) {
  const result = run(
    'ast-grep',
    [
      'scan',
      '--config',
      groupConfigs.get(category),
      '--json=compact',
      '.',
    ],
    { cwd: targetRoot },
  )

  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `ast-grep ${category} scan failed operationally with exit status ${result.status}\nstderr: ${
        result.stderr === '' ? '(empty)' : result.stderr
      }`,
    )
  }

  let matches
  try {
    matches = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(
      `ast-grep ${category} scan returned exit status ${result.status} without parseable JSON: ${error instanceof Error ? error.message : String(error)}\nstderr: ${
        result.stderr === '' ? '(empty)' : result.stderr
      }`,
    )
  }
  if (
    !Array.isArray(matches) ||
    matches.some((match) => match === null || typeof match !== 'object')
  ) {
    throw new Error(
      `ast-grep ${category} scan returned an unexpected JSON structure.\nstderr: ${
        result.stderr === '' ? '(empty)' : result.stderr
      }`,
    )
  }
  if (result.status === 1 && matches.length === 0) {
    throw new Error(
      `ast-grep ${category} scan exited 1 with an empty JSON result; treating it as an operational failure.\nstderr: ${
        result.stderr === '' ? '(empty)' : result.stderr
      }`,
    )
  }

  if (result.stderr !== '') process.stderr.write(result.stderr)
  return matches
}

function archiveRevision(revision, destination, temporaryRoot) {
  const archivePath = join(temporaryRoot, 'base.tar')
  const archiveFile = openSync(archivePath, 'wx')
  let archiveResult
  try {
    archiveResult = run(
      'git',
      ['archive', '--format=tar', revision],
      {
        stdio: ['ignore', archiveFile, 'pipe'],
      },
    )
  } finally {
    closeSync(archiveFile)
  }

  if (archiveResult.status !== 0) {
    throw new Error(
      `Could not archive conformance base ${revision}:\n${archiveResult.stderr ?? ''}`,
    )
  }

  const extractResult = run('tar', [
    '-xf',
    archivePath,
    '-C',
    destination,
  ])
  if (extractResult.status !== 0) {
    throw new Error(
      `Could not extract conformance base:\n${extractResult.stderr ?? ''}`,
    )
  }
}

function reportMatches(category, matches, scanRoot) {
  console.error(`${category} findings: ${matches.length}`)
  const root = resolve(scanRoot)
  const allowedRuleIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

  for (const match of matches.slice(0, 20)) {
    const candidateRuleId = match.ruleId ?? match.metadata?.id
    const ruleId =
      typeof candidateRuleId === 'string' &&
      allowedRuleIdPattern.test(candidateRuleId)
        ? candidateRuleId
        : '<unknown-rule>'

    let file = '<unknown-path>'
    if (
      typeof match.file === 'string' &&
      match.file !== '' &&
      !/[\u0000-\u001f\u007f\\]/.test(match.file) &&
      !/^[A-Za-z]:[\\/]/.test(match.file) &&
      !match.file.startsWith('\\\\')
    ) {
      const absoluteFile = resolve(root, match.file)
      const relativeFile = relative(root, absoluteFile)
      if (
        relativeFile !== '' &&
        relativeFile !== '..' &&
        !relativeFile.startsWith(`..${sep}`) &&
        !isAbsolute(relativeFile)
      ) {
        file = relativeFile.split(sep).join('/')
      } else if (
        relativeFile === '..' ||
        relativeFile.startsWith(`..${sep}`) ||
        isAbsolute(relativeFile)
      ) {
        file = '<outside-scan-root>'
      }
    }

    const range =
      match.range !== null && typeof match.range === 'object'
        ? match.range
        : {}
    const start =
      range.start !== null && typeof range.start === 'object'
        ? range.start.line
        : null
    const end =
      range.end !== null && typeof range.end === 'object'
        ? range.end.line
        : null
    const startLine =
      Number.isSafeInteger(start) && start >= 0 && start < Number.MAX_SAFE_INTEGER
        ? start + 1
        : null
    const endLine =
      Number.isSafeInteger(end) && end >= 0 && end < Number.MAX_SAFE_INTEGER
        ? end + 1
        : null

    console.error(JSON.stringify({ ruleId, file, startLine, endLine }))
  }
  if (matches.length > 20) {
    console.error(`Additional findings omitted: ${matches.length - 20}`)
  }
}

try {
  runSharedRuleTests()

  const currentRoot = repositoryRoot
  const current = new Map(
    categories.map((category) => [
      category,
      scan(category, currentRoot),
    ]),
  )

  const temporaryRoot = mkdtempSync(
    join(tmpdir(), 'shared-conformance-base-'),
  )
  const baselineRoot = join(temporaryRoot, 'repository')
  mkdirSync(baselineRoot)

  let baselinePublicApi
  try {
    archiveRevision(baseSha, baselineRoot, temporaryRoot)
    baselinePublicApi = scan('public-api', baselineRoot)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }

  const coreMatches = current.get('core')
  const effect3Matches = current.get('effect3')
  const publicApiMatches = current.get('public-api')
  console.log(
    `Shared conformance counts: core=${coreMatches.length}, effect3=${effect3Matches.length}, public-api=${
      publicApiMatches.length
    }, base-public-api=${baselinePublicApi.length}`,
  )

  let failed = false
  if (coreMatches.length !== 0) {
    reportMatches('core', coreMatches, currentRoot)
    failed = true
  }
  if (effect3Matches.length !== 0) {
    reportMatches('effect3', effect3Matches, currentRoot)
    failed = true
  }
  if (publicApiMatches.length > baselinePublicApi.length) {
    reportMatches('public-api', publicApiMatches, currentRoot)
    console.error(
      `public-api findings exceed the base by ${publicApiMatches.length - baselinePublicApi.length}`,
    )
    failed = true
  }

  if (failed) process.exitCode = 1
} catch (error) {
  console.error(
    error instanceof Error ? error.message : String(error),
  )
  process.exitCode = 1
}
