import { CanonCamera } from '@camera/canon-camera'
import { Logger } from '@core/logger'
import { USBTransport } from '@transport/usb/usb-transport'

const logger = new Logger({
    expanded: true,
})
const transport = new USBTransport(logger)

const canonCamera = new CanonCamera(transport, logger)
await canonCamera.connect()

console.log('\n=== Monitoring camera settings (press Ctrl+C to exit) ===\n')

let lastAperture = ''
let lastShutter = ''
let lastISO = ''

// Poll every second and print when values change
const intervalId = setInterval(async () => {
    try {
        const aperture = await canonCamera.getAperture()
        const shutter = await canonCamera.getShutterSpeed()
        const iso = await canonCamera.getIso()
        
        if (aperture !== lastAperture || shutter !== lastShutter || iso !== lastISO) {
            console.log(`Aperture: ${aperture}`)
            console.log(`Shutter:  ${shutter}`)
            console.log(`ISO:      ${iso}`)
            console.log()
            
            lastAperture = aperture
            lastShutter = shutter
            lastISO = iso
        }
    } catch (error) {
        console.error('Error reading settings:', error)
    }
}, 1000)

// Handle Ctrl+C gracefully
process.on('SIGINT', async () => {
    console.log('\n\nDisconnecting...')
    clearInterval(intervalId)
    await canonCamera.disconnect()
    process.exit(0)
})
