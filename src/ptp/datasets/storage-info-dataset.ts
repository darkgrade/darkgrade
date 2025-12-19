import { CustomCodec } from '@ptp/types/codec'

export interface StorageInfo {
    storageType: number
    filesystemType: number
    accessCapability: number
    maxCapacity: bigint
    freeSpaceInBytes: bigint
    freeSpaceInImages: number
    storageDescription: string
    volumeLabel: string
}

export class StorageInfoCodec extends CustomCodec<StorageInfo> {
    encode(value: StorageInfo): Uint8Array {
        const u16 = this.registry.codecs.uint16
        const u32 = this.registry.codecs.uint32
        const u64 = this.registry.codecs.uint64
        const str = this.registry.codecs.string

        const buffers: Uint8Array[] = []

        buffers.push(u16.encode(value.storageType))
        buffers.push(u16.encode(value.filesystemType))
        buffers.push(u16.encode(value.accessCapability))
        buffers.push(u64.encode(value.maxCapacity))
        buffers.push(u64.encode(value.freeSpaceInBytes))
        buffers.push(u32.encode(value.freeSpaceInImages))
        buffers.push(str.encode(value.storageDescription))
        buffers.push(str.encode(value.volumeLabel))

        const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0)
        const result = new Uint8Array(totalLength)
        let offset = 0
        for (const buffer of buffers) {
            result.set(buffer, offset)
            offset += buffer.length
        }

        return result
    }

    decode(buffer: Uint8Array, offset = 0): { value: StorageInfo; bytesRead: number } {
        const u16 = this.registry.codecs.uint16
        const u32 = this.registry.codecs.uint32
        const u64 = this.registry.codecs.uint64
        const str = this.registry.codecs.string

        let currentOffset = offset

        const storageType = u16.decode(buffer, currentOffset)
        currentOffset += storageType.bytesRead

        const filesystemType = u16.decode(buffer, currentOffset)
        currentOffset += filesystemType.bytesRead

        const accessCapability = u16.decode(buffer, currentOffset)
        currentOffset += accessCapability.bytesRead

        const maxCapacity = u64.decode(buffer, currentOffset)
        currentOffset += maxCapacity.bytesRead

        const freeSpaceInBytes = u64.decode(buffer, currentOffset)
        currentOffset += freeSpaceInBytes.bytesRead

        const freeSpaceInImages = u32.decode(buffer, currentOffset)
        currentOffset += freeSpaceInImages.bytesRead

        const storageDescription = str.decode(buffer, currentOffset)
        currentOffset += storageDescription.bytesRead

        const volumeLabel = str.decode(buffer, currentOffset)
        currentOffset += volumeLabel.bytesRead

        return {
            value: {
                storageType: storageType.value,
                filesystemType: filesystemType.value,
                accessCapability: accessCapability.value,
                maxCapacity: maxCapacity.value,
                freeSpaceInBytes: freeSpaceInBytes.value,
                freeSpaceInImages: freeSpaceInImages.value,
                storageDescription: storageDescription.value,
                volumeLabel: volumeLabel.value,
            },
            bytesRead: currentOffset - offset,
        }
    }
}
