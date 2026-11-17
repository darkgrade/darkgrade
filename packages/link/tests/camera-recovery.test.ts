import { GenericCamera } from '@camera/generic-camera'
import { Logger } from '@core/logger'
import { DeviceInfoCodec } from '@ptp/datasets/device-info-dataset'
import { createPTPRegistry } from '@ptp/registry'
import { describe, expect, it } from 'vitest'

/**
 * A USB camera that speaks just enough PTP (OpenSession, CloseSession, GetDeviceInfo) and can be
 * stuck at each level that recovery is meant to clear:
 * - 'session': it still holds a session from a host that died, and answers the first OpenSession
 *   with SessionAlreadyOpen.
 * - 'device-reset': it answers nothing until it receives the class Device Reset Request.
 * - 'port-reset': it answers nothing until its USB port is reset, after which it is briefly off the bus.
 * - 'dead': nothing brings it back.
 */
type Wedge = 'none' | 'session' | 'device-reset' | 'port-reset' | 'dead'

function wedgedCamera(wedge: Wedge, options: { absentConnects?: number } = {}) {
    const deviceInfo = new DeviceInfoCodec(createPTPRegistry(true)).encode({
        standardVersion: 100, vendorExtensionID: 0, vendorExtensionVersion: 100, vendorExtensionDesc: '', functionalMode: 0,
        operationsSupportedRaw: [0x1001, 0x1002, 0x1003], operationsSupportedDecoded: [], eventsSupportedRaw: [], eventsSupportedDecoded: [],
        devicePropertiesSupported: [], devicePropertiesSupportedDecoded: [], captureFormats: [], imageFormatsRaw: [], imageFormatsDecoded: [],
        manufacturer: 'Test', model: 'Wedge', deviceVersion: '1.0', serialNumber: '',
    } as any)
    let stuck = wedge !== 'none' && wedge !== 'session'
    let staleSession = wedge === 'session'
    let absentConnects = options.absentConnects ?? 0
    let connected = false
    const queued: Uint8Array[] = []
    const waiting: { resolve: (value: Uint8Array) => void; reject: (error: unknown) => void }[] = []
    const calls = { connect: 0, deviceResets: 0, portResets: 0, operations: [] as number[] }
    const container = (type: number, code: number, transactionId: number, payload: Uint8Array = new Uint8Array()) => {
        const bytes = new Uint8Array(12 + payload.length), view = new DataView(bytes.buffer)
        view.setUint32(0, bytes.length, true); view.setUint16(4, type, true); view.setUint16(6, code, true); view.setUint32(8, transactionId, true)
        bytes.set(payload, 12)
        return bytes
    }
    const reply = (bytes: Uint8Array) => {
        const reader = waiting.shift()
        if (reader) reader.resolve(bytes)
        else queued.push(bytes)
    }
    const transport = {
        telemetryEvidence: 'synthetic',
        getType: () => 'usb' as any,
        isLittleEndian: () => true,
        isConnected: () => connected,
        on: () => {},
        off: () => {},
        connect: async () => {
            calls.connect++
            if (absentConnects > 0) {
                absentConnects--
                throw new Error('No USB devices available')
            }
            connected = true
        },
        disconnect: async () => {
            connected = false
            for (const reader of waiting.splice(0)) reader.reject(new Error('released'))
            queued.length = 0
        },
        send: async (bytes: Uint8Array) => {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            if (view.getUint16(4, true) !== 1) return
            const code = view.getUint16(6, true), transactionId = view.getUint32(8, true)
            calls.operations.push(code)
            if (stuck) return
            if (code === 0x1002 && staleSession) {
                staleSession = false
                return reply(container(3, 0x201e, transactionId))
            }
            if (code === 0x1001) reply(container(2, code, transactionId, deviceInfo as Uint8Array<ArrayBuffer>))
            reply(container(3, 0x2001, transactionId))
        },
        receive: () => new Promise<Uint8Array>((resolve, reject) => {
            const next = queued.shift()
            if (next) resolve(next)
            else waiting.push({ resolve, reject })
        }),
        // As the real transport does, a Device Reset releases the readers left by the abandoned transaction.
        classRequestReset: async () => {
            calls.deviceResets++
            for (const reader of waiting.splice(0)) reader.reject(new Error('released'))
            if (wedge === 'device-reset') stuck = false
        },
        resetPort: async () => {
            calls.portResets++
            connected = false
            for (const reader of waiting.splice(0)) reader.reject(new Error('released'))
            if (wedge === 'port-reset') {
                stuck = false
                absentConnects = 2 // re-enumerating
            }
        },
    }
    return { transport, calls }
}

const camera = (transport: object) => new GenericCamera(transport as any, new Logger({ captureConsole: false, renderInTerminal: false } as any))
const fast = { stepTimeoutMilliseconds: 150, waitForDeviceMilliseconds: 3_000 }

describe('software camera recovery', () => {
    it('a responsive camera needs only a fresh session, and the transport is left closed', async () => {
        const { transport, calls } = wedgedCamera('none')
        const report = await camera(transport).recover(undefined, fast)
        expect(report).toMatchObject({ recovered: true, needsPhysicalAction: false, identity: { manufacturer: 'Test', model: 'Wedge', firmware: '1.0' } })
        expect(report.steps.map(step => [step.step, step.ok])).toEqual([['session', true]])
        expect(calls.deviceResets + calls.portResets).toBe(0)
        expect(transport.isConnected()).toBe(false)
    })

    it('a session left open by a host that died is closed and reopened without any reset', async () => {
        const { transport, calls } = wedgedCamera('session')
        const report = await camera(transport).recover(undefined, fast)
        expect(report.recovered).toBe(true)
        expect(report.steps.map(step => step.step)).toEqual(['session'])
        expect(calls.operations).toContain(0x1003)
        expect(calls.deviceResets + calls.portResets).toBe(0)
    })

    it('a camera stuck mid-transaction comes back with a Device Reset, before any port reset', async () => {
        const { transport, calls } = wedgedCamera('device-reset')
        const report = await camera(transport).recover(undefined, fast)
        expect(report.steps.map(step => [step.step, step.ok])).toEqual([['session', false], ['device-reset', true]])
        expect(report.recovered).toBe(true)
        expect(calls).toMatchObject({ deviceResets: 1, portResets: 0 })
    })

    it('a camera that ignores the Device Reset comes back with a port reset, waiting for it to enumerate again', async () => {
        const { transport, calls } = wedgedCamera('port-reset')
        const report = await camera(transport).recover(undefined, fast)
        expect(report.steps.map(step => [step.step, step.ok])).toEqual([['session', false], ['device-reset', false], ['port-reset', true]])
        expect(report).toMatchObject({ recovered: true, needsPhysicalAction: false })
        expect(calls.portResets).toBe(1)
    })

    it('a camera nothing in software can reach is reported as needing a physical action', async () => {
        const { transport } = wedgedCamera('dead')
        const report = await camera(transport).recover(undefined, fast)
        expect(report).toMatchObject({ recovered: false, needsPhysicalAction: true })
        expect(report.steps.map(step => step.step)).toEqual(['session', 'device-reset', 'port-reset'])
        expect(report.steps.every(step => !step.ok && step.detail)).toBe(true)
        expect(transport.isConnected()).toBe(false)
    })

    it('a camera still starting up is waited for; one that never appears needs a physical action', async () => {
        const starting = wedgedCamera('none', { absentConnects: 3 })
        expect((await camera(starting.transport).recover(undefined, fast)).recovered).toBe(true)
        const absent = wedgedCamera('none', { absentConnects: 1_000 })
        const report = await camera(absent.transport).recover(undefined, { stepTimeoutMilliseconds: 150, waitForDeviceMilliseconds: 600 })
        expect(report).toMatchObject({ recovered: false, needsPhysicalAction: true })
        expect(report.steps).toEqual([expect.objectContaining({ step: 'enumerate', ok: false, detail: 'No USB devices available' })])
    })

    it('restores the caller\'s transaction policy, so recovery leaves no shortened timeouts behind', async () => {
        const { transport } = wedgedCamera('device-reset')
        const instance = camera(transport)
        instance.configureTransactions({ timeoutMilliseconds: 12_345, deviceBusyRetries: 7 })
        await instance.recover(undefined, fast)
        expect((instance as any).channel.policy).toMatchObject({ timeoutMilliseconds: 12_345, deviceBusyRetries: 7, automaticUSBReset: true })
    })
})
