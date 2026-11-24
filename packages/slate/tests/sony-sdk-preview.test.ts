import type { SonySdkProperty } from '@vendors/sony/sdk-camera'
import { decodeSonyMonitoringFormat, sonyPreviewCapabilities } from '@vendors/sony/sdk-preview'
import { describe, expect, it } from 'vitest'

function packed(quality: number, codec: number, resolution: number, rate: number, bitrate = 800) {
    return (
        BigInt(quality) |
        (BigInt(codec) << 8n) |
        (BigInt(resolution) << 16n) |
        (BigInt(rate) << 24n) |
        (BigInt(bitrate) << 32n)
    ).toString()
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
        expect(decodeSonyMonitoringFormat(value)).toMatchObject({
            codec: 'h264',
            width: 1920,
            height: 1080,
            framesPerSecond: 30,
            variableResolution: true,
        })
        expect(decodeSonyMonitoringFormat(packed(5, 3, 6, 5))?.codec).toBe('h265')
    })
    it('rejects invalid, unknown and oversized descriptors', () => {
        for (const value of [
            '-1',
            '0',
            '1.5',
            '1e9',
            '18446744073709551616',
            packed(1, 4, 3, 1),
            packed(6, 1, 3, 1),
            packed(1, 1, 99, 1),
        ])
            expect(decodeSonyMonitoringFormat(value)).toBeUndefined()
    })
    it('does not infer support or delivery from missing properties', () => {
        expect(sonyPreviewCapabilities([])).toMatchObject({
            monitoring: 'not-advertised',
            delivering: null,
            preferredJpegFormat: null,
            formats: [],
        })
    })
    it('prefers the best advertised JPEG without treating H264 as JPEG', () => {
        const low = packed(1, 1, 3, 1),
            high = packed(2, 1, 5, 6),
            h264 = packed(3, 2, 7, 6)
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
        expect(
            sonyPreviewCapabilities([{ ...property(1956, packed(1, 1, 3, 1), ['1', '2', '3']), valueForm: 'range' }])
                .formats
        ).toEqual([])
    })
})
