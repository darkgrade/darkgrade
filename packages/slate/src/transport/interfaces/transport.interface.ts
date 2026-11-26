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
    /**
     * Resets the device's USB port and releases it, as if it were unplugged and replugged.
     * Clears a pipe a crashed host left mid-transfer, which a Device Reset Request does not.
     * The transport must be connected again afterwards.
     */
    resetPort?(): Promise<void>
    getType(): TransportType
    /**
     * The connection as `Camera.getInfo()` reports it, for a transport that is not what getType() implies
     * (Sony's authenticated SDK channel runs over Wi-Fi IP but is not PTP/IP). Without it: USB or PTP/IP.
     */
    connectionKind?(): 'usb' | 'wifi' | 'ip'

    /**
     * Get endianness for this transport
     * PTP datasets and both USB and PTP/IP packet fields use little-endian encoding.
     */
    isLittleEndian(): boolean

    on?(handler: (event: PTPEvent) => void): void
    off?(handler: (event: PTPEvent) => void): void
}
