import { IPTransport } from '@transport/ip/ip-transport'
import {
    buildDataPacket,
    buildPong,
    buildStartData,
    encodePTPIPPacket,
    PTPIPPacket,
    PTPIPPacketType,
    takePTPIPPackets,
} from '@transport/ip/ptpip-packet'
import { USBContainerBuilder, USBContainerType } from '@transport/usb/usb-container'
import { createServer, Server, Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

function concatenate(parts: Uint8Array<ArrayBufferLike>[]) {
    const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        output.set(part, offset)
        offset += part.length
    }
    return output
}

function uint16(value: number) {
    const bytes = new Uint8Array(2)
    new DataView(bytes.buffer).setUint16(0, value, true)
    return bytes
}

function uint32(value: number) {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, value, true)
    return bytes
}

function commandAcknowledgement(connectionNumber: number) {
    const cameraName = new Uint8Array(24)
    const cameraNameView = new DataView(cameraName.buffer)
    ;[...'Mock Camera'].forEach((character, index) => cameraNameView.setUint16(index * 2, character.charCodeAt(0), true))
    return encodePTPIPPacket(
        PTPIPPacketType.InitCommandAck,
        concatenate([uint32(connectionNumber), Uint8Array.from({ length: 16 }, (_, index) => index), cameraName, uint32(0x00010000)])
    )
}

function operationResponse(code: number, transactionId: number, parameters = new Uint8Array()) {
    return encodePTPIPPacket(
        PTPIPPacketType.OperationResponse,
        concatenate([uint16(code), uint32(transactionId), parameters])
    )
}

function eventPacket(code: number, transactionId: number, parameters: number[]) {
    return encodePTPIPPacket(
        PTPIPPacketType.Event,
        concatenate([uint16(code), uint32(transactionId), ...parameters.map(uint32)])
    )
}

function acceptPackets(socket: Socket, handler: (packet: PTPIPPacket) => void) {
    let buffered: Uint8Array<ArrayBufferLike> = new Uint8Array()
    socket.on('data', chunk => {
        const parsed = takePTPIPPackets(concatenate([buffered, new Uint8Array(chunk)]))
        buffered = parsed.remainder
        parsed.packets.forEach(handler)
    })
}

interface MockCamera {
    server: Server
    address: string
    port: number
    received: PTPIPPacket[]
}

async function startMockCamera(): Promise<MockCamera> {
    const received: PTPIPPacket[] = []
    let connectionCount = 0
    const server = createServer(socket => {
        connectionCount += 1
        const channel = connectionCount
        acceptPackets(socket, packet => {
            received.push(packet)
            if (channel === 1 && packet.type === PTPIPPacketType.InitCommandRequest) {
                socket.write(commandAcknowledgement(0x12345678))
                return
            }
            if (channel === 2 && packet.type === PTPIPPacketType.InitEventRequest) {
                socket.write(encodePTPIPPacket(PTPIPPacketType.InitEventAck))
                socket.write(eventPacket(0x4002, 41, [7]))
                return
            }
            if (channel !== 1) return
            if (packet.type === PTPIPPacketType.EndData) {
                const transactionId = new DataView(packet.payload.buffer, packet.payload.byteOffset).getUint32(0, true)
                socket.write(operationResponse(0x2001, transactionId, uint32(99)))
                return
            }
            if (packet.type !== PTPIPPacketType.OperationRequest) return
            const view = new DataView(packet.payload.buffer, packet.payload.byteOffset, packet.payload.byteLength)
            const operationCode = view.getUint16(4, true)
            const transactionId = view.getUint32(6, true)
            if (operationCode === 0x1001) {
                socket.write(encodePTPIPPacket(PTPIPPacketType.Ping))
                socket.write(buildStartData(transactionId, 5))
                socket.write(buildDataPacket(PTPIPPacketType.EndData, transactionId, Uint8Array.of(1, 2, 3, 4, 5)))
                socket.write(operationResponse(0x2001, transactionId))
            }
        })
    })
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Mock PTP/IP server has no TCP address')
    return { server, address: address.address, port: address.port, received }
}

describe('PTP/IP transport', () => {
    const servers: Server[] = []

    afterEach(async () => {
        await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    })

    it('frames fragmented and coalesced packets', () => {
        const first = buildPong()
        const second = operationResponse(0x2001, 7)
        const joined = concatenate([first, second])

        const incomplete = takePTPIPPackets(joined.slice(0, first.length + 3))
        expect(incomplete.packets.map(packet => packet.type)).toEqual([PTPIPPacketType.Pong])
        expect(incomplete.remainder).toHaveLength(3)

        const completed = takePTPIPPackets(concatenate([incomplete.remainder, joined.slice(first.length + 3)]))
        expect(completed.packets.map(packet => packet.type)).toEqual([PTPIPPacketType.OperationResponse])
        expect(completed.remainder).toHaveLength(0)
    })

    it('pairs both channels and translates input, output, response, event, and ping phases', async () => {
        const mock = await startMockCamera()
        servers.push(mock.server)
        const transport = new IPTransport({ address: mock.address, port: mock.port, timeout: 2_000 })
        const events: Array<{ code: number; transactionId: number; parameters: number[] }> = []
        transport.on(event => events.push(event))

        await transport.connect()
        await transport.send(USBContainerBuilder.buildCommand(0x1001, 1, []), 1, 1)
        const data = USBContainerBuilder.parseContainer(await transport.receive(1024, 1, 1), USBContainerType.DATA)
        const response = USBContainerBuilder.parseContainer(
            await transport.receive(512, 1, 1),
            USBContainerType.RESPONSE
        )

        expect(data.payload).toEqual(Uint8Array.of(1, 2, 3, 4, 5))
        expect(response.code).toBe(0x2001)

        await transport.send(USBContainerBuilder.buildCommand(0x1016, 2, [uint32(0x5001)]), 1, 2)
        await transport.send(USBContainerBuilder.buildData(0x1016, 2, Uint8Array.of(9, 8, 7)), 1, 2)
        const setResponse = USBContainerBuilder.parseContainer(
            await transport.receive(512, 1, 2),
            USBContainerType.RESPONSE
        )

        expect(setResponse.payload).toEqual(uint32(99))
        expect(events).toContainEqual({ code: 0x4002, transactionId: 41, parameters: [7] })
        expect(mock.received.some(packet => packet.type === PTPIPPacketType.Pong)).toBe(true)
        expect(mock.received.some(packet => packet.type === PTPIPPacketType.StartData)).toBe(true)
        expect(mock.received.some(packet => packet.type === PTPIPPacketType.EndData)).toBe(true)

        await transport.disconnect()
        expect(transport.isConnected()).toBe(false)
    })
})
