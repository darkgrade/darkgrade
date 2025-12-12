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

await canonCamera.send(GetDeviceInfo, {})

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
            const apertureAllowed = canonCamera.getPropertyAllowedValues(canonCamera.registry.properties.CanonAperture.code)
            if (apertureAllowed) {
                console.log(`  Allowed: ${apertureAllowed.join(', ')}`)
            }
            
            console.log(`Shutter:  ${shutter}`)
            const shutterAllowed = canonCamera.getPropertyAllowedValues(canonCamera.registry.properties.CanonShutterSpeed.code)
            if (shutterAllowed) {
                console.log(`  Allowed: ${shutterAllowed.join(', ')}`)
            }
            
            console.log(`ISO:      ${iso}`)
            const isoAllowed = canonCamera.getPropertyAllowedValues(canonCamera.registry.properties.CanonIso.code)
            if (isoAllowed) {
                console.log(`  Allowed: ${isoAllowed.join(', ')}`)
            }
            console.log()
            
            lastAperture = aperture
            lastShutter = shutter
            lastISO = iso
        }
    } catch (error) {
        console.error('Error reading settings:', error)
    }
}, 1000)

// test setting iso, shutter, aperture a few times each with delasy in between
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
await delay(1000)
await canonCamera.setIso('ISO 100')
await delay(1000)
await canonCamera.setShutterSpeed('1/30')
await delay(1000)
await canonCamera.setAperture('f/4')
await delay(1000)
await canonCamera.setIso('ISO 200')
await delay(1000)
await canonCamera.setShutterSpeed('1/60')
await delay(1000)
await canonCamera.setAperture('f/8')
await delay(1000)
await canonCamera.setIso('ISO 400')
await delay(1000)

// Handle Ctrl+C gracefully
process.on('SIGINT', async () => {
    console.log('\n\nDisconnecting...')
    clearInterval(intervalId)
    await canonCamera.disconnect()
    process.exit(0)
})
