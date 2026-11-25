import { Camera, isMovableFocusArea, VendorIDs } from '@darkgrade/slate'
import type { CameraService } from '@main/camera-service'
import {
    FOCUS_DURATION_MS,
    requiresReconnect,
    SONY_AF_GRID_HEIGHT,
    SONY_AF_GRID_WIDTH,
} from '@main/camera-service/shared'

/** The camera service's autofocus and click-to-focus. Installed on CameraService in camera-service.ts. */
export interface FocusOperations {
    /**
     * Sony leaves face and eye frames out of live view unless Face/Eye Frame Display is on, so
     * eye tracking would have nothing to follow. Turn it on whenever subject recognition is on.
     * Runs on the operation queue.
     */
    showSonyFaceFrames(
        camera: Camera,
        states: Array<{
            name: string
            value: unknown
        }>,
        recognitionOn: boolean
    ): Promise<void>
    sonyFocusArea(camera: Camera): never
    /**
     * Autofocus with the camera's own focus area. Click-to-focus leaves Sony in a Flexible Spot;
     * this clears that manual point by restoring the area from before (or Wide), then focuses.
     */
    focus(): Promise<string>
    /** Runs on the operation queue. */
    clearSonyFocusPoint(camera: Camera): Promise<void>
    sonySubjectRecognition(camera: Camera): never | null
    /** Runs on the operation queue. */
    pauseSonySubjectRecognition(camera: Camera): Promise<void>
    /** Runs on the operation queue. */
    restoreSonySubjectRecognition(camera: Camera): Promise<void>
    /**
     * Click-to-focus: moves the AF point to a spot on the live view (0–1 from the top left) and
     * focuses there. Sony maps it onto its 640×480 AF grid; Nikon takes the fraction directly.
     */
    flexibleSpotFor(area: string): string
    focusAt(x: number, y: number): Promise<string>
}

export const focusOperations: FocusOperations & ThisType<CameraService> = {
    /**
     * Sony leaves face and eye frames out of live view unless Face/Eye Frame Display is on, so
     * eye tracking would have nothing to follow. Turn it on whenever subject recognition is on.
     * Runs on the operation queue.
     */
    async showSonyFaceFrames(
        camera: Camera,
        states: Array<{ name: string; value: unknown }>,
        recognitionOn: boolean
    ): Promise<void> {
        const display = states.find(state => state.name === 'FaceEyeFrameDisplay')
        if (!recognitionOn || !display || display.value === 'ON') return
        const properties = camera.getInstance().registry.properties as Record<string, unknown>
        await camera.set(properties.FaceEyeFrameDisplay as never, 'ON' as never).catch(error => {
            if (requiresReconnect(error)) throw error
        })
    },

    sonyFocusArea(camera: Camera): never {
        return (camera.getInstance().registry.properties as Record<string, unknown>).FocusArea as never
    },

    /**
     * Autofocus with the camera's own focus area. Click-to-focus leaves Sony in a Flexible Spot;
     * this clears that manual point by restoring the area from before (or Wide), then focuses.
     */
    async focus(): Promise<string> {
        const camera = this.requireCameraForControl()
        await this.enqueue(async () => {
            if (this.detectedVendorId === VendorIDs.SONY) await this.clearSonyFocusPoint(camera)
            await camera.autofocus(FOCUS_DURATION_MS)
        })
        this.log('system', 'Autofocus complete')
        return 'Focused'
    },

    /** Runs on the operation queue. */
    async clearSonyFocusPoint(camera: Camera): Promise<void> {
        // Only undo a switch click-to-focus made: a Zone or Flexible Spot the user chose stays, moved.
        const previous = this.focusAreaBeforeTouch
        this.focusAreaBeforeTouch = null
        await this.restoreSonySubjectRecognition(camera)
        if (!previous || isMovableFocusArea(previous)) return
        await camera.set(this.sonyFocusArea(camera), previous as never)
        this.log('system', `Focus area back to ${previous}`)
    },

    sonySubjectRecognition(camera: Camera): never | null {
        const properties = camera.getInstance().registry.properties as Record<string, unknown>
        const propertyName = this.controlProperties.get('subjectRecognition') ?? 'SubjectRecognitionInAF'
        return (properties[propertyName] as never) ?? null
    },

    /** Runs on the operation queue. */
    async pauseSonySubjectRecognition(camera: Camera): Promise<void> {
        const property = this.sonySubjectRecognition(camera)
        if (!property) return
        const value = String(await camera.get(property))
        if (value !== 'On') return
        this.subjectRecognitionBeforeTouch = value
        await camera.set(property, 'Off' as never)
        this.log('system', 'Eye tracking off while focusing on a point')
    },

    /** Runs on the operation queue. */
    async restoreSonySubjectRecognition(camera: Camera): Promise<void> {
        const previous = this.subjectRecognitionBeforeTouch
        this.subjectRecognitionBeforeTouch = null
        const property = this.sonySubjectRecognition(camera)
        if (!previous || !property) return
        await camera.set(property, previous as never)
        this.log('system', 'Eye tracking back on')
    },

    /**
     * Click-to-focus: moves the AF point to a spot on the live view (0–1 from the top left) and
     * focuses there. Sony maps it onto its 640×480 AF grid; Nikon takes the fraction directly.
     */
    flexibleSpotFor(area: string): string {
        return /^lock on af/i.test(area) ? `Lock on AF ${this.lastFlexibleSpot}` : this.lastFlexibleSpot
    },

    async focusAt(x: number, y: number): Promise<string> {
        if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
            throw new Error('Focus point must be inside the picture')
        const camera = this.requireCameraForControl()
        if (this.detectedVendorId === VendorIDs.SONY) {
            const gridX = Math.round(x * (SONY_AF_GRID_WIDTH - 1))
            const gridY = Math.round(y * (SONY_AF_GRID_HEIGHT - 1))
            await this.enqueue(async () => {
                // A Flexible Spot moves as it is. Wide, Zone and Center take no position: switch to the
                // Flexible Spot used last (keeping Lock on AF), and remember the area so Focus restores it.
                const area = String(await camera.get(this.sonyFocusArea(camera)))
                if (!isMovableFocusArea(area)) {
                    this.focusAreaBeforeTouch = area
                    await camera.set(this.sonyFocusArea(camera), this.flexibleSpotFor(area) as never)
                }
                await this.pauseSonySubjectRecognition(camera)
                await camera.sonyTouchFocus(gridX, gridY)
            })
        } else if (this.detectedVendorId === VendorIDs.NIKON) {
            await this.enqueue(() => camera.nikonTouchFocus(x, y))
        } else {
            throw new Error('Click to focus isn’t available on this camera yet')
        }
        this.log('system', `Focused at ${Math.round(x * 100)}%, ${Math.round(y * 100)}%`)
        return 'Focused'
    },
}
