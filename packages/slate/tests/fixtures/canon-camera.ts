import { Logger } from '@core/logger'
import type { PropertyDefinition } from '@ptp/types/property'
import { fakeTransport } from '@tests/fixtures/camera-fixtures'
import { CanonCamera } from '@vendors/canon/canon-camera'

export interface CanonInternals {
    propertyCache: Map<PropertyDefinition, { current?: unknown; allowed?: unknown[] }>
    advertisedPropertyData: Map<PropertyDefinition, Uint8Array[]>
    supportedOperations?: Set<number>
    polling: boolean
    pollingLoop?: Promise<void>
    processEvents(events: { code: number; parameters: number[]; allowedValues?: number[] }[]): void
}

/** A CanonCamera on a fake connected transport; `internals` seeds the session state a connect would read. */
export function canonTestCamera(transportMembers: Record<string, unknown> = {}, operations?: number[]) {
    const transport = fakeTransport({ disconnect: async () => undefined, ...transportMembers })
    const camera = new CanonCamera(transport, new Logger({ renderInTerminal: false, captureConsole: false }))
    const internals = camera as unknown as CanonInternals
    if (operations) internals.supportedOperations = new Set(operations)
    return { camera, transport, internals, cache: internals.propertyCache }
}

/** Answers every transaction OK and records each operation's name. */
export function recordOperations(camera: CanonCamera, code = (_name: string) => 0x2001) {
    const operations: string[] = []
    camera.send = (async operation => {
        operations.push(operation.name)
        return { code: code(operation.name) }
    }) as typeof camera.send
    return operations
}
