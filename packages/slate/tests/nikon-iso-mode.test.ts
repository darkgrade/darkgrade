import { expect, it } from 'vitest'
import { Camera } from '@camera/index'

it('the generic Nikon ISO getter preserves Auto when an ISO test restores its original value', async () => {
    const camera = new Camera({ vendorId: 0x04b0, transport: { isLittleEndian: () => true } as any,
        logger: { renderInTerminal: false, captureConsole: false } })
    const instance = camera.getInstance()
    let auto = 'ON', sensitivity = 'ISO 400'
    instance.get = (async (property: any) => property.name === 'ISOAutoControl' ? auto : sensitivity) as any
    instance.set = (async (property: any, value: string) => {
        if (property.name === 'ISOAutoControl') auto = value
        else sensitivity = value
    }) as any
    const original = await instance.getIso()
    expect(original).toBe('ISO AUTO')
    await instance.setIso('ISO 100')
    expect(await instance.getIso()).toBe('ISO 100')
    await instance.setIso(original)
    expect(await instance.getIso()).toBe('ISO AUTO')
})
