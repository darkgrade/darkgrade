import { cameraOperations } from '@generated/camera-operations'
import type { Camera } from '@camera/index'

/**
 * The public Camera operations as the MCP tools and the CLI run them. The list is generated at
 * build time from Camera's own signatures and doc comments (scripts/generate-camera-operations.ts),
 * so every surface has the library's names, inputs and results. Type-only Camera imports keep
 * this module free of drivers, so the browser runtime can carry it.
 */

/**
 * One input of an operation, the same on every surface: a named MCP argument, and on the CLI a
 * positional argument when required, otherwise a flag.
 */
export interface OperationParameter {
    /** The library's own name for it (`focalLengthMillimetres`); kebab-case on the CLI. */
    name: string
    /** `time` is ISO 8601 text, given to the library as a Date. */
    type: 'text' | 'number' | 'switch' | 'choice' | 'time'
    choices?: readonly string[]
    required?: boolean
    description: string
    /** The method argument this input fills, counting from 0. */
    argument: number
    /** Set when the input is a property of an options object in that argument. */
    property?: string
}

/** One public Camera method as the generator read it. */
export interface CameraOperationDescription {
    /** The library's method name (`takePhoto`); `discover` is the static `Camera.discover`. */
    name: string
    static?: boolean
    /** The first sentence of the method's doc comment. */
    summary: string
    parameters: readonly OperationParameter[]
}

export interface SurfaceOperation extends CameraOperationDescription {
    /** `camera_take_photo`. */
    mcpTool: string
    /** `darkgrade camera take-photo` (`darkgrade cameras` for discover). */
    cliCommand: string
    /** Stopping never waits behind other camera work, so these run as soon as they are asked for. */
    immediate: boolean
    /** Reads without changing the camera. */
    readOnly: boolean
}

/** One call's inputs by parameter name, as an MCP client or the command line gave them. */
export type OperationInput = Readonly<Record<string, unknown>>

/** A file an operation returned: a live-view frame, a preview, a photo's or a download's bytes. */
export interface OperationFile {
    role: 'photo' | 'frame' | 'overlay' | 'preview' | 'download'
    /** A name to save it under. */
    name: string
    mimeType: string
    data: Uint8Array
}

/** An operation's result, as the library returned it, with its bytes moved out into files. */
export interface OperationOutcome {
    result: unknown
    files: OperationFile[]
}

/** A call's inputs do not match the operation's parameters; nothing was sent to a camera. */
export class OperationInputError extends Error {
    override name = 'OperationInputError'
}

const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(' ')
export const snakeCase = (name: string) => words(name).join('_')
export const kebabCase = (name: string) => words(name).join('-')

const immediateOperations = new Set(['stopZoom', 'stopRecording'])

let surfaces: SurfaceOperation[] | undefined

/** Every public operation with its MCP and CLI names, in Camera's declaration order. */
export function surfaceOperations(): readonly SurfaceOperation[] {
    surfaces ??= cameraOperations.map(operation => ({
        ...operation,
        mcpTool: `camera_${snakeCase(operation.name)}`,
        // The one exception to the naming rule: it lists cameras rather than acting on one.
        cliCommand: operation.name === 'discover' ? 'darkgrade cameras' : `darkgrade camera ${kebabCase(operation.name)}`,
        immediate: immediateOperations.has(operation.name),
        readOnly: operation.name === 'discover' || /^(get|list|download)[A-Z]/.test(operation.name),
    }))
    return surfaces
}

export function surfaceOperation(name: string): SurfaceOperation | undefined {
    return surfaceOperations().find(operation => operation.name === name)
}

/**
 * Checks one call's inputs against the operation's parameters and converts them: numbers from
 * numeric text, `time` to a Date. Unknown names and missing required inputs are refused before
 * anything reaches a camera.
 */
export function readOperationInput(operation: CameraOperationDescription, input: OperationInput): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationInputError(`${operation.name} takes named inputs`)
    const known = new Set(operation.parameters.map(parameter => parameter.name))
    const unknown = Object.keys(input).filter(name => !known.has(name))
    if (unknown.length) throw new OperationInputError(`${operation.name} has no input ${unknown.join(', ')}`)
    const read: Record<string, unknown> = {}
    for (const parameter of operation.parameters) {
        const value = input[parameter.name]
        if (value === undefined) {
            if (parameter.required) throw new OperationInputError(`${operation.name} needs ${parameter.name}: ${parameter.description}`)
            continue
        }
        read[parameter.name] = readParameter(operation.name, parameter, value)
    }
    return read
}

function readParameter(operation: string, parameter: OperationParameter, value: unknown): unknown {
    const refuse = () =>
        new OperationInputError(
            `${operation}: ${parameter.name} must be ${parameter.choices ? `one of ${parameter.choices.join(', ')}` : parameter.description}`
        )
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

/** The method's arguments, in order: positional inputs, and options objects from their properties. */
function argumentsFor(operation: CameraOperationDescription, input: Record<string, unknown>): unknown[] {
    const values: unknown[] = []
    for (const parameter of operation.parameters) {
        const value = input[parameter.name]
        if (value === undefined) continue
        if (parameter.property === undefined) values[parameter.argument] = value
        else {
            const options = (values[parameter.argument] ??= {})
            if (typeof options === 'object' && options) Reflect.set(options, parameter.property, value)
        }
    }
    // Kelvin is a number to the library; on the command line and in MCP it arrives as text.
    if (operation.name === 'setControl' && values[0] === 'colorTemperature' && typeof values[1] === 'string' && values[1].trim())
        values[1] = Number.isFinite(Number(values[1])) ? Number(values[1]) : values[1]
    return values
}

const fileRoles: Readonly<Record<string, OperationFile['role']>> = {
    takePhoto: 'photo',
    getLiveViewFrame: 'frame',
    getMediaPreview: 'preview',
    downloadMedia: 'download',
}

const mimeTypes: Readonly<Record<string, string>> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    heif: 'image/heif',
    heic: 'image/heic',
    png: 'image/png',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
}

/** By the file name the camera gave it, else by the bytes' own signature. */
function mimeTypeOf(data: Uint8Array, name?: string): string {
    const byName = name && mimeTypes[name.split('.').pop()?.toLowerCase() ?? '']
    if (byName) return byName
    if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg'
    if (data[0] === 0x89 && data[1] === 0x50) return 'image/png'
    return 'application/octet-stream'
}

/**
 * Moves every byte array out of a result into files, leaving `{ file, bytes }` in its place, so the
 * rest of the result is exactly what the library returned and stays JSON.
 */
function separateFiles(operation: string, result: unknown, input: Record<string, unknown>): OperationOutcome {
    const files: OperationFile[] = []
    const extract = (value: unknown, key: string, siblingName?: string): unknown => {
        if (value instanceof Uint8Array) {
            const role: OperationFile['role'] = key === 'overlay' || key === 'png' ? 'overlay' : (fileRoles[operation] ?? 'download')
            const mimeType = mimeTypeOf(value, siblingName)
            const extension = mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/png' ? '.png' : ''
            const fallback = `${typeof input.id === 'string' ? input.id : kebabCase(operation)}-${role}${extension}`
            const name = (siblingName ?? fallback).replace(/[/\\]/g, '_')
            files.push({ role, name, mimeType, data: value })
            return { file: name, bytes: value.byteLength }
        }
        if (!value || typeof value !== 'object' || value instanceof Date) return value
        if (Array.isArray(value)) return value.map(item => extract(item, key))
        const name = 'name' in value && typeof value.name === 'string' ? value.name : undefined
        return Object.fromEntries(Object.entries(value).map(([entry, item]) => [entry, extract(item, entry, name)]))
    }
    return { result: extract(result, operation) ?? null, files }
}

/** Runs one public operation on a Camera with inputs already read by `readOperationInput`. */
export async function runOperation(camera: Camera, name: string, input: Record<string, unknown>): Promise<OperationOutcome> {
    const operation = surfaceOperation(name)
    const method: unknown = operation && !operation.static ? Reflect.get(camera, name) : undefined
    if (!operation || typeof method !== 'function') throw new Error(`${name} is not an operation these surfaces run`)
    const result: unknown = await Reflect.apply(method, camera, argumentsFor(operation, input))
    return separateFiles(name, result, input)
}
