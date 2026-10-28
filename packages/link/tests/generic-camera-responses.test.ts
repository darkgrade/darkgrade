import { GenericCamera } from '@camera/generic-camera'
import { Logger } from '@core/logger'
import type { OperationDefinition } from '@ptp/types/operation'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it } from 'vitest'

function container(type: number, code: number, payload = new Uint8Array()): Uint8Array {
    const bytes = new Uint8Array(12 + payload.length)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, bytes.length, true)
    view.setUint16(4, type, true)
    view.setUint16(6, code, true)
    view.setUint32(8, 1, true)
    bytes.set(payload, 12)
    return bytes
}

function parameterBytes(parameters: number[]): Uint8Array {
    const bytes = new Uint8Array(parameters.length * 4)
    const view = new DataView(bytes.buffer)
    parameters.forEach((parameter, index) => view.setUint32(index * 4, parameter, true))
    return bytes
}

function cameraWithResponses(responses: Uint8Array[]) {
    const sent: Uint8Array[] = []
    const transport = {
        isLittleEndian: () => true,
        isConnected: () => true,
        getType: () => 'usb',
        send: async (bytes: Uint8Array) => { sent.push(bytes) },
        receive: async () => {
            const response = responses.shift()
            if (!response) throw new Error('Unexpected receive after the supplied response containers')
            return response
        },
    } as unknown as TransportInterface
    return {
        camera: new GenericCamera(transport, new Logger({ captureConsole: false, renderInTerminal: false })),
        sent,
    }
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
    it.each([0x2001, 0x200f])('preserves response words with outer status %i', async code => {
        const parameters = [0xa004, 0, 0xffffffff, 0x80000000, 7]
        const { camera } = cameraWithResponses([container(3, code, parameterBytes(parameters))])

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

        expect(sent.map(bytes => new DataView(bytes.buffer).getUint16(4, true))).toEqual([1, 2])
        expect(response.parameters).toEqual([0xa001])
    })

    it('leaves parameters absent when the response has no payload', async () => {
        const { camera } = cameraWithResponses([container(3, 0x2001)])

        expect((await camera.send(camera.registry.operations.CloseSession, {})).parameters).toBeUndefined()
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
