import type { CameraProfile } from '@transport/simulated/camera-profile'

/**
 * A synthetic ISO 15740 responder for chaos runs. It is NOT a camera and claims no device
 * behaviour: no recorded profile carries property descriptors yet, so this fixture gives the fault
 * injector standard DevicePropDesc, capture and event traffic to break. Values follow the forms
 * ISO 15740 defines for these properties; they are not taken from any body.
 */
export const CHAOS_FIXTURE_PROFILE: CameraProfile = {
    schemaVersion: 1,
    id: 'chaos-fixture-iso15740',
    manufacturer: 'Synthetic',
    line: 'Chaos fixture',
    model: 'ISO 15740 responder (not a camera)',
    provenance: {
        fidelity: 'documented',
        sources: [{ location: 'packages/link/scripts/chaos/chaos-fixture.ts', excerpt: 'Synthetic fixture' }],
    },
    deviceInfo: {
        listsComplete: true,
        standardVersion: 100,
        vendorExtensionId: '0x0',
        vendorExtensionVersion: 0,
        vendorExtensionDescription: '',
        functionalMode: 0,
        operationsSupported: [
            '0x1001',
            '0x1002',
            '0x1003',
            '0x1004',
            '0x1005',
            '0x1007',
            '0x1008',
            '0x1009',
            '0x100e',
            '0x1014',
            '0x1015',
            '0x1016',
        ],
        eventsSupported: ['0x4002', '0x4006', '0x400d'],
        devicePropertiesSupported: ['0x5001', '0x5005', '0x5007', '0x500f'],
        captureFormats: ['0x3801'],
        imageFormats: ['0x3801'],
        manufacturer: 'Synthetic',
        model: 'Chaos fixture',
        deviceVersion: '1.0',
        serialNumber: '0000',
        source: 0,
    },
    properties: [
        {
            code: '0x5001',
            access: 'get',
            descriptor: {
                dataType: '0x0002',
                writable: false,
                factoryDefault: 100,
                current: 80,
                form: { range: { minimum: 0, maximum: 100, step: 1 } },
            },
            source: 0,
        },
        {
            code: '0x5005',
            access: 'get-set',
            descriptor: {
                dataType: '0x0004',
                writable: true,
                factoryDefault: 2,
                current: 2,
                form: { enumeration: [1, 2, 3, 4, 6] },
            },
            source: 0,
        },
        {
            code: '0x5007',
            access: 'get-set',
            descriptor: {
                dataType: '0x0004',
                writable: true,
                factoryDefault: 280,
                current: 400,
                form: { enumeration: [280, 400, 560, 800] },
            },
            source: 0,
        },
        {
            code: '0x500f',
            access: 'get-set',
            descriptor: {
                dataType: '0x0004',
                writable: true,
                factoryDefault: 100,
                current: 200,
                form: { enumeration: [100, 200, 400, 800, 1600] },
            },
            source: 0,
        },
    ],
    exchanges: [{ operation: '0x100e', response: { code: '0x2001' }, source: 0 }],
    events: [
        { code: '0x4002', parameters: ['0x10001'], afterOperation: '0x100e', source: 0 },
        { code: '0x400d', parameters: [], afterOperation: '0x100e', source: 0 },
    ],
    quirks: [],
}
