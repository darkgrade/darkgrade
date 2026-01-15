export * from './device.interface'
export * from './transport-types'

import { DeviceDescriptor } from './device.interface'
import { TransportType } from './transport-types'

export interface PTPEvent {
    code: number
    transactionId: number
    parameters: number[]
}

export interface TransportInterface {
    connect(device?: DeviceDescriptor): Promise<void>
    disconnect(): Promise<void>
    send(data: Uint8Array, sessionId: number, transactionId: number): Promise<void>
    receive(maxLength: number, sessionId: number, transactionId: number): Promise<Uint8Array>
    isConnected(): boolean
    classRequestReset(): Promise<void>
    getType(): TransportType

    /**
     * Get endianness for this transport
     * USB uses little-endian (per PIMA 15740), IP uses big-endian (per PTP spec)
     */
    isLittleEndian(): boolean

    on?(handler: (event: PTPEvent) => void): void
    off?(handler: (event: PTPEvent) => void): void
}
