interface CardProperty { code: number; rawValue: unknown; sonyEnabledFlag?: number }
interface CardCamera { getSonyPropertyStates(): Promise<CardProperty[]> }

/**
 * Native PTP values, not CRSDK property numbers/enums.
 * Sony CRSDK 2.02 libCr_Core ParseSLOTx_STATUS maps native 1..9 to SDK 0..8;
 * ParseSLOTx_RemainingTime copies seconds unchanged. CrDeviceProperty.h names
 * the SDK status values. PTPProxy3_0::SetMovieRecordingMedia forwards 1/2/0x101
 * unchanged to PTP d160. Private source hashes/findings:
 * camera-sdk-analysis/sony-native-usb-2026-11-13/sony-card-protocol/report.md.
 * libCr_Core SHA-256:
 * 8613325b6cc98e591b556e71bcabaca962fc8bc5989ec0425efb7df42e57e519.
 */
export async function sonyPtpMovieCard(camera: CardCamera, options: { singleSlot?: boolean; recording?: boolean } = {}) {
    const properties = await camera.getSonyPropertyStates()
    const raw = (code: number) => {
        const property = properties.find(property => property.code === code)
        // CRSDK CrPropertyEnableFlag: 0 unavailable, 1 active, 2 display-only.
        // Display-only values are readable; an unavailable value is not evidence.
        if (property?.sonyEnabledFlag !== 1 && property?.sonyEnabledFlag !== 2) return undefined
        const value = property.rawValue
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
    }
    const destination = raw(0xd160)
    const slots: number[] = destination === 1 || destination === 2 ? [destination]
        : destination === 0x101 ? [1, 2]
        : destination === undefined && options.singleSlot === true ? [1] : []
    const source = 'Native Sony PTP; Sony CRSDK 2.02 protocol mapping'
    if (!slots.length) return { status: 'unknown' as const, slots, source, detail: 'The native camera did not identify its movie card destination' }
    const cards = slots.map(slot => {
        const code = raw(slot === 1 ? 0xd248 : 0xd256)
        const time = raw(slot === 1 ? 0xd24a : 0xd258)
        const photos = raw(slot === 1 ? 0xd249 : 0xd257)
        return {
            slot, code,
            status: code === 1 ? 'ready' as const : code === 2 ? 'absent' as const
                : code !== undefined && code >= 3 && code <= 9 ? 'error' as const : 'unknown' as const,
            // Still mode can return zero even with a writable card. A zero while
            // observed recording is useful; outside that context it is unknown.
            seconds: time !== undefined && time < 0xffffffff && (time > 0 || options.recording === true) ? time : undefined,
            photos: photos !== undefined && photos < 0xffffffff ? photos : undefined,
        }
    })
    const problem = cards.find(card => card.status === 'error') || cards.find(card => card.status === 'absent') || cards.find(card => card.status === 'unknown')
    return {
        slot: slots[0], slots, code: problem?.code ?? cards[0]!.code,
        status: problem?.status || 'ready' as const,
        remainingMovieSeconds: cards.every(card => card.seconds !== undefined) ? Math.min(...cards.map(card => card.seconds!)) : undefined,
        remainingPhotos: cards.every(card => card.photos !== undefined) ? Math.min(...cards.map(card => card.photos!)) : undefined,
        source,
    }
}
