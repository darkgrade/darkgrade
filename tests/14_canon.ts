import { CanonCamera } from '@camera/canon-camera'
import { Logger } from '@core/logger'
import { GetDeviceInfo } from '@ptp/definitions/operation-definitions'
import { USBTransport } from '@transport/usb/usb-transport'

const logger = new Logger({
    expanded: true,
})
const transport = new USBTransport(logger)

const canonCamera = new CanonCamera(transport, logger)
await canonCamera.connect()

// await canonCamera.send(GetDeviceInfo, {}, undefined, 1024 * 1024)

console.log('Getting aperture...')
try {
    const aperture = await canonCamera.getAperture()
    console.log('Aperture:', aperture)
} catch (error) {
    console.error('Failed to get aperture:', error)
}

await canonCamera.disconnect()
