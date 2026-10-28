/**
 * Builds documented (not hardware-verified) camera profiles from camera-catalog/camera-lines.json.
 *
 * A line profile represents a whole catalog line with one model and keeps every line quirk. A model
 * profile represents one catalog model: it inherits its line's quirks, drops the quirks the catalog
 * scopes to other models or to a libgphoto2 flag the model lacks, and adds the model's own
 * libgphoto2 device flags as cited reference quirks.
 *
 * DeviceInfo lists the ISO 15740 mandatory operations, InitiateCapture when libgphoto2 marks the
 * model capture-capable, and the opcodes its quirks document; the lists are marked incomplete, so
 * undocumented requests report missing data instead of OperationNotSupported.
 */
import {
    formatCode,
    parseCode,
    type CameraProfile,
    type ProfileQuirk,
    type QuirkBehaviour,
    type RecordedExchange,
} from '@transport/simulated/camera-profile'
import {
    shortLineName,
    slug,
    type CameraCatalog,
    type CatalogLine,
    type CatalogManufacturer,
    type CatalogModel,
    type CatalogQuirk,
} from './camera-catalog'

export const DOCUMENTED_SUFFIX = '-documented'
const CATALOG_LOCATION = 'packages/link/camera-catalog/camera-lines.json'
const GPHOTO_FLAG_MEANINGS =
    'https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp-bugs.h#L28'

/** ISO 15740 operations every PTP responder must implement. */
const MANDATORY_OPERATIONS = [0x1001, 0x1002, 0x1003, 0x1004, 0x1005, 0x1006, 0x1007, 0x1008, 0x1009]
const INITIATE_CAPTURE = 0x100e
const REJECT_CAPTURE: QuirkBehaviour = { kind: 'rejects-operations', operations: ['0x100e'], response: '0x2005' }

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
    'canon-early-dslr-no-capture': { behaviour: REJECT_CAPTURE },
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
    'gopro-no-capture': { behaviour: REJECT_CAPTURE },
    'fuji-xt30-no-tether': { behaviour: REJECT_CAPTURE },
    'fuji-xe5-no-capture': { behaviour: REJECT_CAPTURE },
    // Standard PTP/IP on TCP 15740 (catalog global quirk ptpip-standard-port, libgphoto2 ptpip.c).
    'sony-ptpip-vendor-id': {
        behaviour: {
            kind: 'ptp-ip-personality',
            port: 15740,
            vendorExtensionId: '0xffffffff',
            manufacturer: 'Sony Corporation',
        },
    },
    'theta-ptpip': { behaviour: { kind: 'ptp-ip-personality', port: 15740 } },
}

/**
 * Line quirks the catalog states for particular models only: either the models carrying a libgphoto2
 * flag ("on flagged profiles") or models named in the quirk's description.
 */
const MODEL_SCOPED_QUIRKS: Record<string, (model: CatalogModel, flags: string[]) => boolean> = {
    'canon-delete-sends-event': (_, flags) => flags.includes('PTPBUG_DELETE_SENDS_EVENT'),
    'coolpix-no-capture-complete': (_, flags) => flags.includes('PTP_NO_CAPTURE_COMPLETE'),
    'leica-no-capture-complete': (_, flags) => flags.includes('PTP_NO_CAPTURE_COMPLETE'),
    'nikon-d3xxx-hidden-ops': model => /\bD3[0-2]\d\d\b/.test(model.name),
    'coolpix-a-hidden-ops': model => /\bCoolpix A(?![\w])/i.test(model.name),
    'fuji-xt30-no-tether': model => /\bX-T30\b/.test(model.name),
    'fuji-xs10-webcam-only': model => /\bX-(?:S10|M5)\b/.test(model.name),
    'fuji-xe5-no-capture': model => /\bX-E5\b/.test(model.name),
}

/** What libgphoto2's ptp-bugs.h and library.c state for the device flags that appear in the catalog. */
const GPHOTO_FLAG_DESCRIPTIONS: Record<string, string> = {
    PTP_CAP: 'libgphoto2 marks this model capture-capable (PTP_CAP).',
    PTP_CAP_PREVIEW: 'libgphoto2 marks this model as supporting preview capture (PTP_CAP_PREVIEW).',
    PTPBUG_DELETE_SENDS_EVENT: 'libgphoto2 flags that this model sends ObjectRemoved after DeleteObject.',
    PTP_NO_CAPTURE_COMPLETE: 'libgphoto2 flags that InitiateCapture yields no CaptureComplete event.',
    PTP_NIKON_BROKEN_CAP: 'libgphoto2 flags Nikon vendor capture as broken on this model (PTP_NIKON_BROKEN_CAP).',
    PTP_DONT_CLOSE_SESSION:
        'libgphoto2 does not close the PTP session on exit for this model (PTP_DONT_CLOSE_SESSION).',
    PTP_NIKON_1: 'libgphoto2 treats this model as a Nikon 1-class body (PTP_NIKON_1).',
    PTP_OLYMPUS_XML: 'libgphoto2 uses the Olympus XML-wrapped protocol for this model (PTP_OLYMPUS_XML).',
}

/**
 * libgphoto2 device flags as the C expression in library.c spells them. The catalog split that
 * expression on "|", so commented-out flags arrive as fragments ("0/*PTP_CAP", "PTP_CAP_PREVIEW*\/");
 * this rejoins them, drops C comments and keeps the flags that are in effect.
 */
export function effectiveGphotoFlags(model: CatalogModel): { flags: string[]; commentedOut: string[] } {
    const expression = (model.gphotoFlags ?? []).join('|')
    const commented = [...expression.matchAll(/\/\*([\s\S]*?)(?:\*\/|$)/g)].flatMap(
        match => (match[1] ?? '').match(/\bPTP[A-Z0-9_]+\b/g) ?? []
    )
    const active = expression.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '').match(/\bPTP[A-Z0-9_]+\b/g) ?? []
    return { flags: [...new Set(active)], commentedOut: [...new Set(commented)] }
}

/** The newest capture-capable model (libgphoto2 lists models oldest first), else the newest PTP model. */
export function representativeModel(line: CatalogLine): CatalogModel | undefined {
    const candidates = line.models.filter(model => model.ptpSupported === true && model.usbProductId)
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

function manufacturerName(manufacturer: CatalogManufacturer): string {
    return manufacturer.name.replace(/ \(other\)$/, '')
}

export type DocumentedScope = 'line' | 'model'

interface BuildOptions {
    scope: DocumentedScope
    /** Overrides the generated id, e.g. to keep model ids unique when libgphoto2 lists a name twice. */
    id?: string
}

function modelQuirkWiring(quirkId: string, model: CatalogModel): QuirkWiring {
    if (quirkId !== 'sony-sdio-connect-handshake' || !/\b(?:A6700|ILCE-6700|FX2|ILME-FX2)\b/i.test(model.name))
        return QUIRK_WIRING[quirkId] ?? {}
    const sequence = [1, 2, 3].map(phase => ({ operation: '0x9201', parameters: [formatCode(phase, 1), '0x0', '0x0'] }))
    return {
        accepts: sequence,
        behaviour: {
            kind: 'requires-sequence',
            sequence,
            gated: { from: '0x9200', to: '0x92ff', except: ['0x9201', '0x9202', '0x9210', '0x9216'] },
        },
    }
}

function appliesTo(quirk: CatalogQuirk, model: CatalogModel): boolean {
    return MODEL_SCOPED_QUIRKS[quirk.id]?.(model, effectiveGphotoFlags(model).flags) ?? true
}

/** A line profile keeps every line quirk; a model profile keeps those that apply to its model. */
function quirksFor(line: CatalogLine, model: CatalogModel, scope: DocumentedScope): CatalogQuirk[] {
    return scope === 'line' ? line.quirks : line.quirks.filter(quirk => appliesTo(quirk, model))
}

export function buildDocumentedProfile(
    manufacturer: CatalogManufacturer,
    line: CatalogLine,
    model: CatalogModel,
    options: BuildOptions = { scope: 'line' }
): CameraProfile {
    const sources: CameraProfile['provenance']['sources'] = [{ location: CATALOG_LOCATION }, { location: model.source }]
    const cite = (location: string) => {
        const existing = sources.findIndex(source => source.location === location)
        return existing >= 0 ? existing : sources.push({ location }) - 1
    }

    const quirks: ProfileQuirk[] = []
    const exchanges: RecordedExchange[] = []
    const operations = new Set(MANDATORY_OPERATIONS)
    const events = new Set<number>()
    const { flags, commentedOut } = effectiveGphotoFlags(model)
    if (flags.includes('PTP_CAP')) operations.add(INITIATE_CAPTURE)

    for (const quirk of quirksFor(line, model, options.scope)) {
        // A line profile lists quirks scoped to other models for reference only.
        const wiring = appliesTo(quirk, model) ? modelQuirkWiring(quirk.id, model) : {}
        const source =
            wiring.behaviour?.kind === 'requires-sequence'
                ? cite('packages/link/camera-catalog/sdk-evidence.json#sony-sdio-phases')
                : cite(quirk.sources[0] ?? CATALOG_LOCATION)
        quirk.sources.slice(1).forEach(cite)
        quirks.push({
            id: quirk.id,
            description:
                wiring.behaviour?.kind === 'requires-sequence'
                    ? 'SDK USB control initialization uses ordered SDIO phases 1, 2 and 3 with exact parameters. Missing prerequisite responses and negotiation payloads remain unknown; no firmware behavior is inferred.'
                    : quirk.description,
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
    if (options.scope === 'model') quirks.push(...modelFlagQuirks(flags, commentedOut, cite))

    // A documented parameter value (EOS M remote mode 0x15) supersedes a generic acceptance of the same operation.
    const specific = new Set(exchanges.filter(exchange => exchange.parameters).map(exchange => exchange.operation))
    const documentedExchanges = exchanges.filter(exchange => exchange.parameters || !specific.has(exchange.operation))

    const vendorExtension = vendorExtensionId(manufacturer)
    const lineName = shortLineName(manufacturer, line)
    const defaultId =
        options.scope === 'line'
            ? `${slug(manufacturerName(manufacturer))}-${slug(lineName)}${DOCUMENTED_SUFFIX}`
            : `${slug(manufacturerName(manufacturer))}-${slug(model.name)}`
    return {
        schemaVersion: 1,
        id: options.id ?? defaultId,
        manufacturer: manufacturerName(manufacturer),
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

/**
 * The model's libgphoto2 device flags, for reference. Each cites the model's library.c entry (source 1),
 * which spells the flag; ptp-bugs.h, which defines the flags, is added to the profile's sources.
 */
function modelFlagQuirks(flags: string[], commentedOut: string[], cite: (location: string) => number): ProfileQuirk[] {
    cite(GPHOTO_FLAG_MEANINGS)
    const quirks: ProfileQuirk[] = flags.map(flag => ({
        id: `gphoto-flag-${slug(flag)}`,
        description: GPHOTO_FLAG_DESCRIPTIONS[flag] ?? `libgphoto2 sets device flag ${flag} for this model.`,
        source: 1,
        behaviour: { kind: 'none' },
        ...(!GPHOTO_FLAG_DESCRIPTIONS[flag] && { unverified: true }),
    }))
    if (commentedOut.length) {
        quirks.push({
            id: 'gphoto-flags-commented-out',
            description: `libgphoto2 lists ${commentedOut.join(', ')} for this model inside a comment, so they are not in effect.`,
            source: 1,
            behaviour: { kind: 'none' },
            unverified: true,
        })
    }
    return quirks
}

export interface CatalogModelMock {
    manufacturer: CatalogManufacturer
    line: CatalogLine
    model: CatalogModel
    profile: CameraProfile
}

export interface CatalogModelSkip {
    manufacturer: string
    line: string
    model: string
    reason: string
}

/**
 * One documented model profile per catalog model with a USB product ID and PTP support.
 * Model names libgphoto2 lists more than once (one per product ID) get the product ID appended to their id.
 */
export function catalogModelMocks(catalog: CameraCatalog): { mocks: CatalogModelMock[]; skipped: CatalogModelSkip[] } {
    const mocks: CatalogModelMock[] = []
    const skipped: CatalogModelSkip[] = []
    const used = new Set<string>()
    for (const manufacturer of catalog.manufacturers) {
        for (const line of manufacturer.lines) {
            for (const model of line.models) {
                const identity = { manufacturer: manufacturer.name, line: line.name, model: model.name }
                if (model.ptpSupported !== true) {
                    const reason =
                        model.ptpSupported === false
                            ? 'catalog marks it ptpSupported: false'
                            : 'PTP support unknown (USB identity only)'
                    if (model.usbProductId || model.ptpSupported === false) {
                        skipped.push({ ...identity, reason })
                        continue
                    }
                }
                if (!model.usbVendorId || !model.usbProductId) {
                    skipped.push({ ...identity, reason: 'no USB vendor/product ID in the catalog' })
                    continue
                }
                const base = `${slug(manufacturerName(manufacturer))}-${slug(model.name)}`
                const id = used.has(base) ? `${base}-${slug(model.usbProductId)}` : base
                used.add(id)
                mocks.push({
                    manufacturer,
                    line,
                    model,
                    profile: buildDocumentedProfile(manufacturer, line, model, { scope: 'model', id }),
                })
            }
        }
    }
    return { mocks, skipped }
}
