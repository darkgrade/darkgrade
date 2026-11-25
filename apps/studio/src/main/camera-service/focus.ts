import type { FocusResult } from '@darkgrade/slate'
import type { CameraService } from '@main/camera-service'

/**
 * What click-to-focus changed on the camera since the last Focus, as Studio observed it: Slate
 * switches a focus area without a position (Sony Wide, Zone, Center) to a spot, and pauses subject
 * detection so eye tracking does not pull focus straight back to a face.
 */
export interface FocusPointChanges {
    switchedArea: boolean
    pausedSubjectDetection: boolean
}

/** The camera service's autofocus and click-to-focus. Installed on CameraService in camera-service.ts. */
export interface FocusOperations {
    /**
     * Autofocus with the camera's own focus area. Only what a click changed is undone first: an area
     * the click switched goes back (resetFocusPoint), and paused subject detection comes back on. A
     * spot the user chose stays where the click moved it.
     */
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
        const result = await this.enqueue(async () => {
            const changes = this.focusPointChanges
            this.focusPointChanges = null
            if (changes?.switchedArea) {
                await camera.resetFocusPoint()
                this.log('system', 'Focus area back from the clicked point')
            } else if (changes?.pausedSubjectDetection) {
                await camera.setSubjectDetection('On')
                this.log('system', 'Eye tracking back on')
            }
            return camera.autofocus()
        })
        const description = describeFocus(result)
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
            // Read back what the point changed, so Focus undoes only that and the panel shows it.
            if (!before?.focusArea && !before?.subjectDetection) return
            await this.refreshSettingsRaw()
            const after = this.controls
            const previous = this.focusPointChanges
            this.focusPointChanges = {
                switchedArea:
                    Boolean(previous?.switchedArea) ||
                    Boolean(before.focusArea && after?.focusArea && before.focusArea.value !== after.focusArea.value),
                pausedSubjectDetection:
                    Boolean(previous?.pausedSubjectDetection) ||
                    (before.subjectDetection?.value === 'On' && after?.subjectDetection?.value === 'Off'),
            }
        })
        this.log('system', `Focused at ${Math.round(x * 100)}%, ${Math.round(y * 100)}%`)
        return 'Focused'
    },
}
