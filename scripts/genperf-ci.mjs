import { spawn, execFileSync } from 'node:child_process'
import { createWriteStream, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const testFiles = ['test/balance-simulation.test.ts', 'test/scenario/environment-gameplay.scenario.test.ts']
const categories = ['generation', 'light', 'spawn search', 'other']

const sourcePath = (url) => {
  if (url === '') return '[native]'
  const source = url.startsWith('file://') ? decodeURIComponent(url.slice(7)) : url
  const packageIndex = source.lastIndexOf('/node_modules/')
  if (packageIndex >= 0) return source.slice(packageIndex + 1)
  return source.startsWith(`${process.cwd()}/`) ? relative(process.cwd(), source) : source
}

export const summarizeCpuProfile = (profile) => {
  if (!Array.isArray(profile.nodes) || !Array.isArray(profile.samples) || !Array.isArray(profile.timeDeltas)
    || profile.samples.length === 0 || profile.samples.length !== profile.timeDeltas.length) {
    throw new Error('CPU profile must contain nonempty, matching samples and timeDeltas')
  }
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const parents = new Map()
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) {
      if (parents.has(child)) throw new Error(`CPU profile node ${child} has multiple parents`)
      parents.set(child, node.id)
    }
  }
  const functions = new Map()
  const files = new Map()
  const totals = Object.fromEntries(categories.map((category) => [category, 0]))
  let totalMicros = 0
  let profilerControlMicros = 0
  let negativeDeltaCount = 0
  let normalizedNegativeMicros = 0
  // Match mc-worldgen's chunk-store-cpu-profile.mjs normalization limits:
  // <= 1ms each, <= 1% of samples and <= 0.5% of workload time; preserve raw files.
  for (let index = 0; index < profile.samples.length; index += 1) {
    const node = nodes.get(profile.samples[index])
    const delta = profile.timeDeltas[index]
    if (!node || !Number.isInteger(delta) || delta < -1000) throw new Error(`Invalid CPU sample ${index}`)
    if (delta < 0) {
      negativeDeltaCount += 1
      normalizedNegativeMicros -= delta
    }
    const micros = Math.max(0, delta)
    if (node.callFrame.url.startsWith('node:inspector')) {
      profilerControlMicros += micros
      continue
    }
    let category = 'other'
    let current = node
    const visited = new Set()
    while (current) {
      if (visited.has(current.id)) throw new Error('Cycle in CPU profile call tree')
      visited.add(current.id)
      const { functionName, url } = current.callFrame
      if (/^generateChunk(?:At)?$/.test(functionName)) { category = 'generation'; break }
      if (functionName === 'computeChunkLights') { category = 'light'; break }
      if (/\/mob-spawn-search\.[cm]?[jt]s(?:$|\?)/.test(url)) { category = 'spawn search'; break }
      current = nodes.get(parents.get(current.id))
    }
    totals[category] += micros
    totalMicros += micros
    const { functionName, url, lineNumber, columnNumber } = node.callFrame
    const file = sourcePath(url)
    const name = functionName || '(anonymous)'
    const source = `${file}:${lineNumber + 1}`
    const key = `${name}\0${source}\0${columnNumber}`
    const entry = functions.get(key) ?? { name, source, selfMicros: 0 }
    entry.selfMicros += micros
    functions.set(key, entry)
    files.set(file, (files.get(file) ?? 0) + micros)
  }
  if (totalMicros <= 0 || negativeDeltaCount / profile.samples.length > 0.01
    || normalizedNegativeMicros / totalMicros > 0.005) throw new Error('CPU profile has no workload or excessive negative intervals')
  const timing = (micros) => ({ selfMs: micros / 1000, percent: micros / totalMicros * 100 })
  return {
    sampleCount: profile.samples.length,
    selfMs: totalMicros / 1000,
    profilerControlMs: profilerControlMicros / 1000,
    negativeDeltaCount,
    normalizedNegativeMicros,
    categories: Object.fromEntries(Object.entries(totals).map(([key, micros]) => [key, timing(micros)])),
    functions: [...functions.values()].sort((a, b) => b.selfMicros - a.selfMicros)
      .slice(0, 20).map(({ name, source, selfMicros }) => ({ name, source, ...timing(selfMicros) })),
    files: [...files].sort((a, b) => b[1] - a[1]).map(([source, micros]) => ({ source, ...timing(micros) })),
  }
}

const machineLoad = (label) => {
  const snapshot = {
    label,
    utc: execFileSync('date', ['-u'], { encoding: 'utf8' }).trim(),
    nproc: execFileSync('nproc', [], { encoding: 'utf8' }).trim(),
    uptime: execFileSync('uptime', [], { encoding: 'utf8' }).trim(),
  }
  console.log(JSON.stringify(snapshot))
  return snapshot
}

const measureMode = async (arm, mode, cwd, output) => {
  const label = `${arm}-${mode}`
  const args = ['exec', 'vitest', 'run', ...testFiles, '--reporter=verbose', '--reporter=json',
    `--outputFile.json=${resolve(output, `${label}.json`)}`]
  if (mode === 'cov' || mode === 'cpu-cov') args.push('--coverage')
  if (mode.startsWith('cpu-')) {
    const profileDir = resolve(output, mode.slice(4))
    mkdirSync(profileDir, { recursive: true })
    // Vitest 4+ moved poolOptions.forks.execArgv to top-level execArgv.
    args.push('--execArgv=--cpu-prof', `--execArgv=--cpu-prof-dir=${profileDir}`)
  }
  const before = machineLoad(`${label} before`)
  console.log(`GENPERF command (${arm}): pnpm ${args.join(' ')}`)
  const log = createWriteStream(resolve(output, `${label}.log`))
  const started = performance.now()
  const result = await new Promise((done, reject) => {
    const child = spawn('pnpm', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (data) => { process.stdout.write(data); log.write(data) })
    child.stderr.on('data', (data) => { process.stderr.write(data); log.write(data) })
    child.on('error', reject)
    child.on('close', (code, signal) => log.end(() => done({ code, signal })))
  })
  const record = { arm, mode, ...result, wallMs: performance.now() - started, before, after: machineLoad(`${label} after`) }
  writeFileSync(resolve(output, `${label}-status.json`), `${JSON.stringify(record, null, 2)}\n`)
  console.log(`GENPERF exit ${label}: ${JSON.stringify(result)}`)
}

const measure = (arm, cwd, output) => {
  if (!['head', 'main'].includes(arm)) throw new Error('Expected head or main arm')
  mkdirSync(output, { recursive: true })
  const modes = arm === 'head' ? ['nocov', 'cov', 'cpu-nocov', 'cpu-cov'] : ['nocov', 'cov']
  return modes.reduce((previous, mode) => previous.then(() => measureMode(arm, mode, cwd, output)), Promise.resolve())
}

const renderProfile = (label, summary) => {
  const rows = (items) => items.map(({ source, selfMs, percent }) => `| ${selfMs.toFixed(2)} ms | ${percent.toFixed(2)}% | \`${source}\` |`)
  return [
    `### ${label} CPU profile`, '',
    `Workload sampled self time: ${summary.selfMs.toFixed(2)} ms across ${summary.sampleCount} samples.`,
    `Profiler-control time excluded: ${summary.profilerControlMs.toFixed(2)} ms.`,
    `Normalized negative intervals: ${summary.negativeDeltaCount} (${summary.normalizedNegativeMicros} microseconds).`,
    'Exclusive categories use the nearest matching ancestor: generateChunk, computeChunkLights, or mob-spawn-search source. Other includes runner startup, native, GC and idle frames. Denominator is all sampled self time except node:inspector control frames; this is aggregate worker time, not individual-test wall time.', '',
    '| Category | Sampled time | Share |', '| --- | ---: | ---: |',
    ...Object.entries(summary.categories).map(([name, { selfMs, percent }]) => `| ${name} | ${selfMs.toFixed(2)} ms | ${percent.toFixed(2)}% |`), '',
    '| Rank | Self time | Share | Function | Source |', '| ---: | ---: | ---: | --- | --- |',
    ...summary.functions.map(({ name, source, selfMs, percent }, index) => `| ${index + 1} | ${selfMs.toFixed(2)} ms | ${percent.toFixed(2)}% | \`${name}\` | \`${source}\` |`), '',
    '| File self time | Share | Source |', '| ---: | ---: | --- |', ...rows(summary.files), '',
  ].join('\n')
}

const summarize = (output) => {
  const tests = []
  let failed = false
  for (const arm of ['head', 'main']) {
    for (const mode of arm === 'head' ? ['nocov', 'cov', 'cpu-nocov', 'cpu-cov'] : ['nocov', 'cov']) {
      const label = `${arm}-${mode}`
      const status = JSON.parse(readFileSync(resolve(output, `${label}-status.json`), 'utf8'))
      console.log(`GENPERF status ${label}: ${JSON.stringify(status)}`)
      if (status.code !== 0 || status.signal !== null) failed = true
      const report = JSON.parse(readFileSync(resolve(output, `${label}.json`), 'utf8'))
      const selectedFiles = new Set(report.testResults.map((file) => testFiles.find((candidate) => file.name.endsWith(`/${candidate}`))))
      if (report.testResults.length !== testFiles.length || selectedFiles.size !== testFiles.length
        || selectedFiles.has(undefined) || report.numTotalTests === 0) throw new Error(`${label}: expected two nonempty test files`)
      for (const file of report.testResults) {
        const name = testFiles.find((candidate) => file.name.endsWith(`/${candidate}`))
        if (!name || file.assertionResults.length === 0) throw new Error(`${label}: unexpected or empty test file ${file.name}`)
        for (const test of file.assertionResults) {
          if (!Number.isFinite(test.duration)) throw new Error(`${label}: missing duration for ${test.fullName}`)
          tests.push({ arm, mode, file: name, test: test.fullName, durationMs: test.duration, status: test.status })
        }
      }
    }
  }
  console.log('| Arm | Mode | File | Test | Time (ms) | Status |')
  console.log('| --- | --- | --- | --- | ---: | --- |')
  for (const row of tests) console.log(`| ${row.arm} | ${row.mode} | ${row.file} | ${row.test} | ${row.durationMs} | ${row.status} |`)
  const ratios = []
  for (const row of tests.filter((test) => test.mode === 'cov' || test.mode === 'cpu-cov')) {
    const baseMode = row.mode === 'cov' ? 'nocov' : 'cpu-nocov'
    const base = tests.find((test) => test.arm === row.arm && test.mode === baseMode && test.file === row.file && test.test === row.test)
    if (!base || base.durationMs <= 0) throw new Error('Missing positive no-coverage duration')
    const ratio = row.durationMs / base.durationMs
    ratios.push({ arm: row.arm, mode: row.mode, file: row.file, test: row.test, ratio })
    console.log(`GENPERF coverage ratio: ${JSON.stringify(ratios.at(-1))}`)
  }
  writeFileSync(resolve(output, 'test-summary.json'), `${JSON.stringify({ tests, ratios }, null, 2)}\n`)
  for (const mode of ['nocov', 'cov']) {
    const profileDir = resolve(output, mode)
    const names = readdirSync(profileDir).filter((name) => name.endsWith('.cpuprofile'))
    if (names.length === 0) throw new Error(`No CPU profiles for ${mode}`)
    const profiles = names.map((name) => JSON.parse(readFileSync(resolve(profileDir, name), 'utf8')))
    // Remap IDs before combining independent fork call trees.
    const combined = { nodes: [], samples: [], timeDeltas: [] }
    let nextId = 1
    for (const profile of profiles) {
      summarizeCpuProfile(profile)
      const ids = new Map()
      for (const node of profile.nodes) {
        ids.set(node.id, nextId)
        nextId += 1
      }
      combined.nodes.push(...profile.nodes.map((node) => ({ ...node, id: ids.get(node.id), children: (node.children ?? []).map((id) => ids.get(id)) })))
      combined.samples.push(...profile.samples.map((id) => ids.get(id)))
      combined.timeDeltas.push(...profile.timeDeltas)
    }
    const summary = { profileFiles: names, ...summarizeCpuProfile(combined) }
    writeFileSync(resolve(output, `${mode}-summary.json`), `${JSON.stringify(summary, null, 2)}\n`)
    console.log(renderProfile(`head ${mode}`, summary))
  }
  if (failed) throw new Error('One or more measurement commands exited unsuccessfully; see recorded statuses (partial-suite coverage thresholds remain enabled)')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, ...args] = process.argv.slice(2)
  if (operation === 'measure' && args.length === 3) await measure(args[0], resolve(args[1]), resolve(args[2]))
  else if (operation === 'summarize' && args.length === 1) summarize(resolve(args[0]))
  else throw new Error(`Usage: ${basename(process.argv[1])} measure <head|main> <checkout> <prof> | summarize <prof>`)
}
