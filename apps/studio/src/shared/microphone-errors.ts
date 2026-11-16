export const MICROPHONE_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'

export interface MicrophoneProblem {
    message: string
    /** macOS is blocking the microphone, which the person can fix in System Settings. */
    blockedByMacos: boolean
}

/** Turns the browser's terse microphone errors into what happened and what to do about it. */
export function describeMicrophoneError(error: unknown): MicrophoneProblem | null {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') {
        return {
            message:
                "Darkgrade Studio can't use the microphone. Open System Settings → Privacy & Security → Microphone, turn on Darkgrade Studio, then press Start again.",
            blockedByMacos: true,
        }
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        return {
            message:
                "Studio can't find a microphone. Some Macs, like the Mac mini, don't have one built in. Plug in a USB microphone or headset, then press Start again.",
            blockedByMacos: false,
        }
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
        return {
            message: 'The microphone is busy or unavailable. Close other apps that use it, then press Start again.',
            blockedByMacos: false,
        }
    }
    return null
}
