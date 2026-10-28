/**
 * Builds captured camera profiles from a darkgrade/test-bench checkout.
 *
 *   bun run profiles:ingest -- --test-bench ../../../test-bench
 *   bun run profiles:ingest -- --test-bench ~/darkgrade-testbench \
 *       --capture canon-eos-r6-mark-iii=/var/lib/darkgrade-testbench/captures/<trace>.pcapng
 *
 * Inputs, in order of fidelity:
 *  1. usbmon captures (--capture profile-id=file[@bus:address]): complete PTP transactions with bytes.
 *  2. Structured evidence in the checkout (*.json / *.jsonl under docs/ and artifacts/):
 *     bench-probe results and darkgrade operation logs.
 *  3. Prose observations transcribed in test-bench-observations.ts, each verified against its excerpt.
 */
import { DeviceInfoCodec } from '@ptp/datasets/device-info-dataset'
import { createCanonRegistry, createNikonRegistry, createPTPRegistry, createSonyRegistry } from '@ptp/registry'
import {
    formatBytes,
    formatCode,
    validateCameraProfile,
    type CameraProfile,
    type ProfileSource,
    type RecordedEvent,
    type RecordedExchange,
} from '@transport/simulated/camera-profile'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'
import { findCatalogLine, loadCatalog, shortLineName, slug, type CameraCatalog } from './camera-catalog'
import {
    benchProbeNote,
    testBenchObservations,
    type CameraObservations,
    type EvidenceReference,
} from './test-bench-observations'
import { extractCapture } from './usbmon-capture'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const STANDARD_PROPERTY_OPERATIONS = new Set([0x1014, 0x1015, 0x1016])

interface Arguments {
    testBench: string
    output: string
    captures: { profileId: string; file: string; address?: { bus: number; address: number } }[]
}

function parseArguments(argv: string[]): Arguments {
    const valueAfter = (flag: string) => {
        const index = argv.indexOf(flag)
        return index >= 0 ? argv[index + 1] : undefined
    }
    const testBench = valueAfter('--test-bench')
    if (!testBench)
        throw new Error('Usage: ingest-test-bench --test-bench <checkout> [--capture id=file[@bus:address]]')
    const captures = argv.flatMap((argument, index) => {
        if (argument !== '--capture') return []
        const match = argv[index + 1]?.match(/^([a-z0-9-]+)=(.+?)(?:@(\d+):(\d+))?$/)
        if (!match) throw new Error(`Invalid --capture ${argv[index + 1]}; expected profile-id=file[@bus:address]`)
        const address = match[3] ? { bus: Number(match[3]), address: Number(match[4]) } : undefined
        return [{ profileId: match[1], file: match[2], address }]
    })
    return {
        testBench: path.resolve(testBench),
        output: path.resolve(valueAfter('--output') ?? path.join(packageDirectory, 'camera-profiles')),
        captures,
    }
}

/** Accumulates one profile and its deduplicated, excerpt-verified sources. */
class ProfileBuilder {
    readonly profile: CameraProfile
    private sourceIndexes = new Map<string, number>()

    constructor(
        private readonly observations: CameraObservations,
        private readonly testBench: string,
        private readonly commit: string,
        catalog: CameraCatalog
    ) {
        const { manufacturer, line } = findCatalogLine(catalog, observations.manufacturer, observations.line)
        this.profile = {
            schemaVersion: 1,
            id: observations.id,
            manufacturer: observations.manufacturer,
            line: shortLineName(manufacturer, line),
            model: observations.model,
            catalog: { manufacturer: manufacturer.name, line: line.name },
            provenance: { fidelity: 'captured', sources: [] },
            properties: [],
            exchanges: [],
            events: [],
            quirks: [],
        }
        this.profile.usb = {
            vendorId: observations.vendorId,
            productIds: observations.productIds,
            source: this.cite(observations.usbEvidence),
        }
        if (observations.firmware) {
            this.cite(observations.firmware.evidence)
            this.profile.firmware = observations.firmware.value
        }
        for (const { evidence, ...property } of observations.properties) {
            this.profile.properties.push({ ...property, source: this.cite(evidence) })
        }
        for (const { evidence, ...exchange } of observations.exchanges) {
            this.addExchange({ ...exchange, source: this.cite(evidence) })
        }
        for (const { evidence, ...quirk } of observations.quirks) {
            this.profile.quirks.push({ ...quirk, source: this.cite(evidence) })
        }
    }

    /** Registers a test-bench excerpt as a source after checking it is still present verbatim. */
    cite(evidence: EvidenceReference): number {
        const text = readFileSync(path.join(this.testBench, evidence.path), 'utf8')
        if (!text.includes(evidence.excerpt)) {
            throw new Error(`${this.observations.id}: excerpt not found in ${evidence.path}: ${evidence.excerpt}`)
        }
        return this.addSource({
            location: `darkgrade/test-bench@${this.commit}:${evidence.path}`,
            excerpt: evidence.excerpt,
        })
    }

    addSource(source: ProfileSource): number {
        const key = `${source.location}\u0000${source.excerpt ?? ''}`
        const existing = this.sourceIndexes.get(key)
        if (existing !== undefined) return existing
        const index = this.profile.provenance.sources.push(source) - 1
        this.sourceIndexes.set(key, index)
        return index
    }

    addExchange(exchange: RecordedExchange): void {
        const key = (candidate: RecordedExchange) =>
            JSON.stringify([candidate.operation, candidate.parameters, candidate.dataFromHost, candidate.response])
        if (!this.profile.exchanges.some(existing => key(existing) === key(exchange)))
            this.profile.exchanges.push(exchange)
    }
}

function testBenchCommit(testBench: string): string {
    return execFileSync('git', ['-C', testBench, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
}

function evidenceFiles(directory: string): string[] {
    return readdirSync(directory).flatMap(entry => {
        const full = path.join(directory, entry)
        if (statSync(full).isDirectory()) return evidenceFiles(full)
        return /\.jsonl?$/.test(entry) ? [full] : []
    })
}

/** Yields every object in a JSON value, including objects serialized inside string fields. */
function* objectsIn(value: unknown): Generator<Record<string, unknown>> {
    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return
        try {
            yield* objectsIn(JSON.parse(trimmed))
        } catch {}
        return
    }
    if (Array.isArray(value)) {
        for (const item of value) yield* objectsIn(item)
        return
    }
    if (!value || typeof value !== 'object') return
    yield value as Record<string, unknown>
    for (const child of Object.values(value)) yield* objectsIn(child)
}

function parseEvidenceFile(file: string): unknown[] {
    const text = readFileSync(file, 'utf8')
    if (file.endsWith('.json')) return [JSON.parse(text)]
    return text.split('\n').flatMap(line => {
        try {
            return line.trim() ? [JSON.parse(line)] : []
        } catch {
            return []
        }
    })
}

function registryFor(manufacturer: string) {
    if (manufacturer === 'Canon') return createCanonRegistry(true)
    if (manufacturer === 'Nikon') return createNikonRegistry(true)
    if (manufacturer === 'Sony') return createSonyRegistry(true)
    return createPTPRegistry(true)
}

const PROBE_PREFIX = 'PTP GetDeviceInfo completed for '

/** Applies bench-probe results: USB identity strings, the reported PTP identity and the OpenSession exchange. */
function applyProbe(builder: ProfileBuilder, probe: Record<string, unknown>, relativePath: string): void {
    const usbDevice = probe.usbDevice as Record<string, string>
    const detail = probe.detail as string
    const source = builder.cite({ path: relativePath, excerpt: detail })
    const profile = builder.profile
    profile.usb = {
        ...profile.usb!,
        manufacturerString: usbDevice.manufacturer,
        productString: usbDevice.product,
    }
    profile.deviceInfo = { ...profile.deviceInfo, reportedIdentity: detail.slice(PROBE_PREFIX.length), source }
    builder.addExchange({
        operation: '0x1002',
        name: 'OpenSession',
        parameters: ['0x1'],
        response: { code: '0x2001' },
        note: benchProbeNote,
        source,
    })
}

/** Applies darkgrade operation logs ({ operation: name, response: code }) recorded against a named camera. */
function applyOperationLog(builder: ProfileBuilder, operations: unknown[], relativePath: string): void {
    const registry = registryFor(builder.profile.manufacturer)
    for (const entry of operations) {
        const { operation, response, params } = entry as { operation?: string; response?: number; params?: unknown }
        const definition = operation ? (registry.operations as Record<string, { code: number }>)[operation] : undefined
        if (!definition || typeof response !== 'number') continue
        builder.addExchange({
            operation: formatCode(definition.code),
            name: operation,
            response: { code: formatCode(response) },
            note: `Logged by darkgrade with decoded parameters ${JSON.stringify(params)}; raw parameters were not recorded.`,
            source: builder.cite({ path: relativePath, excerpt: `"operation": "${operation}"` }),
        })
    }
}

function applyStructuredEvidence(builders: ProfileBuilder[], testBench: string): void {
    const directories = ['docs', 'artifacts'].map(directory => path.join(testBench, directory))
    for (const file of directories.flatMap(evidenceFiles)) {
        const relativePath = path.relative(testBench, file)
        for (const document of parseEvidenceFile(file)) {
            for (const object of objectsIn(document)) {
                const usbDevice = object.usbDevice as Record<string, string> | undefined
                const detail = object.detail
                if (
                    usbDevice &&
                    object.ptpResponsive === true &&
                    typeof detail === 'string' &&
                    detail.startsWith(PROBE_PREFIX)
                ) {
                    const usbId = `0x${usbDevice.vendorId}:0x${usbDevice.productId}`
                    const builder = builders.find(candidate =>
                        candidate.profile.usb!.productIds.some(
                            productId => `${candidate.profile.usb!.vendorId}:${productId}` === usbId
                        )
                    )
                    if (builder) applyProbe(builder, object, relativePath)
                }
                const camera = object.camera
                const operationLogs = Object.values(object).filter(
                    (value): value is Record<string, unknown> =>
                        typeof value === 'object' &&
                        value !== null &&
                        Array.isArray((value as { operations?: unknown }).operations)
                )
                if (typeof camera !== 'string') continue
                const builder = builders.find(
                    candidate => `${candidate.profile.manufacturer} ${candidate.profile.model}` === camera
                )
                if (!builder) continue
                for (const log of operationLogs) applyOperationLog(builder, log.operations as unknown[], relativePath)
            }
        }
    }
}

/** The captured dataset plus its decoded lists, which are complete because they came from the camera. */
function capturedDeviceInfo(data: Uint8Array) {
    const decoded = new DeviceInfoCodec(createPTPRegistry(true)).decode(data).value
    const codes = (values: number[]) => values.map(value => formatCode(value))
    return {
        raw: formatBytes(data),
        manufacturer: decoded.manufacturer,
        model: decoded.model,
        deviceVersion: decoded.deviceVersion,
        vendorExtensionId: formatCode(decoded.vendorExtensionID, 8),
        operationsSupported: codes(decoded.operationsSupportedRaw),
        eventsSupported: codes(decoded.eventsSupportedRaw),
        devicePropertiesSupported: codes(decoded.devicePropertiesSupported),
        listsComplete: true,
    }
}

function applyCapture(builder: ProfileBuilder, file: string, address?: { bus: number; address: number }): void {
    const bytes = new Uint8Array(readFileSync(file))
    const digest = createHash('sha256').update(bytes).digest('hex')
    const extraction = extractCapture(bytes, address)
    const source = builder.addSource({ location: `usbmon capture ${path.basename(file)} (sha256 ${digest})` })
    const profile = builder.profile
    const hex = (values: number[]) => values.map(value => formatCode(value, 1))

    for (const transaction of extraction.transactions) {
        const ok = transaction.response.code === 0x2001
        if (transaction.operation === 0x1001 && ok && transaction.response.data) {
            profile.deviceInfo = { ...profile.deviceInfo, ...capturedDeviceInfo(transaction.response.data), source }
            continue
        }
        const propertyCode = transaction.parameters[0]
        if (transaction.operation === 0x1014 && ok && transaction.response.data && propertyCode !== undefined) {
            const code = formatCode(propertyCode)
            const property = profile.properties.find(candidate => candidate.code === code)
            const descriptor = { raw: formatBytes(transaction.response.data) }
            if (property) Object.assign(property, { descriptor, source })
            else profile.properties.push({ code, descriptor, source })
            continue
        }
        if (STANDARD_PROPERTY_OPERATIONS.has(transaction.operation) && ok) continue
        builder.addExchange({
            operation: formatCode(transaction.operation),
            parameters: hex(transaction.parameters),
            ...(transaction.dataFromHost && { dataFromHost: formatBytes(transaction.dataFromHost) }),
            response: {
                code: formatCode(transaction.response.code),
                ...(transaction.response.parameters.length && { parameters: hex(transaction.response.parameters) }),
                ...(transaction.response.data && { data: formatBytes(transaction.response.data) }),
            },
            source,
        })
    }
    for (const event of extraction.events) {
        if (event.afterOperation === undefined) continue
        const recorded: RecordedEvent = {
            code: formatCode(event.code),
            parameters: hex(event.parameters),
            afterOperation: formatCode(event.afterOperation),
            source,
        }
        if (!profile.events.some(existing => JSON.stringify(existing) === JSON.stringify(recorded)))
            profile.events.push(recorded)
    }
    console.log(
        `${profile.id}: ${extraction.transactions.length} complete transactions, ${extraction.events.length} events, ` +
            `${extraction.skippedIncomplete} incomplete skipped from ${path.basename(file)}`
    )
}

/** Fixed key order so regenerated profiles diff cleanly. */
function canonicalOrder(profile: CameraProfile): CameraProfile {
    const { schemaVersion, id, manufacturer, line, model, usb, firmware, catalog, provenance, deviceInfo } = profile
    return {
        schemaVersion,
        id,
        manufacturer,
        line,
        model,
        ...(usb && { usb }),
        ...(firmware && { firmware }),
        ...(catalog && { catalog }),
        provenance,
        ...(deviceInfo && { deviceInfo }),
        properties: profile.properties,
        exchanges: profile.exchanges,
        events: profile.events,
        quirks: profile.quirks,
    }
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2))
    const commit = testBenchCommit(options.testBench)
    const catalog = loadCatalog()
    const builders = testBenchObservations.map(
        observations => new ProfileBuilder(observations, options.testBench, commit, catalog)
    )

    applyStructuredEvidence(builders, options.testBench)
    for (const capture of options.captures) {
        const builder = builders.find(candidate => candidate.profile.id === capture.profileId)
        if (!builder) throw new Error(`No camera observations for profile ${capture.profileId}`)
        applyCapture(builder, capture.file, capture.address)
    }

    for (const { profile } of builders) {
        const problems = validateCameraProfile(profile)
        if (problems.length) throw new Error(`${profile.id} is invalid:\n  ${problems.join('\n  ')}`)
        const directory = path.join(options.output, slug(profile.manufacturer), slug(profile.line))
        mkdirSync(directory, { recursive: true })
        const file = path.join(directory, `${profile.id}.json`)
        writeFileSync(
            file,
            await format(JSON.stringify(canonicalOrder(profile)), { parser: 'json', tabWidth: 4, printWidth: 120 })
        )
        console.log(
            `${path.relative(packageDirectory, file)}: ${profile.exchanges.length} exchanges, ${profile.quirks.length} quirks`
        )
    }
}

await main()
