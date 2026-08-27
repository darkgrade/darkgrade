/**
 * Ensures the Electron binary is present before launching dev.
 * Package managers sometimes skip electron's postinstall (which downloads the
 * ~120 MB binary and writes path.txt); electron-vite then fails with
 * "Error: Electron uninstall". This runs the installer on demand.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electronDir = dirname(require.resolve('electron/package.json'))
const pathFile = join(electronDir, 'path.txt')

if (existsSync(pathFile)) {
    process.exit(0)
}

console.log('[studio] Electron binary not installed yet — downloading…')
const result = spawnSync('node', [join(electronDir, 'install.js')], {
    stdio: 'inherit',
    cwd: electronDir,
})

if (result.status !== 0 || !existsSync(pathFile)) {
    console.error('[studio] Electron download failed. Retry with: node ' + join(electronDir, 'install.js'))
    process.exit(1)
}
console.log('[studio] Electron ready.')
