import { concatenateBytes } from '@ptp/datasets/codecs/byte-sequence'
import { isParameterBlock } from '@ptp/container'

export enum PTPIPPacketType {
    InitCommandRequest = 1,
    InitCommandAck = 2,
    InitEventRequest = 3,
    InitEventAck = 4,
    InitFail = 5,
    OperationRequest = 6,
    OperationResponse = 7,
    Event = 8,
    StartData = 9,
    Data = 10,
    Cancel = 11,
    EndData = 12,
    Ping = 13,
    Pong = 14,
}

type Bytes = Uint8Array<ArrayBufferLike>

export interface PTPIPPacket {
    type: PTPIPPacketType
    payload: Bytes
}

export interface PTPIPCommandAck {
    connectionNumber: number
    cameraGuid: Bytes
    cameraName: string
    protocolVersion: number
}

const HEADER_LENGTH = 8
const MAX_PACKET_LENGTH = 1024 * 1024 * 1024

function littleEndian(size: number, write: (view: DataView) => void): Uint8Array {
    const bytes = new Uint8Array(size)
    write(new DataView(bytes.buffer))
    return bytes
}
const uint16 = (value: number) => littleEndian(2, view => view.setUint16(0, value, true))
const uint32 = (value: number) => littleEndian(4, view => view.setUint32(0, value, true))
function uint64(value: number): Uint8Array {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid PTP/IP data length ${value}`)
    return littleEndian(8, view => view.setBigUint64(0, BigInt(value), true))
}

function utf16LittleEndian(value: string): Uint8Array {
    const bytes = new Uint8Array((value.length + 1) * 2)
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < value.length; index += 1) view.setUint16(index * 2, value.charCodeAt(index), true)
    return bytes
}

function readUtf16LittleEndian(bytes: Uint8Array, offset: number): { value: string; nextOffset: number } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const characters: number[] = []
    let cursor = offset
    while (cursor + 2 <= bytes.length) {
        const character = view.getUint16(cursor, true)
        cursor += 2
        if (character === 0) return { value: String.fromCharCode(...characters), nextOffset: cursor }
        characters.push(character)
    }
    throw new Error('PTP/IP string is not NUL terminated')
}

export function encodePTPIPPacket(type: PTPIPPacketType, payload: Bytes = new Uint8Array()): Bytes {
    const packet = new Uint8Array(HEADER_LENGTH + payload.length)
    const view = new DataView(packet.buffer)
    view.setUint32(0, packet.length, true)
    view.setUint32(4, type, true)
    packet.set(payload, HEADER_LENGTH)
    return packet
}

export function takePTPIPPackets(buffer: Bytes): { packets: PTPIPPacket[]; remainder: Bytes } {
    const packets: PTPIPPacket[] = []
    let offset = 0
    while (buffer.length - offset >= HEADER_LENGTH) {
        const view = new DataView(buffer.buffer, buffer.byteOffset + offset, buffer.length - offset)
        const packetLength = view.getUint32(0, true)
        if (packetLength < HEADER_LENGTH || packetLength > MAX_PACKET_LENGTH) {
            throw new Error(`Invalid PTP/IP packet length ${packetLength}`)
        }
        if (buffer.length - offset < packetLength) break
        packets.push({
            type: view.getUint32(4, true) as PTPIPPacketType,
            payload: buffer.slice(offset + HEADER_LENGTH, offset + packetLength),
        })
        offset += packetLength
    }
    return { packets, remainder: buffer.slice(offset) }
}

export function buildInitCommandRequest(clientGuid: Bytes, clientName: string): Bytes {
    if (clientGuid.length !== 16) throw new Error('PTP/IP client GUID must be exactly 16 bytes')
    // Protocol version 1.0: minor 0, then major 1.
    const version = concatenateBytes([uint16(0), uint16(1)])
    return encodePTPIPPacket(
        PTPIPPacketType.InitCommandRequest,
        concatenateBytes([clientGuid, utf16LittleEndian(clientName), version])
    )
}

export function parseInitCommandAck(packet: PTPIPPacket): PTPIPCommandAck {
    if (packet.type !== PTPIPPacketType.InitCommandAck) {
        if (packet.type === PTPIPPacketType.InitFail) throw new Error('Camera rejected the PTP/IP command connection')
        throw new Error(`Expected PTP/IP command acknowledgement, received packet type ${packet.type}`)
    }
    if (packet.payload.length < 24) throw new Error('PTP/IP command acknowledgement is too short')
    const view = new DataView(packet.payload.buffer, packet.payload.byteOffset, packet.payload.byteLength)
    const name = readUtf16LittleEndian(packet.payload, 20)
    if (name.nextOffset + 4 > packet.payload.length) throw new Error('PTP/IP command acknowledgement omits its version')
    return {
        connectionNumber: view.getUint32(0, true),
        cameraGuid: packet.payload.slice(4, 20),
        cameraName: name.value,
        protocolVersion: view.getUint32(name.nextOffset, true),
    }
}

export function buildInitEventRequest(connectionNumber: number): Uint8Array {
    return encodePTPIPPacket(PTPIPPacketType.InitEventRequest, uint32(connectionNumber))
}

export function buildOperationRequest(
    operationCode: number,
    transactionId: number,
    parameters: Bytes,
    sendsData: boolean
): Uint8Array {
    if (!isParameterBlock(parameters)) {
        throw new Error(
            `PTP/IP operation parameters must contain zero to five uint32 values, received ${parameters.length} bytes`
        )
    }
    return encodePTPIPPacket(
        PTPIPPacketType.OperationRequest,
        concatenateBytes([uint32(sendsData ? 2 : 1), uint16(operationCode), uint32(transactionId), parameters])
    )
}

export function buildStartData(transactionId: number, totalLength: number): Uint8Array {
    return encodePTPIPPacket(PTPIPPacketType.StartData, concatenateBytes([uint32(transactionId), uint64(totalLength)]))
}

export function buildDataPacket(
    type: PTPIPPacketType.Data | PTPIPPacketType.EndData,
    transactionId: number,
    data: Bytes
) {
    return encodePTPIPPacket(type, concatenateBytes([uint32(transactionId), data]))
}

export function buildPong(): Uint8Array {
    return encodePTPIPPacket(PTPIPPacketType.Pong)
}

export function parseTransactionPayload(packet: PTPIPPacket, minimumDataLength = 0) {
    if (packet.payload.length < 4 + minimumDataLength) throw new Error(`PTP/IP packet type ${packet.type} is too short`)
    const view = new DataView(packet.payload.buffer, packet.payload.byteOffset, packet.payload.byteLength)
    return { transactionId: view.getUint32(0, true), data: packet.payload.slice(4) }
}

export function parseResponse(packet: PTPIPPacket) {
    if (packet.type !== PTPIPPacketType.OperationResponse || packet.payload.length < 6) {
        throw new Error('Invalid PTP/IP operation response')
    }
    const view = new DataView(packet.payload.buffer, packet.payload.byteOffset, packet.payload.byteLength)
    const parameters = packet.payload.slice(6)
    if (parameters.length % 4 !== 0) throw new Error('PTP/IP response parameters are not uint32 aligned')
    return { code: view.getUint16(0, true), transactionId: view.getUint32(2, true), parameters }
}

export function parseEvent(packet: PTPIPPacket) {
    if (packet.type !== PTPIPPacketType.Event || packet.payload.length < 6) throw new Error('Invalid PTP/IP event')
    const view = new DataView(packet.payload.buffer, packet.payload.byteOffset, packet.payload.byteLength)
    const parameters: number[] = []
    for (let offset = 6; offset + 4 <= packet.payload.length; offset += 4) parameters.push(view.getUint32(offset, true))
    return { code: view.getUint16(0, true), transactionId: view.getUint32(2, true), parameters }
}

export function parseStartData(packet: PTPIPPacket) {
    if (packet.type !== PTPIPPacketType.StartData || packet.payload.length < 12)
        throw new Error('Invalid PTP/IP start-data packet')
    const view = new DataView(packet.payload.buffer, packet.payload.byteOffset, packet.payload.byteLength)
    const totalLength = view.getBigUint64(4, true)
    if (totalLength > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error(`PTP/IP data length ${totalLength} is not safely representable`)
    return { transactionId: view.getUint32(0, true), totalLength: Number(totalLength) }
}
