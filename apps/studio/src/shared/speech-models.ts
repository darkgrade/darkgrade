/** The speech models Studio can run, all Conway Research's Underdog Bark 3.0 family (CC BY-NC 4.0). */
export type SpeechModelId = 'bark-3.0' | 'bark-3.0-plus' | 'bark-3.0-pro'

export interface SpeechModelChoice {
    id: SpeechModelId
    name: string
    /** How the speech sidecar runs it: MLX with the model's own bark_mlx.py, or transformers on the GPU. */
    runner: 'mlx' | 'transformers'
    description: string
}

export const SPEECH_MODELS: SpeechModelChoice[] = [
    { id: 'bark-3.0', name: 'Bark 3.0', runner: 'mlx', description: 'Smallest download' },
    {
        id: 'bark-3.0-plus',
        name: 'Bark 3.0 Plus',
        runner: 'mlx',
        description: "Voicebench's best: fastest and most accurate",
    },
    {
        id: 'bark-3.0-pro',
        name: 'Bark 3.0 Pro',
        runner: 'transformers',
        description: 'Largest; needs PyTorch (a few GB more)',
    },
]

export const DEFAULT_SPEECH_MODEL: SpeechModelId = 'bark-3.0-plus'

export function speechModel(id: SpeechModelId): SpeechModelChoice {
    return (
        SPEECH_MODELS.find(model => model.id === id) ?? SPEECH_MODELS.find(model => model.id === DEFAULT_SPEECH_MODEL)!
    )
}
