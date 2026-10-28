import type { ObservedTransport } from '@scripts/camera-profiles/camera-capabilities'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'
import type { TransportType } from '@transport/interfaces/transport-types'
import type { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'

const RESPONSE_CONTAINER = 3
const CONTAINER_HEADER_BYTES = 12

/**
 * Delegates to a real transport and records every PTP response code it receives, so the capability
 * classifier can tell a camera's OperationNotSupported apart from a darkgrade failure on hardware.
 */
export class ResponseRecordingTransport implements TransportInterface, ObservedTransport {
    /** A physical camera always answers; nothing is ever missing from a profile here. */
    readonly missingData: readonly { message: string }[] = []
    readonly responseCodes: number[] = []

    constructor(private readonly inner: TransportInterface) {}

    connect(device?: DeviceDescriptor): Promise<void> {
        return this.inner.connect(device)
    }

    disconnect(): Promise<void> {
        return this.inner.disconnect()
    }

    send(data: Uint8Array, sessionId: number, transactionId: number): Promise<void> {
        return this.inner.send(data, sessionId, transactionId)
    }

    async receive(maxLength: number, sessionId: number, transactionId: number): Promise<Uint8Array> {
        const data = await this.inner.receive(maxLength, sessionId, transactionId)
        this.recordResponses(data)
        return data
    }

    isConnected(): boolean {
        return this.inner.isConnected()
    }

    classRequestReset(): Promise<void> {
        return this.inner.classRequestReset()
    }

    getType(): TransportType {
        return this.inner.getType()
    }

    isLittleEndian(): boolean {
        return this.inner.isLittleEndian()
    }

    on(handler: (event: PTPEvent) => void): void {
        this.inner.on?.(handler)
    }

    off(handler: (event: PTPEvent) => void): void {
        this.inner.off?.(handler)
    }

    /** A USB read can hold a data container followed by the response container. */
    private recordResponses(data: Uint8Array): void {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        for (let offset = 0; offset + CONTAINER_HEADER_BYTES <= data.byteLength;) {
            const length = view.getUint32(offset, true)
            if (view.getUint16(offset + 4, true) === RESPONSE_CONTAINER) {
                this.responseCodes.push(view.getUint16(offset + 6, true))
            }
            if (length < CONTAINER_HEADER_BYTES) return
            offset += length
        }
    }
}
