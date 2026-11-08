import { Effect } from 'effect'
import { runCli } from '../../scripts/balance/run.js'

void runCli(process.argv.slice(2), Effect.runPromise).then((status) => {
  process.exitCode = status
})
