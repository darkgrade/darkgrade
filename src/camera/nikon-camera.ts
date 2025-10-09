/**
 * Nikon Camera Implementation
 * Extends GenericCamera with Nikon-specific vendor extensions
 */

import { GenericCamera, PropertyName, PropertyValue } from './generic-camera'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { nikonOperationDefinitions } from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
import { operationDefinitions as standardOperationDefinitions } from '@ptp/definitions/operation-definitions'
import { propertyDefinitions as standardPropertyDefinitions } from '@ptp/definitions/property-definitions'
import { responseDefinitions as standardResponseDefinitions } from '@ptp/definitions/response-definitions'
import { formatDefinitions as standardFormatDefinitions } from '@ptp/definitions/format-definitions'
import { Logger } from '@core/logger'

// Merge Nikon definitions with standard PTP definitions
const mergedOperationDefinitions = [...standardOperationDefinitions, ...nikonOperationDefinitions] as const

export class NikonCamera extends GenericCamera<
    typeof mergedOperationDefinitions,
    typeof standardPropertyDefinitions,
    typeof standardResponseDefinitions,
    typeof standardFormatDefinitions
> {
    constructor(transport: TransportInterface, logger: Logger<typeof mergedOperationDefinitions>) {
        super(
            transport,
            logger,
            mergedOperationDefinitions,
            standardPropertyDefinitions,
            standardResponseDefinitions,
            standardFormatDefinitions
        )
    }

    /**
     * Get property using Nikon's GetDevicePropValueEx operation
     * Returns raw property value bytes, same as standard GetDevicePropValue
     */
    async get<N extends PropertyName<typeof standardPropertyDefinitions>>(
        propertyName: N
    ): Promise<PropertyValue<N, typeof standardPropertyDefinitions>> {
        const property = this.propertyDefinitions.find(p => p.name === propertyName)
        if (!property) {
            throw new Error(`Unknown property: ${propertyName}`)
        }

        if (!property.access.includes('Get')) {
            throw new Error(`Property ${propertyName} is not readable`)
        }

        const response = await this.send('GetDevicePropValueEx', {
            DevicePropCode: property.code,
        })

        if (!response.data) {
            throw new Error('No data received from GetDevicePropValueEx')
        }

        const codec = this.resolveCodec(property.codec as any)
        const result = codec.decode(response.data)

        return result.value as PropertyValue<N, typeof standardPropertyDefinitions>
    }

    /**
     * Set property using Nikon's SetDevicePropValueEx operation
     */
    async set<N extends PropertyName<typeof standardPropertyDefinitions>>(
        propertyName: N,
        value: PropertyValue<N, typeof standardPropertyDefinitions>
    ): Promise<void> {
        const property = this.propertyDefinitions.find(p => p.name === propertyName)
        if (!property) {
            throw new Error(`Unknown property: ${propertyName}`)
        }

        if (!property.access.includes('Set')) {
            throw new Error(`Property ${propertyName} is not writable`)
        }

        const codec = this.resolveCodec(property.codec as any)
        const encodedValue = codec.encode(value as any)
        await this.send(
            'SetDevicePropValueEx',
            {
                DevicePropCode: property.code,
            },
            encodedValue
        )
    }

}
