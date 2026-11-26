import { CameraConfirmationError, confirmCameraValue } from '@camera/confirmation'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import {
    cameraControlDefinitions,
    type CameraCapabilities,
    type CameraControlId,
    type CameraControlInputs,
    type CameraControlState,
    type UnrecognizedValues,
    withoutInapplicableValues,
} from '@camera/controls'
import {
    exposureSeconds,
    matchExposureTime,
    parseExposureTime,
    type ExposureContext,
    type ExposureTimeInput,
} from '@camera/exposure-time'
import type { GenericCamera } from '@vendors/generic/generic-camera'
import { formatShutterSpeed, kelvinInput } from '@camera/settings/values'
import { canonicalControlInput } from '@camera/settings/typed-settings'
import { canonicalControlValues, vendorControlWord, type ControlValueInventory } from '@vendors/control-properties'
import {
    canonicalRange,
    canonicalRangeWireValue,
    propertyWithCode,
    readControlDeviceInfo,
    type VendorChoice,
} from '@vendors/generic/control-observation'
import { writePhotoVideoMode } from '@vendors/photo-video-mode'
import { sendControlWrite } from '@vendors/control-write'

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
    // A full read starts from DeviceInfo (the advertised operations and the lens); a driver that
    // needs it for every read (Nikon) reads it itself. Brands read their own inventories in bulk.
    const supplied = requested === undefined ? await readControlDeviceInfo(camera) : undefined
    const observation = await camera.observeControlStates(requested, supplied)
    const { states, mappings, inventory, composed = {}, lens } = observation
    const deviceInfo = observation.deviceInfo ?? supplied
    const label = (name: string, value: string | number | bigint) => observation.label?.(name, value) ?? String(value)
    const controls: CameraCapabilities['controls'] = {}
    const vendorChoices: ControlObservations['vendorChoices'] = {}
    for (const id of Object.keys(mappings) as CameraControlId[]) {
        const state = mappings[id]?.map(property => states.find(state => state.name === property.name)).find(Boolean)
        if (!state) continue
        const definition = cameraControlDefinitions[id]
        const vendorValue = label(state.name, state.value),
            vendorAllowedValues = state.allowedValues?.map(value => label(state.name, value))
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
            Boolean(observation.exactExposure?.includes(state.name))
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
    return {
        capabilities: {
            observedAt: Date.now(),
            controls: withoutInapplicableValues(controls),
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
    driver: GenericCamera,
    id: Id,
    value: CameraControlInputs[Id],
    context?: ExposureContext
): Promise<CameraControlState> {
    if (id === 'photoVideoMode')
        return writePhotoVideoMode(driver, String(value), async () =>
            (await readCameraCapabilities(driver, id)).controls.photoVideoMode
        )
    // Nikon descriptors are separate transactions: refresh this control and its live guards,
    // rather than reading every unrelated descriptor before each write. No cached admission.
    const observation = await observeControls(driver, id)
    const state = observation.capabilities.controls[id]
    if (!state) throw new CameraUnsupportedError(id, `${id} is not available on this camera`)
    // The same input gets the same answer whether or not the camera lets the control be written this
    // instant (a Sony shows its exposure read-only for a moment after a photo/video switch): a value
    // the camera does not offer is refused first; only an offered one is told the control is read-only.
    const unwritable = !state.enabled || !state.writable
    const notWritable = () => new CameraUnsupportedError(id, `${id} is not writable in the current camera mode`)
    if (unwritable && !state.allowedValues?.length && !state.range) throw notWritable()
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
    if (unwritable) throw notWritable()
    // A canonical name is written as the camera's own choice behind it; confirmation reads it back canonically.
    const vendorChoice = observation.vendorChoices[id]?.get(requested)
    const vendorLabel = vendorChoice?.label ?? inverseVendorWord(observation.inventory, state, requested)
    const write = () => driver.writeControlValue({ id, state, requested, vendorLabel, ...(vendorChoice && { vendorChoice }) })
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
