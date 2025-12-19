import { SonyCamera } from '@camera/sony-camera'
import { Logger } from '@core/logger'
import * as Ops from '@ptp/definitions/operation-definitions'
import * as SonyOps from '@ptp/definitions/vendors/sony/sony-operation-definitions'
import * as SonyProps from '@ptp/definitions/vendors/sony/sony-property-definitions'
import { USBTransport } from '@transport/usb/usb-transport'
import { ObjectInfo } from 'src'

const logger = new Logger({
    expanded: true, // Show all details
})
const transport = new USBTransport(logger)
const camera = new SonyCamera(transport, logger)

const SONY_CAPTURED_IMAGE_OBJECT_HANDLE = 0xffffc001
const SONY_LIVE_VIEW_OBJECT_HANDLE = 0xffffc002

async function main() {
    await camera.connect()

    camera.on(camera.registry.events.ObjectAdded, event => {
        console.log('ObjectAdded event:', event)
    })

    camera.on(camera.registry.events.CaptureComplete, event => {
        console.log('CaptureComplete event:', event)
    })
    camera.on(camera.registry.events.StoreAdded, event => {
        console.log('StoreAdded event:', event)
    })
    camera.on(camera.registry.events.StoreRemoved, event => {
        console.log('StoreRemoved event:', event)
    })

    // test sony ext-device-prop-info dataset
    const iso = await camera.get(SonyProps.Iso)
    const shutterSpeed = await camera.get(SonyProps.ShutterSpeed)
    const aperture = await camera.get(SonyProps.Aperture)

    // test device-info dataset
    const deviceInfo = await camera.send(Ops.GetDeviceInfo, {})

    // enable live view
    await camera.set(SonyProps.SetLiveViewEnable, 'ENABLE')

    await camera.send(SonyOps.SDIO_SetContentsTransferMode, {
        ContentsSelectType: 'HOST',
        TransferMode: 'ENABLE',
        AdditionalInformation: 'NONE',
    })

    while ((await camera.get(SonyProps.ContentTransferEnable)) === 'DISABLE') {
        console.log('waiting...')
        await new Promise(resolve => setTimeout(resolve, 10))
    }

    const storageIds = await camera.send(Ops.GetStorageIDs, {})

    // test storage-info dataset
    const storageInfo = await camera.send(Ops.GetStorageInfo, {
        StorageID: storageIds.data[0],
    })

    const objectIds = await camera.send(Ops.GetObjectHandles, {
        StorageID: storageIds.data[0],
    })

    const objectInfos: { [ObjectHandle: number]: ObjectInfo } = {}

    for await (const objectId of objectIds.data) {
        const objectInfo = await camera.send(Ops.GetObjectInfo, {
            ObjectHandle: objectId,
        })
        objectInfos[objectId] = objectInfo.data
    }

    const nonAssociationObjectIds = Object.keys(objectInfos)
        .map(Number)
        .filter(id => objectInfos[id].associationType === 0)

    // Import fs and path once
    const fs = await import('fs')
    const path = await import('path')

    // Ensure captured-images directory exists
    const capturedImagesDir = '/Users/kevinschaich/repositories/jpglab/fuse/captured_images'
    if (!fs.existsSync(capturedImagesDir)) {
        fs.mkdirSync(capturedImagesDir, { recursive: true })
    }

    // Download all files
    for (const objectId of nonAssociationObjectIds) {
        const objectSize = objectInfos[objectId].objectCompressedSize
        const filename = objectInfos[objectId].filename
        const outputPath = path.join(capturedImagesDir, filename)

        // Use Sony's SDIO_GetPartialLargeObject to retrieve the file in chunks
        const CHUNK_SIZE = 1024 * 1024 * 10 // 10MB chunks
        const chunks: Uint8Array[] = []
        let offset = 0

        while (offset < objectSize) {
            const bytesToRead = Math.min(CHUNK_SIZE, objectSize - offset)

            // Split 64-bit offset into two 32-bit values
            const offsetLower = offset & 0xffffffff
            const offsetUpper = Math.floor(offset / 0x100000000) // Divide by 2^32 to get upper 32 bits

            const chunkResponse = await camera.send(
                SonyOps.SDIO_GetPartialLargeObject,
                {
                    ObjectHandle: objectId,
                    OffsetLower: offsetLower,
                    OffsetUpper: offsetUpper,
                    MaxBytes: bytesToRead,
                },
                undefined,
                // Add 12 bytes for PTP container header (length + type + code + transactionId)
                offset === 0 ? objectSize + 12 : bytesToRead + 12
            )

            chunks.push(chunkResponse.data)
            offset += chunkResponse.data.length
        }

        // Combine all chunks
        const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const completeFile = new Uint8Array(totalBytes)
        let writeOffset = 0
        for (const chunk of chunks) {
            completeFile.set(chunk, writeOffset)
            writeOffset += chunk.length
        }

        // Write file
        fs.writeFileSync(outputPath, completeFile)
    }

    await camera.send(SonyOps.SDIO_SetContentsTransferMode, {
        ContentsSelectType: 'HOST',
        TransferMode: 'DISABLE',
        AdditionalInformation: 'NONE',
    })

    await camera.disconnect()
}

main()
