import { Logger } from '@core/logger'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import {
    buildDataPacket,
    buildInitCommandRequest,
    buildInitEventRequest,
    buildOperationRequest,
    buildPong,
    buildStartData,
    parseEvent,
    parseInitCommandAck,
    parseResponse,
    parseStartData,
    parseTransactionPayload,
    PTPIPPacket,
    PTPIPPacketType,
    takePTPIPPackets,
} from '@transport/ip/ptpip-packet'
import { USBContainerBuilder, USBContainerType } from '@transport/usb/usb-container'
import type { Socket } from 'node:net'

export interface IPTransportOptions {
    address: string
    port?: number
    localAddress?: string
    timeout?: number
    clientName?: string
    clientGuid?: Uint8Array
    dataPacketSize?: number
}

interface PacketWaiter {
    resolve: (packet: PTPIPPacket) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
}

const DEFAULT_PORT = 15740
const DEFAULT_TIMEOUT_MILLISECONDS = 15_000
const DEFAULT_DATA_PACKET_SIZE = 1024 * 1024
type Bytes = Uint8Array<ArrayBufferLike>

function concatenate(parts: Bytes[]): Bytes {
    const length = parts.reduce((total, part) => total + part.length, 0)
    const result = new Uint8Array(length)
    let offset = 0
    for (const part of parts) {
        result.set(part, offset)
        offset += part.length
    }
    return result
}

function stableClientGuid(clientName: string): Uint8Array {
    const guid = new Uint8Array(16)
    const name = new TextEncoder().encode(clientName)
    for (let index = 0; index < guid.length; index += 1) {
        let hash = (0x811c9dc5 ^ index) >>> 0
        for (const byte of name) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
        guid[index] = hash & 0xff
    }
    guid[6] = ((guid[6] ?? 0) & 0x0f) | 0x40
    guid[8] = ((guid[8] ?? 0) & 0x3f) | 0x80
    return guid
}

function buildUSBContainer(type: USBContainerType, code: number, transactionId: number, payload: Uint8Array) {
    const result = new Uint8Array(12 + payload.length)
    const view = new DataView(result.buffer)
    view.setUint32(0, result.length, true)
    view.setUint16(4, type, true)
    view.setUint16(6, code, true)
    view.setUint32(8, transactionId, true)
    result.set(payload, 12)
    return result
}

class PTPIPConnection {
    private bufferedBytes: Bytes = new Uint8Array()
    private packets: PTPIPPacket[] = []
    private waiters: PacketWaiter[] = []
    private failure?: Error

    constructor(
        private socket: Socket,
        private timeoutMilliseconds: number
    ) {
        socket.on('data', data => this.accept(new Uint8Array(data)))
        socket.on('error', error => this.fail(error))
        socket.on('close', () => this.fail(new Error('PTP/IP connection closed')))
    }

    private accept(bytes: Bytes): void {
        if (this.failure) return
        try {
            const parsed = takePTPIPPackets(concatenate([this.bufferedBytes, bytes]))
            this.bufferedBytes = parsed.remainder
            for (const packet of parsed.packets) {
                const waiter = this.waiters.shift()
                if (!waiter) this.packets.push(packet)
                else {
                    clearTimeout(waiter.timer)
                    waiter.resolve(packet)
                }
            }
        } catch (error) {
            this.fail(error instanceof Error ? error : new Error(String(error)))
        }
    }

    private fail(error: Error): void {
        if (this.failure) return
        this.failure = error
        for (const waiter of this.waiters.splice(0)) {
            clearTimeout(waiter.timer)
            waiter.reject(error)
        }
    }

    async write(bytes: Uint8Array): Promise<void> {
        if (this.failure) throw this.failure
        await new Promise<void>((resolve, reject) => {
            this.socket.write(bytes, error => (error ? reject(error) : resolve()))
        })
    }

    async nextPacket(timeoutMilliseconds = this.timeoutMilliseconds): Promise<PTPIPPacket> {
        const packet = this.packets.shift()
        if (packet) return packet
        if (this.failure) throw this.failure
        return await new Promise<PTPIPPacket>((resolve, reject) => {
            const waiter: PacketWaiter = {
                resolve,
                reject,
                timer: setTimeout(() => {
                    const index = this.waiters.indexOf(waiter)
                    if (index >= 0) this.waiters.splice(index, 1)
                    reject(new Error(`Timed out waiting ${timeoutMilliseconds} ms for a PTP/IP packet`))
                }, timeoutMilliseconds),
            }
            this.waiters.push(waiter)
        })
    }

    close(): void {
        this.socket.destroy()
        this.fail(new Error('PTP/IP connection closed'))
    }
}

export class IPTransport implements TransportInterface {
    private connected = false
    private commandConnection?: PTPIPConnection
    private eventConnection?: PTPIPConnection
    private eventHandler?: (event: PTPEvent) => void
    private eventTask?: Promise<void>
    private pendingCommand?: ReturnType<typeof USBContainerBuilder.parseContainer>
    private operationCodes = new Map<number, number>()
    private options: Required<Omit<IPTransportOptions, 'localAddress' | 'clientGuid'>> &
        Pick<IPTransportOptions, 'localAddress' | 'clientGuid'>

    constructor(options: IPTransportOptions, private logger = new Logger()) {
        this.options = {
            address: options.address,
            port: options.port ?? DEFAULT_PORT,
            localAddress: options.localAddress,
            timeout: options.timeout ?? DEFAULT_TIMEOUT_MILLISECONDS,
            clientName: options.clientName ?? 'Darkgrade',
            clientGuid: options.clientGuid,
            dataPacketSize: options.dataPacketSize ?? DEFAULT_DATA_PACKET_SIZE,
        }
    }

    isConnected(): boolean {
        return this.connected
    }

    getType(): TransportType {
        return TransportType.IP
    }

    isLittleEndian(): boolean {
        return true
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        if (this.connected) throw new Error('Already connected')
        const address = device?.ip?.host ?? this.options.address
        const port = device?.ip?.port ?? this.options.port
        const localAddress = device?.ip?.localAddress ?? this.options.localAddress
        const commandConnection = await this.openConnection(address, port, localAddress)
        try {
            await commandConnection.write(
                buildInitCommandRequest(this.options.clientGuid ?? stableClientGuid(this.options.clientName), this.options.clientName)
            )
            const acknowledgement = parseInitCommandAck(await commandConnection.nextPacket())
            const eventConnection = await this.openConnection(address, port, localAddress)
            try {
                await eventConnection.write(buildInitEventRequest(acknowledgement.connectionNumber))
                const eventAcknowledgement = await eventConnection.nextPacket()
                if (eventAcknowledgement.type !== PTPIPPacketType.InitEventAck) {
                    throw new Error(`Expected PTP/IP event acknowledgement, received packet type ${eventAcknowledgement.type}`)
                }
                this.commandConnection = commandConnection
                this.eventConnection = eventConnection
                this.connected = true
                this.eventTask = this.readEvents(eventConnection)
            } catch (error) {
                eventConnection.close()
                throw error
            }
        } catch (error) {
            commandConnection.close()
            throw error
        }
    }

    private async openConnection(address: string, port: number, localAddress?: string): Promise<PTPIPConnection> {
        const { createConnection } = await import('node:net')
        const socket = createConnection({ host: address, port, localAddress })
        await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timer)
                socket.off('connect', onConnect)
                socket.off('error', onError)
            }
            const timer = setTimeout(() => {
                cleanup()
                socket.destroy()
                reject(new Error(`Timed out connecting to PTP/IP endpoint ${address}:${port}`))
            }, this.options.timeout)
            const onConnect = () => {
                cleanup()
                resolve()
            }
            const onError = (error: Error) => {
                cleanup()
                socket.destroy()
                reject(error)
            }
            socket.once('connect', onConnect)
            socket.once('error', onError)
        })
        socket.setKeepAlive(true, 5_000)
        socket.setNoDelay(true)
        return new PTPIPConnection(socket, this.options.timeout)
    }

    async disconnect(): Promise<void> {
        if (!this.connected && !this.commandConnection && !this.eventConnection) return
        this.connected = false
        this.commandConnection?.close()
        this.eventConnection?.close()
        await this.eventTask?.catch(() => undefined)
        this.commandConnection = undefined
        this.eventConnection = undefined
        this.eventTask = undefined
        this.pendingCommand = undefined
        this.eventHandler = undefined
        this.operationCodes.clear()
    }

    async send(data: Uint8Array, sessionId: number, transactionId: number): Promise<void> {
        const connection = this.requireCommandConnection()
        const container = USBContainerBuilder.parseContainer(data)
        if (container.transactionId !== transactionId) throw new Error('PTP/IP transaction ID does not match its container')

        if (container.type === USBContainerType.COMMAND) {
            if (this.pendingCommand) throw new Error('Previous PTP/IP command has not entered its data or response phase')
            this.pendingCommand = container
            this.operationCodes.set(transactionId, container.code)
            return
        }
        if (container.type !== USBContainerType.DATA) throw new Error(`Cannot send USB container type ${container.type} over PTP/IP`)
        const command = this.requirePendingCommand(transactionId, container.code)
        await connection.write(buildOperationRequest(command.code, transactionId, command.payload, true))
        this.pendingCommand = undefined
        await connection.write(buildStartData(transactionId, container.payload.length))
        await this.writeData(connection, transactionId, container.payload)
        void sessionId
    }

    private async writeData(connection: PTPIPConnection, transactionId: number, payload: Uint8Array): Promise<void> {
        let offset = 0
        while (payload.length - offset > this.options.dataPacketSize) {
            const chunk = payload.slice(offset, offset + this.options.dataPacketSize)
            await connection.write(buildDataPacket(PTPIPPacketType.Data, transactionId, chunk))
            offset += chunk.length
        }
        await connection.write(buildDataPacket(PTPIPPacketType.EndData, transactionId, payload.slice(offset)))
    }

    async receive(maxLength: number, sessionId: number, transactionId: number): Promise<Uint8Array> {
        const connection = this.requireCommandConnection()
        if (this.pendingCommand) {
            const command = this.requirePendingCommand(transactionId)
            await connection.write(buildOperationRequest(command.code, transactionId, command.payload, false))
            this.pendingCommand = undefined
        }

        for (;;) {
            const packet = await connection.nextPacket()
            if (packet.type === PTPIPPacketType.Ping) {
                await connection.write(buildPong())
                continue
            }
            if (packet.type === PTPIPPacketType.Event) {
                this.eventHandler?.(parseEvent(packet))
                continue
            }
            if (packet.type === PTPIPPacketType.StartData) {
                const data = await this.readData(connection, packet, transactionId)
                const code = this.operationCodes.get(transactionId)
                if (code === undefined) throw new Error(`No operation is registered for PTP/IP transaction ${transactionId}`)
                void maxLength
                void sessionId
                return buildUSBContainer(USBContainerType.DATA, code, transactionId, data)
            }
            if (packet.type === PTPIPPacketType.OperationResponse) {
                const response = parseResponse(packet)
                if (response.transactionId !== transactionId) {
                    throw new Error(`Received response for PTP/IP transaction ${response.transactionId}, expected ${transactionId}`)
                }
                this.operationCodes.delete(transactionId)
                return buildUSBContainer(USBContainerType.RESPONSE, response.code, response.transactionId, response.parameters)
            }
            throw new Error(`Unexpected PTP/IP command packet type ${packet.type}`)
        }
    }

    private async readData(connection: PTPIPConnection, startPacket: PTPIPPacket, expectedTransactionId: number) {
        const start = parseStartData(startPacket)
        if (start.transactionId !== expectedTransactionId) {
            throw new Error(`Received data for PTP/IP transaction ${start.transactionId}, expected ${expectedTransactionId}`)
        }
        const chunks: Uint8Array[] = []
        let receivedLength = 0
        for (;;) {
            const packet = await connection.nextPacket()
            if (packet.type === PTPIPPacketType.Ping) {
                await connection.write(buildPong())
                continue
            }
            if (packet.type !== PTPIPPacketType.Data && packet.type !== PTPIPPacketType.EndData) {
                throw new Error(`Expected PTP/IP data packet, received type ${packet.type}`)
            }
            const part = parseTransactionPayload(packet)
            if (part.transactionId !== expectedTransactionId) {
                throw new Error(`Received data for PTP/IP transaction ${part.transactionId}, expected ${expectedTransactionId}`)
            }
            chunks.push(part.data)
            receivedLength += part.data.length
            if (receivedLength > start.totalLength) throw new Error('PTP/IP camera sent more data than declared')
            if (packet.type === PTPIPPacketType.EndData) break
        }
        if (receivedLength !== start.totalLength) {
            throw new Error(`PTP/IP data ended after ${receivedLength} bytes; camera declared ${start.totalLength}`)
        }
        return concatenate(chunks)
    }

    private async readEvents(connection: PTPIPConnection): Promise<void> {
        while (this.connected) {
            try {
                const packet = await connection.nextPacket()
                if (packet.type === PTPIPPacketType.Ping) await connection.write(buildPong())
                else if (packet.type === PTPIPPacketType.Event) this.eventHandler?.(parseEvent(packet))
            } catch (error) {
                if (this.connected) {
                    this.connected = false
                    this.commandConnection?.close()
                    this.eventConnection?.close()
                    this.pendingCommand = undefined
                    this.operationCodes.clear()
                    console.error(error instanceof Error ? error.message : String(error))
                }
                return
            }
        }
    }

    private requireCommandConnection(): PTPIPConnection {
        if (!this.connected || !this.commandConnection) throw new Error('PTP/IP transport is not connected')
        return this.commandConnection
    }

    private requirePendingCommand(transactionId: number, operationCode?: number) {
        const command = this.pendingCommand
        if (!command) throw new Error('PTP/IP data phase has no pending command')
        if (command.transactionId !== transactionId) throw new Error('PTP/IP data phase transaction does not match its command')
        if (operationCode !== undefined && command.code !== operationCode) {
            throw new Error('PTP/IP data phase operation does not match its command')
        }
        return command
    }

    async classRequestReset(): Promise<void> {
        throw new Error('USB class reset is unavailable over PTP/IP')
    }

    on(handler: (event: PTPEvent) => void): void {
        this.eventHandler = handler
    }

    off(handler: (event: PTPEvent) => void): void {
        if (this.eventHandler === handler) this.eventHandler = undefined
    }
}
