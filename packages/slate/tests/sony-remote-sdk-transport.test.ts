import { describe, expect, it, vi } from 'vitest'
import {
    SonyRemoteSdkTransport,
    type SonyRemoteSdkChannel,
} from '../src/transport/sony-remote/sony-remote-sdk-transport'

function channel(): SonyRemoteSdkChannel & { emit: (code: number) => void } {
    let eventHandler: ((event: { code: number; transactionId: number; parameters: number[] }) => void) | undefined
    return {
        send: vi.fn(async () => undefined),
        receive: vi.fn(async () => Uint8Array.of(1, 2, 3)),
        disconnect: vi.fn(async () => undefined),
        on: handler => {
            eventHandler = handler
        },
        off: vi.fn(),
        emit: code => eventHandler?.({ code, transactionId: 1, parameters: [] }),
    }
}

describe('SonyRemoteSdkTransport', () => {
    it('delegates an authenticated SDK channel without implementing its wire protocol', async () => {
        const sdkChannel = channel()
        const createChannel = vi.fn(async () => sdkChannel)
        const transport = new SonyRemoteSdkTransport(
            {
                host: '192.0.2.10',
                username: 'user',
                password: 'secret',
                fingerprint: 'sha256:test',
            },
            createChannel
        )
        const event = vi.fn()

        await transport.connect({ ip: { host: '192.0.2.11', port: 64321 } })
        transport.on(event)
        await transport.send(Uint8Array.of(9), 1, 2)
        await expect(transport.receive(32, 1, 2)).resolves.toEqual(Uint8Array.of(1, 2, 3))
        sdkChannel.emit(0x4002)
        await transport.disconnect()

        expect(createChannel).toHaveBeenCalledWith({
            host: '192.0.2.11',
            port: 64321,
            username: 'user',
            password: 'secret',
            fingerprint: 'sha256:test',
        })
        expect(sdkChannel.send).toHaveBeenCalledWith(Uint8Array.of(9), 1, 2)
        expect(event).toHaveBeenCalledWith({ code: 0x4002, transactionId: 1, parameters: [] })
        expect(sdkChannel.disconnect).toHaveBeenCalledOnce()
        expect(transport.isConnected()).toBe(false)
    })

    it('fails clearly when used before connect', async () => {
        const transport = new SonyRemoteSdkTransport(
            { host: '192.0.2.10', username: 'user', password: 'secret' },
            async () => channel()
        )

        await expect(transport.receive(32, 1, 1)).rejects.toThrow('not connected')
    })
})
