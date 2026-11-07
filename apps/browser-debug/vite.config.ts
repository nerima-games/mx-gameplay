import { fileURLToPath } from 'node:url'

type BrowserViteConfig = {
  readonly root: string
  readonly server: {
    readonly host: string
    readonly port: number
    readonly strictPort: boolean
  }
}

const config: BrowserViteConfig = {
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: 5182, strictPort: true },
}

export default config
