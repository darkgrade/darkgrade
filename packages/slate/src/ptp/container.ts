/**
 * The PTP generic container (ISO 15740 §D.7.1.1, the USB still-image class framing that PTP/IP
 * carries too): a 12-byte little-endian header (length, type, code, transaction id) and its payload.
 * The one place its layout is read and written.
 */
export const ContainerType = { COMMAND: 1, DATA: 2, RESPONSE: 3, EVENT: 4 } as const
export type ContainerType = (typeof ContainerType)[keyof typeof ContainerType]

export const CONTAINER_HEADER_BYTES = 12

export interface ContainerHeader {
    /** The length the container declares, header included. */
    length: number
    type: number
    code: number
    transactionId: number
}

export interface ParsedContainer extends ContainerHeader {
    payload: Uint8Array
}

/** A command or response carries zero to five UINT32 parameters (ISO 15740 §D.7.1.1). */
export const MAXIMUM_PARAMETERS = 5

/** Whether these bytes are a parameter block: whole UINT32 words, at most five. */
export function isParameterBlock(bytes: Uint8Array): boolean {
    return bytes.length % 4 === 0 && bytes.length <= MAXIMUM_PARAMETERS * 4
}

/** The UINT32 parameters of a parameter block; undefined when the bytes are not one. */
export function readParameters(bytes: Uint8Array): number[] | undefined {
    if (!isParameterBlock(bytes)) return undefined
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return Array.from({ length: bytes.length / 4 }, (_, index) => view.getUint32(index * 4, true))
}

const TYPE_NAMES: Record<number, string> = { 1: 'command', 2: 'data', 3: 'response', 4: 'event' }

/** The header of a container of at least CONTAINER_HEADER_BYTES; callers judge length and type themselves. */
export function readContainerHeader(bytes: Uint8Array): ContainerHeader {
    if (bytes.length < CONTAINER_HEADER_BYTES) throw new RangeError(`Invalid container: too short (${bytes.length} bytes)`)
    const view = new DataView(bytes.buffer, bytes.byteOffset, CONTAINER_HEADER_BYTES)
    return {
        length: view.getUint32(0, true),
        type: view.getUint16(4, true),
        code: view.getUint16(6, true),
        transactionId: view.getUint32(8, true),
    }
}

/** A complete container: the header followed by the payload parts. */
export function buildContainer(type: number, code: number, transactionId: number, ...payload: Uint8Array[]): Uint8Array {
    const buffer = new Uint8Array(CONTAINER_HEADER_BYTES + payload.reduce((sum, part) => sum + part.length, 0))
    const view = new DataView(buffer.buffer)
    view.setUint32(0, buffer.length, true)
    view.setUint16(4, type, true)
    view.setUint16(6, code, true)
    view.setUint32(8, transactionId, true)
    let offset = CONTAINER_HEADER_BYTES
    for (const part of payload) {
        buffer.set(part, offset)
        offset += part.length
    }
    return buffer
}

/** Header and payload (everything after the header); throws when the type is not the expected one. */
export function parseContainer(data: Uint8Array, expectedType?: ContainerType): ParsedContainer {
    const header = readContainerHeader(data)
    if (expectedType !== undefined && header.type !== expectedType)
        throw new Error(`Expected ${TYPE_NAMES[expectedType]} container, got type ${header.type}`)
    return { ...header, payload: data.slice(CONTAINER_HEADER_BYTES) }
}
