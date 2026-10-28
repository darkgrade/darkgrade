/**
 * Combines the one-camera matrices written by lab:hardware into one hardware support matrix.
 *
 *   bun run lab:results -- --input <directory of *.json> --output test-results/camera-lab-matrix.json
 */
import { countStatuses, type SupportMatrix } from '@scripts/camera-profiles/support-matrix'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { packageDirectory } from './camera-registry'

const argumentsList = process.argv.slice(2)
const valueAfter = (flag: string) => {
    const index = argumentsList.indexOf(flag)
    return index >= 0 ? argumentsList[index + 1] : undefined
}

function jsonFiles(directory: string): string[] {
    return readdirSync(directory)
        .sort()
        .flatMap(entry => {
            const full = path.join(directory, entry)
            if (statSync(full).isDirectory()) return jsonFiles(full)
            return entry.endsWith('.json') ? [full] : []
        })
}

const input = path.resolve(valueAfter('--input') ?? path.join(packageDirectory, 'test-results/camera-lab'))
const output = path.resolve(
    valueAfter('--output') ?? path.join(packageDirectory, 'test-results/camera-lab-matrix.json')
)
const matrices = jsonFiles(input).map(file => JSON.parse(readFileSync(file, 'utf8')) as SupportMatrix)
const rows = matrices.flatMap(matrix => matrix.rows.filter(row => row.fidelity === 'hardware'))
if (rows.length === 0) {
    console.error(`No hardware results under ${input}`)
    process.exit(1)
}
const combined: SupportMatrix = {
    generatedAt: new Date().toISOString(),
    ...(matrices[0]?.revision && { revision: matrices[0].revision }),
    capabilities: matrices[0].capabilities,
    rows,
    lines: [],
    totals: { hardware: countStatuses(rows) },
}
writeFileSync(output, `${JSON.stringify(combined, null, 2)}\n`)
console.log(`Combined ${rows.length} cameras into ${path.relative(process.cwd(), output)}`)
