import { CanonCamera } from '@camera/canon-camera'
import { CameraConfirmationError, confirmCameraValue } from '@camera/confirmation'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import {
    cameraControlDefinitions,
    type CameraCapabilities,
    type CameraControlId,
    type CameraControlInputs,
    type CameraControlState,
    type UnrecognizedValues,
} from '@camera/controls'
import {
    exposureSeconds,
    matchExposureTime,
    parseExposureTime,
    type ExposureContext,
    type ExposureTimeInput,
} from '@camera/exposure-time'
import { GenericCamera } from '@camera/generic-camera'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import { SonyCamera } from '@camera/sony-camera'
import { PTPDecodeError, PTPResponseError } from '@core/ptp-errors'
import type { DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { recognizedDescriptorValues, type DevicePropDesc } from '@ptp/datasets/device-prop-desc-dataset'
import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import type { CodecInstance } from '@ptp/types/codec'
import type { PropertyDefinition } from '@ptp/types/property'
import {
    canonControlProperties,
    nikonMovieControlProperties,
    nikonPhotoControlProperties,
    sonyControlProperties,
    standardControlProperties,
    type ControlPropertyMap,
} from '@vendors/control-properties'
import { nikonControlLabel } from '@vendors/nikon/control-values'
import { MovieShutterAngle } from '@vendors/nikon/video-properties'
import { readNikonRecordingStatus } from '@vendors/nikon/recording-status'
import { NikonShotControls } from '@vendors/nikon/shot-controls'
import { canonPhotoVideoModeState, sonyPhotoVideoModeState, writePhotoVideoMode } from '@vendors/photo-video-mode'

interface PropertyState {
    code: number
    name: string
    value: string | number | bigint
    allowedValues?: (string | number | bigint)[]
    writable: boolean
    enabled?: boolean
    range?: CameraControlState['range']
    unrecognized?: UnrecognizedValues
}

const scalar = (value: unknown): value is string | number | bigint =>
    typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint'

function canonLabel(value: unknown): string | number | bigint | undefined {
    if (scalar(value)) return value
    if (value && typeof value === 'object' && 'label' in value && typeof value.label === 'string') return value.label
}

function descriptorState(descriptor: DevicePropDesc): PropertyState {
    const range =
        descriptor.formFlag === 1 &&
        [descriptor.minimumValue, descriptor.maximumValue, descriptor.stepSize].every(
            value => typeof value === 'number'
        )
            ? {
                  minimum: Number(descriptor.minimumValue),
                  maximum: Number(descriptor.maximumValue),
                  step: Number(descriptor.stepSize),
              }
            : undefined
    const { allowedValues, unrecognized } = recognizedDescriptorValues(descriptor)
    return {
        code: descriptor.devicePropertyCode,
        name: descriptor.devicePropertyName,
        value: descriptor.currentValueDecoded,
        allowedValues,
        writable: descriptor.getSet === 'GET_SET',
        ...(range ? { range } : {}),
        ...(unrecognized && { unrecognized }),
    }
}

async function nikonStates(
    camera: NikonCamera,
    advertised: Set<number>,
    operations: readonly number[],
    requested?: CameraControlId
) {
    if (operations.includes(camera.registry.operations.GetVendorCodes.code))
        for (const code of await camera.getVendorPropertyCodes()) advertised.add(code)
    let movie: boolean | undefined
    if (advertised.has(camera.registry.properties.LiveViewSelector.code)) {
        const selector = await camera.get(camera.registry.properties.LiveViewSelector)
        if (selector !== 'PHOTO' && selector !== 'VIDEO') throw new PTPDecodeError('Unknown Nikon photo/movie selector')
        movie = selector === 'VIDEO'
    }
    // Unknown mode cannot safely select a movie or still extension.
    const mappings: { -readonly [Id in CameraControlId]?: ControlPropertyMap[Id] } =
        movie === true
            ? { ...nikonMovieControlProperties }
            : movie === false
              ? { ...nikonPhotoControlProperties }
              : { ...standardControlProperties }
    if (
        movie &&
        (requested === undefined || requested === 'shutterSpeed') &&
        advertised.has(camera.registry.properties.MovieShutterMode.code)
    ) {
        const mode = await camera.get(camera.registry.properties.MovieShutterMode)
        if (mode === 'SHUTTER_ANGLE') mappings.shutterSpeed = [MovieShutterAngle]
        else if (mode !== 'SHUTTER_SPEED') throw new PTPDecodeError('Unknown Nikon shutter control mode')
    }
    const states: PropertyState[] = []
    const readISO = requested === undefined || requested === 'iso'
    const names = [
        ...new Set([
            ...(requested === undefined ? Object.values(mappings).flat() : (mappings[requested] ?? [])).map(
                property => property.name
            ),
            ...(readISO && movie === true
                ? ['NikonMovieAutoISO', 'ExposureProgramMode']
                : readISO && movie === false
                  ? ['NikonPhotoAutoISO']
                  : []),
        ]),
    ]
    for (const name of names) {
        const property = (camera.registry.properties as Record<string, PropertyDefinition>)[name]
        if (!property || !advertised.has(property.code)) continue
        try {
            states.push(descriptorState(await camera.propertyDescriptor(property)))
        } catch (error) {
            if (!(error instanceof PTPResponseError) || ![0x2005, 0x200a].includes(error.code)) throw error
        }
    }
    if (movie) {
        const iso = states.find(state => state.name === 'NikonMovieISO')
        const auto = states.find(state => state.name === 'NikonMovieAutoISO')
        const program = states.find(state => state.name === 'ExposureProgramMode')
        if (iso && (!auto || auto.value !== 0 || program?.value !== 'Manual')) {
            iso.value = 'Auto'
            iso.writable = false
        }
    }
    if (movie === false) {
        const iso = states.find(state => state.name === 'ExposureIndex')
        const auto = states.find(state => state.name === 'NikonPhotoAutoISO')
        if (iso && auto && auto.value !== 0) {
            if (auto.value === 1) iso.value = 'Auto'
            iso.writable = false
        }
    }
    return { states, mappings }
}

/** Adapt existing observed inventories; a static registry entry alone never becomes a capability. */
export async function readCameraCapabilities(
    camera: GenericCamera,
    requested?: CameraControlId
): Promise<CameraCapabilities> {
    // Sony/Canon publish authoritative live property inventories in one bulk operation.
    // Standard targeted reads perform their own advertised-property discovery below.
    let inventory: DeviceInfo | undefined
    if (requested === undefined || camera instanceof NikonCamera) {
        const response = await camera.send(camera.registry.operations.GetDeviceInfo, {})
        if (response.code !== 0x2001) throw new PTPResponseError(response.code, 'Camera capability inventory refused')
        if (!response.data) throw new PTPDecodeError('Camera capability inventory has no DeviceInfo')
        inventory = response.data
    }
    let states: PropertyState[]
    let mappings: ControlPropertyMap<CameraControlId>
    // Controls composed from more than one observation (see `@vendors/photo-video-mode`).
    let composed: CameraCapabilities['controls'] = {}
    if (camera instanceof SonyCamera) {
        const observed = await camera.refreshPropertyStates()
        const iso = camera.isoControlState(observed)
        states = observed.map(state => (state.name === 'Iso' && iso ? iso : state))
        mappings = sonyControlProperties
        composed = { photoVideoMode: sonyPhotoVideoModeState(observed) }
    } else if (camera instanceof CanonCamera) {
        await camera.refreshEventProperties()
        composed = { photoVideoMode: canonPhotoVideoModeState(camera) }
        states = camera
            .listPropertyStates()
            .flatMap(state => {
                const value = canonLabel(state.value) ?? state.unrecognized?.value
                return value === undefined ? [] : [{ ...state, value }]
            })
            .map(state => ({
                code: state.code,
                name: state.name,
                value: state.value,
                allowedValues: state.allowedValues?.map(canonLabel).filter(scalar),
                // Canon event inventories do not carry a dynamic get/set flag.
                writable: state.access === 'GetSet' && Boolean(state.allowedValues?.length),
                ...(state.unrecognized && { unrecognized: state.unrecognized }),
            }))
        mappings = canonControlProperties
    } else if (camera instanceof NikonCamera) {
        ;({ states, mappings } = await nikonStates(
            camera,
            new Set(inventory!.devicePropertiesSupported),
            inventory!.operationsSupportedRaw,
            requested
        ))
    } else {
        const standardMappings: ControlPropertyMap<CameraControlId> = standardControlProperties
        states = (await camera.getStandardPropertyStates(requested ? standardMappings[requested]?.[0]?.name : undefined)).map(
            state => ({
                ...state,
                ...(typeof state.minimumValue === 'number' &&
                typeof state.maximumValue === 'number' &&
                typeof state.stepSize === 'number'
                    ? { range: { minimum: state.minimumValue, maximum: state.maximumValue, step: state.stepSize } }
                    : {}),
            })
        )
        mappings = standardControlProperties
    }
    const controls: CameraCapabilities['controls'] = {}
    for (const id of Object.keys(mappings) as CameraControlId[]) {
        const state = mappings[id]?.map(property => states.find(state => state.name === property.name)).find(Boolean)
        if (!state) continue
        const label = (value: string | number | bigint) =>
            camera instanceof NikonCamera && value !== 'Auto' ? nikonControlLabel(state.name, value) : String(value)
        const definition = cameraControlDefinitions[id]
        const value = label(state.value),
            allowedValues = state.allowedValues?.map(label)
        const knownExposure =
            id !== 'shutterSpeed' ||
            typeof state.value === 'string' ||
            (camera instanceof NikonCamera &&
                ['NikonMovieShutterSpeed', 'NikonPhotoShutterSpeed', 'MovieShutterAngle'].includes(state.name))
        const unrecognizedValue = state.unrecognized?.value
        let exposureTime: CameraControlState['exposureTime']
        if (id === 'shutterSpeed' && knownExposure && unrecognizedValue === undefined) {
            try {
                exposureTime = parseExposureTime(value)
            } catch {
                /* Preserve the unknown observation without inventing units. */
            }
        }
        const uniqueChoices = !allowedValues || new Set(allowedValues).size === allowedValues.length
        controls[id] = {
            id,
            label: definition.label,
            aliases: definition.aliases,
            source: { name: state.name, code: state.code, protocol: 'ptp' },
            value:
                unrecognizedValue !== undefined
                    ? `Unrecognized (${unrecognizedValue})`
                    : id === 'shutterSpeed' && !exposureTime
                      ? `Unknown exposure (${value})`
                      : value,
            ...(allowedValues ? { allowedValues } : {}),
            enabled: state.enabled !== false,
            writable:
                unrecognizedValue === undefined &&
                state.writable &&
                state.enabled !== false &&
                (id !== 'shutterSpeed' || Boolean(exposureTime)) &&
                uniqueChoices &&
                (allowedValues === undefined || allowedValues.length > 0),
            ...(state.range
                ? {
                      range:
                          id === 'shutterSpeed' && (state.name === 'ExposureTime' || state.name === 'MovieShutterAngle')
                              ? {
                                    minimum: state.range.minimum / (state.name === 'ExposureTime' ? 10000 : 100),
                                    maximum: state.range.maximum / (state.name === 'ExposureTime' ? 10000 : 100),
                                    step: state.range.step / (state.name === 'ExposureTime' ? 10000 : 100),
                                }
                              : state.range,
                  }
                : {}),
            ...(exposureTime ? { exposureTime } : {}),
            ...(state.unrecognized && { unrecognized: { ...state.unrecognized } }),
        }
    }
    for (const [id, state] of Object.entries(composed) as [CameraControlId, CameraControlState | undefined][])
        if (state && (requested === undefined || requested === id)) controls[id] = state
    return {
        observedAt: Date.now(),
        controls,
        advertisedOperations: inventory ? [...inventory.operationsSupportedRaw] : null,
    }
}

/** Application writes share one admission path; vendor encodings stay here. */
export async function writeCameraControl<Id extends CameraControlId>(
    owner: Camera,
    driver: GenericCamera,
    id: Id,
    value: CameraControlInputs[Id],
    context?: ExposureContext
): Promise<CameraControlState> {
    if (id === 'photoVideoMode')
        return writePhotoVideoMode(owner, driver, String(value), async () =>
            (await readCameraCapabilities(driver, id)).controls.photoVideoMode
        )
    // Nikon descriptors are separate transactions: refresh this control and its live guards,
    // rather than reading every unrelated descriptor before each write. No cached admission.
    const state = (await readCameraCapabilities(driver, id)).controls[id]
    if (!state?.enabled || !state.writable)
        throw new CameraUnsupportedError(id, `${id} is not writable in the current camera mode`)
    let requested: string
    if (id === 'shutterSpeed') {
        const choices = state.allowedValues ?? []
        const matched = matchExposureTime(value as ExposureTimeInput, choices, context)
        if (matched) requested = matched
        else if (state.range && ['ExposureTime', 'MovieShutterAngle'].includes(state.source.name)) {
            const exposure = parseExposureTime(value as ExposureTimeInput)
            const numeric =
                state.source.name === 'ExposureTime'
                    ? exposureSeconds(exposure, context)
                    : exposure.kind === 'angle'
                      ? exposure.degrees
                      : exposure.kind === 'duration'
                        ? (exposure.seconds * 360) / exposureSeconds('360°', context)!
                        : undefined
            const { minimum, maximum, step } = state.range
            if (
                numeric === undefined ||
                numeric < minimum ||
                numeric > maximum ||
                (step > 0 && Math.abs((numeric - minimum) / step - Math.round((numeric - minimum) / step)) > 1e-8)
            )
                throw new CameraRefusedError(id, 'Requested exposure time is outside the camera range')
            requested = String(numeric) + (state.source.name === 'MovieShutterAngle' ? '°' : '')
        } else throw new CameraRefusedError(id, 'Requested exposure time is not advertised by the camera')
    } else {
        if (
            id === 'colorTemperature' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== 'string'
        )
            throw new CameraRefusedError(id, `Invalid ${id} value`)
        requested = String(value)
        if (state.allowedValues && !state.allowedValues.includes(requested))
            throw new CameraRefusedError(id, `Requested ${id} value is not advertised by the camera`)
        if (state.range) {
            const numeric = Number(requested),
                { minimum, maximum, step } = state.range
            if (
                !Number.isFinite(numeric) ||
                numeric < minimum ||
                numeric > maximum ||
                (step > 0 && Math.abs((numeric - minimum) / step - Math.round((numeric - minimum) / step)) > 1e-8)
            )
                throw new CameraRefusedError(id, `Requested ${id} value is outside the camera range`)
        }
    }
    const write = async (): Promise<void> => {
        if (driver instanceof NikonCamera) {
            const expectedMode =
                state.source.name.startsWith('NikonMovie') || state.source.name === 'MovieShutterAngle'
                    ? 'VIDEO'
                    : state.source.name === 'NikonPhotoShutterSpeed' || state.source.name === 'NikonStillFocusMode'
                      ? 'PHOTO'
                      : undefined
            if (expectedMode && (await driver.get(driver.registry.properties.LiveViewSelector)) !== expectedMode)
                throw new Error('Nikon photo/movie mode changed before the control write')
            if (state.source.name === 'MovieShutterAngle') {
                if ((await driver.get(driver.registry.properties.MovieShutterMode)) !== 'SHUTTER_ANGLE')
                    throw new Error('Nikon shutter mode changed before the control write')
                const status = await readNikonRecordingStatus(owner)
                if (!status || status.recording || status.bufferedImages)
                    throw new Error('Nikon must confirm idle before changing shutter angle')
            }
            const movieActions = {
                iso: 'set-iso',
                aperture: 'set-aperture',
                whiteBalance: 'set-white-balance',
                focusMode: 'set-focus-mode',
            } as const
            if (state.source.name.startsWith('NikonMovie') && id in movieActions) {
                await new NikonShotControls(owner).apply(movieActions[id as keyof typeof movieActions], requested)
                return
            }
            if (state.source.name === 'NikonPhotoShutterSpeed' || state.source.name === 'NikonMovieShutterSpeed') {
                await driver.setShutterSpeed(requested)
                return
            }
            const property = Object.values(driver.registry.properties).find(
                property => property.code === state.source.code
            )
            if (!property) throw new Error('Camera control property disappeared')
            const descriptor = await driver.propertyDescriptor(property)
            const index =
                descriptor.supportedValuesDecoded?.findIndex(
                    decoded => nikonControlLabel(property.name, decoded) === requested
                ) ?? -1
            let target = index >= 0 ? descriptor.supportedValuesRaw?.[index] : undefined
            let decoded = index >= 0 ? descriptor.supportedValuesDecoded?.[index] : undefined
            if (
                target === undefined &&
                descriptor.formFlag === 1 &&
                state.range &&
                (id === 'colorTemperature' || id === 'shutterSpeed')
            ) {
                const numeric = property.name === 'MovieShutterAngle' ? parseExposureTime(requested) : undefined
                const raw =
                    property.name === 'MovieShutterAngle' && numeric?.kind === 'angle'
                        ? numeric.degrees * 100
                        : property.name === 'ExposureTime'
                          ? Number(requested) * 10000
                          : Number(requested)
                if (
                    typeof descriptor.minimumValue === 'number' &&
                    typeof descriptor.maximumValue === 'number' &&
                    typeof descriptor.stepSize === 'number' &&
                    Number.isSafeInteger(raw) &&
                    raw >= descriptor.minimumValue &&
                    raw <= descriptor.maximumValue &&
                    (descriptor.stepSize === 0 || (raw - descriptor.minimumValue) % descriptor.stepSize === 0)
                ) {
                    target = raw
                    decoded = property.name === 'ExposureTime' ? requested : raw
                }
            }
            if (descriptor.getSet !== 'GET_SET' || target === undefined)
                throw new Error('Nikon control is no longer writable or advertised')
            const definition = getDatatypeByCode(descriptor.dataType)?.codec
            if (!definition) throw new Error('Nikon control datatype is unknown')
            const wireCodec = typeof definition === 'function' ? definition(driver.registry) : definition
            const valueCodec: CodecInstance<unknown> =
                typeof property.codec === 'function' ? property.codec(driver.registry) : property.codec
            const encoded = valueCodec.encode(decoded)
            const expected = wireCodec.encode(target)
            if (encoded.length !== expected.length || encoded.some((byte, index) => byte !== expected[index]))
                throw new Error('Nikon control cannot be encoded without truncation')
            // Confirmed below by the shared polled readback of this descriptor, like every other write.
            await driver.set(property, decoded as never)
            return
        }
        if (!(driver instanceof SonyCamera) && !(driver instanceof CanonCamera)) {
            await driver.setStandardProperty(state.source.code, requested)
            return
        }
        const property = Object.values(driver.registry.properties).find(property => property.code === state.source.code)
        if (!property) throw new Error('Camera control property disappeared')
        if (driver instanceof CanonCamera && id === 'movieFormat') {
            const choices = driver.getPropertyAllowedValues(driver.registry.properties.CanonMovieFormat)
            const choice = choices?.find(format => format.label === requested)
            if (!choice) throw new Error('Canon movie format is no longer advertised')
            await driver.setMovieFormat(choice.key)
            return
        }
        if (driver instanceof CanonCamera && id === 'stillFormat') {
            const choices = driver
                .listPropertyStates()
                .find(property => property.code === state.source.code)?.allowedValues
            const choice = choices?.find(
                value => value && typeof value === 'object' && 'label' in value && value.label === requested
            )
            if (!choice || typeof choice !== 'object' || !('packed' in choice) || typeof choice.packed !== 'number')
                throw new Error('Canon photo format is no longer advertised')
            await driver.setImageFormat(choice.packed)
            return
        }
        if (driver instanceof SonyCamera && id === 'iso') await driver.setIso(requested)
        else await driver.set(property, (id === 'colorTemperature' ? Number(requested) : requested) as never)
    }
    try {
        await write()
    } catch (error) {
        // A PTP response other than OK is the camera saying no; nothing changed.
        if (error instanceof PTPResponseError) throw new CameraRefusedError(id, `The camera refused ${id}: ${error.message}`)
        throw error
    }
    let observed: CameraControlState | undefined
    await confirmCameraValue(
        id,
        requested,
        async () => {
            observed = (await readCameraCapabilities(driver, id)).controls[id]
            if (observed && observed.source.code !== state.source.code)
                throw new CameraConfirmationError(id, requested, `control changed to ${observed.source.name}`)
            return observed?.value ?? null
        },
        undefined,
        id === 'shutterSpeed' && state.source.name === 'ExposureTime'
            ? sameExposureTicks(driver, state.source.code)
            : undefined
    )
    return observed!
}

/**
 * A ranged ExposureTime write is spelled in seconds (0.01) while the codec reads the same ticks back
 * as a fraction (1/100). Compare at the property's own wire resolution, not as display strings.
 */
function sameExposureTicks(driver: GenericCamera, code: number): (observed: string, expected: string) => boolean {
    const property = Object.values(driver.registry.properties).find(property => property.code === code)
    const codec: CodecInstance<unknown> | undefined =
        property && (typeof property.codec === 'function' ? property.codec(driver.registry) : property.codec)
    return (observed, expected) => {
        if (observed === expected) return true
        if (!codec) return false
        try {
            const actual = codec.encode(observed),
                requested = codec.encode(expected)
            return actual.length === requested.length && actual.every((byte, index) => byte === requested[index])
        } catch {
            return false
        }
    }
}
