import type { TransactionPolicy } from '@camera/transaction-channel'
export {readCameraStorages, readCameraObjectHandles, waitForNewCameraMovie} from '@camera/storage'
import { Logger } from '@core/logger'
import { LoggerConfig } from '@core/logger-config'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { StorageInfo } from '@ptp/datasets/storage-info-dataset'
import type { CanonExtendedDeviceInfo } from '@ptp/datasets/vendors/canon/canon-extended-device-info-dataset'
import type { CanonImageFormat } from '@ptp/datasets/vendors/canon/canon-image-format-dataset'
import type { CanonLiveViewFrame } from '@ptp/datasets/vendors/canon/canon-live-view-dataset'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import {
    createFujifilmRegistry,
    createLeicaRegistry,
    createOlympusRegistry,
    createPanasonicRegistry,
    createSigmaRegistry,
    type VendorOperationRegistry,
} from '@ptp/registry'
import type { CodecType } from '@ptp/types/codec'
import { EventDefinition } from '@ptp/types/event'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import { EventParams, OperationParams, OperationResponse } from '@ptp/types/type-helpers'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { USBTransport } from '@transport/usb/usb-transport'
import type { CanonNetworkState, CanonPropertyState, CanonUnknownPropertyState } from './canon-camera'
import { CanonCamera } from './canon-camera'
import { GenericCamera, type StandardPropertyState } from './generic-camera'
import { NikonCamera, type NikonFocusResult, type NikonFocusPointResult, type NikonLiveViewMetadata } from './nikon-camera'
import {
    SonyCamera,
    type SonyCameraButton,
    type SonyOsdImage,
    type SonyPropertyState,
    type SonyZoomResult,
} from './sony-camera'
import { VendorExtensionCamera } from './vendor-extension-camera'

export interface CameraOptions {
    logger?: Partial<LoggerConfig>
    device?: DeviceDescriptor
    transport?: TransportInterface
    /** Timeouts and DeviceBusy retries for every transaction (see DEFAULT_TRANSACTION_POLICY). */
    transactionPolicy?: Partial<TransactionPolicy>
    vendorId?: number
}

export class Camera {
    private instance: GenericCamera | SonyCamera | NikonCamera | CanonCamera | VendorExtensionCamera
    private deviceDescriptor?: DeviceDescriptor
    private logger: Logger
    private transport: TransportInterface

    constructor(options?: CameraOptions) {
        this.logger = new Logger(options?.logger)
        this.transport = options?.transport ?? new USBTransport(this.logger)
        this.deviceDescriptor = options?.device

        const vendorId = options?.vendorId ?? options?.device?.usb?.filters?.[0]?.vendorId
        switch (vendorId) {
            case VendorIDs.SONY:
                this.instance = new SonyCamera(this.transport, this.logger)
                break
            case VendorIDs.NIKON:
                this.instance = new NikonCamera(this.transport, this.logger)
                break
            case VendorIDs.CANON:
                this.instance = new CanonCamera(this.transport, this.logger)
                break
            case VendorIDs.FUJIFILM:
            case VendorIDs.PANASONIC:
            case VendorIDs.OLYMPUS:
            case VendorIDs.OM_DIGITAL:
            case VendorIDs.LEICA:
            case VendorIDs.SIGMA:
                this.instance = this.vendorExtensionCamera(vendorId)
                break
            default:
                this.instance = new GenericCamera(this.transport, this.logger)
                break
        }
        if (options?.transactionPolicy) this.instance.configureTransactions(options.transactionPolicy)
    }

    private vendorExtensionCamera(vendorId: number): VendorExtensionCamera {
        const littleEndian = this.transport.isLittleEndian()
        const registries: Record<number, () => VendorOperationRegistry> = {
            [VendorIDs.FUJIFILM]: () => createFujifilmRegistry(littleEndian),
            [VendorIDs.PANASONIC]: () => createPanasonicRegistry(littleEndian),
            [VendorIDs.OLYMPUS]: () => createOlympusRegistry(littleEndian),
            [VendorIDs.OM_DIGITAL]: () => createOlympusRegistry(littleEndian),
            [VendorIDs.LEICA]: () => createLeicaRegistry(littleEndian),
            [VendorIDs.SIGMA]: () => createSigmaRegistry(littleEndian),
        }
        return new VendorExtensionCamera(this.transport, this.logger, registries[vendorId](), vendorId)
    }

    getInstance(): GenericCamera {
        return this.instance
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        return this.instance.connect(device || this.deviceDescriptor)
    }

    /** Opens a Sony contents-transfer session for body-menu controls. */
    async connectSonyMenuSession(device?: DeviceDescriptor): Promise<void> {
        if (!(this.instance instanceof SonyCamera)) throw new Error('Sony menu sessions require a Sony camera')
        await this.instance.connect(device || this.deviceDescriptor, { mode: 'menus' })
    }

    async disconnect(): Promise<void> {
        return this.instance.disconnect()
    }

    async send<Op extends OperationDefinition>(
        operation: Op,
        params: OperationParams<Op>,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>> {
        return this.instance.send(operation, params, data, maxDataLength)
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        return this.instance.get(property)
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        return this.instance.set(property, value)
    }

    async getStandardPropertyStates(): Promise<StandardPropertyState[]> {
        return this.instance.getStandardPropertyStates()
    }

    async setStandardProperty(propertyNameOrCode: string | number, value: string | number): Promise<void> {
        return this.instance.setStandardProperty(propertyNameOrCode, value)
    }

    on<E extends EventDefinition>(event: E, handler: (params: EventParams<E>) => void): void {
        return this.instance.on(event, handler)
    }

    off<E extends EventDefinition>(event: E, handler?: (params: EventParams<E>) => void): void {
        return this.instance.off(event, handler)
    }

    async getAperture(): Promise<string> {
        return this.instance.getAperture()
    }

    async setAperture(value: string): Promise<void> {
        return this.instance.setAperture(value)
    }

    async getShutterSpeed(): Promise<string> {
        return this.instance.getShutterSpeed()
    }

    async setShutterSpeed(value: string): Promise<void> {
        return this.instance.setShutterSpeed(value)
    }

    async getIso(): Promise<string> {
        return this.instance.getIso()
    }

    async setIso(value: string): Promise<void> {
        return this.instance.setIso(value)
    }

    async keepDeviceOn(): Promise<void> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('KeepDeviceOn is only available for Canon EOS cameras')
        }
        return this.instance.keepDeviceOn()
    }

    async autofocus(durationMilliseconds?: number): Promise<void> {
        if (this.instance instanceof NikonCamera) {
            await this.instance.autofocus(durationMilliseconds)
            return
        }
        if (!(this.instance instanceof CanonCamera) && !(this.instance instanceof SonyCamera)) {
            throw new Error('Standalone autofocus is only implemented for Canon EOS and Sony cameras')
        }
        return this.instance.autofocus(durationMilliseconds)
    }

    async getNikonVendorPropertyCodes(): Promise<number[]> {
        if (!(this.instance instanceof NikonCamera)) throw new Error('Nikon vendor properties require a Nikon camera')
        return this.instance.getVendorPropertyCodes()
    }

    async nikonAutofocus(timeoutMilliseconds?: number): Promise<NikonFocusResult> {
        if (!(this.instance instanceof NikonCamera)) throw new Error('Nikon autofocus requires a Nikon camera')
        return this.instance.autofocus(timeoutMilliseconds)
    }

    async nikonTouchFocus(x: number, y: number, options?: { focus?: boolean }): Promise<NikonFocusPointResult> {
        if (!(this.instance instanceof NikonCamera)) throw new Error('Nikon point focus requires a Nikon camera')
        return this.instance.touchFocus(x, y, options)
    }

    async nikonDriveFocus(direction: 'near' | 'far', steps?: number) {
        if (!(this.instance instanceof NikonCamera)) throw new Error('Nikon manual focus requires a Nikon camera')
        return this.instance.driveFocus(direction, steps)
    }

    async getFocusMode(): Promise<string> {
        if (!(this.instance instanceof CanonCamera) && !(this.instance instanceof SonyCamera)) {
            throw new Error('Focus mode is only available for Canon EOS and Sony cameras')
        }
        return this.instance.getFocusMode()
    }

    async setFocusMode(value: string): Promise<void> {
        if (!(this.instance instanceof CanonCamera) && !(this.instance instanceof SonyCamera)) {
            throw new Error('Focus mode is only available for Canon EOS and Sony cameras')
        }
        return this.instance.setFocusMode(value)
    }

    async getWhiteBalance(): Promise<string> {
        if (!(this.instance instanceof CanonCamera) && !(this.instance instanceof SonyCamera)) {
            throw new Error('White balance is only available for Canon EOS and Sony cameras')
        }
        return this.instance.getWhiteBalance()
    }

    async setWhiteBalance(value: string): Promise<void> {
        if (!(this.instance instanceof CanonCamera) && !(this.instance instanceof SonyCamera)) {
            throw new Error('White balance is only available for Canon EOS and Sony cameras')
        }
        return this.instance.setWhiteBalance(value)
    }

    async getCanonHdmiLiveViewMode(): Promise<string> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon HDMI live-view mode is only available for Canon EOS cameras')
        }
        return this.instance.getHdmiLiveViewMode()
    }

    async setCanonHdmiLiveViewMode(value: string): Promise<void> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon HDMI live-view mode is only available for Canon EOS cameras')
        }
        return this.instance.setHdmiLiveViewMode(value)
    }

    async getSonyPropertyStates(): Promise<SonyPropertyState[]> {
        if (!(this.instance instanceof SonyCamera)) {
            throw new Error('Sony property state is only available for Sony cameras')
        }
        await this.instance.refreshPropertyStates()
        return this.instance.listPropertyStates()
    }

    async getSonyImageFormat(): Promise<string> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony image format is only available for Sony cameras')
        return this.instance.getImageFormat()
    }

    async setSonyImageFormat(value: string): Promise<void> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony image format is only available for Sony cameras')
        return this.instance.setImageFormat(value)
    }

    async getSonyJpegQuality(): Promise<string> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony JPEG quality is only available for Sony cameras')
        return this.instance.getJpegQuality()
    }

    async setSonyJpegQuality(value: string): Promise<void> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony JPEG quality is only available for Sony cameras')
        return this.instance.setJpegQuality(value)
    }

    async getSonyMovieFileFormat(): Promise<string> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony movie format is only available for Sony cameras')
        return this.instance.getMovieFileFormat()
    }

    async setSonyMovieFileFormat(value: string): Promise<void> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony movie format is only available for Sony cameras')
        return this.instance.setMovieFileFormat(value)
    }

    async getSonyMovieRecordingSetting(): Promise<string> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony movie setting is only available for Sony cameras')
        return this.instance.getMovieRecordingSetting()
    }

    async setSonyMovieRecordingSetting(value: string): Promise<void> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony movie setting is only available for Sony cameras')
        return this.instance.setMovieRecordingSetting(value)
    }

    async getSonyImageSize(): Promise<string> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony image size is only available for Sony cameras')
        return this.instance.getImageSize()
    }

    async setSonyImageSize(value: string): Promise<void> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony image size is only available for Sony cameras')
        return this.instance.setImageSize(value)
    }

    async getSonyAspectRatio(): Promise<string> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony aspect ratio is only available for Sony cameras')
        return this.instance.getAspectRatio()
    }

    async setSonyAspectRatio(value: string): Promise<void> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony aspect ratio is only available for Sony cameras')
        return this.instance.setAspectRatio(value)
    }

    async getSonyColorTemperature(): Promise<number> {
        if (!(this.instance instanceof SonyCamera)) {
            throw new Error('Sony color temperature is only available for Sony cameras')
        }
        return this.instance.getColorTemperature()
    }

    async setSonyColorTemperature(value: number): Promise<void> {
        if (!(this.instance instanceof SonyCamera)) {
            throw new Error('Sony color temperature is only available for Sony cameras')
        }
        return this.instance.setColorTemperature(value)
    }

    async getSonyZoomPosition(): Promise<number> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony zoom position is only available for Sony cameras')
        return this.instance.getZoomPosition()
    }

    async sonyPowerZoom(direction: 'wide' | 'tele', pulses?: number): Promise<SonyZoomResult> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony power zoom is only available for Sony cameras')
        return this.instance.powerZoom(direction, pulses)
    }

    async sonyTouchFocus(x: number, y: number, options?: { focus?: boolean }): Promise<{ x: number; y: number }> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony touch focus is only available for Sony cameras')
        return this.instance.touchFocus(x, y, options)
    }

    async sonyPressButton(
        button: SonyCameraButton,
        options?: { action?: 'click' | 'press' | 'release'; holdMilliseconds?: number }
    ): Promise<void> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony camera buttons are only available for Sony cameras')
        return this.instance.pressButton(button, options)
    }

    async captureSonyOsdImage(): Promise<SonyOsdImage> {
        if (!(this.instance instanceof SonyCamera)) throw new Error('Sony OSD image is only available for Sony cameras')
        return this.instance.captureOsdImage()
    }

    async setSonyAfAreaPosition(x: number, y: number): Promise<void> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony AF-area position is only available for Sony cameras')
        return this.instance.setAfAreaPosition(x, y)
    }

    async getSonyZoomSetting(): Promise<string> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony zoom setting is only available for Sony cameras')
        return this.instance.getZoomSetting()
    }

    async setSonyZoomSetting(value: string): Promise<void> {
        if (!(this.instance instanceof SonyCamera))
            throw new Error('Sony zoom setting is only available for Sony cameras')
        return this.instance.setZoomSetting(value)
    }

    async getImageFormat(): Promise<CanonImageFormat> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon image format is only available for Canon EOS cameras')
        }
        return this.instance.getImageFormat()
    }

    async setImageFormat(packed: number): Promise<void> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon image format is only available for Canon EOS cameras')
        }
        return this.instance.setImageFormat(packed)
    }

    async getMovieSize(): Promise<number> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon movie size is only available for Canon EOS cameras')
        }
        return this.instance.getMovieSize()
    }

    async getMovieFormat() {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon movie format is only available for Canon EOS cameras')
        }
        return this.instance.getMovieFormat()
    }

    async setMovieFormat(key: string): Promise<void> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon movie format is only available for Canon EOS cameras')
        }
        return this.instance.setMovieFormat(key)
    }

    async getCanonPropertyStates(): Promise<CanonPropertyState[]> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon property state is only available for Canon EOS cameras')
        }
        return this.instance.listPropertyStates()
    }

    async getCanonUnknownPropertyStates(): Promise<CanonUnknownPropertyState[]> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon raw property state is only available for Canon EOS cameras')
        }
        return this.instance.listUnknownPropertyStates()
    }

    async getCanonMovieSoundRecording(): Promise<string> {
        return this.canonCamera().getMovieSoundRecording()
    }

    async setCanonMovieSoundRecording(value: 'disabled' | 'auto' | 'manual'): Promise<void> {
        return this.canonCamera().setMovieSoundRecording(value)
    }

    async ensureCanonMovieSoundRecording(): Promise<boolean> {
        return this.canonCamera().ensureMovieSoundRecording()
    }

    async getMovieServoAutofocus(): Promise<string> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon movie servo autofocus is only available for Canon EOS cameras')
        }
        return this.instance.getMovieServoAutofocus()
    }

    async setMovieServoAutofocus(value: string): Promise<void> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon movie servo autofocus is only available for Canon EOS cameras')
        }
        return this.instance.setMovieServoAutofocus(value)
    }

    async getContinuousAutofocus(): Promise<string> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon continuous autofocus is only available for Canon EOS cameras')
        }
        return this.instance.getContinuousAutofocus()
    }

    async setContinuousAutofocus(value: string): Promise<void> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon continuous autofocus is only available for Canon EOS cameras')
        }
        return this.instance.setContinuousAutofocus(value)
    }

    getCanonNetworkState(): CanonNetworkState {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon network state is only available for Canon EOS cameras')
        }
        return this.instance.getNetworkState()
    }

    async setCanonNetworkCommunicationMode(value: number, allowUnadvertised = false): Promise<void> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon network communication mode is only available for Canon EOS cameras')
        }
        return this.instance.setNetworkCommunicationMode(value, allowUnadvertised)
    }

    async enterMovieMode(): Promise<void> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon movie mode is only available for Canon EOS cameras')
        }
        return this.instance.enterMovieMode()
    }

    async leaveMovieMode(): Promise<void> {
        if (!(this.instance instanceof CanonCamera)) {
            throw new Error('Canon movie mode is only available for Canon EOS cameras')
        }
        return this.instance.leaveMovieMode()
    }

    async captureImage(params?: { includeInfo?: boolean; includeData?: boolean; autofocus?: boolean }) {
        if (params?.autofocus === false && !(this.instance instanceof CanonCamera))
            throw new Error('Capture without autofocus is only implemented for Canon EOS cameras')
        return this.instance.captureImage({ includeInfo: true, includeData: true, ...params })
    }

    async captureLiveView(params?: { includeInfo?: boolean; includeData?: boolean }): Promise<{
        info?: ObjectInfo; data?: Uint8Array; nikonMetadata?: NikonLiveViewMetadata
    }> {
        return this.instance.captureLiveView({ includeInfo: true, includeData: true, ...params })
    }

    async captureCanonViewfinderFrame(): Promise<CanonLiveViewFrame> {
        return this.canonCamera().captureViewfinderFrame()
    }

    /** Explicitly read advertised Canon extended capabilities; discovery does not establish writability. */
    async getCanonExtendedDeviceInfo(): Promise<CanonExtendedDeviceInfo> {
        return this.canonCamera().getExtendedDeviceInfo()
    }

    async stopCanonLiveView(): Promise<void> {
        await this.canonCamera().stopLiveView()
    }

    async setCanonLiveViewZoom(magnification: 1 | 5 | 6 | 10 | 15): Promise<void> {
        await this.canonCamera().setLiveViewZoom(magnification)
    }

    async getCanonLiveViewPosition() {
        return this.canonCamera().getLiveViewPosition()
    }

    async setCanonLiveViewPosition(x: number, y: number) {
        return this.canonCamera().setLiveViewPosition(x, y)
    }

    async panCanonLiveView(direction: 'up' | 'down' | 'left' | 'right', step = 200) {
        return this.canonCamera().panLiveView(direction, step)
    }

    async setCanonLiveViewFramePoint(x: number, y: number, lockAfFrame = false) {
        return this.canonCamera().setLiveViewFramePoint(x, y, lockAfFrame)
    }

    async setCanonManualExposureMode(): Promise<void> {
        await this.canonCamera().setManualExposureMode()
    }

    async getCanonColorTemperature(): Promise<number> {
        return this.canonCamera().getColorTemperature()
    }

    async setCanonColorTemperature(kelvin: number): Promise<void> {
        await this.canonCamera().setColorTemperature(kelvin)
    }

    async getCanonLiveViewAutofocusMode(): Promise<string> {
        return this.canonCamera().getLiveViewAutofocusMode()
    }

    async setCanonLiveViewAutofocusMode(mode: string): Promise<void> {
        await this.canonCamera().setLiveViewAutofocusMode(mode)
    }

    private canonCamera(): CanonCamera {
        if (!(this.instance instanceof CanonCamera))
            throw new Error('This control is only available for Canon EOS cameras')
        return this.instance
    }

    async startRecording(): Promise<void> {
        return this.instance.startRecording()
    }

    async stopRecording(): Promise<void> {
        return this.instance.stopRecording()
    }

    async listObjects(): Promise<{
        [storageId: number]: {
            info: StorageInfo
            objects: { [objectHandle: number]: ObjectInfo }
        }
    }> {
        return this.instance.listObjects()
    }

    async getObject(objectHandle: number, objectSize: number): Promise<Uint8Array> {
        return this.instance.getObject(objectHandle, objectSize)
    }
}

export { DEFAULT_TRANSACTION_POLICY, type TransactionPolicy } from '@camera/transaction-channel'
export { CanonCamera } from './canon-camera'
export { GenericCamera } from './generic-camera'
export { NikonCamera } from './nikon-camera'
export { SONY_CAMERA_BUTTONS, SonyCamera } from './sony-camera'
export type { SonyCameraButton, SonyOsdImage, SonyPropertyState, SonyZoomResult } from './sony-camera'
export { VendorExtensionCamera } from './vendor-extension-camera'

export { sonyWifiKeyboardCharacter, typeSonyWifiKeyboard } from '@vendors/sony/wifi-keyboard'
export type { SonyKeyboardControls, SonyKeyboardImage } from '@vendors/sony/wifi-keyboard'

export type { NikonFocusResult, NikonFocusPointResult, NikonLiveViewMetadata } from './nikon-camera'
export {readCameraMovieAudio,inspectMovieTrackHandlers,type CameraMovieAudio} from '@camera/movie-audio'
