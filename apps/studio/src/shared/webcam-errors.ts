/** Turns the browser's terse webcam errors (Developer Mode's webcam feed) into what happened and what to do. */
export function describeWebcamError(error: unknown): string {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError')
        return "Darkgrade Studio can't use the camera. Open System Settings → Privacy & Security → Camera and turn on Darkgrade Studio."
    if (name === 'NotFoundError' || name === 'OverconstrainedError')
        return "Studio can't find a webcam. Connect one, or bring an iPhone near this Mac to use it as a Continuity Camera."
    if (name === 'NotReadableError' || name === 'AbortError')
        return 'The webcam is busy or unavailable. Close other apps that use it, then choose the webcam again.'
    return error instanceof Error ? error.message : String(error)
}
