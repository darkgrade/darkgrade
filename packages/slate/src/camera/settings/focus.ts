import type { CameraControlState } from '@camera/controls'
import { CameraUnsupportedError } from '@camera/errors'
import type { SettingReaders, SettingTypes } from '@camera/settings/setting-types'
import { namedControlValues } from '@vendors/control-properties'
import type { FocusValueName } from '@vendors/control-properties/focus'

/** Focus settings. Canonical ids, labels and search aliases. */
export const focusControlDefinitions = {
    focusMode: {
        label: 'Focus mode',
        aliases: ['focus mode', 'One-Shot', 'AI Servo', 'Movie Servo AF', 'movie servo autofocus'],
    },
    focusArea: { label: 'Focus area', aliases: ['focus area', 'AF area', 'AF method'] },
    subjectDetection: {
        label: 'Subject detection',
        aliases: [
            'subject recognition',
            'subjectRecognition',
            'eye tracking',
            'eye AF',
            'face detection',
            'subject detection',
        ],
    },
    detectionSubject: {
        label: 'Detection subject',
        aliases: ['recognition target', 'recognitionTarget', 'subject to detect', 'detection subject'],
    },
    eyeSelection: { label: 'Eye selection', aliases: ['eye select', 'eyeSelect', 'eye selection'] },
    /**
     * Canon's Continuous AF: in One-Shot it keeps the lens roughly focused before the AF press, then
     * locks like One-Shot. That is not AF-C, so it is a setting of its own, present only where offered.
     */
    continuousAutofocus: { label: 'Continuous AF', aliases: ['continuous AF', 'continuous autofocus'] },
} as const

/** AF-S, AF-C or MF, and the other modes a body offers (AF-A, DMF, AF-F, ...). Canon One-Shot is AF-S. */
export type FocusMode = FocusValueName<'focusMode'>
/** Wide, Zone, Spot M, Tracking Spot M, ...; Sony's Flexible Spot is Spot, Lock-on AF is Tracking. */
export type FocusArea = FocusValueName<'focusArea'>
/** Whether the camera looks for faces, eyes and other subjects to focus on. */
export type SubjectDetection = FocusValueName<'subjectDetection'>
/** What subject detection looks for: People, Animals, Birds, ... */
export type DetectionSubject = FocusValueName<'detectionSubject'>
/** Which eye subject detection focuses on: Auto, Right or Left. */
export type EyeSelection = FocusValueName<'eyeSelection'>

/**
 * Value types of this group's typed settings: each id listed here gets `get<Id>()` and
 * `set<Id>(value)` on Camera. Follow `exposure.ts` (shutterSpeed is the worked example).
 */
export interface FocusSettingTypes {
    focusMode: SettingTypes<FocusMode>
    focusArea: SettingTypes<FocusArea>
    subjectDetection: SettingTypes<SubjectDetection>
    detectionSubject: SettingTypes<DetectionSubject>
    eyeSelection: SettingTypes<EyeSelection>
}

function canonicalReader<Value extends string>(
    id: keyof FocusSettingTypes,
    label: string
): (state: CameraControlState) => Value {
    const known = namedControlValues(id)
    const isNamed = (value: string): value is Value => known.has(value)
    return state => {
        if (isNamed(state.value)) return state.value
        throw new CameraUnsupportedError(id, `${label}: the camera reports a value Slate cannot name (${state.value})`)
    }
}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const focusSettingReaders: SettingReaders<FocusSettingTypes> = {
    focusMode: canonicalReader<FocusMode>('focusMode', 'Focus mode'),
    focusArea: canonicalReader<FocusArea>('focusArea', 'Focus area'),
    subjectDetection: canonicalReader<SubjectDetection>('subjectDetection', 'Subject detection'),
    detectionSubject: canonicalReader<DetectionSubject>('detectionSubject', 'Detection subject'),
    eyeSelection: canonicalReader<EyeSelection>('eyeSelection', 'Eye selection'),
}
