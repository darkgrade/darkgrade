/**
 * Regenerates the camera compatibility section of the repository README from the merged matrix.
 *
 *   bun run test:simulation && bun run compat:merge && bun run compat:readme
 *   bun run compat:readme -- --input test-results/camera-compatibility.json --readme ../../README.md
 *
 * Only the text between the camera-compatibility markers changes.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderReadmeCompatibility, replaceReadmeSection, type CompatibilityMatrix } from './compatibility-matrix'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argumentsList = process.argv.slice(2)
const valueAfter = (flag: string) => {
    const index = argumentsList.indexOf(flag)
    return index >= 0 ? argumentsList[index + 1] : undefined
}

const input = path.resolve(
    valueAfter('--input') ?? path.join(packageDirectory, 'test-results/camera-compatibility.json')
)
const readme = path.resolve(valueAfter('--readme') ?? path.join(packageDirectory, '../../README.md'))
const matrix = JSON.parse(readFileSync(input, 'utf8')) as CompatibilityMatrix
writeFileSync(readme, replaceReadmeSection(readFileSync(readme, 'utf8'), renderReadmeCompatibility(matrix)))
console.log(`Updated ${path.relative(process.cwd(), readme)} from ${matrix.cameras.length} cameras`)
