#!/usr/bin/env bun

import { USBTransport } from '@transport/usb/usb-transport'
import { PTPProtocol } from '@core/protocol'
import { PTPMessageBuilder } from '@core/messages'
import { SonyAuthenticator } from '@camera/vendors/sony/authenticator'
import { SonyOperations } from '@constants/vendors/sony/operations'
import { SonyProperties } from '@constants/vendors/sony/properties'
import { encodePTPValue } from '@core/buffers'
import { Camera } from '@api/camera'
import { GenericPTPCamera } from '@camera/generic/generic-ptp-camera'
import { PTPOperations } from '@constants/ptp/operations'
import { PTPResponses } from '@constants/ptp/responses'
import { parseStorageInfo } from '@camera/generic/storage-info-dataset'
import { decodePTPValue, parsePTPUint32Array } from '@core/buffers'
import { DataType } from '@constants/types'
import { parseObjectInfo } from '@camera/generic/object-info-dataset'

async function listCameraFiles() {
    console.log('🔍 Starting camera file listing...')

    // Initialize camera using high-level API
    console.log('📦 Initializing camera...')
    const camera = new Camera()

    try {
        // Connect to camera
        console.log('🔌 Connecting to camera...')
        await camera.connect()
        console.log('✅ Connected successfully!')

        const cameraImpl = camera.getCameraImplementation() as GenericPTPCamera
        const protocol = cameraImpl.getProtocol()

        // First capture an image so there's something at the object handle
        console.log('📸 Capturing image...')
        await camera.captureImage()

        await new Promise(resolve => setTimeout(resolve, 1000))
        const SONY_CAPTURED_IMAGE_OBJECT_HANDLE = 0xffffc001

        console.log('ℹ️ Getting object info...')
        const objectInfo = await protocol.sendOperation({
            ...SonyOperations.GET_OBJECT_INFO,
            parameters: [SONY_CAPTURED_IMAGE_OBJECT_HANDLE],
        })
        const objectInfoParsed = parseObjectInfo(objectInfo.data!)

        console.log('📋 Object info:', objectInfoParsed)

        // // SDIO_ContentTransferMode
        // const settransferMode = await protocol.sendOperation({
        //     code: 0x9212,
        //     parameters: [1, 1, 0],
        // })
        // console.log('SET_TRANSFER_MODE response:', `0x${settransferMode.code.toString(16)}`)

        // await new Promise(resolve => setTimeout(resolve, 5000))
        // // GET_STORAGE_IDS
        // const storageIdsResponse = await protocol.sendOperation({
        //     ...PTPOperations.GET_STORAGE_IDS,
        //     respondsWithData: true,
        // })
    } catch (error) {
        console.error('❌ Error during file listing:', error)
        process.exit(1)
    } finally {
        try {
            await camera.disconnect()
            console.log('🔌 Disconnected from camera')
        } catch (error) {
            console.error('❌ Error disconnecting:', error)
        }
    }
}

// Run the script
if (require.main === module) {
    listCameraFiles().catch(console.error)
}
