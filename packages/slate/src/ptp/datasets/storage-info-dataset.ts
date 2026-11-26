import { concatenateBytes, SequentialReader } from '@ptp/datasets/codecs/byte-sequence'
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
        const { uint16, uint32, uint64, string } = this.registry.codecs
        return concatenateBytes([
            uint16.encode(value.storageType),
            uint16.encode(value.filesystemType),
            uint16.encode(value.accessCapability),
            uint64.encode(value.maxCapacity),
            uint64.encode(value.freeSpaceInBytes),
            uint32.encode(value.freeSpaceInImages),
            string.encode(value.storageDescription),
            string.encode(value.volumeLabel),
        ])
    }

    decode(buffer: Uint8Array, offset = 0): { value: StorageInfo; bytesRead: number } {
        const { uint16, uint32, uint64, string } = this.registry.codecs
        const reader = new SequentialReader(buffer, offset)
        const value: StorageInfo = {
            storageType: reader.read(uint16),
            filesystemType: reader.read(uint16),
            accessCapability: reader.read(uint16),
            maxCapacity: reader.read(uint64),
            freeSpaceInBytes: reader.read(uint64),
            freeSpaceInImages: reader.read(uint32),
            storageDescription: reader.read(string),
            volumeLabel: reader.read(string),
        }
        return { value, bytesRead: reader.bytesRead }
    }
}
