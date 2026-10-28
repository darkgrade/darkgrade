/**
 * Combines the one-camera matrices written by lab:hardware into one hardware support matrix.
 *
 *   bun run lab:results -- --input <directory of *.json> --output test-results/camera-lab-matrix.json
 */
import { countStatuses, type SupportMatrix } from '@scripts/camera-profiles/support-matrix'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

/** Aggregate observations without promoting the age or revision of any source row. */
export function combineHardwareMatrices(matrices: SupportMatrix[]): SupportMatrix {
    const rows = matrices.flatMap(matrix =>
        matrix.rows
            .filter(row => row.fidelity === 'hardware')
            .map(row => ({
                ...row,
                source: row.source ?? {
                    generatedAt: matrix.generatedAt,
                    ...(matrix.revision && { revision: matrix.revision }),
                },
            }))
    )
    if (!rows.length) throw new Error('No hardware results in source matrices')
    const revisions = [...new Set(rows.map(row => row.source.revision))]
    return {
        generatedAt: new Date().toISOString(),
        ...(revisions.length === 1 && revisions[0] && { revision: revisions[0] }),
        capabilities: [
            ...new Map(
                matrices.flatMap(matrix => matrix.capabilities).map(capability => [capability.id, capability])
            ).values(),
        ],
        rows,
        lines: [],
        totals: { hardware: countStatuses(rows) },
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const input = path.resolve(valueAfter('--input') ?? path.join(packageDirectory, 'test-results/camera-lab'))
    const output = path.resolve(
        valueAfter('--output') ?? path.join(packageDirectory, 'test-results/camera-lab-matrix.json')
    )
    const matrices = jsonFiles(input).map(file => JSON.parse(readFileSync(file, 'utf8')) as SupportMatrix)
    const combined = combineHardwareMatrices(matrices)
    mkdirSync(path.dirname(output), { recursive: true })
    writeFileSync(output, `${JSON.stringify(combined, null, 2)}\n`)
    console.log(`Combined ${combined.rows.length} observations into ${path.relative(process.cwd(), output)}`)
}
