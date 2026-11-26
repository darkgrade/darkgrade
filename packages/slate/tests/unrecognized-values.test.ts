import { CanonCamera } from '@vendors/canon/canon-camera'
import { GenericCamera } from '@vendors/generic/generic-camera'
import { Camera } from '@camera/index'
import { SonyCamera } from '@vendors/sony/sony-camera'
import { validateProtocol, type ProtocolEvidence } from '@contribute/protocol'
import { Logger } from '@core/logger'
import { DeviceInfoCodec } from '@ptp/datasets/device-info-dataset'
import { CanonEventDataCodec } from '@vendors/canon/datasets/canon-event-data-dataset'
import { SDIDevicePropInfoArrayCodec } from '@vendors/sony/datasets/sdi-ext-device-prop-info-dataset'
import type { OperationDefinition } from '@ptp/types/operation'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { readCameraCapabilities } from '@vendors/camera-controls'
import { describe, expect, it, vi } from 'vitest'
import { protocolSession } from '@camera/protocol-session'

const logger = () => new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })

function join(...chunks: Uint8Array[]): Uint8Array {
    const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
    }
    return result
}

function words(...values: number[]): Uint8Array {
    const bytes = new Uint8Array(values.length * 4)
    values.forEach((value, index) => new DataView(bytes.buffer).setUint32(index * 4, value, true))
    return bytes
}

function observe(camera: GenericCamera): ProtocolEvidence[] {
    const evidence: ProtocolEvidence[] = []
    camera.observeProfile(crypto.randomUUID(), item => evidence.push(item))
    return evidence
}

const unrecognized = (evidence: ProtocolEvidence[]) =>
    evidence.filter(item => item.type === 'unrecognized-value').map(({ benchmarkId: _scope, ...item }) => item)

describe('Canon values outside the codec tables', () => {
    function canon(current: number, choices: number[]) {
        const camera = new Camera({
            vendorId: 0x04a9,
            transport: { isLittleEndian: () => true, isConnected: () => true, on: () => undefined } as unknown as TransportInterface,
        })
        const driver = protocolSession(camera).driver as CanonCamera
        const property = driver.registry.properties.CanonFocusMode
        const deviceInfo = new DeviceInfoCodec(driver.registry)
        const send = async (operation: OperationDefinition) => {
            if (operation.name === 'GetDeviceInfo')
                return { code: 0x2001, data: deviceInfo.decode(deviceInfo.encode({
                    standardVersion: 100, vendorExtensionID: 0, vendorExtensionVersion: 100, vendorExtensionDesc: '',
                    functionalMode: 0, operationsSupportedRaw: [0x1001, 0x9116], operationsSupportedDecoded: [],
                    eventsSupportedRaw: [], eventsSupportedDecoded: [], devicePropertiesSupported: [],
                    devicePropertiesSupportedDecoded: [], captureFormats: [], imageFormatsRaw: [], imageFormatsDecoded: [],
                    manufacturer: 'Canon', model: 'Fixture', deviceVersion: '1', serialNumber: '',
                })).value }
            const wire = join(
                words(16, 0xc189, property.code, current),
                words(20 + choices.length * 4, 0xc18a, property.code, 3, choices.length, ...choices)
            )
            return { code: 0x2001, data: new CanonEventDataCodec(driver.registry).decode(wire).value }
        }
        vi.spyOn(driver, 'send').mockImplementation(send as never)
        return { camera, driver, evidence: observe(driver) }
    }

    it('keeps an unknown current value visible, flagged and read-only without a decoded value', async () => {
        const { camera, driver, evidence } = canon(999, [0, 3])
        const focus = (await camera.getCapabilities()).controls.focusMode!
        expect(focus).toMatchObject({
            value: 'Unrecognized (0x3e7)',
            allowedValues: ['AF-S', 'MF'],
            writable: false,
            unrecognized: { value: '0x3e7' },
        })
        const state = driver.listPropertyStates().find(item => item.name === 'CanonFocusMode')!
        expect(state.value).toBeUndefined()
        expect(state.unrecognized).toEqual({ value: '0x3e7' })
        expect(driver.listUnknownPropertyStates().find(item => item.code === 0xd108)?.rawValue).toBe(999)
        await expect(camera.setControl('focusMode', 'MF')).rejects.toThrow('not writable')
        expect(unrecognized(evidence)).toEqual([
            { type: 'unrecognized-value', vendorId: 0x04a9, property: 0xd108, dataType: 6, raw: 999, choice: false },
        ])
    })

    it('lists an unknown choice without offering it, and keeps the known choices writable', async () => {
        const { camera, driver, evidence } = canon(3, [0, 0x77, 3])
        const focus = (await camera.getCapabilities()).controls.focusMode!
        expect(focus).toMatchObject({
            value: 'MF',
            allowedValues: ['AF-S', 'MF'],
            writable: true,
            unrecognized: { choices: ['0x77'] },
        })
        const write = vi.spyOn(driver, 'set').mockResolvedValue(undefined)
        await expect(camera.setControl('focusMode', '0x77')).rejects.toThrow('not advertised')
        expect(write).not.toHaveBeenCalled()
        expect(unrecognized(evidence)).toEqual([
            { type: 'unrecognized-value', vendorId: 0x04a9, property: 0xd108, dataType: 6, raw: 0x77, choice: true },
        ])
        await camera.getCapabilities()
        expect(unrecognized(evidence)).toHaveLength(1)
    })

    it('clears the flag once the camera reports a known value again', async () => {
        const { driver } = canon(999, [0, 3])
        ;(driver as unknown as { processEvents: (events: unknown[]) => void }).processEvents([
            { code: 0xc189, parameters: [0xd108, 999] },
            { code: 0xc189, parameters: [0xd108, 3] },
        ])
        expect(driver.listPropertyStates().find(item => item.name === 'CanonFocusMode')).toMatchObject({ value: 'manual' })
        expect(driver.listPropertyStates().find(item => item.name === 'CanonFocusMode')?.unrecognized).toBeUndefined()
    })
})

describe('standard descriptors outside the codec tables', () => {
    function container(type: number, code: number, transactionId: number, payload: Uint8Array = new Uint8Array()) {
        const bytes = new Uint8Array(12 + payload.length)
        const view = new DataView(bytes.buffer)
        view.setUint32(0, bytes.length, true)
        view.setUint16(4, type, true)
        view.setUint16(6, code, true)
        view.setUint32(8, transactionId, true)
        bytes.set(payload, 12)
        return bytes
    }

    function standard(current: number, choices: number[]) {
        const responses: Uint8Array[] = []
        const transport = {
            isLittleEndian: () => true,
            isConnected: () => true,
            getType: () => 'usb',
            send: async () => {},
            receive: async () => responses.shift()!,
        } as unknown as TransportInterface
        const camera = new GenericCamera(transport, logger())
        const codecs = camera.registry.codecs
        const deviceInfo = new DeviceInfoCodec(camera.registry).encode({
            standardVersion: 100, vendorExtensionID: 0, vendorExtensionVersion: 100, vendorExtensionDesc: '',
            functionalMode: 0, operationsSupportedRaw: [0x1001, 0x1014], operationsSupportedDecoded: [],
            eventsSupportedRaw: [], eventsSupportedDecoded: [], devicePropertiesSupported: [0x500d],
            devicePropertiesSupportedDecoded: [], captureFormats: [], imageFormatsRaw: [], imageFormatsDecoded: [],
            manufacturer: 'Fixture', model: 'Fixture', deviceVersion: '1', serialNumber: '',
        })
        // ExposureTime ticks of 1/10000 s; its codec refuses zero.
        const descriptor = join(
            codecs.uint16.encode(0x500d), codecs.uint16.encode(6), codecs.uint8.encode(1),
            codecs.uint32.encode(100), codecs.uint32.encode(current), codecs.uint8.encode(2),
            codecs.uint16.encode(choices.length), ...choices.map(choice => codecs.uint32.encode(choice))
        )
        const respond = (transactionId: number) => responses.push(
            container(2, 0x1001, transactionId, deviceInfo), container(3, 0x2001, transactionId),
            container(2, 0x1014, transactionId + 1, descriptor), container(3, 0x2001, transactionId + 1)
        )
        return { camera, respond, evidence: observe(camera) }
    }

    it('flags an unknown choice, leaves it out of the writable choices and shares it once', async () => {
        const { camera, respond, evidence } = standard(100, [100, 0, 200])
        respond(1)
        const [state] = await camera.getStandardPropertyStates('ExposureTime')
        expect(state).toMatchObject({ value: '1/100', allowedValues: ['1/100', '1/50'], unrecognized: { choices: ['0x0'] } })
        respond(3)
        const shutter = (await readCameraCapabilities(camera, 'shutterSpeed')).controls.shutterSpeed!
        expect(shutter).toMatchObject({ value: '1/100', allowedValues: ['1/100', '1/50'], writable: true, unrecognized: { choices: ['0x0'] } })
        expect(unrecognized(evidence)).toEqual([
            { type: 'unrecognized-value', vendorId: 0, property: 0x500d, dataType: 6, raw: 0, choice: true },
        ])
    })

    it('shows an unknown current value raw and read-only', async () => {
        const { camera, respond, evidence } = standard(0, [100, 200])
        respond(1)
        const shutter = (await readCameraCapabilities(camera, 'shutterSpeed')).controls.shutterSpeed!
        expect(shutter).toMatchObject({ value: 'Unrecognized (0x0)', writable: false, unrecognized: { value: '0x0' } })
        expect(shutter.exposureTime).toBeUndefined()
        expect(unrecognized(evidence)).toEqual([
            { type: 'unrecognized-value', vendorId: 0, property: 0x500d, dataType: 6, raw: 0, choice: false },
        ])
    })
})

describe('Sony descriptors outside the codec tables', () => {
    it('flags the raw focus mode and its unknown choice', () => {
        const camera = new SonyCamera(
            { isLittleEndian: () => true, on: () => undefined } as unknown as TransportInterface,
            logger()
        )
        const codecs = camera.registry.codecs
        const payload = join(
            codecs.uint32.encode(1), codecs.uint32.encode(0),
            codecs.uint16.encode(0x500a), codecs.uint16.encode(4), codecs.uint8.encode(1), codecs.uint8.encode(1),
            codecs.uint16.encode(2), codecs.uint16.encode(0x7777), codecs.uint8.encode(2),
            codecs.uint16.encode(3), ...[2, 0x7777, 0x8004].map(value => codecs.uint16.encode(value))
        )
        const descriptor = new SDIDevicePropInfoArrayCodec(camera.registry).decode(payload).value.properties[0]
        expect(descriptor).toMatchObject({ currentValueUnrecognized: true, unrecognizedSupportedValues: [0x7777] })
        ;(camera as unknown as { propertyCache: Map<number, unknown> }).propertyCache.set(0x500a, descriptor)
        expect(camera.listPropertyStates()[0]).toMatchObject({
            value: 0x7777,
            allowedValues: ['AF-S', 'AF-C'],
            allowedRawValues: [2, 0x8004],
            unrecognized: { value: '0x7777', choices: ['0x7777'] },
        })
    })
})

describe('unrecognized value evidence', () => {
    const evidence = { type: 'unrecognized-value', vendorId: 0x04a9, property: 0xd108, dataType: 6, raw: 999, choice: false }

    it('accepts numeric raw values of reviewed properties and rejects anything else', () => {
        validateProtocol(evidence)
        validateProtocol({ ...evidence, choice: true, raw: '4294967295' })
        for (const invalid of [
            { ...evidence, raw: 'PRIVATE' }, { ...evidence, raw: 0x100000000 }, { ...evidence, raw: -1 },
            { ...evidence, raw: undefined }, { ...evidence, property: 0xd115 }, { ...evidence, vendorId: 0, property: 0xd108 },
            { ...evidence, dataType: 0 }, { ...evidence, choice: 'yes' }, { ...evidence, choice: undefined },
            { ...evidence, label: 'Unrecognized' }, { ...evidence, valueData: '0x3e7' },
        ]) expect(() => validateProtocol(invalid)).toThrow()
    })

    it('accepts only a first-contact purpose on a benchmark summary', () => {
        const summary = { type: 'benchmark', vendorId: 0, benchmarkId: crypto.randomUUID(), status: 'complete', checks: 2, failures: 0 }
        validateProtocol(summary)
        validateProtocol({ ...summary, purpose: 'first-contact' })
        for (const purpose of ['', 'other', 1, null]) expect(() => validateProtocol({ ...summary, purpose })).toThrow()
    })

    it('shares each distinct raw value of a property once per session and never throws', () => {
        const camera = new GenericCamera(
            { isLittleEndian: () => true, isConnected: () => true } as unknown as TransportInterface,
            logger()
        )
        const observed = observe(camera)
        for (const raw of [999, 999, 1000, 999, 1000]) camera.recordProtocol({ ...evidence, raw } as ProtocolEvidence)
        camera.recordProtocol({ ...evidence, choice: true } as ProtocolEvidence)
        expect(unrecognized(observed).map(item => [item.type === 'unrecognized-value' && item.raw, item.type === 'unrecognized-value' && item.choice]))
            .toEqual([[999, false], [1000, false], [999, true]])
        const failing = new GenericCamera(
            { isLittleEndian: () => true, isConnected: () => true } as unknown as TransportInterface,
            logger()
        )
        failing.observeProfile(crypto.randomUUID(), () => { throw new Error('observer failed') })
        expect(() => failing.recordProtocol(evidence as ProtocolEvidence)).not.toThrow()
    })
})
