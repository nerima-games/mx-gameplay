import { defineConfig, devices } from '@playwright/test'

const DEFAULT_HARNESS_PORT = 5182
const DEFAULT_OUTPUT_DIR = 'test-results'
const requestedPort = process.env['HARNESS_PORT']
const parsedPort = requestedPort === undefined ? Number.NaN : Number(requestedPort)
const harnessPort = Number.isSafeInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535
  ? parsedPort
  : DEFAULT_HARNESS_PORT
const requestedOutputDir = process.env['PLAYWRIGHT_OUTPUT_DIR']?.trim()
const outputDir = requestedOutputDir === undefined || requestedOutputDir.length === 0
  ? DEFAULT_OUTPUT_DIR
  : requestedOutputDir
const baseURL = `http://127.0.0.1:${String(harnessPort)}`

const config: ReturnType<typeof defineConfig> = defineConfig({
  testDir: './test-browser',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  outputDir,
  timeout: 30_000,
  retries: 0,
  workers: process.env['CI'] === undefined ? 4 : 2,
  forbidOnly: process.env['CI'] !== undefined,
  reporter: [['list']],
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `nix develop --command pnpm exec vite --config apps/browser-debug/vite.config.ts --host 127.0.0.1 --port ${String(harnessPort)} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})

export default config
