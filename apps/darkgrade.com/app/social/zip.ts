/**
 * A minimal ZIP writer ("stored", no compression): PNGs are already deflated,
 * so compressing them again would only cost time. Lets "Download all" hand over
 * one file instead of seven separate downloads, which browsers often block.
 */

export interface ZipEntry {
    readonly name: string
    readonly bytes: Uint8Array
}

const CRC_TABLE: Uint32Array = (() => {
    const table = new Uint32Array(256)
    for (let index = 0; index < 256; index++) {
        let value = index
        for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
        table[index] = value >>> 0
    }
    return table
})()

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff
    for (let index = 0; index < bytes.length; index++) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
}

function toDosDateTime(date: Date): { time: number; day: number } {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    return { time, day }
}

export function createZipBytes(entries: readonly ZipEntry[], modified: Date = new Date()): Uint8Array<ArrayBuffer> {
    const encoder = new TextEncoder()
    const { time, day } = toDosDateTime(modified)
    const localParts: Uint8Array[] = []
    const centralParts: Uint8Array[] = []
    let offset = 0

    for (const entry of entries) {
        const name = encoder.encode(entry.name)
        const checksum = crc32(entry.bytes)

        const local = new DataView(new ArrayBuffer(30))
        local.setUint32(0, 0x04034b50, true)
        local.setUint16(4, 20, true) // version needed
        local.setUint16(6, 0x0800, true) // flags: names are UTF-8
        local.setUint16(8, 0, true) // method: stored
        local.setUint16(10, time, true)
        local.setUint16(12, day, true)
        local.setUint32(14, checksum, true)
        local.setUint32(18, entry.bytes.length, true)
        local.setUint32(22, entry.bytes.length, true)
        local.setUint16(26, name.length, true)
        local.setUint16(28, 0, true)
        localParts.push(new Uint8Array(local.buffer), name, entry.bytes)

        const central = new DataView(new ArrayBuffer(46))
        central.setUint32(0, 0x02014b50, true)
        central.setUint16(4, 20, true) // version made by
        central.setUint16(6, 20, true) // version needed
        central.setUint16(8, 0x0800, true)
        central.setUint16(10, 0, true)
        central.setUint16(12, time, true)
        central.setUint16(14, day, true)
        central.setUint32(16, checksum, true)
        central.setUint32(20, entry.bytes.length, true)
        central.setUint32(24, entry.bytes.length, true)
        central.setUint16(28, name.length, true)
        central.setUint32(42, offset, true)
        centralParts.push(new Uint8Array(central.buffer), name)

        offset += 30 + name.length + entry.bytes.length
    }

    const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, 0x06054b50, true)
    end.setUint16(8, entries.length, true)
    end.setUint16(10, entries.length, true)
    end.setUint32(12, centralSize, true)
    end.setUint32(16, offset, true)

    const parts = [...localParts, ...centralParts, new Uint8Array(end.buffer)]
    const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let position = 0
    for (const part of parts) {
        output.set(part, position)
        position += part.length
    }
    return output
}
