/**
 * Chaos suite: fixed seeds, so every run injects the same faults. Faults are protocol violations a
 * broken camera, cable or firmware could produce; none of them is recorded camera behaviour.
 *
 * Profiles: the synthetic chaos fixture (standard property descriptors to corrupt), every captured
 * test-bench profile, and one documented line mock per vendor camera class.
 */
import { GenericCamera } from '@camera/generic-camera'
import { packageDirectory } from '@scripts/camera-profiles/compat-progress'
import { loadProfileIndex } from '@scripts/camera-profiles/profile-index'
import { CHAOS_FIXTURE_PROFILE } from '@scripts/chaos/chaos-fixture'
import { renderChaosMarkdown, summarize } from '@scripts/chaos/chaos-report'
import {
    recoversWithoutFaults,
    runChaosScenario,
    transactionIdDrift,
    type ChaosScenarioResult,
} from '@scripts/chaos/chaos-scenario'
import { CHAOS_FAULTS, ChaosInjector } from '@transport/simulated/chaos-faults'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SEEDS = [1, 2]
const LINE_MOCKS = [
    'canon-eos-r-documented',
    'nikon-z-documented',
    'sony-alpha-full-frame-e-mount-documented',
    'om-system-olympus-pen-compacts-tg-documented',
]
const index = loadProfileIndex()
const profiles = [
    CHAOS_FIXTURE_PROFILE,
    ...[...index.values()]
        .filter(entry => !entry.path.startsWith('catalog:') && entry.profile.provenance.fidelity === 'captured')
        .map(entry => entry.profile),
    ...LINE_MOCKS.map(id => index.get(id)!.profile),
]
/** Libraries with per-transaction timeouts and framing checks must come through every fault clean. */
const robustLibrary =
    typeof (GenericCamera.prototype as { configureTransactions?: unknown }).configureTransactions === 'function'
const options = { stepTimeoutMilliseconds: 400, transactionTimeoutMilliseconds: 100 }

describe('chaos fault injection', () => {
    it('is reproducible: the same seed injects the same faults and yields the same outcome', async () => {
        const first = await runChaosScenario(CHAOS_FIXTURE_PROFILE, 'malformed-dataset', 7, options)
        const second = await runChaosScenario(CHAOS_FIXTURE_PROFILE, 'malformed-dataset', 7, options)
        expect(second.steps).toEqual(first.steps)
        expect(second.injected).toBe(first.injected)
    })

    it('schedules faults from the seed alone', () => {
        const schedule = (seed: number) => {
            const injector = new ChaosInjector({ seed, faults: ['general-error'], probability: 0.5 })
            return Array.from({ length: 20 }, (_, transactionId) =>
                injector.responseOverride({ operation: 0x1001, transactionId, parameters: [] })
            )
        }
        expect(schedule(3)).toEqual(schedule(3))
        expect(schedule(3)).not.toEqual(schedule(4))
    })

    it('flags skipped transaction IDs', () => {
        expect(transactionIdDrift([1, 2, 3, 4])).toEqual([])
        expect(transactionIdDrift([1, 2, 5]).map(finding => finding.detail)).toEqual(['transaction 5 followed 2'])
    })

    it(`runs ${profiles.length} profiles × ${CHAOS_FAULTS.length} faults × seeds ${SEEDS.join(',')}`, async () => {
        const results: ChaosScenarioResult[] = []
        for (const profile of profiles) {
            const expectRecovery = await recoversWithoutFaults(profile)
            for (const fault of CHAOS_FAULTS) {
                for (const seed of SEEDS) {
                    results.push(await runChaosScenario(profile, fault, seed, { ...options, expectRecovery }))
                }
            }
        }
        const output = path.join(packageDirectory, 'test-results/chaos-report')
        mkdirSync(path.dirname(output), { recursive: true })
        writeFileSync(`${output}.json`, `${JSON.stringify({ seeds: SEEDS, results }, null, 2)}\n`)
        writeFileSync(`${output}.md`, renderChaosMarkdown(results, SEEDS))

        // Every fault kind must actually reach darkgrade, or the suite proves nothing.
        const injectedKinds = new Set(results.filter(result => result.injected > 0).map(result => result.fault))
        expect([...injectedKinds].sort()).toEqual([...CHAOS_FAULTS].sort())

        const counts = summarize(results)
        if (robustLibrary) {
            expect(
                results.flatMap(result =>
                    result.findings.map(finding => ({
                        ...finding,
                        profile: result.profile,
                        fault: result.fault,
                        seed: result.seed,
                    }))
                )
            ).toEqual([])
        } else {
            // A library without transaction timeouts hangs when the camera stalls; the suite must see it.
            expect(counts.hang).toBeGreaterThan(0)
        }
    }, 600_000)
})
