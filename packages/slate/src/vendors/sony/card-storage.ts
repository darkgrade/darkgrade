import { sonyPtpMovieCard } from '@vendors/sony/ptp-recording-card'

/** Sony's remote-control storage is read-only to the host and reports zero byte capacity.
 * Native card status supplies camera-side recording evidence; preserve the host fields. */
export async function sonyStorageRecordingCapability(camera: any, storageId: number) {
    const card = await readSonyMovieCard(camera)
    const slot = storageId >>> 16
    return {
        recordingReady: card.status === 'ready' && card.slots.includes(slot) && card.remainingMovieSeconds !== 0,
        recordingEvidence: card,
    }
}

/** Reuse the native destination, with the already qualified single-slot model fallback. */
export async function readSonyMovieCard(camera: any) {
    let card = await sonyPtpMovieCard(camera)
    if (card.status === 'unknown' && !card.slots.length) {
        const operations = camera.getInstance().registry.operations
        const identity = await camera.send(operations.GetDeviceInfo, {})
        if (identity.code === 0x2001 && identity.data?.model === 'ILCE-6700')
            card = await sonyPtpMovieCard(camera, { singleSlot: true })
    }
    return card
}
