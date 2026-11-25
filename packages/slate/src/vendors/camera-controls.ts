import { CanonCamera } from '@vendors/canon/canon-camera'
import { CameraConfirmationError, confirmCameraValue } from '@camera/confirmation'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import {
    cameraControlDefinitions,
    type CameraCapabilities,
    type CameraControlId,
    type CameraLens,
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
import { GenericCamera, standardPropertyState, type StandardPropertyState } from '@vendors/generic/generic-camera'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@vendors/nikon/nikon-camera'
import { SonyCamera } from '@vendors/sony/sony-camera'
import { PTPDecodeError, PTPResponseError } from '@core/ptp-errors'
import type { DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import type { PropertyDefinition } from '@ptp/types/property'
import { formatShutterSpeed, kelvinInput } from '@camera/settings/values'
import { canonicalControlInput } from '@camera/settings/typed-settings'
import {
    canonControlProperties,
    canonicalControlValues,
    vendorControlWord,
    nikonMovieControlProperties,
    nikonPhotoControlProperties,
    sonyControlProperties,
    standardControlProperties,
    type ControlPropertyMap,
    type ControlValueInventory,
} from '@vendors/control-properties'
import { canonFocusModeStates } from '@vendors/canon/control-properties'
import { standardLens } from '@vendors/lens-information'
import { nikonControlLabel } from '@vendors/nikon/control-values'
import { MovieShutterAngle } from '@vendors/nikon/video-properties'
import { readNikonRecordingStatus } from '@vendors/nikon/recording-status'
import { NikonShotControls } from '@vendors/nikon/shot-controls'
import { canonPhotoVideoModeState, sonyPhotoVideoModeState, writePhotoVideoMode } from '@vendors/photo-video-mode'
import { sendControlWrite } from '@vendors/control-write'
import { sonyLens } from '@vendors/sony/lens'

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

/**
 * Ranged properties whose canonical spelling is an exact number on the property's own wire scale:
 * `ISO 800` is 800, `f/2.8` is 280 hundredths. Only these keep a range behind a canonical name, so a
 * ranged write is never rounded; any other ranged canonical control stays read-only.
 */
const canonicalRanges: Readonly<Record<string, { id: CameraControlId; pattern: RegExp; wirePerUnit: number }>> = {
    ExposureIndex: { id: 'iso', pattern: /^ISO (\d+)$/, wirePerUnit: 1 },
    NikonMovieISO: { id: 'iso', pattern: /^ISO (\d+)$/, wirePerUnit: 1 },
    FNumber: { id: 'aperture', pattern: /^f\/(\d+(?:\.\d+)?)$/, wirePerUnit: 100 },
    NikonMovieFNumber: { id: 'aperture', pattern: /^f\/(\d+(?:\.\d+)?)$/, wirePerUnit: 100 },
}

function propertyWithCode(driver: GenericCamera, code: number): PropertyDefinition | undefined {
    return Object.values(driver.registry.properties).find(property => property.code === code)
}

function canonicalRange(id: CameraControlId, propertyName: string) {
    const range = canonicalRanges[propertyName]
    return range?.id === id ? range : undefined
}

/** The wire number a canonical name stands for on a ranged property, when it is exact. */
function canonicalRangeWireValue(id: CameraControlId, propertyName: string, value: string): number | undefined {
    const range = canonicalRange(id, propertyName)
    const match = range?.pattern.exec(value)
    if (!range || !match) return undefined
    const wire = Number(match[1]) * range.wirePerUnit
    const rounded = Math.round(wire)
    return Math.abs(wire - rounded) < 1e-9 ? rounded : undefined
}

/**
 * A range on the property's wire scale. String codecs decode the limits as labels (`ISO 100`,
 * `f/2.8`); those are read back to wire numbers only for the exact canonical ranges below.
 */
function wireRange(
    propertyName: string,
    limits: readonly (number | bigint | string | undefined)[]
): CameraControlState['range'] | undefined {
    const ranged = canonicalRanges[propertyName]
    const wire = limits.map(limit =>
        typeof limit === 'number'
            ? limit
            : ranged && typeof limit === 'string'
              ? canonicalRangeWireValue(ranged.id, propertyName, limit)
              : undefined
    )
    const [minimum, maximum, step] = wire
    if (minimum === undefined || maximum === undefined || step === undefined) return undefined
    return { minimum, maximum, step }
}

/** A standard descriptor's state, with its range on the property's wire scale. */
function withWireRange(state: StandardPropertyState): PropertyState {
    const range = wireRange(state.name, [state.minimumValue, state.maximumValue, state.stepSize])
    return { ...state, ...(range ? { range } : {}) }
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
            states.push(withWireRange(standardPropertyState(await camera.propertyDescriptor(property))))
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
    // Right after power-on a Z5 II reported FNumber 0 with 0 as its one choice: no aperture yet, not f/0.
    // It reads as unrecognized, so it is never written.
    const noAperture = (value: unknown) => value === 0 || value === 'f/0'
    for (const state of states.filter(state => state.name === 'FNumber' || state.name === 'NikonMovieFNumber')) {
        state.allowedValues = state.allowedValues?.filter(value => !noAperture(value))
        if (noAperture(state.value)) state.unrecognized = { ...state.unrecognized, value: 'f/0' }
    }
    const inventory: ControlValueInventory = movie === true ? 'nikonMovie' : movie === false ? 'nikonPhoto' : 'standard'
    return { states, mappings, inventory }
}

/** The camera's own choice behind a canonical name: its display word and the value it decodes to. */
interface VendorChoice {
    label: string
    raw: string | number | bigint
}

interface ControlObservations {
    capabilities: CameraCapabilities
    /** For settings with canonical names, the vendor choice behind each offered name. */
    vendorChoices: Partial<Record<CameraControlId, Map<string, VendorChoice>>>
    /** Which vocabulary the observation was named with. */
    inventory: ControlValueInventory
}

/** Adapt existing observed inventories; a static registry entry alone never becomes a capability. */
export async function readCameraCapabilities(camera: GenericCamera, requested?: CameraControlId): Promise<CameraCapabilities> {
    return (await observeControls(camera, requested)).capabilities
}

async function observeControls(camera: GenericCamera, requested?: CameraControlId): Promise<ControlObservations> {
    // Sony/Canon publish authoritative live property inventories in one bulk operation.
    // Standard targeted reads perform their own advertised-property discovery below.
    let deviceInfo: DeviceInfo | undefined
    if (requested === undefined || camera instanceof NikonCamera) {
        const response = await camera.send(camera.registry.operations.GetDeviceInfo, {})
        if (response.code !== 0x2001) throw new PTPResponseError(response.code, 'Camera capability inventory refused')
        if (!response.data) throw new PTPDecodeError('Camera capability inventory has no DeviceInfo')
        deviceInfo = response.data
    }
    let states: PropertyState[]
    let mappings: ControlPropertyMap<CameraControlId>
    let inventory: ControlValueInventory = 'standard'
    // Controls composed from more than one observation (see `@vendors/photo-video-mode`).
    let composed: CameraCapabilities['controls'] = {}
    // The lens comes from the same observation as the controls: Sony's inventory, or the standard
    // FocalLength property on a full read of a Nikon or standard body. Canon reports none Slate decodes.
    let lens: CameraLens | undefined
    if (camera instanceof SonyCamera) {
        inventory = 'sony'
        const observed = await camera.refreshPropertyStates()
        lens = sonyLens(observed)
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
        const videoMode = camera.listUnknownPropertyStates().some(state => state.name === 'FixedMovie' && state.rawValue === 1)
        states = canonFocusModeStates(states, videoMode)
        mappings = canonControlProperties
        inventory = 'canon'
    } else if (camera instanceof NikonCamera) {
        const advertised = new Set(deviceInfo!.devicePropertiesSupported)
        ;({ states, mappings, inventory } = await nikonStates(camera, advertised, deviceInfo!.operationsSupportedRaw, requested))
        if (requested === undefined) lens = await standardLens(camera, deviceInfo!.devicePropertiesSupported)
    } else {
        const standardMappings: ControlPropertyMap<CameraControlId> = standardControlProperties
        const requestedName = requested ? standardMappings[requested]?.[0]?.name : undefined
        states = (await camera.getStandardPropertyStates(requestedName)).map(withWireRange)
        mappings = standardControlProperties
        if (deviceInfo) lens = await standardLens(camera, deviceInfo.devicePropertiesSupported)
    }
    const controls: CameraCapabilities['controls'] = {}
    const vendorChoices: ControlObservations['vendorChoices'] = {}
    for (const id of Object.keys(mappings) as CameraControlId[]) {
        const state = mappings[id]?.map(property => states.find(state => state.name === property.name)).find(Boolean)
        if (!state) continue
        const label = (value: string | number | bigint) =>
            camera instanceof NikonCamera && value !== 'Auto' ? nikonControlLabel(state.name, value) : String(value)
        const definition = cameraControlDefinitions[id]
        const vendorValue = label(state.value),
            vendorAllowedValues = state.allowedValues?.map(label)
        // Two vendor values can share a canonical name (Sony's Lock-on AF and older Tracking spots are
        // both "Tracking Spot M"), so a write sends the choice this body offered behind the name.
        const canonical = canonicalControlValues(inventory, id, vendorValue, vendorAllowedValues, state.name)
        if (canonical)
            vendorChoices[id] = new Map(
                [...canonical.vendorIndex].map(([name, index]) => [
                    name,
                    { label: vendorAllowedValues![index]!, raw: state.allowedValues![index]! },
                ])
            )
        let value = canonical?.value ?? vendorValue,
            allowedValues = canonical ? canonical.allowedValues : vendorAllowedValues
        const unrecognized = mergeUnrecognized(state.unrecognized, canonical?.unrecognized)
        const knownExposure =
            id !== 'shutterSpeed' ||
            typeof state.value === 'string' ||
            (camera instanceof NikonCamera &&
                ['NikonMovieShutterSpeed', 'NikonPhotoShutterSpeed', 'MovieShutterAngle'].includes(state.name))
        const unrecognizedValue = unrecognized?.value
        let exposureTime: CameraControlState['exposureTime']
        if (id === 'shutterSpeed' && knownExposure && unrecognizedValue === undefined) {
            try {
                exposureTime = parseExposureTime(value)
            } catch {
                /* Preserve the unknown observation without inventing units. */
            }
        }
        // Shutter speeds are named in Slate's one spelling on every vendor (Canon "30" is 30", Nikon
        // "13/10" is 1.3", Sony BULB is Bulb); a write still sends the camera's own choice behind each.
        const shutter =
            id === 'shutterSpeed' && !canonical && unrecognizedValue === undefined
                ? canonicalShutterChoices(vendorAllowedValues, state.allowedValues)
                : undefined
        if (shutter) vendorChoices[id] = shutter.vendorChoices
        if (shutter) allowedValues = shutter.allowedValues
        if (exposureTime) value = formatShutterSpeed(exposureTime, value)
        const uniqueChoices = !allowedValues || new Set(allowedValues).size === allowedValues.length
        const rangedCanonical = canonical && state.range && !allowedValues ? canonicalRange(id, state.name) : undefined
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
                // A canonical name needs an advertised choice behind it, or a range on its exact wire scale.
                (canonical ? allowedValues !== undefined || Boolean(rangedCanonical) : true) &&
                (allowedValues === undefined || allowedValues.length > 0),
            ...(state.range && (!canonical || rangedCanonical)
                ? {
                      range: rangedCanonical
                          ? scaledRange(state.range, rangedCanonical.wirePerUnit)
                          : id === 'shutterSpeed' && (state.name === 'ExposureTime' || state.name === 'MovieShutterAngle')
                            ? scaledRange(state.range, state.name === 'ExposureTime' ? 10000 : 100)
                            : state.range,
                  }
                : {}),
            ...(exposureTime ? { exposureTime } : {}),
            ...(unrecognized && { unrecognized }),
        }
    }
    for (const [id, state] of Object.entries(composed) as [CameraControlId, CameraControlState | undefined][])
        if (state && (requested === undefined || requested === id)) controls[id] = state
    // No colour temperature is 0 K: a Sony in a white balance preset reports 0 (FX2 in Auto, a6700 in
    // Daylight). It does not apply until the white balance is Color Temperature.
    const kelvin = controls.colorTemperature
    if (kelvin?.value === '0') controls.colorTemperature = { ...kelvin, enabled: false, writable: false }
    // A value with no name and nothing to choose (Sony drive mode 0x0 in movie mode) does not apply now.
    for (const state of Object.values(controls))
        if (state && state.unrecognized?.value !== undefined && !state.allowedValues?.length && !state.range && !state.unrecognized.choices?.length)
            controls[state.id] = { ...state, enabled: false, writable: false }
    return {
        capabilities: {
            observedAt: Date.now(),
            controls,
            advertisedOperations: deviceInfo ? [...deviceInfo.operationsSupportedRaw] : null,
            ...(lens ? { lens } : {}),
        },
        vendorChoices,
        inventory,
    }
}

type ControlRange = NonNullable<CameraControlState['range']>

/**
 * Each shutter choice in Slate's spelling, with the camera's own choice behind it. A label Slate
 * cannot read is left out (it is never given units); two labels for the same exposure are one choice.
 */
function canonicalShutterChoices(
    labels: readonly string[] | undefined,
    raw: readonly (string | number | bigint)[] | undefined
): { allowedValues?: string[]; vendorChoices: Map<string, VendorChoice> } | undefined {
    if (!labels || !raw) return undefined
    const vendorChoices = new Map<string, VendorChoice>()
    labels.forEach((label, index) => {
        let spelled: string
        try {
            spelled = formatShutterSpeed(parseExposureTime(label), label)
        } catch {
            return
        }
        if (!vendorChoices.has(spelled)) vendorChoices.set(spelled, { label, raw: raw[index]! })
    })
    return { allowedValues: [...vendorChoices.keys()], vendorChoices }
}

function scaledRange({ minimum, maximum, step }: ControlRange, divisor: number): ControlRange {
    return { minimum: minimum / divisor, maximum: maximum / divisor, step: step / divisor }
}

function outsideRange(numeric: number, { minimum, maximum, step }: ControlRange): boolean {
    return (
        numeric < minimum ||
        numeric > maximum ||
        (step > 0 && Math.abs((numeric - minimum) / step - Math.round((numeric - minimum) / step)) > 1e-8)
    )
}

function mergeUnrecognized(observed?: UnrecognizedValues, unnamed?: UnrecognizedValues): UnrecognizedValues | undefined {
    if (!observed && !unnamed) return undefined
    const choices = [...(observed?.choices ?? []), ...(unnamed?.choices ?? [])]
    const value = observed?.value ?? unnamed?.value
    return { ...(value !== undefined ? { value } : {}), ...(choices.length ? { choices } : {}) }
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
    const observation = await observeControls(driver, id)
    const state = observation.capabilities.controls[id]
    if (!state) throw new CameraUnsupportedError(id, `${id} is not available on this camera`)
    if (!state.enabled || !state.writable)
        throw new CameraUnsupportedError(id, `${id} is not writable in the current camera mode`)
    let requested: string
    if (id === 'shutterSpeed') {
        const choices = state.allowedValues ?? []
        // An input that is no exposure at all is refused like any value the camera does not offer.
        try {
            parseExposureTime(value as ExposureTimeInput)
        } catch {
            throw new CameraRefusedError(id, `${JSON.stringify(value)} is not a shutter speed; the camera offers ${choices.join(', ') || 'a range'}`)
        }
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
            if (numeric === undefined || outsideRange(numeric, state.range))
                throw new CameraRefusedError(id, 'Requested exposure time is outside the camera range')
            requested = String(numeric) + (state.source.name === 'MovieShutterAngle' ? '°' : '')
        } else throw new CameraRefusedError(id, 'Requested exposure time is not advertised by the camera')
    } else {
        // Kelvin is typed as a number, but the capabilities list it as strings ("2500"): accept either
        // spelling of the same whole number, so every advertised choice can be written back.
        const kelvin = id === 'colorTemperature' ? kelvinInput(value) : undefined
        if (id === 'colorTemperature' ? kelvin === undefined : typeof value !== 'string')
            throw new CameraRefusedError(id, `Invalid ${id} value`)
        requested = kelvin !== undefined ? String(kelvin) : canonicalControlInput(id, String(value))
        if (state.allowedValues && !state.allowedValues.includes(requested))
            throw new CameraRefusedError(id, `Requested ${id} value is not advertised by the camera`)
        if (state.range) {
            // A canonical name on a ranged property is checked on the wire scale it stands for.
            const ranged = canonicalRange(id, state.source.name)
            const scale = ranged?.wirePerUnit ?? 1
            const numeric = ranged ? canonicalRangeWireValue(id, state.source.name, requested) ?? NaN : Number(requested)
            const onWireScale = (limit: number) => (ranged ? Math.round(limit * scale) : limit)
            const { minimum, maximum, step } = state.range
            if (!Number.isFinite(numeric) || outsideRange(numeric, { minimum: onWireScale(minimum), maximum: onWireScale(maximum), step: onWireScale(step) }))
                throw new CameraRefusedError(id, `Requested ${id} value is outside the camera range`)
        }
    }
    // A canonical name is written as the camera's own choice behind it; confirmation reads it back canonically.
    const vendorChoice = observation.vendorChoices[id]?.get(requested)
    const vendorLabel = vendorChoice?.label ?? inverseVendorWord(observation.inventory, state, requested)
    const write = async (): Promise<void> => {
        if (driver instanceof NikonCamera) {
            const expectedMode =
                state.source.name.startsWith('NikonMovie') || state.source.name === 'MovieShutterAngle'
                    ? 'VIDEO'
                    : state.source.name === 'NikonPhotoShutterSpeed' || state.source.name === 'NikonStillFocusMode'
                      ? 'PHOTO'
                      : undefined
            if (expectedMode && (await driver.get(driver.registry.properties.LiveViewSelector)) !== expectedMode)
                throw new CameraRefusedError(id, 'Nikon photo/movie mode changed before the control write')
            if (state.source.name === 'MovieShutterAngle') {
                if ((await driver.get(driver.registry.properties.MovieShutterMode)) !== 'SHUTTER_ANGLE')
                    throw new CameraRefusedError(id, 'Nikon shutter mode changed before the control write')
                const status = await readNikonRecordingStatus(driver)
                if (!status || status.recording || status.bufferedImages)
                    throw new CameraRefusedError(id, 'Nikon must confirm idle before changing shutter angle')
            }
            const movieActions = { iso: 'set-iso', aperture: 'set-aperture', whiteBalance: 'set-white-balance', focusMode: 'set-focus-mode' } as const
            if (state.source.name.startsWith('NikonMovie') && id in movieActions) {
                await new NikonShotControls(owner).apply(movieActions[id as keyof typeof movieActions], vendorLabel)
                return
            }
            if (state.source.name === 'NikonPhotoShutterSpeed' || state.source.name === 'NikonMovieShutterSpeed') {
                await driver.setShutterSpeed(vendorLabel)
                return
            }
            const property = propertyWithCode(driver, state.source.code)
            if (!property) throw new CameraUnsupportedError(id, 'Camera control property disappeared')
            const descriptor = await driver.propertyDescriptor(property)
            const index =
                descriptor.supportedValuesDecoded?.findIndex(
                    decoded => nikonControlLabel(property.name, decoded) === vendorLabel
                ) ?? -1
            let target = index >= 0 ? descriptor.supportedValuesRaw?.[index] : undefined
            let decoded = index >= 0 ? descriptor.supportedValuesDecoded?.[index] : undefined
            if (
                target === undefined &&
                descriptor.formFlag === 1 &&
                state.range &&
                (id === 'colorTemperature' || id === 'shutterSpeed' || canonicalRange(id, property.name))
            ) {
                const numeric = property.name === 'MovieShutterAngle' ? parseExposureTime(requested) : undefined
                const canonicalWire = canonicalRangeWireValue(id, property.name, requested)
                const raw = canonicalRange(id, property.name)
                    ? (canonicalWire ?? NaN)
                    : property.name === 'MovieShutterAngle' && numeric?.kind === 'angle'
                      ? numeric.degrees * 100
                      : property.name === 'ExposureTime'
                        ? Number(requested) * 10000
                        : Number(requested)
                const limits = wireRange(property.name, [descriptor.minimumValue, descriptor.maximumValue, descriptor.stepSize])
                if (
                    limits &&
                    Number.isSafeInteger(raw) &&
                    raw >= limits.minimum &&
                    raw <= limits.maximum &&
                    (limits.step === 0 || (raw - limits.minimum) % limits.step === 0)
                ) {
                    target = raw
                    // String codecs (ExposureTime, ExposureIndex, FNumber) take the spelling; scalars the number.
                    decoded =
                        property.name === 'ExposureTime' || property.name === 'ExposureIndex' || property.name === 'FNumber'
                            ? requested
                            : raw
                }
            }
            if (descriptor.getSet !== 'GET_SET' || target === undefined)
                throw new CameraRefusedError(id, 'Nikon control is no longer writable or advertised')
            const definition = getDatatypeByCode(descriptor.dataType)?.codec
            if (!definition) throw new CameraUnsupportedError(id, 'Nikon control datatype is unknown')
            const encoded = driver.resolveCodec<unknown>(property.codec).encode(decoded)
            const expected = driver.resolveCodec<unknown>(definition).encode(target)
            if (encoded.length !== expected.length || encoded.some((byte, index) => byte !== expected[index]))
                throw new CameraRefusedError(id, 'Nikon control cannot be encoded without truncation')
            // Confirmed below by the shared polled readback of this descriptor, like every other write.
            await driver.set(property, decoded as never)
            return
        }
        if (!(driver instanceof SonyCamera) && !(driver instanceof CanonCamera)) {
            await driver.setStandardProperty(state.source.code, vendorLabel)
            return
        }
        const property = propertyWithCode(driver, state.source.code)
        if (!property) throw new CameraUnsupportedError(id, 'Camera control property disappeared')
        if (driver instanceof CanonCamera && id === 'videoFormat') {
            const choices = driver.getPropertyAllowedValues(driver.registry.properties.CanonMovieFormat)
            const choice = choices?.find(format => format.label === requested)
            if (!choice) throw new CameraRefusedError(id, 'Canon movie format is no longer advertised')
            await driver.setMovieFormat(choice.key)
            return
        }
        if (driver instanceof CanonCamera && id === 'photoFormat') {
            const choices = driver.listPropertyStates().find(property => property.code === state.source.code)?.allowedValues
            const choice = choices?.find(
                value => value && typeof value === 'object' && 'label' in value && value.label === requested
            )
            if (!choice || typeof choice !== 'object' || !('packed' in choice) || typeof choice.packed !== 'number')
                throw new CameraRefusedError(id, 'Canon photo format is no longer advertised')
            await driver.setImageFormat(choice.packed)
            return
        }
        const written = vendorChoice ? vendorChoice.raw : id === 'colorTemperature' ? Number(requested) : vendorLabel
        if (driver instanceof SonyCamera && id === 'iso') await driver.setIso(vendorLabel)
        else await driver.set(property, written as never)
    }
    await sendControlWrite(driver, id, write)
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
    const property = propertyWithCode(driver, code)
    const codec = property && driver.resolveCodec<unknown>(property.codec)
    return (observed, expected) => {
        if (observed === expected) return true
        if (sameExposure(observed, expected)) return true
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

/** Two spellings of the same exposure ("0.01" written, 1/100 read back in Slate's spelling). */
function sameExposure(observed: string, expected: string): boolean {
    try {
        const left = parseExposureTime(observed),
            right = parseExposureTime(expected)
        if (left.kind !== 'duration' || right.kind !== 'duration') return false
        return Math.abs(left.seconds - right.seconds) <= 1e-9 * Math.max(left.seconds, right.seconds)
    } catch {
        return false
    }
}

/**
 * The camera's own word for a canonical value with no advertised choice behind it, from the inverse
 * of the setting's vocabulary. A name that stands for more than one vendor word is refused before
 * anything is sent; a vocabulary without inverse words writes the canonical name itself.
 */
function inverseVendorWord(inventory: ControlValueInventory, state: CameraControlState, canonical: string): string {
    const found = vendorControlWord(inventory, state.id, state.source.name, canonical)
    if (!found) return canonical
    if ('word' in found) return found.word
    throw new CameraRefusedError(
        state.id,
        `${canonical} stands for more than one ${state.source.name} value (${found.ambiguous.join(', ')}); the camera's choice is ambiguous`
    )
}
