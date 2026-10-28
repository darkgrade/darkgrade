import { Camera } from '@camera/index'
import { genericOperationRegistry } from '@ptp/definitions/operation-definitions'
import type { CameraProfile } from '@transport/simulated/camera-profile'
import { SimulatedTransport } from '@transport/simulated/simulated-transport'
import { describe, expect, it, vi } from 'vitest'

/** Standard PTP mechanics only; these synthetic values never qualify a branded camera. */
function controlsFixture(): CameraProfile {
    return {
        schemaVersion: 1,
        id: 'bench-controls-contract',
        manufacturer: 'Fixture',
        line: 'Standard PTP contract',
        model: 'Controls workflow fixture',
        provenance: {
            fidelity: 'documented',
            sources: [{ location: 'tests/camera-simulation/bench-controls-workflow.test.ts' }],
        },
        deviceInfo: {
            manufacturer: 'Fixture',
            model: 'Controls workflow fixture',
            operationsSupported: ['0x1001', '0x1002', '0x1003', '0x1014', '0x1015', '0x1016'],
            devicePropertiesSupported: ['0x5001', '0x500f'],
            eventsSupported: [],
            listsComplete: true,
            source: 0,
        },
        properties: [
            {
                code: '0x500f',
                descriptor: {
                    dataType: '0x0004',
                    writable: true,
                    factoryDefault: 100,
                    current: 100,
                    form: { enumeration: [100, 200, 400] },
                },
                source: 0,
            },
            {
                code: '0x5001',
                descriptor: { dataType: '0x0002', writable: false, factoryDefault: 100, current: 80 },
                source: 0,
            },
        ],
        exchanges: [],
        events: [],
        quirks: [],
    }
}

function target() {
    const transport = new SimulatedTransport(controlsFixture())
    const sent = vi.spyOn(transport, 'send')
    const camera = new Camera({
        transport,
        logger: { renderInTerminal: false, captureConsole: false },
        transactionPolicy: { deviceBusyRetries: 0 },
    })
    const writes = () =>
        sent.mock.calls.filter(([bytes]) => {
            const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            return header.getUint16(4, true) === 1 && header.getUint16(6, true) === 0x1016
        })
    return { camera, transport, writes }
}

describe('public Camera controls workflow used by Test Bench', () => {
    it('discovers legal choices, writes, freshly reads back, restores and disconnects', async () => {
        const { camera, transport, writes } = target()
        await camera.connect()
        try {
            const identity = await camera.send(genericOperationRegistry.GetDeviceInfo, {})
            expect(identity.data.model).toBe('Controls workflow fixture')
            const original = (await camera.getStandardPropertyStates()).find(state => state.code === 0x500f)!
            expect(original).toMatchObject({ writable: true, value: 'ISO 100' })
            const requested = original.allowedValues!.find(value => value !== original.value) as string
            expect(requested).toBe('ISO 200')
            try {
                await camera.setStandardProperty(original.code, requested)
                const fresh = (await camera.getStandardPropertyStates()).find(state => state.code === original.code)!
                expect(fresh.value).toBe(requested)
                expect(fresh.rawValue).toBe(200)
            } finally {
                await camera.setStandardProperty(original.code, String(original.value))
            }
            expect(
                (await camera.getStandardPropertyStates()).find(state => state.code === original.code)?.rawValue
            ).toBe(100)
            expect(writes()).toHaveLength(2)
            expect(transport.missingData).toEqual([])
        } finally {
            await camera.disconnect()
        }
        expect(transport.isConnected()).toBe(false)
    })

    it('rejects unavailable choices, read-only and unadvertised controls before a write', async () => {
        const { camera, transport, writes } = target()
        await camera.connect()
        try {
            await expect(camera.setStandardProperty('ExposureIndex', 'ISO 800')).rejects.toThrow('not advertised')
            await expect(camera.setStandardProperty('BatteryLevel', 60)).rejects.toThrow('read-only')
            await expect(camera.setStandardProperty('FNumber', 2.8)).rejects.toThrow('does not advertise')
            expect(writes()).toHaveLength(0)
            expect((await camera.getStandardPropertyStates()).find(state => state.code === 0x500f)?.rawValue).toBe(100)
            expect(transport.missingData).toEqual([])
        } finally {
            await camera.disconnect()
        }
    })
})
