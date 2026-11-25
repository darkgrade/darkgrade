import type { CanonCamera } from '@vendors/canon/canon-camera'
import { Camera } from '@camera/index'
import type { SonyCamera } from '@vendors/sony/sony-camera'
import { ObjectInfoCodec, type ObjectInfo } from '@ptp/datasets/object-info-dataset'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { encodeMediaId } from '@vendors/generic/media-id'
import { expect, it, vi } from 'vitest'
import { protocolSession } from '@camera/protocol-session'

const transport = () =>
    ({ isLittleEndian: () => true, isConnected: () => true, on: () => undefined, getType: () => 'usb' }) as unknown as TransportInterface

/** The new photo's ObjectInfo exactly as the codec decodes it from the wire. */
function photoInfo(camera: Camera): ObjectInfo {
    const codec = new ObjectInfoCodec(protocolSession(camera).driver.registry)
    return codec.decode(
        codec.encode({
            storageID: 0x00010001,
            objectFormat: 0x3801,
            objectFormatDecoded: '',
            protectionStatus: 0,
            objectCompressedSize: 2,
            thumbFormat: 0,
            thumbFormatDecoded: '',
            thumbCompressedSize: 0,
            thumbPixWidth: 0,
            thumbPixHeight: 0,
            imagePixWidth: 0,
            imagePixHeight: 0,
            imageBitDepth: 0,
            parentObject: 0,
            associationType: 0,
            associationDesc: 0,
            sequenceNumber: 0,
            filename: 'DSC00001.JPG',
            captureDate: '20261124T120000',
            modificationDate: '20261124T120000',
            keywords: '',
        })
    ).value
}

it.each([false, true])('takePhoto on Sony restores movie mode after success/failure (%s)', async fail => {
    vi.useFakeTimers()
    try {
        const camera = new Camera({ vendorId: 0x054c, transport: transport() })
        const driver = protocolSession(camera).driver as SonyCamera
        let mode = 'Movie Flexible Exposure'
        vi.spyOn(driver, 'resumeShooting').mockResolvedValue()
        vi.spyOn(driver, 'refreshPropertyStates').mockImplementation(async () => [
            { code: 0x500e, value: mode, allowedValues: ['Manual', mode] } as never,
        ])
        // This body offers no card index, so its photo has no media id; mode handling is under test.
        vi.spyOn(driver, 'send').mockResolvedValue({ code: 0x2005 } as never)
        vi.spyOn(driver, 'set').mockImplementation(async (_property, value) => { mode = String(value) })
        vi.spyOn(driver, 'captureImage').mockImplementation(async () => {
            expect(mode).toBe('Manual')
            if (fail) throw new Error('shutter failed')
            return { info: photoInfo(camera), data: Uint8Array.of(1, 2) }
        })
        const capture = camera.takePhoto({ destination: 'computer' })
        const assertion = fail ? expect(capture).rejects.toThrow('shutter failed')
            : expect(capture).resolves.toMatchObject({ destination: 'computer', name: 'DSC00001.JPG', data: Uint8Array.of(1, 2) })
        await vi.runAllTimersAsync()
        await assertion
        expect(mode).toBe('Movie Flexible Exposure')
    } finally { vi.useRealTimers() }
})

it.each([false, true])('takePhoto on Canon restores remote movie mode after success/failure (%s)', async fail => {
    vi.useFakeTimers()
    try {
        const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
        const driver = protocolSession(camera).driver as CanonCamera
        let movie = true
        vi.spyOn(driver, 'listUnknownPropertyStates').mockImplementation(() =>
            [{ code: 0xd1c2, codeHex: '0xd1c2', name: 'FixedMovie', rawValue: movie ? 1 : 0 }])
        vi.spyOn(driver, 'listPropertyStates').mockReturnValue([
            { code: 0xd105, name: 'CanonAutoExposureMode', description: '', access: 'GetSet', value: 1 },
        ])
        vi.spyOn(driver, 'leaveMovieMode').mockImplementation(async () => { movie = false })
        vi.spyOn(driver, 'enterMovieMode').mockImplementation(async () => { movie = true })
        vi.spyOn(driver, 'captureImage').mockImplementation(async () => {
            expect(movie).toBe(false)
            if (fail) throw new Error('shutter failed')
            return { info: photoInfo(camera), objectHandle: 0x21 }
        })
        const capture = camera.takePhoto()
        const assertion = fail ? expect(capture).rejects.toThrow('shutter failed')
            : expect(capture).resolves.toEqual({
                destination: 'card',
                mediaId: encodeMediaId({ source: 'object', storageId: 0x00010001, objectHandle: 0x21, name: 'DSC00001.JPG', sizeBytes: 2 }),
                name: 'DSC00001.JPG',
                sizeBytes: 2,
            })
        await vi.runAllTimersAsync()
        await assertion
        expect(movie).toBe(true)
    } finally { vi.useRealTimers() }
})
