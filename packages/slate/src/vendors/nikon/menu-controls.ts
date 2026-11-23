import type { Camera } from '@camera/index'
import { GetDeviceInfo } from '@ptp/definitions/operation-definitions'
import { ChangeCameraMode } from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
import { baseCodecs } from '@ptp/types/codec'
import type { OperationDefinition } from '@ptp/types/operation'
import { readNikonRecordingStatus } from '@vendors/nikon/recording-status'

export type NikonMenuKey = 'menu' | 'ok' | 'left' | 'right' | 'up' | 'down' | 'delete'
export interface NikonMenuRunOptions {
    restoreCameraMode: 'PC_CAMERA' | 'REMOTE'
}

const keyIndices: Record<NikonMenuKey, number> = { menu: 0x28, ok: 0x27, left: 1, right: 0, up: 2, down: 3, delete: 0x29 }
const activeInstances = new WeakSet<object>()
const menuOperation = {
    code: 0x94fd,
    name: 'NikonMenuServiceCommand',
    description: 'Scoped Nikon navigation service command',
    dataDirection: 'none',
    operationParameters: [
        { name: 'Command', description: 'Navigation service operation', codec: baseCodecs.uint32, required: true },
        { name: 'Argument1', description: 'Operation argument or key index', codec: baseCodecs.uint32, required: true },
        { name: 'Argument2', description: 'Operation argument or fixed press duration', codec: baseCodecs.uint32, required: true },
        { name: 'Argument3', description: 'Reserved, always zero', codec: baseCodecs.uint32, required: true },
        { name: 'Argument4', description: 'Reserved, always zero', codec: baseCodecs.uint32, required: true },
    ],
    responseParameters: [],
} as const satisfies OperationDefinition

type MenuCamera = Pick<Camera, 'send' | 'getInstance'>
type CameraInstance = ReturnType<Camera['getInstance']>

/** Navigation on the physically validated Z6III firmware only. Requires an owned session.
 * Service entry temporarily changes camera operation and preview state. Successful commands
 * require visual verification; they do not establish that a menu selection or Wi-Fi setup worked.
 */
export class NikonMenuController {
    private instance: CameraInstance | undefined
    private session: number | null = null
    private running = false
    private acceptingKeys = false
    private keyFailed = false
    private keyFailure: unknown
    private pendingPress: Promise<{ commandAccepted: true; visualVerificationRequired: true }> | undefined

    constructor(private readonly camera: MenuCamera) {}

    async run<Result>(
        options: NikonMenuRunOptions,
        callback: (controller: Pick<NikonMenuController, 'press'>) => Result | Promise<Result>
    ): Promise<Result> {
        if (!['PC_CAMERA', 'REMOTE'].includes(options.restoreCameraMode)) throw new Error('Specify the camera mode to restore')
        const instance = this.camera.getInstance()
        if (this.running || activeInstances.has(instance)) throw new Error('Nikon menu control is already in progress')
        if (instance.sessionId === null) throw new Error('Open a Nikon PTP session before menu control')
        this.running = true
        this.keyFailed = false
        this.keyFailure = undefined
        this.instance = instance
        this.session = instance.sessionId
        activeInstances.add(instance)
        let entryAttempted = false
        let foreignOwner = false
        let failed = false
        let failure: unknown
        let result: Result | undefined
        try {
            await this.requireSupportedIdleCamera()
            entryAttempted = true
            const entry = await this.command(0xf001)
            if (entry.code === 0x2001 && entry.parameters?.[0] === 0x201e) {
                foreignOwner = true
                throw new Error('Nikon navigation service already belongs to another operation; it was preserved')
            }
            this.requireAccepted(entry, 'service entry')
            this.requireAccepted(await this.command(0xf094, 1, 0), 'preview resume')
            this.acceptingKeys = true
            result = await callback(this)
            if (this.keyFailed) throw this.keyFailure
        } catch (error) {
            failed = true
            failure = error
        } finally {
            this.acceptingKeys = false
            const cleanupFailures: unknown[] = []
            if (this.pendingPress) {
                try { await this.pendingPress } catch (error) { cleanupFailures.push(error) }
            }
            if (entryAttempted && !foreignOwner) {
                try { this.requireAccepted(await this.command(0xf002), 'service exit') }
                catch (error) { cleanupFailures.push(error) }
                try {
                    this.requireSession()
                    const restored = await this.camera.send(ChangeCameraMode, { Mode: options.restoreCameraMode })
                    this.requireSession()
                    if (restored.code !== 0x2001) throw new Error(`Camera mode restoration returned 0x${restored.code.toString(16)}`)
                } catch (error) { cleanupFailures.push(error) }
            }
            activeInstances.delete(instance)
            this.running = false
            this.instance = undefined
            this.session = null
            if (cleanupFailures.length) {
                throw new AggregateError(failed ? [failure, ...cleanupFailures] : cleanupFailures,
                    'Nikon menu cleanup is unconfirmed; inspect the camera before continuing')
            }
        }
        if (failed) throw failure
        return result as Result
    }

    /** Sends a fixed 50 ms press with firmware-managed release. Inspect the preview for its result. Delete acts on the current camera UI selection. */
    async press(key: NikonMenuKey): Promise<{ commandAccepted: true; visualVerificationRequired: true }> {
        if (!Object.hasOwn(keyIndices, key)) throw new Error('Unsupported Nikon menu key')
        if (!this.acceptingKeys) throw new Error('Use Nikon menu keys inside an active run callback')
        if (this.pendingPress) throw new Error('A Nikon menu key is already in progress')
        const pending = this.pressKey(key)
        this.pendingPress = pending
        try { return await pending }
        catch (error) {
            this.acceptingKeys = false
            this.keyFailed = true
            this.keyFailure = error
            throw error
        }
        finally { if (this.pendingPress === pending) this.pendingPress = undefined }
    }

    private async pressKey(key: NikonMenuKey): Promise<{ commandAccepted: true; visualVerificationRequired: true }> {
        await this.requireIdleCamera()
        this.requireAccepted(await this.command(0xf2ba, keyIndices[key], 50), `${key} press`)
        return { commandAccepted: true, visualVerificationRequired: true }
    }

    private async requireSupportedIdleCamera(): Promise<void> {
        this.requireSession()
        const information = await this.camera.send(GetDeviceInfo, {})
        this.requireSession()
        const device = information.data
        if (information.code !== 0x2001 || !device || !/nikon/i.test(device.manufacturer)
            || device.model !== 'Z6_3' || !/^V?2\.00$/.test(device.deviceVersion)) {
            throw new Error('Nikon menu control requires the validated Nikon Z6III firmware 2.00')
        }
        await this.requireIdleCamera()
    }

    private async requireIdleCamera(): Promise<void> {
        this.requireSession()
        const recording = await readNikonRecordingStatus(this.camera)
        this.requireSession()
        if (!recording || recording.recording || recording.bufferedImages) {
            throw new Error('Nikon must confirm recording and pending card writes are idle before menu control')
        }
    }

    private async command(command: number, argument1 = 0, argument2 = 0) {
        this.requireSession()
        const response = await this.camera.send(menuOperation, {
            Command: command, Argument1: argument1, Argument2: argument2, Argument3: 0, Argument4: 0,
        })
        this.requireSession()
        return response
    }

    private requireAccepted(response: { code: number; parameters?: number[] }, action: string): void {
        if (response.code === 0x2001 && response.parameters?.[0] === 0x2001) return
        const inner = response.parameters?.[0]
        throw new Error(`Nikon ${action} was not confirmed: response 0x${response.code.toString(16)}, status ${inner === undefined ? 'missing' : `0x${inner.toString(16)}`}`)
    }

    private requireSession(): void {
        if (!this.instance || this.camera.getInstance() !== this.instance || this.session === null
            || this.instance.sessionId !== this.session) {
            throw new Error('Nikon PTP session changed; no commands were sent to the replacement session')
        }
    }
}
