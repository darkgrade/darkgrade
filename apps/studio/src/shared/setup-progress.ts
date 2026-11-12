import type { LocalModelStatus, VoiceEngineStatus, VoiceSetupStep } from '@shared/ipc'

export type SetupStepId = 'python' | 'tools' | 'speech' | 'assistant'
export type SetupStepState = 'waiting' | 'working' | 'done'

export interface SetupStep {
    id: SetupStepId
    /** What the person sees, in plain words. */
    label: string
    state: SetupStepState
    /** 0 to 1 inside this step; steps that cannot be measured stay at 0 until done. */
    fraction: number
    /** Bytes of this step's download so far, when it is a measurable download. */
    receivedBytes: number
    totalBytes: number
}

export interface SetupSummary {
    steps: SetupStep[]
    /** 0 to 1 across all steps. */
    fraction: number
    /** The step in progress, or the first one still waiting; null once everything is done. */
    current: SetupStep | null
    /** 1-based position of `current`, for "Step 2 of 4". */
    currentNumber: number
    complete: boolean
    /** Bytes of the model downloads (speech and assistant) received so far, and in all. Python's small download is not counted. */
    receivedBytes: number
    totalBytes: number
}

const STEP_LABELS: Record<SetupStepId, string> = {
    python: 'Voice engine',
    tools: 'Voice tools',
    speech: 'Speech recognition',
    assistant: 'Assistant',
}

/**
 * How much of the whole wait each step is, by rough time. The assistant is a multi-gigabyte download,
 * so it is most of it; weighting by bytes alone would leave the bar stuck near zero for the small steps.
 */
const STEP_WEIGHTS: Record<SetupStepId, number> = { python: 0.04, tools: 0.1, speech: 0.08, assistant: 0.78 }

const STEP_ORDER: SetupStepId[] = ['python', 'tools', 'speech', 'assistant']

const VOICE_STEP_TO_SETUP_STEP: Record<VoiceSetupStep, SetupStepId> = {
    python: 'python',
    tools: 'tools',
    'speech-model': 'speech',
    loading: 'speech',
}

/** Loading the downloaded speech model is the last stretch of its step. */
const LOADING_FRACTION = 0.9

function step(id: SetupStepId, state: SetupStepState, fraction = 0, receivedBytes = 0, totalBytes = 0): SetupStep {
    return { id, label: STEP_LABELS[id], state, fraction: state === 'done' ? 1 : fraction, receivedBytes, totalBytes }
}

function voiceSteps(voice: VoiceEngineStatus): SetupStep[] {
    const ready = voice.phase === 'ready'
    const running = voice.phase === 'downloading' || voice.phase === 'starting'
    const activeId = running && voice.setupStep ? VOICE_STEP_TO_SETUP_STEP[voice.setupStep] : null
    const activeIndex = activeId ? STEP_ORDER.indexOf(activeId) : -1
    return STEP_ORDER.slice(0, 3).map((id, index) => {
        const totalBytes = id === 'speech' ? voice.speechModelBytes : 0
        if (ready || (activeIndex >= 0 && index < activeIndex)) return step(id, 'done', 1, totalBytes, totalBytes)
        if (id !== activeId) return step(id, 'waiting', 0, 0, totalBytes)
        const downloading = voice.phase === 'downloading' && voice.totalBytes > 0
        const fraction = downloading
            ? voice.receivedBytes / voice.totalBytes
            : voice.setupStep === 'loading'
              ? LOADING_FRACTION
              : 0
        const receivedBytes = id !== 'speech' ? 0 : voice.setupStep === 'loading' ? totalBytes : voice.receivedBytes
        return step(id, 'working', fraction, receivedBytes, totalBytes)
    })
}

function assistantStep(assistant: LocalModelStatus | null): SetupStep {
    if (!assistant) return step('assistant', 'waiting')
    const { totalBytes } = assistant
    switch (assistant.phase) {
        case 'idle':
        case 'ready':
            return step('assistant', 'done', 1, totalBytes, totalBytes)
        case 'downloading': {
            const fraction = totalBytes ? assistant.receivedBytes / totalBytes : 0
            return step('assistant', 'working', fraction, assistant.receivedBytes, totalBytes)
        }
        case 'starting':
            return step('assistant', 'working', LOADING_FRACTION, totalBytes, totalBytes)
        default:
            return step('assistant', 'waiting', 0, 0, totalBytes)
    }
}

/** Combines the voice engine's and the assistant's setup into one list of steps and one overall progress. */
export function summarizeSetup(voice: VoiceEngineStatus, assistant: LocalModelStatus | null): SetupSummary {
    const steps = [...voiceSteps(voice), assistantStep(assistant)]
    const fraction = steps.reduce((sum, each) => sum + STEP_WEIGHTS[each.id] * each.fraction, 0)
    const working = steps.find(each => each.state === 'working')
    const current = working ?? steps.find(each => each.state === 'waiting') ?? null
    return {
        steps,
        fraction: Math.min(1, fraction),
        current,
        currentNumber: current ? steps.indexOf(current) + 1 : steps.length,
        complete: steps.every(each => each.state === 'done'),
        receivedBytes: steps.reduce((sum, each) => sum + each.receivedBytes, 0),
        totalBytes: steps.reduce((sum, each) => sum + each.totalBytes, 0),
    }
}
