import { cameraControlDefinitions, type CameraControlId } from '@camera/controls'

/** An acknowledged request whose fresh camera observation did not confirm the requested state. */
export class CameraConfirmationError extends Error {
    constructor(
        readonly operation: string,
        readonly expected: string,
        readonly observed: string | null
    ) {
        const label =
            operation === 'record_start'
                ? 'Recording start'
                : operation === 'record_stop'
                  ? 'Recording stop'
                  : (cameraControlDefinitions[operation as CameraControlId]?.label ?? operation)
        super(
            `${label}: camera did not confirm ${expected}; observed ${observed ?? 'unknown'}. Refresh before another write.`
        )
        this.name = 'CameraConfirmationError'
    }
}

/** Poll observations only. A timed-out or ignored write is never repeated by confirmation. */
export async function confirmCameraValue(
    operation: string,
    expected: string,
    observe: () => Promise<string | null>,
    timeoutMilliseconds = 2000
): Promise<void> {
    const deadline = Date.now() + timeoutMilliseconds
    let observed: string | null
    do {
        observed = await observe()
        if (observed === expected) return
        if (Date.now() >= deadline) break
        await new Promise(resolve => setTimeout(resolve, Math.min(100, deadline - Date.now())))
    } while (true)
    throw new CameraConfirmationError(operation, expected, observed!)
}
