import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const outputDirectory = join(import.meta.dirname, 'dist')

async function removeGeneratedLocalSecrets(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isFile() && /^\.dev\.vars(?:\..*)?$/.test(entry.name)) {
      await rm(path)
      console.log(`Removed local-only build artifact: ${path}`)
    } else if (entry.isDirectory()) {
      await removeGeneratedLocalSecrets(path)
    }
  }
}

await removeGeneratedLocalSecrets(outputDirectory)
