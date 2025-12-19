import { GenericCamera } from '@camera/generic-camera'
import { SonyCamera } from '@camera/sony-camera'
import type { Logger } from '@core/logger'
import type { TransportInterface } from '@transport/interfaces/transport.interface'

// Mock transport
declare const mockTransport: TransportInterface
declare const mockLogger: Logger
const camera = new GenericCamera(mockTransport, mockLogger)
const sonyCamera = new SonyCamera(mockTransport, mockLogger)

async function testAutomaticTypeInference() {
    console.log('Testing automatic type inference from definitions...\n')

    // ✅ Operations - types automatically inferred from operation-definitions.ts

    // No parameters - automatically knows no params needed
    await camera.send(camera.registry.operations.GetDeviceInfo, {})
    await camera.send(camera.registry.operations.CloseSession, {})
    await camera.send(camera.registry.operations.ResetDevice, {})
    await camera.send(camera.registry.operations.GetStorageIDs, {})

    // Required parameters - automatically knows types and count
    await camera.send(camera.registry.operations.OpenSession, { SessionID: 12345 })
    await camera.send(camera.registry.operations.GetStorageInfo, { StorageID: 0x10001 })
    await camera.send(camera.registry.operations.GetObjectInfo, { ObjectHandle: 0x1234 })
    await camera.send(camera.registry.operations.GetObject, { ObjectHandle: 0x1234 })

    // Optional parameters - automatically knows which are optional
    await camera.send(camera.registry.operations.InitiateCapture, {})
    await camera.send(camera.registry.operations.InitiateCapture, { StorageID: 0x10001 })
    await camera.send(camera.registry.operations.InitiateCapture, { StorageID: 0x10001, ObjectFormatCode: 0x3801 })

    await camera.send(camera.registry.operations.GetNumObjects, { StorageID: 0x10001 })
    await camera.send(camera.registry.operations.GetNumObjects, { StorageID: 0x10001, ObjectFormatCode: 0x3801 })
    await camera.send(camera.registry.operations.GetNumObjects, {
        StorageID: 0x10001,
        ObjectFormatCode: 0x3801,
        ParentObject: 0xffffffff,
    })

    // Multiple required parameters - automatically knows all are needed
    await camera.send(camera.registry.operations.MoveObject, {
        ObjectHandle: 0x1234,
        StorageID: 0x10001,
        ParentObjectHandle: 0x5678,
    })
    await camera.send(camera.registry.operations.CopyObject, {
        ObjectHandle: 0x1234,
        StorageID: 0x10001,
        ParentObjectHandle: 0x5678,
    })
    await camera.send(camera.registry.operations.GetPartialObject, { ObjectHandle: 0x1234, Offset: 0, MaxBytes: 1024 })

    // ✅ Properties - types automatically inferred from property-definitions.ts

    // Get returns correct type based on codec in definition
    await camera.get(camera.registry.properties.BatteryLevel)
    await camera.get(camera.registry.properties.ImageSize)
    await camera.get(camera.registry.properties.DateTime)
    await camera.get(camera.registry.properties.Artist)
    await camera.get(camera.registry.properties.ExposureTime)

    // Set requires correct type based on codec in definition
    await camera.set(camera.registry.properties.ExposureTime, '1/250')
    await camera.set(camera.registry.properties.ImageSize, '1920x1080')
    await camera.set(camera.registry.properties.Artist, 'John Doe')
    await camera.set(camera.registry.properties.DateTime, '2024-01-15T10:30:00')
    await camera.set(camera.registry.properties.FNumber, 'f/2.8')

    // Sony-specific properties with enum validation
    await sonyCamera.set(sonyCamera.registry.properties.S1S2Button, 'DOWN')
    await sonyCamera.set(sonyCamera.registry.properties.S1S2Button, 'UP')

    // ✅ Events - names automatically validated from event-definitions.ts
    camera.on(camera.registry.events.ObjectAdded, event => {
        console.log('Object added:', event)
    })

    camera.on(camera.registry.events.CaptureComplete, event => {
        console.log('Capture complete')
    })

    camera.on(camera.registry.events.DevicePropChanged, event => {
        console.log('Property changed')
    })
}

async function testCompileTimeErrors() {
    console.log('\nTesting compile-time error detection...\n')

    // ❌ These cause TypeScript compile errors

    // Missing required parameters - caught at compile time
    // @ts-expect-error - Missing required StorageID parameter
    await camera.send(camera.registry.operations.GetStorageInfo, {})
    // @ts-expect-error - Missing required parameters
    await camera.send(camera.registry.operations.MoveObject, { ObjectHandle: 0x1234 })
    // @ts-expect-error - Missing required parameter
    await camera.send(camera.registry.operations.MoveObject, { ObjectHandle: 0x1234, StorageID: 0x10001 })

    // Wrong parameter names - caught at compile time
    // @ts-expect-error - Invalid parameter name
    await camera.send(camera.registry.operations.GetDeviceInfo, { InvalidParam: 123 })
    // @ts-expect-error - Invalid parameter name
    await camera.send(camera.registry.operations.CloseSession, { InvalidParam: 456 })

    // Wrong parameter types - caught at compile time
    // @ts-expect-error - Wrong parameter type
    await camera.send(camera.registry.operations.OpenSession, { SessionID: 'not-a-number' })
    // @ts-expect-error - Wrong parameter type
    await camera.send(camera.registry.operations.GetStorageInfo, { StorageID: 'not-a-number' })

    // Wrong property value types - caught at compile time
    // @ts-expect-error - Wrong value type: number instead of string
    await camera.set(camera.registry.properties.ExposureTime, 123)
    // @ts-expect-error - Wrong value type: number instead of string
    await camera.set(camera.registry.properties.ImageSize, 456)
    // @ts-expect-error - Wrong value type: number instead of string
    await camera.set(camera.registry.properties.Artist, 789)

    // Invalid enum values for control properties - caught at compile time
    // @ts-expect-error - Invalid enum value for S1S2Button
    await sonyCamera.set(sonyCamera.registry.properties.S1S2Button, 'INVALID')

    await camera.connect()
    await camera.disconnect()
    await camera.get(camera.registry.properties.Artist)
    await camera.set(camera.registry.properties.CopyrightInfo, 'John Doe')
    await camera.on(camera.registry.events.ObjectAdded, () => {})
    await camera.off(camera.registry.events.ObjectAdded, () => {})
    await camera.send(camera.registry.operations.GetObject, { ObjectHandle: 0x1234 })

    // @ts-expect-error - Invalid event (using object with wrong shape)
    camera.on({ name: 123 }, () => {})

    // Enum parameter validation - these should fail
    await sonyCamera.send(sonyCamera.registry.operations.SDIO_Connect, {
        // @ts-expect-error - Invalid phaseType value
        phaseType: 'INVALID_PHASE',
        keyCode1: 'DEFAULT',
        keyCode2: 'DEFAULT',
    })

    await sonyCamera.send(sonyCamera.registry.operations.SDIO_GetExtDeviceInfo, {
        // @ts-expect-error - Invalid initiatorVersion value
        initiatorVersion: 'invalid_version',
        flagOfDevicePropertyOption: 'ENABLE',
    })

    await sonyCamera.send(sonyCamera.registry.operations.SDIO_GetExtDeviceInfo, {
        initiatorVersion: '3.00',
        // @ts-expect-error - Invalid flagOfDevicePropertyOption value
        flagOfDevicePropertyOption: 'INVALID',
    })

    console.log('✅ All invalid usage caught at compile time!')
}

async function testEnumTypeInference() {
    console.log('\nTesting enum type inference...\n')

    // ✅ Properties with enum codecs should return union types, not just string
    const focusStatus = await sonyCamera.get(sonyCamera.registry.properties.FocusIndication)
    // focusStatus should be: 'UNLOCK' | 'AF_S_FOCUSED' | 'AF_S_NOT_FOCUSED' | 'AF_C_TRACKING' | 'AF_C_FOCUSED' | ...

    // These should work (valid enum values)
    if (focusStatus === 'AF_S_FOCUSED') {
        console.log('Camera is focused (AF-S)')
    } else if (focusStatus === 'AF_C_FOCUSED') {
        console.log('Camera is focused (AF-C)')
    } else if (focusStatus === 'AF_C_TRACKING') {
        console.log('Camera is tracking subject')
    }

    // @ts-expect-error - Invalid value that's not in the enum
    const invalidCheck: typeof focusStatus = 'INVALID_STATUS'

    // ✅ Events with enum codec parameters should have properly typed params
    sonyCamera.on(sonyCamera.registry.events.SDIE_AFStatus, params => {
        // params.Status should be the same union type as focus indication enum
        const status = params.Status

        // These should work (valid enum values)
        if (status === 'AF_S_FOCUSED') {
            console.log('AF Status: Focused (AF-S)')
        } else if (status === 'AF_C_FOCUSED') {
            console.log('AF Status: Focused (AF-C)')
        } else if (status === 'AF_C_TRACKING') {
            console.log('AF Status: Tracking')
        }

        // @ts-expect-error - Invalid value that's not in the enum
        const invalid: typeof status = 'INVALID_STATUS'
    })

    // ✅ Setting enum properties should accept union values
    await sonyCamera.set(sonyCamera.registry.properties.S1S2Button, 'DOWN')
    await sonyCamera.set(sonyCamera.registry.properties.S1S2Button, 'UP')
    // @ts-expect-error - Invalid enum value
    await sonyCamera.set(sonyCamera.registry.properties.S1S2Button, 'INVALID')

    console.log('✅ Enum types correctly inferred!')
}
