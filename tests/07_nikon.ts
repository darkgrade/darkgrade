import { Logger } from '@core/logger'
import { USBTransport } from '@transport/usb/usb-transport'
import { operationDefinitions as standardOperationDefinitions } from '@ptp/definitions/operation-definitions'

import { GenericCamera } from 'src'
// import { NikonCamera } from '@camera/nikon-camera'
import { SonyCamera } from '@camera/sony-camera'
import { NikonCamera } from '@camera/nikon-camera'

const mergedOperationDefinitions = [...standardOperationDefinitions] as const
const capturedImagesDir = '/Users/kevinschaich/repositories/jpglab/fuse/captured_images'

const logger = new Logger<typeof mergedOperationDefinitions>({
    collapseUSB: false, // Show USB transfer details for debugging
    collapse: false, // Show all details
    showDecodedData: true,
    showEncodedData: true,
    expandOnError: true,
    maxLogs: 1000,
    minLevel: 'debug',
    includeOperations: [],
    excludeOperations: [],
})
const transport = new USBTransport(logger)
const camera = new NikonCamera(transport, logger)

async function main() {
    try {
        await camera.connect()
    } catch (e) {
        console.log('Connection attempt failed, continuing anyway')
    }

    const deviceInfo = await camera.send('GetDeviceInfo', {})

    const exposureTime = await camera.get('ExposureTime')
    console.log('✓ ExposureTime:', exposureTime)

    const exposureIndex = await camera.get('ExposureIndex')
    console.log('✓ ExposureIndex:', exposureIndex)

    const fNumber = await camera.get('FNumber')
    console.log('✓ FNumber:', fNumber)

    // Register event handlers to see what events come through
    camera.on('ObjectAdded', (event) => {
        console.log('📸 ObjectAdded event:', event)
    })

    camera.on('CaptureComplete', (event) => {
        console.log('✅ CaptureComplete event:', event)
    })

    const capture = await camera.send('InitiateCapture', {})

    // wait 1 second for the events to fire
    await new Promise(resolve => setTimeout(resolve, 1000))

    console.log('Disconnecting...')
    try {
        await camera.disconnect()
        console.log('✓ Disconnected successfully')
    } catch (error) {
        console.log('❌ Disconnect failed:', error)
    }

    process.exit(0)
}

main().catch(err => {
    console.error('[MAIN ERROR] Error type:', typeof err)
    console.error('[MAIN ERROR] Error constructor:', err?.constructor?.name)
    console.error('[MAIN ERROR] Error message:', err?.message)
    console.error('[MAIN ERROR] Error stack:', err?.stack)
    console.error('[MAIN ERROR] Error stringified:', JSON.stringify(err, null, 2))
    console.error('[MAIN ERROR] Error direct:', err)
    process.exit(1)
})
