import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { createApplicationDiagnostics } from '@contribute/application'
import type { ProtocolEvidence } from '@contribute/protocol'
import {
    cameraHardwareFingerprint,
    isSafeArgumentText,
    redactMessage,
    type ApiCall,
    type ApiCallArgument,
    type ApiCallError,
    type CameraContext,
    type DiagnosticEntry,
} from '@contribute/schema'
import {
    attributedCallId,
    callAttribution,
    callFinished,
    enclosingCall,
    defaultCallSurface,
    runInCall,
    surfaceCall,
    type CallScope,
    type CallSurface,
} from '@core/call-context'
import { PTPResponseError } from '@core/ptp-errors'
import type { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'

declare const __SLATE_TELEMETRY_REVISION__: string
declare const __SLATE_TELEMETRY_DIRTY__: boolean
type Diagnostics = Awaited<ReturnType<typeof createApplicationDiagnostics>>
let configured: Diagnostics | undefined
let sourceBuild: Promise<{ revision: string; dirty: boolean } | undefined> | undefined
export async function slateBuildMetadata() {
    if (typeof __SLATE_TELEMETRY_REVISION__ !== 'undefined')
        return { revision: __SLATE_TELEMETRY_REVISION__, dirty: __SLATE_TELEMETRY_DIRTY__ }
    // Bench tools execute this source directly. Resolve its own checkout, never the caller's cwd.
    if (typeof process === 'undefined' || !process.versions?.node) return
    return (sourceBuild ??= (async () => {
        try {
            const { execFileSync } = await import('node:child_process')
            const { fileURLToPath } = await import('node:url')
            const cwd = fileURLToPath(new URL('../../../../', import.meta.url))
            const git = (args: string[]) =>
                execFileSync('git', args, { cwd, timeout: 1000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
                    .trim()
            const revision = git(['rev-parse', 'HEAD'])
            if (!/^[a-f0-9]{40}$/.test(revision)) return
            return { revision, dirty: git(['status', '--porcelain', '--untracked-files=no']).length > 0 }
        } catch {
            // Unattributed source must not masquerade as a published build.
            return
        }
    })())
}
/** Facts already shared by this process (custom clients, browsers) or this installation (Node). */
const processFacts = new Map<string, { encoded: string; at: number }>()
let persistentFacts: { fresh(scope: string, key: string, encoded: string): boolean } | null | undefined
type UsbRequest = { vendorId?: number; productId?: number; serialNumber?: string }
type KnownCameraStore = { lookup(usb: UsbRequest): { manufacturer: string; model: string; hardwareFingerprint?: string } | undefined
    remember(usb: UsbRequest, camera: { manufacturer: string; model: string; hardwareFingerprint?: string }): void }
let knownStore: KnownCameraStore | null | undefined
/** Node installations keep it beside their settings; tests and browsers have none unless one is supplied. */
async function knownCameraStore() {
    if (knownStore !== undefined) return knownStore ?? undefined
    if (typeof process === 'undefined' || !process.versions?.node || process.env.NODE_ENV === 'test') return undefined
    knownStore = await import('@contribute/settings').then(settings => settings.sharedKnownCameras(), () => null)
    return knownStore ?? undefined
}
/** Supply or clear the record of which camera each USB identity last reported itself as. */
export function configureKnownCameras(store: KnownCameraStore | undefined) {
    knownStore = store
}
/** Tests and hosts that change collectors can forget what this process reported. */
export function resetReportedFacts() {
    processFacts.clear()
    persistentFacts = undefined
}
/** The telemetry client in use: the configured one, else this Node installation's own. */
export async function diagnosticsClient() {
    const node = typeof process !== 'undefined' && !!process.versions?.node
    return configured ?? (node ? await (await import('@contribute/settings')).nodeDiagnostics() : undefined)
}

/** Browser applications can supply their own persistent store using contribute/application. */
export function configureSlateTelemetry(client: Diagnostics | undefined) {
    configured = client
}

/** Observes the existing connection. Never opens a session or blocks camera work on an upload. */
export function slateTelemetry(source: TransportInterface) {
    let observed: ReturnType<Diagnostics['observe']> | undefined
    let identity: string | undefined
    let listener: ((event: PTPEvent) => void) | undefined
    const relay = (event: PTPEvent) => listener?.(event)
    const transport = new Proxy(source, {
        get(target, key) {
            if (key === 'on')
                return (handler: (event: PTPEvent) => void) => {
                    listener = handler
                    if (observed) observed.transport.on?.(relay)
                    else source.on?.(relay)
                }
            if (key === 'off')
                return (handler: (event: PTPEvent) => void) => {
                    if (listener === handler) listener = undefined
                }
            if (key === 'connect')
                return async (...args: Parameters<TransportInterface['connect']>) => {
                    requested = (args[0] as { usb?: { filters?: UsbRequest[] } } | undefined)?.usb?.filters?.[0]
                    await resetIdentity()
                    try {
                        return await (observed?.transport ?? source).connect(...args)
                    } catch (error) {
                        // The body never answered, so nothing was read from it. Attribute the failed
                        // attempt to the camera that last reported itself at this USB identity.
                        await attributeFailedConnection().catch(() => {})
                        throw error
                    }
                }
            const current = observed?.transport as unknown as TransportInterface | undefined
            const owner = current && key in current ? current : target
            const value = Reflect.get(owner, key, owner)
            return typeof value === 'function' ? value.bind(owner) : value
        },
    })
    let factScope: string | undefined
    let requested: UsbRequest | undefined
    const attributeFailedConnection = async () => {
        if (!requested || !observed || source.getType() !== 'usb') return
        if (identity && identity !== JSON.stringify(['Unknown', 'Unknown', 'unknown', undefined])) return
        const known = (await knownCameraStore())?.lookup(requested)
        const build = known && (await slateBuildMetadata())
        if (!known || !build) return
        observed.identify({ ...(known.hardwareFingerprint && requested.serialNumber && { hardwareFingerprint: known.hardwareFingerprint }),
            manufacturer: known.manufacturer, model: known.model, firmware: 'unknown', revision: build.revision,
            dirty: build.dirty, transport: 'usb', backend: 'ptp', evidence: 'hardware' })
    }
    const resetIdentity = async () => {
        identity = undefined
        factScope = undefined
        await observer.identify({ manufacturer: 'Unknown', model: 'Unknown', deviceVersion: 'unknown' })
    }
    const observer = {
        transport,
        /** Release instrumentation when vendor selection replaces this driver, without closing USB. */
        detach() {
            if (observed) observed.detach()
            else source.off?.(relay)
            observed = undefined
            listener = undefined
            identity = undefined
            factScope = undefined
        },
        /** False when this unchanging fact about the identified body was already shared recently.
         * Before the connection has read identity, every fact counts as new. */
        newFact(key: string, encoded: string) {
            if (!factScope) return true
            try {
                if (persistentFacts) return persistentFacts.fresh(factScope, key, encoded)
            } catch { /* Fall back to this process's memory. */ }
            const name = factScope + '|' + key, previous = processFacts.get(name), now = Date.now()
            if (previous && previous.encoded === encoded && now - previous.at < 6 * 3_600_000) return false
            if (processFacts.size >= 65_536) processFacts.clear()
            processFacts.set(name, { encoded, at: now })
            return true
        },
        protocol(protocol: ProtocolEvidence, operation?: number) {
            try {
                // A request's evidence sits with its command; what the camera returned, with its data.
                const request = protocol.type === 'property-write' || protocol.type === 'focus-point' || protocol.type === 'transfer'
                const transactionId = 'transactionId' in protocol ? protocol.transactionId : undefined
                observed?.record({ protocol, kind: request ? 'command' : 'data', direction: request ? 'out' : 'in', code: operation,
                    ...(transactionId !== undefined && { transactionId }),
                    bytes: 0, durationMilliseconds: 0,
                    failed: request && (protocol.outcome === 'error' || protocol.response !== 0x2001) })
            } catch { /* Optional evidence never changes camera behavior. */ }
        },
        operation<Result>(name: string, work: () => Promise<Result>): Promise<Result> {
            return observed ? observed.operation(name, work) : work()
        },
        /** A public call's own entry, in this connection's session. Nothing before the connection is observed. */
        record(entry: DiagnosticEntry) {
            try {
                observed?.record(entry)
            } catch { /* Optional evidence never changes camera behavior. */ }
        },
        async prepare() {
            if (!identity || !source.isConnected())
                await this.identify({ manufacturer: 'Unknown', model: 'Unknown', deviceVersion: 'unknown' })
        },
        async identify(info: { manufacturer: string; model: string; deviceVersion: string; serialNumber?: string }) {
            // Custom/simulated transports require explicit configuration; never label them physical hardware.
            const hardware =
                (source as TransportInterface & { telemetryEvidence?: string }).telemetryEvidence === 'hardware'
            if (!hardware && !configured) return
            const next = JSON.stringify([info.manufacturer, info.model, info.deviceVersion, info.serialNumber])
            if (next === identity) return
            try {
                const client = await diagnosticsClient()
                const build = client && (await slateBuildMetadata())
                if (!client || !build) return
                const hardwareFingerprint = hardware ? await cameraHardwareFingerprint(info) : undefined
                const context: CameraContext = {
                    ...(hardwareFingerprint && { hardwareFingerprint }),
                    manufacturer: info.manufacturer,
                    model: info.model,
                    firmware: info.deviceVersion || 'unknown',
                    revision: build.revision,
                    dirty: build.dirty,
                    transport: source.getType() === 'usb' ? 'usb' : 'ptp-ip',
                    backend: 'ptp',
                    evidence: hardware ? 'hardware' : 'synthetic',
                }
                if (observed) observed.identify(context)
                else observed = client.observe(source, context, { callId: attributedCallId })
                observed.transport.on?.(relay)
                identity = next
                // The shared fingerprint, never the raw serial, scopes what was already reported.
                factScope = info.model === 'Unknown' ? undefined
                    : JSON.stringify([hardwareFingerprint ?? [info.manufacturer, info.model], info.deviceVersion, build.revision, context.transport])
                if (hardware && requested && info.model !== 'Unknown')
                    (await knownCameraStore())?.remember(requested, { manufacturer: info.manufacturer, model: info.model,
                        // A fingerprint is one body. Keep it only when the host asked for that exact body.
                        ...(hardwareFingerprint && requested.serialNumber && { hardwareFingerprint }) })
                if (factScope && !configured && persistentFacts === undefined && typeof process !== 'undefined' && process.env.NODE_ENV !== 'test')
                    persistentFacts = await import('@contribute/settings').then(settings => settings.sharedReportedFacts(), () => null)
            } catch {
                // A failed replacement must restore native events even after the old observer detached.
                observed?.detach()
                observed = undefined
                identity = undefined
                factScope = undefined
                source.on?.(relay)
            }
        },
    }
    return observer
}

/** What the instrumentation needs of one public operation (`SurfaceOperation` from the generated table). */
interface InstrumentedOperation {
    name: string
    static?: boolean
    mcpTool: string
    cliCommand: string
    parameters: readonly {
        name: string
        type: string
        argument: number
        property?: string
        choices?: readonly string[]
    }[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'

/** Values only for switches, numbers, listed choices and setting values; ids, times and objects by type alone. */
function describeArguments(operation: InstrumentedOperation, values: readonly unknown[]): ApiCallArgument[] {
    const described: ApiCallArgument[] = []
    for (const parameter of operation.parameters) {
        const holder = values[parameter.argument]
        const value =
            parameter.property === undefined ? holder : isRecord(holder) ? holder[parameter.property] : undefined
        if (value === undefined || described.length >= 8) continue
        const { name } = parameter
        if (typeof value === 'boolean') described.push({ name, type: 'switch', value })
        else if (typeof value === 'number')
            described.push({
                name,
                type: 'number',
                ...(Number.isFinite(value) && { value: Math.round(value * 1e6) / 1e6 }),
            })
        else if (typeof value === 'string') {
            const type = parameter.type === 'choice' ? 'choice' : 'text'
            const kept =
                (type === 'choice' && parameter.choices?.includes(value)) || (type === 'text' && name === 'value')
            described.push({ name, type, ...(kept && isSafeArgumentText(value) && { value }) })
        } else described.push({ name, type: value instanceof Date ? 'time' : 'object' })
    }
    return described
}

function describeError(
    error: unknown,
    response: number | undefined
): { outcome: ApiCall['outcome']; error: ApiCallError } {
    const outcome: ApiCall['outcome'] =
        error instanceof CameraUnsupportedError
            ? 'unsupported'
            : error instanceof CameraRefusedError
              ? 'refused'
              : error instanceof CameraOutcomeUnknownError
                ? 'outcome-unknown'
                : error instanceof TypeError || error instanceof RangeError
                  ? 'invalid-input'
                  : 'error'
    const className = (value: unknown) =>
        isRecord(value) && typeof value.name === 'string' && /^[A-Z][A-Za-z]{2,47}$/.test(value.name)
            ? value.name
            : undefined
    const described: ApiCallError = { type: className(error) ?? 'Error' }
    if (isRecord(error) && typeof error.operation === 'string' && /^[a-zA-Z]{1,48}$/.test(error.operation))
        described.operation = error.operation
    if (error instanceof Error && error.message) described.message = redactMessage(error.message)
    // The first protocol error underneath says what the camera answered.
    let cause: unknown = error
    for (let depth = 0; depth < 4 && isRecord(cause); depth++) {
        if (
            cause instanceof PTPResponseError &&
            Number.isSafeInteger(cause.code) &&
            cause.code >= 0 &&
            cause.code <= 0xffff
        ) {
            described.response = cause.code
            break
        }
        cause = cause.cause
        if (depth === 0 && className(cause)) described.cause = className(cause)
    }
    // A refusal Slate worded itself (no protocol error underneath) still names what the camera answered.
    if (described.response === undefined && outcome === 'refused' && response !== undefined)
        described.response = response
    return { outcome, error: described }
}

/**
 * Wraps every public Camera operation once, so each call the caller makes (not the calls Slate
 * makes inside it) is recorded with its operation, surface, inputs, outcome and duration, and the
 * protocol work under it carries its id. Telemetry never changes a call: no await is added before
 * the method runs, and a failure to record is ignored.
 */
export function instrumentCameraOperations<Target extends object>(
    prototype: Target,
    operations: readonly InstrumentedOperation[],
    driverOf: (camera: Target) => { recordApiCall?(entry: DiagnosticEntry): void } | undefined
): void {
    for (const operation of operations) {
        const method: unknown = Reflect.get(prototype, operation.name)
        if (operation.static || typeof method !== 'function') continue
        const invoke = function (this: Target, surface: CallSurface, values: unknown[]): unknown {
            const id = enclosingCall() ? undefined : globalThis.crypto?.randomUUID?.()
            if (!id) return Reflect.apply(method, this, values)
            const scope: CallScope = { id, active: true }
            const started = performance.now()
            const finish = (failure?: { error: unknown }) => {
                callFinished(scope)
                try {
                    const ended = failure ? describeError(failure.error, scope.response) : undefined
                    const described = describeArguments(operation, values)
                    const call: ApiCall = {
                        operation: operation.name,
                        tool: operation.mcpTool,
                        command: operation.cliCommand,
                        surface,
                        outcome: ended?.outcome ?? 'ok',
                        attribution: callAttribution,
                        ...(described.length && { arguments: described }),
                        ...(ended && { error: ended.error }),
                    }
                    driverOf(this)?.recordApiCall?.({
                        kind: 'call',
                        direction: 'lifecycle',
                        callId: id,
                        call,
                        bytes: 0,
                        failed: call.outcome !== 'ok',
                        durationMilliseconds: Math.min(3_600_000, Math.round(performance.now() - started)),
                    })
                } catch {
                    /* Telemetry never changes the call's result. */
                }
            }
            let result: unknown
            try {
                result = runInCall(scope, () => Reflect.apply(method, this, values))
            } catch (error) {
                finish({ error })
                throw error
            }
            if (!(result instanceof Promise)) {
                finish()
                return result
            }
            return result.then(
                value => (finish(), value),
                (error: unknown) => {
                    finish({ error })
                    throw error
                }
            )
        }
        const instrumented = function (this: Target, ...values: unknown[]): unknown {
            return invoke.call(this, defaultCallSurface(), values)
        }
        Object.defineProperty(instrumented, surfaceCall, {
            value: (target: Target, values: unknown[], surface: CallSurface) => invoke.call(target, surface, values),
        })
        Object.defineProperty(prototype, operation.name, {
            value: instrumented,
            writable: true,
            configurable: true,
            enumerable: false,
        })
    }
}
