import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { deepspaceBuild } from 'deepspace/build'

// DeepSpace invokes Vite directly rather than the package build script. Refresh
// maintained assets and the source stamp on that path too.
execFileSync(process.execPath, [fileURLToPath(new URL('./sync-site.mjs', import.meta.url))], { stdio: 'pipe' })

export default defineConfig({
  plugins: [
    cloudflare({ inspectorPort: false }),
    deepspaceBuild({ appDir: fileURLToPath(new URL('.', import.meta.url)) }),
  ],
})
