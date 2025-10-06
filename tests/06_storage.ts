import { SonyCamera } from '@camera/sony-camera'
import { Logger } from '@core/logger'
import { USBTransport } from '@transport/usb/usb-transport'
import { sonyOperationDefinitions } from '@ptp/definitions/vendors/sony/sony-operation-definitions'
import { operationDefinitions as standardOperationDefinitions } from '@ptp/definitions/operation-definitions'

const mergedOperationDefinitions = [...standardOperationDefinitions, ...sonyOperationDefinitions] as const

const logger = new Logger<typeof mergedOperationDefinitions>()
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
