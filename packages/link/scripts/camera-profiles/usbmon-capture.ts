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
    const magic = view.getUint32(0, true)
    if (magic === 0xa1b2c3d4 || magic === 0xa1b23c4d) {
        const linkType = view.getUint32(20, true) & 0x0fffffff
        const packets: CapturedPacket[] = []
        for (let offset = 24; offset + 16 <= buffer.length;) {
            const capturedLength = view.getUint32(offset + 8, true)
            const start = offset + 16
            if (start + capturedLength > buffer.length) break
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
        if (blockLength < 12 || offset + blockLength > buffer.length) break
        const body = offset + 8
        if (blockType === 0x0a0d0d0a) linkTypes = []
        if (blockType === 0x00000001) linkTypes.push(view.getUint16(body, true))
        if (blockType === 0x00000006) {
            const capturedLength = view.getUint32(body + 12, true)
            packets.push({
                linkType: linkTypes[view.getUint32(body, true)] ?? LINKTYPE_USB_LINUX_MMAPPED,
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
    const data = packet.data.subarray(headerLength)
    return {
        event: String.fromCharCode(packet.data[8]),
        bulkOrInterrupt: transferType === 1 || transferType === 3,
        directionIn: (endpointAddress & 0x80) !== 0,
        endpoint: endpointAddress & 0x0f,
        device: packet.data[11],
        bus: view.getUint16(12, true),
        status: view.getInt32(28, true),
        length,
        data,
        truncated: data.length < length || packet.originalLength > packet.data.length,
    }
}

function busiestDevice(transfers: UsbTransfer[]): { bus: number; address: number } {
    const counts = new Map<string, number>()
    for (const transfer of transfers) {
        if (!transfer.bulkOrInterrupt || transfer.device === 0) continue
        const key = `${transfer.bus}:${transfer.device}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const busiest = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]
    if (!busiest) throw new Error('The capture contains no bulk USB traffic')
    const [bus, address] = busiest[0].split(':').map(Number)
    return { bus: bus, address: address }
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

/** Reassembles containers per endpoint stream from the URBs that carry data. */
function reassembleContainers(transfers: UsbTransfer[]): Container[] {
    const containers: Container[] = []
    const streams = new Map<string, { expected: number; parts: Uint8Array[]; received: number; complete: boolean }>()
    for (const transfer of transfers) {
        const carriesData = transfer.directionIn ? transfer.event === 'C' : transfer.event === 'S'
        const validStatus = transfer.status === 0 || (!transfer.directionIn && transfer.status === -115)
        if (!transfer.bulkOrInterrupt || !carriesData || transfer.length === 0 || !validStatus) continue

        const key = `${transfer.directionIn ? 'in' : 'out'}:${transfer.endpoint}`
        let stream = streams.get(key)
        if (!stream || stream.received >= stream.expected) {
            if (transfer.data.length < 12) continue
            const expected = new DataView(transfer.data.buffer, transfer.data.byteOffset).getUint32(0, true)
            stream = { expected, parts: [], received: 0, complete: true }
            streams.set(key, stream)
        }
        stream.received += transfer.length
        stream.complete &&= !transfer.truncated && stream.expected - 12 <= MAXIMUM_DATA_PHASE_BYTES
        // Keep the header of an incomplete container so its transaction is recognised and skipped.
        if (stream.complete || stream.parts.length === 0) stream.parts.push(transfer.data)
        if (stream.received < stream.expected) continue

        const whole = new Uint8Array(stream.parts.reduce((total, part) => total + part.length, 0))
        stream.parts.reduce((offset, part) => (whole.set(part, offset), offset + part.length), 0)
        if (whole.length < 12) continue
        const view = new DataView(whole.buffer)
        containers.push({
            type: view.getUint16(4, true),
            code: view.getUint16(6, true),
            transactionId: view.getUint32(8, true),
            body: whole.slice(12, stream.expected),
            complete: stream.complete && whole.length >= stream.expected,
            hostToCamera: !transfer.directionIn,
        })
    }
    return containers
}

export function extractCapture(buffer: Uint8Array, address?: { bus: number; address: number }): CaptureExtraction {
    const transfers = readPackets(buffer).flatMap(packet => parseTransfer(packet) ?? [])
    const device = address ?? busiestDevice(transfers)
    const deviceTransfers = transfers.filter(
        transfer => transfer.bus === device.bus && transfer.device === device.address
    )

    const transactions: CapturedTransaction[] = []
    const events: CapturedEvent[] = []
    let skippedIncomplete = 0
    let current: { command: Container; data?: Container; complete: boolean } | undefined

    for (const container of reassembleContainers(deviceTransfers)) {
        if (container.type === 4) {
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
            current.data = container
            current.complete &&= container.complete
            continue
        }
        if (container.type !== 3) continue
        if (!current.complete || !container.complete) {
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
