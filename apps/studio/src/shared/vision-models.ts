/**
 * Developer Mode's vision models. Each runs in its own process beside the speech engine and the assistant, so
 * all of them can be loaded at once; none unloads another.
 */
export type VisionModelId = 'depth-pro-2' | 'sam3'

/** Depth Pro 2's sizes (one Hugging Face repository each); larger is sharper and steadier, smaller is faster. */
export type DepthModelSize = 'S' | 'B' | 'L' | 'H'

export interface VisionModelChoice {
    id: VisionModelId
    name: string
    /** What it does, for the menu. */
    task: string
    /** Licence terms worth knowing before use. */
    licence: string
}

export const VISION_MODELS: VisionModelChoice[] = [
    {
        id: 'depth-pro-2',
        name: 'Depth Pro 2',
        task: 'Depth',
        licence: 'Apple Machine Learning Research Model licence: research use only',
    },
    {
        id: 'sam3',
        name: 'SAM 3',
        task: 'Segmentation',
        licence: "Meta's SAM licence; gated on Hugging Face (accept it at huggingface.co/facebook/sam3)",
    },
]

export const DEPTH_MODEL_SIZES: { id: DepthModelSize; label: string }[] = [
    { id: 'S', label: 'S (24M parameters, fastest)' },
    { id: 'B', label: 'B (97M)' },
    { id: 'L', label: 'L (334M, default)' },
    { id: 'H', label: 'H+ (872M, sharpest)' },
]

export const DEFAULT_DEPTH_MODEL_SIZE: DepthModelSize = 'L'

export function visionModel(id: VisionModelId): VisionModelChoice {
    return VISION_MODELS.find(model => model.id === id) ?? VISION_MODELS[0]
}

export interface VisionEngineStatus {
    phase: 'off' | 'downloading' | 'starting' | 'ready' | 'error'
    receivedBytes: number
    totalBytes: number
    message: string | null
}

/** SAM 3 overlays look for this until another noun phrase is typed. */
export const DEFAULT_SEGMENTATION_PROMPT = 'person'

/** One overlay over the live picture: a PNG the picture's shape, transparent where there is nothing to show. */
export interface VisionOverlay {
    imagePng: string
    /** The model's own time on the GPU for this frame. */
    modelMilliseconds: number
    /** Instances SAM 3 found; absent for depth. */
    instanceCount?: number
    /** Depth Pro 2's median depth, in metres. */
    medianMetres?: number | null
}
