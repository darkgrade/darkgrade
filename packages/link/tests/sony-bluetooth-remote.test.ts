import { SonyBluetoothRemote } from '@vendors/sony/bluetooth-remote'
import { describe, expect, it } from 'vitest'
function fixture(fail?: number) {
    const writes: number[][] = [],
        delays: number[] = []
    const remote = new SonyBluetoothRemote({
        write: async command => {
            writes.push([...command])
            if (writes.length === fail) throw new Error('write failed')
        },
        delay: async milliseconds => {
            delays.push(milliseconds)
        },
    })
    return { remote, writes, delays }
}
describe('Sony Bluetooth remote', () => {
    it('releases both shutter stages in the published order', async () => {
        const { remote, writes } = fixture()
        await remote.capture()
        expect(writes).toEqual([
            [1, 7],
            [1, 9],
            [1, 6],
            [1, 8],
        ])
    })
    it('releases both stages when the shutter press fails', async () => {
        const { remote, writes } = fixture(2)
        await expect(remote.capture()).rejects.toThrow()
        expect(writes).toEqual([
            [1, 7],
            [1, 9],
            [1, 6],
            [1, 8],
        ])
    })
    it('attempts full release even if half release fails', async () => {
        const { remote, writes } = fixture(3)
        await expect(remote.capture()).rejects.toThrow()
        expect(writes.at(-1)).toEqual([1, 8])
    })
    it('bounds autofocus and releases the button', async () => {
        const { remote, writes } = fixture()
        await remote.autofocus(200)
        expect(writes).toEqual([
            [1, 21],
            [1, 20],
        ])
        expect(() => remote.autofocus(10000)).toThrow()
    })
    it('serializes competing button calls', async () => {
        const { remote, writes } = fixture()
        await Promise.all([remote.capture(), remote.autofocus()])
        expect(writes).toEqual([
            [1, 7],
            [1, 9],
            [1, 6],
            [1, 8],
            [1, 21],
            [1, 20],
        ])
    })
    it('releases focus and zoom steps and rejects unbounded input', async () => {
        const { remote, writes } = fixture()
        await remote.move('tele', 100, 16)
        expect(writes).toEqual([
            [2, 69, 16],
            [2, 68, 0],
        ])
        expect(() => remote.move('near', 100, 255)).toThrow()
    })
})
