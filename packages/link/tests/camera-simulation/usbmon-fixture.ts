/** Builders for synthetic usbmon captures (pcapng, LINKTYPE_USB_LINUX_MMAPPED) used by the capture tests. */
/** One LINKTYPE_USB_LINUX_MMAPPED record; `length` is the URB length, `data` what usbmon kept. */
export function urb(
    event: 'S' | 'C',
    endpoint: number,
    data: Uint8Array,
    options: { length?: number; type?: number } = {}
) {
    const record = new Uint8Array(64 + data.length)
    const view = new DataView(record.buffer)
    record[8] = event.charCodeAt(0)
    record[9] = options.type ?? 3
    record[10] = endpoint
    record[11] = 7
    view.setUint16(12, 2, true)
    view.setInt32(28, event === 'S' ? -115 : 0, true)
    view.setUint32(32, options.length ?? data.length, true)
    view.setUint32(36, data.length, true)
    record.set(data, 64)
    return record
}

export function container(
    type: number,
    code: number,
    transactionId: number,
    words: number[] = [],
    payload = new Uint8Array()
) {
    const bytes = new Uint8Array(12 + words.length * 4 + payload.length)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, bytes.length, true)
    view.setUint16(4, type, true)
    view.setUint16(6, code, true)
    view.setUint32(8, transactionId, true)
    words.forEach((word, index) => view.setUint32(12 + index * 4, word, true))
    bytes.set(payload, 12 + words.length * 4)
    return bytes
}

export function pcapng(records: Uint8Array[]): Uint8Array {
    const blocks: Uint8Array[] = []
    const block = (type: number, body: Uint8Array) => {
        const bytes = new Uint8Array(12 + Math.ceil(body.length / 4) * 4)
        const view = new DataView(bytes.buffer)
        view.setUint32(0, type, true)
        view.setUint32(4, bytes.length, true)
        bytes.set(body, 8)
        view.setUint32(bytes.length - 4, bytes.length, true)
        blocks.push(bytes)
    }
    const sectionHeader = new Uint8Array(16)
    new DataView(sectionHeader.buffer).setUint32(0, 0x1a2b3c4d, true)
    block(0x0a0d0d0a, sectionHeader)
    const interfaceDescription = new Uint8Array(8)
    new DataView(interfaceDescription.buffer).setUint16(0, 220, true)
    block(1, interfaceDescription)
    for (const record of records) {
        const body = new Uint8Array(20 + record.length)
        const view = new DataView(body.buffer)
        view.setUint32(12, record.length, true)
        view.setUint32(16, record.length, true)
        body.set(record, 20)
        block(6, body)
    }
    const output = new Uint8Array(blocks.reduce((total, part) => total + part.length, 0))
    blocks.reduce((offset, part) => (output.set(part, offset), offset + part.length), 0)
    return output
}
