import type { focusControlDefinitions } from '@camera/settings/focus'
import * as standard from '@ptp/definitions/property-definitions'
import * as canon from '@ptp/definitions/vendors/canon/canon-property-definitions'
import * as nikonStandard from '@ptp/definitions/vendors/nikon/nikon-property-definitions'
import * as nikon from '@ptp/definitions/vendors/nikon/nikon-shooting-property-definitions'
import * as sony from '@ptp/definitions/vendors/sony/sony-property-definitions'
import type { SonyFocusAreaName } from '@ptp/definitions/vendors/sony/sony-property-definitions'
import type { CodecType } from '@ptp/types/codec'
import type { NikonFocusModeLabel } from '@vendors/nikon/control-values'
import type {
    ControlValueNames,
    VendorControlProperties,
} from '@vendors/control-properties/vendor-control-properties'

const standardProperties = {
    focusMode: [standard.FocusMode],
} as const

/**
 * The focus group's vendor properties: for each canonical id, the properties that carry it,
 * in preference order within one vendor and mode (never across vendors). Typed definitions, so
 * each setting's value type is derived from the codecs (see `CodecValue`).
 *
 * Canon lists Movie Servo AF before its focus mode: in video mode Movie Servo AF is what makes
 * focus continuous, so it is the focus mode there (`canonFocusModeStates` keeps it only then).
 */
export const focusControlProperties = {
    sony: {
        focusMode: [sony.FocusMode],
        focusArea: [sony.FocusArea],
        subjectDetection: [sony.SubjectRecognitionInAF],
        detectionSubject: [sony.RecognitionTarget],
        eyeSelection: [sony.RightLeftEyeSelect],
    },
    canon: {
        focusMode: [canon.CanonMovieServoAutofocus, canon.CanonFocusMode],
        focusArea: [canon.CanonLiveViewAutofocusMode],
        continuousAutofocus: [canon.CanonContinuousAutofocus],
    },
    standard: standardProperties,
    nikonPhoto: {
        ...standardProperties,
        focusMode: [nikon.NikonStillFocusMode, nikonStandard.FocusMode],
    },
    nikonMovie: {
        ...standardProperties,
        focusMode: [nikon.NikonMovieFocusMode],
    },
} as const satisfies VendorControlProperties<keyof typeof focusControlDefinitions>

type Names<Value extends string> = Readonly<Record<Value, string>>

const onOff = { Off: 'Off', On: 'On' } as const satisfies Names<CodecType<typeof sony.SubjectRecognitionInAF.codec>>

const sonyFocusModes = {
    Manual: 'MF',
    'AF-S': 'AF-S',
    'AF-C': 'AF-C',
    'AF-A': 'AF-A',
    DMF: 'DMF',
    'Manual Reverse': 'MF reverse',
    'AF-D': 'AF-D',
    'Preset Focus': 'Preset focus',
} as const satisfies Names<CodecType<typeof sony.FocusMode.codec>>

/** Sony's Flexible Spot is a spot (Canon's word too); Lock-on AF is tracking (Sony's newer menus). */
const sonyFocusAreas = {
    Wide: 'Wide',
    Zone: 'Zone',
    Center: 'Center',
    'Flexible Spot S': 'Spot S',
    'Flexible Spot M': 'Spot M',
    'Flexible Spot L': 'Spot L',
    'Expand Flexible Spot': 'Expanded Spot',
    'Flexible Spot': 'Spot',
    'Flexible Spot XS': 'Spot XS',
    'Flexible Spot XL': 'Spot XL',
    'Flexible Spot Free Size 1': 'Spot Free Size 1',
    'Flexible Spot Free Size 2': 'Spot Free Size 2',
    'Flexible Spot Free Size 3': 'Spot Free Size 3',
    'Lock on AF Wide': 'Tracking Wide',
    'Lock on AF Zone': 'Tracking Zone',
    'Lock on AF Center': 'Tracking Center',
    'Lock on AF Flexible Spot S': 'Tracking Spot S',
    'Lock on AF Flexible Spot M': 'Tracking Spot M',
    'Lock on AF Flexible Spot L': 'Tracking Spot L',
    'Lock on AF Expand Flexible Spot': 'Tracking Expanded Spot',
    'Lock on AF Flexible Spot': 'Tracking Spot',
    'Lock on AF Flexible Spot XS': 'Tracking Spot XS',
    'Lock on AF Flexible Spot XL': 'Tracking Spot XL',
    'Lock on AF Flexible Spot Free Size 1': 'Tracking Spot Free Size 1',
    'Lock on AF Flexible Spot Free Size 2': 'Tracking Spot Free Size 2',
    'Lock on AF Flexible Spot Free Size 3': 'Tracking Spot Free Size 3',
    'Tracking Flexible Spot S': 'Tracking Spot S',
    'Tracking Flexible Spot M': 'Tracking Spot M',
    'Tracking Flexible Spot L': 'Tracking Spot L',
    'Tracking Expand Flexible Spot': 'Tracking Expanded Spot',
} as const satisfies Names<SonyFocusAreaName>

const sonyDetectionSubjects = {
    Person: 'People',
    'Animal + Bird': 'Animals and birds',
    Animal: 'Animals',
    Bird: 'Birds',
    Insect: 'Insects',
    'Car/Train': 'Cars and trains',
    Plane: 'Planes',
    Auto: 'Auto',
} as const satisfies Names<CodecType<typeof sony.RecognitionTarget.codec>>

const sonyEyes = {
    Auto: 'Auto',
    'Right Eye': 'Right',
    'Left Eye': 'Left',
} as const satisfies Names<CodecType<typeof sony.RightLeftEyeSelect.codec>>

/** EOS One-Shot, AI Servo and AI Focus are AF-S, AF-C and AF-A; the lens switch at MF reads manual. */
const canonFocusModes = {
    'one-shot': 'AF-S',
    'ai-servo': 'AF-C',
    'ai-focus': 'AF-A',
    manual: 'MF',
} as const satisfies Names<CodecType<typeof canon.CanonFocusMode.codec>>

/** In video mode, Movie Servo AF on is continuous focus and off focuses once per AF press. */
const canonMovieServo = { on: 'AF-C', off: 'AF-S' } as const satisfies Names<
    CodecType<typeof canon.CanonMovieServoAutofocus.codec>
>

const canonFocusAreas = {
    quick: 'Quick',
    live: 'Single Point',
    face: 'Face Tracking',
    multi: 'Multi Point',
    zone: 'Zone',
    'expand-cross': 'Expanded Point Cross',
    'expand-around': 'Expanded Point Around',
    'large-zone-horizontal': 'Large Zone Horizontal',
    'large-zone-vertical': 'Large Zone Vertical',
    tracking: 'Tracking',
    spot: 'Spot',
    'flexible-zone-1': 'Flexible Zone 1',
    'flexible-zone-2': 'Flexible Zone 2',
    'flexible-zone-3': 'Flexible Zone 3',
    'whole-area': 'Wide',
    'spot-without-tracking': 'Spot Without Tracking',
    'one-point-without-tracking': 'Single Point Without Tracking',
    'expand-cross-without-tracking': 'Expanded Point Cross Without Tracking',
    'expand-around-without-tracking': 'Expanded Point Around Without Tracking',
} as const satisfies Names<CodecType<typeof canon.CanonLiveViewAutofocusMode.codec>>

const canonContinuous = { on: 'On', off: 'Off' } as const satisfies Names<
    CodecType<typeof canon.CanonContinuousAutofocus.codec>
>

const nikonFocusModes = {
    'AF-S': 'AF-S',
    'AF-C': 'AF-C',
    'AF-F': 'AF-F',
    Manual: 'MF',
} as const satisfies Names<NikonFocusModeLabel>

/** PTP FocusMode (0x500a): manual, automatic, automatic macro. */
const standardFocusModes = {
    Manual: 'MF',
    Automatic: 'AF',
    'Automatic Macro': 'AF macro',
} as const satisfies Names<CodecType<typeof standard.FocusMode.codec>>

/** Nikon's vendor values of the standard FocusMode (0x8010–0x8013), next to the standard ones. */
const nikonStandardFocusModes = {
    ...standardFocusModes,
    'AF-S': 'AF-S',
    'AF-C': 'AF-C',
    'AF-A': 'AF-A',
    'AF-F': 'AF-F',
} as const satisfies Names<CodecType<typeof nikonStandard.FocusMode.codec>>

/**
 * The canonical name of each vendor value, per inventory, setting and property. The keys of each
 * table are its codec's names (checked against the codec), the values are what `getCapabilities`
 * reports and `setControl` accepts. A value missing from a table keeps the camera's own label,
 * and the typed getters refuse to name it.
 */
export const focusControlValueNames = {
    sony: {
        focusMode: { FocusMode: sonyFocusModes },
        focusArea: { FocusArea: sonyFocusAreas },
        subjectDetection: { SubjectRecognitionInAF: onOff },
        detectionSubject: { RecognitionTarget: sonyDetectionSubjects },
        eyeSelection: { RightLeftEyeSelect: sonyEyes },
    },
    canon: {
        focusMode: { CanonFocusMode: canonFocusModes, CanonMovieServoAutofocus: canonMovieServo },
        focusArea: { CanonLiveViewAutofocusMode: canonFocusAreas },
        continuousAutofocus: { CanonContinuousAutofocus: canonContinuous },
    },
    standard: { focusMode: { FocusMode: standardFocusModes } },
    nikonPhoto: { focusMode: { NikonStillFocusMode: nikonFocusModes, FocusMode: nikonStandardFocusModes } },
    nikonMovie: { focusMode: { NikonMovieFocusMode: nikonFocusModes } },
} as const satisfies ControlValueNames<keyof typeof focusControlDefinitions>

/** The canonical values of one focus setting across every vendor table. */
export type FocusValueName<Id extends keyof typeof focusControlDefinitions> = {
    [Inventory in keyof typeof focusControlValueNames]: (typeof focusControlValueNames)[Inventory] extends infer Group
        ? Id extends keyof Group
            ? Group[Id] extends infer Properties
                ? {
                      [Property in keyof Properties]: Properties[Property][keyof Properties[Property]]
                  }[keyof Properties]
                : never
            : never
        : never
}[keyof typeof focusControlValueNames]

/**
 * Canon: Movie Servo AF stands for the focus mode only in video mode and with the lens at AF.
 * In photo mode (or at MF) the EOS focus mode itself is the observation.
 */
export function canonFocusModeStates<State extends { name: string; value: unknown }>(
    states: State[],
    videoMode: boolean
): State[] {
    const lensAtManual = states.some(state => state.name === 'CanonFocusMode' && state.value === 'manual')
    if (videoMode && !lensAtManual) return states
    return states.filter(state => state.name !== 'CanonMovieServoAutofocus')
}
