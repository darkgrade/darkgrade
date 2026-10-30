/**
 * Definitions added from test-bench captures (EOS R6 Mark III, Z6 III) and from libgphoto2's
 * camlibs/ptp2 tables. Byte strings marked "captured" are the exact wire values recorded on the
 * darkgrade test bench; the rest check the shapes the cited libgphoto2 helpers use.
 */
import { Camera } from '@camera/index'
import { VendorExtensionCamera } from '@camera/vendor-extension-camera'
import { Logger } from '@core/logger'
import { NikonEventListCodec } from '@ptp/datasets/vendors/nikon/nikon-event-list-dataset'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { createCanonRegistry, createNikonRegistry, createSonyRegistry } from '@ptp/registry'
import { TransportType } from '@transport/interfaces/transport-types'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it } from 'vitest'

/** Records command containers and answers every transaction with OK. */
function recordingTransport(dataReplies: Map<number, Uint8Array> = new Map()) {
    const commands: number[][] = []
    const dataPhases: Uint8Array[] = []
    let pending: Uint8Array[] = []
    const transport: TransportInterface = {
        connect: async () => undefined,
        disconnect: async () => undefined,
        isConnected: () => true,
        classRequestReset: async () => undefined,
        getType: () => TransportType.USB,
        isLittleEndian: () => true,
        send: async data => {
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
            const transactionId = view.getUint32(8, true)
            if (view.getUint16(4, true) === 2) {
                dataPhases.push(data.slice(12))
                return
            }
            const words = [view.getUint16(6, true)]
            for (let offset = 12; offset < data.length; offset += 4) words.push(view.getUint32(offset, true))
            commands.push(words)
            const response = new Uint8Array(12)
            const responseView = new DataView(response.buffer)
            responseView.setUint32(0, 12, true)
            responseView.setUint16(4, 3, true)
            responseView.setUint16(6, 0x2001, true)
            responseView.setUint32(8, transactionId, true)
            const dataReply = dataReplies.get(words[0])
            if (dataReply) {
                const container = new Uint8Array(12 + dataReply.length)
                const header = new DataView(container.buffer)
                header.setUint32(0, container.length, true)
                header.setUint16(4, 2, true)
                header.setUint16(6, words[0], true)
                header.setUint32(8, transactionId, true)
                container.set(dataReply, 12)
                pending = [container, response]
            } else pending = [response]
        },
        receive: async () => pending.shift()!,
    }
    return { transport, commands, dataPhases }
}

function cameraFor(vendorId: number) {
    const recorded = recordingTransport()
    const camera = new Camera({
        transport: recorded.transport,
        vendorId,
        logger: { renderInTerminal: false, captureConsole: false },
    })
    return { ...recorded, camera, registry: camera.getInstance().registry }
}

describe('Canon EOS definitions', () => {
    const registry = createCanonRegistry(true)
    const remoteMode = registry.operations.CanonSetRemoteMode.operationParameters[0].codec(registry)

    it('reads the captured R6 III folder record without inventing a decoder or additional selectors', async () => {
        const bytes = Uint8Array.from(Buffer.from('14000000000020a33130304d5344434600000000', 'hex'))
        const recorded = recordingTransport(new Map([[0x9195, bytes]]))
        const camera = new Camera({
            transport: recorded.transport,
            vendorId: VendorIDs.CANON,
            logger: { renderInTerminal: false, captureConsole: false },
        })
        const response = await camera.send(registry.operations.CanonGetFolderRecord, { Selector: 'OBSERVED_FOLDER' })
        expect(recorded.commands).toEqual([[0x9195, 1]])
        expect(response.code).toBe(0x2001)
        expect(response.data).toEqual(bytes)
        expect(recorded.dataPhases).toEqual([])
    })

    it('expresses CanonSetRemoteMode 5 (captured on EOS R6 Mark III) and 0x15 (libgphoto2 EOS M default)', () => {
        expect(remoteMode.decode(Uint8Array.of(0x05, 0, 0, 0)).value).toBe('MODE_0x05')
        expect(remoteMode.decode(Uint8Array.of(0x15, 0, 0, 0)).value).toBe('MODE_0x15')
        expect(remoteMode.decode(Uint8Array.of(0x11, 0, 0, 0)).value).toBe('MODE_0x11')
        expect([...remoteMode.encode('MODE_0x05')]).toEqual([0x05, 0, 0, 0])
        expect([...remoteMode.encode('ENABLE')]).toEqual([0x01, 0, 0, 0])
    })

    it('expresses the EOS M combined release CanonRemoteReleaseOn [3, 0] that libgphoto2 sends', () => {
        const releaseMode = registry.operations.CanonRemoteReleaseOn.operationParameters[0].codec(registry)
        expect([...releaseMode.encode('FOCUS_AND_SHUTTER')]).toEqual([0x03, 0, 0, 0])
        expect(releaseMode.decode(Uint8Array.of(0x03, 0, 0, 0)).value).toBe('FOCUS_AND_SHUTTER')
    })

    it('sends the captured R6 Mark III requests byte for byte', async () => {
        const { camera, commands, registry: canon } = cameraFor(VendorIDs.CANON)
        const operations = canon.operations as ReturnType<typeof createCanonRegistry>['operations']
        await camera.send(operations.CanonGetCameraSupport, {
            Selector: 0x10000,
            PropertyCode: 0x80000518,
            Reserved: 0,
        })
        await camera.send(operations.CanonSetUILock, { Reserved: 0 })
        await camera.send(operations.CanonResetUILock, {})
        await camera.send(operations.CanonGetRemoteErrLogMode, {})
        await camera.send(operations.CanonGetDebugLogEx, { Selector: 0 })
        await camera.send(operations.CanonSetRemoteMode, { RemoteMode: 'MODE_0x05' })
        expect(commands).toEqual([
            [0x913f, 0x10000, 0x80000518, 0],
            [0x911b, 0],
            [0x911c],
            [0x917c],
            [0x917d, 0],
            [0x9114, 5],
        ])
    })

    it('registers the libgphoto2-named EOS operations with their helper parameter counts', () => {
        const parameterCount = (name: keyof typeof registry.operations) =>
            registry.operations[name].operationParameters.filter(parameter => parameter?.required).length
        expect(registry.operations.CanonRemoteRelease.code).toBe(0x910f)
        expect(parameterCount('CanonTransferComplete')).toBe(1)
        expect(parameterCount('CanonPCHDDCapacity')).toBe(3)
        expect(parameterCount('CanonSetRequestOLCInfoGroup')).toBe(1)
        expect(parameterCount('CanonInitiateViewfinder')).toBe(0)
        expect(registry.operations.CanonTerminateViewfinder.code).toBe(0x9152)
    })
})

describe('Nikon definitions', () => {
    const registry = createNikonRegistry(true)

    it('decodes the GetEvent queue (UINT16 count, then UINT16 code + UINT32 parameter entries)', () => {
        const codec = new NikonEventListCodec(registry)
        const bytes = Uint8Array.of(0x02, 0x00, 0x02, 0x40, 0x01, 0x00, 0x00, 0x00, 0x06, 0x40, 0x0f, 0x50, 0x00, 0x00)
        expect(codec.decode(bytes)).toEqual({
            value: [
                { code: 0x4002, parameter: 1 },
                { code: 0x4006, parameter: 0x500f },
            ],
            bytesRead: 14,
        })
        expect(codec.encode(codec.decode(bytes).value)).toEqual(bytes)
        expect(codec.decode(Uint8Array.of(0, 0)).value).toEqual([])
        expect(() => codec.decode(Uint8Array.of(0x03, 0x00, 0x02, 0x40))).toThrow('declares 3 events')
    })

    it('registers SDRAM capture, legacy live view and event operations with libgphoto2 data directions', () => {
        const { operations } = registry
        expect([operations.InitiateCaptureRecInSdram.code, operations.InitiateCaptureRecInSdram.dataDirection]).toEqual(
            [0x90c0, 'none']
        )
        expect([operations.GetEvent.code, operations.GetEvent.dataDirection]).toEqual([0x90c7, 'out'])
        expect([operations.StartLiveView.code, operations.EndLiveView.code]).toEqual([0x9201, 0x9202])
        expect([operations.GetLiveViewImg.code, operations.GetLiveViewImg.dataDirection]).toEqual([0x9203, 'out'])
        expect(operations.InitiateCaptureRecInMedia.code).toBe(0x9207)
        expect(operations.GetObjectSize.code).toBe(0x9421)
    })

    it('sends the captured Z6 III wireless requests byte for byte', async () => {
        const { camera, commands, dataPhases, registry: nikon } = cameraFor(VendorIDs.NIKON)
        const operations = nikon.operations as ReturnType<typeof createNikonRegistry>['operations']
        const authenticate = operations.WirelessAuthenticate
        const password = camera.getInstance().resolveCodec(authenticate.dataCodec).encode('')
        await camera.send(operations.GetWirelessHardwareType, {})
        await camera.send(operations.GetSupportedWirelessProfileTypes, {})
        await camera.send(authenticate, {}, password)
        await camera.send(operations.CompleteWirelessPairing, { Status: 0x2001 })
        expect(commands).toEqual([[0x935d], [0x936d], [0x90e8], [0x935a, 0x2001]])
        // Captured: empty password as the PTP string 01 00 00.
        expect([...dataPhases[0]]).toEqual([0x01, 0x00, 0x00])
    })
})

describe('vendor classes selected by USB vendor ID', () => {
    it.each([
        [VendorIDs.FUJIFILM, 'FujiGetDeviceInfo', 0x902b],
        [VendorIDs.PANASONIC, 'PanasonicInitiateCapture', 0x9404],
        [VendorIDs.OLYMPUS, 'OlympusOmdCapture', 0x9481],
        [VendorIDs.OM_DIGITAL, 'OlympusGetLiveViewImage', 0x9484],
        [VendorIDs.LEICA, 'LeicaLEOpenSession', 0x9005],
        [VendorIDs.SIGMA, 'SigmaSnap', 0x901b],
    ])('vendor 0x%s gets its operations on top of the standard ones', (vendorId, name, code) => {
        const { camera, registry } = cameraFor(vendorId)
        expect(camera.getInstance()).toBeInstanceOf(VendorExtensionCamera)
        expect(camera.getInstance().vendorId).toBe(vendorId)
        expect((registry.operations as Record<string, { code: number }>)[name]?.code).toBe(code)
        expect(registry.operations.GetDeviceInfo.code).toBe(0x1001)
    })

    it('keeps vendor code spaces apart: 0x9016 is Sigma SetDataGroup1, not a Leica operation', () => {
        const sigma = Object.values(cameraFor(VendorIDs.SIGMA).registry.operations).filter(
            operation => operation.code === 0x9016
        )
        const leica = Object.values(cameraFor(VendorIDs.LEICA).registry.operations).filter(
            operation => operation.code === 0x9016
        )
        expect(sigma.map(operation => operation.name)).toEqual(['SigmaSetDataGroup1'])
        expect(leica).toEqual([])
    })

    it('still behaves as a GenericCamera for standard operations', async () => {
        const { camera, commands } = cameraFor(VendorIDs.PANASONIC)
        await camera.send(camera.getInstance().registry.operations.CloseSession, {})
        expect(commands).toEqual([[0x1003]])
        expect(
            new VendorExtensionCamera(
                recordingTransport().transport,
                new Logger({ renderInTerminal: false, captureConsole: false }),
                cameraFor(VendorIDs.SIGMA).registry as never,
                VendorIDs.SIGMA
            ).vendorId
        ).toBe(VendorIDs.SIGMA)
    })
})


describe('MTP requests observed in Fujifilm recordings', () => {
    it('preserves all five list selectors and raw response bytes', async () => {
        const bytes = Uint8Array.of(0, 0, 0, 0)
        const recorded = recordingTransport(new Map([[0x9805, bytes]]))
        const camera = new Camera({transport: recorded.transport, vendorId: 0x04cb, logger: {renderInTerminal: false, captureConsole: false}})
        const response = await camera.send(camera.getInstance().registry.operations.MtpGetObjectPropList, {
            ObjectHandle: 2, ObjectFormatCode: 0, ObjectPropertyCode: 0xffffffff, GroupCode: 0, Depth: 0,
        })
        expect(recorded.commands).toEqual([[0x9805, 2, 0, 0xffffffff, 0, 0]])
        expect(response.data).toEqual(bytes)
        expect(recorded.dataPhases).toEqual([])
    })
    it('can express the captured single-parameter DeleteObject and an explicit format filter', async () => {
        const {camera, registry, commands} = cameraFor(0x04cb)
        await camera.send(registry.operations.DeleteObject, {ObjectHandle: 2})
        await camera.send(registry.operations.DeleteObject, {ObjectHandle: 3, ObjectFormatCode: 0x3801})
        expect(commands).toEqual([[0x100b, 2], [0x100b, 3, 0x3801]])
    })
})


it('expresses legacy Sony protocol 2.00 without a version-3 option word', async () => {
    // Public ILCE-7M2 recording by tmandys: libgphoto2 issue 981, comment 2189832650.
    const {camera, commands} = cameraFor(0x054c)
    const registry = createSonyRegistry(true)
    await camera.send(registry.operations.SDIO_GetExtDeviceInfo, {initiatorVersion: '2.00'})
    await camera.send(registry.operations.SDIO_GetExtDeviceInfo, {initiatorVersion: '3.00', flagOfDevicePropertyOption: 'ENABLE'})
    expect(commands).toEqual([[0x9202, 200], [0x9202, 300, 1]])
})
