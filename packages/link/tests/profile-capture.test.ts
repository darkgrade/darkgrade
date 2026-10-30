import { DeviceInfoCodec, type DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { createPTPRegistry } from '@ptp/registry'
import { TransportType, type TransportInterface } from '@transport/interfaces/transport.interface'
import { recordPtpTransport, type CapturedPtpTransaction } from '@transport/ptp-trace'
import {
    captureCameraProfile,
    redactDeviceInfoSerial,
    sanitizeProfileTransaction,
    type ProfileObservation,
} from '@vendors/profile-capture'
import { describe, expect, it } from 'vitest'
import { qualifyProfileProperty } from '@vendors/profile-qualification'

const codecs = createPTPRegistry(true).codecs
const join = (...bytes: Uint8Array[]) => new Uint8Array(bytes.flatMap(bytes => [...bytes]))
const information = new DeviceInfoCodec(createPTPRegistry(true))
const identity: DeviceInfo = {
    standardVersion: 100,
    vendorExtensionID: 0,
    vendorExtensionVersion: 100,
    vendorExtensionDesc: '',
    functionalMode: 0,
    operationsSupportedRaw: [0x1001, 0x1002, 0x1003, 0x1014],
    eventsSupportedRaw: [],
    devicePropertiesSupported: [0x5001, 0x5011],
    captureFormats: [],
    imageFormatsRaw: [],
    manufacturer: 'Bench',
    model: 'Test Body',
    deviceVersion: '1.0',
    serialNumber: 'PRIVATE_SERIAL',
    operationsSupportedDecoded: [],
    eventsSupportedDecoded: [],
    devicePropertiesSupportedDecoded: [],
    imageFormatsDecoded: [],
}
function packet(type: number, code: number, transactionId: number, data: Uint8Array = new Uint8Array()): Uint8Array {
    const bytes = new Uint8Array(12 + data.length)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, bytes.length, true)
    view.setUint16(4, type, true)
    view.setUint16(6, code, true)
    view.setUint32(8, transactionId, true)
    bytes.set(data, 12)
    return bytes
}
function fixture(refuseProperty = false) {
    const commands: number[] = []
    const replies: Uint8Array[] = []
    let connected = false
    const descriptor = join(
        codecs.uint16.encode(0x5001),
        codecs.uint16.encode(4),
        Uint8Array.of(0),
        codecs.uint16.encode(100),
        codecs.uint16.encode(75),
        Uint8Array.of(0)
    )
    const transport: TransportInterface = {
        connect: async () => {
            connected = true
        },
        disconnect: async () => {
            connected = false
        },
        isConnected: () => connected,
        isLittleEndian: () => true,
        getType: () => TransportType.USB,
        classRequestReset: async () => {
            throw new Error('Capture must not reset hardware')
        },
        send: async bytes => {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            if (view.getUint16(4, true) !== 1) throw new Error('Unexpected settings write')
            const code = view.getUint16(6, true)
            const id = view.getUint32(8, true)
            commands.push(code)
            if (code === 0x1001) replies.push(packet(2, code, id, information.encode(identity)))
            if (code === 0x1014 && !refuseProperty) replies.push(packet(2, code, id, descriptor))
            replies.push(packet(3, code === 0x1014 && refuseProperty ? 0x200a : 0x2001, id))
        },
        receive: async () => {
            const bytes = replies.shift()
            if (!bytes) throw new Error('Unexpected read')
            return bytes
        },
    }
    return { transport, commands, descriptor }
}
function transaction(operation: number, data: Uint8Array, parameters: number[] = []): CapturedPtpTransaction {
    return { operation, transactionId: 7, parameters, response: { code: 0x2001, parameters: [], data } }
}

describe('explicit profile capture', () => {
    it('records a qualified native property with independent reads and restoration after an ambiguous write', async () => {
        let current = '100', ambiguous = false
        const writes: string[] = []
        const camera = {
            registry: createPTPRegistry(true),
            send: async () => ({ code: 0x2001, data: { currentValueDecoded: current, getSet: 'GET_SET', supportedValuesDecoded: ['100', '200'] } }),
            set: async (_property: unknown, value: string) => { writes.push(value); current = value; if (ambiguous && value === '200') throw new Error('Ambiguous response') },
        }
        const passed = await qualifyProfileProperty(camera as any, 0x04b0, 0x500f, '200')
        expect(passed).toMatchObject({ property: 0x500f, passed: true, restored: true, observed: '200', restoredValue: '100' })
        ambiguous = true
        const failed = await qualifyProfileProperty(camera as any, 0x04b0, 0x500f, '200')
        expect(failed).toMatchObject({ passed: false, restored: true, error: 'Ambiguous response' })
        expect(writes).toEqual(['200', '100', '200', '100'])
        await expect(qualifyProfileProperty(camera as any, 0x04b0, 0x5011, 'private')).rejects.toThrow('allowlist')
    })
    it('retains allowlisted native write bytes without retaining unrelated payloads', () => {
        const data = join(codecs.uint32.encode(12), codecs.uint32.encode(0xd103), codecs.uint32.encode(0x50))
        const write = { operation: 0x9110, transactionId: 1, parameters: [], dataFromHost: data, response: { code: 0x2001, parameters: [] } }
        expect(sanitizeProfileTransaction(write, 0x04a9, []).dataFromHost).toBe(Buffer.from(data).toString('hex'))
        const privateWrite = { ...write, dataFromHost: join(codecs.uint32.encode(12), codecs.uint32.encode(0xd115), codecs.uint32.encode(1)) }
        expect(sanitizeProfileTransaction(privateWrite, 0x04a9, []).dataFromHost).toBeUndefined()
        expect(sanitizeProfileTransaction({ ...write, operation: 0x9205, parameters: [0xd21e, 1], dataFromHost: codecs.uint32.encode(800) }, 0x054c, []).dataFromHost).toBe('20030000')
    })
    it('captures complete identity and numeric descriptors without writes, serials or private text properties', async () => {
        const { transport, commands, descriptor } = fixture()
        const result = await captureCameraProfile(transport, { vendorId: 0x1234, productId: 1, revision: 'fixture' })
        expect(commands).toEqual([0x1002, 0x1001, 0x1014, 0x1003])
        expect(result.schema).toBe('darkgrade.ptp-trace/v1')
        expect(result.mode).toBe('read-only')
        expect(result.checks.every(check => check.status === 'pass')).toBe(true)
        expect(result.skippedIncomplete).toBe(0)
        const info = result.transactions.find(item => item.operation === 0x1001)!
        expect(information.decode(Buffer.from(info.response.data!, 'hex')).value).toEqual({
            ...identity,
            serialNumber: '',
            operationsSupportedDecoded: expect.any(Array),
            devicePropertiesSupportedDecoded: expect.any(Array),
        })
        expect(info.redactions).toEqual(['device-serial'])
        expect(result.transactions.find(item => item.operation === 0x1014)?.response.data).toBe(
            Buffer.from(descriptor).toString('hex')
        )
        expect(JSON.stringify(result)).not.toContain(Buffer.from('PRIVATE_SERIAL', 'utf16le').toString('hex'))
        expect(transport.isConnected()).toBe(false)
    })

    it('keeps camera refusals as errors and still closes its session', async () => {
        const { transport, commands } = fixture(true)
        const result = await captureCameraProfile(transport, { vendorId: 0x1234, productId: 1, revision: 'fixture' })
        expect(result.checks.find(check => check.id === 'property-0x5001')).toMatchObject({
            status: 'error',
            detail: 'Error (0x200a)',
        })
        expect(result.transactions.find(item => item.operation === 0x1014)?.response.code).toBe(0x200a)
        expect(commands.at(-1)).toBe(0x1003)
    })

    it('rejects live-view activation without explicit initialization before opening hardware', async () => {
        const { transport, commands } = fixture()
        await expect(
            captureCameraProfile(transport, { vendorId: 0x1234, productId: 1, revision: 'fixture', liveView: true })
        ).rejects.toThrow('explicit initialization')
        expect(commands).toEqual([])
    })
})

describe('retained payload privacy', () => {
    it('retains complete Sony protocol/property/control code lists but rejects trailing opaque bytes', () => {
        const data = join(
            codecs.uint16.encode(300),
            codecs.uint32.encode(1),
            codecs.uint16.encode(0x5001),
            codecs.uint32.encode(1),
            codecs.uint16.encode(0xd309)
        )
        expect(sanitizeProfileTransaction(transaction(0x9202, data), 0x054c, []).response.data).toBe(
            Buffer.from(data).toString('hex')
        )
        expect(() => sanitizeProfileTransaction(transaction(0x9202, join(data, Uint8Array.of(1))), 0x054c, [])).toThrow(
            'trailer'
        )
    })

    it('changes only the DeviceInfo serial field and rejects truncated datasets', () => {
        const original = information.encode(identity)
        const sanitized = redactDeviceInfoSerial(original)
        expect(sanitized.slice(0, -1)).toEqual(original.slice(0, sanitized.length - 1))
        expect(sanitized.at(-1)).toBe(0)
        expect(() => redactDeviceInfoSerial(original.slice(0, -1))).toThrow()
    })

    it.each([1, 2, 3])('retains the empty documented Sony connect phase %i for replay', phase => {
        const handshake = transaction(0x9201, new Uint8Array(), [phase, 0, 0])
        expect(sanitizeProfileTransaction(handshake, 0x054c, [])).toEqual({
            operation: 0x9201,
            transactionId: handshake.transactionId,
            parameters: [phase, 0, 0],
            response: { code: 0x2001, parameters: [] },
        })
    })

    it('redacts undocumented Sony connect parameters even when the response is empty', () => {
        const handshake = transaction(0x9201, new Uint8Array(), [1, 123, 0])
        expect(sanitizeProfileTransaction(handshake, 0x054c, [])).toMatchObject({
            parameters: [],
            redactions: ['authentication-payload'],
        })
    })

    it('retains only public zero-key phase acknowledgement when Sony returns an opaque unused reply', () => {
        const handshake = transaction(0x9201, Buffer.from('PRIVATE_REPLY'), [2, 0, 0])
        handshake.response.parameters = [123456]
        expect(sanitizeProfileTransaction(handshake, 0x054c, [])).toEqual({
            operation: 0x9201, transactionId: handshake.transactionId, parameters: [2, 0, 0],
            response: { code: 0x2001, parameters: [] }, redactions: ['unused-sony-handshake-reply'],
        })
    })

    it('omits media and authentication bytes, including authentication response words', () => {
        const secret = Buffer.from('PRIVATE_PASSWORD')
        const auth = transaction(0x9201, secret, [1, 123, 456])
        auth.response.parameters = [987, 654]
        const output = sanitizeProfileTransaction(auth, 0x054c, [])
        expect(output).toMatchObject({
            parameters: [],
            response: { parameters: [] },
            redactions: ['authentication-payload'],
        })
        expect(output.response.data).toBeUndefined()
        expect(sanitizeProfileTransaction(transaction(0x1009, secret), 0x054c, []).response.data).toBeUndefined()
    })

    it('retains only complete safe Canon records and omits opaque bulk event payloads', () => {
        const safe = join(
            codecs.uint32.encode(16),
            codecs.uint32.encode(0xc189),
            codecs.uint32.encode(0xd101),
            codecs.uint32.encode(0x38)
        )
        const privateRecord = join(
            codecs.uint32.encode(20),
            codecs.uint32.encode(0xc189),
            codecs.uint32.encode(0xd115),
            Buffer.from('SECRET!!')
        )
        const records: ProfileObservation[] = []
        const output = sanitizeProfileTransaction(
            transaction(0x9116, join(safe, privateRecord, new Uint8Array(8))),
            0x04a9,
            records
        )
        expect(records).toEqual([
            {
                kind: 'canon-event-record',
                operation: 0x9116,
                transactionId: 7,
                code: 0xc189,
                property: 0xd101,
                data: Buffer.from(safe).toString('hex'),
            },
        ])
        expect(output.response.data).toBeUndefined()
        expect(output.redactions).toEqual(['private-or-unscoped-payload'])
    })

    it('extracts original Sony numeric descriptors while dropping private string properties', () => {
        const safe = join(
            codecs.uint16.encode(0x5001),
            codecs.uint16.encode(4),
            Uint8Array.of(0, 1),
            codecs.uint16.encode(100),
            codecs.uint16.encode(75),
            Uint8Array.of(0)
        )
        const privateRecord = join(
            codecs.uint16.encode(0xffff),
            codecs.uint16.encode(0xffff),
            Uint8Array.of(0, 1),
            codecs.string.encode('PRIVATE_PASSWORD'),
            codecs.string.encode('PRIVATE_PASSWORD'),
            Uint8Array.of(0)
        )
        const records: ProfileObservation[] = []
        const output = sanitizeProfileTransaction(
            transaction(0x9209, join(codecs.uint32.encode(2), new Uint8Array(4), safe, privateRecord)),
            0x054c,
            records
        )
        expect(records).toEqual([
            {
                kind: 'sony-property-descriptor',
                operation: 0x9209,
                transactionId: 7,
                property: 0x5001,
                data: Buffer.from(safe).toString('hex'),
            },
        ])
        expect(output.response.data).toBeUndefined()
    })

    it('does not retain a string descriptor disguised as a numeric control', () => {
        const unsafe = join(
            codecs.uint16.encode(0x5001),
            codecs.uint16.encode(0xffff),
            Uint8Array.of(0),
            codecs.string.encode('PASSWORD'),
            codecs.string.encode('PASSWORD'),
            Uint8Array.of(0)
        )
        expect(() => sanitizeProfileTransaction(transaction(0x1014, unsafe, [0x5001]), 0x054c, [])).toThrow(
            'numeric control'
        )
    })
})

describe('complete transaction observation', () => {
    it('preserves request words, uploaded bytes and response words independently', async () => {
        const accepted: CapturedPtpTransaction[] = []
        const source = fixture().transport
        source.send = async () => undefined
        source.receive = async () => packet(3, 0x2001, 7, codecs.uint32.encode(99))
        const trace = recordPtpTransport(source, value => accepted.push(value))
        await trace.transport.send(packet(1, 0x1016, 7, codecs.uint32.encode(0x500f)), 1, 7)
        await trace.transport.send(packet(2, 0x1016, 7, codecs.uint16.encode(800)), 1, 7)
        await trace.transport.receive(512, 1, 7)
        expect(accepted).toEqual([
            {
                operation: 0x1016,
                transactionId: 7,
                parameters: [0x500f],
                dataFromHost: codecs.uint16.encode(800),
                response: { code: 0x2001, parameters: [99] },
            },
        ])
    })

    it('does not upgrade a truncated data phase to a complete response-only exchange', async () => {
        const accepted: CapturedPtpTransaction[] = []
        const source = fixture().transport
        source.send = async () => undefined
        const truncated = packet(2, 0x1001, 7, new Uint8Array(20)).slice(0, -1)
        const replies = [truncated, packet(3, 0x2001, 7)]
        source.receive = async () => replies.shift()!
        const trace = recordPtpTransport(source, value => accepted.push(value))
        await trace.transport.send(packet(1, 0x1001, 7), 1, 7)
        await trace.transport.receive(512, 1, 7)
        await trace.transport.receive(512, 1, 7)
        expect(accepted).toEqual([])
        expect(trace.skippedIncomplete()).toBe(1)
    })
})
