import type { OperationAvailability } from '@camera/controls'
import { ZOOM_SAFETY_STOP_MILLISECONDS, type ZoomDirection, type ZoomOptions, type ZoomSpeed } from '@camera/driver'
import { type ZoomCapability } from '@vendors/generic/capability-groups'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { SonyCamera, SonyPropertyState } from '@vendors/sony/sony-camera'
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

/** Zoom Scale (thousandths): the body's digital zoom magnification, when it reports one. */
const zoomScale = (states: readonly SonyPropertyState[]) => {
    const scale = states.find(state => state.name === 'ZoomScale' && state.enabled)?.rawValue
    return scale === undefined ? undefined : Number(scale)
}

/** Only Optical Zoom Only rules out a digital zoom the focal length cannot show. */
const opticalZoomOnly = (states: readonly SonyPropertyState[]) =>
    states.find(state => state.name === 'ZoomSetting')?.value === 'Optical Zoom Only'

const unavailableReason = 'The camera reports remote zoom unavailable with this lens and mode'
const noFocalLengthReason = 'The lens does not report its focal length, so zoomTo cannot confirm where it lands'

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/**
 * Sony remote zoom (SDIO_ControlDevice Zoom Operation, see SonyCamera.startZoom): press-and-hold
 * zoom with a safety stop, and zoomTo driven by the focal-length readback. The camera, not the
 * request, decides where the lens lands: zoomTo returns the focal length read back once it settles.
 *
 * stopZoom wins over a start still being prepared: startZoom and zoomTo note the stop count when
 * they begin and send no zoom command once a stop has come in since.
 */
export class SonyPowerZoom implements ZoomCapability {
    private safetyStop?: ReturnType<typeof setTimeout>
    /** True while a zoom this session started may still be moving. */
    private zooming = false
    /** Advanced by every stopZoom call, so a start or zoomTo in progress ends when the caller stops. */
    private stops = 0

    constructor(
        private readonly driver: SonyCamera,
        private readonly safetyStopMilliseconds = ZOOM_SAFETY_STOP_MILLISECONDS
    ) {}

    availability(): Record<'zoomTo' | 'startZoom' | 'stopZoom', OperationAvailability> {
        const states = this.driver.listPropertyStates()
        const available = remoteZoomAvailable(states)
        const start: OperationAvailability = available
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
        const stopsAtStart = this.stops
        if (!directions.includes(direction))
            throw new CameraRefusedError('startZoom', 'Zoom direction must be in or out')
        if (!speeds.includes(options?.speed))
            throw new CameraRefusedError('startZoom', 'Zoom speed must be slow, medium or fast')
        const states = await this.driver.refreshPropertyStates()
        if (!remoteZoomAvailable(states)) throw new CameraUnsupportedError('startZoom', unavailableReason)
        await this.drive('startZoom', direction, options.speed, states, stopsAtStart)
    }

    async stopZoom(): Promise<void> {
        this.stops++
        await this.halt()
    }

    async zoomTo(focalLengthMillimetres: number): Promise<number> {
        const stopsAtStart = this.stops
        if (!Number.isFinite(focalLengthMillimetres) || focalLengthMillimetres <= 0)
            throw new CameraRefusedError('zoomTo', 'The focal length must be a positive number of millimetres')
        const states = await this.driver.refreshPropertyStates()
        if (!remoteZoomAvailable(states)) throw new CameraUnsupportedError('zoomTo', unavailableReason)
        const start = sonyFocalLengthMillimetres(states)
        if (start === null) throw new CameraUnsupportedError('zoomTo', noFocalLengthReason)
        if (Math.abs(start - focalLengthMillimetres) <= ARRIVAL_TOLERANCE_MILLIMETRES) return start

        const distance = Math.abs(focalLengthMillimetres - start)
        const scaleBefore = zoomScale(states)
        const first = await this.pass(
            start,
            focalLengthMillimetres,
            distance > MEDIUM_SPEED_DISTANCE_MILLIMETRES ? 'medium' : 'slow',
            states,
            stopsAtStart
        )
        if (first.sent && first.landed === start) this.reportUnmovedLens(start, scaleBefore)
        const overshot = Math.sign(first.landed - focalLengthMillimetres) !== Math.sign(start - focalLengthMillimetres)
        if (
            first.interrupted ||
            !overshot ||
            Math.abs(first.landed - focalLengthMillimetres) <= ARRIVAL_TOLERANCE_MILLIMETRES
        )
            return first.landed
        // One slow correction back towards the target; a new movement, never a resent command.
        const correction = await this.pass(
            first.landed,
            focalLengthMillimetres,
            'slow',
            this.driver.listPropertyStates(),
            stopsAtStart
        )
        return correction.landed
    }

    /**
     * The focal length never moved. With only optical zoom and no change in Zoom Scale, nothing
     * changed and the camera in effect refused; otherwise its digital zoom may have moved instead.
     */
    private reportUnmovedLens(start: number, scaleBefore: number | undefined): never {
        const states = this.driver.listPropertyStates()
        const scaleAfter = zoomScale(states)
        const unchanged = scaleBefore !== undefined && scaleAfter !== undefined
            ? scaleAfter === scaleBefore
            : opticalZoomOnly(states)
        if (unchanged)
            throw new CameraRefusedError(
                'zoomTo',
                `The focal length stayed at ${start} mm: zoomTo needs a power-zoom lens`
            )
        throw new CameraOutcomeUnknownError(
            'zoomTo',
            `The focal length read back ${start} mm, unchanged, but the camera may have moved its digital zoom instead (Clear Image or Digital Zoom is on)`
        )
    }

    /** Drives towards the target until it is reached or crossed, the lens stalls, or stopZoom is called. */
    private async pass(
        from: number,
        target: number,
        speed: ZoomSpeed,
        states: readonly SonyPropertyState[],
        stopsAtStart: number
    ): Promise<{ landed: number; interrupted: boolean; sent: boolean }> {
        const direction: ZoomDirection = target > from ? 'in' : 'out'
        const sent = await this.drive('zoomTo', direction, speed, states, stopsAtStart)
        // A stop came in before the start went out: the lens was not moved, and `from` was just read.
        if (!sent) return { landed: from, interrupted: true, sent }
        let last = from
        let lastChangeMs = Date.now()
        const deadline = Date.now() + this.safetyStopMilliseconds
        try {
            while (Date.now() < deadline && this.stops === stopsAtStart) {
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
            await this.halt()
            throw new CameraOutcomeUnknownError(
                'zoomTo',
                `The focal length could not be read while zooming: ${describe(error)}`
            )
        }
        const interrupted = this.stops !== stopsAtStart
        if (!interrupted) await this.halt()
        return { landed: await this.settledFocalLength(last), interrupted, sent }
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

    /**
     * One zoom-start command, unless stopZoom was called since the operation began (then nothing is
     * sent and this resolves false). The safety stop is armed first, so even an unconfirmed start
     * stops by itself. A stopZoom during the start's transaction queues behind it and stops the lens.
     */
    private async drive(
        operation: 'startZoom' | 'zoomTo',
        direction: ZoomDirection,
        speed: ZoomSpeed,
        states: readonly SonyPropertyState[],
        stopsAtStart: number
    ): Promise<boolean> {
        const level = this.speedLevel(speed, states)
        if (this.stops !== stopsAtStart) return false
        this.armSafetyStop()
        try {
            await this.driver.sendZoomStart(direction === 'in' ? 'tele' : 'wide', level)
            this.zooming = this.stops === stopsAtStart
            return true
        } catch (error) {
            if (error instanceof PTPResponseError) {
                this.clearSafetyStop()
                throw new CameraRefusedError(operation, `The camera refused to zoom ${direction}: ${error.message}`)
            }
            this.zooming = this.stops === stopsAtStart
            throw new CameraOutcomeUnknownError(operation, `Zooming ${direction} was not confirmed: ${describe(error)}`)
        }
    }

    /**
     * Sony's speed is 1 (slowest) to the top of Zoom Speed Range, from the inventory this operation
     * just read; a fixed-speed body, or one that reports no range, gets 1.
     */
    private speedLevel(speed: ZoomSpeed, states: readonly SonyPropertyState[]): number {
        const reported = states.find(state => state.name === 'ZoomSpeed')?.range?.maximum
        const maximum = reported !== undefined && Number.isInteger(reported) && reported >= 1 ? reported : 1
        if (speed === 'slow') return 1
        if (speed === 'fast') return maximum
        return Math.max(1, Math.round(maximum / 2))
    }

    /** Sends the zoom stop. Internal stops (end of a zoomTo pass, the safety stop) do not count as stopZoom calls. */
    private async halt(): Promise<void> {
        this.clearSafetyStop()
        const wasZooming = this.zooming
        this.zooming = false
        try {
            await this.driver.sendZoomStop()
        } catch (error) {
            // Nothing this session started was moving, so a refused stop changed nothing.
            if (error instanceof PTPResponseError && !wasZooming) return
            if (error instanceof PTPResponseError)
                throw new CameraRefusedError('stopZoom', `The camera refused to stop zooming: ${error.message}`)
            throw new CameraOutcomeUnknownError('stopZoom', `Stopping the zoom was not confirmed: ${describe(error)}`)
        }
    }

    private armSafetyStop(): void {
        this.clearSafetyStop()
        this.safetyStop = setTimeout(() => void this.halt().catch(() => undefined), this.safetyStopMilliseconds)
        // A pending safety stop never keeps a Node process alive by itself.
        if (typeof this.safetyStop === 'object' && 'unref' in this.safetyStop) this.safetyStop.unref()
    }

    private clearSafetyStop(): void {
        if (this.safetyStop) clearTimeout(this.safetyStop)
        this.safetyStop = undefined
    }
}
