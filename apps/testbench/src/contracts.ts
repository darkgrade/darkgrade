export const settingNames = ['iso', 'aperture', 'shutterSpeed', 'whiteBalance'] as const
export type SettingName = typeof settingNames[number]
export type BenchControl = { value: string; choices: string[]; enabled: boolean }
export type BenchCamera = {
    id: string
    name: string
    connected: boolean
    recording: 'idle' | 'recording' | 'uncertain'
    controls: Partial<Record<SettingName, BenchControl>>
    canRecord: boolean
    error?: string
}
export type BenchState = { cameras: BenchCamera[]; source: 'hardware' | 'fixture' }
export type BenchAction = 'connect' | 'disconnect' | 'refresh' | 'setting' | 'frame' | 'photo' | 'start' | 'stop' | 'recover'
