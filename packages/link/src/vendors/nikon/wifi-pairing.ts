import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { USBContainerBuilder, USBContainerType } from '@transport/usb/usb-container'

export interface NikonWifiPairingOptions {
    /** Explicit opt-in: protocol evidence is Nikon ZR; Z6 III remains unvalidated. */
    experimental: true
    /** Compare the supplied code with the camera display. Never approve an unseen code. */
    confirmCode: (code: string) => Promise<boolean>
    confirmationTimeoutMilliseconds?: number
}

/** Decode the Nikon 952B digit dataset; digits are numeric bytes, not ASCII. */
export function decodeNikonPairingCode(bytes: Uint8Array): string {
    if (bytes.length < 4) throw new Error('Nikon pairing code is truncated')
    const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
    if (count < 1 || count > 16 || bytes.length !== 4 + count) throw new Error('Invalid Nikon pairing code length')
    const digits = [...bytes.slice(4)]
    if (digits.some(digit => digit > 9)) throw new Error('Invalid Nikon pairing code digit')
    return digits.join('')
}

function parameter(value: number): Uint8Array {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, value, true)
    return bytes
}

async function command(transport: TransportInterface, code: number, transactionId: number, parameters: number[] = []) {
    await transport.send(USBContainerBuilder.buildCommand(code, transactionId, parameters.map(parameter)), 1, transactionId)
    let payload: Uint8Array | undefined
    for (let count = 0; count < 2; count += 1) {
        const reply = USBContainerBuilder.parseContainer(await transport.receive(1024, 1, transactionId))
        if (reply.transactionId !== transactionId) throw new Error('Nikon pairing response transaction does not match')
        if (reply.type === USBContainerType.DATA && payload === undefined && reply.code === code) {
            payload = reply.payload
            continue
        }
        if (reply.type !== USBContainerType.RESPONSE) throw new Error('Unexpected Nikon pairing response container')
        if (reply.code !== 0x2001) throw new Error(`Nikon pairing operation 0x${code.toString(16)} failed: 0x${reply.code.toString(16)}`)
        return payload
    }
    throw new Error('Nikon pairing response is missing')
}

/**
 * Pair an already selected Nikon Camera Control network profile over PTP/IP.
 * The caller must connect a fresh transport with a persisted host GUID, without opening a PTP session.
 * This does not create a network profile, activate Wi-Fi, or press confirmation on the camera.
 * Protocol is observed on Nikon ZR; compatibility with other Nikon bodies requires physical validation.
 * Protocol evidence: https://github.com/gphoto/libgphoto2/issues/1314
 * After starting the session, disconnects without CloseSession: pairing restarts camera Wi-Fi.
 */
export async function pairNikonWifiProfile(transport: TransportInterface, options: NikonWifiPairingOptions): Promise<{cameraConfirmed: true}> {
    if (options.experimental !== true) throw new Error('Nikon Wi-Fi pairing requires explicit experimental opt-in; Z6 III is unvalidated')
    const timeout = options.confirmationTimeoutMilliseconds ?? 60_000
    if (transport.getType() !== TransportType.IP) throw new Error('Nikon Wi-Fi pairing requires PTP/IP, not USB')
    if (!transport.isConnected()) throw new Error('Connect a fresh Nikon PTP/IP transport before pairing')
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 300_000) throw new Error('Nikon pairing confirmation timeout must be 1–300000 ms')
    if (!transport.on || !transport.off) throw new Error('Nikon pairing requires camera events')

    let confirmed = false
    let wake: (() => void) | undefined
    const deadline = Date.now() + timeout
    async function withinDeadline<T>(operation: () => Promise<T>, message: string): Promise<T> {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new Error(message)
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            return await Promise.race([
                operation(),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), remaining) }),
            ])
        } finally {
            if (timer) clearTimeout(timer)
        }
    }
    const onEvent = (event: {code: number}) => {
        if (event.code !== 0x4008) return
        confirmed = true
        wake?.()
    }
    transport.on(onEvent)
    try {
        await withinDeadline(() => command(transport, 0x1002, 0, [1]), 'Nikon pairing session timed out')
        const bytes = await withinDeadline(() => command(transport, 0x952b, 1), 'Nikon pairing code timed out')
        if (!bytes) throw new Error('Nikon did not return a pairing code')
        const code = decodeNikonPairingCode(bytes)
        if (!await withinDeadline(() => options.confirmCode(code), 'Nikon pairing code comparison timed out'))
            throw new Error('Nikon pairing code was not confirmed')
        // Only events after host approval can confirm this pairing attempt.
        confirmed = false
        await withinDeadline(() => command(transport, 0x935a, 2, [0x2001]), 'Nikon pairing approval timed out')
        if (!confirmed) await withinDeadline(() => new Promise<void>(resolve => { wake = resolve }),
            'Confirm the computer on the Nikon camera to finish pairing')
        return {cameraConfirmed: true}
    } finally {
        transport.off(onEvent)
        await transport.disconnect()
    }
}
