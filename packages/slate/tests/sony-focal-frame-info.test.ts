import { parseSonyFocalFrameInfo } from '@vendors/sony/focal-frame-info'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('parseSonyFocalFrameInfo', () => {
    it('decodes the A7 V Flexible Spot S frame set to (500, 400) on the 640×480 grid', () => {
        const data = new Uint8Array(readFileSync(new URL('./fixtures/sony-a7v-focal-frame-flexible-spot.bin', import.meta.url)))
        const info = parseSonyFocalFrameInfo(data)
        expect(info.version).toBe(104)
        expect(info.frames).toHaveLength(1)
        const [frame] = info.frames
        expect(frame.kind).toBe('focus')
        expect(frame.type).toBe(6)
        expect(frame.focused).toBe(false)
        expect(frame.centerX).toBeCloseTo(500 / 640)
        expect(frame.centerY).toBeCloseTo(400 / 480)
        expect(frame.width).toBeCloseTo(38 / 640)
        expect(frame.height).toBeCloseTo(38 / 480)
    })

    it('returns no frames for a truncated dataset', () => {
        expect(parseSonyFocalFrameInfo(new Uint8Array(10)).frames).toEqual([])
    })
})
