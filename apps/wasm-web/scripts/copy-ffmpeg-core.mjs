import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(__dirname, '..', 'public', 'ffmpeg')

function findCoreEsmDir(startDir) {
  let dir = startDir
  while (true) {
    const candidate = path.join(dir, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm')
    if (fs.existsSync(candidate)) {
      return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error('Could not locate node_modules/@ffmpeg/core/dist/esm in any parent directory')
    }
    dir = parent
  }
}

const srcDir = findCoreEsmDir(__dirname)
fs.mkdirSync(outDir, { recursive: true })

for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const src = path.join(srcDir, file)
  const dst = path.join(outDir, file)
  if (!fs.existsSync(src)) {
    throw new Error(`Missing @ffmpeg/core asset: ${src}`)
  }
  fs.copyFileSync(src, dst)
}

console.log(`Copied @ffmpeg/core assets from ${srcDir} to ${outDir}`)
