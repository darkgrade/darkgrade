import { speechModel, type SpeechModelId } from '@shared/speech-models'

export interface ModelLicense {
    name: string
    url: string
}

const BARK_LICENSE_URLS: Record<SpeechModelId, string> = {
    'bark-3.0': 'https://huggingface.co/ConwayResearch/Underdog-Bark-3.0/blob/main/LICENSE',
    'bark-3.0-plus': 'https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Plus/blob/main/LICENSE',
    'bark-3.0-pro': 'https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Pro/blob/main/LICENSE',
}

const ASSISTANT_LICENSE: ModelLicense = {
    name: 'Nemotron 3.5 Bolt',
    url: 'https://github.com/OpenMDW/OpenMDW/blob/main/1.1/LICENSE.OpenMDW-1.1',
}

/** The licenses of the models voice downloads and runs: the chosen speech model, and the assistant. */
export function modelLicenses(speechModelId: SpeechModelId): ModelLicense[] {
    return [{ name: speechModel(speechModelId).name, url: BARK_LICENSE_URLS[speechModelId] }, ASSISTANT_LICENSE]
}
