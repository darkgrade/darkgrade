import { CameraRefusedError } from '@camera/errors'
import type { MediaItem } from '@camera/driver'

/**
 * Media ids are opaque to callers. Each carries the file's name and size, so a driver can find the
 * same file again after a reconnect, when the camera may number its objects differently.
 */

/** A file found through standard PTP object handles. */
export interface ObjectMediaReference {
    source: 'object'
    storageId: number
    objectHandle: number
    name: string
    sizeBytes?: number
}

/** A file in Sony's own card index (Remote Control with Transfer Mode). */
export interface SonyContentMediaReference {
    source: 'sony-content'
    slot: 1 | 2
    contentId: number
    fileId: number
    name: string
    sizeBytes: number
}

export type MediaReference = ObjectMediaReference | SonyContentMediaReference

const OBJECT_PREFIX = 'ptp'
const SONY_CONTENT_PREFIX = 'sony'

export function encodeMediaId(reference: MediaReference): string {
    const name = encodeURIComponent(reference.name)
    if (reference.source === 'object')
        return [
            OBJECT_PREFIX,
            reference.storageId.toString(16),
            reference.objectHandle.toString(16),
            reference.sizeBytes ?? '',
            name,
        ].join(':')
    return [SONY_CONTENT_PREFIX, reference.slot, reference.contentId, reference.fileId, reference.sizeBytes, name].join(':')
}

const unknownId = (operation: string, id: string) =>
    new CameraRefusedError(operation, `${JSON.stringify(id)} is not a media id from listMedia()`)

function wholeNumber(text: string | undefined, radix = 10): number | undefined {
    if (text === undefined || !(radix === 16 ? /^[0-9a-f]{1,8}$/ : /^\d{1,16}$/).test(text)) return undefined
    const value = Number.parseInt(text, radix)
    return Number.isSafeInteger(value) ? value : undefined
}

function decodedName(text: string | undefined): string | undefined {
    if (!text) return undefined
    try {
        return decodeURIComponent(text)
    } catch {
        return undefined
    }
}

/** The reference an id was made from, or CameraRefusedError when it is not one of ours. */
export function decodeMediaId(operation: string, id: string): MediaReference {
    const parts = typeof id === 'string' ? id.split(':') : []
    const name = decodedName(parts[parts.length - 1])
    if (parts.length === 5 && parts[0] === OBJECT_PREFIX && name) {
        const storageId = wholeNumber(parts[1], 16)
        const objectHandle = wholeNumber(parts[2], 16)
        const sizeBytes = parts[3] === '' ? undefined : wholeNumber(parts[3])
        if (storageId !== undefined && objectHandle !== undefined && (parts[3] === '' || sizeBytes !== undefined))
            return { source: 'object', storageId, objectHandle, name, ...(sizeBytes !== undefined && { sizeBytes }) }
    }
    if (parts.length === 6 && parts[0] === SONY_CONTENT_PREFIX && name) {
        const slot = wholeNumber(parts[1])
        const contentId = wholeNumber(parts[2])
        const fileId = wholeNumber(parts[3])
        const sizeBytes = wholeNumber(parts[4])
        if ((slot === 1 || slot === 2) && contentId !== undefined && fileId !== undefined && sizeBytes !== undefined)
            return { source: 'sony-content', slot, contentId, fileId, name, sizeBytes }
    }
    throw unknownId(operation, id)
}

const PHOTO_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'arw', 'srf', 'sr2', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'hif', 'heif', 'heic', 'dng', 'raf',
    'orf', 'rw2', 'pef', 'tif', 'tiff',
])
const CLIP_EXTENSIONS = new Set(['mp4', 'mov', 'mxf', 'mts', 'm2ts', 'avi', 'm4v', 'crm'])

export function mediaKind(name: string): MediaItem['kind'] {
    const extension = name.split('.').pop()?.toLowerCase() ?? ''
    if (PHOTO_EXTENSIONS.has(extension)) return 'photo'
    if (CLIP_EXTENSIONS.has(extension)) return 'clip'
    return 'other'
}

/** PTP's `YYYYMMDDThhmmss[.s][zone]` as ISO 8601 local wall time, or undefined when unreadable. */
export function ptpDateToIso(value: string | undefined): string | undefined {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(value ?? '')
    if (!match) return undefined
    const [, year, month, day, hour, minute, second] = match
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

/** Newest first: capture time, then the camera's own numbering, newest highest. */
export function newestFirst<Item extends { capturedAt?: string }>(items: Item[], order: (item: Item) => number): Item[] {
    return [...items].sort((left, right) => {
        const byTime = (right.capturedAt ?? '').localeCompare(left.capturedAt ?? '')
        return byTime !== 0 ? byTime : order(right) - order(left)
    })
}
