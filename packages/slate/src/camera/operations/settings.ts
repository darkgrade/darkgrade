import { CanonCamera } from '@camera/canon-camera'
import type { CameraCapabilities, CameraControlId, CameraControlInputs, CameraControlState } from '@camera/controls'
import type { ExposureContext, ExposureTime, ExposureTimeInput } from '@camera/exposure-time'
import type { Camera } from '@camera/index'
import { canonDriver, cameraContext, requireCapability } from '@camera/operations/context'
import { operationSupport } from '@camera/operations/support'
import { SonyCamera } from '@camera/sony-camera'
import type { CanonImageFormat } from '@ptp/datasets/vendors/canon/canon-image-format-dataset'

/**
 * Settings: the generic control API, plus the vendor-named accessors that the typed settings
 * replace one group at a time (see `@camera/settings` and the operation table). The typed
 * accessors themselves (`getShutterSpeed`, `setShutterSpeed`, ...) come from
 * `@camera/settings/typed-settings`, installed on Camera in index.ts.
 */
export interface SettingsOperations {
    getCapabilities(): Promise<CameraCapabilities>
    /** Uses the active camera property, including native shutter-angle mode without changing modes. */
    getExposureTime(): Promise<ExposureTime>
    setExposureTime(value: ExposureTimeInput, context?: ExposureContext): Promise<void>
    /**
     * Read fresh capabilities before writing. Strings use the body's advertised labels;
     * exposure time additionally accepts duration/angle values. Cross-unit conversion requires context.
     */
    setControl<Id extends CameraControlId>(
        id: Id,
        value: CameraControlInputs[Id],
        context?: ExposureContext
    ): Promise<CameraControlState>

    // Exposure
    getAperture(): Promise<string>
    setAperture(value: string): Promise<void>
    getIso(): Promise<string>
    setIso(value: string): Promise<void>
    setCanonManualExposureMode(): Promise<void>

    // Colour
    getWhiteBalance(): Promise<string>
    setWhiteBalance(value: string): Promise<void>
    getSonyColorTemperature(): Promise<number>
    setSonyColorTemperature(value: number): Promise<void>
    getCanonColorTemperature(): Promise<number>
    setCanonColorTemperature(kelvin: number): Promise<void>

    // Focus
    getFocusMode(): Promise<string>
    setFocusMode(value: string): Promise<void>
    getMovieServoAutofocus(): Promise<string>
    setMovieServoAutofocus(value: string): Promise<void>
    getContinuousAutofocus(): Promise<string>
    setContinuousAutofocus(value: string): Promise<void>
    getCanonLiveViewAutofocusMode(): Promise<string>
    setCanonLiveViewAutofocusMode(mode: string): Promise<void>

    // Photo
    getSonyImageFormat(): Promise<string>
    setSonyImageFormat(value: string): Promise<void>
    getSonyJpegQuality(): Promise<string>
    setSonyJpegQuality(value: string): Promise<void>
    getSonyImageSize(): Promise<string>
    setSonyImageSize(value: string): Promise<void>
    getSonyAspectRatio(): Promise<string>
    setSonyAspectRatio(value: string): Promise<void>
    getImageFormat(): Promise<CanonImageFormat>
    setImageFormat(packed: number): Promise<void>

    // Video
    getSonyMovieFileFormat(): Promise<string>
    setSonyMovieFileFormat(value: string): Promise<void>
    getSonyMovieRecordingSetting(): Promise<string>
    setSonyMovieRecordingSetting(value: string): Promise<void>
    getSonyZoomSetting(): Promise<string>
    setSonyZoomSetting(value: string): Promise<void>
    getMovieSize(): Promise<number>
    getMovieFormat(): ReturnType<CanonCamera['getMovieFormat']>
    setMovieFormat(key: string): Promise<void>
    getCanonMovieSoundRecording(): Promise<string>
    setCanonMovieSoundRecording(value: 'disabled' | 'auto' | 'manual'): Promise<void>
}

function sonyDriver(camera: Camera, unavailable: string): SonyCamera {
    const { driver } = cameraContext(camera)
    if (!(driver instanceof SonyCamera)) throw new Error(unavailable)
    return driver
}

function canonOrSonyDriver(camera: Camera, unavailable: string): CanonCamera | SonyCamera {
    const { driver } = cameraContext(camera)
    if (!(driver instanceof CanonCamera) && !(driver instanceof SonyCamera)) throw new Error(unavailable)
    return driver
}

const canonOnly = (subject: string) => `Canon ${subject} is only available for Canon EOS cameras`
const sonyOnly = (subject: string) => `Sony ${subject} is only available for Sony cameras`

export const settingsOperations: SettingsOperations & ThisType<Camera> = {
    async getCapabilities(): Promise<CameraCapabilities> {
        const capabilities = await requireCapability(this, 'settings', 'getCapabilities').readCapabilities()
        return { ...capabilities, operations: operationSupport(this) }
    },

    async getExposureTime(): Promise<ExposureTime> {
        const state = (await this.getCapabilities()).controls.shutterSpeed
        if (!state?.exposureTime) throw new Error('The current camera mode does not expose exposure time')
        return state.exposureTime
    },

    async setExposureTime(value: ExposureTimeInput, context?: ExposureContext): Promise<void> {
        await this.setControl('shutterSpeed', value, context)
    },

    async setControl<Id extends CameraControlId>(
        id: Id,
        value: CameraControlInputs[Id],
        context?: ExposureContext
    ): Promise<CameraControlState> {
        const settings = requireCapability(this, 'settings', 'setControl')
        return cameraContext(this).controlsQueue.run('camera', () => settings.writeControl(id, value, context))
    },

    async getAperture(): Promise<string> {
        return cameraContext(this).driver.getAperture()
    },

    async setAperture(value: string): Promise<void> {
        return cameraContext(this).driver.setAperture(value)
    },

    async getIso(): Promise<string> {
        return cameraContext(this).driver.getIso()
    },

    async setIso(value: string): Promise<void> {
        return cameraContext(this).driver.setIso(value)
    },

    async setCanonManualExposureMode(): Promise<void> {
        await canonDriver(this).setManualExposureMode()
    },

    async getWhiteBalance(): Promise<string> {
        return canonOrSonyDriver(this, 'White balance is only available for Canon EOS and Sony cameras').getWhiteBalance()
    },

    async setWhiteBalance(value: string): Promise<void> {
        return canonOrSonyDriver(this, 'White balance is only available for Canon EOS and Sony cameras').setWhiteBalance(
            value
        )
    },

    async getSonyColorTemperature(): Promise<number> {
        return sonyDriver(this, sonyOnly('color temperature')).getColorTemperature()
    },

    async setSonyColorTemperature(value: number): Promise<void> {
        return sonyDriver(this, sonyOnly('color temperature')).setColorTemperature(value)
    },

    async getCanonColorTemperature(): Promise<number> {
        return canonDriver(this).getColorTemperature()
    },

    async setCanonColorTemperature(kelvin: number): Promise<void> {
        await canonDriver(this).setColorTemperature(kelvin)
    },

    async getFocusMode(): Promise<string> {
        return canonOrSonyDriver(this, 'Focus mode is only available for Canon EOS and Sony cameras').getFocusMode()
    },

    async setFocusMode(value: string): Promise<void> {
        return canonOrSonyDriver(this, 'Focus mode is only available for Canon EOS and Sony cameras').setFocusMode(value)
    },

    async getMovieServoAutofocus(): Promise<string> {
        return canonDriver(this, canonOnly('movie servo autofocus')).getMovieServoAutofocus()
    },

    async setMovieServoAutofocus(value: string): Promise<void> {
        return canonDriver(this, canonOnly('movie servo autofocus')).setMovieServoAutofocus(value)
    },

    async getContinuousAutofocus(): Promise<string> {
        return canonDriver(this, canonOnly('continuous autofocus')).getContinuousAutofocus()
    },

    async setContinuousAutofocus(value: string): Promise<void> {
        return canonDriver(this, canonOnly('continuous autofocus')).setContinuousAutofocus(value)
    },

    async getCanonLiveViewAutofocusMode(): Promise<string> {
        return canonDriver(this).getLiveViewAutofocusMode()
    },

    async setCanonLiveViewAutofocusMode(mode: string): Promise<void> {
        await canonDriver(this).setLiveViewAutofocusMode(mode)
    },

    async getSonyImageFormat(): Promise<string> {
        return sonyDriver(this, sonyOnly('image format')).getImageFormat()
    },

    async setSonyImageFormat(value: string): Promise<void> {
        return sonyDriver(this, sonyOnly('image format')).setImageFormat(value)
    },

    async getSonyJpegQuality(): Promise<string> {
        return sonyDriver(this, sonyOnly('JPEG quality')).getJpegQuality()
    },

    async setSonyJpegQuality(value: string): Promise<void> {
        return sonyDriver(this, sonyOnly('JPEG quality')).setJpegQuality(value)
    },

    async getSonyImageSize(): Promise<string> {
        return sonyDriver(this, sonyOnly('image size')).getImageSize()
    },

    async setSonyImageSize(value: string): Promise<void> {
        return sonyDriver(this, sonyOnly('image size')).setImageSize(value)
    },

    async getSonyAspectRatio(): Promise<string> {
        return sonyDriver(this, sonyOnly('aspect ratio')).getAspectRatio()
    },

    async setSonyAspectRatio(value: string): Promise<void> {
        return sonyDriver(this, sonyOnly('aspect ratio')).setAspectRatio(value)
    },

    async getImageFormat(): Promise<CanonImageFormat> {
        return canonDriver(this, canonOnly('image format')).getImageFormat()
    },

    async setImageFormat(packed: number): Promise<void> {
        return canonDriver(this, canonOnly('image format')).setImageFormat(packed)
    },

    async getSonyMovieFileFormat(): Promise<string> {
        return sonyDriver(this, sonyOnly('movie format')).getMovieFileFormat()
    },

    async setSonyMovieFileFormat(value: string): Promise<void> {
        return sonyDriver(this, sonyOnly('movie format')).setMovieFileFormat(value)
    },

    async getSonyMovieRecordingSetting(): Promise<string> {
        return sonyDriver(this, sonyOnly('movie setting')).getMovieRecordingSetting()
    },

    async setSonyMovieRecordingSetting(value: string): Promise<void> {
        return sonyDriver(this, sonyOnly('movie setting')).setMovieRecordingSetting(value)
    },

    async getSonyZoomSetting(): Promise<string> {
        return sonyDriver(this, sonyOnly('zoom setting')).getZoomSetting()
    },

    async setSonyZoomSetting(value: string): Promise<void> {
        return sonyDriver(this, sonyOnly('zoom setting')).setZoomSetting(value)
    },

    async getMovieSize(): Promise<number> {
        return canonDriver(this, canonOnly('movie size')).getMovieSize()
    },

    async getMovieFormat() {
        return canonDriver(this, canonOnly('movie format')).getMovieFormat()
    },

    async setMovieFormat(key: string): Promise<void> {
        return canonDriver(this, canonOnly('movie format')).setMovieFormat(key)
    },

    async getCanonMovieSoundRecording(): Promise<string> {
        return canonDriver(this).getMovieSoundRecording()
    },

    async setCanonMovieSoundRecording(value: 'disabled' | 'auto' | 'manual'): Promise<void> {
        return canonDriver(this).setMovieSoundRecording(value)
    },
}
