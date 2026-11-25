import type { Camera } from '@camera/index'
import { canonDriver, cameraContext } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'

export interface BodyOperations {
    /** Sony: set the camera clock from the host (default: now). Returns the string the camera accepted. */
    setSonyDateTime(moment?: Date): Promise<string>
    keepDeviceOn(): Promise<void>
}

export const bodyOperations: BodyOperations & ThisType<Camera> = {
    async setSonyDateTime(moment?: Date): Promise<string> {
        const { driver } = cameraContext(this)
        if (!(driver instanceof SonyCamera)) throw new Error('Sony clock setting is only available for Sony cameras')
        return driver.setDateTime(moment)
    },

    async keepDeviceOn(): Promise<void> {
        return canonDriver(this, 'KeepDeviceOn is only available for Canon EOS cameras').keepDeviceOn()
    },
}
