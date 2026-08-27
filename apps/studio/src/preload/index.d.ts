import type { StudioApi } from '@shared/ipc'

declare global {
    interface Window {
        studio: StudioApi
    }
}

export {}
