import { protocolSession } from '@camera/operations/protocol'
import { sonyPtpMovieCard } from '@vendors/sony/ptp-recording-card'
import { isVerifiedFeature } from '@camera/validated-models'

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

/** Reuse the native destination; when a body omits it, try the single-slot read (bench-verified on the a6700 only)
 * and keep the native result if that read is refused or still cannot identify a card. */
export async function readSonyMovieCard(camera: any) {
    const card = await sonyPtpMovieCard(protocolSession(camera))
    if (card.status !== 'unknown' || card.slots.length) return card
    try {
        const operations = protocolSession(camera).driver.registry.operations
        const identity = await camera.send(operations.GetDeviceInfo, {})
        const model = identity.code === 0x2001 ? identity.data?.model : undefined
        if (typeof model !== 'string' || !model) return card
        const verified = isVerifiedFeature('sony-card-fallback', model)
        const fallback = await sonyPtpMovieCard(protocolSession(camera), { singleSlot: true })
        if (fallback.status === 'unknown' && !verified) return card
        return { ...fallback, singleSlotFallback: true as const, verified }
    } catch {
        return card
    }
}
