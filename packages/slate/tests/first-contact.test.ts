import { Camera } from '@camera/index'
import { isValidatedModel } from '@camera/validated-models'
import { DeviceInfoCodec, type DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { createPTPRegistry } from '@ptp/registry'
import { TransportType, type TransportInterface } from '@transport/interfaces/transport.interface'
import { recordFirstContact, type FirstContactDependencies } from '@workflows/first-contact'
import { runCameraBenchmark } from '@workflows/telemetry-benchmark'
import { describe, expect, it } from 'vitest'

const codecs = createPTPRegistry(true).codecs
const information = new DeviceInfoCodec(createPTPRegistry(true))
const fujifilm: DeviceInfo = {
    standardVersion: 100,
    vendorExtensionID: 0x0e,
    vendorExtensionVersion: 100,
    vendorExtensionDesc: '',
    functionalMode: 0,
    operationsSupportedRaw: [0x1001, 0x1002, 0x1003, 0x1004, 0x1014, 0x100e, 0x1009],
    eventsSupportedRaw: [],
    devicePropertiesSupported: [0x5001, 0x5011, 0xdf01, 0xdf02],
    captureFormats: [],
    imageFormatsRaw: [],
    manufacturer: 'FUJIFILM',
    model: 'X100VI',
    deviceVersion: '1.10',
    serialNumber: 'PRIVATE_SERIAL',
    operationsSupportedDecoded: [],
    eventsSupportedDecoded: [],
    devicePropertiesSupportedDecoded: [],
    imageFormatsDecoded: [],
}
const packet = (type: number, code: number, transactionId: number, data: Uint8Array = new Uint8Array()) => {
    const bytes = new Uint8Array(12 + data.length)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, bytes.length, true)
    view.setUint16(4, type, true)
    view.setUint16(6, code, true)
    view.setUint32(8, transactionId, true)
    bytes.set(data, 12)
    return bytes
}
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
    const replies: Uint8Array[] = []
    let connected = false
    const transport: TransportInterface = {
        connect: async () => {
            connected = true
        },
        disconnect: async () => {
            connected = false
        },
        isConnected: () => connected,
        isLittleEndian: () => true,
        getType: () => TransportType.USB,
        classRequestReset: async () => undefined,
        send: async bytes => {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            if (view.getUint16(4, true) !== 1) throw new Error('First contact must not write')
            const code = view.getUint16(6, true),
                id = view.getUint32(8, true)
            const parameter = bytes.length >= 16 ? view.getUint32(12, true) : undefined
            commands.push({ code, parameter })
            if (code === 0x1001) replies.push(packet(2, code, id, information.encode(identity)))
            if (code === 0x1004) replies.push(packet(2, code, id, codecs.uint32.encode(0)))
            if (code === 0x1014) replies.push(packet(2, code, id, descriptor(parameter ?? 0)))
            replies.push(packet(3, 0x2001, id))
        },
        receive: async () => {
            const bytes = replies.shift()
            if (!bytes) throw new Error('Unexpected read')
            return bytes
        },
    }
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
            const result = await runCameraBenchmark(camera)
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
            const profile = saved[0] as Awaited<ReturnType<typeof runCameraBenchmark>>['profile']
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
        expect(isValidatedModel('ILCE-6700')).toBe(true)
        expect(isValidatedModel(' canon eos r6 mark iii ')).toBe(true)
        expect(isValidatedModel('ILCE-7M5')).toBe(false)
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
