import { Camera } from '@camera/index'
import { Logger } from '@core/logger'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { USBTransport } from '@transport/usb/usb-transport'
import fs from 'fs'
import path from 'path'

const capturedImagesDir = '/Users/kevinschaich/repositories/jpglab/fuse/captured_images'

const logger = new Logger({ showDecodedData: true, showEncodedData: true, collapseUSB: false })
const transport = new USBTransport(logger)

const sonyCamera = new Camera(VendorIDs.SONY, transport, logger)
await sonyCamera.connect()
const sonyLiveView = await sonyCamera.captureLiveView()
await fs.writeFileSync(path.join(capturedImagesDir, 'sony_liveview.jpg'), sonyLiveView.data!)
const sonyImage = await sonyCamera.captureImage()
await fs.writeFileSync(path.join(capturedImagesDir, 'sony_image.jpg'), sonyImage.data!)
await sonyCamera.disconnect()

const nikonCamera = new Camera(VendorIDs.NIKON, transport, logger)
await nikonCamera.connect()
const nikonLiveView = await nikonCamera.captureLiveView()
await fs.writeFileSync(path.join(capturedImagesDir, 'nikon_liveview.jpg'), nikonLiveView.data!)
const nikonImage = await nikonCamera.captureImage()
await fs.writeFileSync(path.join(capturedImagesDir, 'nikon_image.jpg'), nikonImage.data!)
await nikonCamera.disconnect()
