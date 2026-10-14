/** Published RMT-P1BT protocol: https://github.com/coral/freemote#sony-alpha-ble-remote-protocol */
export const SONY_BLUETOOTH_REMOTE_SERVICE = '8000ff00-ff00-ffff-ffff-ffffffffffff'
export const SONY_BLUETOOTH_REMOTE_COMMAND = '0000ff01-0000-1000-8000-00805f9b34fb'
export const SONY_BLUETOOTH_REMOTE_NOTIFICATION = '0000ff02-0000-1000-8000-00805f9b34fb'

export interface SonyBluetoothChannel {
    write(command: Uint8Array): Promise<void>
    delay(milliseconds: number): Promise<void>
    recording?(): Promise<boolean>
}
export type SonyBluetoothDirection = 'near' | 'far' | 'wide' | 'tele'

/** A bonded Bluetooth remote. The platform adapter owns pairing, leases and connection cleanup. */
export class SonyBluetoothRemote {
    private queue: Promise<unknown> = Promise.resolve()
    constructor(private readonly channel: SonyBluetoothChannel) {}

    private serialized(action: () => Promise<void>): Promise<void> {
        const operation = this.queue.then(action)
        this.queue = operation.catch(() => undefined)
        return operation
    }
    private duration(milliseconds: number): void {
        if (!Number.isInteger(milliseconds) || milliseconds < 50 || milliseconds > 2000)
            throw new Error('Sony Bluetooth hold must be between 50 and 2000 milliseconds')
    }
    private async button(down: number, up: number, milliseconds: number): Promise<void> {
        this.duration(milliseconds)
        try {
            await this.channel.write(Uint8Array.of(1, down))
            await this.channel.delay(milliseconds)
        } finally {
            await this.channel.write(Uint8Array.of(1, up))
        }
    }
    autofocus(milliseconds = 300): Promise<void> {
        this.duration(milliseconds)
        return this.serialized(() => this.button(0x15, 0x14, milliseconds))
    }
    customButton(milliseconds = 150): Promise<void> {
        this.duration(milliseconds)
        return this.serialized(() => this.button(0x21, 0x20, milliseconds))
    }
    capture(milliseconds = 150): Promise<void> {
        this.duration(milliseconds)
        return this.serialized(async () => {
            try {
                await this.channel.write(Uint8Array.of(1, 0x07))
                await this.channel.delay(150)
                await this.channel.write(Uint8Array.of(1, 0x09))
                await this.channel.delay(milliseconds)
            } finally {
                try {
                    await this.channel.write(Uint8Array.of(1, 0x06))
                } finally {
                    await this.channel.write(Uint8Array.of(1, 0x08))
                }
            }
        })
    }
    recordClip(milliseconds: number): Promise<void> {
        if (!Number.isInteger(milliseconds) || milliseconds < 500 || milliseconds > 10000)
            throw new Error('Sony Bluetooth clip must be between 500 and 10000 milliseconds')
        if (!this.channel.recording) throw new Error('Bluetooth recording requires camera state notifications')
        return this.serialized(async () => {
            if (await this.channel.recording!()) throw new Error('Camera is already recording')
            await this.button(0x0f, 0x0e, 150)
            try {
                if (!(await this.channel.recording!())) throw new Error('Camera did not confirm recording started')
                await this.channel.delay(milliseconds)
            } finally {
                if (await this.channel.recording!()) await this.button(0x0f, 0x0e, 150)
            }
            if (await this.channel.recording!()) throw new Error('Camera did not confirm recording stopped')
        })
    }
    move(direction: SonyBluetoothDirection, milliseconds = 150, step = 16): Promise<void> {
        this.duration(milliseconds)
        if (!Number.isInteger(step) || step < 16 || step > 127)
            throw new Error('Sony Bluetooth movement step must be between 16 and 127')
        const commands = { near: [0x6b, 0x6a], far: [0x6d, 0x6c], tele: [0x45, 0x44], wide: [0x47, 0x46] } as const
        const codes = commands[direction]
        if (!codes) throw new Error('Invalid Sony Bluetooth movement direction')
        return this.serialized(async () => {
            try {
                await this.channel.write(Uint8Array.of(2, codes[0], step))
                await this.channel.delay(milliseconds)
            } finally {
                await this.channel.write(Uint8Array.of(2, codes[1], 0))
            }
        })
    }
}
