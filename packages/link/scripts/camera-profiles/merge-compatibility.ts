/**
 * Merges the simulation support matrix with the latest device-lab hardware matrix, when present,
 * into one camera × capability table (JSON and Markdown).
 *
 *   bun run compat:merge [-- --simulation test-results/camera-support-matrix.json
 *                            --hardware test-results/camera-lab-matrix.json
 *                            --output test-results/camera-compatibility.json]
 *
 * A missing hardware file is not an error: the merged matrix then holds captured and documented rows.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeCompatibility, renderCompatibility } from './compatibility-matrix'
import type { SupportMatrix } from './support-matrix'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argumentsList = process.argv.slice(2)
const valueAfter = (flag: string) => {
    const index = argumentsList.indexOf(flag)
    return index >= 0 ? argumentsList[index + 1] : undefined
}

const simulationPath = path.resolve(
    valueAfter('--simulation') ?? path.join(packageDirectory, 'test-results/camera-support-matrix.json')
)
const hardwarePath = path.resolve(
    valueAfter('--hardware') ?? path.join(packageDirectory, 'test-results/camera-lab-matrix.json')
)
const output = path.resolve(
    valueAfter('--output') ?? path.join(packageDirectory, 'test-results/camera-compatibility.json')
)

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as SupportMatrix
const hardware = existsSync(hardwarePath) ? read(hardwarePath) : undefined
const merged = mergeCompatibility(read(simulationPath), hardware, {
    simulation: path.relative(packageDirectory, simulationPath),
    ...(hardware && { hardware: path.relative(packageDirectory, hardwarePath) }),
})
writeFileSync(output, `${JSON.stringify(merged, null, 2)}\n`)
writeFileSync(output.replace(/\.json$/, '.md'), renderCompatibility(merged))
const counts = Object.entries(merged.totals).map(([fidelity, totals]) => `${totals.cameras} ${fidelity}`)
console.log(
    `Merged ${merged.cameras.length} cameras (${counts.join(', ')}) into ${path.relative(process.cwd(), output)}`
)
