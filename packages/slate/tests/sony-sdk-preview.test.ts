import type { SonySdkProperty } from '@vendors/sony/sdk-camera'
import { decodeSonyMonitoringFormat, sonyPreviewCapabilities } from '@vendors/sony/sdk-preview'
import { describe, expect, it } from 'vitest'

function packed(quality: number, codec: number, resolution: number, rate: number, bitrate = 800) {
    const fields = [quality, codec, resolution, rate, bitrate]
    return fields.reduce((value, field, index) => value | (BigInt(field) << BigInt(index * 8)), 0n).toString()
}
function property(code: number, value: string, allowedValues?: string[]): SonySdkProperty {
    return { code, name: String(code), type: 4, value, writable: false, allowedValues }
}
describe('Sony SDK preview capabilities', () => {
    it('decodes JPEG dimensions, rate and bitrate from the SDK format', () => {
        expect(decodeSonyMonitoringFormat(packed(1, 1, 3, 1))).toMatchObject({
            qualityLevel: 1,
            codec: 'jpeg',
            width: 640,
            height: 360,
            framesPerSecond: 7.5,
            megabitsPerSecond: 8,
            variableResolution: false,
        })
    })
    it('preserves codec distinctions and the variable-resolution bit', () => {
        const value = (BigInt(packed(3, 2, 7, 6)) | (1n << 47n)).toString()
        const h264 = { codec: 'h264', width: 1920, height: 1080, framesPerSecond: 30, variableResolution: true }
        expect(decodeSonyMonitoringFormat(value)).toMatchObject(h264)
        expect(decodeSonyMonitoringFormat(packed(5, 3, 6, 5))?.codec).toBe('h265')
    })
    it('rejects invalid, unknown and oversized descriptors', () => {
        const invalid = ['-1', '0', '1.5', '1e9', '18446744073709551616']
        for (const value of [...invalid, packed(1, 4, 3, 1), packed(6, 1, 3, 1), packed(1, 1, 99, 1)])
            expect(decodeSonyMonitoringFormat(value)).toBeUndefined()
    })
    it('does not infer support or delivery from missing properties', () => {
        const none = { monitoring: 'not-advertised', delivering: null, preferredJpegFormat: null, formats: [] }
        expect(sonyPreviewCapabilities([])).toMatchObject(none)
    })
    it('prefers the best advertised JPEG without treating H264 as JPEG', () => {
        const [low, high, h264] = [packed(1, 1, 3, 1), packed(2, 1, 5, 6), packed(3, 2, 7, 6)]
        const result = sonyPreviewCapabilities([
            property(1928, '1'),
            property(1956, low, [low, high, h264]),
            property(1955, low, [low, high]),
            property(1927, '0'),
        ])
        expect(result.formats).toHaveLength(3)
        expect(result.preferredJpegFormat?.value).toBe(high)
        expect(result.delivering).toBe(false)
    })
    it('does not select formats that are supported but unavailable in the current mode', () => {
        const result = sonyPreviewCapabilities([property(1928, '1'), property(1956, packed(3, 1, 7, 6))])
        expect(result.formats).toHaveLength(1)
        expect(result.preferredJpegFormat).toBeNull()
    })
    it('does not invent enumerated formats from a numeric range', () => {
        const range = { ...property(1956, packed(1, 1, 3, 1), ['1', '2', '3']), valueForm: 'range' as const }
        expect(sonyPreviewCapabilities([range]).formats).toEqual([])
    })
})
