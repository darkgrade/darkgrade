import { SONY_CAMERA_BUTTONS, type SonyCameraButton } from '@camera/sony-camera'
import { performSonySdkControl } from '@vendors/sony/sdk-controls'
import { SONY_SDK_NAMED_PROPERTIES } from '@vendors/sony/sdk-property-codes'
import { SONY_SDK_SETTING_LABELS } from '@vendors/sony/sdk-setting-labels'

/** Local stdio bridge around Sony's licensed, documented Camera Remote SDK API. */
export interface SonySdkBridge {
    request(command: Record<string, string>): Promise<Record<string, unknown>>
    close(): Promise<void>
}

export interface SonyWifiAuthentication {
    host: string
    mac: string
    username: string
    password: string
    fingerprint: string
}

export interface SonySdkProperty {
    code: number
    name: string
    type: number
    value: string
    writable: boolean
    allowedValues?: string[]
    valueForm?: 'enum' | 'range'
    choices?: { value: string; label: string }[]
}

const propertyCodes = {
    ...SONY_SDK_NAMED_PROPERTIES,
    S1: 1,
    Aperture: 256,
    ExposureCompensation: 257,
    ShutterSpeed: 259,
    ISO: 260,
    ExposureProgram: 261,
    FileType: 262,
    ImageQuality: 263,
    WhiteBalance: 264,
    FocusMode: 265,
    MeteringMode: 266,
    DriveMode: 270,
    ImageSize: 272,
    AspectRatio: 273,
    FocusArea: 275,
    ColorTemperature: 277,
    ColorTuningAB: 278,
    ColorTuningGM: 279,
    LiveViewDisplayEffect: 280,
    FocusMagnifier: 285,
    FocusOperation: 287,
    AfAreaPosition: 289,
    ZoomScale: 292,
    ZoomSetting: 293,
    ZoomOperation: 294,
    MovieFileFormat: 295,
    MovieRecordingSetting: 296,
    MovieFrameRate: 297,
    AudioRecording: 411,
    AudioLevel: 412,
    PictureProfile: 426,
    CreativeLook: 453,
    CameraButtonFunction: 563,
    OsdImageMode: 709,
    RecordingState: 1797,
} as const

export const SONY_SDK_PROPERTY_CODES = propertyCodes

function fingerprintKey(value: string): string {
    const normalized = value.trim().replace(/^SHA256:/i, '')
    const hexadecimal = normalized.replace(/[:\s]/g, '')
    if (/^[0-9a-f]+$/i.test(hexadecimal)) return hexadecimal.toLowerCase()
    if (/^[A-Za-z0-9+/]{43}=?$/.test(normalized)) {
        const decoded = atob(normalized)
        if (decoded.length === 32)
            return [...decoded].map(character => character.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    }
    return normalized
}

export function validateSonyWifiAuthentication(authentication: SonyWifiAuthentication): void {
    if (
        !authentication ||
        ['host', 'mac', 'username', 'password', 'fingerprint'].some(
            field => typeof (authentication as unknown as Record<string, unknown>)[field] !== 'string'
        )
    )
        throw new Error('Sony Wi-Fi requires runtime authentication strings')
    const segments = authentication.host.split('.')
    if (segments.length !== 4 || segments.some(segment => !/^\d{1,3}$/.test(segment) || Number(segment) > 255))
        throw new Error('Sony Wi-Fi requires a valid IPv4 camera address')
    if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(authentication.mac))
        throw new Error('Sony Wi-Fi requires the camera MAC address')
    if (!authentication.username || !authentication.password || !authentication.fingerprint)
        throw new Error('Sony Wi-Fi requires runtime username, password, and a trusted camera fingerprint')
    if (
        [authentication.username, authentication.password, authentication.fingerprint].some(
            value => !/^[\x20-\x7e]+$/.test(value)
        )
    )
        throw new Error('Runtime authentication contains characters unsupported by the Sony SDK')
}

function numericValue(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number')
        throw new Error('The SDK bridge returned an invalid property value')
    if (typeof value === 'number' && !Number.isSafeInteger(value))
        throw new Error('SDK bridge must serialize large property values as decimal strings')
    const result = String(value)
    if (!/^-?\d+$/.test(result)) throw new Error('The SDK bridge returned a nonnumeric property value')
    return result
}

/**
 * Camera control over an authenticated Wi-Fi SDK session.
 * SDK property IDs differ from USB PTP IDs. This backend uses the SDK's public
 * property/command APIs; it does not emulate a raw PTP transport.
 */
export class SonyWifiCamera {
    private connected = false

    constructor(private readonly bridge: SonySdkBridge) {}

    isConnected(): boolean {
        return this.connected
    }

    async connect(
        authentication: SonyWifiAuthentication,
        options: { mode?: 'remote' | 'remote-transfer' } = {}
    ): Promise<void> {
        if (this.connected) throw new Error('Sony Wi-Fi camera is already connected')
        validateSonyWifiAuthentication(authentication)
        for (let attempt = 0; attempt < 3; attempt++) {
            const identity = { ip: authentication.host, mac: authentication.mac, ssh: '1' }
            let result: Record<string, unknown>
            try {
                result = await this.bridge.request({ cmd: 'fingerprint', ...identity })
            } catch (error) {
                if (attempt === 2 || !(error instanceof Error) || !/SDK code (33300|33304)/.test(error.message))
                    throw error
                await this.bridge.request({ cmd: 'disconnect' })
                await new Promise(resolve => setTimeout(resolve, 1500))
                continue
            }
            if (
                typeof result.fingerprint !== 'string' ||
                fingerprintKey(result.fingerprint) !== fingerprintKey(authentication.fingerprint)
            ) {
                throw new Error('Sony camera fingerprint does not match the trusted runtime fingerprint')
            }
            try {
                await this.bridge.request({
                    cmd: 'connect_wifi',
                    ...(options.mode ? { mode: options.mode } : {}),
                    ...identity,
                    user: authentication.username,
                    password: authentication.password,
                    fingerprint: result.fingerprint,
                })
                break
            } catch (error) {
                if (attempt === 2 || !(error instanceof Error) || !/SDK code (33282|33291|33296)/.test(error.message))
                    throw error
                await this.bridge.request({ cmd: 'disconnect' })
                await new Promise(resolve => setTimeout(resolve, 1500))
            }
        }
        this.connected = true
    }

    /** Open the same official SDK over USB for guarded preparation and readback. */
    async connectUsb(serial: string, options: { mode?: 'remote' | 'remote-transfer' } = {}): Promise<void> {
        if (this.connected) throw new Error('Sony SDK camera is already connected')
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(serial)) throw new Error('Invalid Sony USB serial')
        await this.bridge.request({ cmd: 'connect', serial, ...(options.mode ? { mode: options.mode } : {}) })
        this.connected = true
    }

    async disconnect(): Promise<void> {
        this.connected = false
        try {
            await this.bridge.request({ cmd: 'disconnect' })
        } finally {
            await this.bridge.close()
        }
    }

    private requireConnection(): void {
        if (!this.connected) throw new Error('Sony Wi-Fi camera is not connected')
    }

    async getSonyPropertyStates(): Promise<SonySdkProperty[]> {
        this.requireConnection()
        const response = await this.bridge.request({ cmd: 'properties' })
        if (!Array.isArray(response.properties)) throw new Error('The SDK bridge returned no camera properties')
        return response.properties
            .filter(property => property.type !== 0xffff && (property.type & 0xf) >= 1 && (property.type & 0xf) <= 4)
            .map(property => {
                const code = Number(property.code)
                if (!Number.isInteger(code) || code < 0 || !Number.isInteger(property.type))
                    throw new Error('The SDK bridge returned an invalid property descriptor')
                return {
                    code,
                    name:
                        Object.entries(propertyCodes).find(([, value]) => value === code)?.[0] ??
                        `SDK property 0x${code.toString(16)}`,
                    type: property.type,
                    value:
                        property.type & 0x1000 && (property.type & 0xf) <= 4
                            ? BigInt.asIntN(
                                  8 << ((property.type & 0xf) - 1),
                                  BigInt(numericValue(property.value))
                              ).toString()
                            : numericValue(property.value),
                    writable: property.writable === true,
                    ...(Array.isArray(property.allowedValues)
                        ? {
                              allowedValues: property.allowedValues.map(numericValue),
                              choices:
                                  property.valueForm === 'range'
                                      ? undefined
                                      : property.allowedValues.map((value: unknown) => ({
                                            value: numericValue(value),
                                            label:
                                                SONY_SDK_SETTING_LABELS[code]?.[numericValue(value)] ||
                                                numericValue(value),
                                        })),
                              valueForm: property.valueForm === 'range' ? ('range' as const) : ('enum' as const),
                          }
                        : {}),
                }
            })
    }

    async getSonyProperty(nameOrCode: keyof typeof propertyCodes | number): Promise<SonySdkProperty> {
        const code = typeof nameOrCode === 'number' ? nameOrCode : propertyCodes[nameOrCode]
        const property = (await this.getSonyPropertyStates()).find(property => property.code === code)
        if (!property) throw new Error('The camera does not advertise the requested SDK property')
        return property
    }

    /** Search only settings actually advertised by the connected camera. */
    async getSonyCapabilities(query = ''): Promise<SonySdkProperty[]> {
        const aliases: Record<string, string> = {
            gain: 'ISO',
            wb: 'white balance',
            'f-stop': 'aperture',
            fstop: 'aperture',
            colour: 'color',
        }
        const words = (aliases[query.trim().toLowerCase()] || query)
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean)
        return (await this.getSonyPropertyStates()).filter(property => {
            const names = Object.entries(propertyCodes)
                .filter(([, code]) => code === property.code)
                .map(([name]) => name)
                .join(' ')
            const searchable = (
                property.name.replace(/([a-z])([A-Z])/g, '$1 $2') +
                ' ' +
                property.name +
                ' ' +
                names
            ).toLowerCase()
            return words.every(word => searchable.includes(word) || String(property.code) === word)
        })
    }

    /** Set an advertised setting by its SDK name and confirm the camera readback. */
    async setSonySetting(
        nameOrCode: string | number,
        value: number | bigint
    ): Promise<{
        before: SonySdkProperty
        after: SonySdkProperty
        verified: true
    }> {
        const normalize = (name: string) => name.replace(/[^a-z0-9]/gi, '').toLowerCase()
        const properties = await this.getSonyPropertyStates()
        const requestedCode =
            typeof nameOrCode === 'number'
                ? nameOrCode
                : Object.entries(propertyCodes).find(([name]) => normalize(name) === normalize(nameOrCode))?.[1]
        const before = properties.find(
            property =>
                property.code === requestedCode ||
                (typeof nameOrCode === 'string' && normalize(property.name) === normalize(nameOrCode))
        )
        if (!before)
            throw new Error('The camera does not advertise that setting; search capabilities for its exact name')
        await this.setSonyProperty(before.code, value)
        const deadline = Date.now() + 5000
        let after: SonySdkProperty
        do {
            await new Promise(resolve => setTimeout(resolve, 200))
            after = await this.getSonyProperty(before.code)
        } while (after.value !== String(value) && Date.now() < deadline)
        if (after.value !== String(value)) throw new Error('The camera did not confirm the requested setting')
        return { before, after, verified: true }
    }

    async setSonyProperty(nameOrCode: keyof typeof propertyCodes | number, value: number | bigint): Promise<void> {
        const property = await this.getSonyProperty(nameOrCode)
        if (!property.writable) throw new Error('The SDK property is currently read-only')
        const requested = BigInt(value)
        if (
            property.allowedValues?.length &&
            property.valueForm === 'enum' &&
            !property.allowedValues.some(candidate => BigInt(candidate) === requested)
        )
            throw new Error('The camera does not offer the requested property value')
        if (property.allowedValues?.length === 3 && property.valueForm === 'range') {
            const [minimum, maximum, step] = property.allowedValues.map(candidate => BigInt(candidate))
            if (requested < minimum! || requested > maximum! || (step! > 0n && (requested - minimum!) % step !== 0n))
                throw new Error('The requested property value is outside the camera range')
        }
        await this.writeProperty(property.code, property.type, value)
    }

    private async writeProperty(code: number, type: number, value: number | bigint): Promise<void> {
        this.requireConnection()
        if (typeof value === 'number' && !Number.isSafeInteger(value))
            throw new Error('SDK property values must be exact integers')
        const scalarType = type & 0xf
        if (scalarType < 1 || scalarType > 4 || type === 0xffff)
            throw new Error('This SDK backend supports numeric properties up to 64 bits')
        const bits = BigInt(8 << (scalarType - 1))
        const signed = (type & 0x1000) !== 0
        const minimum = signed ? -(1n << (bits - 1n)) : 0n
        const maximum = (1n << (signed ? bits - 1n : bits)) - 1n
        if (BigInt(value) < minimum || BigInt(value) > maximum)
            throw new Error('SDK property value exceeds its numeric datatype')
        await this.bridge.request({ cmd: 'set', code: String(code), type: String(type), value: String(value) })
    }

    async sonyPressButton(button: SonyCameraButton, options: { holdMilliseconds?: number } = {}): Promise<void> {
        const identifier = SONY_CAMERA_BUTTONS[button]
        if (!identifier) throw new Error('Unsupported Sony camera button')
        const holdMilliseconds = options.holdMilliseconds ?? 150
        if (!Number.isInteger(holdMilliseconds) || holdMilliseconds < 30 || holdMilliseconds > 2000)
            throw new Error('Button duration must be 30–2000 milliseconds')
        const prefix = identifier << 16
        try {
            await this.writeProperty(propertyCodes.CameraButtonFunction, 0x4003, prefix | 2)
            await new Promise(resolve => setTimeout(resolve, holdMilliseconds))
        } finally {
            await this.writeProperty(propertyCodes.CameraButtonFunction, 0x4003, prefix | 1)
        }
    }

    async autofocus(durationMilliseconds = 500): Promise<void> {
        if (!Number.isInteger(durationMilliseconds) || durationMilliseconds < 30 || durationMilliseconds > 5000)
            throw new Error('Autofocus duration must be 30–5000 milliseconds')
        try {
            await this.writeProperty(propertyCodes.S1, 2, 2)
            await new Promise(resolve => setTimeout(resolve, durationMilliseconds))
        } finally {
            await this.writeProperty(propertyCodes.S1, 2, 1)
        }
    }

    async setSonyAfAreaPosition(x: number, y: number): Promise<void> {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 639 || y < 0 || y > 479)
            throw new Error('AF-area position must be within 640×480')
        await this.writeProperty(propertyCodes.AfAreaPosition, 3, (x << 16) | y)
    }

    async zoomSony(direction: 'wide' | 'tele', durationMilliseconds = 500): Promise<void> {
        if (
            !['wide', 'tele'].includes(direction) ||
            !Number.isInteger(durationMilliseconds) ||
            durationMilliseconds < 30 ||
            durationMilliseconds > 5000
        )
            throw new Error('Invalid Sony zoom direction or duration')
        try {
            await this.writeProperty(propertyCodes.ZoomOperation, 0x1001, direction === 'tele' ? 1 : -1)
            await new Promise(resolve => setTimeout(resolve, durationMilliseconds))
        } finally {
            await this.writeProperty(propertyCodes.ZoomOperation, 0x1001, 0)
        }
    }

    async captureImage(): Promise<void> {
        this.requireConnection()
        try {
            await this.bridge.request({ cmd: 'command', id: '0', param: '1' })
            await new Promise(resolve => setTimeout(resolve, 300))
        } finally {
            await this.bridge.request({ cmd: 'command', id: '0', param: '0' })
        }
    }

    async startRecording(): Promise<void> {
        this.requireConnection()
        await this.bridge.request({ cmd: 'command', id: '1', param: '1' })
    }

    async stopRecording(): Promise<void> {
        this.requireConnection()
        await this.bridge.request({ cmd: 'command', id: '1', param: '0' })
    }

    /** Completed camera-to-host transfer through Sony's documented download callback. */
    async captureAndDownload(directory: string): Promise<Record<string, unknown>> {
        this.requireConnection()
        if (!directory.startsWith('/') || /[\r\n\0]/.test(directory))
            throw new Error('An absolute download directory is required')
        const original = await this.getSonyProperty('StillImageStoreDestination')
        const priority = await this.getSonyProperty('PriorityKeySettings')
        const fileType = await this.getSonyProperty('FileType')
        const pcFormat = await this.getSonyProperty('RAW_J_PC_Save_Image').catch(() => undefined)
        const fileCount =
            ['3', '4'].includes(fileType.value) && (!pcFormat || ['0', '3'].includes(pcFormat.value)) ? '2' : '1'
        const target = original.value === '2' ? 3 : Number(original.value)
        if (![1, 3].includes(target)) throw new Error('The camera does not offer a PC photo destination')
        try {
            if (priority.value !== '2') await this.setSonySetting('PriorityKeySettings', 2)
            await this.bridge.request({ cmd: 'save_info', path: directory, prefix: 'DG' })
            // Reapply the destination for this connection even when the body retained
            // its previous value; SDK photo delivery must be prepared before release.
            await this.setSonySetting('StillImageStoreDestination', target)
            await new Promise(resolve => setTimeout(resolve, 2000))
            await this.captureImage()
            try {
                return await this.bridge.request({ cmd: 'wait_download', count: fileCount })
            } catch (error) {
                const detail = error instanceof Error ? error.message : 'Camera download failed'
                throw new Error(
                    detail +
                        '. Photo delivery did not complete; check focus lock or choose Manual focus, and confirm the shutter and save destination are available.'
                )
            }
        } finally {
            try {
                if (original.value !== String(target))
                    await this.setSonySetting('StillImageStoreDestination', BigInt(original.value))
            } finally {
                if (priority.value !== '2') await this.setSonySetting('PriorityKeySettings', BigInt(priority.value))
            }
        }
    }

    async applySonyControl(action: string, value?: string | number): Promise<Record<string, unknown>> {
        return await performSonySdkControl(this, action, value)
    }

    async getSonyFocusFrames(): Promise<Record<string, unknown>[]> {
        this.requireConnection()
        const result = await this.bridge.request({ cmd: 'focus_frames' })
        if (!Array.isArray(result.frames)) throw new Error('The camera returned no focus-frame information')
        return result.frames
    }

    /** Place an AF spot and verify its position through live-view frame information. */
    async placeSonyFocusPoint(x: number, y: number): Promise<Record<string, unknown>> {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 639 || y < 0 || y > 479)
            throw new Error('AF-area position must be within 640×480')
        const mode = await this.getSonyProperty('FocusMode')
        if (['1', '6'].includes(mode.value))
            throw new Error('Choose AF-S, AF-A or AF-C before placing an autofocus point')
        const area = await this.getSonyProperty('FocusArea')
        const priority = await this.getSonyProperty('PriorityKeySettings')
        if (priority.value !== '2') await this.setSonySetting('PriorityKeySettings', 2)
        const before = await this.getSonyFocusFrames()
        if (!['4', '5', '6', '7'].includes(area.value)) await this.setSonySetting('FocusArea', 4)
        await this.setSonyAfAreaPosition(x, y)
        const deadline = Date.now() + 6000
        let frames: Record<string, unknown>[] = [],
            matched: Record<string, unknown> | undefined
        do {
            await new Promise(resolve => setTimeout(resolve, 200))
            frames = await this.getSonyFocusFrames()
            matched = frames.find(
                frame =>
                    Number(frame.xDenominator) > 0 &&
                    Number(frame.yDenominator) > 0 &&
                    Math.abs((Number(frame.xNumerator) * 640) / Number(frame.xDenominator) - x) <= 4 &&
                    Math.abs((Number(frame.yNumerator) * 480) / Number(frame.yDenominator) - y) <= 4
            )
        } while (!matched && Date.now() < deadline)
        if (!matched)
            throw new Error('The camera did not confirm the requested AF point in its live-view frame information')
        return {
            requested: { x, y },
            before,
            frames,
            positionVerified: true,
            focusAcquired: false,
            previousFocusArea: area,
            previousPriority: priority,
        }
    }

    async getRecentSonyContents(): Promise<Record<string, unknown>[]> {
        this.requireConnection()
        const deadline = Date.now() + 15_000
        while (true) {
            try {
                const result = await this.bridge.request({ cmd: 'recent_contents' })
                if (!Array.isArray(result.contents)) throw new Error('The camera returned no recent contents')
                return result.contents
            } catch (error) {
                // The documented contents-list operation is asynchronous after connecting or writing a file.
                if (!(error instanceof Error) || !/SDK code 36101/.test(error.message) || Date.now() >= deadline)
                    throw error
                await new Promise(resolve => setTimeout(resolve, 250))
            }
        }
    }

    async downloadSonyContent(
        content: number,
        file: number,
        directory: string,
        filename: string
    ): Promise<Record<string, unknown>> {
        this.requireConnection()
        if (
            !Number.isInteger(content) ||
            content < 1 ||
            !Number.isInteger(file) ||
            file < 0 ||
            !directory.startsWith('/') ||
            !filename ||
            /[\/\\\r\n\0]/.test(filename)
        )
            throw new Error('Invalid Sony download destination or content identifier')
        return await this.bridge.request({
            cmd: 'download_content',
            content: String(content),
            file: String(file),
            directory,
            filename,
        })
    }

    async captureLiveView(filename: string): Promise<Record<string, unknown>> {
        this.requireConnection()
        return await this.bridge.request({ cmd: 'liveview', path: filename })
    }

    async captureSonyOsdImage(filename: string): Promise<Record<string, unknown>> {
        await this.setSonyProperty('OsdImageMode', 1)
        const deadline = Date.now() + 5000
        while ((await this.getSonyProperty('OsdImageMode')).value !== '1') {
            if (Date.now() >= deadline) throw new Error('The camera did not enable its OSD image')
            await new Promise(resolve => setTimeout(resolve, 200))
        }
        await new Promise(resolve => setTimeout(resolve, 500))
        return await this.bridge.request({ cmd: 'osd', path: filename })
    }
}
