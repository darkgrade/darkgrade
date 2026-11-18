import { VOICE_SURFACE } from './flags'
export { default, VoiceBeam } from './VoiceBeam'

/** Whether this build carries the surface looks (`look="dots"` / `"lines"`) — not released yet. */
export const VOICE_SURFACE_LOOKS: boolean = VOICE_SURFACE

export { useMicrophone } from './useMicrophone'
export type { MicrophoneState, UseMicrophoneOptions, UseMicrophoneResult } from './useMicrophone'

export { getAudioContext, isAudioSupported } from './audio'
export { parseRgb } from './color'

export { resolveVoiceDefaults, resolveVoiceStyle, voiceDefaults, voiceTypePresets, voiceTypeStyle } from './presets'
export type { VoiceGeometry, VoiceTypeStyle } from './presets'

export type {
    VoiceBeamColorVariant,
    VoiceBeamDotShape,
    VoiceBeamLevel,
    VoiceBeamLinePattern,
    VoiceBeamLook,
    VoiceBeamMotion,
    VoiceBeamProps,
    VoiceBeamTheme,
    VoiceBeamType,
    VoiceThemeColors,
} from './types'

export { LOBE_SPACING, LOBE_SPAN, themePresets, voiceLobes, voicePalettes } from './styles'
export type { VoiceLobe } from './styles'
