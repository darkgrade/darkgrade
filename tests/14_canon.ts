import { CanonCamera } from '@camera/canon-camera'
import { Logger } from '@core/logger'
import { USBTransport } from '@transport/usb/usb-transport'
import { ssrModuleExportsKey } from 'vite/module-runner'

const logger = new Logger({
    expanded: true, // Show all details
})
const transport = new USBTransport(logger)

const canonCamera = new CanonCamera(transport, logger)
await canonCamera.connect()

await canonCamera.captureImage({ includeInfo: true, includeData: true })

await new Promise(resolve => setTimeout(resolve, 1000))

await canonCamera.disconnect()
