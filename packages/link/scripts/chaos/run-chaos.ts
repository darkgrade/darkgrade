/**
 * bun run compat:chaos [-- --seeds 1,2,3] [--faults stall,general-error] [--scope committed|models|all]
 *                        [--output test-results/chaos-report]
 *
 * Runs every committed camera profile (captured and documented line mocks) plus the synthetic chaos
 * fixture through each fault with fixed seeds and writes <output>.json and <output>.md. The run is
 * reproducible: the same seeds, profiles and library code inject the same faults.
 */
import { packageDirectory } from '@scripts/camera-profiles/compat-progress'
import { chaosProfiles, renderChaosMarkdown, summarize } from '@scripts/chaos/chaos-report'
import {
    CHAOS_FAULTS,
    recoversWithoutFaults,
    runChaosScenario,
    type ChaosScenarioResult,
} from '@scripts/chaos/chaos-scenario'
import type { ChaosFault } from '@transport/simulated/chaos-faults'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function option(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`)
    if (index < 0) return undefined
    const value = process.argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`)
    return value
}
const seedValues = (option('seeds') ?? '1,2,3').split(',')
const seeds = seedValues.map(Number)
const faults = (option('faults')?.split(',') as ChaosFault[] | undefined) ?? [...CHAOS_FAULTS]
const scope = (option('scope') ?? 'committed') as 'committed' | 'models' | 'all'
const output = path.resolve(packageDirectory, option('output') ?? 'test-results/chaos-report')
const stepTimeoutMilliseconds = Number(option('step-timeout') ?? 1_500)
if (!['committed', 'models', 'all'].includes(scope)) throw new Error('Choose scope committed, models or all')
if (
    seedValues.some(seed => !/^\d+$/.test(seed)) ||
    seeds.some(seed => !Number.isSafeInteger(seed) || seed > 0xffffffff)
)
    throw new Error('Seeds must be unsigned 32-bit integers')
if (!faults.length || faults.some(fault => !CHAOS_FAULTS.includes(fault)))
    throw new Error(`Choose faults from ${CHAOS_FAULTS.join(', ')}`)
if (!Number.isSafeInteger(stepTimeoutMilliseconds) || stepTimeoutMilliseconds < 1 || stepTimeoutMilliseconds > 600_000)
    throw new Error('Step timeout must be an integer from 1 to 600000 milliseconds')
const results: ChaosScenarioResult[] = []
for (const profile of chaosProfiles(scope)) {
    const expectRecovery = await recoversWithoutFaults(profile)
    for (const fault of faults) {
        for (const seed of seeds) {
            results.push(await runChaosScenario(profile, fault, seed, { expectRecovery, stepTimeoutMilliseconds }))
        }
    }
    process.stdout.write('.')
}
process.stdout.write('\n')
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(`${output}.json`, `${JSON.stringify({ seeds, faults, results }, null, 2)}\n`)
writeFileSync(`${output}.md`, renderChaosMarkdown(results, seeds))
console.log(JSON.stringify(summarize(results)))
console.log(`Wrote ${path.relative(packageDirectory, output)}.{json,md}`)
process.exit(results.some(result => result.findings.length > 0) ? 1 : 0)
