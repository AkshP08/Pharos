import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { deepspaceBuild } from 'deepspace/build'

export default defineConfig({
  plugins: [
    cloudflare({ inspectorPort: false }),
    deepspaceBuild({ appDir: fileURLToPath(new URL('.', import.meta.url)) }),
  ],
})
