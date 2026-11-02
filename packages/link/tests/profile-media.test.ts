import {expect, it} from 'vitest'
import {captureProfilePhoto} from '@vendors/profile-media'
import {createNikonRegistry} from '@ptp/registry'
import type {Camera} from '@camera/index'

it.each([false, true])('recorded Nikon card photo transfers only the new object; truncated=%s', async truncated => {
    let released = false, shutters = 0
    const downloaded: number[] = []
    const camera = {
        getInstance: () => ({vendorId: 0x04b0, registry: createNikonRegistry(true)}),
        captureImage: async (options: unknown) => {
            expect(options).toMatchObject({includeInfo: false, includeData: false, autofocus: false, destination: 'card'})
            released = true; shutters++
            return {}
        },
        send: async (operation: {code: number}, parameters: {ObjectHandle?: number}) => {
            if (operation.code === 0x1004) return {code: 0x2001, data: [0x10001]}
            if (operation.code === 0x1007) return {code: 0x2001, data: released ? [7, 8] : [7]}
            expect(parameters.ObjectHandle).toBe(8)
            return {code: 0x2001, data: {filename: 'NEW.NEF', associationType: 0, objectCompressedSize: 3}}
        },
        getObject: async (handle: number) => {downloaded.push(handle); return new Uint8Array(truncated ? 2 : 3)},
    }
    const photo = captureProfilePhoto(camera as unknown as Camera, {autofocus: false, destination: 'card'})
    if (truncated) await expect(photo).rejects.toThrow('length mismatch')
    else expect((await photo).data?.length).toBe(3)
    expect(shutters).toBe(1)
    expect(downloaded).toEqual([8])
})
