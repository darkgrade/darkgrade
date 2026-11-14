/** EOS can acknowledge the PTP transaction while rejecting shutter release in its result parameter. */
export function assertCanonCaptureResult(parameters: number[] | undefined, action: string): void {
    const result = parameters?.[0]
    if (result === undefined || result === 0) return
    // EDSDK ReleaseSwitch/TakePicture map this result to 0x8d00 | result.
    // EDSDKErrors.h names 0x8d0c SPECIAL_MOVIE_MODE_NG and 0x8d0e MOVIE_MODE_NG.
    // The remaining names come from the same EDSDKErrors.h TAKE_PICTURE list (0x8d01..0x8d0f).
    const reasons: Record<number, string> = {
        1: 'the camera could not focus (low contrast or too dark)',
        3: 'mirror lock-up is active',
        4: 'sensor cleaning is running',
        5: 'silent shooting prevents this release',
        6: 'no card is inserted',
        7: 'the card cannot be written',
        8: 'the card is write-protected',
        10: 'the flash is still charging',
        11: 'no lens is attached',
        12: 'this movie configuration prevents still capture',
        13: 'live-view release is prohibited in this mode',
        14: 'the camera is in movie mode',
        15: 'the lens is retracted',
    }
    const detail = reasons[result] ? `: ${reasons[result]}` : ''
    throw new Error(`Canon ${action} rejected capture with shutter result 0x${result.toString(16)}${detail}`)
}
