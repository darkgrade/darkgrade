import { GenericCamera } from '@camera/generic-camera'
import { Logger } from '@core/logger'
import { GetDeviceInfo, GetStorageIDs, OpenSession } from '@ptp/definitions/operation-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import {
    CanonRemoteReleaseOff,
    CanonRemoteReleaseOn,
    CanonSetEventMode,
    CanonSetRemoteMode,
} from '@ptp/definitions/vendors/canon/canon-operation-definitions'
import { USBTransport } from '@transport/usb/usb-transport'

const logger = new Logger({
    expanded: true, // Show all details
})
const transport = new USBTransport(logger)

const canonCamera = new GenericCamera(transport, logger)

// Canon Session ID MUST be set to 1 or we get ERR 70 (other vendors allow any session ID)
await transport.connect({ usb: { filters: [{ vendorId: VendorIDs.CANON }] } })
const connection = await canonCamera.send(OpenSession, { SessionID: 1 })

const deviceInfo = await canonCamera.send(GetDeviceInfo, {})
console.log('Device Info:', deviceInfo.data)

await canonCamera.send(GetStorageIDs, {})

// activate RemoteMode and EventMode (?)
// https://julianschroden.com/post/2023-05-10-pairing-and-initializing-a-ptp-ip-connection-with-a-canon-eos-camera/#activate-remotemode
// https://github.com/libmtp/libmtp/blob/e85d47e74ad6541a1213f25938a1f00b537b8110/src/ptp.h#L390
const remoteMode = await canonCamera.send(CanonSetRemoteMode, { RemoteMode: 'ENABLE' })
const eventMode = await canonCamera.send(CanonSetEventMode, { EventMode: 'ENABLE' })

// https://julianschroden.com/post/2023-06-15-capturing-images-using-ptp-ip-on-canon-eos-cameras/
// https://github.com/libmtp/libmtp/blob/e85d47e74ad6541a1213f25938a1f00b537b8110/src/ptp.h#L420
await canonCamera.send(CanonRemoteReleaseOn, { ReleaseMode: 'FOCUS', AFMode: 'AF' })
await canonCamera.send(CanonRemoteReleaseOn, { ReleaseMode: 'SHUTTER', AFMode: 'AF' })
await canonCamera.send(CanonRemoteReleaseOff, { ReleaseMode: 'SHUTTER' })
await canonCamera.send(CanonRemoteReleaseOff, { ReleaseMode: 'FOCUS' })

await canonCamera.disconnect()
