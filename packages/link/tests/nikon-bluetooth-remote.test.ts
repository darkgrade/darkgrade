import {describe, expect, it, vi} from 'vitest'
import {NikonBluetoothRemote, type NikonBluetoothKey} from '@vendors/nikon/bluetooth-remote'

function fixture() {
    const channel = {assertReady: vi.fn().mockResolvedValue(undefined), write: vi.fn().mockResolvedValue(undefined), delay: vi.fn().mockResolvedValue(undefined)}
    return {channel, remote: new NikonBluetoothRemote(channel)}
}

describe('experimental Nikon remote button protocol', () => {
    it.each<[NikonBluetoothKey, number]>([
        ['up',0x11],['down',0x12],['right',0x13],['left',0x14],['ok',0x0f],
        ['fn1',0x20],['fn2',0x21],['shutter',0x02],['record',0x03],['zoomIn',0x28],['zoomOut',0x29],
    ])('encodes %s with a matching release', async (key, button) => {
        const {remote,channel} = fixture()
        await remote.press(key)
        expect(channel.assertReady).toHaveBeenCalledOnce()
        expect(channel.write.mock.calls.map(([bytes]) => [...bytes])).toEqual([[button,2],[button,0]])
        expect(channel.delay).toHaveBeenCalledWith(150)
    })
    it('refuses an unready session before writing', async () => {
        const {remote,channel} = fixture()
        channel.assertReady.mockRejectedValue(new Error('No remote handshake'))
        await expect(remote.press('fn2')).rejects.toThrow('No remote handshake')
        expect(channel.write).not.toHaveBeenCalled()
    })
    it('attempts release after a partially delivered failed press', async () => {
        const {remote,channel} = fixture()
        channel.write.mockRejectedValueOnce(new Error('Delivery unknown'))
        await expect(remote.press('right')).rejects.toThrow('Delivery unknown')
        expect(channel.write.mock.calls.map(([bytes]) => [...bytes])).toEqual([[0x13,2],[0x13,0]])
    })
    it('serializes buttons through release', async () => {
        const {remote,channel} = fixture()
        let release!: () => void
        channel.delay.mockImplementationOnce(() => new Promise<void>(resolve => {release=resolve}))
        const first = remote.press('fn2'), second = remote.press('down')
        await vi.waitFor(() => expect(channel.delay).toHaveBeenCalledOnce())
        expect(channel.write).toHaveBeenCalledTimes(1)
        release(); await Promise.all([first,second])
        expect(channel.write.mock.calls.map(([bytes]) => [...bytes])).toEqual([[0x21,2],[0x21,0],[0x12,2],[0x12,0]])
    })
    it('blocks queued input when release cannot be confirmed', async () => {
        const {remote,channel} = fixture()
        channel.write.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Link lost'))
        const outcomes = await Promise.allSettled([remote.press('up'),remote.press('ok')])
        expect(outcomes.every(result => result.status==='rejected')).toBe(true)
        expect(channel.write).toHaveBeenCalledTimes(2)
        expect(channel.assertReady).toHaveBeenCalledOnce()
    })
    it('validates the button before any queued operation', () => {
        const {remote,channel} = fixture()
        expect(() => remote.press('menu' as NikonBluetoothKey)).toThrow('Unsupported')
        expect(channel.assertReady).not.toHaveBeenCalled()
    })
})
