import { CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { SmokeArea, SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** Runs a step, reporting CameraUnsupportedError as a skip with the camera's reason. */
async function unlessUnsupported(report: SmokeReport, step: string, run: () => Promise<void>) {
    try {
        await run()
    } catch (error) {
        if (error instanceof CameraUnsupportedError) return report.skipped(step, error.message)
        throw error
    }
}

/** The focus area, subject detection and AF frame as the camera reports them now. */
async function focusState(camera: Camera) {
    const controls = (await camera.getCapabilities()).controls
    return { focusArea: controls.focusArea?.value, subjectDetection: controls.subjectDetection?.value }
}

/**
 * autofocus, setFocusPoint, resetFocusPoint and nudgeFocus through the public Camera API. A focus
 * point may switch the focus area and pause subject detection; resetFocusPoint must put both back,
 * which this checks against the state read before the point.
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
            await camera.setFocusPoint(0.7, 0.6, { autofocus: false })
            report.confirmed('setFocusPoint(0.7, 0.6, { autofocus: false }) → state', await focusState(camera))
            await camera.resetFocusPoint()
            const after = await focusState(camera)
            report.confirmed('resetFocusPoint() → state', after)
            if (after.focusArea !== before.focusArea || after.subjectDetection !== before.subjectDetection)
                throw new Error(`resetFocusPoint left ${JSON.stringify(after)}, not ${JSON.stringify(before)}`)
            report.confirmed('autofocus() after reset', await camera.autofocus())
        })

        await unlessUnsupported(report, 'nudgeFocus', async () => {
            await camera.nudgeFocus('near', 'small')
            report.confirmed("nudgeFocus('near', 'small')", 'moved')
            await camera.nudgeFocus('far', 'small')
            report.confirmed("nudgeFocus('far', 'small')", 'moved back')
        })
    },
}
