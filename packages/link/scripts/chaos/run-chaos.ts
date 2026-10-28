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
    return index >= 0 ? process.argv[index + 1] : undefined
}
const seeds = (option('seeds') ?? '1,2,3').split(',').map(Number)
const faults = (option('faults')?.split(',') as ChaosFault[] | undefined) ?? [...CHAOS_FAULTS]
const scope = (option('scope') ?? 'committed') as 'committed' | 'models' | 'all'
const output = path.resolve(packageDirectory, option('output') ?? 'test-results/chaos-report')
const stepTimeoutMilliseconds = Number(option('step-timeout') ?? 1_500)
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
process.exit(0)
