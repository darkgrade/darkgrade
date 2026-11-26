import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cameraLabel, cameraLeaseResource, parseCameraSelector, withCameraLeases } from '@scripts/camera-lease'

const leaseDirectory = mkdtempSync(join(tmpdir(), 'camera-lease-test-'))
process.env.DARKGRADE_LEASE_DIRECTORY = leaseDirectory
afterAll(() => rmSync(leaseDirectory, { recursive: true, force: true }))

const sonyA = { vendorId: 0x054c, productId: 0x0f7a, serialNumber: 'A1' }
const sonyB = { vendorId: 0x054c, productId: 0x0f7a, serialNumber: 'B2' }

describe('camera:lease', () => {
    it('keys a lease by USB vendor:product and serial, and parses its own label', () => {
        expect(cameraLabel(sonyA)).toBe('054c:0f7a:A1')
        expect(cameraLeaseResource({ vendorId: 0x04a9, productId: 0x32f5 })).toBe('usb-camera:04a9:32f5')
        expect(parseCameraSelector('054c:0f7a:A1')).toEqual(sonyA)
        expect(parseCameraSelector('04a9:32f5')).toEqual({ vendorId: 0x04a9, productId: 0x32f5 })
        expect(() => parseCameraSelector('sony')).toThrow(/VID:PID/)
    })

    it('runs different cameras in parallel and keeps one camera exclusive', async () => {
        const events: string[] = []
        const hold = (camera: typeof sonyA, name: string) =>
            withCameraLeases([camera], name, 1, async () => {
                events.push(`${name} start`)
                await new Promise(resolve => setTimeout(resolve, 300))
                events.push(`${name} end`)
            })
        await Promise.all([hold(sonyA, 'first'), hold(sonyB, 'other'), hold(sonyA, 'second')])
        expect(events.slice(0, 2).sort()).toEqual(['first start', 'other start'])
        expect(events.indexOf('second start')).toBeGreaterThan(events.indexOf('first end'))
    })
})
