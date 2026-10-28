import { Camera } from '@camera/index'
import { createNikonRegistry } from '@ptp/registry'
import { type CameraProfile } from '@transport/simulated/camera-profile'
import { SimulatedTransport } from '@transport/simulated/simulated-transport'
import { describe, expect, it } from 'vitest'

// Independently written SDK-framing examples (codec cases live in tests/nikon-event-data-codec.test.ts).
const records = '020000000140010078563412054002000100000002000000'
const decoded = [
    { code: 0x4001, parameters: [0x12345678] },
    { code: 0x4005, parameters: [1, 2] },
]

describe('Nikon GetEventEx SDK contract', () => {
    it('uses the real typed Darkgrade operation for explicit retain and drain requests', async () => {
        const profile: CameraProfile = {
            schemaVersion: 1,
            id: 'nikon-event-sdk-scenario',
            manufacturer: 'Nikon',
            line: 'Z',
            model: 'SDK scenario',
            provenance: {
                fidelity: 'documented',
                sources: [{ location: 'camera-catalog/sdk-evidence.json#nikon-z6iii-event-queue' }],
            },
            properties: [],
            events: [],
            quirks: [],
            exchanges: [
                { operation: '0x941c', parameters: ['0x1'], response: { code: '0x2001', data: records }, source: 0 },
                { operation: '0x941c', parameters: ['0x0'], response: { code: '0x2001', data: records }, source: 0 },
                { operation: '0x941c', parameters: ['0x0'], response: { code: '0x2001', data: '00000000' }, source: 0 },
                { operation: '0x941c', parameters: [], response: { code: '0x2001', data: '00000000' }, source: 0 },
            ],
        }
        const transport = new SimulatedTransport(profile)
        const camera = new Camera({
            transport,
            vendorId: 0x04b0,
            logger: { renderInTerminal: false, captureConsole: false },
        })
        const operation = createNikonRegistry(true).operations.GetEventEx
        await transport.connect()
        try {
            expect((await camera.send(operation, { KeepEvents: 'RETAIN' })).data).toEqual(decoded)
            expect((await camera.send(operation, { KeepEvents: 'RETAIN' })).data).toEqual(decoded)
            expect((await camera.send(operation, { KeepEvents: 'DRAIN' })).data).toEqual(decoded)
            expect((await camera.send(operation, { KeepEvents: 'DRAIN' })).data).toEqual([])
            expect((await camera.send(operation, {})).data).toEqual([])
        } finally {
            await transport.disconnect()
        }
    })
})
