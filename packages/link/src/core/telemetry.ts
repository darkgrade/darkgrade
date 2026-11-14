import type { createApplicationDiagnostics } from '@darkgrade/contribute/application'
import type { ProtocolEvidence } from '@darkgrade/contribute/protocol'
import { cameraHardwareFingerprint, type CameraContext } from '@darkgrade/contribute/schema'
import type { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'

declare const __LINK_TELEMETRY_REVISION__: string
declare const __LINK_TELEMETRY_DIRTY__: boolean
type Diagnostics = Awaited<ReturnType<typeof createApplicationDiagnostics>>
let configured: Diagnostics | undefined
let sourceBuild: Promise<{ revision: string; dirty: boolean } | undefined> | undefined
export async function linkBuildMetadata() {
    if (typeof __LINK_TELEMETRY_REVISION__ !== 'undefined')
        return { revision: __LINK_TELEMETRY_REVISION__, dirty: __LINK_TELEMETRY_DIRTY__ }
    // Bench tools execute this source directly. Resolve its own checkout, never the caller's cwd.
    if (typeof process === 'undefined' || !process.versions?.node) return
    return (sourceBuild ??= (async () => {
        try {
            const { execFileSync } = await import('node:child_process')
            const { fileURLToPath } = await import('node:url')
            const cwd = fileURLToPath(new URL('../../../../', import.meta.url))
            const git = (args: string[]) =>
                execFileSync('git', args, {
                    cwd,
                    timeout: 1000,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore'],
                }).trim()
            const revision = git(['rev-parse', 'HEAD'])
            if (!/^[a-f0-9]{40}$/.test(revision)) return
            return { revision, dirty: git(['status', '--porcelain', '--untracked-files=no']).length > 0 }
        } catch {
            // Unattributed source must not masquerade as a published build.
            return
        }
    })())
}
async function diagnosticsClient() {
    const node = typeof process !== 'undefined' && !!process.versions?.node
    return configured ?? (node ? await (await import('@darkgrade/contribute/settings')).nodeDiagnostics() : undefined)
}

/** Browser applications can supply their own persistent store using contribute/application. */
export function configureLinkTelemetry(client: Diagnostics | undefined) {
    configured = client
}

/** Observes the existing connection. Never opens a session or blocks camera work on an upload. */
export function linkTelemetry(source: TransportInterface) {
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
                    await resetIdentity()
                    return (observed?.transport ?? source).connect(...args)
                }
            const current = observed?.transport as unknown as TransportInterface | undefined
            const owner = current && key in current ? current : target
            const value = Reflect.get(owner, key, owner)
            return typeof value === 'function' ? value.bind(owner) : value
        },
    })
    const resetIdentity = async () => {
        identity = undefined
        await observer.identify({ manufacturer: 'Unknown', model: 'Unknown', deviceVersion: 'unknown' })
    }
    const observer = {
        transport,
        /** Stable for one identified body and build; undefined until this connection has read identity. */
        identity: () => identity,
        protocol(protocol: ProtocolEvidence, operation?: number) {
            try {
                const write = protocol.type === 'property-write'
                observed?.record({ protocol, kind: write ? 'command' : 'data', direction: write ? 'out' : 'in', code: operation,
                    ...(write && { transactionId: protocol.transactionId }),
                    bytes: 0, durationMilliseconds: 0,
                    failed: write && (protocol.outcome === 'error' || protocol.response !== 0x2001) })
            } catch { /* Optional evidence never changes camera behavior. */ }
        },
        operation<Result>(name: string, work: () => Promise<Result>): Promise<Result> {
            return observed ? observed.operation(name, work) : work()
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
                const build = client && (await linkBuildMetadata())
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
                else observed = client.observe(source, context)
                observed.transport.on?.(relay)
                identity = next
            } catch {
                // A failed replacement must restore native events even after the old observer detached.
                observed?.detach()
                observed = undefined
                identity = undefined
                source.on?.(relay)
            }
        },
    }
    return observer
}

/** SDK calls are named operations, not invented PTP packets. Arguments/results never enter records. */
export function sdkTelemetry(evidence: 'hardware' | 'synthetic' = 'hardware') {
    let model = 'Unknown'
    let hardwareFingerprint: string | undefined
    let sessionId = globalThis.crypto?.randomUUID?.()
    let transport: 'usb' | 'wifi' | 'unknown' = 'unknown'
    return {
        async operation(command: Record<string, string>, work: () => Promise<Record<string, unknown>>) {
            const started = performance.now()
            if (['connect', 'connect_wifi', 'connect_bluetooth_direct'].includes(command.cmd)) {
                sessionId = globalThis.crypto?.randomUUID?.()
                model = 'Unknown'
                hardwareFingerprint = undefined
                transport = command.cmd === 'connect' ? 'usb' : 'wifi'
            }
            let failed = false
            try {
                const result = await work()
                if (
                    command.cmd === 'connect' &&
                    typeof result.model === 'string' &&
                    /^(?:ILCE|ILME|DSC|NEX)-[A-Za-z0-9-]{1,40}$/.test(result.model)
                )
                    model = result.model
                if (command.cmd === 'connect' && result.ok === true && evidence === 'hardware' && model !== 'Unknown') {
                    // The SDK bridge selects a device by this exact USB serial before acknowledging connection.
                    try {
                        hardwareFingerprint = await cameraHardwareFingerprint({
                            manufacturer: 'Sony',
                            model,
                            serialNumber: command.serial,
                        })
                    } catch {
                        hardwareFingerprint = undefined
                    }
                }
                if (
                    ['connect_wifi', 'connect_bluetooth_direct'].includes(command.cmd) &&
                    ['ILCE-6700', 'ILME-FX2'].includes(command.model)
                )
                    model = command.model
                return result
            } catch (error) {
                failed = true
                throw error
            } finally {
                try {
                    if (/^[a-z_]{1,40}$/.test(command.cmd)) {
                        const client = await diagnosticsClient()
                        const build = client && (await linkBuildMetadata())
                        if (build)
                            client?.record(
                                {
                                    ...(hardwareFingerprint && { hardwareFingerprint }),
                                    manufacturer: 'Sony',
                                    model,
                                    firmware: 'unknown',
                                    revision: build.revision,
                                    dirty: build.dirty,
                                    transport,
                                    backend: 'vendor-api',
                                    evidence,
                                },
                                {
                                    kind: 'command',
                                    operation:
                                        command.cmd === 'command' &&
                                        command.id === '1' &&
                                        ['0', '1'].includes(command.param)
                                            ? command.param === '1'
                                                ? 'record_start'
                                                : 'record_stop'
                                            : command.cmd,
                                    direction: 'out',
                                    bytes: 0,
                                    failed,
                                    durationMilliseconds: Math.min(3_600_000, Math.round(performance.now() - started)),
                                    occurredAt: new Date().toISOString(),
                                    sessionId,
                                }
                            )
                    }
                } catch {
                    /* SDK behavior must not depend on telemetry or settings availability. */
                }
                if (command.cmd === 'disconnect') {
                    model = 'Unknown'
                    hardwareFingerprint = undefined
                }
            }
        },
    }
}
