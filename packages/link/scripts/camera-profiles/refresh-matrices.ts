/**
 * Rebuilds the combined hardware matrix and the merged compatibility matrix after standalone
 * hardware results change, using the same scripts CI runs (`lab:results`, then `compat:merge`).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { packageDirectory } from './compat-progress'

export function refreshMergedMatrix(): void {
    const hardwareDirectory = path.join(packageDirectory, 'test-results/camera-lab')
    const hasHardware =
        existsSync(hardwareDirectory) && readdirSync(hardwareDirectory).some(name => name.endsWith('.json'))
    if (hasHardware) run(['run', 'lab:results'])
    if (existsSync(path.join(packageDirectory, 'test-results/camera-support-matrix.json'))) run(['run', 'compat:merge'])
    else console.log('No simulation matrix yet; run `bun run test:simulation` before `compat:merge`.')
}

function run(argumentsList: string[]): void {
    const result = spawnSync(process.execPath, argumentsList, { cwd: packageDirectory, stdio: 'inherit' })
    if (result.status !== 0) throw new Error(`bun ${argumentsList.join(' ')} exited with ${result.status}`)
}
