import { Camera } from '@camera/index'
import { GenericCamera } from '@camera/generic-camera'
import { Logger } from '@core/logger'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { PTP_DISCOVERY_VENDORS } from '@transport/usb/usb-transport'
import { describe, expect, it } from 'vitest'

describe('Olympus generic PTP support', () => {
    it('requests Olympus devices during WebUSB discovery', () => {
        expect(PTP_DISCOVERY_VENDORS).toContainEqual({ vendorId: VendorIDs.OLYMPUS, name: 'Olympus' })
    })

    it('uses the generic standards-based camera implementation', () => {
        const camera = new Camera({
            device: {
                usb: {
                    filters: [{ vendorId: VendorIDs.OLYMPUS, productId: 0x012f }],
                },
            },
        })

        expect(camera.getInstance()).toBeInstanceOf(GenericCamera)
    })

    it('returns the decoded current value from a standard property descriptor', async () => {
        const transport = {
            isLittleEndian: () => true,
            on: () => undefined,
        } as unknown as TransportInterface
        const camera = new GenericCamera(
            transport,
            new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
        )
        camera.send = (async operation => {
            if (operation.name === 'GetDevicePropDesc') {
                return { code: 0x2001, data: { currentValueDecoded: 'ISO 200' } }
            }
            throw new Error(`Unexpected operation ${operation.name}`)
        }) as typeof camera.send

        await expect(camera.getIso()).resolves.toBe('ISO 200')
    })

    it('publishes only standard properties advertised by an Olympus body', async () => {
        const transport = {
            isLittleEndian: () => true,
            on: () => undefined,
        } as unknown as TransportInterface
        const camera = new GenericCamera(
            transport,
            new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
        )
        camera.send = (async (operation, params) => {
            if (operation.name === 'GetDeviceInfo') {
                return { code: 0x2001, data: { devicePropertiesSupported: [0x5001, 0x5011, 0xd405] } }
            }
            if (operation.name === 'GetDevicePropDesc' && (params as Record<string, number>).DevicePropCode === 0x5001) {
                return {
                    code: 0x2001,
                    data: {
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
                    },
                }
            }
            if (operation.name === 'GetDevicePropDesc' && (params as Record<string, number>).DevicePropCode === 0x5011) {
                return {
                    code: 0x2001,
                    data: {
                        devicePropertyCode: 0x5011,
                        devicePropertyName: 'DateTime',
                        devicePropertyDescription: 'Device date and time',
                        currentValueDecoded: '20120101T000000',
                        currentValueRaw: '20120101T000000',
                        getSet: 'GET_SET',
                        formFlag: 0,
                    },
                }
            }
            throw new Error(`Unexpected operation ${operation.name}`)
        }) as typeof camera.send

        await expect(camera.getStandardPropertyStates()).resolves.toEqual([
            expect.objectContaining({ name: 'BatteryLevel', value: 100, writable: false, form: 'range' }),
            expect.objectContaining({ name: 'DateTime', value: '20120101T000000', writable: true, form: 'none' }),
        ])
    })

    it('sets a writable advertised standard property and rejects an absent exposure control', async () => {
        const transport = {
            isLittleEndian: () => true,
            on: () => undefined,
        } as unknown as TransportInterface
        const camera = new GenericCamera(
            transport,
            new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
        )
        let writtenDateTime: string | undefined
        camera.send = (async (operation, params, data) => {
            if (operation.name === 'GetDeviceInfo') {
                return { code: 0x2001, data: { devicePropertiesSupported: [0x5011] } }
            }
            if (operation.name === 'GetDevicePropDesc') {
                return {
                    code: 0x2001,
                    data: {
                        devicePropertyCode: 0x5011,
                        devicePropertyName: 'DateTime',
                        devicePropertyDescription: 'Device date and time',
                        currentValueDecoded: '20120101T000000',
                        currentValueRaw: '20120101T000000',
                        getSet: 'GET_SET',
                        formFlag: 0,
                    },
                }
            }
            if (operation.name === 'SetDevicePropValue' && data) {
                writtenDateTime = camera.registry.codecs.string.decode(data).value
                return { code: 0x2001 }
            }
            throw new Error(`Unexpected operation ${operation.name} ${JSON.stringify(params)}`)
        }) as typeof camera.send

        await camera.setStandardProperty('DateTime', '20260825T172500')
        expect(writtenDateTime).toBe('20260825T172500')
        await expect(camera.setStandardProperty('ExposureIndex', 'ISO 200')).rejects.toThrow(
            'does not advertise ExposureIndex'
        )
    })

    it('does not wait for an object event when the caller requests only the capture command', async () => {
        const transport = {
            isLittleEndian: () => true,
            on: () => undefined,
        } as unknown as TransportInterface
        const camera = new GenericCamera(
            transport,
            new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
        )
        let captureCommands = 0
        camera.send = (async operation => {
            if (operation.name === 'InitiateCapture') captureCommands += 1
            return { code: 0x2001 }
        }) as typeof camera.send

        await expect(camera.captureImage({ includeInfo: false, includeData: false })).resolves.toEqual({})
        expect(captureCommands).toBe(1)
    })

    it('subscribes before capture so an immediate ObjectAdded event is not lost', async () => {
        const transport = {
            isLittleEndian: () => true,
            on: () => undefined,
        } as unknown as TransportInterface
        const camera = new GenericCamera(
            transport,
            new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
        )
        camera.send = (async operation => {
            if (operation.name === 'InitiateCapture') {
                ;(camera as any).emitter.emit(camera.registry.events.ObjectAdded.name, { ObjectHandle: 42 })
                return { code: 0x2001 }
            }
            if (operation.name === 'GetObjectInfo') return { code: 0x2001, data: { filename: 'OLYMPUS.JPG' } }
            throw new Error(`Unexpected operation ${operation.name}`)
        }) as typeof camera.send

        await expect(camera.captureImage({ includeInfo: true, includeData: false })).resolves.toEqual({
            info: { filename: 'OLYMPUS.JPG' },
            data: undefined,
        })
    })
})
