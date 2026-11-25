import { cameraControlDefinitions, type CameraControlId } from '@camera/controls'
import type { Camera } from '@camera/index'
import { publicOperations, type OperationParameter } from '@camera/operation-table/index'

/**
 * The public Camera operations as the MCP tools and the CLI run them, drawn from the operation
 * table: the same names, the same parameters and the same calls on every surface. Type-only
 * Camera imports keep this module free of drivers, so the browser runtime can carry it.
 */
export interface SurfaceOperation {
    /** The library's method name (`takePhoto`); `discover` is the static `Camera.discover`. */
    name: string
    /** `camera_take_photo`, or undefined when the operation is not offered over MCP. */
    mcpTool?: string
    /** `darkgrade camera take-photo` (`darkgrade cameras` for discover), or undefined. */
    cliCommand?: string
    summary: string
    parameters: readonly OperationParameter[]
    /** Stopping never waits behind other camera work, so these run as soon as they are asked for. */
    immediate: boolean
    /** Reads without changing the camera. */
    readOnly: boolean
}

/** One call's inputs by parameter name, as an MCP client or the command line gave them. */
export type OperationInput = Readonly<Record<string, unknown>>

/** A file an operation returned: a live-view frame, a preview, a photo's or a download's bytes. */
export interface OperationFile {
    /** What it is: `photo`, `frame`, `overlay`, `preview` or `download`. */
    role: 'photo' | 'frame' | 'overlay' | 'preview' | 'download'
    /** A name to save it under. */
    name: string
    mimeType: string
    data: Uint8Array
}

/** An operation's JSON-safe result, with its bytes moved out into files. */
export interface OperationOutcome {
    result: unknown
    files: OperationFile[]
}

/** A call's inputs do not match the operation's parameters; nothing was sent to a camera. */
export class OperationInputError extends Error {
    override name = 'OperationInputError'
}

const immediateOperations = new Set(['stopZoom', 'stopRecording'])
const readOnlyOperations = new Set([
    'discover',
    'getInfo',
    'getCapabilities',
    'getRecordingState',
    'getCardStatus',
    'listMedia',
    'getMediaPreview',
    'downloadMedia',
    'getBattery',
    'getLiveViewFrame',
])

let surfaces: SurfaceOperation[] | undefined

/** Every implemented public operation with its surfaces, in table order. */
export function surfaceOperations(): readonly SurfaceOperation[] {
    surfaces ??= publicOperations()
        .filter(operation => operation.implemented && operation.entry.summary)
        .map(operation => ({
            name: operation.name,
            mcpTool: operation.mcpTool,
            cliCommand: operation.cliCommand,
            summary: operation.entry.summary ?? operation.name,
            parameters: operation.entry.parameters ?? [],
            immediate: immediateOperations.has(operation.name),
            readOnly: readOnlyOperations.has(operation.name) || isSettingGetter(operation.name),
        }))
    return surfaces
}

export function surfaceOperation(name: string): SurfaceOperation | undefined {
    return surfaceOperations().find(operation => operation.name === name)
}

function settingId(method: string, prefix: 'get' | 'set'): CameraControlId | undefined {
    if (!method.startsWith(prefix) || method.length <= prefix.length) return undefined
    const id = method[prefix.length]!.toLowerCase() + method.slice(prefix.length + 1)
    return isControlId(id) ? id : undefined
}

function isControlId(id: string): id is CameraControlId {
    return Object.prototype.hasOwnProperty.call(cameraControlDefinitions, id)
}

const isSettingGetter = (name: string) => name !== 'getCapabilities' && settingId(name, 'get') !== undefined

/**
 * Checks one call's inputs against the operation's parameters and converts them: numbers from
 * numeric text, `time` to a Date. Unknown names and missing required inputs are refused before
 * anything reaches a camera.
 */
export function readOperationInput(operation: SurfaceOperation, input: OperationInput): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationInputError(`${operation.name} takes named inputs`)
    const known = new Set(operation.parameters.map(parameter => parameter.name))
    const unknown = Object.keys(input).filter(name => !known.has(name))
    if (unknown.length) throw new OperationInputError(`${operation.name} has no input ${unknown.join(', ')}`)
    const read: Record<string, unknown> = {}
    for (const parameter of operation.parameters) {
        const value = input[parameter.name]
        if (value === undefined) {
            if (parameter.required) throw new OperationInputError(`${operation.name} needs ${parameter.name}: ${parameter.description}`)
            if (parameter.type === 'switch' && parameter.default !== undefined) read[parameter.name] = parameter.default
            continue
        }
        read[parameter.name] = readParameter(operation.name, parameter, value)
    }
    return read
}

function readParameter(operation: string, parameter: OperationParameter, value: unknown): unknown {
    const refuse = () => new OperationInputError(`${operation}: ${parameter.name} must be ${parameter.description}`)
    switch (parameter.type) {
        case 'switch':
            if (typeof value === 'boolean') return value
            if (value === 'true' || value === 'false') return value === 'true'
            throw refuse()
        case 'number': {
            const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
            if (!Number.isFinite(number)) throw refuse()
            return number
        }
        case 'choice':
            if (typeof value !== 'string' || !parameter.choices?.includes(value)) throw refuse()
            return value
        case 'time': {
            const moment = typeof value === 'string' ? new Date(value) : undefined
            if (!moment || Number.isNaN(moment.getTime())) throw refuse()
            return moment
        }
        case 'text':
            if (typeof value === 'number') return String(value)
            if (typeof value !== 'string' || !value) throw refuse()
            return value
    }
}

const text = (input: Record<string, unknown>, name: string) => {
    const value = input[name]
    if (typeof value !== 'string') throw new Error(`${name} is required`)
    return value
}
const number = (input: Record<string, unknown>, name: string) => {
    const value = input[name]
    if (typeof value !== 'number') throw new Error(`${name} is required`)
    return value
}
const switchValue = (input: Record<string, unknown>, name: string) => input[name] === true
const oneOf = <Choice extends string>(input: Record<string, unknown>, name: string, choices: readonly Choice[]): Choice => {
    const value = input[name]
    const match = choices.find(choice => choice === value)
    if (!match) throw new Error(`${name} must be one of ${choices.join(', ')}`)
    return match
}

/** A setting's value as setControl takes it: Kelvin is a number, everything else its canonical text. */
function controlValue(id: CameraControlId, value: unknown): string | number {
    if (id === 'colorTemperature') {
        const kelvin = typeof value === 'number' ? value : Number(value)
        if (!Number.isFinite(kelvin)) throw new Error('Colour temperature is a number of kelvin, such as 5600')
        return kelvin
    }
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('A setting value is text')
    return String(value)
}

/** The current value of one setting, from a fresh capability read. */
async function readSetting(camera: Camera, id: CameraControlId) {
    const state = (await camera.getCapabilities()).controls[id]
    if (!state) throw new Error(`${cameraControlDefinitions[id].label} is not reported by this camera now`)
    return state
}

/** Runs one public operation on a Camera with inputs already read by `readOperationInput`. */
export async function runOperation(camera: Camera, name: string, input: Record<string, unknown>): Promise<OperationOutcome> {
    const plain = (result: unknown): OperationOutcome => ({ result: result ?? { done: true }, files: [] })
    const setter = settingId(name, 'set')
    if (setter && name !== 'setControl') return plain(await camera.setControl(setter, controlValue(setter, input.value)))
    const getter = settingId(name, 'get')
    if (getter && name !== 'getCapabilities') return plain(await readSetting(camera, getter))
    switch (name) {
        case 'connect':
            return plain(await camera.connect({ observeOnly: switchValue(input, 'observeOnly') }))
        case 'disconnect':
            return plain(await camera.disconnect())
        case 'recover':
            return plain(await camera.recover())
        case 'getInfo':
            return plain(await camera.getInfo())
        case 'getCapabilities':
            return plain(await camera.getCapabilities())
        case 'setControl': {
            const id = text(input, 'id')
            const control = isControlId(id) ? id : undefined
            if (!control) throw new Error(`${id} is not a setting id; camera_get_capabilities lists them`)
            return plain(await camera.setControl(control, controlValue(control, input.value)))
        }
        case 'autofocus':
            return plain({ focus: await camera.autofocus() })
        case 'setFocusPoint':
            return plain(
                await camera.setFocusPoint(number(input, 'x'), number(input, 'y'), { autofocus: switchValue(input, 'autofocus') })
            )
        case 'resetFocusPoint':
            return plain(await camera.resetFocusPoint())
        case 'nudgeFocus':
            return plain(
                await camera.nudgeFocus(
                    oneOf(input, 'direction', ['near', 'far'] as const),
                    oneOf(input, 'size', ['small', 'medium', 'large'] as const)
                )
            )
        case 'zoomTo':
            return plain({ focalLengthMillimetres: await camera.zoomTo(number(input, 'focalLengthMillimetres')) })
        case 'startZoom':
            return plain(
                await camera.startZoom(oneOf(input, 'direction', ['in', 'out'] as const), {
                    speed: oneOf(input, 'speed', ['slow', 'medium', 'fast'] as const),
                })
            )
        case 'stopZoom':
            return plain(await camera.stopZoom())
        case 'takePhoto': {
            const autofocus = switchValue(input, 'autofocus')
            if (input.destination === 'computer') {
                const { data, ...photo } = await camera.takePhoto({ autofocus, destination: 'computer' })
                return { result: { ...photo, bytes: data.byteLength }, files: [{ role: 'photo', name: photo.name, mimeType: mimeTypeOf(photo.name), data }] }
            }
            return plain(await camera.takePhoto({ autofocus, destination: 'card' }))
        }
        case 'getLiveViewFrame': {
            const { jpeg, overlay, ...frame } = await camera.getLiveViewFrame({ overlay: switchValue(input, 'overlay') })
            const files: OperationFile[] = [{ role: 'frame', name: 'live-view.jpg', mimeType: 'image/jpeg', data: jpeg }]
            if (overlay) files.push({ role: 'overlay', name: 'overlay.png', mimeType: 'image/png', data: overlay.png })
            return { result: { ...frame, bytes: jpeg.byteLength, overlay: overlay !== undefined }, files }
        }
        case 'getRecordingState':
            return plain({ state: await camera.getRecordingState() })
        case 'startRecording':
            return plain(await camera.startRecording())
        case 'stopRecording':
            return plain(await camera.stopRecording())
        case 'getCardStatus':
            return plain(await camera.getCardStatus())
        case 'listMedia':
            return plain(await camera.listMedia())
        case 'getMediaPreview': {
            const id = text(input, 'id')
            const size = input.size === undefined ? 'thumbnail' : oneOf(input, 'size', ['thumbnail', 'preview'] as const)
            const data = await camera.getMediaPreview(id, size)
            return { result: { id, size, bytes: data.byteLength }, files: [{ role: 'preview', name: `${size}.jpg`, mimeType: 'image/jpeg', data }] }
        }
        case 'downloadMedia': {
            const id = text(input, 'id')
            const item = (await camera.listMedia()).find(candidate => candidate.id === id)
            const data = await camera.downloadMedia(id)
            const fileName = item?.name ?? 'download'
            return {
                result: { id, name: fileName, bytes: data.byteLength },
                files: [{ role: 'download', name: fileName, mimeType: mimeTypeOf(fileName), data }],
            }
        }
        case 'getBattery':
            return plain(await camera.getBattery())
        case 'setClock': {
            const moment = input.moment instanceof Date ? input.moment : new Date()
            await camera.setClock(moment)
            return plain({ clock: moment.toISOString() })
        }
    }
    throw new Error(`${name} is not an operation these surfaces run`)
}

const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    heif: 'image/heif',
    heic: 'image/heic',
    png: 'image/png',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
}

function mimeTypeOf(name: string): string {
    return mimeTypes[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}
