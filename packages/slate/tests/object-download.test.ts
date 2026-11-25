import { GenericCamera } from '@vendors/generic/generic-camera'
import { NikonCamera } from '@vendors/nikon/nikon-camera'
import { SonyCamera } from '@vendors/sony/sony-camera'
import { Logger } from '@core/logger'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { USBContainerBuilder, USBContainerType } from '@transport/usb/usb-container'
import { describe, expect, it } from 'vitest'
import { ptpContainer } from '@tests/fixtures/ptp-wire'

/** Each driver's partial-object operation and the parameters it sends for chunks at offsets 0 (4 bytes) and 2 (3 bytes). */
const drivers = [
    { name: 'standard', driver: GenericCamera, operation: 0x101b, chunkRequests: [[7, 0, 4], [7, 2, 3]] },
    { name: 'Nikon', driver: NikonCamera, operation: 0x9431, chunkRequests: [[7, 0, 0, 4, 0], [7, 2, 0, 3, 0]] },
    { name: 'Sony', driver: SonyCamera, operation: 0x9211, chunkRequests: [[7, 0, 0, 4], [7, 2, 0, 3]] },
] as const

function fixture(driver: (typeof drivers)[number], chunks: Uint8Array[], responseCode = 0x2001) {
    const requests: number[][] = []
    const replies: Uint8Array[] = []
    const logger = new Logger({ captureConsole: false, renderInTerminal: false })
    const transport = {
        isLittleEndian: () => true,
        isConnected: () => true,
        async send(bytes: Uint8Array) {
            const request = USBContainerBuilder.parseContainer(bytes, USBContainerType.COMMAND)
            expect(request.code).toBe(driver.operation)
            const view = new DataView(request.payload.buffer, request.payload.byteOffset, request.payload.byteLength)
            requests.push(Array.from({ length: view.byteLength / 4 }, (_, index) => view.getUint32(index * 4, true)))
            const chunk = chunks.shift()
            if (chunk) replies.push(USBContainerBuilder.buildData(driver.operation, request.transactionId, chunk))
            replies.push(ptpContainer(USBContainerType.RESPONSE, responseCode, request.transactionId))
        },
        async receive() {
            const response = replies.shift()
            if (!response) throw new Error('No response supplied')
            return response
        },
    } as unknown as TransportInterface
    const camera = new driver.driver(transport, logger)
    camera.sessionId = 1
    // Exercise an already-prepared Sony session; mode preparation has separate wire coverage.
    Object.assign(camera, { defaultChunkSize: 4, contentTransferModeEnabled: true })
    return { camera, requests, logger }
}

describe.each(drivers)('$name object download', driver => {
    it('assembles short chunks using actual received offsets and the vendor wire shape', async () => {
        const { camera, requests, logger } = fixture(driver, [Uint8Array.of(1, 2), Uint8Array.of(3, 4, 5)])
        const progress: number[][] = []
        expect(await camera.getObject(7, 5, (received, total) => progress.push([received, total]))).toEqual(
            Uint8Array.of(1, 2, 3, 4, 5)
        )
        expect(progress).toEqual([[2, 5], [5, 5]])
        expect(requests).toEqual(driver.chunkRequests)
        expect(logger.getActiveTransfer(7)).toBeUndefined()
    })
    it('rejects invalid sizes before sending any camera command', async () => {
        const { camera, requests } = fixture(driver, [])
        for (const size of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
            await expect(camera.getObject(7, size)).rejects.toThrow('safe integer')
        expect(requests).toEqual([])
        expect(await camera.getObject(7, 0)).toEqual(new Uint8Array())
    })
    it('stops on cancellation between chunks, sends nothing once cancelled and allows a later download', async () => {
        const { camera, requests, logger } = fixture(driver, [Uint8Array.of(1, 2), Uint8Array.of(3)])
        const controller = new AbortController()
        await expect(camera.getObject(7, 5, () => controller.abort('cancelled'), controller.signal)).rejects.toBe(
            'cancelled'
        )
        expect(requests).toHaveLength(1)
        expect(logger.getActiveTransfer(7)).toBeUndefined()
        const transfer = logger.getOrderedTransactions().flatMap(group => group.logs).find(log => log.type === 'ptp_transfer')
        expect(transfer).toMatchObject({ level: 'error', responsePhase: { code: 0x2007 } })
        const cancelled = new AbortController()
        cancelled.abort('cancelled')
        await expect(camera.getObject(9, 5, undefined, cancelled.signal)).rejects.toBe('cancelled')
        expect(requests).toHaveLength(1)
        expect(await camera.getObject(8, 1)).toEqual(Uint8Array.of(3))
        expect(requests).toHaveLength(2)
    })
    it('rejects empty replies and camera refusals without inventing successful progress', async () => {
        const { camera, requests } = fixture(driver, [new Uint8Array()])
        await expect(camera.getObject(7, 5)).rejects.toThrow('empty')
        expect(requests).toHaveLength(1)
        const refusal = fixture(driver, [], 0x200f)
        await expect(refusal.camera.getObject(7, 5)).rejects.toThrow('200f')
        expect(refusal.requests).toHaveLength(1)
    })
})
