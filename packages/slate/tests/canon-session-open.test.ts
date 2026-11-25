import { Camera } from '@camera/index'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { expect, it } from 'vitest'
import { protocolSession } from '@camera/protocol-session'

function fixture(codes: number[]) {
    let connected = false
    const transport = { isLittleEndian: () => true, isConnected: () => connected, on: () => {},
        connect: async () => { connected = true }, disconnect: async () => { connected = false } } as unknown as TransportInterface
    const camera = protocolSession(new Camera({ transport, vendorId: 0x04a9, logger: { renderInTerminal: false, captureConsole: false } })).driver
    const operations: string[] = []
    camera.send = (async operation => {
        operations.push(operation.name)
        return { code: codes.shift() ?? 0x2001 }
    }) as typeof camera.send
    return { camera, operations }
}

it('rejects a failed OpenSession before issuing Canon initialization commands', async () => {
    const { camera, operations } = fixture([0x2003])
    await expect(camera.connect()).rejects.toThrow('Canon OpenSession failed')
    expect(operations).toEqual(['OpenSession'])
    expect(camera.sessionId).toBeNull()
    await camera.disconnect()
})

it('closes an acknowledged stale session and reopens once before reading device information', async () => {
    const { camera, operations } = fixture([0x201e, 0x2001, 0x2001, 0x2005])
    await expect(camera.connect()).rejects.toThrow('Canon GetDeviceInfo failed')
    expect(operations).toEqual(['OpenSession', 'CloseSession', 'OpenSession', 'GetDeviceInfo'])
    await camera.disconnect()
})

it('does not retry initialization or reset USB when stale-session close fails', async () => {
    const { camera, operations } = fixture([0x201e, 0x200f])
    await expect(camera.connect()).rejects.toThrow('stale session')
    expect(operations).toEqual(['OpenSession', 'CloseSession'])
    expect(camera.sessionId).toBeNull()
    await camera.disconnect()
})
