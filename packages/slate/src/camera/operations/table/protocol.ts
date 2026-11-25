import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

/**
 * The protocol area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const protocolOperationTable = {
    current: {
        getInstance: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        send: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        get: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        readValue: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        set: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        getStandardPropertyStates: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        setStandardProperty: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        getNikonVendorPropertyCodes: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        getSonyPropertyStates: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        sonyPressButton: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        getCanonPropertyStates: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        getCanonUnknownPropertyStates: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        getCanonExtendedDeviceInfo: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        getCanonNetworkState: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        setCanonNetworkCommunicationMode: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        setCanonLiveViewZoom: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        getCanonLiveViewPosition: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        setCanonLiveViewPosition: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
        panCanonLiveView: {
            area: 'protocol',
            disposition: { kind: 'protocol' },
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
