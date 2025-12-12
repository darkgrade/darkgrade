import { CanonCamera } from '@camera/canon-camera'
import { Logger } from '@core/logger'
import { USBTransport } from '@transport/usb/usb-transport'

const logger = new Logger({
    expanded: true,
})
const transport = new USBTransport(logger)

const canonCamera = new CanonCamera(transport, logger)
await canonCamera.connect()

canonCamera.startEventPolling(200)

await canonCamera.captureImage({ includeInfo: true, includeData: true })

await canonCamera.disconnect()
