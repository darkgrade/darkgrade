import { cameraControlDefinitions, type CameraControlId } from '@camera/controls'
import { CameraOutcomeUnknownError } from '@camera/errors'

/** An acknowledged request whose fresh camera observation did not confirm the requested state. */
export class CameraConfirmationError extends CameraOutcomeUnknownError {
    constructor(
        readonly operation: string,
        readonly expected: string,
        readonly observed: string | null
    ) {
        const recording: Record<string, string> = { record_start: 'Recording start', record_stop: 'Recording stop' }
        const label = recording[operation] ?? cameraControlDefinitions[operation as CameraControlId]?.label ?? operation
        super(operation, `${label}: camera did not confirm ${expected}; observed ${observed ?? 'unknown'}. Refresh before another write.`)
        this.name = 'CameraConfirmationError'
    }
}

/**
 * Poll observations only. A timed-out or ignored write is never repeated by confirmation.
 * `matches` compares a value spelled differently on readback (e.g. 0.01 s read back as 1/100).
 */
export async function confirmCameraValue(
    operation: string,
    expected: string,
    observe: () => Promise<string | null>,
    timeoutMilliseconds = 2000,
    matches: (observed: string, expected: string) => boolean = (observed, expected) => observed === expected
): Promise<void> {
    const deadline = Date.now() + timeoutMilliseconds
    let observed: string | null
    do {
        observed = await observe()
        if (observed !== null && matches(observed, expected)) return
        if (Date.now() >= deadline) break
        await new Promise(resolve => setTimeout(resolve, Math.min(100, deadline - Date.now())))
    } while (true)
    throw new CameraConfirmationError(operation, expected, observed!)
}
