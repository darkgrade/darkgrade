import { Camera } from '@camera/index'
import { Logger } from '@core/logger'
import { GetDeviceInfo, InitiateCapture } from '@ptp/definitions/operation-definitions'
import { CanonSetRemoteMode } from '@ptp/definitions/vendors/canon/canon-operation-definitions'
import { USBTransport } from '@transport/usb/usb-transport'

const logger = new Logger({
    expanded: true, // Show all details
})
const transport = new USBTransport(logger)

const canonCamera = new Camera(transport, logger)
await canonCamera.connect()

const deviceInfo = await canonCamera.send(GetDeviceInfo, {})
console.log('Device Info:', deviceInfo.data)


// const remoteMode = await canonCamera.send(CanonGetRemoteMode, {})
// console.log('Remote Mode:', remoteMode.data)

// activate RemoteMode
// https://julianschroden.com/post/2023-05-10-pairing-and-initializing-a-ptp-ip-connection-with-a-canon-eos-camera/#activate-remotemode
// https://github.com/libmtp/libmtp/blob/e85d47e74ad6541a1213f25938a1f00b537b8110/src/ptp.h#L390
// ERR 70 - an error prevented shooting

await canonCamera.send(CanonSetRemoteMode, { RemoteMode: 'ENABLE' })

const capture = await canonCamera.send(InitiateCapture, {})

await canonCamera.disconnect()
