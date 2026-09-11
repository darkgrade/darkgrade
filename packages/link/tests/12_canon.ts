import { Camera } from '@camera/index'
import { GetDeviceInfo, InitiateCapture } from '@ptp/definitions/operation-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { CanonSetRemoteMode } from '@ptp/definitions/vendors/canon/canon-operation-definitions'

const canonCamera = new Camera({
    logger: { expanded: true },
    device: { usb: { filters: [{ vendorId: VendorIDs.CANON }] } },
})
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
