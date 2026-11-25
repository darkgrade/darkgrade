import type { OperationSupport } from '@camera/controls'
import {
    ZOOM_SAFETY_STOP_MILLISECONDS,
    type ZoomCapability,
    type ZoomDirection,
    type ZoomOptions,
    type ZoomSpeed,
} from '@camera/driver/zoom'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { SonyCamera, SonyPropertyState } from '@camera/sony-camera'
import { PTPResponseError } from '@core/ptp-errors'
import { sonyFocalLengthMillimetres } from '@vendors/sony/lens'

/** A landing within this distance of the requested focal length counts as arrived. */
const ARRIVAL_TOLERANCE_MILLIMETRES = 0.5
/** Between focal-length reads while the lens moves. */
const POLL_INTERVAL_MILLISECONDS = 60
/** No focal-length change for this long means the lens reached the end of its range. */
const STALL_MILLISECONDS = 800
/** After stopping, the reading must hold still for two reads, within this long. */
const SETTLE_MILLISECONDS = 1500
/** Beyond this distance the first pass runs at medium speed; closer, slow. */
const MEDIUM_SPEED_DISTANCE_MILLIMETRES = 10

const directions: readonly ZoomDirection[] = ['in', 'out']
const speeds: readonly ZoomSpeed[] = ['slow', 'medium', 'fast']

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

const remoteZoomAvailable = (states: readonly SonyPropertyState[]) =>
    states.find(state => state.name === 'ZoomEnableStatus')?.value === 'Enabled'

const unavailableReason = 'The camera reports remote zoom unavailable with this lens and mode'
const noFocalLengthReason = 'The lens does not report its focal length, so zoomTo cannot confirm where it lands'

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/**
 * Sony remote zoom (SDIO_ControlDevice Zoom Operation, see SonyCamera.startZoom): press-and-hold
 * zoom with a safety stop, and zoomTo driven by the focal-length readback. The camera, not the
 * request, decides where the lens lands: zoomTo returns the focal length read back once it settles.
 */
export class SonyPowerZoom implements ZoomCapability {
    private safetyStop?: ReturnType<typeof setTimeout>
    /** True while a zoom this session started may still be moving. */
    private zooming = false
    /** Advanced by every stop, so a zoomTo in progress ends when stopZoom is called. */
    private stops = 0

    constructor(
        private readonly driver: SonyCamera,
        private readonly safetyStopMilliseconds = ZOOM_SAFETY_STOP_MILLISECONDS
    ) {}

    support(): Record<'zoomTo' | 'startZoom' | 'stopZoom', OperationSupport> {
        const states = this.driver.listPropertyStates()
        const available = remoteZoomAvailable(states)
        const start: OperationSupport = available
            ? { supported: true }
            : { supported: false, reason: unavailableReason }
        const focal = sonyFocalLengthMillimetres(states) !== null
        return {
            startZoom: start,
            zoomTo: !available
                ? start
                : focal
                  ? { supported: true }
                  : { supported: false, reason: noFocalLengthReason },
            stopZoom: { supported: true },
        }
    }

    async startZoom(direction: ZoomDirection, options: ZoomOptions): Promise<void> {
        if (!directions.includes(direction))
            throw new CameraRefusedError('startZoom', 'Zoom direction must be in or out')
        if (!speeds.includes(options?.speed))
            throw new CameraRefusedError('startZoom', 'Zoom speed must be slow, medium or fast')
        if (!remoteZoomAvailable(await this.driver.refreshPropertyStates()))
            throw new CameraUnsupportedError('startZoom', unavailableReason)
        await this.drive('startZoom', direction, options.speed)
    }

    async stopZoom(): Promise<void> {
        this.clearSafetyStop()
        this.stops++
        const wasZooming = this.zooming
        this.zooming = false
        try {
            await this.driver.stopZoom()
        } catch (error) {
            // Nothing this session started was moving, so a refused stop changed nothing.
            if (error instanceof PTPResponseError && !wasZooming) return
            if (error instanceof PTPResponseError)
                throw new CameraRefusedError('stopZoom', `The camera refused to stop zooming: ${error.message}`)
            throw new CameraOutcomeUnknownError('stopZoom', `Stopping the zoom was not confirmed: ${describe(error)}`)
        }
    }

    async zoomTo(focalLengthMillimetres: number): Promise<number> {
        if (!Number.isFinite(focalLengthMillimetres) || focalLengthMillimetres <= 0)
            throw new CameraRefusedError('zoomTo', 'The focal length must be a positive number of millimetres')
        const states = await this.driver.refreshPropertyStates()
        if (!remoteZoomAvailable(states)) throw new CameraUnsupportedError('zoomTo', unavailableReason)
        const start = sonyFocalLengthMillimetres(states)
        if (start === null) throw new CameraUnsupportedError('zoomTo', noFocalLengthReason)
        if (Math.abs(start - focalLengthMillimetres) <= ARRIVAL_TOLERANCE_MILLIMETRES) return start

        const distance = Math.abs(focalLengthMillimetres - start)
        const first = await this.pass(
            start,
            focalLengthMillimetres,
            distance > MEDIUM_SPEED_DISTANCE_MILLIMETRES ? 'medium' : 'slow'
        )
        if (first.landed === start)
            throw new CameraUnsupportedError(
                'zoomTo',
                `The focal length stayed at ${start} mm: zoomTo needs a power-zoom lens (the camera may have moved its digital zoom instead)`
            )
        const overshot = Math.sign(first.landed - focalLengthMillimetres) !== Math.sign(start - focalLengthMillimetres)
        if (
            first.interrupted ||
            !overshot ||
            Math.abs(first.landed - focalLengthMillimetres) <= ARRIVAL_TOLERANCE_MILLIMETRES
        )
            return first.landed
        // One slow correction back towards the target; a new movement, never a resent command.
        return (await this.pass(first.landed, focalLengthMillimetres, 'slow')).landed
    }

    /** Drives towards the target until it is reached or crossed, the lens stalls, or stopZoom is called. */
    private async pass(
        from: number,
        target: number,
        speed: ZoomSpeed
    ): Promise<{ landed: number; interrupted: boolean }> {
        const direction: ZoomDirection = target > from ? 'in' : 'out'
        const stopsBefore = this.stops + 1
        await this.drive('zoomTo', direction, speed)
        let last = from
        let lastChangeMs = Date.now()
        const deadline = Date.now() + this.safetyStopMilliseconds
        try {
            while (Date.now() < deadline && this.stops < stopsBefore) {
                await wait(POLL_INTERVAL_MILLISECONDS)
                const current = sonyFocalLengthMillimetres(await this.driver.refreshPropertyStates())
                if (current === null) break
                const remaining = direction === 'in' ? target - current : current - target
                if (remaining <= ARRIVAL_TOLERANCE_MILLIMETRES) break
                if (current !== last) {
                    last = current
                    lastChangeMs = Date.now()
                } else if (Date.now() - lastChangeMs > STALL_MILLISECONDS) break
            }
        } catch (error) {
            await this.stopZoom()
            throw new CameraOutcomeUnknownError(
                'zoomTo',
                `The focal length could not be read while zooming: ${describe(error)}`
            )
        }
        const interrupted = this.stops >= stopsBefore
        if (!interrupted) await this.stopZoom()
        return { landed: await this.settledFocalLength(last), interrupted }
    }

    /** Reads until two consecutive focal lengths agree; the camera's value, never the requested one. */
    private async settledFocalLength(fallback: number): Promise<number> {
        const deadline = Date.now() + SETTLE_MILLISECONDS
        let previous: number | null = null
        while (Date.now() < deadline) {
            const current = sonyFocalLengthMillimetres(await this.driver.refreshPropertyStates())
            if (current === null)
                throw new CameraOutcomeUnknownError(
                    'zoomTo',
                    'The lens stopped reporting its focal length after zooming'
                )
            if (current === previous) return current
            previous = current
            await wait(POLL_INTERVAL_MILLISECONDS)
        }
        if (previous === null) return fallback
        throw new CameraOutcomeUnknownError(
            'zoomTo',
            `The focal length was still changing (${previous} mm) after the zoom stopped`
        )
    }

    /** One zoom-start command. The safety stop is armed first, so even an unconfirmed start stops by itself. */
    private async drive(operation: 'startZoom' | 'zoomTo', direction: ZoomDirection, speed: ZoomSpeed): Promise<void> {
        const level = await this.speedLevel(speed)
        this.armSafetyStop()
        try {
            await this.driver.startZoom(direction === 'in' ? 'tele' : 'wide', level)
            this.zooming = true
        } catch (error) {
            if (error instanceof PTPResponseError) {
                this.clearSafetyStop()
                throw new CameraRefusedError(operation, `The camera refused to zoom ${direction}: ${error.message}`)
            }
            this.zooming = true
            throw new CameraOutcomeUnknownError(operation, `Zooming ${direction} was not confirmed: ${describe(error)}`)
        }
    }

    /** Sony's speed is 1 (slowest) to the top of Zoom Speed Range; a fixed-speed body reports 1. */
    private async speedLevel(speed: ZoomSpeed): Promise<number> {
        const maximum = await this.driver.maximumZoomSpeed()
        if (speed === 'slow') return 1
        if (speed === 'fast') return maximum
        return Math.max(1, Math.round(maximum / 2))
    }

    private armSafetyStop(): void {
        this.clearSafetyStop()
        this.safetyStop = setTimeout(() => void this.stopZoom().catch(() => undefined), this.safetyStopMilliseconds)
        // A pending safety stop never keeps a Node process alive by itself.
        if (typeof this.safetyStop === 'object' && 'unref' in this.safetyStop) this.safetyStop.unref()
    }

    private clearSafetyStop(): void {
        if (this.safetyStop) clearTimeout(this.safetyStop)
        this.safetyStop = undefined
    }
}
