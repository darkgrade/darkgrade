export const NIKON_BLUETOOTH_REMOTE_SERVICE = '0000de00-3dd4-4255-8d62-6dc7b9bd5561'
export const NIKON_BLUETOOTH_REMOTE_COMMAND = '00002083-3dd4-4255-8d62-6dc7b9bd5561'

export interface NikonBluetoothChannel {
    /** Verify the normal remote application handshake, camera identity and current ownership. */
    assertReady(): Promise<void>
    write(command: Uint8Array): Promise<void>
    delay(milliseconds: number): Promise<void>
}

const buttons = {
    shutter: 0x02, record: 0x03, ok: 0x0f,
    up: 0x11, down: 0x12, right: 0x13, left: 0x14,
    fn1: 0x20, fn2: 0x21, zoomIn: 0x28, zoomOut: 0x29,
} as const
export type NikonBluetoothKey = keyof typeof buttons

/**
 * @experimental
 * ML-L7 button protocol; not yet physically validated on the Z6 III.
 * Requires an already established normal remote session, not a diagnostic advertiser.
 * Fn buttons retain their camera assignments; command delivery does not prove a menu,
 * lens, focus or recording state change. Pairing and transport handoff belong to the adapter.
 */
export class NikonBluetoothRemote {
    private queue: Promise<unknown> = Promise.resolve()
    private releaseUnconfirmed = false
    constructor(private readonly channel: NikonBluetoothChannel) {}

    press(key: NikonBluetoothKey, milliseconds = 150): Promise<void> {
        if (!Object.hasOwn(buttons, key)) throw new Error('Unsupported Nikon Bluetooth button')
        if (!Number.isInteger(milliseconds) || milliseconds < 50 || milliseconds > 1000)
            throw new Error('Nikon Bluetooth hold must be between 50 and 1000 milliseconds')
        const operation = this.queue.then(() => this.pressAndRelease(buttons[key], milliseconds))
        this.queue = operation.catch(() => undefined)
        return operation
    }

    private async pressAndRelease(button: number, milliseconds: number): Promise<void> {
        if (this.releaseUnconfirmed) throw new Error('Nikon Bluetooth release is unconfirmed; reconnect before further buttons')
        await this.channel.assertReady()
        let failed = false, failure: unknown
        try {
            await this.channel.write(Uint8Array.of(button, 2))
            await this.channel.delay(milliseconds)
        } catch (error) {
            failed = true
            failure = error
        } finally {
            try {
                await this.channel.write(Uint8Array.of(button, 0))
            } catch (error) {
                this.releaseUnconfirmed = true
                throw new AggregateError(failed ? [failure, error] : [error], 'Nikon Bluetooth release is unconfirmed')
            }
        }
        if (failed) throw failure
    }
}
