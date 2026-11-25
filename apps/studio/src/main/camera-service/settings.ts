import { Camera, VendorIDs, type CameraCapabilities, type CameraControlState } from '@darkgrade/slate'
import { resolveCameraControl } from '@darkgrade/slate/controls'
import type { CameraService } from '@main/camera-service'
import {
    errorMessage,
    kelvinSteps,
    REFOCUS_CONTROLS,
    requiresReconnect,
} from '@main/camera-service/shared'
import type { CameraControl, CameraControlName, CameraControls, CameraSettings } from '@shared/ipc'
import { CAMERA_CONTROL_LABELS, CAMERA_CONTROL_NAMES } from '@shared/ipc'

/** The camera service's settings refresh and control writes. Installed on CameraService in camera-service.ts. */
export interface SettingsOperations {
    // --------------------------------------------------------------- settings

    /** Runs on the operation queue — never call from inside another enqueued op. */
    refreshSettingsRaw(): Promise<CameraSettings>
    refreshSettings(): Promise<CameraSettings>
    /** All vendors share Slate's control vocabulary; only observed controls reach the sidebar. */
    readControls(camera: Camera, capabilities: CameraCapabilities): Promise<CameraControls>
    observedControl(name: CameraControlName, state: CameraControlState): CameraControl
    setControl(name: CameraControlName, value: string): Promise<CameraControls | null>
    setIso(value: string): Promise<CameraSettings>
    setShutterSpeed(value: string): Promise<CameraSettings>
    setAperture(value: string): Promise<CameraSettings>
}

export const settingsOperations: SettingsOperations & ThisType<CameraService> = {
    // --------------------------------------------------------------- settings

    /** Runs on the operation queue — never call from inside another enqueued op. */
    async refreshSettingsRaw(): Promise<CameraSettings> {
        const camera = this.requireCamera()
        try {
            const capabilities = await camera.getCapabilities()
            this.controlProperties.clear()
            this.controls = await this.readControls(camera, capabilities)
            this.focusPointAvailable = capabilities.operations?.setFocusPoint?.supported === true
            this.settings = {
                iso: capabilities.controls.iso?.value ?? null,
                shutterSpeed: capabilities.controls.shutterSpeed?.value ?? null,
                aperture: capabilities.controls.aperture?.value ?? null,
            }
        } catch (error) {
            // Keep the last observation visible while disabling choices until a fresh read succeeds.
            if (this.controls)
                this.controls = Object.fromEntries(
                    CAMERA_CONTROL_NAMES.map(name => [
                        name,
                        this.controls?.[name] ? { ...this.controls[name], enabled: false } : null,
                    ])
                ) as CameraControls
            this.broadcastState()
            if (requiresReconnect(error)) throw error
            this.log('system', `Camera controls could not refresh; showing last observations: ${errorMessage(error)}`)
            return this.settings
        }
        this.broadcastState()
        return this.settings
    },

    async refreshSettings(): Promise<CameraSettings> {
        return this.enqueue(() => this.refreshSettingsRaw())
    },

    /** All vendors share Slate's control vocabulary; only observed controls reach the sidebar. */
    async readControls(camera: Camera, capabilities: CameraCapabilities): Promise<CameraControls> {
        const pick = (name: CameraControlName): CameraControl | null => {
            const id = resolveCameraControl(name)
            const state = id ? capabilities.controls[id] : undefined
            if (!state) return null
            this.controlProperties.set(name, state.source.name)
            return this.observedControl(name, state)
        }
        const controls = Object.fromEntries(CAMERA_CONTROL_NAMES.map(name => [name, pick(name)])) as CameraControls
        if (this.detectedVendorId === VendorIDs.SONY) {
            const states = await camera.getSonyPropertyStates()
            this.updateCardFromStates(states)
            this.updateLensFromStates(states)
        }
        return controls
    },

    observedControl(name: CameraControlName, state: CameraControlState): CameraControl {
        const listed = (state.allowedValues ?? []).map(String)
        const options =
            name === 'colorTemperature' && listed.length < 2 && state.range
                ? kelvinSteps().filter(
                      value => Number(value) >= state.range!.minimum && Number(value) <= state.range!.maximum
                  )
                : listed
        return { value: state.value, options, enabled: state.enabled && state.writable }
    },

    async setControl(name: CameraControlName, value: string): Promise<CameraControls | null> {
        if (!CAMERA_CONTROL_NAMES.includes(name)) throw new Error(`Unknown setting ${String(name)}`)
        const camera = this.requireCameraForControl()
        return this.enqueue(async () => {
            const id = resolveCameraControl(name)
            if (!id) throw new Error('Unknown camera control')
            const encoded = name === 'colorTemperature' ? Number(value) : value
            let observed: CameraControlState
            try {
                observed =
                    id === 'colorTemperature'
                        ? await camera.setControl(id, Number(encoded))
                        : await camera.setControl(id, String(encoded))
            } catch (error) {
                await this.refreshSettingsRaw().catch(() => {})
                this.log('system', `${CAMERA_CONTROL_LABELS[name]} change unconfirmed: ${errorMessage(error)}`, 'error')
                throw error
            }
            this.controls ??= Object.fromEntries(CAMERA_CONTROL_NAMES.map(name => [name, null])) as CameraControls
            this.controls = { ...this.controls, [name]: this.observedControl(name, observed) }
            this.controlProperties.set(name, observed.source.name)
            if (name === 'iso' || name === 'shutterSpeed' || name === 'aperture')
                this.settings = { ...this.settings, [name]: observed.value }
            this.broadcastState()
            // Choosing an area or subject detection by hand keeps it: Focus no longer undoes a click's changes.
            if (name === 'focusArea' || name === 'subjectDetection') this.focusPointChanges = null
            this.log('system', `${CAMERA_CONTROL_LABELS[name]} → ${observed.value}`)
            // A mode change reshapes what the other settings allow, so those still read back before returning.
            if (name === 'exposureProgram' || name === 'whiteBalance' || name === 'focusMode') {
                await this.refreshSettingsRaw()
            }
            // A new area or subject setting only takes effect once AF runs again; in PC Remote it doesn't
            // run on its own, so focus once now (e.g. back to Wide finds the eye again).
            if (
                this.detectedVendorId === VendorIDs.SONY &&
                REFOCUS_CONTROLS.has(name) &&
                !/^(MF|DMF)/i.test(this.controls?.focusMode?.value ?? '')
            ) {
                await camera.autofocus()
                this.log('system', 'Refocused')
            }
            return this.controls
        })
    },

    async setIso(value: string): Promise<CameraSettings> {
        await this.setControl('iso', value)
        return this.settings
    },

    async setShutterSpeed(value: string): Promise<CameraSettings> {
        await this.setControl('shutterSpeed', value)
        return this.settings
    },

    async setAperture(value: string): Promise<CameraSettings> {
        await this.setControl('aperture', value)
        return this.settings
    },
}
