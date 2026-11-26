import type { CameraControlId } from '@camera/controls'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { CanonCamera } from '@vendors/canon/canon-camera'
import { canonControlProperties, canonFocusModeStates } from '@vendors/canon/control-properties'
import {
    propertyWithCode,
    scalar,
    writeObservedProperty,
    type ControlObservation,
    type ControlWrite,
} from '@vendors/generic/control-observation'
import { canonPhotoVideoModeState } from '@vendors/photo-video-mode'

/*
 * Canon's controls(): one EOS event inventory read in bulk; movie and photo formats are written as
 * the camera's own packed choices.
 */

function canonLabel(value: unknown): string | number | bigint | undefined {
    if (scalar(value)) return value
    if (value && typeof value === 'object' && 'label' in value && typeof value.label === 'string') return value.label
}

export async function observeCanonControls(camera: CanonCamera, _requested?: CameraControlId): Promise<ControlObservation> {
    await camera.refreshEventProperties()
    const composed = { photoVideoMode: canonPhotoVideoModeState(camera) }
    const states = camera
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
    return { states: canonFocusModeStates(states, videoMode), mappings: canonControlProperties, inventory: 'canon', composed }
}

export async function writeCanonControl(driver: CanonCamera, write: ControlWrite): Promise<void> {
    const { id, state, requested } = write
    const property = propertyWithCode(driver, state.source.code)
    if (!property) throw new CameraUnsupportedError(id, 'Camera control property disappeared')
    if (id === 'videoFormat') {
        const choices = driver.getPropertyAllowedValues(driver.registry.properties.CanonMovieFormat)
        const choice = choices?.find(format => format.label === requested)
        if (!choice) throw new CameraRefusedError(id, 'Canon movie format is no longer advertised')
        await driver.setMovieFormat(choice.key)
        return
    }
    if (id === 'photoFormat') {
        const choices = driver.listPropertyStates().find(property => property.code === state.source.code)?.allowedValues
        const choice = choices?.find(value => value && typeof value === 'object' && 'label' in value && value.label === requested)
        if (!choice || typeof choice !== 'object' || !('packed' in choice) || typeof choice.packed !== 'number')
            throw new CameraRefusedError(id, 'Canon photo format is no longer advertised')
        await driver.setImageFormat(choice.packed)
        return
    }
    await writeObservedProperty(driver, write)
}
