import { TransportType } from '@transport/interfaces/transport-types'
import type { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import { recordFullTransport, type TransportRecordingEntry } from '@transport/recording-transport'
import { describe, expect, it } from 'vitest'

function cameraTransport(data: Uint8Array) {
    const listeners = new Set<(event: PTPEvent) => void>()
    const source: TransportInterface = {
        connect: async () => {},
        disconnect: async () => {},
        send: async () => {},
        receive: async () => data,
        classRequestReset: async () => {},
        isConnected: () => true,
        isLittleEndian: () => true,
        getType: () => TransportType.USB,
        on: handler => {
            listeners.add(handler)
        },
        off: handler => {
            listeners.delete(handler)
        },
    }
    return {
        source,
        emit: (event: PTPEvent) => {
            for (const listener of listeners) listener(event)
        },
        listeners,
    }
}

describe('private full transport recordings', () => {
    it('retains complete large media, events, timing and independent buffer copies', async () => {
        const bytes = Buffer.alloc(2_760_930, 37)
        const camera = cameraTransport(bytes)
        const saved: TransportRecordingEntry[] = []
        const recording = recordFullTransport(camera.source, {
            write: async entry => {
                saved.push(entry)
            },
        })
        let events = 0
        recording.transport.on!(() => events++)
        await recording.transport.connect()
        await recording.transport.send(new Uint8Array([1, 2]), 1, 7)
        camera.emit({ code: 0x4002, transactionId: 7, parameters: [32] })
        const returned = await recording.transport.receive(bytes.length, 1, 7)
        returned.fill(0)
        await recording.transport.disconnect()
        expect(await recording.finish()).toMatchObject({
            complete: true,
            droppedEntries: 0,
            totalBytes: bytes.length + 2,
        })
        const media = saved.find(entry => entry.kind === 'receive')?.bytes
        expect(media?.length).toBe(bytes.length)
        expect(media?.every(value => value === 37)).toBe(true)
        expect(saved.map(entry => entry.kind)).toEqual(['connect', 'send', 'event', 'receive', 'disconnect'])
        expect(saved.every(entry => entry.finishedMilliseconds >= entry.startedMilliseconds)).toBe(true)
        expect(events).toBe(1)
        expect(camera.listeners.size).toBe(0)
    })

    it('keeps camera cleanup working when storage fails and rejects completion claims', async () => {
        const { source } = cameraTransport(new Uint8Array([1]))
        const recording = recordFullTransport(source, {
            write: async () => {
                throw new Error('disk full')
            },
        })
        await recording.transport.connect()
        await recording.transport.receive(100, 1, 1)
        await recording.transport.disconnect()
        expect(await recording.finish()).toMatchObject({ complete: false, error: 'Recording storage failed' })
    })

    it('marks capacity loss incomplete while returning the full camera payload', async () => {
        const { source } = cameraTransport(new Uint8Array(20))
        const recording = recordFullTransport(source, { maximumTotalBytes: 10, write: async () => {} })
        expect((await recording.transport.receive(20, 1, 1)).length).toBe(20)
        expect(await recording.finish()).toMatchObject({ complete: false, droppedEntries: 1 })
    })

    it('records failed operations without exposing arbitrary error text and preserves the original failure', async () => {
        const { source } = cameraTransport(new Uint8Array())
        const failure = new Error('private device information')
        source.receive = async () => {
            throw failure
        }
        const saved: TransportRecordingEntry[] = []
        const recording = recordFullTransport(source, {
            write: async entry => {
                saved.push(entry)
            },
        })
        await expect(recording.transport.receive(20, 1, 1)).rejects.toBe(failure)
        expect(await recording.finish()).toMatchObject({ complete: true })
        expect(saved[0]).toMatchObject({ kind: 'receive', failed: true, transactionId: 1 })
        expect(JSON.stringify(saved)).not.toContain(failure.message)
    })

    it('reattaches event capture after a transport disconnect clears its listeners', async () => {
        const camera = cameraTransport(new Uint8Array())
        camera.source.disconnect = async () => {
            camera.listeners.clear()
        }
        const saved: TransportRecordingEntry[] = []
        const recording = recordFullTransport(camera.source, {
            write: async entry => {
                saved.push(entry)
            },
        })
        await recording.transport.connect()
        await recording.transport.disconnect()
        await recording.transport.connect()
        camera.emit({ code: 0x4002, transactionId: 2, parameters: [3] })
        await recording.finish()
        expect(saved.filter(entry => entry.kind === 'event')).toHaveLength(1)
    })

    it('does not finish while a camera read or a storage write remains active', async () => {
        const { source } = cameraTransport(new Uint8Array())
        let finishRead!: () => void
        let finishWrite!: () => void
        source.receive = () =>
            new Promise(resolve => {
                finishRead = () => resolve(new Uint8Array([1]))
            })
        const recording = recordFullTransport(source, {
            write: () =>
                new Promise(resolve => {
                    finishWrite = resolve
                }),
        })
        const read = recording.transport.receive(1, 1, 1)
        await expect(recording.finish()).rejects.toThrow('settle')
        finishRead()
        await read
        const completion = recording.finish()
        expect(recording.status().complete).toBe(false)
        finishWrite()
        expect(await completion).toMatchObject({ complete: true })
    })
})
