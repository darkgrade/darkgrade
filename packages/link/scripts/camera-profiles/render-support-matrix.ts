/**
 * Renders the support matrix JSON written by tests/camera-simulation to Markdown.
 *
 *   bun run simulation:matrix [-- --input test-results/camera-support-matrix.json --output <file.md>]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderSupportMatrix, type SupportMatrix } from './support-matrix'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argumentsList = process.argv.slice(2)
const valueAfter = (flag: string) => {
    const index = argumentsList.indexOf(flag)
    return index >= 0 ? argumentsList[index + 1] : undefined
}

const input = path.resolve(
    valueAfter('--input') ?? path.join(packageDirectory, 'test-results/camera-support-matrix.json')
)
const output = path.resolve(valueAfter('--output') ?? input.replace(/\.json$/, '.md'))
const matrix = JSON.parse(readFileSync(input, 'utf8')) as SupportMatrix
writeFileSync(output, renderSupportMatrix(matrix))
console.log(`Wrote ${path.relative(process.cwd(), output)}`)
