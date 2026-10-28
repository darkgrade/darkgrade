/**
 * Builds one documented profile per camera line in camera-catalog/camera-lines.json.
 *
 *   bun run profiles:documented
 *
 * Documented profiles come from public references (libgphoto2 tables and vendor SDK pages), not
 * from hardware. Each one represents a line with a single model that has a known USB product ID.
 * Its DeviceInfo lists the ISO 15740 mandatory operations, InitiateCapture when libgphoto2 marks
 * the model capture-capable, and the opcodes its line quirks document; the lists are marked
 * incomplete, so undocumented requests report missing data instead of OperationNotSupported.
 * Lines without a PTP-capable model that has a USB product ID get no profile.
 */
import {
    formatCode,
    parseCode,
    validateCameraProfile,
    type CameraProfile,
    type ProfileQuirk,
    type QuirkBehaviour,
    type RecordedExchange,
} from '@transport/simulated/camera-profile'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'
import {
    loadCatalog,
    shortLineName,
    slug,
    type CatalogLine,
    type CatalogManufacturer,
    type CatalogModel,
} from './camera-catalog'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const profileDirectory = path.join(packageDirectory, 'camera-profiles')
const DOCUMENTED_SUFFIX = '-documented'

/** ISO 15740 operations every PTP responder must implement. */
const MANDATORY_OPERATIONS = [0x1001, 0x1002, 0x1003, 0x1004, 0x1005, 0x1006, 0x1007, 0x1008, 0x1009]
const INITIATE_CAPTURE = 0x100e

interface QuirkWiring {
    behaviour?: QuirkBehaviour
    /** Operations the quirk documents the camera accepting; parameters are omitted unless stated. */
    accepts?: { operation: string; parameters?: string[] }[]
    events?: string[]
}

/**
 * How each catalog quirk drives the simulator. Only behaviour the cited source states is wired;
 * quirks that need state the simulator cannot model from public data stay reference-only.
 */
const QUIRK_WIRING: Record<string, QuirkWiring> = {
    'canon-eos-remote-mode-handshake': {
        behaviour: {
            kind: 'requires-operations',
            unlockedBy: ['0x9114', '0x9115'],
            gated: { from: '0x9100', to: '0x91ff', except: ['0x9108', '0x9114', '0x9115'] },
            response: '0x2019',
        },
        accepts: [{ operation: '0x9114' }, { operation: '0x9115' }],
    },
    'canon-eos-getevent-polling': {
        behaviour: {
            kind: 'event-delivery',
            mode: 'polled',
            pollOperation: '0x9116',
            emptyResponse: '0800000000000000',
        },
    },
    'canon-eos-setpropvalueex': { accepts: [{ operation: '0x9110' }] },
    'canon-eos-liveview': {
        behaviour: { kind: 'device-busy', operation: '0x9153', times: 1, response: '0xa102' },
    },
    'canon-eos-keepalive': { accepts: [{ operation: '0x911d' }] },
    'canon-early-dslr-no-capture': {
        behaviour: { kind: 'rejects-operations', operations: ['0x100e'], response: '0x2005' },
    },
    'canon-eosm-remote-mode-0x15': { accepts: [{ operation: '0x9114', parameters: ['0x15'] }] },
    'canon-eosm-combined-release': { accepts: [{ operation: '0x9128', parameters: ['0x3', '0x0'] }] },
    'canon-delete-sends-event': {
        behaviour: { kind: 'emit-event', afterOperation: '0x100b', event: '0x4003', copyParameters: true },
        accepts: [{ operation: '0x100b' }],
        events: ['0x4003'],
    },
    'nikon-getevent-polling': {
        behaviour: { kind: 'event-delivery', mode: 'polled', pollOperation: '0x90c7', emptyResponse: '0000' },
    },
    'nikon-deviceready-busy': {
        behaviour: { kind: 'device-busy', operation: '0x90c8', times: 1, afterOperation: '0x100e' },
        accepts: [{ operation: '0x90c8' }],
    },
    'nikon-pc-camera-mode': { accepts: [{ operation: '0x90c2' }] },
    'nikon-liveview': {
        behaviour: { kind: 'device-busy', operation: '0x9203', times: 1, afterOperation: '0x9201' },
        accepts: [{ operation: '0x9201' }, { operation: '0x9202' }],
    },
    'nikon-z-application-mode': { accepts: [{ operation: '0x9435' }] },
    'sony-sdio-connect-handshake': { accepts: [{ operation: '0x9201' }, { operation: '0x9210' }] },
    'panasonic-hidden-ops-pid-2382': {
        behaviour: {
            kind: 'hidden-from-device-info',
            operations: ['0x9404', '0x9412', '0x9706', '0x940c', '0x9414', '0x9415'],
        },
    },
    'olympus-omd-capture-0x9481': { accepts: [{ operation: '0x9481' }] },
    'leica-le-session': { accepts: [{ operation: '0x9005' }, { operation: '0x9006' }] },
    'gopro-no-capture': {
        behaviour: { kind: 'rejects-operations', operations: ['0x100e'], response: '0x2005' },
    },
}

/** The newest capture-capable model (libgphoto2 lists models oldest first), else the newest PTP model. */
function representativeModel(line: CatalogLine): CatalogModel | undefined {
    const candidates = line.models.filter(model => model.ptpSupported && model.usbProductId)
    const pinned = line.quirks.some(quirk => quirk.id === 'panasonic-hidden-ops-pid-2382')
        ? candidates.find(model => model.usbProductId?.toLowerCase() === '0x2382')
        : undefined
    const capturing = candidates.filter(model => model.gphotoFlags?.includes('PTP_CAP'))
    return pinned ?? capturing.at(-1) ?? candidates.at(-1)
}

function code(value: string): string {
    return formatCode(parseCode(value.toLowerCase()))
}

function vendorExtensionId(manufacturer: CatalogManufacturer): string | undefined {
    const match = manufacturer.ptpVendorExtensionId?.match(/^0x[0-9a-fA-F]{8}$/)
    return match ? code(match[0]) : undefined
}

function buildProfile(manufacturer: CatalogManufacturer, line: CatalogLine, model: CatalogModel): CameraProfile {
    const sources: CameraProfile['provenance']['sources'] = [
        { location: 'packages/link/camera-catalog/camera-lines.json' },
        { location: model.source },
    ]
    const cite = (location: string) => {
        const existing = sources.findIndex(source => source.location === location)
        return existing >= 0 ? existing : sources.push({ location }) - 1
    }

    const quirks: ProfileQuirk[] = []
    const exchanges: RecordedExchange[] = []
    const operations = new Set(MANDATORY_OPERATIONS)
    const events = new Set<number>()
    if (model.gphotoFlags?.includes('PTP_CAP')) operations.add(INITIATE_CAPTURE)

    for (const quirk of line.quirks) {
        const wiring = QUIRK_WIRING[quirk.id] ?? {}
        const source = cite(quirk.sources[0] ?? 'packages/link/camera-catalog/camera-lines.json')
        quirk.sources.slice(1).forEach(cite)
        quirks.push({
            id: quirk.id,
            description: quirk.description,
            source,
            behaviour: wiring.behaviour ?? { kind: 'none' },
            ...(quirk.unverified && { unverified: true }),
        })
        if (quirk.unverified) continue
        quirk.opcodes?.forEach(opcode => operations.add(parseCode(opcode.toLowerCase())))
        wiring.events?.forEach(event => events.add(parseCode(event)))
        for (const accepted of wiring.accepts ?? []) {
            exchanges.push({
                operation: accepted.operation,
                ...(accepted.parameters && { parameters: accepted.parameters }),
                response: { code: '0x2001' },
                note: `Documented by quirk ${quirk.id}; not observed on hardware.`,
                source,
            })
        }
    }
    // A documented parameter value (EOS M remote mode 0x15) supersedes a generic acceptance of the same operation.
    const specific = new Set(exchanges.filter(exchange => exchange.parameters).map(exchange => exchange.operation))
    const documentedExchanges = exchanges.filter(exchange => exchange.parameters || !specific.has(exchange.operation))

    const vendorExtension = vendorExtensionId(manufacturer)
    const lineName = shortLineName(manufacturer, line)
    const manufacturerName = manufacturer.name.replace(/ \(other\)$/, '')
    return {
        schemaVersion: 1,
        id: `${slug(manufacturerName)}-${slug(lineName)}${DOCUMENTED_SUFFIX}`,
        manufacturer: manufacturerName,
        line: lineName,
        model: model.name,
        usb: { vendorId: code(model.usbVendorId!), productIds: [code(model.usbProductId!)], source: 1 },
        catalog: { manufacturer: manufacturer.name, line: line.name, modelCount: line.models.length },
        provenance: { fidelity: 'documented', sources },
        deviceInfo: {
            manufacturer: manufacturer.name,
            model: model.name,
            ...(vendorExtension && { vendorExtensionId: vendorExtension }),
            operationsSupported: [...operations].sort((left, right) => left - right).map(value => formatCode(value)),
            eventsSupported: [...events].sort((left, right) => left - right).map(value => formatCode(value)),
            devicePropertiesSupported: [],
            listsComplete: false,
            source: 0,
        },
        properties: [],
        exchanges: documentedExchanges,
        events: [],
        quirks,
    }
}

function removeDocumentedProfiles(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name)
        if (entry.isDirectory()) removeDocumentedProfiles(full)
        else if (entry.name.endsWith(`${DOCUMENTED_SUFFIX}.json`)) rmSync(full)
    }
    if (directory !== profileDirectory && readdirSync(directory).length === 0) rmSync(directory, { recursive: true })
}

async function main(): Promise<void> {
    const catalog = loadCatalog()
    removeDocumentedProfiles(profileDirectory)
    for (const manufacturer of catalog.manufacturers) {
        for (const line of manufacturer.lines) {
            const model = representativeModel(line)
            if (!model) {
                console.log(`skipped ${manufacturer.name} / ${line.name}: no PTP model with a USB product ID`)
                continue
            }
            const profile = buildProfile(manufacturer, line, model)
            const problems = validateCameraProfile(profile)
            if (problems.length) throw new Error(`${profile.id} is invalid:\n  ${problems.join('\n  ')}`)
            const directory = path.join(profileDirectory, slug(profile.manufacturer), slug(profile.line))
            mkdirSync(directory, { recursive: true })
            const file = path.join(directory, `${profile.id}.json`)
            writeFileSync(file, await format(JSON.stringify(profile), { parser: 'json', tabWidth: 4, printWidth: 120 }))
            console.log(`${path.relative(packageDirectory, file)}: ${model.name}, ${profile.quirks.length} quirks`)
        }
    }
}

await main()
