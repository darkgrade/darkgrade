/** EOS can acknowledge the PTP transaction while rejecting shutter release in its result parameter. */
export function assertCanonCaptureResult(parameters: number[] | undefined, action: string): void {
    const result = parameters?.[0]
    if (result === undefined || result === 0) return
    // EDSDK ReleaseSwitch/TakePicture map this result to 0x8d00 | result.
    // EDSDKErrors.h names 0x8d0c SPECIAL_MOVIE_MODE_NG and 0x8d0e MOVIE_MODE_NG.
    const detail = result === 12 ? ': this movie configuration prevents still capture'
        : result === 14 ? ': the camera is in movie mode' : ''
    throw new Error(`Canon ${action} rejected capture with shutter result 0x${result.toString(16)}${detail}`)
}
