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

    // Try with just the first object to debug
    const firstObjectId = nonAssociationObjectIds[0]
    const objectSize = objectInfos[firstObjectId].objectCompressedSize
    console.log(`Attempting to get object ${firstObjectId.toString(16)}, size: ${objectSize} bytes`)

    // Disable content transfer mode before using standard GetPartialObject
    console.log('Disabling content transfer mode before testing standard GetPartialObject')
    await camera.send('SDIO_SetContentsTransferMode', {
        ContentsSelectType: 'HOST',
        TransferMode: 'DISABLE',
        AdditionalInformation: 'NONE',
    })

    try {
        // Use standard PTP GetPartialObject to retrieve the file in chunks
        const CHUNK_SIZE = 1024 * 1024 // 1MB chunks
        const chunks: Uint8Array[] = []
        let offset = 0

        console.log('Testing standard PTP GetPartialObject with content transfer mode DISABLED')

        while (offset < objectSize) {
            const bytesToRead = Math.min(CHUNK_SIZE, objectSize - offset)

            console.log(`Reading chunk at offset ${offset}, size ${bytesToRead} bytes`)

            // Standard GetPartialObject uses a single 32-bit offset (max 4GB)
            if (offset > 0xffffffff) {
                throw new Error('File too large for standard GetPartialObject (> 4GB)')
            }

            const chunkResponse = await camera.send('GetPartialObject', {
                ObjectHandle: firstObjectId,
                Offset: offset,
                MaxBytes: bytesToRead,
            })

            if (chunkResponse.data) {
                chunks.push(chunkResponse.data)
                offset += chunkResponse.data.length
                console.log(`Received ${chunkResponse.data.length} bytes, total: ${offset}/${objectSize}`)
            } else {
                console.error('No data received in chunk response')
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

        console.log(`Object retrieved successfully! Total size: ${completeFile.length} bytes`)
        console.log(`First 32 bytes (hex): ${Array.from(completeFile.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`)
    } catch (error) {
        console.error('Failed to get object:', error)
    }

    await camera.disconnect()

    // Give logger time to finish rendering before cleanup
    await new Promise(resolve => setTimeout(resolve, 100))

    console.log('Storage IDs:', storageIds)
}

main().catch(console.error)
