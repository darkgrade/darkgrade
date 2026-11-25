/**
 * A Sony content list (Camera Control PTP 3, ContentInfoList) in the wire layout
 * `parseSonyContentInfoList` reads, for simulated bodies. The repository has no encoder for it.
 */
export interface SimulatedSonyContent {
    contentId: number
    createdLocalMs: number
    files: { fileId: number; path: string; size: number; video?: boolean }[]
}

export function sonyContentList(slot: number, contents: SimulatedSonyContent[]): Uint8Array {
    const parts: Uint8Array[] = []
    const view = (bytes: number, write: (data: DataView) => void) => {
        const data = new Uint8Array(bytes)
        write(new DataView(data.buffer))
        parts.push(data)
    }
    const u16 = (value: number) => view(2, data => data.setUint16(0, value, true))
    const u32 = (value: number) => view(4, data => data.setUint32(0, value, true))
    const u64 = (value: number) => view(8, data => data.setBigUint64(0, BigInt(value), true))
    const zeros = (bytes: number) => parts.push(new Uint8Array(bytes))
    u16(1)
    u16(0)
    u64(Date.UTC(2026, 10, 24))
    zeros(128)
    u32(slot)
    u32(contents.length)
    for (const content of contents) {
        u32(1)
        u32(content.contentId)
        zeros(16)
        u32(1)
        u64(content.createdLocalMs)
        u64(content.createdLocalMs)
        u64(content.createdLocalMs)
        u64(content.createdLocalMs)
        u32(0)
        u32(0)
        u32(0)
        u32(0)
        u32(content.files.length)
        for (const file of content.files) {
            const path = new TextEncoder().encode(`${file.path}\0`)
            u16(file.fileId)
            u16(0)
            u32(path.length)
            parts.push(path)
            u32(file.video ? 0xb982 : 0x3801)
            u64(file.size)
            zeros(32)
            u32(1)
            u32(file.video ? 3840 : 7008)
            u32(file.video ? 2160 : 4672)
            u32(file.video ? 1 : 0)
            if (file.video) for (let word = 0; word < 19; word++) u32(word === 5 ? 3840 : word === 6 ? 2160 : 0)
            u32(0)
        }
    }
    const wire = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
    let offset = 0
    for (const part of parts) {
        wire.set(part, offset)
        offset += part.length
    }
    return wire
}
