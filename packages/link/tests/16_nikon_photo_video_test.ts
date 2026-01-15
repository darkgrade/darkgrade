import { Camera } from '@camera/index'
import { VendorIDs } from '@ptp/definitions/vendor-ids'

const nikonCamera = new Camera({ device: { usb: { filters: [{ vendorId: VendorIDs.NIKON }] } } })
await nikonCamera.connect()

// test this in photo + video modes
await nikonCamera.captureImage()

await nikonCamera.startRecording()
await new Promise(resolve => setTimeout(resolve, 5000))
await nikonCamera.stopRecording()

await nikonCamera.disconnect()
