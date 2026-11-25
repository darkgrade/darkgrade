import { Camera } from '@camera/index'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { expect, it } from 'vitest'
import { protocolSession } from '@camera/protocol-session'

function fixture() {
    let connected = true
    const resets: string[] = []
    const transport = { isLittleEndian: () => true, isConnected: () => connected, on: () => {},
        connect: async () => { connected = true }, disconnect: async () => { connected = false },
        classRequestReset: async () => { resets.push('device') }, resetPort: async () => { resets.push('port') },
    } as unknown as TransportInterface
    const camera = protocolSession(new Camera({ transport, vendorId: 0x04a9, logger: { renderInTerminal: false, captureConsole: false } })).driver
    const operations: string[] = []
    let remoteCode = 0x2001
    camera.send = (async operation => {
        operations.push(operation.name)
        if (operation.name === 'CanonSetRemoteMode') return { code: remoteCode }
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: {
            manufacturer: 'Canon', model: 'USB camera', deviceVersion: 'fixture', operationsSupportedRaw: [],
        } }
        if (operation.name === 'CanonGetEventData') return { code: 0x2001, data: [] }
        return { code: 0x2001 }
    }) as typeof camera.send
    return { camera, operations, resets, remoteFailure: () => { remoteCode = 0x2003 } }
}

it('recovery waits for the owned poller, verifies EOS controls and leaves them closed without resets', async () => {
    const { camera, operations, resets } = fixture()
    const state = camera as any
    let finish!: () => void
    state.polling = true
    state.pollingLoop = new Promise<void>(resolve => { finish = resolve })
    const recovery = camera.recover(undefined, { allowPortReset: false })
    await Promise.resolve()
    expect(state.polling).toBe(false)
    expect(operations).toEqual([])
    finish()
    const report = await recovery
    expect(report.recovered).toBe(true)
    expect(operations.indexOf('GetDeviceInfo')).toBeLessThan(operations.lastIndexOf('CanonGetEventData'))
    expect(operations.slice(-3)).toEqual(['CanonSetRemoteMode', 'CanonSetEventMode', 'CloseSession'])
    expect(resets).toEqual([])
    expect(state.polling).toBe(false)
})

it('a readable identity cannot hide Canon remote-control failure during recovery', async () => {
    const { camera, remoteFailure, resets } = fixture()
    remoteFailure()
    const report = await camera.recover(undefined, { allowPortReset: false, stepTimeoutMilliseconds: 1000 })
    expect(report.recovered).toBe(false)
    expect(report.needsPhysicalAction).toBe(true)
    expect(report.steps.every(step => !step.ok)).toBe(true)
    expect(resets).toEqual(['device'])
})

it('recovery preserves the Canon session convention used by normal connection', async () => {
    const { camera, resets } = fixture()
    const send = camera.send.bind(camera)
    const sessions: number[] = []
    camera.send = (async (operation, parameters, ...rest) => {
        if (operation.name === 'OpenSession') sessions.push((parameters as { SessionID: number }).SessionID)
        if (operation.name.startsWith('Canon') && camera.sessionId !== 1) return { code: 0x2003 }
        return send(operation, parameters, ...rest)
    }) as typeof camera.send
    const report = await camera.recover(undefined, { allowPortReset: false })
    expect(report.recovered).toBe(true)
    expect(sessions).toEqual([1])
    expect(resets).toEqual([])
})
