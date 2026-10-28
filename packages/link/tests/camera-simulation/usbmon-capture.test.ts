import { extractCapture } from '@scripts/camera-profiles/usbmon-capture'
import { describe, expect, it } from 'vitest'
import { container, pcapng, urb } from './usbmon-fixture'

describe('usbmon capture extraction', () => {
    const deviceInfo = Uint8Array.from({ length: 40 }, (_, index) => index)
    const dataContainer = container(2, 0x1001, 1, [], deviceInfo)
    const capture = pcapng([
        urb('S', 0x01, container(1, 0x1001, 1)),
        urb('C', 0x81, dataContainer.subarray(0, 30)),
        urb('C', 0x81, dataContainer.subarray(30)),
        urb('C', 0x81, container(3, 0x2001, 1)),
        urb('S', 0x02, container(1, 0x1016, 2, [0x5005])),
        urb('S', 0x02, container(2, 0x1016, 2, [], Uint8Array.of(4, 0))),
        urb('C', 0x81, container(3, 0x2001, 2)),
        urb('C', 0x83, container(4, 0x4006, 0, [0x5005]), { type: 1 }),
        urb('S', 0x01, container(1, 0x1008, 3, [0xabc])),
        // usbmon kept only part of this data phase, so the transaction is skipped.
        urb('C', 0x81, container(2, 0x1008, 3, [], new Uint8Array(32)).subarray(0, 20), { length: 44 }),
        urb('C', 0x81, container(3, 0x2001, 3)),
    ])

    it('keeps complete transactions with every byte, in both data directions', () => {
        const extraction = extractCapture(capture)
        expect(extraction.device).toEqual({ bus: 2, address: 7 })
        expect(extraction.transactions).toHaveLength(2)
        const [info, set] = extraction.transactions
        expect(info).toMatchObject({ operation: 0x1001, parameters: [], response: { code: 0x2001, data: deviceInfo } })
        expect(set).toMatchObject({ operation: 0x1016, parameters: [0x5005], dataFromHost: Uint8Array.of(4, 0) })
        expect(set.response.data).toBeUndefined()
    })

    it('records events after the preceding operation and skips truncated phases', () => {
        const extraction = extractCapture(capture)
        expect(extraction.events).toEqual([{ code: 0x4006, parameters: [0x5005], afterOperation: 0x1016 }])
        expect(extraction.skippedIncomplete).toBe(1)
    })
})
