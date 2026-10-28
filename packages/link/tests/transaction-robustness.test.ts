/**
 * Regression tests for failures a misbehaving camera or cable produces: stalls, broken container
 * framing, late replies, DeviceBusy storms, malformed datasets and vanished transports. Each test
 * scripts the exact bytes on a stub transport; none of this is recorded camera behaviour.
 */
import { CanonCamera } from '@camera/canon-camera'
import { GenericCamera } from '@camera/generic-camera'
import { Camera } from '@camera/index'
import { Logger } from '@core/logger'
import {
    PTPDecodeError,
    PTPDisconnectedError,
    PTPProtocolError,
    PTPResponseError,
    PTPTimeoutError,
} from '@core/ptp-errors'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { createNikonRegistry } from '@ptp/registry'
import type { OperationDefinition } from '@ptp/types/operation'
import { TransportType } from '@transport/interfaces/transport-types'
import type { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import { IPTransport } from '@transport/ip/ip-transport'
import { describe, expect, it } from 'vitest'

const CONTAINER = { command: 1, data: 2, response: 3, event: 4 }

function container(type: number, code: number, transactionId: number, payload: ArrayLike<number> = []): Uint8Array {
    const bytes = new Uint8Array(12 + payload.length)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, bytes.length, true)
    view.setUint16(4, type, true)
    view.setUint16(6, code, true)
    view.setUint32(8, transactionId, true)
    bytes.set(Array.from(payload), 12)
    return bytes
}

const ok = (transactionId: number) => container(CONTAINER.response, 0x2001, transactionId)

interface Command {
    operation: number
    transactionId: number
    parameters: number[]
}

/** Answers each command with whatever `reply` returns; `'stall'` never answers until a reset. */
type Reply = (command: Command, index: number) => Uint8Array[] | 'stall'

class ScriptedTransport implements TransportInterface {
    readonly commands: Command[] = []
    readonly sent: Uint8Array[] = []
    resets = 0
    connected = true
    private queue: Uint8Array[] = []
    private stalled: ((error: Error) => void)[] = []
    private handler?: (event: PTPEvent) => void

    constructor(private readonly reply: Reply) {}

    async connect(): Promise<void> {
        this.connected = true
    }
    async disconnect(): Promise<void> {
        this.connected = false
    }
    isConnected(): boolean {
        return this.connected
    }
    getType(): TransportType {
        return TransportType.USB
    }
    isLittleEndian(): boolean {
        return true
    }
    on(handler: (event: PTPEvent) => void): void {
        this.handler = handler
    }
    off(): void {
        this.handler = undefined
    }
    emit(event: PTPEvent): void {
        this.handler?.(event)
    }

    async classRequestReset(): Promise<void> {
        this.resets++
        this.queue = []
        for (const reject of this.stalled.splice(0)) reject(new Error('cancelled by device reset'))
    }

    async send(data: Uint8Array): Promise<void> {
        if (!this.connected) throw new Error('stub transport is not connected')
        this.sent.push(data)
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        if (view.getUint16(4, true) !== CONTAINER.command) return
        const parameters: number[] = []
        for (let offset = 12; offset + 4 <= data.length; offset += 4) parameters.push(view.getUint32(offset, true))
        const command = { operation: view.getUint16(6, true), transactionId: view.getUint32(8, true), parameters }
        this.commands.push(command)
        const answer = this.reply(command, this.commands.length - 1)
        this.queue = answer === 'stall' ? [] : [...this.queue, ...answer]
        if (answer === 'stall') this.queue.push(new Uint8Array(0))
    }

    async receive(): Promise<Uint8Array> {
        const next = this.queue.shift()
        if (next === undefined) throw new Error('stub transport has nothing queued')
        if (next.length === 0) return new Promise((_, reject) => this.stalled.push(reject))
        return next
    }
}

const quietLogger = () => new Logger({ renderInTerminal: false, captureConsole: false })

function cameraOn(reply: Reply, policy = { timeoutMilliseconds: 50, deviceBusyBackoffMilliseconds: 1 }) {
    const transport = new ScriptedTransport(reply)
    const camera = new GenericCamera(transport, quietLogger())
    camera.configureTransactions(policy)
    return { camera, transport, operations: camera.registry.operations }
}

/** A DeviceInfo dataset with every list empty and the given model string. */
function deviceInfo(model = 'Stub'): number[] {
    const string = (text: string) =>
        text.length === 0
            ? [0]
            : [text.length + 1, ...[...text].flatMap(character => [character.charCodeAt(0), 0]), 0, 0]
    const emptyArray = [0, 0, 0, 0]
    return [
        100,
        0, // StandardVersion
        0,
        0,
        0,
        0, // VendorExtensionID
        0,
        0, // VendorExtensionVersion
        ...string(''),
        0,
        0, // FunctionalMode
        ...emptyArray,
        ...emptyArray,
        ...emptyArray,
        ...emptyArray,
        ...emptyArray,
        ...string('Stub'),
        ...string(model),
        ...string('1.0'),
        ...string('1'),
    ]
}

describe('transaction timeouts', () => {
    it('turns a stalled camera into PTPTimeoutError and keeps the transaction queue usable', async () => {
        const { camera, transport, operations } = cameraOn((command, index) =>
            index === 0
                ? 'stall'
                : [container(CONTAINER.data, 0x1001, command.transactionId, deviceInfo()), ok(command.transactionId)]
        )
        await expect(camera.send(operations.GetDeviceInfo, {})).rejects.toBeInstanceOf(PTPTimeoutError)
        const response = await camera.send(operations.GetDeviceInfo, {})
        expect(response.code).toBe(0x2001)
        expect(response.data?.model).toBe('Stub')
        // The device was returned to idle before the next transaction (USB still-image Device Reset Request).
        expect(transport.resets).toBe(1)
    })
})

describe('container framing', () => {
    it('rejects a container shorter than its declared length', async () => {
        const { camera, operations } = cameraOn(command => [
            container(CONTAINER.data, 0x1001, command.transactionId, deviceInfo()).slice(0, 20),
            ok(command.transactionId),
        ])
        const failure = camera.send(operations.GetDeviceInfo, {})
        await expect(failure).rejects.toBeInstanceOf(PTPProtocolError)
        await expect(failure).rejects.toMatchObject({ violation: 'truncated-container' })
    })

    it('ignores bytes after the declared container length', async () => {
        const { camera, operations } = cameraOn(command => [
            Uint8Array.from([
                ...container(CONTAINER.data, 0x1001, command.transactionId, deviceInfo('Oversized')),
                0xee,
                0xee,
            ]),
            ok(command.transactionId),
        ])
        const response = await camera.send(operations.GetDeviceInfo, {})
        expect(response.data?.model).toBe('Oversized')
    })

    it('rejects a reply for a transaction that has not happened yet, including 0xFFFFFFFF', async () => {
        for (const offset of [1, 1000]) {
            const { camera, operations } = cameraOn(command => [ok(command.transactionId + offset)])
            await expect(camera.send(operations.CloseSession, {})).rejects.toMatchObject({
                violation: 'transaction-mismatch',
            })
        }
        const { camera, operations } = cameraOn(() => [ok(0xffffffff)])
        await expect(camera.send(operations.CloseSession, {})).rejects.toMatchObject({
            violation: 'transaction-mismatch',
        })
    })

    it('discards a late reply from an earlier transaction and returns this transaction’s reply', async () => {
        const { camera, operations } = cameraOn(command => [
            ok(command.transactionId - 1),
            container(CONTAINER.data, 0x1001, command.transactionId, deviceInfo('Late')),
            ok(command.transactionId),
        ])
        await camera.send(operations.OpenSession, { SessionID: 1 }).catch(() => undefined)
        const response = await camera.send(operations.GetDeviceInfo, {})
        expect(response.code).toBe(0x2001)
        expect(response.data?.model).toBe('Late')
    })

    it('accepts transaction 0 only on a CloseSession response (Leica behaviour noted in libgphoto2)', async () => {
        const { camera, operations } = cameraOn(() => [ok(0)])
        expect((await camera.send(operations.CloseSession, {})).code).toBe(0x2001)
        await expect(camera.send(operations.PowerDown, {})).rejects.toMatchObject({ violation: 'transaction-mismatch' })
    })

    it('rejects a data container where the response belongs, and an event container in the data phase', async () => {
        const typedAsData = cameraOn(command => [container(CONTAINER.data, 0x2001, command.transactionId)])
        await expect(typedAsData.camera.send(typedAsData.operations.CloseSession, {})).rejects.toMatchObject({
            violation: 'unexpected-container-type',
        })
        const typedAsEvent = cameraOn(command => [
            container(CONTAINER.event, 0x1001, command.transactionId, deviceInfo()),
        ])
        await expect(typedAsEvent.camera.send(typedAsEvent.operations.GetDeviceInfo, {})).rejects.toMatchObject({
            violation: 'unexpected-container-type',
        })
    })

    it('reports a dataset that overruns its container as PTPDecodeError after draining the response', async () => {
        const broken = deviceInfo()
        broken[8] = 0xff // VendorExtensionDesc claims 255 characters
        const { camera, transport, operations } = cameraOn(command =>
            command.operation === 0x1001
                ? [container(CONTAINER.data, 0x1001, command.transactionId, broken), ok(command.transactionId)]
                : [ok(command.transactionId)]
        )
        await expect(camera.send(operations.GetDeviceInfo, {})).rejects.toBeInstanceOf(PTPDecodeError)
        expect((await camera.send(operations.CloseSession, {})).code).toBe(0x2001)
        expect(transport.commands.map(command => command.transactionId)).toEqual([1, 2])
    })
})

describe('DeviceBusy', () => {
    it('retries standard operations with backoff until the camera is ready', async () => {
        const { camera, transport, operations } = cameraOn((command, index) =>
            index < 3 ? [container(CONTAINER.response, 0x2019, command.transactionId)] : [ok(command.transactionId)]
        )
        expect((await camera.send(operations.InitiateCapture, {})).code).toBe(0x2001)
        // Every retry is a new transaction with the next transaction ID.
        expect(transport.commands.map(command => command.transactionId)).toEqual([1, 2, 3, 4])
    })

    it('returns DeviceBusy when a storm outlasts the retries', async () => {
        const { camera, transport, operations } = cameraOn(command => [
            container(CONTAINER.response, 0x2019, command.transactionId),
        ])
        expect((await camera.send(operations.InitiateCapture, {})).code).toBe(0x2019)
        expect(transport.commands).toHaveLength(5)
    })

    it('leaves vendor operations alone: their busy answers carry vendor meaning', async () => {
        const { camera, transport } = cameraOn(command => [
            container(CONTAINER.response, 0x2019, command.transactionId),
        ])
        const vendorOperation = {
            code: 0x9128,
            name: 'VendorRelease',
            description: 'test',
            dataDirection: 'none',
            operationParameters: [],
            responseParameters: [],
        } as const satisfies OperationDefinition
        expect((await camera.send(vendorOperation, {})).code).toBe(0x2019)
        expect(transport.commands).toHaveLength(1)
    })
})

describe('local failures and vanished transports', () => {
    it('refuses a data-in operation without data before sending its command or spending a transaction ID', async () => {
        const { camera, transport, operations } = cameraOn(command => [ok(command.transactionId)])
        await expect(camera.send(operations.SetDevicePropValue, { DevicePropCode: 0x5005 })).rejects.toThrow(
            'Data required'
        )
        expect(transport.sent).toHaveLength(0)
        await camera.send(operations.CloseSession, {})
        expect(transport.commands[0]?.transactionId).toBe(1)
    })

    it('raises PTPDisconnectedError without spending a transaction ID when the transport is gone', async () => {
        const { camera, transport, operations } = cameraOn(command => [ok(command.transactionId)])
        transport.connected = false
        await expect(camera.send(operations.GetDeviceInfo, {})).rejects.toBeInstanceOf(PTPDisconnectedError)
        transport.connected = true
        await camera.send(operations.CloseSession, {})
        expect(transport.commands[0]?.transactionId).toBe(1)
    })

    it('disconnects cleanly, more than once, after the camera has vanished', async () => {
        const { camera, transport } = cameraOn(command => [ok(command.transactionId)])
        camera.sessionId = 7
        transport.connected = false
        await expect(camera.disconnect()).resolves.toBeUndefined()
        await expect(camera.disconnect()).resolves.toBeUndefined()
        expect(camera.sessionId).toBeNull()
    })

    it('disconnects a Canon camera whose transport is already gone without sending', async () => {
        const transport = new ScriptedTransport(command => [ok(command.transactionId)])
        const canon = new CanonCamera(transport, quietLogger())
        transport.connected = false
        await expect(canon.disconnect()).resolves.toBeUndefined()
        expect(transport.sent).toHaveLength(0)
    })
})

describe('session and responses', () => {
    it('fails connect() with PTPResponseError when OpenSession is refused', async () => {
        const { camera } = cameraOn(command => [container(CONTAINER.response, 0x2002, command.transactionId)])
        await expect(camera.connect()).rejects.toBeInstanceOf(PTPResponseError)
        expect(camera.sessionId).toBeNull()
    })

    it('reports a busy GetDeviceInfo during property listing as PTPResponseError, not a TypeError', async () => {
        const { camera } = cameraOn(command => [container(CONTAINER.response, 0x2019, command.transactionId)], {
            timeoutMilliseconds: 50,
            deviceBusyBackoffMilliseconds: 1,
        })
        await expect(camera.getStandardPropertyStates()).rejects.toBeInstanceOf(PTPResponseError)
    })

    it('passes the transaction policy from Camera options to the vendor camera', async () => {
        const transport = new ScriptedTransport(() => 'stall')
        const camera = new Camera({
            transport,
            logger: { renderInTerminal: false, captureConsole: false },
            transactionPolicy: { timeoutMilliseconds: 20 },
        })
        await expect(camera.send(camera.getInstance().registry.operations.GetDeviceInfo, {})).rejects.toBeInstanceOf(
            PTPTimeoutError
        )
    })
})

describe('dataset decoding', () => {
    it('keeps a descriptor usable when the camera reports a value the enum codec does not know', () => {
        // Nikon LiveViewStatus (0xD1B8) is a UINT8 enumeration of 0 and 1; the camera reports 7.
        const descriptor = Uint8Array.of(0xb8, 0xd1, 0x02, 0x00, 0x01, 0x00, 0x07, 0x02, 0x03, 0x00, 0x00, 0x01, 0x07)
        const decoded = new DevicePropDescCodec(createNikonRegistry(true)).decode(descriptor).value
        expect(decoded.currentValueDecoded).toBe(7)
        expect(decoded.supportedValuesDecoded).toEqual(['OFF', 'ON', 7])
        expect(decoded.factoryDefaultValue).toBe(0)
    })
})

describe('library objects stay out of the host process', () => {
    it('an IPTransport created without a logger installs no process-wide handlers', () => {
        const before = process.listenerCount('uncaughtException') + process.listenerCount('unhandledRejection')
        new IPTransport({ address: '127.0.0.1' })
        new IPTransport({ address: '127.0.0.1' })
        expect(process.listenerCount('uncaughtException') + process.listenerCount('unhandledRejection')).toBe(before)
    })
})
