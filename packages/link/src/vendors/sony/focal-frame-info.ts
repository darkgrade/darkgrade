/**
 * Sony's FocalFrameInfo (Camera Control PTP 3 reference, "FocalFrameInfo"): the frames the camera draws
 * over live view (its focus area, detected faces and tracked subjects), carried in every live-view dataset.
 * Positions are frame centres; every value is scaled by 1024 against its group's denominators.
 */

export type SonyFrameKind = 'focus' | 'face' | 'tracking'

export interface SonyFocalFrame {
    kind: SonyFrameKind
    /** FocusFrameType, FaceFrameType or TrackingFrameType from the reference. */
    type: number
    /** True once the camera reports this frame in focus. */
    focused: boolean
    /** Smaller is more important. */
    priority: number
    /** Centre and size as fractions of the picture (0–1 from the top left). */
    centerX: number
    centerY: number
    width: number
    height: number
}

export interface SonyFocalFrameInfo {
    /** 100× the data version, e.g. 104 for 1.04. */
    version: number
    frames: SonyFocalFrame[]
}

const HEADER_BYTES = 56
const RESERVED_ENTRY_BYTES = 24
const GROUP_HEADER_BYTES = 16
const FRAME_BYTES = 24
const FOCUSED_STATE = 0x0002
const FACE_AND_TRACKING_MINIMUM_VERSION = 101

export function parseSonyFocalFrameInfo(data: Uint8Array): SonyFocalFrameInfo {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (data.byteLength < HEADER_BYTES) return { version: 0, frames: [] }
    const version = view.getUint16(0, true)
    let offset = HEADER_BYTES + view.getUint16(48, true) * RESERVED_ENTRY_BYTES
    const frames: SonyFocalFrame[] = []
    const kinds: SonyFrameKind[] =
        version >= FACE_AND_TRACKING_MINIMUM_VERSION ? ['focus', 'face', 'tracking'] : ['focus']
    for (const kind of kinds) {
        if (offset + GROUP_HEADER_BYTES > data.byteLength) break
        const group = readGroup(view, offset, kind)
        frames.push(...group.frames)
        offset = group.nextOffset
    }
    return { version, frames }
}

function readGroup(view: DataView, offset: number, kind: SonyFrameKind): { frames: SonyFocalFrame[]; nextOffset: number } {
    const denominatorX = view.getUint32(offset, true)
    const denominatorY = view.getUint32(offset + 4, true)
    const count = view.getUint16(offset + 8, true)
    const firstFrame = offset + GROUP_HEADER_BYTES
    const nextOffset = firstFrame + count * FRAME_BYTES
    if (nextOffset > view.byteLength || denominatorX === 0 || denominatorY === 0) return { frames: [], nextOffset }
    const frames: SonyFocalFrame[] = []
    for (let index = 0; index < count; index++) {
        frames.push(readFrame(view, firstFrame + index * FRAME_BYTES, kind, denominatorX, denominatorY))
    }
    return { frames, nextOffset }
}

/** Face frames pack state as UINT16 then selection and priority bytes; the others have state then priority. */
function readFrame(
    view: DataView,
    offset: number,
    kind: SonyFrameKind,
    denominatorX: number,
    denominatorY: number
): SonyFocalFrame {
    const priority = kind === 'face' ? view.getUint8(offset + 5) : view.getUint8(offset + 4)
    return {
        kind,
        type: view.getUint16(offset, true),
        focused: view.getUint16(offset + 2, true) === FOCUSED_STATE,
        priority,
        centerX: view.getUint32(offset + 8, true) / denominatorX,
        centerY: view.getUint32(offset + 12, true) / denominatorY,
        height: view.getUint32(offset + 16, true) / denominatorY,
        width: view.getUint32(offset + 20, true) / denominatorX,
    }
}
