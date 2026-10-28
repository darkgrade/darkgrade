import type { LabCamera } from '@scripts/camera-lab/camera-registry'

export interface BenchStatus {
    hostname: string
    hardwareOwners?: { resource: string; owner: string; expiresAt: number; processId?: number }[]
    jobs: { id?: string; cameraLabel?: string }[]
    recoveries: { cameraLabel: string; status: string }[]
    cameras: {
        label: string
        usbMatch: string
        usbSerial?: string
        plug?: { output?: boolean }
        health: {
            status: string
            usbPresent: boolean
            busy?: boolean
            identityChanged?: boolean
            observedUsbMatch?: string
            observedSerialNumber?: string
            usbDevice?: { serial?: string; vendorId: string; productId: string }
        }
        transport: { mode: string }
    }[]
}

/** Persistent card takes survive the initiating HTTP/MCP request and can outlive a job lease. */
export function assertNoActiveCardTake(
    take: { stage?: string; cameras?: { camera: string; state: string }[] } | undefined,
    label: string
): void {
    const activeStage = ['preparing', 'armed', 'recording', 'stopping', 'collecting'].includes(take?.stage ?? '')
    if (
        take?.cameras?.some(
            camera =>
                camera.camera === label &&
                (activeStage ||
                    ['preparing', 'armed', 'recording', 'stopping', 'uncertain', 'starting', 'collecting'].includes(
                        camera.state
                    ))
        )
    )
        throw new Error('Camera has an active or unconfirmed card recording')
}

/** A fresh status is a precondition, not a replacement for shared ownership and the camera lock. */
export function assertBenchAvailable(status: BenchStatus, entry: LabCamera, owner?: string, jobId?: string): void {
    if (
        owner &&
        !status.hardwareOwners?.some(
            held =>
                held.owner === owner && held.resource === `camera:${entry.benchLabel}` && held.expiresAt > Date.now()
        )
    )
        throw new Error(
            'Bench MCP cannot see this hardware owner; service support or shared state directory is missing'
        )
    if (status.hostname.split('.')[0] !== entry.host) throw new Error('Lab runner is on a different bench host')
    const camera = status.cameras.find(camera => camera.label === entry.benchLabel)
    if (!camera) throw new Error('Lab camera is absent from the deployed bench mapping')
    const expectedUsb = `${entry.usb!.vendorId}:${entry.usb!.productId}`.replaceAll('0x', '').toLowerCase()
    if (camera.usbMatch.toLowerCase() !== expectedUsb)
        throw new Error('Deployed bench USB mapping differs from registry')
    const observedUsb = camera.health.usbDevice
        ? `${camera.health.usbDevice.vendorId}:${camera.health.usbDevice.productId}`
        : camera.health.observedUsbMatch
    if (camera.health.identityChanged || (observedUsb && observedUsb.toLowerCase() !== expectedUsb))
        throw new Error('Live camera identity differs from the deployed mapping')
    const serial = camera.health.usbDevice?.serial ?? camera.health.observedSerialNumber ?? camera.usbSerial
    if (camera.usbSerial && serial && camera.usbSerial !== serial)
        throw new Error('Live USB serial differs from the deployed mapping')
    if (entry.usb?.serial && entry.usb.serial !== serial)
        throw new Error('Deployed camera serial differs from registry')
    if (camera.plug?.output === false || camera.health.status === 'powered-off')
        throw new Error('Camera is intentionally powered off')
    if (!camera.health.usbPresent || camera.transport.mode !== 'usb')
        throw new Error('Camera is not available on USB; no recovery attempted')
    if (
        camera.health.busy ||
        status.jobs.some(job => !(jobId && job.id === jobId) && (!job.cameraLabel || job.cameraLabel === camera.label))
    )
        throw new Error('Camera has an active job or recording; no camera operation attempted')
    if (status.recoveries.some(recovery => recovery.cameraLabel === camera.label && recovery.status === 'running'))
        throw new Error('Camera recovery is running')
    if (
        status.hardwareOwners?.some(
            held => held.resource === `camera:${camera.label}` && held.owner !== owner && held.expiresAt > Date.now()
        )
    )
        throw new Error('Camera is owned by another operation')
}

/** An environment marker alone cannot authorize opening a camera in an independently invoked worker. */
export function assertGuardedWorker(
    status: BenchStatus,
    entry: LabCamera,
    authorization: {
        parentProcessId: number
        owner: string
        jobId: string
    },
    actualParentProcessId: number
): void {
    if (
        !Number.isInteger(authorization.parentProcessId) ||
        authorization.parentProcessId <= 0 ||
        authorization.parentProcessId !== actualParentProcessId ||
        !authorization.owner ||
        !authorization.jobId
    )
        throw new Error('Hardware worker has no verified owning parent')
    assertBenchAvailable(status, entry, authorization.owner, authorization.jobId)
    const owner = status.hardwareOwners?.find(owner => owner.owner === authorization.owner)
    if (owner?.processId !== authorization.parentProcessId)
        throw new Error('Hardware owner belongs to a different process')
    if (!status.jobs.some(job => job.id === authorization.jobId && job.cameraLabel === entry.benchLabel))
        throw new Error('Hardware worker scoped job is missing or expired')
}

export function liveCameraSerial(status: BenchStatus, label: string): string | undefined {
    const camera = status.cameras.find(camera => camera.label === label)
    return camera?.health.usbDevice?.serial ?? camera?.health.observedSerialNumber ?? camera?.usbSerial
}

/** Lease requests never overlap, and stopping drains a late renewal before result publication. */
export function startBenchJobHeartbeat(
    renew: () => Promise<unknown>,
    onLost: () => void,
    intervalMilliseconds = 20_000
) {
    let pending: Promise<void> | undefined
    let failure: unknown
    const timer = setInterval(() => {
        if (pending || failure) return
        pending = Promise.resolve()
            .then(renew)
            .then(() => undefined)
            .catch(error => {
                failure = error instanceof Error ? error : new Error(String(error))
                try {
                    onLost()
                } catch (stopError) {
                    failure = new AggregateError([error, stopError], 'Job lease and worker cancellation failed')
                }
            })
            .finally(() => {
                pending = undefined
            })
    }, intervalMilliseconds)
    return {
        get failure() {
            return failure
        },
        async stop(): Promise<unknown> {
            clearInterval(timer)
            await pending
            return failure
        },
    }
}

/** Deployed loopback MCP; errors and incomplete status fail closed. */
export async function benchTool<T>(name: string, arguments_: Record<string, unknown>): Promise<T> {
    const response = await fetch('http://127.0.0.1:8790/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: arguments_ } }),
        signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Bench MCP ${name}: HTTP ${response.status}`)
    const body = await response.text()
    const messages =
        body.startsWith('data:') || body.includes('\ndata:')
            ? body
                  .split('\n')
                  .filter(line => line.startsWith('data:'))
                  .map(line => JSON.parse(line.slice(5)))
            : [JSON.parse(body)]
    const message = messages.find(message => message.id === 1)
    if (!message?.result || message.error || message.result.isError) throw new Error(`Bench MCP ${name} failed`)
    const content = message.result.content?.find((item: { type: string }) => item.type === 'text')
    if (!content) throw new Error(`Bench MCP ${name} returned no structured result`)
    return JSON.parse(content.text) as T
}
