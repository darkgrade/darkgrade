import {expect, it} from 'vitest'
import {captureProfilePhoto} from '@vendors/profile-media'
import {createNikonRegistry, createSonyRegistry} from '@vendors/registry'
import type {Camera} from '@camera/index'

it.each([false, true])('recorded Nikon card photo transfers only the new object; truncated=%s', async truncated => {
    let released = false, shutters = 0
    const downloaded: number[] = []
    const release = async (options: unknown) => {
        expect(options).toMatchObject({includeInfo: false, includeData: false, autofocus: false, destination: 'card'})
        released = true; shutters++
        return {}
    }
    const camera = {
        driver: {
            vendorId: 0x04b0,
            registry: createNikonRegistry(true),
            getObject: async (handle: number) => {downloaded.push(handle); return new Uint8Array(truncated ? 2 : 3)},
        },
        send: async (operation: {code: number}, parameters: {ObjectHandle?: number}) => {
            if (operation.code === 0x1004) return {code: 0x2001, data: [0x10001]}
            if (operation.code === 0x1007) return {code: 0x2001, data: released ? [7, 8] : [7]}
            expect(parameters.ObjectHandle).toBe(8)
            return {code: 0x2001, data: {filename: 'NEW.NEF', associationType: 0, objectCompressedSize: 3}}
        },
    }
    // The card readings go to the driver, as Camera's own driver answers them.
    Object.assign(camera.driver, {send: camera.send})
    const photo = captureProfilePhoto(camera as unknown as Camera, {autofocus: false, destination: 'card'}, release)
    if (truncated) await expect(photo).rejects.toThrow('length mismatch')
    else expect((await photo).data?.length).toBe(3)
    expect(shutters).toBe(1)
    expect(downloaded).toEqual([8])
})

it.each([false, true])('Sony recorder claims host dial priority and restores it after still success/failure=%s', async fail => {
    let priority = 'CAMERA_PRIORITY'
    const writes: string[] = []
    const camera = {
        driver: {vendorId: 0x054c, registry: createSonyRegistry(true)},
        get: async () => priority,
        set: async (_: unknown, value: string) => {writes.push(value); priority = value},
        getSonyPropertyStates: async () => [],
    }
    const release = async () => {
        expect(priority).toBe('HOST_PRIORITY')
        if (fail) throw new Error('Transfer refused')
        return {data: new Uint8Array(3)}
    }
    const result = captureProfilePhoto(camera as unknown as Camera, {autofocus: false, destination: 'memory'}, release)
    if (fail) await expect(result).rejects.toThrow('Transfer refused')
    else expect((await result).data?.length).toBe(3)
    expect(writes).toEqual(['HOST_PRIORITY', 'CAMERA_PRIORITY'])
    expect(priority).toBe('CAMERA_PRIORITY')
})
