import type { FocusResult } from '@darkgrade/slate'
import type { CameraService } from '@main/camera-service'

/** The camera service's autofocus and click-to-focus. Installed on CameraService in camera-service.ts. */
export interface FocusOperations {
    /** Autofocus with the camera's own focus area; after a click-to-focus, at the clicked point. */
    focus(): Promise<string>
    /**
     * Click-to-focus: focuses on a spot in the live view, 0–1 from the top left. Slate maps it onto
     * each camera's own grid and switches Sony's Wide, Zone or Center to a spot while it is placed.
     */
    focusAt(x: number, y: number): Promise<string>
}

function describeFocus(result: FocusResult): string {
    if (result === 'acquired') return 'Focused'
    if (result === 'not-acquired') return 'The camera could not focus'
    return 'Autofocus complete'
}

export const focusOperations: FocusOperations & ThisType<CameraService> = {
    async focus(): Promise<string> {
        const camera = this.requireCameraForControl()
        const description = describeFocus(await this.enqueue(() => camera.autofocus()))
        this.log('system', description)
        return description
    },

    async focusAt(x: number, y: number): Promise<string> {
        if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
            throw new Error('Focus point must be inside the picture')
        const camera = this.requireCameraForControl()
        await this.enqueue(async () => {
            const before = this.controls
            await camera.setFocusPoint(x, y)
            // The point can switch the focus area and pause subject detection: read back so the panel shows it.
            if (before?.focusArea || before?.subjectDetection) await this.refreshSettingsRaw()
        })
        this.log('system', `Focused at ${Math.round(x * 100)}%, ${Math.round(y * 100)}%`)
        return 'Focused'
    },
}
