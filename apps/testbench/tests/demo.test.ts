import { describe, expect, test } from 'bun:test'
import { Demo } from '../src/demo'

describe('Simulated Test Bench', () => {
    test('checks, records and stops a selected simulated take', async () => {
        let now = 1000
        const demo = new Demo(async () => {}, () => now)
        demo.select('demo-camera-3', false)
        await demo.check()
        demo.start()
        now += 3500
        demo.stop()
        expect(demo.takes).toEqual([{ id: 1, seconds: 3.5,
            cameras: ['Cinema camera', 'Mirrorless camera'], simulated: true }])
        expect(demo.recording).toBe(false)
    })
    test.each(['offline', 'busy', 'battery'] as const)('refuses a recording when a selected camera is %s', async scenario => {
        const demo = new Demo(async () => {})
        demo.setScenario(scenario)
        await expect(demo.check()).rejects.toThrow()
        expect(demo.checking).toBe(false)
        expect(demo.checked).toBe(false)
        expect(() => demo.start()).toThrow()
        demo.select('demo-camera-2', false)
        await demo.check()
        demo.start()
        demo.stop()
        expect(demo.takes[0].cameras).toHaveLength(2)
    })
    test('rejects unknown identities, unsupported settings and changes during a recording', async () => {
        const demo = new Demo(async () => {})
        expect(() => demo.camera('unknown')).toThrow()
        expect(() => demo.setting('demo-camera-1', '__proto__' as any, 'bad')).toThrow()
        expect(() => demo.setting('demo-camera-1', 'iso', 'unsupported')).toThrow()
        expect(() => demo.start()).toThrow()
        await demo.check()
        demo.start()
        expect(() => demo.setting('demo-camera-1', 'iso', '100')).toThrow()
        expect(() => demo.setScenario('offline')).toThrow()
        expect(() => demo.select('demo-camera-1', false)).toThrow()
        demo.stop()
    })
    test('reset cancels a pending check without letting it overwrite the new session', async () => {
        let finish!: () => void
        const demo = new Demo(() => new Promise<void>(resolve => { finish = resolve }))
        const check = demo.check()
        await expect(demo.check()).rejects.toThrow()
        demo.reset()
        demo.setScenario('offline')
        finish()
        await check
        expect(demo.checked).toBe(false)
        expect(demo.scenario).toBe('offline')
        expect(demo.takes).toEqual([])
    })
    test('requires a selection and invalidates checks after a changed setting', async () => {
        const demo = new Demo(async () => {})
        for (const camera of demo.cameras) demo.select(camera.label, false)
        await expect(demo.check()).rejects.toThrow('Select')
        demo.select('demo-camera-1', true)
        await demo.check()
        demo.setting('demo-camera-1', 'iso', '800')
        expect(demo.checked).toBe(false)
        expect(() => demo.start()).toThrow()
    })
})
