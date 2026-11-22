import type { Preferences } from '@shared/ipc'
import { DEFAULT_SPEECH_MODEL, speechModel } from '@shared/speech-models'
import { DEFAULT_DEPTH_MODEL_SIZE, DEPTH_MODEL_SIZES, VISION_MODELS } from '@shared/vision-models'
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_PREFERENCES: Preferences = {
    mcpServerEnabled: false,
    mcpServerPort: 7461,
    speechModel: DEFAULT_SPEECH_MODEL,
    developerMode: false,
    metalLiveViewDecoder: false,
    usbTransport: 'node-usb', // EXPERIMENT(usb-transport)
    visionModels: [],
    depthModelSize: DEFAULT_DEPTH_MODEL_SIZE,
    windowMaterial: 'sidebar',
    dimWhenInactive: true,
}

/** Studio's settings, kept as JSON in Application Support and read once at launch. */
class PreferencesStore {
    private current: Preferences | null = null
    private listeners = new Set<(preferences: Preferences) => void>()

    private get path(): string {
        return join(app.getPath('userData'), 'preferences.json')
    }

    get(): Preferences {
        if (this.current) return this.current
        try {
            const saved = existsSync(this.path)
                ? (JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Preferences>)
                : {}
            this.current = { ...DEFAULT_PREFERENCES, ...saved }
            this.current.speechModel = speechModel(this.current.speechModel).id
            const { visionModels, depthModelSize } = this.current
            const savedVisionModels = Array.isArray(visionModels) ? visionModels : []
            this.current.visionModels = VISION_MODELS.map(model => model.id).filter(id =>
                savedVisionModels.includes(id)
            )
            if (!DEPTH_MODEL_SIZES.some(size => size.id === depthModelSize))
                this.current.depthModelSize = DEFAULT_DEPTH_MODEL_SIZE
        } catch {
            this.current = { ...DEFAULT_PREFERENCES }
        }
        return this.current
    }

    set(change: Partial<Preferences>): Preferences {
        this.current = { ...this.get(), ...change }
        writeFileSync(this.path, JSON.stringify(this.current, null, 4))
        this.listeners.forEach(listener => listener(this.current!))
        return this.current
    }

    onChange(listener: (preferences: Preferences) => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }
}

export const preferences = new PreferencesStore()
