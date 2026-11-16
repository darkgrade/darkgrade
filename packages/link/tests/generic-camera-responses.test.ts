import { createContributions } from '@darkgrade/contribute'
import { GenericCamera } from '@camera/generic-camera'
import { Logger } from '@core/logger'
import type { OperationDefinition } from '@ptp/types/operation'
import { TransportType, type TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it } from 'vitest'

function container(type: number, code: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
    const bytes = new Uint8Array(12 + payload.length)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, bytes.length, true)
    view.setUint16(4, type, true)
    view.setUint16(6, code, true)
    view.setUint32(8, 1, true)
    bytes.set(payload, 12)
    return bytes
}

function parameterBytes(parameters: number[]): Uint8Array {
    const bytes = new Uint8Array(parameters.length * 4)
    const view = new DataView(bytes.buffer)
    parameters.forEach((parameter, index) => view.setUint32(index * 4, parameter, true))
    return bytes
}

function cameraWithResponses(responses: Uint8Array[]) {
    const sent: Uint8Array[] = []
    const transport = {
        isLittleEndian: () => true,
        isConnected: () => true,
        getType: () => 'usb',
        send: async (bytes: Uint8Array) => { sent.push(bytes) },
        receive: async () => {
            const response = responses.shift()
            if (!response) throw new Error('Unexpected receive after the supplied response containers')
            return response
        },
    } as unknown as TransportInterface
    return {
        camera: new GenericCamera(transport, new Logger({ captureConsole: false, renderInTerminal: false })),
        sent,
    }
}

const sendDataOperation = {
    code: 0x1016,
    name: 'SetDevicePropValue',
    description: 'Send a property value',
    dataDirection: 'in',
    operationParameters: [],
    responseParameters: [],
} as const satisfies OperationDefinition

describe('GenericCamera response container parameters', () => {
    it.each([0x2001, 0x200f])('preserves response words with outer status %i', async code => {
        const parameters = [0xa004, 0, 0xffffffff, 0x80000000, 7]
        const { camera } = cameraWithResponses([container(3, code, parameterBytes(parameters))])

        const response = await camera.send(camera.registry.operations.CloseSession, {})

        expect(response.code).toBe(code)
        expect(response.parameters).toEqual(parameters)
    })

    it('does not mistake downloaded data for response parameters', async () => {
        const data = Uint8Array.of(0x44, 0x33, 0x22, 0x11)
        const { camera } = cameraWithResponses([
            container(2, 0x1009, data),
            container(3, 0x2001, parameterBytes([4])),
        ])

        const response = await camera.send(camera.registry.operations.GetObject, { ObjectHandle: 1 })

        expect(response.data).toEqual(data)
        expect(response.parameters).toEqual([4])
    })

    it('preserves parameters when a download receives an immediate error response', async () => {
        const payload = parameterBytes([0xa004, 17])
        const { camera } = cameraWithResponses([container(3, 0x200f, payload)])

        const response = await camera.send(camera.registry.operations.GetObject, { ObjectHandle: 1 })

        expect(response.code).toBe(0x200f)
        expect(response.parameters).toEqual([0xa004, 17])
        expect(response.data).toEqual(payload)
    })

    it('keeps the legacy response-payload fallback after an empty data phase', async () => {
        const payload = parameterBytes([0x2001, 23])
        const { camera } = cameraWithResponses([container(2, 0x1009), container(3, 0x2001, payload)])

        const response = await camera.send(camera.registry.operations.GetObject, { ObjectHandle: 1 })

        expect(response.parameters).toEqual([0x2001, 23])
        expect(response.data).toEqual(payload)
    })

    it('preserves response parameters after uploading data', async () => {
        const { camera, sent } = cameraWithResponses([container(3, 0x2001, parameterBytes([0xa001]))])

        const response = await camera.send(sendDataOperation, {}, Uint8Array.of(1, 2))

        expect(sent.map(bytes => new DataView(bytes.buffer).getUint16(4, true))).toEqual([1, 2])
        expect(response.parameters).toEqual([0xa001])
    })

    it('leaves parameters absent when the response has no payload', async () => {
        const { camera } = cameraWithResponses([container(3, 0x2001)])

        expect((await camera.send(camera.registry.operations.CloseSession, {})).parameters).toBeUndefined()
    })

    it('rejects a non-word-aligned response payload as a framing violation instead of guessing at it', async () => {
        const payload = Uint8Array.of(1, 2, 3)
        const { camera } = cameraWithResponses([container(3, 0x2001, payload)])

        // ISO 15740 response containers carry whole UINT32 parameters only.
        await expect(camera.send(camera.registry.operations.GetObject, { ObjectHandle: 1 })).rejects.toMatchObject({
            name: 'PTPProtocolError',
        })
    })
})

it('lists populated slots and never asks an empty storage placeholder for handles',async()=>{
 const operations={GetStorageIDs:'ids',GetStorageInfo:'storage',GetObjectHandles:'handles',GetObjectInfo:'object'},calls:any[]=[]
 const camera={registry:{operations},send:async(operation:string,args:any)=>{
  calls.push({operation,args})
  if(operation==='ids')return {code:0x2001,data:[0x10000,0x20001]}
  if(operation==='storage')return {code:0x2001,data:{storageDescription:'Card'}}
  if(operation==='handles')return {code:0x2001,data:[7]}
  return {code:0x2001,data:{filename:'new.NEF'}}
 }}
 const listed=await GenericCamera.prototype.listObjects.call(camera as any)
 expect(Object.keys(listed)).toEqual([String(0x20001)])
 expect(listed[0x20001].objects[7].filename).toBe('new.NEF')
 expect(calls.some(call=>call.args.StorageID===0x10000)).toBe(false)
})

it('preserves a card-list refusal rather than iterating an absent dataset',async()=>{
 const camera={registry:{operations:{GetStorageIDs:'ids',GetStorageInfo:'storage',GetObjectHandles:'handles'}},send:async(operation:string)=>operation==='ids'?{code:0x2001,data:[0x20001]}:operation==='storage'?{code:0x2001,data:{}}:{code:0x2013}}
 await expect(GenericCamera.prototype.listObjects.call(camera as any)).rejects.toThrow()
})


it('optional contributions preserve the real Link transfer while omitting its image and response parameters', async () => {
    const payload = new TextEncoder().encode('private-image-and-serial-8675309')
    const responses = [container(2, 0x1009, payload), container(3, 0x2001, parameterBytes([8675309]))]
    let uploaded = ''
    const diagnostics = await createContributions({
        endpoint: 'https://collector.example', accessToken: async () => 'fixture-token',
        camera: { manufacturer: 'Canon', model: 'Synthetic', firmware: 'unknown', revision: '2e5ba0f', dirty: false, transport: 'usb', evidence: 'synthetic' },
        consent: { read: async () => true, write: async () => {} },
        fetch: async (_url, init) => { uploaded = String(init?.body); return new Response(null, { status: 202 }) },
    })
    const source: TransportInterface = {
        isLittleEndian: () => true, isConnected: () => true, getType: () => TransportType.USB,
        connect: async () => {}, disconnect: async () => {}, classRequestReset: async () => {}, send: async () => {},
        receive: async () => responses.shift()!,
    }
    const observation = diagnostics.observe(source)
    const observed: TransportInterface = observation.transport
    const camera = new GenericCamera(observed, new Logger({ captureConsole: false, renderInTerminal: false }))
    try {
        const result = await camera.send(camera.registry.operations.GetObject, { ObjectHandle: 8675309 })
        expect(result.data).toEqual(payload)
        expect(result.parameters).toEqual([8675309])
        expect(await diagnostics.flush()).toBe('sent')
        expect(JSON.parse(uploaded).entries.map((entry: { code: number }) => entry.code)).toEqual([0x1009, 0x1009, 0x2001])
        expect(uploaded).not.toContain('private-image')
        expect(uploaded).not.toContain('8675309')
    } finally { observation.detach(); diagnostics.close() }
})
it('state snapshots never issue USB work or replace observed mode with a requested write',()=>{
 const {camera,sent}=cameraWithResponses([]);camera.vendorId=0x04a9
 const evidence:any[]=[];camera.observeProfile(crypto.randomUUID(),value=>evidence.push(value))
 camera.recordProtocol({type:'property-value',vendorId:0x04a9,property:0xd1c2,dataType:6,current:0},0x9116)
 camera.recordProtocol({type:'property-write',vendorId:0x04a9,property:0xd1c2,dataType:6,requested:1,transactionId:1,outcome:'response',response:0x2001},0x9110)
 camera.recordStateSnapshot('recording','before-prepare')
 camera.recordProtocol({type:'property-value',vendorId:0x04a9,property:0xd1c2,dataType:6,current:1},0x9116)
 camera.recordStateSnapshot('recording','after-prepare')
 camera.recordStateSnapshot('recording','failure')
 camera.recordProtocol({type:'property-value',vendorId:0x04a9,property:0xd1c2,dataType:6,current:0},0x9116)
 camera.recordStateSnapshot('recording','after-cleanup')
 const snapshots=evidence.filter(item=>item.type==='state-snapshot')
 expect(snapshots.map(item=>item.settings[0].current)).toEqual([0,1,1,0])
 expect(snapshots.every(item=>item.settings[0].ageMilliseconds>=0&&item.basis==='observed-cache')).toBe(true)
 expect(sent).toEqual([])
})
