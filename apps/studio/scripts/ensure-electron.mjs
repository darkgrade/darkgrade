/**
 * Ensures the Electron binary is present before launching dev.
 * Package managers sometimes skip electron's postinstall (which downloads the
 * ~120 MB binary and writes path.txt); electron-vite then fails with
 * "Error: Electron uninstall". This runs the installer on demand.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electronDir = dirname(require.resolve('electron/package.json'))
const pathFile = join(electronDir, 'path.txt')

if (existsSync(pathFile)) {
    brandDevApp()
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
brandDevApp()
console.log('[studio] Electron ready.')

/**
 * In development macOS names the app after the Electron bundle's folder ("Electron" in the Dock and
 * Cmd-Tab). Clone the bundle as "Darkgrade Studio.app" (an APFS clone costs no disk space), give it
 * Studio's name and icon, re-sign it ad hoc, and point electron's path.txt at it so electron-vite
 * launches the branded copy. Packaged builds get both from electron-builder instead.
 */
function brandDevApp() {
    if (process.platform !== 'darwin') return
    const distDir = join(electronDir, 'dist')
    const original = join(distDir, 'Electron.app')
    const branded = join(distDir, 'Darkgrade Studio.app')
    const brandedBinary = 'Darkgrade Studio.app/Contents/MacOS/Electron'
    const icon = join(dirname(new URL(import.meta.url).pathname), '..', 'build', 'icon.icns')
    if (!existsSync(original)) return

    const iconTarget = join(branded, 'Contents', 'Resources', 'electron.icns')
    const upToDate =
        existsSync(branded) &&
        readFileSync(pathFile, 'utf8').trim() === brandedBinary &&
        (!existsSync(icon) || readFileSync(icon).equals(readFileSync(iconTarget)))
    if (upToDate) return

    spawnSync('rm', ['-rf', branded])
    spawnSync('cp', ['-cR', original, branded])
    const plist = join(branded, 'Contents', 'Info.plist')
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
        spawnSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} Darkgrade Studio`, plist])
        spawnSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string Darkgrade Studio`, plist])
    }
    spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleIdentifier com.darkgrade.studio.dev', plist])
    if (existsSync(icon)) copyFileSync(icon, iconTarget)
    spawnSync('codesign', ['--force', '--deep', '--sign', '-', branded])
    spawnSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', branded])
    writeFileSync(pathFile, brandedBinary)
    console.log('[studio] Launching development builds as Darkgrade Studio.')
}
