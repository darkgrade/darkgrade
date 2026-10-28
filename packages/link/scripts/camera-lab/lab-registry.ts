/**
 * Validates camera-lab/cameras.lab.json and emits the device-lab GitHub Actions matrix.
 *
 *   bun run lab:registry                                   validate and list cameras
 *   bun run lab:registry -- --matrix                       print {"include": [...]} for enabled cameras
 *   bun run lab:registry -- --matrix --github-output       also write matrix/count/hosts to $GITHUB_OUTPUT
 *   bun run lab:registry -- --matrix --only a,b            limit the matrix to these camera ids
 *   bun run lab:registry -- --verify-sources ../test-bench check every cited excerpt still exists
 */
import { appendFileSync } from 'node:fs'
import { labMatrix, loadRegistry, staleSources, validateRegistry } from './camera-registry'

const argumentsList = process.argv.slice(2)
const valueAfter = (flag: string) => {
    const index = argumentsList.indexOf(flag)
    return index >= 0 ? argumentsList[index + 1] : undefined
}

const registry = loadRegistry()
const problems = validateRegistry(registry)
const testBench = valueAfter('--verify-sources')
if (testBench) problems.push(...staleSources(registry, testBench))
if (problems.length) {
    console.error(`cameras.lab.json is invalid:\n  ${problems.join('\n  ')}`)
    process.exit(1)
}

const only = (valueAfter('--only') ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
const unknown = only.filter(id => !registry.cameras.some(camera => camera.id === id))
if (unknown.length) {
    console.error(`Unknown lab cameras: ${unknown.join(', ')}`)
    process.exit(1)
}
const entries = labMatrix(registry).filter(entry => only.length === 0 || only.includes(entry.camera))
if (argumentsList.includes('--matrix')) {
    const matrix = JSON.stringify({ include: entries })
    console.log(matrix)
    const output = process.env.GITHUB_OUTPUT
    if (argumentsList.includes('--github-output') && output) {
        const hosts = new Set(entries.map(entry => entry.host))
        appendFileSync(output, `matrix=${matrix}\ncount=${entries.length}\nhosts=${Math.max(hosts.size, 1)}\n`)
    }
} else {
    for (const camera of registry.cameras) {
        const state = camera.enabled ? `${camera.host} / ${camera.benchLabel}` : `disabled: ${camera.disabledReason}`
        console.log(`${camera.id.padEnd(16)} ${camera.manufacturer} ${camera.model} (${state})`)
    }
    console.log(`${entries.length} of ${registry.cameras.length} cameras are scheduled for the lab tier.`)
}
