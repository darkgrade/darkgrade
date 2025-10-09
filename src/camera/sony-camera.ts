/**
 * Sony Camera Implementation
 * Extends GenericCamera with Sony-specific authentication and overrides
 */

import { GenericCamera, PropertyName, PropertyValue } from './generic-camera'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { sonyOperationDefinitions } from '@ptp/definitions/vendors/sony/sony-operation-definitions'
import { sonyPropertyDefinitions } from '@ptp/definitions/vendors/sony/sony-property-definitions'
import { sonyResponseDefinitions } from '@ptp/definitions/vendors/sony/sony-response-definitions'
import { sonyFormatDefinitions } from '@ptp/definitions/vendors/sony/sony-format-definitions'
import { operationDefinitions as standardOperationDefinitions } from '@ptp/definitions/operation-definitions'
import { propertyDefinitions as standardPropertyDefinitions } from '@ptp/definitions/property-definitions'
import { responseDefinitions as standardResponseDefinitions } from '@ptp/definitions/response-definitions'
import { formatDefinitions as standardFormatDefinitions } from '@ptp/definitions/format-definitions'
import { parseLiveViewDataset } from '@ptp/datasets/vendors/sony/sony-live-view-dataset'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { getSonyFormatByCode } from '@ptp/definitions/vendors/sony/sony-format-definitions'

// Merge Sony definitions with standard PTP definitions
const mergedOperationDefinitions = [...standardOperationDefinitions, ...sonyOperationDefinitions] as const
const mergedPropertyDefinitions = [...standardPropertyDefinitions, ...sonyPropertyDefinitions] as const
const mergedResponseDefinitions = [...standardResponseDefinitions, ...sonyResponseDefinitions] as const
const mergedFormatDefinitions = [...standardFormatDefinitions, ...sonyFormatDefinitions] as const

const SDIO_AUTH_PROTOCOL_VERSION = 0x012c
const SDIO_AUTH_DEVICE_PROPERTY_OPTION = 0x01
const SDIO_AUTH_KEY_CODE_1 = 0x00000000
const SDIO_AUTH_KEY_CODE_2 = 0x00000000

const SDIO_AUTH_PHASES = {
    PHASE_1: 0x01,
    PHASE_2: 0x02,
    PHASE_3: 0x03,
} as const

import { Logger } from '@core/logger'

const SONY_CAPTURED_IMAGE_OBJECT_HANDLE = 0xffffc001
const SONY_LIVE_VIEW_OBJECT_HANDLE = 0xffffc002

export class SonyCamera extends GenericCamera<
    typeof mergedOperationDefinitions,
    typeof mergedPropertyDefinitions,
    typeof mergedResponseDefinitions,
    typeof mergedFormatDefinitions
> {
    private liveViewEnabled = false

    constructor(transport: TransportInterface, logger: Logger<typeof mergedOperationDefinitions>) {
        super(
            transport,
            logger,
            mergedOperationDefinitions,
            mergedPropertyDefinitions,
            mergedResponseDefinitions,
            mergedFormatDefinitions
        )
    }

    async connect(deviceIdentifier?: DeviceDescriptor): Promise<void> {
        await this.transport.connect(deviceIdentifier)

        this.sessionId = Math.floor(Math.random() * 0xffffffff)

        const openResult = await this.send('SDIO_OpenSession', {
            SessionId: this.sessionId,
            FunctionMode: 'REMOTE_AND_CONTENT_TRANSFER',
        })

        // Check if session was already open (response code 0x201e = SessionAlreadyOpen)
        if (openResult.code === 0x201e) {
            await this.send('CloseSession', {})
            const retryResult = await this.send('SDIO_OpenSession', {
                SessionId: this.sessionId,
                FunctionMode: 'REMOTE_AND_CONTENT_TRANSFER',
            })
        }

        // Small delay after opening session before starting authentication
        await new Promise(resolve => setTimeout(resolve, 100))

        await this.authenticate()

        await this.set('PositionKeySetting', 'HOST_PRIORITY')
        await this.set('StillImageSaveDestination', 'CAMERA_DEVICE')
    }

    private async authenticate(): Promise<void> {
        await this.send('SDIO_Connect', {
            phaseType: SDIO_AUTH_PHASES.PHASE_1,
            keyCode1: SDIO_AUTH_KEY_CODE_1,
            keyCode2: SDIO_AUTH_KEY_CODE_2,
        })
        await this.send('SDIO_Connect', {
            phaseType: SDIO_AUTH_PHASES.PHASE_2,
            keyCode1: SDIO_AUTH_KEY_CODE_1,
            keyCode2: SDIO_AUTH_KEY_CODE_2,
        })

        // Get extended device info - required for version verification
        const deviceInfo = await this.send('SDIO_GetExtDeviceInfo', {
            initiatorVersion: SDIO_AUTH_PROTOCOL_VERSION,
            flagOfDevicePropertyOption: SDIO_AUTH_DEVICE_PROPERTY_OPTION,
        })

        await this.send('SDIO_Connect', {
            phaseType: SDIO_AUTH_PHASES.PHASE_3,
            keyCode1: SDIO_AUTH_KEY_CODE_1,
            keyCode2: SDIO_AUTH_KEY_CODE_2,
        })
    }

    // async getMetering() {
    //     if (propertyName === 'Exposure') {
    //         const meteredExposure = await this.get('MeteredExposure' as N)
    //         const exposureCompensation = await this.get('ExposureCompensation' as N)
    //         return (meteredExposure !== '0 EV' ? meteredExposure : exposureCompensation) as PropertyValue<
    //             N,
    //             typeof mergedPropertyDefinitions
    //         >
    //     }
    // }

    async get<N extends PropertyName<typeof mergedPropertyDefinitions>>(
        propertyName: N
    ): Promise<PropertyValue<N, typeof mergedPropertyDefinitions>> {
        const property = this.propertyDefinitions.find(p => p.name === propertyName)
        if (!property) {
            throw new Error(`Unknown property: ${propertyName}`)
        }

        if (!property.access.includes('Get')) {
            throw new Error(`Property ${propertyName} is not readable`)
        }

        const response = await this.send('SDIO_GetExtDevicePropValue', {
            DevicePropCode: property.code,
        })

        if (!response.data) {
            throw new Error(`No data received from SDIO_GetExtDevicePropValue for ${propertyName}`)
        }

        // Data is automatically decoded by the operation's dataCodec
        const propInfo = response.data as any

        // Decode the property value from the raw bytes using the property's codec
        const codec = this.resolveCodec(property.codec as any)
        const result = codec.decode(propInfo.currentValueBytes)

        return result.value as PropertyValue<N, typeof mergedPropertyDefinitions>
    }

    async set<N extends PropertyName<typeof mergedPropertyDefinitions>>(
        propertyName: N,
        value: PropertyValue<N, typeof mergedPropertyDefinitions>
    ): Promise<void> {
        const property = this.propertyDefinitions.find(p => p.name === propertyName)
        if (!property) {
            throw new Error(`Unknown property: ${propertyName}`)
        }

        if (!property.access.includes('Set')) {
            throw new Error(`Property ${propertyName} is not writable`)
        }

        const isControlProperty =
            /ShutterReleaseButton|ShutterHalfReleaseButton|SetLiveViewEnable|MovieRecButton/i.test(property.name)

        const codec = this.resolveCodec(property.codec as any)
        const encodedValue = codec.encode(value as any)

        if (isControlProperty) {
            await this.send(
                'SDIO_ControlDevice',
                {
                    sdiControlCode: property.code,
                    flagOfDevicePropertyOption: 'ENABLE',
                },
                encodedValue
            )
        } else {
            await this.send(
                'SDIO_SetExtDevicePropValue',
                {
                    DevicePropCode: property.code,
                    flagOfDevicePropertyOption: 'ENABLE',
                },
                encodedValue
            )
        }
    }

    async startRecording(): Promise<void> {
        await this.set('MovieRecButton', 'DOWN')
    }

    async stopRecording(): Promise<void> {
        await this.set('MovieRecButton', 'UP')
    }

    async captureImage(): Promise<{ info: ObjectInfo; data: Uint8Array } | null> {
        await this.set('ShutterHalfReleaseButton', 'DOWN')
        await new Promise(resolve => setTimeout(resolve, 500))
        await this.set('ShutterReleaseButton', 'DOWN')
        await this.set('ShutterReleaseButton', 'UP')
        await this.set('ShutterHalfReleaseButton', 'UP')

        await new Promise(resolve => setTimeout(resolve, 500))

        const objectInfoResponse = await this.send('GetObjectInfo', {
            ObjectHandle: SONY_CAPTURED_IMAGE_OBJECT_HANDLE,
        })

        if (!objectInfoResponse.data) {
            return null
        }

        const objectInfo = objectInfoResponse.data
        const objectCompressedSize = objectInfo.objectCompressedSize

        const objectResponse = await this.send(
            'GetObject',
            {
                ObjectHandle: SONY_CAPTURED_IMAGE_OBJECT_HANDLE,
            },
            undefined,
            objectCompressedSize + 10 * 1024 * 1024 // Add 10MB buffer for safety
        )

        return objectResponse.data
            ? {
                  info: objectInfo,
                  data: objectResponse.data,
              }
            : null
    }

    async captureLiveView(): Promise<{ info: ObjectInfo; data: Uint8Array } | null> {
        if (!this.liveViewEnabled) {
            await this.set('SetLiveViewEnable', 'ENABLE')
            this.liveViewEnabled = true
        }

        await new Promise(resolve => setTimeout(resolve, 500))

        const objectInfoResponse = await this.send('GetObjectInfo', {
            ObjectHandle: SONY_LIVE_VIEW_OBJECT_HANDLE,
        })

        if (!objectInfoResponse.data) {
            return null
        }

        await new Promise(resolve => setTimeout(resolve, 500))

        const objectInfo = objectInfoResponse.data
        const objectCompressedSize = objectInfo.objectCompressedSize
        const objectFormat = objectInfo.objectFormat
        const sonyFormatInfo = getSonyFormatByCode(objectFormat)

        const objectResponse = await this.send('GetObject', {
            ObjectHandle: SONY_LIVE_VIEW_OBJECT_HANDLE,
        })

        if (!objectResponse.data) {
            return null
        }

        const liveViewData = parseLiveViewDataset(objectResponse.data)

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

    async streamLiveView(): Promise<Uint8Array> {
        if (!this.liveViewEnabled) {
            await this.set('SetLiveViewEnable', 'ENABLE')
            this.liveViewEnabled = true
        }

        const objectResponse = await this.send('GetObject', {
            ObjectHandle: SONY_LIVE_VIEW_OBJECT_HANDLE,
        })

        if (!objectResponse.data) {
            return new Uint8Array()
        }

        const liveViewData = parseLiveViewDataset(objectResponse.data)

        return liveViewData.liveViewImage || new Uint8Array()
    }
}
