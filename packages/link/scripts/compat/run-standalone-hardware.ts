/** Physical compatibility checks delegate to the deployed bench's guarded read-only runner. */
import { loadRegistry, packageDirectory, validateRegistry } from '@scripts/camera-lab/camera-registry'
import { refreshMergedMatrix } from '@scripts/camera-profiles/refresh-matrices'
import { resolveGuardedLabCamera } from '@scripts/camera-profiles/standalone-run'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const argumentsList = process.argv.slice(2)
const valueAfter = (flag: string) => {
    const index = argumentsList.indexOf(flag)
    return index >= 0 ? argumentsList[index + 1] : undefined
}
const registry = loadRegistry()
const problems = validateRegistry(registry)
if (problems.length) throw new Error(problems.join('\n'))
const camera = resolveGuardedLabCamera(registry, {
    usb: valueAfter('--usb')?.toLowerCase(),
    profile: valueAfter('--profile'),
    ip: valueAfter('--ip'),
})
const output = path.join(packageDirectory, 'test-results/camera-lab', `${camera.id}.json`)
console.log(`Running guarded read-only session and GetDeviceInfo checks for ${camera.model} on ${camera.host}`)
const child = spawnSync(
    process.execPath,
    [
        'run',
        path.join(packageDirectory, 'scripts/camera-lab/run-hardware-suite.ts'),
        '--camera',
        camera.id,
        '--output',
        output,
    ],
    { stdio: 'inherit', env: process.env }
)
if (child.error) throw child.error
if (existsSync(output) && !argumentsList.includes('--no-merge')) refreshMergedMatrix()
process.exitCode = child.status ?? 1
