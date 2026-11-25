import type { Battery } from '@camera/driver/body'
import { CameraRefusedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { cameraContext, requireCapability } from '@camera/operations/context'

export interface BodyOperations {
    /** Level, minutes left, and whether the camera runs on battery, USB or DC power. */
    getBattery(): Promise<Battery>
    /** Sets the camera's date and time (default: now) and resolves once the camera confirms it. */
    setClock(moment?: Date): Promise<void>
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
}
