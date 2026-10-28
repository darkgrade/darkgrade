/** Profile selection, tallies and the Markdown report for chaos runs. */
import { loadProfileIndex } from '@scripts/camera-profiles/profile-index'
import { CHAOS_FIXTURE_PROFILE } from '@scripts/chaos/chaos-fixture'
import type { ChaosScenarioResult, FindingKind } from '@scripts/chaos/chaos-scenario'
import type { CameraProfile } from '@transport/simulated/camera-profile'

export function chaosProfiles(scope: 'committed' | 'models' | 'all' = 'committed'): CameraProfile[] {
    const indexed = [...loadProfileIndex().values()]
    const committed = indexed.filter(entry => !entry.path.startsWith('catalog:')).map(entry => entry.profile)
    const models = indexed.filter(entry => entry.path.startsWith('catalog:')).map(entry => entry.profile)
    const selected = scope === 'committed' ? committed : scope === 'models' ? models : [...committed, ...models]
    return [CHAOS_FIXTURE_PROFILE, ...selected]
}

export const FINDING_KINDS: FindingKind[] = [
    'hang',
    'crash',
    'untyped-error',
    'silent-acceptance',
    'transaction-id-drift',
    'event-handler-crash',
    'listener-leak',
    'unhandled-rejection',
    'not-recoverable',
]

export function summarize(results: ChaosScenarioResult[]): Record<FindingKind, number> {
    const counts = Object.fromEntries(FINDING_KINDS.map(kind => [kind, 0])) as Record<FindingKind, number>
    for (const result of results) for (const finding of result.findings) counts[finding.kind]++
    return counts
}

export function renderChaosMarkdown(results: ChaosScenarioResult[], seeds: number[]): string {
    const counts = summarize(results)
    const byFault = new Map<string, ChaosScenarioResult[]>()
    for (const result of results) byFault.set(result.fault, [...(byFault.get(result.fault) ?? []), result])
    const lines = [
        '# Chaos run',
        '',
        `${results.length} scenarios (${new Set(results.map(result => result.profile)).size} profiles × ` +
            `${byFault.size} faults × seeds ${seeds.join(', ')}). Faults are injected by SimulatedTransport ` +
            'chaos mode; they are not recorded camera behaviour.',
        '',
        '| Finding | Count |',
        '| --- | --- |',
        ...FINDING_KINDS.map(kind => `| ${kind} | ${counts[kind]} |`),
        '',
        '| Fault | Scenarios | Faults injected | Scenarios with findings | Recovered |',
        '| --- | --- | --- | --- | --- |',
        ...[...byFault].map(([fault, entries]) => {
            const injected = entries.reduce((total, entry) => total + entry.injected, 0)
            const withFindings = entries.filter(entry => entry.findings.length > 0).length
            const recovered = entries.filter(entry => entry.recovered).length
            return `| ${fault} | ${entries.length} | ${injected} | ${withFindings} | ${recovered}/${entries.length} |`
        }),
        '',
        '## Distinct findings',
        '',
    ]
    const distinct = new Map<string, { count: number; example: string }>()
    for (const result of results) {
        for (const finding of result.findings) {
            const key = `${finding.kind} · ${result.fault} · ${finding.step} · ${finding.detail.replace(/\d+/g, 'N').slice(0, 160)}`
            const entry = distinct.get(key) ?? { count: 0, example: `${result.profile} seed ${result.seed}` }
            entry.count++
            distinct.set(key, entry)
        }
    }
    for (const [key, { count, example }] of [...distinct].sort((left, right) => right[1].count - left[1].count)) {
        lines.push(`- ${count}× ${key} (e.g. ${example})`)
    }
    if (distinct.size === 0) lines.push('None.')
    return `${lines.join('\n')}\n`
}
