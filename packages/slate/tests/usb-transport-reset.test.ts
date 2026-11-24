/**
 * USBTransport's Device Reset Request against a stub WebUSB device: a bulk-IN read abandoned by a
 * transaction timeout must settle on reset without swallowing the next container. Scripted bytes,
 * not recorded camera behaviour.
 */
import { Logger } from '@core/logger'
import { USBTransport } from '@transport/usb/usb-transport'
import { describe, expect, it, vi } from 'vitest'

function response(transactionId: number, length = 12): Uint8Array {
    const bytes = new Uint8Array(length)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, length, true)
    view.setUint16(4, length === 12 ? 3 : 2, true)
    view.setUint16(6, length === 12 ? 0x2001 : 0x1001, true)
    view.setUint32(8, transactionId, true)
    return bytes
}

const inResult = (bytes: Uint8Array): USBInTransferResult =>
    ({ status: 'ok', data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) }) as USBInTransferResult

function connectedTransport() {
    const transfers: { length: number; resolve: (result: USBInTransferResult) => void }[] = []
    const device = {
        transferIn: vi.fn(
            (_endpoint: number, length: number) =>
                new Promise<USBInTransferResult>(resolve => transfers.push({ length, resolve }))
        ),
        controlTransferOut: vi.fn().mockResolvedValue({ status: 'ok', bytesWritten: 0 }),
    }
    const transport = new USBTransport(new Logger({ captureConsole: false, renderInTerminal: false }))
    Object.assign(transport, {
        device,
        connected: true,
        interfaceNumber: 0,
        endpoints: {
            bulkIn: { endpointNumber: 1 },
            bulkOut: { endpointNumber: 2 },
            interrupt: { endpointNumber: 3 },
        },
    })
    return { transport, device, transfers }
}

describe('USB Device Reset Request', () => {
    it('releases an abandoned bulk-IN read and hands its transfer to the next reader', async () => {
        const { transport, device, transfers } = connectedTransport()
        const abandoned = transport.receive(512, 1, 7)
        await Promise.resolve()
        await transport.classRequestReset()
        await expect(abandoned).rejects.toThrow(/released/)
        expect(device.controlTransferOut).toHaveBeenCalledWith(expect.objectContaining({ request: 0x66, index: 0 }))

        const next = transport.receive(512, 1, 8)
        await Promise.resolve()
        // No second transfer was queued behind the abandoned one; it delivers the next container.
        expect(device.transferIn).toHaveBeenCalledTimes(1)
        transfers[0].resolve(inResult(response(8)))
        expect(new DataView((await next).buffer).getUint32(8, true)).toBe(8)
        expect(device.transferIn).toHaveBeenCalledTimes(1)
    })

    it('keeps a late reply that arrives between readers for the next one', async () => {
        const { transport, device, transfers } = connectedTransport()
        const abandoned = transport.receive(512, 1, 7)
        await Promise.resolve()
        await transport.classRequestReset()
        await expect(abandoned).rejects.toThrow(/released/)
        transfers[0].resolve(inResult(response(7)))
        await Promise.resolve()
        // The late reply is returned (and discarded upstream by transaction ID), not lost or misrouted.
        expect(new DataView((await transport.receive(512, 1, 8)).buffer).getUint32(8, true)).toBe(7)
        const fresh = transport.receive(512, 1, 8)
        await Promise.resolve()
        expect(device.transferIn).toHaveBeenCalledTimes(2)
        transfers[1].resolve(inResult(response(8)))
        expect(new DataView((await fresh).buffer).getUint32(8, true)).toBe(8)
    })

    it('reads the rest of a container longer than the transfer it took over', async () => {
        const { transport, device, transfers } = connectedTransport()
        const abandoned = transport.receive(512, 1, 7)
        await Promise.resolve()
        await transport.classRequestReset()
        await expect(abandoned).rejects.toThrow(/released/)
        const container = response(8, 700)
        container.fill(0xab, 12)
        const next = transport.receive(4096, 1, 8)
        await Promise.resolve()
        transfers[0].resolve(inResult(container.slice(0, 512)))
        await vi.waitFor(() => expect(device.transferIn).toHaveBeenCalledTimes(2))
        expect(transfers[1].length).toBe(188)
        transfers[1].resolve(inResult(container.slice(512)))
        expect(await next).toEqual(container)
    })

    it('fails instead of silently skipping the reset when no device is open', async () => {
        const transport = new USBTransport(new Logger({ captureConsole: false, renderInTerminal: false }))
        await expect(transport.classRequestReset()).rejects.toThrow('Not connected')
    })
})
