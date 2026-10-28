import type { PTPEvent } from '@transport/interfaces/transport.interface'
import {
    buildDataPacket,
    buildStartData,
    encodePTPIPPacket,
    parseStartData,
    parseTransactionPayload,
    PTPIPPacketType,
    takePTPIPPackets,
    type PTPIPPacket,
} from '@transport/ip/ptpip-packet'
import type { CameraProfile } from '@transport/simulated/camera-profile'
import { concatenateBytes, encodeUint16, encodeUint32 } from '@transport/simulated/ptp-dataset-encoding'
import { ProfileDataMissingError, SimulatedTransport } from '@transport/simulated/simulated-transport'
import type { AddressInfo, Server, Socket } from 'node:net'

const CONTAINER = { command: 1, data: 2, response: 3 } as const
const DATA_PHASE_FROM_HOST = 2
const DATA_PACKET_BYTES = 64 * 1024
const CAMERA_GUID = Uint8Array.from({ length: 16 }, (_, index) => 0xd0 + index)
const PROTOCOL_VERSION = 0x00010000
/** Fixture limit, not a physical camera limit. Large media stays out of profile JSON. */
const MAX_DATA_BYTES = 64 * 1024 * 1024

interface PendingOperation {
    operation: number
    transactionId: number
    parameters: Uint8Array
    expectsData: boolean
    data: Uint8Array[]
    expectedBytes?: number
    receivedBytes: number
}

function utf16String(text: string): Uint8Array {
    const bytes = new Uint8Array((text.length + 1) * 2)
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < text.length; index += 1) view.setUint16(index * 2, text.charCodeAt(index), true)
    return bytes
}

function usbContainer(type: number, code: number, transactionId: number, payload: Uint8Array): Uint8Array {
    return concatenateBytes([
        encodeUint32(12 + payload.length),
        encodeUint16(type),
        encodeUint16(code),
        encodeUint32(transactionId),
        payload,
    ])
}

/**
 * Serves a SimulatedTransport over standard PTP/IP (command and event TCP channels), so the real
 * IPTransport can be exercised against camera profiles. Each PTP/IP operation is translated into the
 * USB container sequence SimulatedTransport answers, and its replies back into PTP/IP packets.
 *
 * A request the profile cannot answer is not invented: the transaction is cancelled with a PTP/IP
 * Cancel packet, and the simulated transport's `missingData` records why.
 */
export class SimulatedPtpIpCamera {
    readonly transport: SimulatedTransport
    private server?: Server
    private commandSocket?: Socket
    private eventSocket?: Socket
    private readonly sockets = new Set<Socket>()
    private readonly forwardEvent = (event: PTPEvent) => this.sendEvent(event)
    private queue: Promise<void> = Promise.resolve()
    private pending?: PendingOperation

    constructor(readonly profile: CameraProfile) {
        this.transport = new SimulatedTransport(profile, { connection: 'ptp-ip' })
    }

    /** Starts listening on an ephemeral loopback port and returns it. */
    async start(): Promise<{ host: string; port: number }> {
        if (this.server) throw new Error('Simulated PTP/IP camera is already listening')
        const { createServer } = await import('node:net')
        const server = createServer(socket => this.accept(socket))
        this.server = server
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(0, '127.0.0.1', resolve)
        })
        const address = server.address() as AddressInfo
        return { host: address.address, port: address.port }
    }

    async stop(): Promise<void> {
        this.dropConnection()
        for (const socket of this.sockets) socket.destroy()
        this.sockets.clear()
        await this.queue
        await this.transport.disconnect()
        const server = this.server
        this.server = undefined
        if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    }

    private accept(socket: Socket): void {
        this.sockets.add(socket)
        socket.setNoDelay(true)
        socket.on('close', () => {
            this.sockets.delete(socket)
            if (this.commandSocket === socket || this.eventSocket === socket) this.dropConnection()
        })
        socket.on('error', () => socket.destroy())
        let buffered: Uint8Array = new Uint8Array()
        socket.on('data', chunk => {
            try {
                const input = concatenateBytes([buffered, new Uint8Array(chunk)])
                if (input.length > MAX_DATA_BYTES + 12) throw new Error('Simulated PTP/IP packet exceeds fixture limit')
                const parsed = takePTPIPPackets(input)
                buffered = parsed.remainder
                if (
                    buffered.length >= 4 &&
                    new DataView(buffered.buffer, buffered.byteOffset).getUint32(0, true) > MAX_DATA_BYTES + 12
                )
                    throw new Error('Simulated PTP/IP packet exceeds fixture limit')
                for (const packet of parsed.packets) {
                    this.queue = this.queue
                        .then(async () => {
                            if (!socket.destroyed) await this.handle(socket, packet)
                        })
                        .catch(() => {
                            socket.destroy()
                        })
                }
            } catch {
                socket.destroy()
            }
        })
    }

    private async handle(socket: Socket, packet: PTPIPPacket): Promise<void> {
        if (packet.type === PTPIPPacketType.Ping) {
            socket.write(encodePTPIPPacket(PTPIPPacketType.Pong))
            return
        }
        if (packet.type === PTPIPPacketType.InitCommandRequest) return this.openCommandChannel(socket, packet)
        if (packet.type === PTPIPPacketType.InitEventRequest) {
            if (
                !this.commandSocket ||
                this.eventSocket ||
                packet.payload.length !== 4 ||
                new DataView(packet.payload.buffer, packet.payload.byteOffset).getUint32(0, true) !== 1
            )
                throw new Error('Invalid PTP/IP event connection')
            this.eventSocket = socket
            socket.write(encodePTPIPPacket(PTPIPPacketType.InitEventAck))
            return
        }
        if (socket !== this.commandSocket) throw new Error('PTP/IP operation is not on the command channel')
        switch (packet.type) {
            case PTPIPPacketType.OperationRequest:
                return this.beginOperation(packet)
            case PTPIPPacketType.StartData:
                return this.startData(packet)
            case PTPIPPacketType.Data:
            case PTPIPPacketType.EndData:
                return this.acceptData(packet)
            default:
                return
        }
    }

    private async openCommandChannel(socket: Socket, packet: PTPIPPacket): Promise<void> {
        if (this.commandSocket || packet.payload.length < 22 || packet.payload.length % 2)
            throw new Error('Invalid or competing PTP/IP command connection')
        const view = new DataView(packet.payload.buffer, packet.payload.byteOffset, packet.payload.byteLength)
        if (
            view.getUint32(packet.payload.length - 4, true) !== PROTOCOL_VERSION ||
            view.getUint16(packet.payload.length - 6, true) !== 0
        )
            throw new Error('Unsupported PTP/IP version or unterminated initiator name')
        this.commandSocket = socket
        await this.transport.connect()
        this.transport.on(this.forwardEvent)
        const name = this.profile.model.slice(0, 31)
        socket.write(
            encodePTPIPPacket(
                PTPIPPacketType.InitCommandAck,
                concatenateBytes([encodeUint32(1), CAMERA_GUID, utf16String(name), encodeUint32(PROTOCOL_VERSION)])
            )
        )
    }

    private async beginOperation(packet: PTPIPPacket): Promise<void> {
        if (
            this.pending ||
            packet.payload.length < 10 ||
            (packet.payload.length - 10) % 4 ||
            packet.payload.length > 30
        )
            throw new Error('Invalid or overlapping PTP/IP operation')
        const view = new DataView(packet.payload.buffer, packet.payload.byteOffset, packet.payload.byteLength)
        if (view.getUint32(0, true) !== 1 && view.getUint32(0, true) !== DATA_PHASE_FROM_HOST)
            throw new Error('Invalid PTP/IP data phase')
        const operation: PendingOperation = {
            expectsData: view.getUint32(0, true) === DATA_PHASE_FROM_HOST,
            operation: view.getUint16(4, true),
            transactionId: view.getUint32(6, true),
            parameters: packet.payload.slice(10),
            data: [],
            receivedBytes: 0,
        }
        if (operation.expectsData) {
            this.pending = operation
            return
        }
        await this.answer(operation)
    }

    private startData(packet: PTPIPPacket): void {
        if (packet.payload.length !== 12) throw new Error('Invalid PTP/IP start-data length')
        const start = parseStartData(packet)
        if (
            !this.pending ||
            this.pending.transactionId !== start.transactionId ||
            this.pending.expectedBytes !== undefined ||
            start.totalLength > MAX_DATA_BYTES
        )
            throw new Error('Invalid PTP/IP start-data transaction or fixture size')
        this.pending.expectedBytes = start.totalLength
    }

    private async acceptData(packet: PTPIPPacket): Promise<void> {
        const operation = this.pending
        const part = parseTransactionPayload(packet)
        if (!operation || operation.transactionId !== part.transactionId || operation.expectedBytes === undefined)
            throw new Error('PTP/IP data does not match a started transaction')
        operation.receivedBytes += part.data.length
        if (operation.receivedBytes > operation.expectedBytes) throw new Error('PTP/IP data exceeds its declaration')
        operation.data.push(part.data)
        if (packet.type !== PTPIPPacketType.EndData) return
        if (operation.receivedBytes !== operation.expectedBytes) throw new Error('Truncated PTP/IP host data')
        this.pending = undefined
        await this.answer(operation)
    }

    private async answer(operation: PendingOperation): Promise<void> {
        const socket = this.commandSocket
        if (!socket) return
        const { transactionId } = operation
        await this.transport.send(
            usbContainer(CONTAINER.command, operation.operation, transactionId, operation.parameters),
            1,
            transactionId
        )
        if (operation.expectsData) {
            const data = concatenateBytes(operation.data)
            await this.transport.send(
                usbContainer(CONTAINER.data, operation.operation, transactionId, data),
                1,
                transactionId
            )
        }

        let container: Uint8Array
        try {
            container = await this.transport.receive(MAX_DATA_BYTES + 12, 1, transactionId)
            if (new DataView(container.buffer, container.byteOffset).getUint32(0, true) !== container.length)
                throw new Error('Simulated PTP/IP response exceeds fixture limit')
        } catch (error) {
            // A recorded disconnect drops the link; a request the profile cannot answer is cancelled
            // instead of being given an invented response.
            if (!this.transport.isConnected() || !(error instanceof ProfileDataMissingError))
                return this.dropConnection()
            socket.write(encodePTPIPPacket(PTPIPPacketType.Cancel, encodeUint32(transactionId)))
            return
        }
        if (this.containerType(container) === CONTAINER.data) {
            this.writeData(socket, transactionId, container.slice(12))
            container = await this.transport.receive(32, 1, transactionId)
        }
        const code = new DataView(container.buffer, container.byteOffset).getUint16(6, true)
        socket.write(
            encodePTPIPPacket(
                PTPIPPacketType.OperationResponse,
                concatenateBytes([encodeUint16(code), encodeUint32(transactionId), container.slice(12)])
            )
        )
    }

    private containerType(container: Uint8Array): number {
        return new DataView(container.buffer, container.byteOffset).getUint16(4, true)
    }

    private writeData(socket: Socket, transactionId: number, data: Uint8Array): void {
        socket.write(buildStartData(transactionId, data.length))
        let offset = 0
        while (data.length - offset > DATA_PACKET_BYTES) {
            socket.write(
                buildDataPacket(PTPIPPacketType.Data, transactionId, data.slice(offset, offset + DATA_PACKET_BYTES))
            )
            offset += DATA_PACKET_BYTES
        }
        socket.write(buildDataPacket(PTPIPPacketType.EndData, transactionId, data.slice(offset)))
    }

    private sendEvent(event: PTPEvent): void {
        if (!this.eventSocket?.writable || this.eventSocket.destroyed) return
        this.eventSocket?.write(
            encodePTPIPPacket(
                PTPIPPacketType.Event,
                concatenateBytes([
                    encodeUint16(event.code),
                    encodeUint32(event.transactionId),
                    ...event.parameters.map(encodeUint32),
                ])
            )
        )
    }

    /** A recorded disconnect drops both channels, as a camera leaving the network would. */
    private dropConnection(): void {
        const command = this.commandSocket
        const events = this.eventSocket
        this.commandSocket = undefined
        this.eventSocket = undefined
        this.pending = undefined
        this.transport.off(this.forwardEvent)
        void this.transport.disconnect()
        command?.destroy()
        events?.destroy()
    }
}
