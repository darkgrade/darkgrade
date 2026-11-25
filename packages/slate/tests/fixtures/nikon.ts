import { Logger } from '@core/logger'
import { ObjectInfoCodec, type ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { encodedDeviceInfo, fakeTransport } from '@tests/fixtures/camera-fixtures'
import { NikonCamera } from '@vendors/nikon/nikon-camera'
import type { Registry } from '@vendors/registry'

/** A NikonCamera on a connected little-endian transport; each test answers transactions itself. */
export const nikonCamera = (transport: Record<string, unknown> = {}) =>
    new NikonCamera(fakeTransport(transport), new Logger({ captureConsole: false, renderInTerminal: false }))

/** A Nikon DeviceInfo reply exactly as the codec decodes it from the wire. */
export const nikonDeviceInfo = (registry: Registry, operationsSupportedRaw: number[]) =>
    encodedDeviceInfo(registry, { operationsSupportedRaw, manufacturer: 'Nikon Corporation', model: 'Z 5_2' })

/** A card file's ObjectInfo reply exactly as the codec decodes it from the wire. */
export function cardObjectInfo(registry: Registry, filename: string, size: number): ObjectInfo {
    const codec = new ObjectInfoCodec(registry)
    return codec.decode(
        codec.encode({
            storageID: 0x00010001,
            objectFormat: 0x3801,
            objectFormatDecoded: '',
            protectionStatus: 0,
            objectCompressedSize: size,
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
            filename,
            captureDate: '20261124T120000',
            modificationDate: '20261124T120000',
            keywords: '',
        })
    ).value
}
