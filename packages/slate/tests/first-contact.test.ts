import { Camera } from '@camera/index'
import { DeviceInfoCodec, type DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { createPTPRegistry } from '@vendors/registry'
import { answeringTransport, ptpContainer } from '@tests/fixtures/ptp-wire'
import { encodedDeviceInfo } from '@tests/fixtures/camera-fixtures'
import { recordFirstContact, type FirstContactDependencies } from '@workflows/first-contact'
import { runBenchmark } from '@workflows/telemetry-benchmark'
import { describe, expect, it } from 'vitest'

const codecs = createPTPRegistry(true).codecs
const information = new DeviceInfoCodec(createPTPRegistry(true))
const fujifilm: DeviceInfo = encodedDeviceInfo(createPTPRegistry(true), {
    vendorExtensionID: 0x0e,
    operationsSupportedRaw: [0x1001, 0x1002, 0x1003, 0x1004, 0x1014, 0x100e, 0x1009],
    devicePropertiesSupported: [0x5001, 0x5011, 0xdf01, 0xdf02],
    manufacturer: 'FUJIFILM',
    model: 'X100VI',
    deviceVersion: '1.10',
    serialNumber: 'PRIVATE_SERIAL',
})
const descriptor = (property: number) =>
    Uint8Array.from([
        ...codecs.uint16.encode(property),
        ...codecs.uint16.encode(4),
        0,
        ...codecs.uint16.encode(100),
        ...codecs.uint16.encode(75),
        0,
    ])

/** A read-only camera: any data-out (write) container fails the test. */
function fixture(identity: DeviceInfo = fujifilm) {
    const commands: { code: number; parameter?: number }[] = []
    const { transport } = answeringTransport(
        ({ type, code, transactionId: id, parameters: [parameter] }) => {
            if (type !== 1) throw new Error('First contact must not write')
            commands.push({ code, parameter })
            return [
                ...(code === 0x1001 ? [ptpContainer(2, code, id, information.encode(identity))] : []),
                ...(code === 0x1004 ? [ptpContainer(2, code, id, codecs.uint32.encode(0))] : []),
                ...(code === 0x1014 ? [ptpContainer(2, code, id, descriptor(parameter ?? 0))] : []),
                ptpContainer(3, 0x2001, id),
            ]
        },
        { connected: false }
    )
    return { transport, commands }
}
const quiet = { renderInTerminal: false, captureConsole: false }
function dependencies(overrides: Partial<FirstContactDependencies> = {}) {
    const seen = new Set<string>(),
        saved: unknown[] = []
    const value: FirstContactDependencies = {
        sharingEnabled: async () => true,
        firstSighting: async identity => !seen.has(identity) && !!seen.add(identity),
        saveProfile: async profile => saved.push(profile),
        flush: async () => 'sent',
        ...overrides,
    }
    return { value, saved }
}

describe('unknown-vendor benchmark inventory', () => {
    it('reads every advertised vendor code but not known private properties', async () => {
        const source = fixture()
        const camera = new Camera({ transport: source.transport, vendorId: 0x04cb, logger: quiet })
        await camera.connect()
        try {
            const result = await runBenchmark(camera)
            const read = source.commands.filter(command => command.code === 0x1014).map(command => command.parameter)
            expect(read).toEqual([0x5001, 0xdf01, 0xdf02])
            expect(result.profile.descriptorShapes).toEqual(
                read.map(property => ({ property, dataType: 4, writable: false, form: 0 }))
            )
            expect(result.profile.datasets).toContainEqual(
                expect.objectContaining({ type: 'unknown', category: 'property', code: 0xdf01, advertised: true })
            )
            expect(JSON.stringify(result)).not.toContain('PRIVATE_SERIAL')
        } finally {
            await camera.disconnect()
        }
    })
})

describe('first contact', () => {
    it('inventories an unvalidated body once, read-only, as a first-contact profile', async () => {
        const source = fixture()
        const camera = new Camera({ transport: source.transport, vendorId: 0x04cb, logger: quiet })
        await camera.connect()
        try {
            const { value, saved } = dependencies()
            expect(await recordFirstContact(camera, value)).toBe(true)
            expect(saved).toHaveLength(1)
            const profile = saved[0] as Awaited<ReturnType<typeof runBenchmark>>['profile']
            expect(profile).toMatchObject({ purpose: 'first-contact', hardwarePass: false, status: 'complete' })
            expect(profile.datasets).toContainEqual(
                expect.objectContaining({ type: 'benchmark', status: 'complete', purpose: 'first-contact' })
            )
            const codes = source.commands.map(command => command.code)
            expect(codes).toContain(0x1004)
            expect(codes.some(code => [0x100e, 0x1009, 0x1016].includes(code))).toBe(false)
            // Same model and firmware again: nothing new is read; the session's identity is already known.
            const before = source.commands.length
            expect(await recordFirstContact(camera, value)).toBe(false)
            expect(source.commands.slice(before).map(command => command.code)).toEqual([])
        } finally {
            await camera.disconnect()
        }
    })

    it('skips validated bodies, opted-out installations and never throws', async () => {
        const validated = fixture({ ...fujifilm, manufacturer: 'Sony Corporation', model: 'ILCE-6700' })
        const camera = new Camera({ transport: validated.transport, logger: quiet })
        await camera.connect()
        const { value, saved } = dependencies()
        expect(await recordFirstContact(camera, value)).toBe(false)
        await camera.disconnect()

        const optedOut = fixture()
        const other = new Camera({ transport: optedOut.transport, vendorId: 0x04cb, logger: quiet })
        await other.connect()
        const start = optedOut.commands.length
        expect(await recordFirstContact(other, dependencies({ sharingEnabled: async () => false }).value)).toBe(false)
        expect(optedOut.commands.length).toBe(start)
        expect(
            await recordFirstContact(
                other,
                dependencies({
                    saveProfile: async () => {
                        throw new Error('Disk full')
                    },
                }).value
            )
        ).toBe(false)
        await other.disconnect()
        expect(saved).toHaveLength(0)
    })

    it('does not run on its own under tests or for simulated transports', async () => {
        const source = fixture()
        const camera = new Camera({ transport: source.transport, vendorId: 0x04cb, logger: quiet })
        await camera.connect()
        expect(source.commands.filter(command => command.code === 0x1014)).toHaveLength(0)
        await camera.disconnect()
    })
})
