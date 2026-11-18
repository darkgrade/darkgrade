import { test, expect } from 'bun:test'
import { fixtureBench } from './fixture'
import { LocalBench } from '../server/host'

test('scan is passive; connect and advertised settings use the generic camera', async () => {
    const { bench, camera } = fixtureBench()
    const { id } = (await bench.scan()).cameras[0]
    expect(camera.calls).toEqual([])
    await bench.action(id, 'connect')
    await expect(bench.action(id, 'setting', 'iso', '800')).rejects.toThrow('advertised')
    await bench.action(id, 'setting', 'iso', '200')
    expect(camera.calls).toEqual(['connect', 'set:200'])
    await bench.close()
})
test('ambiguous recording start cannot be retried, reset or disconnected before a confirmed stop', async () => {
    const { bench, camera } = fixtureBench()
    const { id } = (await bench.scan()).cameras[0]
    await bench.action(id, 'connect')
    camera.failStart = true
    await expect(bench.action(id, 'start')).rejects.toThrow('reply lost')
    expect(bench.state().cameras[0].recording).toBe('uncertain')
    for (const action of ['start', 'disconnect', 'recover', 'photo'] as const)
        await expect(bench.action(id, action)).rejects.toThrow('Stop and confirm')
    expect(camera.calls.filter(call => call === 'start')).toHaveLength(1)
    await bench.action(id, 'stop')
    await bench.close()
})
test('shutdown stays behind an in-flight connection and releases it after completion', async () => {
    const { bench, camera } = fixtureBench()
    const { id } = (await bench.scan()).cameras[0]
    let finish!: () => void
    camera.wait = new Promise(resolve => { finish = resolve })
    const connecting = bench.action(id, 'connect')
    await Promise.resolve(); await Promise.resolve()
    const closing = bench.close()
    expect(camera.calls).not.toContain('disconnect')
    finish()
    await connecting; await closing
    expect(camera.calls).toEqual(['connect', 'disconnect'])
})
test('a completed write with failed readback is preserved and never repeated automatically', async () => {
    const { bench, camera, adapter } = fixtureBench()
    const { id } = (await bench.scan()).cameras[0]
    await bench.action(id, 'connect')
    const original = adapter.controls!
    let reads = 0
    adapter.controls = async (...args) => {
        if (++reads === 2) throw Error('observation failed')
        return original(...args)
    }
    await expect(bench.action(id, 'setting', 'iso', '200')).rejects.toThrow('write completed')
    expect(camera.calls.filter(call => call.startsWith('set:'))).toEqual(['set:200'])
    expect(camera.value).toBe('200')
    await bench.close()
})
test('duplicate USB identities never cause a camera to be picked arbitrarily', async () => {
    const { adapter, camera } = fixtureBench()
    const device = { vendorId: 1, productId: 2, model: 'USB camera' }
    adapter.discover = async () => [device, device]
    const bench = new LocalBench(adapter, 'fixture')
    const { id } = (await bench.scan()).cameras[0]
    await expect(bench.action(id, 'connect')).rejects.toThrow('unique USB identity')
    expect(camera.calls).toEqual([])
})
test('a failed connection closes its attempt and can be connected explicitly after the device returns', async () => {
    const { bench, camera } = fixtureBench()
    const { id } = (await bench.scan()).cameras[0]
    const connect = camera.connect.bind(camera)
    camera.connect = async () => { camera.calls.push('connect'); throw Error('Camera was unplugged') }
    await expect(bench.action(id, 'connect')).rejects.toThrow('unplugged')
    expect(bench.state().cameras[0].connected).toBe(false)
    expect(camera.calls).toEqual(['connect', 'disconnect'])
    camera.connect = connect
    await bench.action(id, 'connect')
    await bench.close()
    expect(camera.calls).toEqual(['connect', 'disconnect', 'connect', 'disconnect'])
})
