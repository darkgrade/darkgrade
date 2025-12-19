import { Camera } from '@camera/index'
import { Logger } from '@core/logger'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { USBTransport } from '@transport/usb/usb-transport'
import fs from 'fs'
import path from 'path'

const capturedImagesDir = '/Users/kevinschaich/repositories/jpglab/fuse/captured_images'

const logger = new Logger({
    expanded: true, // Show all details
})
const transport = new USBTransport(logger)

async function downloadAllObjects(camera: Camera, objects: Awaited<ReturnType<Camera['listObjects']>>) {
    for (const [storageId, storage] of Object.entries(objects)) {
        console.log(`\nProcessing storage ${storageId}...`)

        // Filter out association objects (folders)
        const fileObjects = Object.entries(storage.objects).filter(
            ([_, objectInfo]) => objectInfo.associationType === 0
        )

        console.log(`Found ${fileObjects.length} files to download`)

        for (const [objectHandle, objectInfo] of fileObjects) {
            const objectSize = objectInfo.objectCompressedSize
            const filename = objectInfo.filename
            const outputPath = path.join(capturedImagesDir, filename)

            console.log(`Downloading ${filename} (${objectSize} bytes)...`)

            const fileData = await camera.getObject(Number(objectHandle), objectSize)

            fs.writeFileSync(outputPath, fileData)
            console.log(`✓ Saved ${filename}`)
        }
    }
}

const sonyCamera = new Camera(transport, logger, { usb: { filters: [{ vendorId: VendorIDs.SONY }] } })
await sonyCamera.connect()
const { info: sonyLiveViewInfo, data: sonyLiveViewData } = await sonyCamera.captureLiveView()
await fs.writeFileSync(path.join(capturedImagesDir, 'sony_liveview.jpg'), sonyLiveViewData!)
const { info: sonyImageInfo, data: sonyImageData } = await sonyCamera.captureImage()
await fs.writeFileSync(path.join(capturedImagesDir, sonyImageInfo?.filename!), sonyImageData!)
const sonyObjects = await sonyCamera.listObjects()
await downloadAllObjects(sonyCamera, sonyObjects)
await sonyCamera.disconnect()

const nikonCamera = new Camera(transport, logger, { usb: { filters: [{ vendorId: VendorIDs.NIKON }] } })
await nikonCamera.connect()
const { info: nikonLiveViewInfo, data: nikonLiveViewData } = await nikonCamera.captureLiveView()
await fs.writeFileSync(path.join(capturedImagesDir, 'nikon_liveview.jpg'), nikonLiveViewData!)
const { info: nikonImageInfo, data: nikonImageData } = await nikonCamera.captureImage()
await fs.writeFileSync(path.join(capturedImagesDir, nikonImageInfo?.filename!), nikonImageData!)
const nikonObjects = await nikonCamera.listObjects()
await downloadAllObjects(nikonCamera, nikonObjects)
await nikonCamera.disconnect()
