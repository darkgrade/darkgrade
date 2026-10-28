/**
 * Extracts complete PTP transactions from a testbench usbmon capture (pcapng or pcap with
 * LINKTYPE_USB_LINUX or LINKTYPE_USB_LINUX_MMAPPED), keeping every byte of each phase.
 *
 * Mirrors the framing logic of darkgrade/test-bench src/pcapng.ts and src/ptp-trace.ts, but keeps
 * whole payloads instead of previews. A transaction whose command, data or response phase was not
 * captured in full (usbmon snap length, dropped URBs) is skipped rather than guessed.
 */

const LINKTYPE_USB_LINUX = 189
const LINKTYPE_USB_LINUX_MMAPPED = 220
const MAXIMUM_DATA_PHASE_BYTES = 1024 * 1024

interface CapturedPacket {
    linkType: number
    data: Uint8Array
    originalLength: number
}

interface UsbTransfer {
    event: string
    bulk: boolean
    bulkOrInterrupt: boolean
    directionIn: boolean
    endpoint: number
    bus: number
    device: number
    status: number
    length: number
    data: Uint8Array
    truncated: boolean
}

export interface CapturedTransaction {
    operation: number
    transactionId: number
    parameters: number[]
    dataFromHost?: Uint8Array
    response: { code: number; parameters: number[]; data?: Uint8Array }
}

export interface CapturedEvent {
    code: number
    parameters: number[]
    afterOperation?: number
}

export interface CaptureExtraction {
    device: { bus: number; address: number }
    transactions: CapturedTransaction[]
    events: CapturedEvent[]
    skippedIncomplete: number
}

function readPackets(buffer: Uint8Array): CapturedPacket[] {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    if (buffer.length < 24) throw new Error('Truncated capture header')
    const magic = view.getUint32(0, true)
    if (magic === 0xa1b2c3d4 || magic === 0xa1b23c4d) {
        const linkType = view.getUint32(20, true) & 0x0fffffff
        const packets: CapturedPacket[] = []
        for (let offset = 24; offset + 16 <= buffer.length;) {
            const capturedLength = view.getUint32(offset + 8, true)
            const start = offset + 16
            if (start + capturedLength > buffer.length) throw new Error('Truncated pcap packet')
            packets.push({
                linkType,
                data: buffer.subarray(start, start + capturedLength),
                originalLength: view.getUint32(offset + 12, true),
            })
            offset = start + capturedLength
        }
        return packets
    }
    if (magic !== 0x0a0d0d0a) throw new Error('Not a little-endian pcap or pcapng capture')

    const packets: CapturedPacket[] = []
    let linkTypes: number[] = []
    for (let offset = 0; offset + 12 <= buffer.length;) {
        const blockType = view.getUint32(offset, true)
        const blockLength = view.getUint32(offset + 4, true)
        if (blockLength < 12 || blockLength % 4 || offset + blockLength > buffer.length)
            throw new Error('Invalid pcapng block length')
        if (view.getUint32(offset + blockLength - 4, true) !== blockLength)
            throw new Error('Mismatched pcapng block trailer')
        const body = offset + 8
        if (blockType === 0x0a0d0d0a) {
            if (blockLength < 28 || view.getUint32(body, true) !== 0x1a2b3c4d)
                throw new Error('Only little-endian pcapng sections are supported')
            linkTypes = []
        }
        if (blockType === 0x00000001) {
            if (blockLength < 20) throw new Error('Truncated pcapng interface')
            linkTypes.push(view.getUint16(body, true))
        }
        if (blockType === 0x00000006) {
            if (blockLength < 32) throw new Error('Truncated pcapng packet header')
            const capturedLength = view.getUint32(body + 12, true)
            const linkType = linkTypes[view.getUint32(body, true)]
            if (linkType === undefined || capturedLength > blockLength - 32)
                throw new Error('Invalid pcapng packet interface or length')
            packets.push({
                linkType,
                data: buffer.subarray(body + 20, Math.min(body + 20 + capturedLength, buffer.length)),
                originalLength: view.getUint32(body + 16, true),
            })
        }
        offset += blockLength
    }
    return packets
}

function parseTransfer(packet: CapturedPacket): UsbTransfer | undefined {
    const headerLength =
        packet.linkType === LINKTYPE_USB_LINUX_MMAPPED ? 64 : packet.linkType === LINKTYPE_USB_LINUX ? 48 : 0
    if (!headerLength || packet.data.length < headerLength) return undefined
    const view = new DataView(packet.data.buffer, packet.data.byteOffset, packet.data.byteLength)
    const transferType = packet.data[9]
    const endpointAddress = packet.data[10]
    const length = view.getUint32(32, true)
    const capturedLength = view.getUint32(36, true)
    const data = packet.data.subarray(headerLength, headerLength + capturedLength)
    return {
        event: String.fromCharCode(packet.data[8]),
        bulk: transferType === 3,
        bulkOrInterrupt: transferType === 1 || transferType === 3,
        directionIn: (endpointAddress & 0x80) !== 0,
        endpoint: endpointAddress & 0x0f,
        device: packet.data[11],
        bus: view.getUint16(12, true),
        status: view.getInt32(28, true),
        length,
        data,
        truncated: data.length < length || data.length < capturedLength || packet.originalLength > packet.data.length,
    }
}

function commandHeader(data: Uint8Array): boolean {
    if (data.length < 12) return false
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const length = view.getUint32(0, true)
    const code = view.getUint16(6, true)
    return (
        view.getUint16(4, true) === 1 &&
        length >= 12 &&
        length <= 32 &&
        (length - 12) % 4 === 0 &&
        ((code >= 0x1000 && code <= 0x1fff) || (code >= 0x9000 && code <= 0x9fff))
    )
}

function captureDevice(transfers: UsbTransfer[]): { bus: number; address: number } {
    const candidates = new Map<string, { bus: number; address: number }>()
    const groups = new Map<string, UsbTransfer[]>()
    for (const transfer of transfers) {
        if (!transfer.bulk || transfer.device === 0) continue
        const key = `${transfer.bus}:${transfer.device}`
        const group = groups.get(key) ?? []
        group.push(transfer)
        groups.set(key, group)
    }
    for (const group of groups.values()) {
        if (!reassembleContainers(group).some(container => container.type === 1 && container.complete)) continue
        const first = group[0]
        candidates.set(`${first.bus}:${first.device}`, { bus: first.bus, address: first.device })
    }
    if (!candidates.size) throw new Error('The capture contains no recognizable PTP command traffic')
    if (candidates.size !== 1)
        throw new Error('Multiple PTP devices in capture; select an explicit USB bus and address')
    return [...candidates.values()][0]
}

interface Container {
    type: number
    code: number
    transactionId: number
    body: Uint8Array
    complete: boolean
    hostToCamera: boolean
}

function parameterWords(body: Uint8Array): number[] {
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
    const words: number[] = []
    for (let offset = 0; offset + 4 <= body.length && words.length < 5; offset += 4)
        words.push(view.getUint32(offset, true))
    return words
}

interface EndpointStream {
    bytes: Uint8Array
    poisoned: boolean
}

function incompleteContainer(hostToCamera: boolean): Container {
    return { type: 0, code: 0, transactionId: 0, body: new Uint8Array(), complete: false, hostToCamera }
}

/** Reassembles split headers and multiple containers per URB; a gap poisons that transaction. */
function reassembleContainers(transfers: UsbTransfer[]): Container[] {
    const containers: Container[] = []
    const streams = new Map<string, EndpointStream>()
    for (const transfer of transfers) {
        const carriesData = transfer.directionIn ? transfer.event === 'C' : transfer.event === 'S'
        if (!transfer.bulkOrInterrupt || !carriesData || transfer.length === 0) continue
        const key = `${transfer.directionIn ? 'in' : 'out'}:${transfer.endpoint}`
        const stream = streams.get(key) ?? { bytes: new Uint8Array(), poisoned: false }
        streams.set(key, stream)
        if (!transfer.directionIn && (stream.poisoned || stream.bytes.length === 0) && commandHeader(transfer.data)) {
            for (const existing of streams.values()) {
                existing.bytes = new Uint8Array()
                existing.poisoned = false
            }
        }
        if (stream.poisoned) continue
        const validStatus = transfer.status === 0 || (!transfer.directionIn && transfer.status === -115)
        if (
            !validStatus ||
            transfer.truncated ||
            stream.bytes.length + transfer.data.length > MAXIMUM_DATA_PHASE_BYTES + 64
        ) {
            stream.bytes = new Uint8Array()
            stream.poisoned = true
            if (transfer.bulk) containers.push(incompleteContainer(!transfer.directionIn))
            continue
        }
        const combined = new Uint8Array(stream.bytes.length + transfer.data.length)
        combined.set(stream.bytes)
        combined.set(transfer.data, stream.bytes.length)
        stream.bytes = combined
        drainContainers(stream, !transfer.directionIn, containers)
    }
    return containers
}

function drainContainers(stream: EndpointStream, hostToCamera: boolean, containers: Container[]): void {
    while (stream.bytes.length >= 12) {
        const view = new DataView(stream.bytes.buffer, stream.bytes.byteOffset, stream.bytes.byteLength)
        const length = view.getUint32(0, true)
        const type = view.getUint16(4, true)
        const code = view.getUint16(6, true)
        const validCode =
            type === 3
                ? (code >= 0x2000 && code <= 0x2fff) || (code >= 0xa000 && code <= 0xafff)
                : type === 4
                  ? (code >= 0x4000 && code <= 0x4fff) || (code >= 0xc000 && code <= 0xcfff)
                  : (code >= 0x1000 && code <= 0x1fff) || (code >= 0x9000 && code <= 0x9fff)
        const validDirection = type === 1 ? hostToCamera : type === 3 || type === 4 ? !hostToCamera : true
        const validParameters = type === 2 || (length <= 32 && (length - 12) % 4 === 0)
        if (
            length < 12 ||
            length > MAXIMUM_DATA_PHASE_BYTES + 12 ||
            type < 1 ||
            type > 4 ||
            !validCode ||
            !validDirection ||
            !validParameters
        ) {
            containers.push(incompleteContainer(hostToCamera))
            stream.bytes = new Uint8Array()
            stream.poisoned = true
            return
        }
        if (stream.bytes.length < length) return
        containers.push({
            type,
            code: view.getUint16(6, true),
            transactionId: view.getUint32(8, true),
            body: stream.bytes.slice(12, length),
            complete: true,
            hostToCamera,
        })
        stream.bytes = stream.bytes.slice(length)
    }
}

export function extractCapture(buffer: Uint8Array, address?: { bus: number; address: number }): CaptureExtraction {
    const transfers = readPackets(buffer).flatMap(packet => parseTransfer(packet) ?? [])
    const device = address ?? captureDevice(transfers)
    if (
        !Number.isInteger(device.bus) ||
        device.bus < 1 ||
        !Number.isInteger(device.address) ||
        device.address < 1 ||
        device.address > 127
    )
        throw new Error('Invalid USB bus/address selection')
    const deviceTransfers = transfers.filter(
        transfer => transfer.bus === device.bus && transfer.device === device.address
    )

    if (!deviceTransfers.length) throw new Error('Selected USB device is absent from capture')
    const transactions: CapturedTransaction[] = []
    const events: CapturedEvent[] = []
    let skippedIncomplete = 0
    let current: { command: Container; data?: Container; complete: boolean } | undefined

    for (const container of reassembleContainers(deviceTransfers)) {
        if (container.type === 0) {
            if (current) current.complete = false
            continue
        }
        if (container.type === 4) {
            if (!container.complete || container.hostToCamera) continue
            events.push({
                code: container.code,
                parameters: parameterWords(container.body),
                afterOperation: transactions.at(-1)?.operation,
            })
            continue
        }
        if (container.type === 1) {
            if (current) skippedIncomplete += 1
            current = { command: container, complete: container.complete }
            continue
        }
        if (!current || container.transactionId !== current.command.transactionId) continue
        if (container.type === 2) {
            current.complete &&=
                container.complete && container.code === current.command.code && current.data === undefined
            current.data = container
            continue
        }
        if (container.type !== 3) continue
        if (!current.complete || !container.complete || container.hostToCamera) {
            skippedIncomplete += 1
            current = undefined
            continue
        }
        const data = current.data
        transactions.push({
            operation: current.command.code,
            transactionId: current.command.transactionId,
            parameters: parameterWords(current.command.body),
            ...(data?.hostToCamera ? { dataFromHost: data.body } : {}),
            response: {
                code: container.code,
                parameters: parameterWords(container.body),
                ...(data && !data.hostToCamera ? { data: data.body } : {}),
            },
        })
        current = undefined
    }
    if (current) skippedIncomplete += 1
    return { device, transactions, events, skippedIncomplete }
}
