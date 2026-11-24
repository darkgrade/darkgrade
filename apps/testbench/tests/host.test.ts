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
test('the host consumes the confirmed write result without another capability refresh', async () => {
    const { bench, camera } = fixtureBench()
    const { id } = (await bench.scan()).cameras[0]
    await bench.action(id, 'connect')
    const capabilities = await camera.getCapabilities()
    camera.getCapabilities = async () => { throw Error('Host reread the full capability inventory') }
    camera.setControl = async () => ({ ...capabilities.controls.iso!, value: '200' })
    await bench.action(id, 'setting', 'iso', '200')
    expect(bench.state().cameras[0]?.controls.iso?.value).toBe('200')
    await bench.close()
})
test('ambiguous recording start cannot be retried, reset or disconnected before a confirmed stop', async () => {
    const { bench, camera } = fixtureBench()
    const { id } = (await bench.scan()).cameras[0]
    await bench.action(id, 'connect')
    camera.failStart = true
    await expect(bench.action(id, 'start')).rejects.toThrow('reply lost')
    expect(bench.state().cameras[0].recording).toBe('uncertain')
    for (const action of ['connect', 'start', 'disconnect', 'recover', 'photo'] as const)
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
    const { bench, camera } = fixtureBench()
    const { id } = (await bench.scan()).cameras[0]
    await bench.action(id, 'connect')
    const original = camera.getCapabilities.bind(camera)
    let reads = 0
    camera.getCapabilities = async () => {
        if (++reads === 2) throw Error('observation failed')
        return original()
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
test('successful Slate recovery reconnects its closed transport before reading controls', async () => {
    const { bench, camera } = fixtureBench()
    const { id } = (await bench.scan()).cameras[0]
    await bench.action(id, 'connect')
    let closed = false
    camera.recover = async () => { camera.calls.push('recover'); closed = true; return { recovered: true } }
    const connect = camera.connect.bind(camera), read = camera.getCapabilities.bind(camera)
    camera.connect = async () => { await connect(); closed = false }
    camera.getCapabilities = async () => { if (closed) throw Error('transport closed'); return read() }
    await bench.action(id, 'recover')
    expect(bench.state().cameras[0].connected).toBe(true)
    expect(camera.calls).toEqual(['connect', 'recover', 'connect'])
    await bench.close()
})
test.each([0x054c, 0x04b0, 0x04a9])('vendor %s uses Slate capabilities and preserves shutter-angle labels', async vendorId => {
    const { adapter, camera } = fixtureBench()
    adapter.discover = async () => [{ vendorId, productId: 1, model: 'USB camera' }]
    const read = camera.getCapabilities.bind(camera)
    camera.getCapabilities = async () => {
        const capabilities = await read()
        capabilities.controls.shutterSpeed = { ...capabilities.controls.iso!, id: 'shutterSpeed',
            label: 'Shutter speed', value: '180°', allowedValues: ['90°', '180°'],
            exposureTime: { kind: 'angle', degrees: 180 } }
        return capabilities
    }
    const bench = new LocalBench(adapter, 'fixture')
    const { id } = (await bench.scan()).cameras[0]
    await bench.action(id, 'connect')
    expect(bench.state().cameras[0].controls.shutterSpeed).toEqual({ value: '180°', choices: ['90°', '180°'], enabled: true })
    await bench.action(id, 'setting', 'iso', '200')
    expect(camera.value).toBe('200')
    await bench.close()
})
test('missing, read-only, empty and disabled controls never gain fallback choices', async () => {
    const { bench, camera } = fixtureBench()
    const { id } = (await bench.scan()).cameras[0]
    await bench.action(id, 'connect')
    await expect(bench.action(id, 'setting', 'aperture', 'f/4')).rejects.toThrow('writable')
    await expect(bench.action(id, 'setting', 'whiteBalance', 'Daylight')).rejects.toThrow('writable')
    const read = camera.getCapabilities.bind(camera)
    for (const state of [{ allowedValues: [] }, { enabled: false }, { writable: false }]) {
        camera.getCapabilities = async () => {
            const capabilities = await read()
            Object.assign(capabilities.controls.iso!, state)
            return capabilities
        }
        await expect(bench.action(id, 'setting', 'iso', '100')).rejects.toThrow('writable')
    }
    expect(camera.calls).toEqual(['connect'])
    await bench.close()
})
test('recording mode stays owned until stop, and failed restoration retries without another stop command', async () => {
    const { bench, camera } = fixtureBench()
    const { id } = (await bench.scan()).cameras[0]
    let restores = 0
    camera.prepareRecordingMode = async () => {
        camera.calls.push('prepare')
        return { restore: async () => { if (++restores === 1) throw Error('mode restore failed') } }
    }
    await bench.action(id, 'connect')
    await bench.action(id, 'start')
    expect(restores).toBe(0)
    await expect(bench.action(id, 'stop')).rejects.toThrow('mode restore failed')
    await expect(bench.action(id, 'disconnect')).rejects.toThrow('Stop and confirm')
    await bench.action(id, 'stop')
    expect(restores).toBe(2)
    expect(camera.calls.filter(call => call === 'stop')).toHaveLength(1)
    expect(bench.state().cameras[0].recording).toBe('idle')
    await bench.close()
})
