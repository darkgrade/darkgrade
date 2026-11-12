import type { createApplicationDiagnostics } from '@darkgrade/contribute/application'
import type { CameraContext } from '@darkgrade/contribute/schema'
import type { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'

declare const __LINK_TELEMETRY_REVISION__: string
declare const __LINK_TELEMETRY_DIRTY__: boolean
type Diagnostics = Awaited<ReturnType<typeof createApplicationDiagnostics>>
let configured: Diagnostics | undefined
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
            const current = observed?.transport as unknown as TransportInterface | undefined
            const owner = current && key in current ? current : target
            const value = Reflect.get(owner, key, owner)
            return typeof value === 'function' ? value.bind(owner) : value
        },
    })
    return {
        transport,
        async prepare() {
            if (!identity) await this.identify({ manufacturer: 'Unknown', model: 'Unknown', deviceVersion: 'unknown' })
        },
        async identify(info: { manufacturer: string; model: string; deviceVersion: string }) {
            // Custom/simulated transports require explicit configuration; never label them physical hardware.
            const hardware =
                (source as TransportInterface & { telemetryEvidence?: string }).telemetryEvidence === 'hardware'
            if (!hardware && !configured) return
            const next = JSON.stringify([info.manufacturer, info.model, info.deviceVersion])
            if (next === identity) return
            try {
                const client = await diagnosticsClient()
                if (!client || typeof __LINK_TELEMETRY_REVISION__ === 'undefined') return
                const context: CameraContext = {
                    manufacturer: info.manufacturer,
                    model: info.model,
                    firmware: info.deviceVersion || 'unknown',
                    revision: __LINK_TELEMETRY_REVISION__,
                    dirty: __LINK_TELEMETRY_DIRTY__,
                    transport: source.getType() === 'usb' ? 'usb' : 'ptp-ip',
                    evidence: hardware ? 'hardware' : 'synthetic',
                }
                observed?.detach()
                observed = client.observe(source, context)
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
}

/** SDK calls are named operations, not invented PTP packets. Arguments/results never enter records. */
export function sdkTelemetry(evidence: 'hardware' | 'synthetic' = 'hardware') {
    let model = 'Unknown'
    let sessionId = globalThis.crypto?.randomUUID?.()
    let transport: 'usb' | 'sony-sdk' = 'sony-sdk'
    return {
        async operation(command: Record<string, string>, work: () => Promise<Record<string, unknown>>) {
            const started = performance.now()
            if (['connect', 'connect_wifi', 'connect_bluetooth_direct'].includes(command.cmd)) {
                sessionId = globalThis.crypto?.randomUUID?.()
                model = 'Unknown'
                transport = command.cmd === 'connect' ? 'usb' : 'sony-sdk'
            }
            let failed = false
            try {
                const result = await work()
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
                    if (typeof __LINK_TELEMETRY_REVISION__ !== 'undefined' && /^[a-z_]{1,40}$/.test(command.cmd)) {
                        const client = await diagnosticsClient()
                        client?.record(
                            {
                                manufacturer: 'Sony',
                                model,
                                firmware: 'unknown',
                                revision: __LINK_TELEMETRY_REVISION__,
                                dirty: __LINK_TELEMETRY_DIRTY__,
                                transport,
                                evidence,
                            },
                            {
                                kind: 'command',
                                operation: command.cmd,
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
                if (command.cmd === 'disconnect') model = 'Unknown'
            }
        },
    }
}
