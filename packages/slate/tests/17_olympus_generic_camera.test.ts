import { GenericCamera } from '@vendors/generic/generic-camera'
import { Logger } from '@core/logger'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it } from 'vitest'

/** A GenericCamera whose transactions are answered by `send`, with no transport underneath. */
function answeredCamera(send: (camera: GenericCamera) => GenericCamera['send']) {
    const transport = { isLittleEndian: () => true, on: () => undefined } as unknown as TransportInterface
    const camera = new GenericCamera(transport, new Logger({ expanded: false, captureConsole: false, renderInTerminal: false }))
    camera.send = send(camera)
    return camera
}

const dateTime = {
    devicePropertyCode: 0x5011,
    devicePropertyName: 'DateTime',
    devicePropertyDescription: 'Device date and time',
    currentValueDecoded: '20120101T000000',
    currentValueRaw: '20120101T000000',
    getSet: 'GET_SET',
    formFlag: 0,
}
const batteryLevel = {
    devicePropertyCode: 0x5001,
    devicePropertyName: 'BatteryLevel',
    devicePropertyDescription: 'Battery level percentage',
    currentValueDecoded: 100,
    currentValueRaw: 100,
    getSet: 'GET',
    formFlag: 1,
    minimumValue: 1,
    maximumValue: 100,
    stepSize: 1,
}

describe('Olympus generic PTP support', () => {
    it('publishes only standard properties advertised by an Olympus body', async () => {
        const camera = answeredCamera(() => (async (operation, params) => {
            if (operation.name === 'GetDeviceInfo')
                return { code: 0x2001, data: { devicePropertiesSupported: [0x5001, 0x5011, 0xd405] } }
            const code = (params as Record<string, number>).DevicePropCode
            if (operation.name === 'GetDevicePropDesc' && (code === 0x5001 || code === 0x5011))
                return { code: 0x2001, data: code === 0x5001 ? batteryLevel : dateTime }
            throw new Error(`Unexpected operation ${operation.name}`)
        }) as GenericCamera['send'])
        await expect(camera.getStandardPropertyStates()).resolves.toEqual([
            expect.objectContaining({ name: 'BatteryLevel', value: 100, writable: false, form: 'range' }),
            expect.objectContaining({ name: 'DateTime', value: '20120101T000000', writable: true, form: 'none' }),
        ])
    })

    it('sets a writable advertised standard property and rejects an absent exposure control', async () => {
        let writtenDateTime: string | undefined
        const camera = answeredCamera(camera => (async (operation, params, data) => {
            if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: { devicePropertiesSupported: [0x5011] } }
            if (operation.name === 'GetDevicePropDesc') return { code: 0x2001, data: dateTime }
            if (operation.name === 'SetDevicePropValue' && data) {
                writtenDateTime = camera.registry.codecs.string.decode(data).value
                return { code: 0x2001 }
            }
            throw new Error(`Unexpected operation ${operation.name} ${JSON.stringify(params)}`)
        }) as GenericCamera['send'])
        await camera.setStandardProperty('DateTime', '20260825T172500')
        expect(writtenDateTime).toBe('20260825T172500')
        await expect(camera.setStandardProperty('ExposureIndex', 'ISO 200')).rejects.toThrow('does not advertise ExposureIndex')
    })

    it('does not wait for an object event when the caller requests only the capture command', async () => {
        let captureCommands = 0
        const camera = answeredCamera(() => (async operation => {
            if (operation.name === 'InitiateCapture') captureCommands += 1
            return { code: 0x2001 }
        }) as GenericCamera['send'])
        await expect(camera.captureImage({ includeInfo: false, includeData: false })).resolves.toEqual({})
        expect(captureCommands).toBe(1)
    })

    it('subscribes before capture so an immediate ObjectAdded event is not lost', async () => {
        const camera = answeredCamera(camera => (async operation => {
            if (operation.name === 'InitiateCapture') {
                ;(camera as any).emitter.emit(camera.registry.events.ObjectAdded.name, { ObjectHandle: 42 })
                return { code: 0x2001 }
            }
            if (operation.name === 'GetObjectInfo') return { code: 0x2001, data: { filename: 'OLYMPUS.JPG' } }
            throw new Error(`Unexpected operation ${operation.name}`)
        }) as GenericCamera['send'])
        await expect(camera.captureImage({ includeInfo: true, includeData: false })).resolves.toEqual({
            info: { filename: 'OLYMPUS.JPG' },
            data: undefined,
            objectHandle: 42,
        })
    })
})
