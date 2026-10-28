import type { PTPEvent } from '@transport/interfaces/transport.interface'
import {
    buildDataPacket,
    buildStartData,
    encodePTPIPPacket,
    parseTransactionPayload,
    PTPIPPacketType,
    takePTPIPPackets,
    type PTPIPPacket,
} from '@transport/ip/ptpip-packet'
import type { CameraProfile } from '@transport/simulated/camera-profile'
import { concatenateBytes, encodeUint16, encodeUint32 } from '@transport/simulated/ptp-dataset-encoding'
import { SimulatedTransport } from '@transport/simulated/simulated-transport'
import type { AddressInfo, Server, Socket } from 'node:net'

const CONTAINER = { command: 1, data: 2, response: 3 } as const
const DATA_PHASE_FROM_HOST = 2
const DATA_PACKET_BYTES = 64 * 1024
const CAMERA_GUID = Uint8Array.from({ length: 16 }, (_, index) => 0xd0 + index)
const PROTOCOL_VERSION = 0x00010000

interface PendingOperation {
    operation: number
    transactionId: number
    parameters: Uint8Array
    expectsData: boolean
    data: Uint8Array[]
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
        this.transport.off(this.forwardEvent)
        for (const socket of this.sockets) socket.destroy()
        this.sockets.clear()
        await this.transport.disconnect()
        const server = this.server
        this.server = undefined
        if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    }

    private accept(socket: Socket): void {
        this.sockets.add(socket)
        socket.setNoDelay(true)
        socket.on('close', () => this.sockets.delete(socket))
        socket.on('error', () => socket.destroy())
        let buffered: Uint8Array = new Uint8Array()
        socket.on('data', chunk => {
            const parsed = takePTPIPPackets(concatenateBytes([buffered, new Uint8Array(chunk)]))
            buffered = parsed.remainder
            for (const packet of parsed.packets) {
                // Packets are handled strictly in order, as a camera's single command pipe would.
                this.queue = this.queue
                    .then(() => this.handle(socket, packet))
                    .catch(() => {
                        socket.destroy()
                    })
            }
        })
    }

    private async handle(socket: Socket, packet: PTPIPPacket): Promise<void> {
        switch (packet.type) {
            case PTPIPPacketType.InitCommandRequest:
                return this.openCommandChannel(socket)
            case PTPIPPacketType.InitEventRequest:
                this.eventSocket = socket
                socket.write(encodePTPIPPacket(PTPIPPacketType.InitEventAck))
                return
            case PTPIPPacketType.Ping:
                socket.write(encodePTPIPPacket(PTPIPPacketType.Pong))
                return
            case PTPIPPacketType.OperationRequest:
                return this.beginOperation(packet)
            case PTPIPPacketType.StartData:
                return
            case PTPIPPacketType.Data:
            case PTPIPPacketType.EndData:
                return this.acceptData(packet)
            default:
                return
        }
    }

    private async openCommandChannel(socket: Socket): Promise<void> {
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
        const view = new DataView(packet.payload.buffer, packet.payload.byteOffset, packet.payload.byteLength)
        const operation: PendingOperation = {
            expectsData: view.getUint32(0, true) === DATA_PHASE_FROM_HOST,
            operation: view.getUint16(4, true),
            transactionId: view.getUint32(6, true),
            parameters: packet.payload.slice(10),
            data: [],
        }
        if (operation.expectsData) {
            this.pending = operation
            return
        }
        await this.answer(operation)
    }

    private async acceptData(packet: PTPIPPacket): Promise<void> {
        const operation = this.pending
        const part = parseTransactionPayload(packet)
        if (!operation || operation.transactionId !== part.transactionId) return
        operation.data.push(part.data)
        if (packet.type !== PTPIPPacketType.EndData) return
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
            container = await this.transport.receive(0, 1, transactionId)
        } catch {
            // A recorded disconnect drops the link; a request the profile cannot answer is cancelled
            // instead of being given an invented response.
            if (!this.transport.isConnected()) return this.dropConnection()
            socket.write(encodePTPIPPacket(PTPIPPacketType.Cancel, encodeUint32(transactionId)))
            return
        }
        if (this.containerType(container) === CONTAINER.data) {
            this.writeData(socket, transactionId, container.slice(12))
            container = await this.transport.receive(0, 1, transactionId)
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
        this.commandSocket?.destroy()
        this.eventSocket?.destroy()
        this.commandSocket = undefined
        this.eventSocket = undefined
    }
}
