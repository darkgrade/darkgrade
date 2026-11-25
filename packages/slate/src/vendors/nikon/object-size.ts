import type { Camera } from '@camera/index'
import { protocolAccess } from '@camera/protocol-session'
import { NikonCamera } from '@vendors/nikon/nikon-camera'

/** TRANSITIONAL for ptp-media and video-recording: the size query is `NikonCamera.fullObjectSize`. */
export async function readNikonObjectSize(camera: Camera, handle: number, reported: number): Promise<number> {
    const driver = protocolAccess(camera).driver
    if (!(driver instanceof NikonCamera)) return reported
    return driver.fullObjectSize(handle, reported)
}
