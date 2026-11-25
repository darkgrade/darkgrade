import { CameraUnsupportedError } from '@camera/errors'
import type { MediaItem } from '@camera/driver/media'
import type { Camera } from '@camera/index'
import type { SmokeArea } from '@scripts/camera-smoke/smoke-area'
import { protocolSession } from '@camera/operations/protocol'

/** The longest file the smoke step downloads, so a card of long clips never stalls it. */
const DOWNLOAD_LIMIT_BYTES = 80 * 1024 * 1024

/** Sony's native slot status (CrSDK MediaSLOT1_Status, MediaSLOT2_Status) and operating mode. */
const SONY_SLOT_STATUS_CODES = { slotOne: 0xd248, slotTwo: 0xd256 }
const SONY_OPERATING_MODE_CODE = 0xd0bc

/** The raw and decoded values of the named Sony properties, as evidence for the card mapping. */
async function sonyNativeCodes(camera: Camera, codes: Record<string, number>) {
    const states = await protocolSession(camera).getSonyPropertyStates()
    return Object.fromEntries(
        Object.entries(codes).map(([name, code]) => {
            const state = states.find(candidate => candidate.code === code)
            return [name, state && { raw: state.rawValue, value: state.value, enabledFlag: state.sonyEnabledFlag }]
        })
    )
}

const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8
const header = (bytes: Uint8Array) => [...bytes.slice(0, 4)].map(byte => byte.toString(16).padStart(2, '0')).join('')

/** A downloaded file looks like what its name says: JPEG, TIFF-based RAW, HEIF/MP4 box, or anything for others. */
function looksLike(item: MediaItem, bytes: Uint8Array): boolean {
    const extension = item.name.split('.').pop()?.toLowerCase() ?? ''
    if (extension === 'jpg' || extension === 'jpeg') return isJpeg(bytes)
    if (['arw', 'nef', 'cr2', 'dng', 'tif', 'tiff'].includes(extension)) return header(bytes) === '49492a00' || header(bytes) === '4d4d002a'
    if (['hif', 'heif', 'heic', 'mp4', 'mov', 'cr3'].includes(extension))
        return new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp'
    return bytes.length > 0
}

/**
 * Reads the card and copies one file off it; never deletes, formats or writes to the card. Checks
 * that previews are JPEGs, that the download's length and header match the listing, that live view
 * works again afterwards (Slate returns a Sony body to shooting by itself), and that the same id
 * still works after a reconnect on the same Camera.
 */
export const mediaSmoke: SmokeArea = {
    name: 'media',
    description: 'getCardStatus, listMedia, getMediaPreview and downloadMedia, read-only on the card',
    async run(camera, report) {
        report.confirmed('getCardStatus', await camera.getCardStatus())
        const sony = (await camera.getInfo()).manufacturer === 'Sony'
        if (sony) report.confirmed('Sony native card slot codes', await sonyNativeCodes(camera, SONY_SLOT_STATUS_CODES))
        const items = await camera.listMedia()
        const newest = items[0]
        report.confirmed('listMedia', {
            count: items.length,
            newest: newest && { name: newest.name, kind: newest.kind, capturedAt: newest.capturedAt, sizeBytes: newest.sizeBytes },
            ordered: items.every((item, index) => index === 0 || (items[index - 1]!.capturedAt ?? '') >= (item.capturedAt ?? '')),
        })
        if (!newest) return report.skipped('getMediaPreview and downloadMedia', 'the card is empty; take a photo first')

        const previewed = items.find(item => item.previews.includes('thumbnail'))
        if (!previewed) report.skipped('getMediaPreview', 'no file offers a thumbnail')
        else
            for (const size of previewed.previews) {
                const jpeg = await camera.getMediaPreview(previewed.id, size)
                if (!isJpeg(jpeg)) throw new Error(`The ${size} of ${previewed.name} is not a JPEG`)
                report.confirmed(`getMediaPreview ${size}`, { name: previewed.name, bytes: jpeg.length })
            }

        const downloadable = items
            .filter(item => item.kind === 'photo' && item.sizeBytes !== undefined && item.sizeBytes <= DOWNLOAD_LIMIT_BYTES)
            .sort((left, right) => (left.sizeBytes ?? 0) - (right.sizeBytes ?? 0))[0]
        if (!downloadable) return report.skipped('downloadMedia', `no photo under ${DOWNLOAD_LIMIT_BYTES} bytes`)
        let progressReports = 0
        const startedMs = performance.now()
        const bytes = await camera.downloadMedia(downloadable.id, { onProgress: () => progressReports++ })
        if (bytes.length !== downloadable.sizeBytes)
            throw new Error(`${downloadable.name} downloaded ${bytes.length} bytes; the card lists ${downloadable.sizeBytes}`)
        if (!looksLike(downloadable, bytes)) throw new Error(`${downloadable.name} does not start like its type (${header(bytes)})`)
        report.confirmed('downloadMedia', {
            name: downloadable.name,
            bytes: bytes.length,
            header: header(bytes),
            progressReports,
            milliseconds: Math.round(performance.now() - startedMs),
        })

        try {
            const frame = await camera.getLiveViewFrame()
            if (!isJpeg(frame.jpeg)) throw new Error('The live-view frame after the card read is not a JPEG')
            // A playback image is a JPEG too: on Sony, the body must also report that it is shooting again.
            const shooting = sony ? await sonyNativeCodes(camera, { operatingMode: SONY_OPERATING_MODE_CODE }) : undefined
            if (shooting && shooting.operatingMode?.value === 'Playback')
                throw new Error('The body still reports Playback after the live-view frame that follows a card read')
            report.confirmed('live view after the card read', { bytes: frame.jpeg.length, jpeg: true, ...shooting })
        } catch (error) {
            if (!(error instanceof CameraUnsupportedError) && !/not supported/i.test(String(error))) throw error
            report.skipped('live view after the card read', String(error))
        }

        await camera.disconnect()
        await camera.connect()
        const again = await camera.downloadMedia(downloadable.id)
        if (again.length !== bytes.length || again.some((byte, index) => byte !== bytes[index]))
            throw new Error(`${downloadable.name} differs after a reconnect`)
        report.confirmed('downloadMedia after a reconnect with the same id', { name: downloadable.name, identical: true })
    },
}
