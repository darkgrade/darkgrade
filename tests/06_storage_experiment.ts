import { SonyCamera } from '@camera/sony-camera'
import { Logger } from '@core/logger'
import { USBTransport } from '@transport/usb/usb-transport'
import { sonyOperationDefinitions } from '@ptp/definitions/vendors/sony/sony-operation-definitions'
import { operationDefinitions as standardOperationDefinitions } from '@ptp/definitions/operation-definitions'
import { ObjectInfo } from 'src'

const mergedOperationDefinitions = [...standardOperationDefinitions, ...sonyOperationDefinitions] as const

const logger = new Logger<typeof mergedOperationDefinitions>({
    collapseUSB: false, // Show USB transfer details for debugging
    collapse: false, // Show all details
})
const transport = new USBTransport(logger)
const camera = new SonyCamera(transport, logger)

const SONY_CAPTURED_IMAGE_OBJECT_HANDLE = 0xffffc001
const SONY_LIVE_VIEW_OBJECT_HANDLE = 0xffffc002

async function main() {
    await camera.connect()

    // // test sony ext-device-prop-info dataset
    // const iso = await camera.get('Iso')
    // console.log('ISO:', iso)
    // const shutterSpeed = await camera.get('ShutterSpeed')
    // console.log('Shutter Speed:', shutterSpeed)
    // const aperture = await camera.get('Aperture')
    // console.log('Exposure:', aperture)

    // // test device-info dataset
    // const deviceInfo = await camera.send('GetDeviceInfo', {})
    // console.log('Device Info:', deviceInfo)

    // // enable live view
    // await camera.set('SetLiveViewEnable', 'ENABLE')

    // // test object-info dataset
    // const objectInfo = await camera.send('GetObjectInfo', {
    //     // this is the liveview dataset
    //     ObjectHandle: SONY_LIVE_VIEW_OBJECT_HANDLE,
    // })
    await camera.send('SDIO_SetContentsTransferMode', {
        ContentsSelectType: 'HOST',
        TransferMode: 'ENABLE',
        AdditionalInformation: 'NONE',
    })

    // sleep for 1 second
    await new Promise(resolve => setTimeout(resolve, 1000))

    const storageIds = await camera.send('GetStorageIDs', {})

    // sleep for 1 second
    await new Promise(resolve => setTimeout(resolve, 1000))

    // test storage-info dataset
    const storageInfo = await camera.send('GetStorageInfo', {
        StorageID: storageIds.data[0],
    })

    new Promise(resolve => setTimeout(resolve, 1000))

    const objectIds = await camera.send('GetObjectHandles', {
        StorageID: storageIds.data[0],
    })

    const objectInfos: { [ObjectHandle: number]: ObjectInfo } = {}

    for await (const objectId of objectIds.data) {
        const objectInfo = await camera.send('GetObjectInfo', {
            ObjectHandle: objectId,
        })
        objectInfos[objectId] = objectInfo.data
    }

    const nonAssociationObjectIds = Object.keys(objectInfos)
        .map(Number)
        .filter(id => objectInfos[id].associationType === 0)

    console.log(`Found ${nonAssociationObjectIds.length} files to download`)

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

        console.log(`\n[${nonAssociationObjectIds.indexOf(objectId) + 1}/${nonAssociationObjectIds.length}] Downloading ${filename} (${(objectSize / 1024 / 1024).toFixed(2)} MB)`)

        try {
            // Use Sony's SDIO_GetPartialLargeObject to retrieve the file in chunks
            const CHUNK_SIZE = 1024 * 1024 // 1MB chunks
            const chunks: Uint8Array[] = []
            let offset = 0

            while (offset < objectSize) {
                const bytesToRead = Math.min(CHUNK_SIZE, objectSize - offset)

                // Split 64-bit offset into two 32-bit values
                const offsetLower = offset & 0xffffffff
                const offsetUpper = Math.floor(offset / 0x100000000) // Divide by 2^32 to get upper 32 bits

                const chunkResponse = await camera.send(
                    'SDIO_GetPartialLargeObject',
                    {
                        ObjectHandle: objectId,
                        OffsetLower: offsetLower,
                        OffsetUpper: offsetUpper,
                        MaxBytes: bytesToRead,
                    },
                    undefined,
                    offset === 0 ? objectSize : undefined  // Pass total size on first chunk only
                )

                if (chunkResponse.data) {
                    chunks.push(chunkResponse.data)
                    offset += chunkResponse.data.length
                    const progress = ((offset / objectSize) * 100).toFixed(1)
                    process.stdout.write(`\r  Progress: ${progress}% (${(offset / 1024 / 1024).toFixed(2)} / ${(objectSize / 1024 / 1024).toFixed(2)} MB)`)
                } else {
                    console.error('\n  No data received in chunk response')
                    break
                }
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
            console.log(`\n  ✓ Saved to: ${outputPath}`)
        } catch (error) {
            console.error(`\n  ✗ Failed to download ${filename}:`, error)
        }
    }

    console.log(`\n✓ Download complete! ${nonAssociationObjectIds.length} files saved to ${capturedImagesDir}`)

    await camera.send('SDIO_SetContentsTransferMode', {
        ContentsSelectType: 'HOST',
        TransferMode: 'DISABLE',
        AdditionalInformation: 'NONE',
    })

    await camera.disconnect()

    // Give logger time to finish rendering before cleanup
    await new Promise(resolve => setTimeout(resolve, 100))

    logger.cleanup()

    console.log('Storage IDs:', storageIds)
}

main().catch(console.error)
