/**
 * Hardware observations recorded in prose in darkgrade/test-bench, transcribed into profile facts.
 *
 * Every fact cites a test-bench file and a verbatim excerpt. The ingest script refuses to run if
 * an excerpt is no longer present in the checkout, so a transcription can always be traced back
 * to its evidence. Only results stated in the evidence appear here: when a request's parameters
 * or data were not stated they are omitted, which makes the simulator accept any parameters.
 */
import type { ProfileProperty, ProfileQuirk, RecordedExchange } from '@transport/simulated/camera-profile'

export interface EvidenceReference {
    path: string
    excerpt: string
}

type WithEvidence<T> = Omit<T, 'source'> & { evidence: EvidenceReference }

export interface CameraObservations {
    id: string
    /** Manufacturer and line names exactly as in camera-catalog/camera-lines.json. */
    manufacturer: string
    line: string
    model: string
    /** Exact catalog model association; a shared USB ID or product line cannot establish this alias. */
    catalogModel: string
    vendorId: string
    productIds: string[]
    usbEvidence: EvidenceReference
    firmware?: { value: string; evidence: EvidenceReference }
    exchanges: WithEvidence<RecordedExchange>[]
    properties: WithEvidence<ProfileProperty>[]
    quirks: WithEvidence<ProfileQuirk>[]
}

const compatibility = 'docs/camera-compatibility.md'
const canonMenuLedger = '.agents/skills/camera-re/references/canon-menu-ptp-investigation.md'
const canonPosition = '.agents/skills/camera-re/references/canon-ptp-position.md'
const nikonWireless = 'docs/evidence/nikon-z6-iii/wireless-profile-investigation.md'

export const benchProbeNote =
    'darkgrade tests/bench-probe.ts sends OpenSession(SessionID 1) and stops unless it returns OK, so a reported ' +
    '"PTP GetDeviceInfo completed" result establishes this exchange.'

const canonR6MarkIII: CameraObservations = {
    id: 'canon-eos-r6-mark-iii',
    catalogModel: 'Canon EOS R6 Mark III',
    manufacturer: 'Canon',
    line: 'EOS R (mirrorless, RF mount)',
    model: 'EOS R6 Mark III',
    vendorId: '0x04a9',
    productIds: ['0x3323'],
    usbEvidence: { path: compatibility, excerpt: '| Canon EOS R6 Mark III | `04a9:3323` | Firmware 1.0.1;' },
    firmware: { value: '1.0.1', evidence: { path: compatibility, excerpt: '`04a9:3323` | Firmware 1.0.1;' } },
    exchanges: [
        ...[
            ['0x10000', '0x1'],
            ['0x20000', '0xffffffff'],
            ['0x30000', '0xffffffff'],
        ].map(([selector, support]) => ({
            operation: '0x913f',
            name: 'EDSDK GetCameraSupport query',
            parameters: [selector, '0x80000518', '0x0'],
            response: { code: '0x2001', parameters: ['0x80000518', support] },
            evidence: {
                path: canonMenuLedger,
                excerpt:
                    'SDK selectors `0x10/0x20/0x30` send `0x913F [0x10000/0x20000/0x30000,0x80000518,0]`. All return `0x2001`. Responses are `[0x80000518,1]`, `[0x80000518,0xFFFFFFFF]`, `[0x80000518,0xFFFFFFFF]`.',
            },
        })),
        {
            operation: '0x911b',
            name: 'UI lock',
            parameters: ['0x0'],
            response: { code: '0x2001' },
            evidence: { path: canonMenuLedger, excerpt: '`0x911B [0]` then `0x911C []` both returned `0x2001`.' },
        },
        {
            operation: '0x911c',
            name: 'UI unlock',
            parameters: [],
            response: { code: '0x2001' },
            note: 'First unlock after a lock.',
            evidence: { path: canonMenuLedger, excerpt: '`0x911B [0]` then `0x911C []` both returned `0x2001`.' },
        },
        {
            operation: '0x911c',
            name: 'UI unlock',
            parameters: [],
            response: { code: '0x2019' },
            note: 'A redundant second unlock (or an unlock while live view is active) returns DeviceBusy.',
            evidence: {
                path: canonMenuLedger,
                excerpt: 'The first runner performed an unnecessary second unlock, which returned Busy;',
            },
        },
        ...['0xd126', '0xd19a', '0xd210', '0xd21e', '0xd282', '0xd283'].map(property => ({
            operation: '0x1014',
            name: 'GetDevicePropDesc',
            parameters: [property],
            response: { code: '0x200a' },
            note: 'The runner observed DevicePropNotSupported; usbmon did not retain the response payloads.',
            evidence: {
                path: canonMenuLedger,
                excerpt:
                    'Standard `0x1014 GetDevicePropDesc` reads for all six residual properties returned `0x200A DevicePropNotSupported` to the runner, without payload.',
            },
        })),
        {
            operation: '0x9197',
            parameters: [],
            response: { code: '0x2001' },
            evidence: { path: canonMenuLedger, excerpt: '| `9197 []` | `2001 OK`, no data;' },
        },
        {
            operation: '0x9195',
            parameters: ['0x1'],
            response: { code: '0x2001', data: '14000000000020a33130304d5344434600000000' },
            note: 'Folder record for handle 0xa3200000, "100MSDCF"; selector semantics beyond 1 are unknown.',
            evidence: {
                path: canonMenuLedger,
                excerpt:
                    '| **`9195 [1]`** | **`2001`, 20-byte folder record:** `14000000 000020a3 3130304d5344434600000000`.',
            },
        },
        ...[
            ['0x9114', '0x5', 'CanonSetRemoteMode'],
            ['0x9115', '0x1', 'CanonSetEventMode'],
            ['0x9114', '0x1', 'CanonSetRemoteMode'],
        ].map(([operation, mode, name]) => ({
            operation: operation,
            name,
            parameters: [mode],
            response: { code: '0x2001' },
            evidence: {
                path: canonMenuLedger,
                excerpt: '| Remote mode `9114 [5]`, event mode `[1]`, restore remote mode `[1]` | All returned `2001`.',
            },
        })),
        ...['0x9050', '0x905c'].map(operation => ({
            operation,
            parameters: [],
            response: { code: '0x201f' },
            evidence: {
                path: canonMenuLedger,
                excerpt:
                    '| Advertised `9050 []`, `905C []` in a plain PTP session | Both returned `201F TransactionCanceled`.',
            },
        })),
        ...[
            ['0x917c', [], 'The direct Darkgrade PTP path then read `917C [] => 2001 [0]`,'],
            ['0x917d', ['0x0'], 'and `917D [0] => 2001 [0]` (a response parameter, not a four-byte log file)'],
        ].map(([operation, parameters, excerpt]) => ({
            operation: operation as string,
            parameters: parameters as string[],
            response: { code: '0x2001', parameters: ['0x0'] },
            evidence: { path: canonMenuLedger, excerpt: excerpt as string },
        })),
        ...['0x9180', '0x9181'].map(operation => ({
            operation,
            parameters: [],
            response: { code: '0x2001' },
            evidence: {
                path: canonMenuLedger,
                excerpt:
                    'Two previously unmapped but advertised operations, 9180 and 9181, were each tested with no parameters and no outgoing DATA phase. Both returned 2001, no DATA container and no response parameters.',
            },
        })),
        {
            operation: '0x9060',
            name: 'Mode query',
            response: { code: '0x2001' },
            note: 'Request parameters were not recorded.',
            evidence: {
                path: compatibility,
                excerpt: 'The advertised0x9060 mode query returned0x2001 with no response parameters',
            },
        },
        ...['0xba8', '0xae0'].map(centerX => ({
            operation: '0x915b',
            name: 'CanonTouchFramePoint',
            parameters: ['0x3', centerX, '0x740', '0x0'],
            response: { code: '0x2001' },
            evidence: {
                path: canonPosition,
                excerpt: 'two commands `[3,2984,1856,0]` and `[3,2784,1856,0]`, both0x2001.',
            },
        })),
    ],
    properties: [],
    quirks: [
        ...[
            ['directory-selector-empty-drops-usb', '0x9195', []],
            ['directory-selector-zero-drops-usb', '0x9195', ['0x0']],
            ['folder-setter-empty-drops-usb', '0x9196', []],
            ['folder-setter-selector-drops-usb', '0x9196', ['0x1']],
        ].map(([id, operation, parameters]) => ({
            id: id as string,
            description: `Undocumented ${operation as string} with these parameters makes the body leave USB without a PTP response; recovery needs a power cycle.`,
            behaviour: {
                kind: 'disconnect-on-request' as const,
                operation: operation as string,
                parameters: parameters as string[],
            },
            evidence: {
                path: canonMenuLedger,
                excerpt:
                    (operation as string) === '0x9195'
                        ? '| `9195 []` plus empty data phase; `9195 [0]` | USB disappeared without a response;'
                        : '| `9196 [1]`; same selector with unchanged20-byte folder record as incoming data | Both lost USB without a response.',
            },
        })),
    ],
}

const canonR6: CameraObservations = {
    id: 'canon-eos-r6',
    catalogModel: 'Canon EOS R6',
    manufacturer: 'Canon',
    line: 'EOS R (mirrorless, RF mount)',
    model: 'EOS R6',
    vendorId: '0x04a9',
    productIds: ['0x32f5'],
    usbEvidence: {
        path: compatibility,
        excerpt: 'The former body reported `04a9:32f5` / EOS R6 through USB/PTP',
    },
    exchanges: [],
    properties: [],
    quirks: [
        {
            id: 'bench-label-differs-from-reported-model',
            description: 'Configured on the bench as "canon-r7", but USB/PTP identifies the body as an EOS R6.',
            behaviour: { kind: 'none' },
            evidence: {
                path: compatibility,
                excerpt: 'The former body reported `04a9:32f5` / EOS R6 through USB/PTP',
            },
        },
    ],
}

const canon80D: CameraObservations = {
    id: 'canon-eos-80d',
    catalogModel: 'Canon EOS 80D',
    manufacturer: 'Canon',
    line: 'EOS DSLR (EOS-protocol era: 40D/450D and later)',
    model: 'EOS 80D',
    vendorId: '0x04a9',
    productIds: ['0x3294'],
    usbEvidence: { path: compatibility, excerpt: '| Canon EOS 80D | `04a9:3294` |' },
    exchanges: [],
    properties: [],
    quirks: [
        {
            id: 'live-view-mode-reset-on-disconnect',
            description: 'The body resets CanonLiveViewMode when the PTP session closes normally.',
            behaviour: { kind: 'none' },
            evidence: {
                path: compatibility,
                excerpt: 'The body resets `CanonLiveViewMode` at normal PTP disconnect',
            },
        },
        {
            id: 'magnification-requires-live-af',
            description: '5x live-view magnification requires live AF rather than face tracking.',
            behaviour: { kind: 'none' },
            evidence: {
                path: compatibility,
                excerpt: 'The EOS 80D requires live AF rather than face tracking for the tested 5× magnification',
            },
        },
    ],
}

const nikonZ6III: CameraObservations = {
    id: 'nikon-z6-iii',
    catalogModel: 'Nikon Z6 III',
    manufacturer: 'Nikon',
    line: 'Z (mirrorless, Z mount)',
    model: 'Z6 III',
    vendorId: '0x04b0',
    productIds: ['0x0454'],
    usbEvidence: { path: nikonWireless, excerpt: 'Camera: Nikon Z6 III, firmware V2.00, USB `04b0:0454`' },
    firmware: {
        value: 'V2.00',
        evidence: { path: nikonWireless, excerpt: 'Camera: Nikon Z6 III, firmware V2.00, USB `04b0:0454`' },
    },
    exchanges: [
        {
            operation: '0x935d',
            name: 'Wireless hardware type',
            response: { code: '0x2001', parameters: ['0x21'] },
            evidence: { path: nikonWireless, excerpt: '| `935D` — hardware type | OK; response parameter `33` |' },
        },
        {
            operation: '0x936d',
            name: 'Supported wireless profile types',
            response: { code: '0x2001', parameters: ['0x1'] },
            evidence: {
                path: nikonWireless,
                excerpt: '| `936D` — supported profile types | OK; response parameter `1` |',
            },
        },
        {
            operation: '0x90e8',
            name: 'Wireless authenticate',
            dataFromHost: '010000',
            response: { code: '0x2001' },
            evidence: {
                path: nikonWireless,
                excerpt:
                    '| `90E8` — authenticate | Empty password encoded as PTP string `01 00 00`; response `2001` OK |',
            },
        },
        {
            operation: '0x935a',
            name: 'Complete wireless pairing',
            parameters: ['0x2001'],
            response: { code: '0x2005' },
            evidence: {
                path: nikonWireless,
                excerpt: '| `935A[2001]` — complete pairing | `2005` OperationNotSupported |',
            },
        },
        {
            operation: '0x90ef',
            name: 'Delete wireless profile',
            response: { code: '0x2001' },
            note: 'Deleted profile 0; the exact request parameters were not recorded.',
            evidence: {
                path: nikonWireless,
                excerpt: 'deleted only the newly created profile `0` with `90EF` (`2001`)',
            },
        },
    ],
    properties: [],
    quirks: [
        {
            id: 'camera-control-profile-stored-as-ftp',
            description:
                'A wireless profile requested as computer Camera Control (type 1/submode 1) is stored as FTP (type 2/submode 3).',
            behaviour: { kind: 'none' },
            evidence: {
                path: nikonWireless,
                excerpt:
                    'USB profile provisioning works, but the camera converts the requested Camera Control profile into an FTP profile.',
            },
        },
    ],
}

const nikonZ7: CameraObservations = {
    id: 'nikon-z7',
    catalogModel: 'Nikon Z7',
    manufacturer: 'Nikon',
    line: 'Z (mirrorless, Z mount)',
    model: 'Z 7',
    vendorId: '0x04b0',
    productIds: ['0x0442'],
    usbEvidence: { path: compatibility, excerpt: '| Nikon Z 7 | `04b0:0442` | Hardware verified 2026-08-19 |' },
    exchanges: [],
    properties: [],
    quirks: [],
}

const sonyA6700: CameraObservations = {
    id: 'sony-ilce-6700',
    catalogModel: 'Sony A6700 (PC Control)',
    manufacturer: 'Sony',
    line: 'Alpha APS-C E-mount (α6xxx / α5xxx)',
    model: 'ILCE-6700 (α6700)',
    vendorId: '0x054c',
    productIds: ['0x0e78', '0x096f'],
    usbEvidence: {
        path: compatibility,
        excerpt: '| Sony α6700 | `054c:0e78` in Remote Shoot; `054c:096f` before selection |',
    },
    exchanges: [],
    properties: [],
    quirks: [
        {
            id: 'usb-connection-mode-selects-product-id',
            description:
                'Enumerates as 054c:096f until USB Connection Mode is set to Remote Shoot (PC Remote) on the body, then as 054c:0e78. No PTP property persists the mode.',
            behaviour: { kind: 'none' },
            evidence: {
                path: compatibility,
                excerpt:
                    'The body exposes no persistent USB connection-mode property and no advertised `USBConnectionModeRequest` (`0xf012`).',
            },
        },
    ],
}

const sonyFx2: CameraObservations = {
    id: 'sony-ilme-fx2',
    catalogModel: 'Sony ILME-FX2',
    manufacturer: 'Sony',
    line: 'Cinema Line FX / ILME',
    model: 'ILME-FX2',
    vendorId: '0x054c',
    productIds: ['0x0f4a'],
    usbEvidence: { path: compatibility, excerpt: 'Configured identity `054c:0f4a`' },
    exchanges: [],
    properties: [],
    quirks: [
        {
            id: 'unpowered-body-enumerates-as-charger',
            description:
                'Without camera power the body enumerates only as 054c:0d68 "USB Bus-powered Device" and does not speak PTP.',
            behaviour: { kind: 'none' },
            evidence: {
                path: compatibility,
                excerpt: 'still returned only `054c:0d68` / USB Bus-powered Device',
            },
        },
        {
            id: 'legacy-iso-shutter-read-only-in-mode',
            description: 'Does not advertise writable legacy native ISO/shutter controls in the tested shooting state.',
            behaviour: { kind: 'none' },
            evidence: {
                path: 'docs/evidence/sony-native-usb-settings-2026-10-22.md',
                excerpt:
                    'The FX2 does not advertise writable legacy native ISO/shutter controls in this shooting state',
            },
        },
    ],
}

const olympusEPL5Evidence = {
    path: compatibility,
    excerpt:
        'Enumerates at 480 Mbps in MTP mode and completes `OpenSession`/`GetDeviceInfo` as “OLYMPUS E-PL5” through `GenericCamera`.',
}

const olympusEPL5: CameraObservations = {
    id: 'olympus-e-pl5',
    catalogModel: 'Olympus E-PL5',
    manufacturer: 'OM System / Olympus',
    line: 'PEN / compacts / TG (download-only)',
    model: 'E-PL5',
    vendorId: '0x07b4',
    productIds: ['0x012f'],
    usbEvidence: { path: compatibility, excerpt: '| Olympus E-PL5 | `07b4:012f` |' },
    exchanges: [
        {
            operation: '0x1002',
            name: 'OpenSession',
            response: { code: '0x2001' },
            note: 'Opened by GenericCamera, which uses a random session ID.',
            evidence: olympusEPL5Evidence,
        },
        {
            operation: '0x100e',
            name: 'InitiateCapture',
            response: { code: '0x2005' },
            note: 'InitiateCapture is absent from the advertised operation table; request parameters were not recorded.',
            evidence: {
                path: compatibility,
                excerpt: 'an actual attempt returned PTP `0x2005 OperationNotSupported`.',
            },
        },
    ],
    properties: [
        {
            code: '0x5001',
            name: 'BatteryLevel',
            access: 'get',
            observedValue: '100',
            evidence: {
                path: compatibility,
                excerpt:
                    'Darkgrade recognizes `BatteryLevel` (`0x5001`, read-only, 100%) and `DateTime` (`0x5011`, writable)',
            },
        },
        {
            code: '0x5011',
            name: 'DateTime',
            access: 'get-set',
            evidence: {
                path: compatibility,
                excerpt:
                    'Darkgrade recognizes `BatteryLevel` (`0x5001`, read-only, 100%) and `DateTime` (`0x5011`, writable)',
            },
        },
    ],
    quirks: [
        {
            id: 'no-remote-capture-in-mtp-mode',
            description:
                'The operation table omits standard InitiateCapture, so remote capture is unavailable in this mode.',
            behaviour: { kind: 'none' },
            evidence: {
                path: compatibility,
                excerpt:
                    'Its operation table contains identification, storage, object transfer, and property operations but omits standard `InitiateCapture`',
            },
        },
        {
            id: 'manual-mtp-selection-after-cold-boot',
            description:
                'After a cold boot the body may need a manual restart and MTP selection before it speaks PTP again.',
            behaviour: { kind: 'none' },
            evidence: {
                path: compatibility,
                excerpt:
                    'A full Shelly/cold-boot path may still require a manual restart and MTP selection on this older body.',
            },
        },
    ],
}

export const testBenchObservations: CameraObservations[] = [
    canonR6MarkIII,
    canonR6,
    canon80D,
    nikonZ6III,
    nikonZ7,
    sonyA6700,
    sonyFx2,
    olympusEPL5,
]
