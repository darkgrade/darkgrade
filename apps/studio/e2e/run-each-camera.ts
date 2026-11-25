// bun run --cwd apps/studio e2e [-- extra playwright arguments]
//
// Runs the Studio feature walk once per attached USB camera, each inside the shared camera lease with
// DARKGRADE_CAMERA set to that body's VID:PID. A DARKGRADE_CAMERA already in the environment limits the
// run to that one body. Enumeration lists USB descriptors only; it opens no camera session.
import { Camera } from '@darkgrade/slate'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const studioDirectory = resolve(import.meta.dirname, '..')
const slateDirectory = resolve(studioDirectory, '../../packages/slate')
const playwright = join(studioDirectory, 'node_modules/.bin/playwright')
const configuration = join(import.meta.dirname, 'playwright.config.ts')
const hex = (value: number): string => value.toString(16).padStart(4, '0')

async function attachedCameras(): Promise<string[]> {
    if (process.env.DARKGRADE_CAMERA) return [process.env.DARKGRADE_CAMERA]
    const found = await Camera.discover()
    return [...new Set(found.map(camera => `${hex(camera.vendorId)}:${hex(camera.productId)}`))]
}

const cameras = await attachedCameras()
if (cameras.length === 0) throw new Error('No USB camera is attached; connect one in PC Remote mode')
const failed: string[] = []
for (const camera of cameras) {
    process.stderr.write(`studio e2e: walking Studio with ${camera}\n`)
    const result = spawnSync(
        'bun',
        ['run', 'camera:lease', '--', '--purpose', `studio e2e ${camera}`, playwright, 'test', '-c', configuration, ...process.argv.slice(2)],
        { cwd: slateDirectory, stdio: 'inherit', env: { ...process.env, DARKGRADE_CAMERA: camera } }
    )
    if (result.status !== 0) failed.push(camera)
}
if (failed.length > 0) {
    process.stderr.write(`studio e2e: failed for ${failed.join(', ')}; screenshots are in apps/studio/e2e/results\n`)
    process.exit(1)
}
