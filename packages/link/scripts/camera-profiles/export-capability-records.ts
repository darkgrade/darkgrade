/**
 * Writes a support matrix as newline-delimited JSON, one record per camera and capability, for
 * loading into BigQuery with the schema in camera-lab/bigquery-schema.json.
 *
 *   bun run compat:records -- --input test-results/camera-support-matrix.json --tier simulation \
 *       --revision <sha> --output test-results/simulation.ndjson
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { capabilityRecords, type SupportMatrix } from './support-matrix'

const argumentsList = process.argv.slice(2)
const valueAfter = (flag: string) => {
    const index = argumentsList.indexOf(flag)
    return index >= 0 ? argumentsList[index + 1] : undefined
}
const input = valueAfter('--input')
const tier = valueAfter('--tier')
const output = valueAfter('--output')
if (!input || !tier || !output) {
    console.error(
        'Usage: compat:records -- --input <matrix.json> --tier <simulation|hardware> --output <file.ndjson> [--revision <sha>]'
    )
    process.exit(2)
}
const matrix = JSON.parse(readFileSync(path.resolve(input), 'utf8')) as SupportMatrix
const records = capabilityRecords(matrix, tier, valueAfter('--revision'))
writeFileSync(path.resolve(output), records.map(record => JSON.stringify(record)).join('\n') + '\n')
console.log(`Wrote ${records.length} records to ${output}`)
