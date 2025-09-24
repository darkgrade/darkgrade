import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Camera } from '@api/camera'

describe('Sony Property Formats', () => {
    let camera: Camera

    beforeAll(async () => {
        camera = new Camera()
        await camera.connect()
    }, 5000)

    afterAll(async () => {
        await camera.disconnect()
    })

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    describe('Aperture formats', () => {
        const apertureTests = [
            { input: '2.8', expected: 'f/2.8' },
            { input: 'f/4', expected: 'f/4' },
            { input: 'f5.6', expected: 'f/5.6' },
            { input: 'f 8', expected: 'f/8' },
            { input: 'ƒ/11', expected: 'f/11' },
            { input: 'F:16', expected: 'f/16' },
            { input: '11', expected: 'f/11' },
        ]

        apertureTests.forEach(({ input, expected }) => {
            it(`should normalize "${input}" to "${expected}"`, async () => {
                await camera.setDeviceProperty('APERTURE', input)
                await delay(400)
                const result = await camera.getDeviceProperty('APERTURE')
                expect(result).toBe(expected)
            })
        })
    })

    describe('ISO formats', () => {
        const isoTests = [
            { input: '100', expected: 'ISO 100' },
            { input: 'ISO 200', expected: 'ISO 200' },
            { input: 'ISO400', expected: 'ISO 400' },
            { input: '00800', expected: 'ISO 800' },
            { input: '01600', expected: 'ISO 1600' },
            { input: 'auto', expected: 'ISO AUTO' },
            { input: 'Auto', expected: 'ISO AUTO' },
            { input: 'ISO AUTO', expected: 'ISO AUTO' },
            { input: '3200', expected: 'ISO 3200' },
        ]

        isoTests.forEach(({ input, expected }) => {
            it(`should normalize "${input}" to "${expected}"`, async () => {
                await camera.setDeviceProperty('ISO', input)
                await delay(400)
                const result = await camera.getDeviceProperty('ISO')
                expect(result).toBe(expected)
            })
        })
    })

    describe('Shutter speed formats', () => {
        const shutterTests = [
            { input: '30', expected: '30"' },
            { input: '15s', expected: '15"' },
            { input: '8"', expected: '8"' },
            { input: "4'", expected: '4"' },
            { input: '2sec', expected: '2"' },
            { input: '1 seconds', expected: '1"' },
            { input: '1/4s', expected: '1/4' },
            { input: '1/8', expected: '1/8' },
            { input: '1/15', expected: '1/15' },
            { input: '1/30', expected: '1/30' },
            { input: '1/60', expected: '1/60' },
            { input: '1/125', expected: '1/125' },
            { input: '1/250', expected: '1/250' },
            { input: '1/500', expected: '1/500' },
            { input: 'bulb', expected: 'BULB' },
            { input: '1/1000', expected: '1/1000' },
            { input: 'BULB', expected: 'BULB' },
            { input: '1/2000', expected: '1/2000' },
            { input: 'b', expected: 'BULB' },
            { input: '1/4000', expected: '1/4000' },
            { input: 'B', expected: 'BULB' },
            { input: '0.4"', expected: '0.4"' },
            { input: '0.6', expected: '0.6"' },
            { input: '0.8s', expected: '0.8"' },
            { input: '2.5"', expected: '2.5"' },
        ]

        shutterTests.forEach(({ input, expected }) => {
            it(`should normalize "${input}" to "${expected}"`, async () => {
                await camera.setDeviceProperty('SHUTTER_SPEED', input)
                await delay(400)
                const result = await camera.getDeviceProperty('SHUTTER_SPEED')
                expect(result).toBe(expected)
            })
        })
    })
})
