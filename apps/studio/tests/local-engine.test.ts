import { LocalEngine } from '@main/models/local-engine'
import type { LocalServerProcess } from '@main/models/local-server'
import { describe, expect, it } from 'vitest'

function engine() {
    const events: string[] = []
    let nextPort = 9000
    let gate: Promise<void> = Promise.resolve()
    let begun: () => void = () => {}
    const local = new LocalEngine({
        start: async key => {
            events.push(`start ${key}`)
            begun()
            await gate
            const server = { port: nextPort++, stop: async () => void events.push(`stop ${key}`) }
            return server as unknown as LocalServerProcess
        },
        stopped: () => events.push('stopped'),
    })
    /** Holds the next start once it has begun, until `go`. */
    const hold = () => {
        let go!: () => void
        gate = new Promise(resolve => (go = resolve))
        const started = new Promise<void>(resolve => (begun = resolve))
        return { go, started }
    }
    return { local, events, hold }
}

describe('local model engines', () => {
    it('starts once for callers asking together, and reuses the running engine', async () => {
        const { local, events } = engine()
        const ports = await Promise.all([local.prepare('a'), local.prepare('a')])
        expect(ports).toEqual([9000, 9000])
        expect(await local.prepare('a')).toBe(9000)
        expect(events).toEqual(['start a'])
    })

    it('releases the loaded model before starting another, and a release waits for a start under way', async () => {
        const { local, events, hold } = engine()
        await local.prepare('a')
        expect(await local.prepare('b')).toBe(9001)
        const { go, started } = hold()
        const starting = local.prepare('c')
        await started
        const released = local.release()
        go()
        await Promise.all([starting, released])
        expect(events).toEqual(['start a', 'stop a', 'stopped', 'start b', 'stop b', 'stopped', 'start c', 'stop c', 'stopped'])
        expect(local.port).toBeNull()
    })

    it('starts again after its process stopped by itself', async () => {
        const { local, events } = engine()
        await local.prepare('a')
        local.lost()
        expect(await local.prepare('a')).toBe(9001)
        expect(events).toEqual(['start a', 'start a'])
    })
})
