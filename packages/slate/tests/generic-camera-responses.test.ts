import { GenericCamera } from '@vendors/generic/generic-camera'
import { NikonCamera } from '@vendors/nikon/nikon-camera'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { Logger } from '@core/logger'
import type { OperationDefinition } from '@ptp/types/operation'
import { describe, expect, it } from 'vitest'
import { answeringTransport, ptpContainer } from '@tests/fixtures/ptp-wire'

const container = (type: number, code: number, payload?: Uint8Array) => ptpContainer(type, code, 1, payload)

const logger = () => new Logger({ captureConsole: false, renderInTerminal: false })

function parameterBytes(parameters: number[]): Uint8Array {
    const bytes = new Uint8Array(parameters.length * 4)
    const view = new DataView(bytes.buffer)
    parameters.forEach((parameter, index) => view.setUint32(index * 4, parameter, true))
    return bytes
}

function cameraWithResponses(responses: Uint8Array[]) {
    const { transport, sent } = answeringTransport()
    transport.receive = async () => {
        const response = responses.shift()
        if (!response) throw new Error('Unexpected receive after the supplied response containers')
        return response
    }
    return { camera: new GenericCamera(transport, logger()), sent, transport }
}

const sendDataOperation = {
    code: 0x1016,
    name: 'SetDevicePropValue',
    description: 'Send a property value',
    dataDirection: 'in',
    operationParameters: [],
    responseParameters: [],
} as const satisfies OperationDefinition

describe('GenericCamera response container parameters', () => {
    it.each([
        [0x2001, [0xa004, 0, 0xffffffff, 0x80000000, 7]],
        [0x200f, [0xa004, 0, 0xffffffff, 0x80000000, 7]],
        [0x2001, undefined],
    ])('preserves response words with outer status %i: %j', async (code, parameters) => {
        const { camera } = cameraWithResponses([container(3, code, parameters && parameterBytes(parameters))])

        const response = await camera.send(camera.registry.operations.CloseSession, {})

        expect(response.code).toBe(code)
        expect(response.parameters).toEqual(parameters)
    })

    it('does not mistake downloaded data for response parameters', async () => {
        const data = Uint8Array.of(0x44, 0x33, 0x22, 0x11)
        const { camera } = cameraWithResponses([
            container(2, 0x1009, data),
            container(3, 0x2001, parameterBytes([4])),
        ])

        const response = await camera.send(camera.registry.operations.GetObject, { ObjectHandle: 1 })

        expect(response.data).toEqual(data)
        expect(response.parameters).toEqual([4])
    })

    it('preserves parameters when a download receives an immediate error response', async () => {
        const payload = parameterBytes([0xa004, 17])
        const { camera } = cameraWithResponses([container(3, 0x200f, payload)])

        const response = await camera.send(camera.registry.operations.GetObject, { ObjectHandle: 1 })

        expect(response.code).toBe(0x200f)
        expect(response.parameters).toEqual([0xa004, 17])
        expect(response.data).toEqual(payload)
    })

    it('keeps the legacy response-payload fallback after an empty data phase', async () => {
        const payload = parameterBytes([0x2001, 23])
        const { camera } = cameraWithResponses([container(2, 0x1009), container(3, 0x2001, payload)])

        const response = await camera.send(camera.registry.operations.GetObject, { ObjectHandle: 1 })

        expect(response.parameters).toEqual([0x2001, 23])
        expect(response.data).toEqual(payload)
    })

    it('preserves response parameters after uploading data', async () => {
        const { camera, sent } = cameraWithResponses([container(3, 0x2001, parameterBytes([0xa001]))])

        const response = await camera.send(sendDataOperation, {}, Uint8Array.of(1, 2))

        expect(sent.map(container => container.type)).toEqual([1, 2])
        expect(response.parameters).toEqual([0xa001])
    })

    it('rejects a non-word-aligned response payload as a framing violation instead of guessing at it', async () => {
        const payload = Uint8Array.of(1, 2, 3)
        const { camera } = cameraWithResponses([container(3, 0x2001, payload)])

        // ISO 15740 response containers carry whole UINT32 parameters only.
        await expect(camera.send(camera.registry.operations.GetObject, { ObjectHandle: 1 })).rejects.toMatchObject({
            name: 'PTPProtocolError',
        })
    })
})

describe('GenericCamera property values', () => {
    // A Nikon Z6 reports NEF compression 2, a value the Z6 III specification Slate names does not list.
    const nikon = (reply: Uint8Array) => {
        const { transport } = cameraWithResponses([container(2, 0x1015, reply), container(3, 0x2001)])
        return new NikonCamera(transport, logger())
    }

    it.each([
        ['a value its codec names by that name', 4, 'High efficiency'],
        ['a value its codec has no name for as the raw number', 2, 2],
    ])('reads %s', async (_case, raw, expected) => {
        const camera = nikon(Uint8Array.of(raw))
        await expect(camera.readValue(camera.registry.properties.NikonRawCompression)).resolves.toBe(expected)
    })

    it('keeps a GetDevicePropValue reply whose value has no name', async () => {
        const camera = nikon(Uint8Array.of(2))
        const response = await camera.send(camera.registry.operations.GetDevicePropValue, {
            DevicePropCode: camera.registry.properties.NikonRawCompression.code,
        })
        expect(response.code).toBe(0x2001)
        expect(response.data).toEqual(Uint8Array.of(2))
    })

    it('still marks the unnamed value unrecognized in a descriptor, and never writes it', () => {
        const camera = nikon(new Uint8Array())
        const property = camera.registry.properties.NikonRawCompression
        // GetDevicePropDesc: code, UINT8, GetSet, default 0, current 2, range 0..2 step 1.
        const bytes = Uint8Array.of(0x16, 0xd0, 0x02, 0x00, 0x01, 0, 2, 0x01, 0, 2, 1)
        const descriptor = new DevicePropDescCodec(camera.registry).decode(bytes).value
        expect(descriptor).toMatchObject({ currentValueDecoded: 2, currentValueUnrecognized: true })
        const codec = property.codec(camera.registry)
        expect(() => codec.encode(2)).toThrow('Invalid enum value: 2')
        expect(codec.encode('Lossless')).toEqual(Uint8Array.of(0))
    })
})
