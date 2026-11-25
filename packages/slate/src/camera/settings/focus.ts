import { settingReader, type SettingReaders, type SettingTypes } from '@camera/settings/setting-types'
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
        aliases: ['subject recognition', 'subjectRecognition', 'eye tracking', 'eye AF', 'face detection', 'subject detection'],
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

/** Value types of this group's typed settings: each id gets `get<Id>()` and `set<Id>(value)` on Camera. */
export interface FocusSettingTypes {
    focusMode: SettingTypes<FocusMode>
    focusArea: SettingTypes<FocusArea>
    subjectDetection: SettingTypes<SubjectDetection>
    detectionSubject: SettingTypes<DetectionSubject>
    eyeSelection: SettingTypes<EyeSelection>
}

function namedReader<Value extends string>(id: keyof FocusSettingTypes) {
    const known = namedControlValues(id)
    return settingReader((value): value is Value => known.has(value))
}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const focusSettingReaders: SettingReaders<FocusSettingTypes> = {
    focusMode: namedReader<FocusMode>('focusMode'),
    focusArea: namedReader<FocusArea>('focusArea'),
    subjectDetection: namedReader<SubjectDetection>('subjectDetection'),
    detectionSubject: namedReader<DetectionSubject>('detectionSubject'),
    eyeSelection: namedReader<EyeSelection>('eyeSelection'),
}
