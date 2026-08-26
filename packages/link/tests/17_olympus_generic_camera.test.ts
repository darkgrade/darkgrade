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
