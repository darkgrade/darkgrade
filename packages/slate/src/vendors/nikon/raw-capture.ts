import type { NikonCamera } from '@vendors/nikon/nikon-camera'

/** Explicit lossless NEF capture; the caller holds Photo mode until restoration finishes. */
export async function withNikonRawCompression<T>(
    camera: NikonCamera, compression: 'lossless' | undefined, capture: () => Promise<T>
): Promise<T> {
    if (compression === undefined) return capture()
    if (compression !== 'lossless') throw new Error('Unsupported Nikon capture RAW compression')
    const property = camera.registry.properties.NikonRawCompression
    if (!(await camera.getVendorPropertyCodes()).includes(property.code))
        throw new Error('Nikon does not advertise RAW compression selection; no shutter command sent')
    const response = await camera.send(camera.registry.operations.GetDevicePropDescEx, { DevicePropCode: property.code })
    const descriptor = response.data
    if (response.code !== 0x2001 || !descriptor || descriptor.formFlag !== 2 ||
        !descriptor.supportedValuesRaw?.includes(0))
        throw new Error('Nikon does not advertise lossless RAW; no shutter command sent')
    const original = Number(descriptor.currentValueRaw)
    if (!Number.isInteger(original) || !descriptor.supportedValuesRaw.includes(original))
        throw new Error('Nikon RAW compression cannot be restored safely; no shutter command sent')
    if (original === 0) return capture()
    if (descriptor.getSet !== 'GET_SET')
        throw new Error('Nikon RAW compression is currently read-only; no shutter command sent')
    const name = (raw: number) => {
        const decoded = descriptor.supportedValuesDecoded?.[descriptor.supportedValuesRaw?.indexOf(raw) ?? -1]
        if (decoded !== 'Lossless' && decoded !== 'High efficiency★' && decoded !== 'High efficiency')
            throw new Error('Nikon RAW compression value has no known name; no shutter command sent')
        return decoded
    }
    const lossless = name(0)
    const originalName = name(original)
    let failure: unknown
    const setAndVerify = async (value: typeof lossless) => {
        await camera.set(property, value)
        if ((await camera.get(property)) !== value) throw new Error('Nikon RAW compression readback mismatch')
    }
    try {
        await setAndVerify(lossless)
        return await capture()
    } catch (error) {
        failure = error
        throw error
    } finally {
        // Restore even after a lost write acknowledgement or a rejected shutter.
        try { await setAndVerify(originalName) }
        catch (error) {
            if (failure) throw new AggregateError([failure, error], `${String(failure)}; restoring Nikon RAW compression: ${String(error)}`)
            throw error
        }
    }
}
