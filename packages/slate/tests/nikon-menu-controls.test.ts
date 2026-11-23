import { NikonMenuController } from '@vendors/nikon/menu-controls'
import { describe, expect, it, vi } from 'vitest'

interface CommandParameters { Command: number; Argument1: number; Argument2: number; Argument3: number; Argument4: number }
function fixture(options: {
    model?: string; version?: string; recording?: number | null; manufacturer?: string
    responses?: Record<number, { code: number; parameters?: number[] }>
    onCommand?: (parameters: CommandParameters) => Promise<void> | void
    restoreCode?: number
} = {}) {
    const instance = { sessionId: 41 as number | null }
    const send = vi.fn(async (operation: { code: number; dataDirection: string }, parameters: unknown) => {
        if (operation.code === 0x1001) return { code: 0x2001, data: {
            manufacturer: options.manufacturer ?? 'Nikon Corporation', model: options.model ?? 'Z6_3',
            deviceVersion: options.version ?? 'V2.00',
        } }
        if (operation.code === 0x943a) return { code: 0x2001, data: options.recording === null ? undefined : {
            devicePropertyCode: 0xd0a4, currentValueRaw: options.recording ?? 0,
        } }
        if (operation.code === 0x90c2) return { code: options.restoreCode ?? 0x2001 }
        if (operation.code !== 0x94fd) throw new Error('Unexpected command')
        await options.onCommand?.(parameters as CommandParameters)
        return options.responses?.[(parameters as CommandParameters).Command] ?? { code: 0x2001, parameters: [0x2001, 0, 0, 0, 0] }
    })
    const camera = { send, getInstance: () => instance }
    const controller = new NikonMenuController(camera as any)
    const commands = () => send.mock.calls.filter(([operation]) => operation.code === 0x94fd)
        .map(([, parameters]) => parameters as CommandParameters)
    return { controller, camera, instance, send, commands }
}
const options = { restoreCameraMode: 'PC_CAMERA' as const }

describe('scoped Nikon menu navigation', () => {
    it('initializes preview, sends all seven fixed-duration keys, exits and restores the requested mode', async () => {
        const { controller, send, commands } = fixture()
        const results = await controller.run(options, async menu => {
            const results = []
            for (const key of ['menu', 'ok', 'left', 'right', 'up', 'down', 'delete'] as const) results.push(await menu.press(key))
            return results
        })
        expect(results).toEqual(Array.from({ length: 7 }, () => ({ commandAccepted: true, visualVerificationRequired: true })))
        expect(commands()).toEqual([
            { Command: 0xf001, Argument1: 0, Argument2: 0, Argument3: 0, Argument4: 0 },
            { Command: 0xf094, Argument1: 1, Argument2: 0, Argument3: 0, Argument4: 0 },
            ...[0x28, 0x27, 1, 0, 2, 3, 0x29].map(index => ({ Command: 0xf2ba, Argument1: index, Argument2: 50, Argument3: 0, Argument4: 0 })),
            { Command: 0xf002, Argument1: 0, Argument2: 0, Argument3: 0, Argument4: 0 },
        ])
        expect(send.mock.calls.filter(([operation]) => operation.code === 0x94fd).every(([operation]) => operation.dataDirection === 'none')).toBe(true)
        expect(send.mock.calls.at(-1)).toEqual([expect.objectContaining({ code: 0x90c2 }), { Mode: 'PC_CAMERA' }])
        await expect(controller.press('menu')).rejects.toThrow('active run')
    })

    it.each([
        { code: 0x2001, parameters: [0xa001] }, { code: 0x200f, parameters: [0x2001] }, { code: 0x2001 },
    ])('does not interpret an unconfirmed press as success: %s', async response => {
        const { controller, commands } = fixture({ responses: { [0xf2ba]: response } })
        await expect(controller.run(options, menu => menu.press('menu'))).rejects.toThrow('press was not confirmed')
        expect(commands().at(-1)?.Command).toBe(0xf002)
    })

    it('cleans up after a callback failure', async () => {
        const { controller, commands, send } = fixture()
        await expect(controller.run(options, () => { throw new Error('Preview unavailable') })).rejects.toThrow('Preview unavailable')
        expect(commands().at(-1)?.Command).toBe(0xf002)
        expect(send.mock.calls.at(-1)?.[0].code).toBe(0x90c2)
    })

    it('stops navigation after an unconfirmed key even if the callback catches the error', async () => {
        const { controller, commands } = fixture({ responses: { [0xf2ba]: { code: 0x2001, parameters: [0xa001] } } })
        await expect(controller.run(options, async menu => {
            await expect(menu.press('menu')).rejects.toThrow('not confirmed')
            await expect(menu.press('ok')).rejects.toThrow('active run')
        })).rejects.toThrow('not confirmed')
        expect(commands().filter(command => command.Command === 0xf2ba)).toHaveLength(1)
        expect(commands().at(-1)?.Command).toBe(0xf002)
    })

    it('attempts exit and mode restoration after partially failed entry', async () => {
        const { controller, commands, send } = fixture({ responses: { [0xf001]: { code: 0x2001, parameters: [0xa001] } } })
        await expect(controller.run(options, () => undefined)).rejects.toThrow('service entry')
        expect(commands().map(command => command.Command)).toEqual([0xf001, 0xf002])
        expect(send.mock.calls.at(-1)?.[0].code).toBe(0x90c2)
    })

    it('preserves an already enabled service belonging to another operation', async () => {
        const { controller, commands, send } = fixture({ responses: { [0xf001]: { code: 0x2001, parameters: [0x201e] } } })
        await expect(controller.run(options, () => undefined)).rejects.toThrow('another operation')
        expect(commands().map(command => command.Command)).toEqual([0xf001])
        expect(send.mock.calls.some(([operation]) => operation.code === 0x90c2)).toBe(false)
    })

    it('surfaces unsuccessful exit while still attempting explicit mode restoration', async () => {
        const { controller, send } = fixture({ responses: { [0xf002]: { code: 0x2001, parameters: [0xa001] } } })
        await expect(controller.run(options, () => undefined)).rejects.toThrow('cleanup is unconfirmed')
        expect(send.mock.calls.at(-1)?.[0].code).toBe(0x90c2)
    })

    it('does not claim cleanup when restoring the camera mode fails', async () => {
        const { controller } = fixture({ restoreCode: 0x2019 })
        await expect(controller.run({ restoreCameraMode: 'REMOTE' }, () => undefined)).rejects.toThrow('cleanup is unconfirmed')
    })

    it.each([{ recording: 0x400 }, { recording: 0x200 }, { recording: null }])('requires confirmed idle recording/card state %s', async state => {
        const { controller, commands } = fixture(state)
        await expect(controller.run(options, () => undefined)).rejects.toThrow('confirm recording')
        expect(commands()).toEqual([])
    })

    it.each([{ model: 'Z8' }, { version: 'V2.01' }, { manufacturer: 'Canon' }])('rejects an unvalidated body or firmware %s', async identity => {
        const { controller, commands } = fixture(identity)
        await expect(controller.run(options, () => undefined)).rejects.toThrow('validated Nikon Z6III')
        expect(commands()).toEqual([])
    })

    it('never sends cleanup to a replacement session', async () => {
        const setup = fixture({ onCommand: parameters => { if (parameters.Command === 0xf2ba) setup.instance.sessionId = 42 } })
        await expect(setup.controller.run(options, menu => menu.press('menu'))).rejects.toThrow('cleanup is unconfirmed')
        expect(setup.commands().map(command => command.Command)).toEqual([0xf001, 0xf094, 0xf2ba])
        expect(setup.send.mock.calls.some(([operation]) => operation.code === 0x90c2)).toBe(false)
    })

    it('also rejects a replacement camera instance reusing the same numeric session', async () => {
        const setup = fixture()
        await expect(setup.controller.run(options, async menu => {
            setup.camera.getInstance = () => ({ sessionId: 41 })
            await menu.press('menu')
        })).rejects.toThrow('cleanup is unconfirmed')
        expect(setup.commands().map(command => command.Command)).toEqual([0xf001, 0xf094])
    })

    it('rejects concurrent controllers and concurrent keys on the same camera', async () => {
        let releaseKey!: () => void
        const blocked = new Promise<void>(resolve => { releaseKey = resolve })
        const setup = fixture({ onCommand: parameters => parameters.Command === 0xf2ba ? blocked : undefined })
        const other = new NikonMenuController(setup.camera as any)
        await setup.controller.run(options, async menu => {
            await expect(other.run(options, () => undefined)).rejects.toThrow('already in progress')
            const pressed = menu.press('menu')
            await expect(menu.press('ok')).rejects.toThrow('key is already in progress')
            releaseKey()
            await pressed
        })
        expect(setup.commands().filter(command => command.Command === 0xf2ba)).toHaveLength(1)
        await other.run(options, () => undefined)
    })

    it('rejects keys outside the navigation allowlist', async () => {
        const { controller, commands } = fixture()
        await controller.run(options, async menu => {
            for (const key of ['movie', 'shutter', '__proto__', 'toString']) await expect(menu.press(key as any)).rejects.toThrow('Unsupported')
        })
        expect(commands().some(command => command.Command === 0xf2ba)).toBe(false)
    })
})


it('rereads recording and card-write state before each navigation key in a long run',async()=>{
    const state={recording:0},setup=fixture(state)
    await expect(setup.controller.run(options,async menu=>{
        await menu.press('menu')
        state.recording=0x400
        await menu.press('down')
    })).rejects.toThrow('confirm recording')
    expect(setup.commands().filter(command=>command.Command===0xf2ba)).toHaveLength(1)
    expect(setup.commands().at(-1)?.Command).toBe(0xf002)
    expect(setup.send.mock.calls.at(-1)?.[0].code).toBe(0x90c2)
})
