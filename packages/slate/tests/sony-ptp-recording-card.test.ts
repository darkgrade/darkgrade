import { describe, expect, it } from 'vitest'
import { sonyPtpMovieCard } from '@vendors/sony/ptp-recording-card'

const property = (code: number, rawValue: unknown, sonyEnabledFlag = 2) => ({ code, rawValue, sonyEnabledFlag })
const camera = (...properties: ReturnType<typeof property>[]) => ({ getSonyPropertyStates: async () => properties })
describe('native Sony movie card readback', () => {
    it('keeps display-only native ready distinct from the SDK absent value', async () => {
        const result = await sonyPtpMovieCard(camera(property(0xd160, 1, 1), property(0xd248, 1), property(0xd24a, 33765)))
        expect(result).toMatchObject({ status: 'ready', code: 1, slots: [1], remainingMovieSeconds: 33765 })
    })
    it('requires every selected simultaneous card and uses the smaller capacity', async () => {
        const properties = [property(0xd160, 0x101), property(0xd248, 1), property(0xd24a, 1000), property(0xd256, 1), property(0xd258, 700)]
        expect(await sonyPtpMovieCard(camera(...properties))).toMatchObject({ status: 'ready', slots: [1, 2], remainingMovieSeconds: 700 })
        properties[3] = property(0xd256, 2)
        expect(await sonyPtpMovieCard(camera(...properties))).toMatchObject({ status: 'absent', code: 2 })
    })
    it('rejects unavailable fields and does not interpret unavailable zero as a full card', async () => {
        const body = camera(property(0xd160, 1), property(0xd248, 1), property(0xd24a, 0, 0))
        expect((await sonyPtpMovieCard(body, { recording: true })).remainingMovieSeconds).toBeUndefined()
        expect((await sonyPtpMovieCard(camera(property(0xd160, 1), property(0xd248, 1, 0)))).status).toBe('unknown')
    })
    it('requires explicit single-slot knowledge when the destination is absent', async () => {
        const body = camera(property(0xd248, 1), property(0xd24a, 42))
        expect((await sonyPtpMovieCard(body)).status).toBe('unknown')
        expect(await sonyPtpMovieCard(body, { singleSlot: true })).toMatchObject({ status: 'ready', slots: [1], remainingMovieSeconds: 42 })
        expect((await sonyPtpMovieCard(camera(property(0xd160, 0x102), property(0xd248, 1)), { singleSlot: true })).status).toBe('unknown')
    })
    it('keeps unknown enum values and sentinel times unknown', async () => {
        expect((await sonyPtpMovieCard(camera(property(0xd160, 1), property(0xd248, '1')))).status).toBe('unknown')
        for (const value of [0, 10, 0xffff])
            expect((await sonyPtpMovieCard(camera(property(0xd160, 1), property(0xd248, value)))).status).toBe('unknown')
        for (const value of [0xffffffff, -1, '900'])
            expect((await sonyPtpMovieCard(camera(property(0xd160, 1), property(0xd248, 1), property(0xd24a, value)))).remainingMovieSeconds).toBeUndefined()
    })
    it('reads an actual available zero only during observed recording', async () => {
        const body = camera(property(0xd160, 2), property(0xd256, 1), property(0xd258, 0))
        expect((await sonyPtpMovieCard(body)).remainingMovieSeconds).toBeUndefined()
        expect((await sonyPtpMovieCard(body, { recording: true })).remainingMovieSeconds).toBe(0)
    })
})
