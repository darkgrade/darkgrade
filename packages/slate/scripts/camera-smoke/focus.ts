import { CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { FocusArea } from '@camera/settings/focus'
import type { SmokeArea, SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** How far the live-view focus frame's centre may sit from the requested point (fraction of the picture). */
const FRAME_TOLERANCE = 0.06
const FRAME_ATTEMPTS = 20
const FRAME_INTERVAL_MILLISECONDS = 150

/** Runs a step, reporting CameraUnsupportedError as a skip with the camera's reason. */
async function unlessUnsupported(report: SmokeReport, step: string, run: () => Promise<void>) {
    try {
        await run()
    } catch (error) {
        if (error instanceof CameraUnsupportedError) return report.skipped(step, error.message)
        throw error
    }
}

/** The focus area and subject detection as the camera reports them now. */
async function focusState(camera: Camera) {
    const controls = (await camera.getCapabilities()).controls
    return { focusArea: controls.focusArea?.value, subjectDetection: controls.subjectDetection?.value }
}

/**
 * Where the camera draws its focus frame in live view, polled until it is within the tolerance of
 * the expected point (the camera moves it a frame or two after the command). Undefined when the
 * camera sends no focus frames over live view.
 */
async function focusFrameNear(camera: Camera, x: number, y: number) {
    let nearest: { x: number; y: number; distance: number } | undefined
    for (let attempt = 0; attempt < FRAME_ATTEMPTS; attempt++) {
        const { focusFrames } = await camera.getLiveViewFrame()
        if (!focusFrames.length) return undefined
        for (const frame of focusFrames.filter(candidate => candidate.kind === 'focus')) {
            const distance = Math.max(Math.abs(frame.centerX - x), Math.abs(frame.centerY - y))
            if (!nearest || distance < nearest.distance) nearest = { x: frame.centerX, y: frame.centerY, distance }
        }
        if (nearest && nearest.distance <= FRAME_TOLERANCE) return nearest
        await new Promise(resolve => setTimeout(resolve, FRAME_INTERVAL_MILLISECONDS))
    }
    return nearest ?? { x: Number.NaN, y: Number.NaN, distance: Number.POSITIVE_INFINITY }
}

/** Confirms the live-view focus frame sits at (x, y), or skips where live view carries no frames. */
async function confirmFrameAt(camera: Camera, report: SmokeReport, step: string, x: number, y: number) {
    const frame = await focusFrameNear(camera, x, y)
    if (!frame) return report.skipped(step, 'the camera sends no focus frames over live view')
    report.confirmed(step, { expected: { x, y }, observed: { x: frame.x, y: frame.y } })
    if (frame.distance > FRAME_TOLERANCE)
        throw new Error(`${step}: the focus frame is at (${frame.x}, ${frame.y}), not near (${x}, ${y})`)
}

/** A spot area the camera offers, so a point has a frame that moves and re-centres. */
async function offeredSpot(camera: Camera): Promise<FocusArea | undefined> {
    const choices = (await camera.getCapabilities()).controls.focusArea?.allowedValues ?? []
    return (['Spot M', 'Spot S', 'Spot L', 'Spot'] as const).find(spot => choices.includes(spot))
}

/**
 * autofocus, setFocusPoint, resetFocusPoint and nudgeFocus through the public Camera API. A focus
 * point may switch the focus area and pause subject detection; resetFocusPoint must put both back,
 * which this checks against the state read before the point. In a spot, the live-view focus frame
 * must follow the point and return to the centre on reset.
 */
export const focusSmoke: SmokeArea = {
    name: 'focus',
    description: 'autofocus, setFocusPoint, resetFocusPoint and nudgeFocus',
    async run(camera, report) {
        const { operations } = await camera.getCapabilities()
        report.confirmed('getCapabilities().operations (focus)', {
            autofocus: operations?.autofocus,
            setFocusPoint: operations?.setFocusPoint,
            resetFocusPoint: operations?.resetFocusPoint,
            nudgeFocus: operations?.nudgeFocus,
        })

        await unlessUnsupported(report, 'autofocus', async () => {
            report.confirmed('autofocus()', await camera.autofocus())
        })

        await unlessUnsupported(report, 'setFocusPoint', async () => {
            const before = await focusState(camera)
            report.confirmed('state before the point', before)
            await camera.setFocusPoint(0.3, 0.4)
            report.confirmed('setFocusPoint(0.3, 0.4) → state', await focusState(camera))
            await confirmFrameAt(camera, report, 'focus frame after setFocusPoint(0.3, 0.4)', 0.3, 0.4)
            await camera.setFocusPoint(0.7, 0.6, { autofocus: false })
            report.confirmed('setFocusPoint(0.7, 0.6, { autofocus: false }) → state', await focusState(camera))
            await confirmFrameAt(camera, report, 'focus frame after setFocusPoint(0.7, 0.6)', 0.7, 0.6)
            await camera.resetFocusPoint()
            const after = await focusState(camera)
            report.confirmed('resetFocusPoint() → state', after)
            if (after.focusArea !== before.focusArea || after.subjectDetection !== before.subjectDetection)
                throw new Error(`resetFocusPoint left ${JSON.stringify(after)}, not ${JSON.stringify(before)}`)
            report.confirmed('autofocus() after reset', await camera.autofocus())
        })

        await unlessUnsupported(report, 'resetFocusPoint in a spot', async () => {
            const spot = await offeredSpot(camera)
            if (!spot) return report.skipped('resetFocusPoint in a spot', 'the camera offers no spot area')
            const original = await camera.getFocusArea()
            try {
                if (original !== spot) report.confirmed(`setFocusArea('${spot}')`, await camera.setFocusArea(spot))
                await camera.setFocusPoint(0.25, 0.7, { autofocus: false })
                await confirmFrameAt(camera, report, `focus frame in ${spot} after setFocusPoint(0.25, 0.7)`, 0.25, 0.7)
                await camera.resetFocusPoint()
                await confirmFrameAt(camera, report, `focus frame in ${spot} after resetFocusPoint()`, 0.5, 0.5)
                const area = await camera.getFocusArea()
                if (area !== spot) throw new Error(`resetFocusPoint changed the user's ${spot} to ${area}`)
            } finally {
                if ((await camera.getFocusArea()) !== original)
                    report.confirmed(`restore focusArea → ${JSON.stringify(original)}`, await camera.setFocusArea(original))
            }
        })

        await unlessUnsupported(report, 'nudgeFocus', async () => {
            await camera.nudgeFocus('near', 'small')
            report.confirmed("nudgeFocus('near', 'small')", 'moved')
            await camera.nudgeFocus('far', 'small')
            report.confirmed("nudgeFocus('far', 'small')", 'moved back')
        })
    },
}
