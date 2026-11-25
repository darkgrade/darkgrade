import type { Battery } from '@camera/driver/body'
import { CameraRefusedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { cameraContext, requireCapability } from '@camera/operations/context'
import { protocolSession } from '@camera/operations/protocol'
import { SonyCamera } from '@camera/sony-camera'

export interface BodyOperations {
    /** Level, minutes left, and whether the camera runs on battery, USB or DC power. */
    getBattery(): Promise<Battery>
    /** Sets the camera's date and time (default: now) and resolves once the camera confirms it. */
    setClock(moment?: Date): Promise<void>
    /** Sony: set the camera clock from the host (default: now). Returns the string the camera accepted. */
    setSonyDateTime(moment?: Date): Promise<string>
    /** @deprecated Use `protocolSession(camera).keepDeviceOn()` from `@darkgrade/slate/protocol`. */
    keepDeviceOn(): Promise<void>
}

export const bodyOperations: BodyOperations & ThisType<Camera> = {
    async getBattery(): Promise<Battery> {
        return requireCapability(this, 'body', 'getBattery').getBattery()
    },

    async setClock(moment: Date = new Date()): Promise<void> {
        if (!(moment instanceof Date) || Number.isNaN(moment.getTime()))
            throw new CameraRefusedError('setClock', 'setClock needs a valid Date')
        const body = requireCapability(this, 'body', 'setClock')
        return cameraContext(this).controlsQueue.run('camera', () => body.setClock(moment))
    },

    async setSonyDateTime(moment?: Date): Promise<string> {
        const { driver } = cameraContext(this)
        if (!(driver instanceof SonyCamera)) throw new Error('Sony clock setting is only available for Sony cameras')
        return driver.setDateTime(moment)
    },

    async keepDeviceOn(): Promise<void> {
        return protocolSession(this).keepDeviceOn()
    },
}
