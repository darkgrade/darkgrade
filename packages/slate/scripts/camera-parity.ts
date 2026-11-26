/**
 * What each vendor is missing against Sony, from Slate's own code, plus the last real-camera run.
 * Usage: bun run --cwd packages/slate camera:parity [-- --results /tmp/camera-api-check.json] [--out FILE]
 *
 * - Operations: whether the vendor's driver implements each public Camera operation.
 * - Settings: whether the vendor's property maps carry each setting (Nikon: photo or movie mode).
 * - Measured: the outcome of each step in the last `camera:api-check` run, when its results exist.
 * - Studio: which of those Studio uses, so the gaps that block Canon/Nikon parity in Studio come first.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Camera } from '@camera/index'
import { cameraControlDefinitions, type CameraControlId } from '@camera/controls'
import { protocolSession } from '@camera/protocol-session'
import { typedSettingIds } from '@camera/settings/typed-settings'
import { surfaceOperations } from '@runtime/operations'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import {
    canonControlProperties,
    nikonMovieControlProperties,
    nikonPhotoControlProperties,
    sonyControlProperties,
} from '@vendors/control-properties'

const argument = (flag: string) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined)
const resultsPath = argument('--results') ?? '/tmp/camera-api-check.json'
const outputPath = argument('--out')

const vendors = [
    { key: 'sony', label: 'Sony', vendorId: 0x054c },
    { key: 'canon', label: 'Canon', vendorId: 0x04a9 },
    { key: 'nikon', label: 'Nikon', vendorId: 0x04b0 },
] as const
type VendorKey = (typeof vendors)[number]['key']

/** photoVideoMode is composed from several observations on Sony and Canon (`@vendors/photo-video-mode`), not one mapped property. */
const composedSettings: Partial<Record<VendorKey, readonly CameraControlId[]>> = { sony: ['photoVideoMode'], canon: ['photoVideoMode'] }
const settingMaps: Record<VendorKey, readonly object[]> = {
    sony: [sonyControlProperties],
    canon: [canonControlProperties],
    nikon: [nikonPhotoControlProperties, nikonMovieControlProperties],
}

const offlineTransport = { isLittleEndian: () => true, on: () => {}, off: () => {} } as unknown as TransportInterface
const drivers = Object.fromEntries(
    vendors.map(vendor => [vendor.key, protocolSession(new Camera({ vendorId: vendor.vendorId, transport: offlineTransport })).driver])
) as Record<VendorKey, object>

const settingIds = typedSettingIds as readonly CameraControlId[]
const capitalized = (id: string) => id[0]!.toUpperCase() + id.slice(1)
/** Every vendor has these through the shared protocol core, and the typed accessors are covered by Settings. */
const sharedByAll = new Set(['discover', 'connect', 'disconnect', 'recover', 'getInfo', 'getCapabilities', 'setControl',
    ...settingIds.flatMap(id => [`get${capitalized(id)}`, `set${capitalized(id)}`])])
const operations = surfaceOperations().map(operation => operation.name).filter(name => !sharedByAll.has(name))

const implementsOperation = (vendor: VendorKey, name: string) => typeof (drivers[vendor] as Record<string, unknown>)[name] === 'function'
const carriesSetting = (vendor: VendorKey, id: CameraControlId) =>
    composedSettings[vendor]?.includes(id) || settingMaps[vendor].some(map => id in map)

/** One api-check step outcome per vendor and public name: the setter's step if any, else the getter's. */
interface Step { step: string; outcome: string; detail: string }
const measured = new Map<string, Map<string, Step>>()
let measuredNote = `No real-camera results at ${resultsPath}; run \`bun run camera:api-check\` first to add them.`
if (existsSync(resultsPath)) {
    const results = JSON.parse(readFileSync(resultsPath, 'utf8')) as { vendor: string; model?: string; checkedAt?: string; steps: Step[] }[]
    const when = (result: { checkedAt?: string }) => (result.checkedAt ?? statSync(resultsPath).mtime.toISOString()).slice(0, 16).replace('T', ' ')
    measuredNote = `Measured by camera:api-check: ${results.map(result => `${result.vendor} ${result.model ?? ''} (${when(result)} UTC)`.replace(/ +/g, ' ')).join(', ')}. Results depend on the body's mode and lens.`
    for (const result of results) {
        const byName = new Map<string, Step>()
        for (const step of result.steps) {
            const name = step.step.includes(' overlay') ? `${step.step.split(' ')[0]} overlay` : step.step.split(' ')[0]!
            if (!byName.has(name) || step.outcome !== 'pass') byName.set(name, step)
        }
        measured.set(result.vendor, byName)
    }
}
function measuredOutcome(vendor: VendorKey, name: string, kind: 'operation' | 'setting'): string {
    const steps = measured.get(vendor)
    if (!steps) return ''
    const step = kind === 'setting' ? (steps.get(`set${capitalized(name)}`) ?? steps.get(`get${capitalized(name)}`)) : steps.get(name)
    if (!step) return ''
    if (step.outcome === 'pass') return ' (works)'
    if (step.outcome === 'read-only') return ' (read-only now)'
    if (step.outcome === 'fail') return ' (failed)'
    return /current mode|reports a value/.test(step.detail) ? ' (not in this mode)' : ' (unsupported)'
}

/** What Studio's source mentions: setting ids as string literals and Camera methods called on a camera. */
function studioUses(): Set<string> {
    const studio = join(import.meta.dirname, '../../../apps/studio/src')
    const used = new Set<string>()
    if (!existsSync(studio)) return used
    const walk = (directory: string): string[] =>
        readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
            entry.isDirectory() ? walk(join(directory, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(directory, entry.name)] : []
        )
    const source = walk(studio).map(file => readFileSync(file, 'utf8')).join('\n')
    for (const id of settingIds) if (source.includes(`'${id}'`)) used.add(id)
    for (const name of operations) if (new RegExp(`camera\\??\\.${name}\\(`).test(source)) used.add(name)
    if (/getLiveViewFrame\(\{\s*overlay: true/.test(source)) used.add('getLiveViewFrame overlay')
    return used
}
const studio = studioUses()

/** `true`/`false` from Slate's code; `undefined` where only a real camera can say (an operation option). */
interface Row { name: string; kind: 'operation' | 'setting'; label: string; support: Record<VendorKey, boolean | undefined> }
const measuredSupport = (vendor: VendorKey, name: string) => {
    const step = measured.get(vendor)?.get(name)
    return step ? step.outcome === 'pass' : undefined
}
const rows: Row[] = [
    ...operations.map(name => ({
        name, kind: 'operation' as const, label: name,
        support: Object.fromEntries(vendors.map(vendor => [vendor.key, implementsOperation(vendor.key, name)])) as Record<VendorKey, boolean>,
    })),
    {
        name: 'getLiveViewFrame overlay', kind: 'operation' as const, label: 'getLiveViewFrame({ overlay: true }) (camera on-screen display)',
        support: Object.fromEntries(vendors.map(vendor => [vendor.key, measuredSupport(vendor.key, 'getLiveViewFrame overlay')])) as Record<VendorKey, boolean | undefined>,
    },
    ...settingIds.map(id => ({
        name: id, kind: 'setting' as const, label: `${cameraControlDefinitions[id].label} (\`${id}\`)`,
        support: Object.fromEntries(vendors.map(vendor => [vendor.key, carriesSetting(vendor.key, id)])) as Record<VendorKey, boolean>,
    })),
]

/** The measured note only where the code supports it: it says whether it works in the body's current mode. */
const cell = (row: Row, vendor: VendorKey) =>
    row.support[vendor] === undefined ? '?' : row.support[vendor] ? `✓${measuredOutcome(vendor, row.name, row.kind)}` : '✗'
const table = (selected: Row[], withStudio: boolean) => [
    `| ${withStudio ? '' : 'Kind | '}Feature | Sony | Canon | Nikon${withStudio ? '' : ' | Studio uses'} |`,
    `| ${withStudio ? '' : '--- | '}--- | --- | --- | ---${withStudio ? '' : ' | ---'} |`,
    ...selected.map(row =>
        `| ${withStudio ? '' : `${row.kind} | `}${row.label} | ${cell(row, 'sony')} | ${cell(row, 'canon')} | ${cell(row, 'nikon')}${withStudio ? '' : ` | ${studio.has(row.name) ? 'yes' : ''}`} |`
    ),
]

const gap = (row: Row) => row.support.sony && (!row.support.canon || !row.support.nikon)
const studioGaps = rows.filter(row => gap(row) && studio.has(row.name))
const otherGaps = rows.filter(row => gap(row) && !studio.has(row.name))
const missingEverywhere = rows.filter(row => !row.support.sony && (!row.support.canon || !row.support.nikon))
const count = (vendor: VendorKey, kind: Row['kind']) =>
    `${rows.filter(row => row.kind === kind && row.support[vendor]).length}/${rows.filter(row => row.kind === kind).length}`

const report = [
    '# Vendor parity',
    '',
    `✓ Slate implements it for that vendor · ✗ it doesn't · ? not measured. In brackets: what the last real-camera run saw. ${measuredNote}`,
    '',
    `Operations: Sony ${count('sony', 'operation')}, Canon ${count('canon', 'operation')}, Nikon ${count('nikon', 'operation')}. ` +
        `Settings: Sony ${count('sony', 'setting')}, Canon ${count('canon', 'setting')}, Nikon ${count('nikon', 'setting')}.`,
    '',
    `## Needed for Canon and Nikon parity with Sony in Studio (${studioGaps.length})`,
    '',
    'Sony has these, Studio uses them, and Canon or Nikon does not.',
    '',
    ...table(studioGaps, true),
    '',
    `## Other gaps against Sony (${otherGaps.length})`,
    '',
    ...(otherGaps.length ? table(otherGaps, true) : ['None.']),
    '',
    `## Missing on Sony too (${missingEverywhere.length})`,
    '',
    ...(missingEverywhere.length ? table(missingEverywhere, true) : ['None.']),
    '',
    '## Everything',
    '',
    ...table(rows, false),
    '',
].join('\n')

if (outputPath) writeFileSync(outputPath, report)
console.log(report)
