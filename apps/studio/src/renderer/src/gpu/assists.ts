/** Studio's own exposure and focus assists, drawn over the live picture by the GPU (gpu/picture-shader.ts). */
export interface PreviewAssistSettings {
    zebras: boolean
    /** Brightness (percent of full scale) at or above which zebra stripes appear. */
    zebraLevelPercent: number
    focusPeaking: boolean
    /** 1–100: higher marks softer edges too. */
    peakingSensitivity: number
}

export const DEFAULT_PREVIEW_ASSISTS: PreviewAssistSettings = {
    zebras: false,
    zebraLevelPercent: 95,
    focusPeaking: false,
    peakingSensitivity: 30,
}
