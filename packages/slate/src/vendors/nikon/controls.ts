import type { CameraControlId } from '@camera/controls'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { parseExposureTime } from '@camera/exposure-time'
import { PTPDecodeError, PTPResponseError } from '@core/ptp-errors'
import type { DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import type { PropertyDefinition } from '@ptp/types/property'
import type { ControlPropertyMap, ControlValueInventory } from '@vendors/control-properties'
import {
    canonicalRange,
    canonicalRangeWireValue,
    propertyWithCode,
    readControlDeviceInfo,
    wireRange,
    withWireRange,
    type ControlObservation,
    type ControlWrite,
    type PropertyState,
} from '@vendors/generic/control-observation'
import { standardControlProperties } from '@vendors/generic/control-properties'
import { standardPropertyState } from '@vendors/generic/generic-camera'
import { standardLens } from '@vendors/lens-information'
import { nikonMovieControlProperties, nikonPhotoControlProperties } from '@vendors/nikon/control-properties'
import { nikonControlLabel } from '@vendors/nikon/control-values'
import type { NikonCamera } from '@vendors/nikon/nikon-camera'
import { readNikonRecordingStatus } from '@vendors/nikon/recording-status'
import { NikonShotControls } from '@vendors/nikon/shot-controls'
import { MovieShutterAngle } from '@vendors/nikon/video-properties'

/*
 * Nikon's controls(): photo and movie are two inventories, chosen by LiveViewSelector, and every
 * descriptor is its own transaction, so a targeted read refreshes only the control and its guards.
 */

/** The protocol surface NikonShotControls reads, from the driver itself. */
function nikonSession(driver: NikonCamera) {
    return {
        driver,
        send: driver.send.bind(driver),
        get: driver.get.bind(driver),
        getNikonVendorPropertyCodes: () => driver.getVendorPropertyCodes(),
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

/** Nikon reads its DeviceInfo on every observation: the vendor codes and selector depend on it. */
export async function observeNikonControls(
    camera: NikonCamera,
    requested: CameraControlId | undefined,
    supplied: DeviceInfo | undefined
): Promise<ControlObservation> {
    const deviceInfo = supplied ?? (await readControlDeviceInfo(camera))
    const advertised = new Set(deviceInfo.devicePropertiesSupported)
    const { states, mappings, inventory } = await nikonStates(camera, advertised, deviceInfo.operationsSupportedRaw, requested)
    const lens = requested === undefined ? await standardLens(camera, deviceInfo.devicePropertiesSupported) : undefined
    return {
        states,
        mappings,
        inventory,
        deviceInfo,
        ...(lens ? { lens } : {}),
        label: (name, value) => (value !== 'Auto' ? nikonControlLabel(name, value) : String(value)),
        exactExposure: ['NikonMovieShutterSpeed', 'NikonPhotoShutterSpeed', 'MovieShutterAngle'],
    }
}

/** One admitted Nikon write: the mode and shutter guards, then the advertised encoding, sent once. */
export async function writeNikonControl(driver: NikonCamera, { id, state, requested, vendorLabel }: ControlWrite): Promise<void> {
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
        await new NikonShotControls(nikonSession(driver)).apply(movieActions[id as keyof typeof movieActions], vendorLabel)
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
