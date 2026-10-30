import { CanonCamera } from '@camera/canon-camera'
import { SonyCamera } from '@camera/sony-camera'
import type { GenericCamera } from '@camera/generic-camera'
import type { PropertyDefinition } from '@ptp/types/property'
import type { OperationDefinition } from '@ptp/types/operation'
import { capturePropertyCodes } from '@vendors/capture-properties'
import { qualifyCameraSetting, type QualificationControl } from '@workflows/camera-qualification'

/** Explicit native-property round trip, recorded by the caller's existing trace transport. */
export async function qualifyProfileProperty(camera: GenericCamera, vendorId: number, code: number, value: string | number) {
    if (!capturePropertyCodes(vendorId).has(code)) throw new Error('Property is outside the numeric capture allowlist')
    const property = (Object.values(camera.registry.properties) as PropertyDefinition[]).find(item => item.code === code)
    if (!property || property.access !== 'GetSet') throw new Error('Property has no writable Darkgrade definition')
    const read = async () => {
        let control: QualificationControl
        if (camera instanceof SonyCamera) {
            await camera.refreshPropertyStates()
            control = camera.listPropertyStates().find(item => item.code === code) as QualificationControl || {}
        } else if (camera instanceof CanonCamera) {
            await camera.get(property)
            control = camera.listPropertyStates().find(item => item.code === code) as QualificationControl || {}
        } else {
            const operations = camera.registry.operations as Record<string, OperationDefinition>
            const response = await camera.send(operations.GetDevicePropDescEx || operations.GetDevicePropDesc, { DevicePropCode: code } as never) as { code: number; data?: unknown }
            if (response.code !== 0x2001 || !response.data) throw new Error('Camera did not return a property descriptor')
            const descriptor = response.data as any
            control = { value: descriptor.currentValueDecoded, writable: descriptor.getSet === 'GET_SET', allowedValues: descriptor.supportedValuesDecoded }
        }
        return { controls: { iso: control } }
    }
    // The shared verifier uses one scalar control slot; the exported identity is the
    // native property code, never an inferred semantic setting name.
    const { setting: _, ...report } = await qualifyCameraSetting({
        read, set: async (_setting, target) => camera.set(property, target as never),
    }, 'iso', value)
    return { property: code, name: property.name, ...report }
}
