import { cameraHardwareFingerprint } from '@contribute/schema'
import { attributedCallId } from '@core/call-context'
import { diagnosticsClient, slateBuildMetadata } from '@core/telemetry'
import { isSonyModelName } from '@vendors/sony/model-name'

const sdkOperationName = (command: Record<string, string>) =>
    command.cmd !== 'command' || command.id !== '1' || !['0', '1'].includes(command.param)
        ? command.cmd
        : command.param === '1'
          ? 'record_start'
          : 'record_stop'

/** SDK calls are named operations, not invented PTP packets. Arguments/results never enter records. */
export function sdkTelemetry(evidence: 'hardware' | 'synthetic' = 'hardware') {
    let model = 'Unknown'
    let hardwareFingerprint: string | undefined
    let sessionId = globalThis.crypto?.randomUUID?.()
    let transport: 'usb' | 'wifi' | 'unknown' = 'unknown'
    let awaitingWifiConnect = false
    return {
        async operation(command: Record<string, string>, work: () => Promise<Record<string, unknown>>) {
            const started = performance.now()
            const callId = attributedCallId()
            // A Wi-Fi connection begins with the trust (fingerprint) step; it belongs to the same
            // session as the connect that follows it.
            const continuesWifi = awaitingWifiConnect && command.cmd !== 'connect' && command.cmd !== 'fingerprint'
            if (['connect', 'connect_wifi', 'connect_bluetooth_direct', 'fingerprint'].includes(command.cmd) && !continuesWifi) {
                sessionId = globalThis.crypto?.randomUUID?.()
                model = 'Unknown'
                hardwareFingerprint = undefined
                transport = command.cmd === 'connect' ? 'usb' : 'wifi'
            }
            awaitingWifiConnect = command.cmd === 'fingerprint'
            // The caller names the body it is reaching over Wi-Fi; a failed attempt is still about that body.
            if (['connect_wifi', 'connect_bluetooth_direct', 'fingerprint'].includes(command.cmd) &&
                isSonyModelName(command.model)) model = command.model
            let failed = false
            try {
                const result = await work()
                if (command.cmd === 'connect' && isSonyModelName(result.model)) model = result.model
                if (command.cmd === 'connect' && result.ok === true && evidence === 'hardware' && model !== 'Unknown') {
                    // The SDK bridge selects a device by this exact USB serial before acknowledging connection.
                    try {
                        const body = { manufacturer: 'Sony', model, serialNumber: command.serial }
                        hardwareFingerprint = await cameraHardwareFingerprint(body)
                    } catch {
                        hardwareFingerprint = undefined
                    }
                }
                if (['connect_wifi', 'connect_bluetooth_direct'].includes(command.cmd) && isSonyModelName(command.model))
                    model = command.model
                return result
            } catch (error) {
                failed = true
                throw error
            } finally {
                try {
                    if (/^[a-z_]{1,40}$/.test(command.cmd)) {
                        const client = await diagnosticsClient()
                        const build = client && (await slateBuildMetadata())
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
                                    operation: sdkOperationName(command),
                                    direction: 'out',
                                    bytes: 0,
                                    failed,
                                    durationMilliseconds: Math.min(3_600_000, Math.round(performance.now() - started)),
                                    occurredAt: new Date().toISOString(),
                                    sessionId,
                                    ...(callId && { callId }),
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
