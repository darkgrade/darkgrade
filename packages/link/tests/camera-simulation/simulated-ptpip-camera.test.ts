import { Logger } from '@core/logger'
import { IPTransport, PTPIPTransactionCancelledError } from '@transport/ip/ip-transport'
import {
    buildDataPacket,
    buildInitCommandRequest,
    buildOperationRequest,
    buildStartData,
    PTPIPPacketType,
} from '@transport/ip/ptpip-packet'
import type { CameraProfile } from '@transport/simulated/camera-profile'
import { SimulatedPtpIpCamera } from '@transport/simulated/simulated-ptpip-camera'
import { USBContainerBuilder, USBContainerType } from '@transport/usb/usb-container'
import { createConnection, type Socket } from 'node:net'
import { describe, expect, it } from 'vitest'

function testTransport(options: ConstructorParameters<typeof IPTransport>[0]): IPTransport {
    return new IPTransport(options, new Logger({ captureConsole: false, renderInTerminal: false }))
}

/** Transport mechanics fixture; no camera compatibility or physical validation is inferred. */
function profile(): CameraProfile {
    return {
        schemaVersion: 1,
        id: 'network-fixture',
        manufacturer: 'Fixture',
        line: 'Test',
        model: 'Network fixture',
        provenance: {
            fidelity: 'documented',
            sources: [{ location: 'tests/camera-simulation/simulated-ptpip-camera.test.ts' }],
        },
        deviceInfo: {
            manufacturer: 'Fixture',
            model: 'Network fixture',
            operationsSupported: ['0x1001', '0x1002', '0x1003', '0x1015', '0x1016'],
            eventsSupported: ['0x4006'],
            devicePropertiesSupported: ['0x5005'],
            listsComplete: true,
        },
        properties: [
            {
                code: '0x5005',
                source: 0,
                descriptor: {
                    dataType: '0x0004',
                    writable: true,
                    factoryDefault: 2,
                    current: 2,
                    form: { enumeration: [2, 4] },
                },
            },
        ],
        exchanges: [
            {
                operation: '0x9001',
                parameters: [],
                response: { code: '0x2001', data: 'ab'.repeat(140_000) },
                source: 0,
            },
        ],
        events: [],
        quirks: [],
    }
}
const word = (value: number) => {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, value, true)
    return bytes
}

async function closedPeer(endpoint: { host: string; port: number }, send: (socket: Socket) => void): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const socket = createConnection(endpoint)
        const timer = setTimeout(() => {
            socket.destroy()
            reject(new Error('Simulated camera did not close an invalid peer'))
        }, 1000)
        socket.on('error', () => undefined)
        socket.once('connect', () => send(socket))
        socket.once('close', () => {
            clearTimeout(timer)
            resolve()
        })
    })
}

async function networkFixture(
    work: (
        server: SimulatedPtpIpCamera,
        transport: IPTransport,
        endpoint: { host: string; port: number }
    ) => Promise<void>
) {
    const server = new SimulatedPtpIpCamera(profile())
    const endpoint = await server.start()
    const transport = testTransport({ address: endpoint.host, port: endpoint.port, timeout: 500 })
    try {
        await transport.connect()
        await work(server, transport, endpoint)
    } finally {
        await transport.disconnect()
        await server.stop()
    }
}

async function response(transport: IPTransport, operation: number, transactionId: number, parameters: number[] = []) {
    await transport.send(
        USBContainerBuilder.buildCommand(operation, transactionId, parameters.map(word)),
        1,
        transactionId
    )
    return USBContainerBuilder.parseContainer(await transport.receive(256 * 1024, 1, transactionId))
}

describe('PTP/IP simulator lifecycle and framing', () => {
    it('streams a multi-packet dataset and preserves cancelled missing evidence without poisoning later commands', async () => {
        const custom = profile()
        custom.deviceInfo!.listsComplete = false
        const server = new SimulatedPtpIpCamera(custom)
        const endpoint = await server.start()
        const transport = testTransport({ address: endpoint.host, port: endpoint.port, timeout: 500 })
        try {
            await transport.connect()
            const data = await response(transport, 0x9001, 1)
            expect(data.type).toBe(USBContainerType.DATA)
            expect(data.payload.length).toBe(140_000)
            expect(data.payload.every(byte => byte === 0xab)).toBe(true)
            expect(USBContainerBuilder.parseContainer(await transport.receive(512, 1, 1)).code).toBe(0x2001)
            await transport.send(USBContainerBuilder.buildCommand(0x9002, 2, []), 1, 2)
            await expect(transport.receive(512, 1, 2)).rejects.toBeInstanceOf(PTPIPTransactionCancelledError)
            expect(server.transport.missingData).toHaveLength(1)
            const read = await response(transport, 0x1015, 3, [0x5005])
            expect(read.payload).toEqual(Uint8Array.of(2, 0))
            await transport.receive(512, 1, 3)
        } finally {
            await transport.disconnect()
            await server.stop()
        }
    })

    it('rejects competing and malformed peers while preserving the current camera owner', async () => {
        await networkFixture(async (_server, transport, endpoint) => {
            await closedPeer(endpoint, socket => socket.write(buildInitCommandRequest(new Uint8Array(16), 'competing')))
            await closedPeer(endpoint, socket => socket.write(Uint8Array.of(4, 0, 0, 0, 6, 0, 0, 0)))
            expect((await response(transport, 0x1002, 1, [1])).code).toBe(0x2001)
        })
    })

    it.each(['version', 'name-termination'] as const)(
        'rejects an invalid %s handshake before opening a camera session',
        async malformed => {
            const server = new SimulatedPtpIpCamera(profile())
            const endpoint = await server.start()
            try {
                const request = buildInitCommandRequest(new Uint8Array(16), 'bad handshake')
                if (malformed === 'version') request[request.length - 2] = 2
                else request[request.length - 6] = 1
                await closedPeer(endpoint, socket => socket.write(request))
                expect(server.transport.isConnected()).toBe(false)
            } finally {
                await server.stop()
            }
        }
    )

    it('clears session ownership on disconnect before accepting a new connection', async () => {
        await networkFixture(async (server, transport, endpoint) => {
            expect((await response(transport, 0x1002, 1, [1])).code).toBe(0x2001)
            await transport.disconnect()
            await new Promise(resolve => setTimeout(resolve, 5))
            expect(server.transport.isConnected()).toBe(false)
            const next = testTransport({ address: endpoint.host, port: endpoint.port, timeout: 500 })
            try {
                await next.connect()
                expect((await response(next, 0x1002, 1, [1])).code).toBe(0x2001)
            } finally {
                await next.disconnect()
            }
        })
    })

    it.each(['missing-start', 'wrong-transaction', 'truncated', 'fixture-limit'] as const)(
        'drops invalid %s host data without a successful camera write',
        async scenario => {
            const server = new SimulatedPtpIpCamera(profile())
            const endpoint = await server.start()
            try {
                await closedPeer(endpoint, socket => {
                    let initialized = false
                    socket.on('data', () => {
                        if (initialized) return
                        initialized = true
                        socket.write(buildOperationRequest(0x1016, 1, word(0x5005), true))
                        if (scenario !== 'missing-start')
                            socket.write(
                                buildStartData(
                                    scenario === 'wrong-transaction' ? 2 : 1,
                                    scenario === 'fixture-limit' ? 64 * 1024 * 1024 + 1 : 2
                                )
                            )
                        socket.write(buildDataPacket(PTPIPPacketType.EndData, 1, Uint8Array.of(4)))
                    })
                    socket.write(buildInitCommandRequest(new Uint8Array(16), 'malformed fixture'))
                })
                expect(server.transport.responseCodes).toEqual([])
                expect(server.transport.isConnected()).toBe(false)
            } finally {
                await server.stop()
            }
        }
    )
})
