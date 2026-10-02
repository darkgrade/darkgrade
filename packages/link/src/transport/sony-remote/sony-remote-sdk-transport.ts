import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'

/**
 * The wire channel opened by Sony Camera Remote SDK after SSH authentication.
 *
 * Darkgrade deliberately does not implement Sony's proprietary SSH/64321
 * handshake here. An SDK adapter supplies this channel after validating the
 * camera fingerprint and credentials.
 */
export interface SonyRemoteSdkChannel {
    send(data: Uint8Array, sessionId: number, transactionId: number): Promise<void>
    receive(maxLength: number, sessionId: number, transactionId: number): Promise<Uint8Array>
    disconnect(): Promise<void>
    reset?(): Promise<void>
    on?(handler: (event: PTPEvent) => void): void
    off?(handler: (event: PTPEvent) => void): void
}

export interface SonyRemoteSdkConnectionOptions {
    host: string
    port?: number
    username: string
    password: string
    fingerprint?: string
    timeout?: number
}

export type SonyRemoteSdkChannelFactory = (
    options: SonyRemoteSdkConnectionOptions
) => Promise<SonyRemoteSdkChannel>

/**
 * Transport adapter for an authenticated Sony Camera Remote SDK session.
 *
 * This class is intentionally transport-only. The channel factory is where a
 * supported Sony SDK binding belongs; keeping it injected lets the core remain
 * usable without bundling Sony's platform-specific SDK or retaining secrets.
 */
export class SonyRemoteSdkTransport implements TransportInterface {
    private channel?: SonyRemoteSdkChannel
    private eventHandler?: (event: PTPEvent) => void

    constructor(
        private readonly options: SonyRemoteSdkConnectionOptions,
        private readonly createChannel: SonyRemoteSdkChannelFactory
    ) {}

    isConnected(): boolean {
        return this.channel !== undefined
    }

    getType(): TransportType {
        // The authenticated SDK channel is carried over IP, but is not PTP/IP.
        return TransportType.IP
    }

    isLittleEndian(): boolean {
        return true
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        if (this.channel) throw new Error('Sony Remote SDK transport is already connected')
        const host = device?.ip?.host ?? this.options.host
        if (!host) throw new Error('Sony Remote SDK transport requires a camera host')

        const channel = await this.createChannel({
            ...this.options,
            host,
            ...(device?.ip?.port !== undefined && { port: device.ip.port }),
        })
        this.channel = channel
        if (this.eventHandler && channel.on) channel.on(this.eventHandler)
    }

    async disconnect(): Promise<void> {
        const channel = this.channel
        this.channel = undefined
        if (!channel) return
        if (this.eventHandler && channel.off) channel.off(this.eventHandler)
        await channel.disconnect()
    }

    async send(data: Uint8Array, sessionId: number, transactionId: number): Promise<void> {
        await this.requireChannel().send(data, sessionId, transactionId)
    }

    async receive(maxLength: number, sessionId: number, transactionId: number): Promise<Uint8Array> {
        return await this.requireChannel().receive(maxLength, sessionId, transactionId)
    }

    async classRequestReset(): Promise<void> {
        const channel = this.requireChannel()
        if (channel.reset) await channel.reset()
    }

    on(handler: (event: PTPEvent) => void): void {
        this.eventHandler = handler
        if (this.channel?.on) this.channel.on(handler)
    }

    off(handler: (event: PTPEvent) => void): void {
        if (this.eventHandler === handler) this.eventHandler = undefined
        if (this.channel?.off) this.channel.off(handler)
    }

    private requireChannel(): SonyRemoteSdkChannel {
        if (!this.channel) throw new Error('Sony Remote SDK transport is not connected')
        return this.channel
    }
}
