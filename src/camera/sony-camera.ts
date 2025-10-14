/**
 * SonyCamera - Approach 6 Implementation
 *
 * Extends GenericCamera with Sony-specific authentication, operations, and overrides.
 * Accepts definition objects instead of strings with merged generic + Sony registries.
 */

import { EventEmitter } from '@ptp/types/event'
import type { EventData } from '@ptp/types/event'
import { createSonyRegistry, type SonyRegistry } from '@ptp/registry'
import type { CodecType, CodecDefinition, CodecInstance } from '@ptp/types/codec'
import { TransportInterface, PTPEvent } from '@transport/interfaces/transport.interface'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import type { ParameterDefinition } from '@ptp/types/parameter'
import { Logger, PTPTransferLog } from '@core/logger'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { parseLiveViewDataset } from '@ptp/datasets/vendors/sony/sony-live-view-dataset'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { GenericCamera } from './generic-camera'
import { OperationParams, OperationResponse } from '@ptp/types/type-helpers'

// ============================================================================
// Sony authentication constants
// ============================================================================

const SDIO_AUTH_PROTOCOL_VERSION = 0x012c
const SDIO_AUTH_DEVICE_PROPERTY_OPTION = 0x01
const SDIO_AUTH_KEY_CODE_1 = 0x00000000
const SDIO_AUTH_KEY_CODE_2 = 0x00000000

const SDIO_AUTH_PHASES = {
    PHASE_1: 0x01,
    PHASE_2: 0x02,
    PHASE_3: 0x03,
} as const

const SONY_CAPTURED_IMAGE_OBJECT_HANDLE = 0xffffc001
const SONY_LIVE_VIEW_OBJECT_HANDLE = 0xffffc002

// ============================================================================
// SonyCamera class
// ============================================================================

export class SonyCamera extends GenericCamera {
    private liveViewEnabled = false
    vendorId = VendorIDs.SONY
    declare protected registry: SonyRegistry

    constructor(transport: TransportInterface, logger: Logger) {
        super(transport, logger)
        // Override with Sony-specific registry
        this.registry = createSonyRegistry(transport.isLittleEndian()) as any
    }

    /**
     * Connect to Sony camera with SDIO_OpenSession and authentication
     */
    async connect(deviceIdentifier?: DeviceDescriptor): Promise<void> {
        await this.transport.connect({ ...deviceIdentifier, vendorId: this.vendorId })

        this.sessionId = Math.floor(Math.random() * 0xffffffff)

        // Use Sony-specific open session
        const openResult = await this.send(this.registry.operations.SDIO_OpenSession, {
            SessionId: this.sessionId,
            FunctionMode: 'REMOTE_AND_CONTENT_TRANSFER',
        })

        // Check if session was already open (response code 0x201e = SessionAlreadyOpen)
        if (openResult.code === 0x201e) {
            await this.send(this.registry.operations.CloseSession, {})
            await this.send(this.registry.operations.SDIO_OpenSession, {
                SessionId: this.sessionId,
                FunctionMode: 'REMOTE_AND_CONTENT_TRANSFER',
            })
        }

        // Small delay after opening session before starting authentication
        await new Promise(resolve => setTimeout(resolve, 100))

        await this.authenticate()

        // Configure Sony camera settings
        await this.set(this.registry.properties.PositionKeySetting, 'HOST_PRIORITY')
        await this.set(this.registry.properties.StillImageSaveDestination, 'CAMERA_DEVICE')
    }

    /**
     * Sony-specific 3-phase authentication handshake
     */
    private async authenticate(): Promise<void> {
        // Phase 1
        await this.send(this.registry.operations.SDIO_Connect, {
            phaseType: SDIO_AUTH_PHASES.PHASE_1,
            keyCode1: SDIO_AUTH_KEY_CODE_1,
            keyCode2: SDIO_AUTH_KEY_CODE_2,
        })

        // Phase 2
        await this.send(this.registry.operations.SDIO_Connect, {
            phaseType: SDIO_AUTH_PHASES.PHASE_2,
            keyCode1: SDIO_AUTH_KEY_CODE_1,
            keyCode2: SDIO_AUTH_KEY_CODE_2,
        })

        // Get extended device info - required for version verification
        await this.send(this.registry.operations.SDIO_GetExtDeviceInfo, {
            initiatorVersion: SDIO_AUTH_PROTOCOL_VERSION,
            flagOfDevicePropertyOption: 'ENABLE',
        })

        // Phase 3
        await this.send(this.registry.operations.SDIO_Connect, {
            phaseType: SDIO_AUTH_PHASES.PHASE_3,
            keyCode1: SDIO_AUTH_KEY_CODE_1,
            keyCode2: SDIO_AUTH_KEY_CODE_2,
        })
    }

    /**
     * Override get to use Sony's SDIO_GetExtDevicePropValue
     */
    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        if (!property.access.includes('Get')) {
            throw new Error(`Property ${property.name} is not readable`)
        }

        const response = await this.send(this.registry.operations.SDIO_GetExtDevicePropValue, {
            DevicePropCode: property.code,
        })

        if (!response.data) {
            throw new Error(
                `No data received from SDIO_GetExtDevicePropValue for ${property.name} (response code: 0x${response.code.toString(16)})`
            )
        }

        const propInfo = response.data
        return propInfo.currentValueDecoded as CodecType<P['codec']>
    }

    /**
     * Override set to use Sony's SDIO_SetExtDevicePropValue or SDIO_ControlDevice
     */
    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        if (!property.access.includes('Set')) {
            throw new Error(`Property ${property.name} is not writable`)
        }

        const isControlProperty =
            /ShutterReleaseButton|ShutterHalfReleaseButton|SetLiveViewEnable|MovieRecButton/i.test(property.name)

        const codec = this.resolveCodec(property.codec)
        const encodedValue = codec.encode(value)

        if (isControlProperty) {
            await this.send(
                this.registry.operations.SDIO_ControlDevice,
                {
                    sdiControlCode: property.code,
                    flagOfDevicePropertyOption: 'ENABLE',
                },
                encodedValue
            )
        } else {
            await this.send(
                this.registry.operations.SDIO_SetExtDevicePropValue,
                {
                    DevicePropCode: property.code,
                    flagOfDevicePropertyOption: 'ENABLE',
                },
                encodedValue
            )
        }
    }

    /**
     * Override on() to accept Sony events
     */
    on(eventName: string, handler: (event: EventData) => void): void {
        this.emitter.on(eventName, handler)
    }

    /**
     * Override off() to accept Sony events
     */
    off(eventName: string, handler?: (event: EventData) => void): void {
        if (handler) {
            this.emitter.off(eventName, handler)
        } else {
            this.emitter.removeAllListeners(eventName)
        }
    }

    /**
     * Start video recording
     */
    async startRecording(): Promise<void> {
        await this.set(this.registry.properties.MovieRecButton, 'DOWN')
    }

    /**
     * Stop video recording
     */
    async stopRecording(): Promise<void> {
        await this.set(this.registry.properties.MovieRecButton, 'UP')
    }

    /**
     * Capture still image
     */
    async captureImage(): Promise<{ info: ObjectInfo; data: Uint8Array } | null> {
        // Half-press shutter
        await this.set(this.registry.properties.ShutterHalfReleaseButton, 'DOWN')
        await new Promise(resolve => setTimeout(resolve, 500))

        // Full-press shutter
        await this.set(this.registry.properties.ShutterReleaseButton, 'DOWN')
        await this.set(this.registry.properties.ShutterReleaseButton, 'UP')
        await this.set(this.registry.properties.ShutterHalfReleaseButton, 'UP')

        await new Promise(resolve => setTimeout(resolve, 500))

        // Get object info
        const objectInfoResponse = await this.send(this.registry.operations.GetObjectInfo, {
            ObjectHandle: SONY_CAPTURED_IMAGE_OBJECT_HANDLE,
        })

        if (!objectInfoResponse.data) {
            return null
        }

        const objectInfo = objectInfoResponse.data
        const objectCompressedSize = objectInfo.objectCompressedSize

        // Get object data
        const objectResponse = await this.send(
            this.registry.operations.GetObject,
            {
                ObjectHandle: SONY_CAPTURED_IMAGE_OBJECT_HANDLE,
            },
            undefined,
            objectCompressedSize + 10 * 1024 * 1024 // Add 10MB buffer for safety
        )

        if (!objectResponse.data) {
            return null
        }

        return {
            info: objectInfo,
            data: objectResponse.data,
        }
    }

    /**
     * Capture single live view frame
     */
    async captureLiveView(): Promise<{ info: ObjectInfo; data: Uint8Array } | null> {
        if (!this.liveViewEnabled) {
            await this.set(this.registry.properties.SetLiveViewEnable, 'ENABLE')
            this.liveViewEnabled = true
        }

        await new Promise(resolve => setTimeout(resolve, 500))

        const objectInfoResponse = await this.send(this.registry.operations.GetObjectInfo, {
            ObjectHandle: SONY_LIVE_VIEW_OBJECT_HANDLE,
        })

        if (!objectInfoResponse.data) {
            return null
        }

        const objectInfo = objectInfoResponse.data

        await new Promise(resolve => setTimeout(resolve, 500))

        const objectFormat = objectInfo.objectFormat

        const objectResponse = await this.send(this.registry.operations.GetObject, {
            ObjectHandle: SONY_LIVE_VIEW_OBJECT_HANDLE,
        })

        if (!objectResponse.data) {
            return null
        }

        const liveViewData = parseLiveViewDataset(objectResponse.data, this.registry)

        // Try to look up Sony format info by code
        const sonyFormatInfo = Object.values(this.registry.formats).find(f => f.code === objectFormat)

        return liveViewData.liveViewImage
            ? {
                  info: {
                      ...objectInfo,
                      objectFormat: sonyFormatInfo?.code || objectFormat,
                  },
                  data: liveViewData.liveViewImage,
              }
            : null
    }

    /**
     * Stream live view frames (returns raw image data)
     */
    async streamLiveView(): Promise<Uint8Array> {
        if (!this.liveViewEnabled) {
            await this.set(this.registry.properties.SetLiveViewEnable, 'ENABLE')
            this.liveViewEnabled = true
        }

        const objectResponse = await this.send(this.registry.operations.GetObject, {
            ObjectHandle: SONY_LIVE_VIEW_OBJECT_HANDLE,
        })

        if (!objectResponse.data) {
            return new Uint8Array()
        }

        const liveViewData = parseLiveViewDataset(objectResponse.data, this.registry)

        return liveViewData.liveViewImage || new Uint8Array()
    }

    /**
     * Handle incoming PTP events from transport (Sony-specific)
     */
    protected handleEvent(event: PTPEvent): void {
        // Look up event definition by code in merged registry
        const eventDef = Object.values(this.registry.events).find(e => e.code === event.code)
        if (!eventDef) return

        // Emit event parameters as array
        this.emitter.emit(eventDef.name, event.parameters)
    }
}
